import { EventEmitter } from 'events';
import { config } from '../config';
import { redditClient } from '../clients/redditClient';
import { tokenMetricsClient } from '../clients/tokenMetricsClient';
import { geminiClient } from '../clients/geminiClient';
import { aiService } from './aiService';
import {
  RedditPost,
  RedditComment,
  RedditItem,
  TradeSignal,
  TradeOrder,
  CPTOError
} from '../types';

interface ProcessingQueue {
  id: string;
  item: RedditItem;
  timestamp: number;
  retries: number;
}

interface TradingStats {
  totalItemsProcessed: number;
  totalTradesExecuted: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfitLoss: number;
  startTime: number;
  lastProcessedTime: number;
  errors: { [key: string]: number };
}

/**
 * Core Trading Bot that orchestrates the entire CPTO workflow
 */
export class TradingBot extends EventEmitter {
  private isRunning: boolean = false;
  private processingQueue: ProcessingQueue[] = [];
  private processingInProgress: Set<string> = new Set();
  private recentTrades: Map<string, number> = new Map(); // ticker -> timestamp
  private stats: TradingStats;
  private maxQueueSize: number = 1000;
  private maxConcurrentProcessing: number = 3;
  private tickerCache: Map<string, string[]> = new Map(); // text -> tickers

  constructor() {
    super();
    this.stats = {} as TradingStats; // Initialize before calling methods
    this.initializeStats();
    this.setupEventHandlers();
  }

  /**
   * Start the trading bot
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('Trading bot is already running');
      return;
    }

    console.log('Starting CPTO Trading Bot...');
    
    try {
      // Test all connections first
      await this.testConnections();
      
      // Process recent Reddit posts from the last hour for initial data
      await this.processRecentRedditHistory();
      
      // Start Reddit streaming
      await redditClient.startStreaming();
      
      // Start processing queue
      this.startProcessingLoop();
      
      this.isRunning = true;
      this.stats.startTime = Date.now();
      
      console.log('✅ CPTO Trading Bot started successfully');
      this.emit('botStarted');
      
    } catch (error) {
      console.error('❌ Failed to start trading bot:', error);
      this.emit('botError', error);
      throw error;
    }
  }

  /**
   * Stop the trading bot
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      console.warn('Trading bot is not running');
      return;
    }

    console.log('Stopping CPTO Trading Bot...');
    
    // Stop Reddit streaming
    redditClient.stopStreaming();
    
    // Wait for current processing to complete
    await this.waitForProcessingToComplete();
    
    this.isRunning = false;
    
    console.log('✅ CPTO Trading Bot stopped');
    this.emit('botStopped');
  }

  /**
   * Get current trading bot status
   */
  public getStatus(): {
    isRunning: boolean;
    stats: TradingStats;
    queueSize: number;
    processingCount: number;
    redditStatus: any;
  } {
    return {
      isRunning: this.isRunning,
      stats: { ...this.stats },
      queueSize: this.processingQueue.length,
      processingCount: this.processingInProgress.size,
      redditStatus: redditClient.getStreamingStatus()
    };
  }

  /**
   * Initialize statistics tracking
   */
  private initializeStats(): void {
    this.stats = {
      totalItemsProcessed: 0,
      totalTradesExecuted: 0,
      successfulTrades: 0,
      failedTrades: 0,
      totalProfitLoss: 0,
      startTime: 0,
      lastProcessedTime: 0,
      errors: {}
    };
  }

  /**
   * Set up event handlers for Reddit client
   */
  private setupEventHandlers(): void {
    redditClient.on('newPost', (post: RedditPost) => {
      this.addToQueue(post);
    });

    redditClient.on('newComment', (comment: RedditComment) => {
      this.addToQueue(comment);
    });

    redditClient.on('streamError', (error: Error) => {
      console.error('Reddit streaming error:', error);
      this.recordError('reddit_stream', error);
      this.emit('processingError', error);
    });
  }

  /**
   * Test all external API connections
   */
  private async testConnections(): Promise<void> {
    console.log('Testing API connections...');
    
    const tests = [
      { name: 'OpenAI', test: () => aiService.testConnection() },
      { name: 'TokenMetrics', test: () => tokenMetricsClient.testConnection() },
      { name: 'Gemini', test: () => geminiClient.testConnection() }
    ];

    for (const { name, test } of tests) {
      try {
        const success = await test();
        if (!success) {
          throw new Error(`${name} connection test failed`);
        }
        console.log(`✅ ${name} connection successful`);
      } catch (error) {
        console.error(`❌ ${name} connection failed:`, error);
        throw new CPTOError(`${name} API connection failed`, 'CONNECTION_ERROR', { service: name, error });
      }
    }
  }

  /**
   * Add Reddit item to processing queue
   */
  private addToQueue(item: RedditItem): void {
    if (this.processingQueue.length >= this.maxQueueSize) {
      console.warn('Processing queue is full, dropping oldest items');
      this.processingQueue.splice(0, Math.floor(this.maxQueueSize * 0.1)); // Remove 10%
    }

    const queueItem: ProcessingQueue = {
      id: `${item.id}_${Date.now()}`,
      item,
      timestamp: Date.now(),
      retries: 0
    };

    this.processingQueue.push(queueItem);
    
    // Emit queue update event
    this.emit('queueUpdated', {
      size: this.processingQueue.length,
      item: item
    });
  }

  /**
   * Start the main processing loop
   */
  private startProcessingLoop(): void {
    const processNext = async () => {
      if (!this.isRunning) return;

      // Process items if we have capacity
      while (
        this.processingQueue.length > 0 && 
        this.processingInProgress.size < this.maxConcurrentProcessing
      ) {
        const queueItem = this.processingQueue.shift();
        if (queueItem) {
          this.processQueueItem(queueItem);
        }
      }

      // Schedule next iteration
      setTimeout(processNext, 1000); // Check every second
    };

    processNext();
  }

  /**
   * Process a single queue item
   */
  private async processQueueItem(queueItem: ProcessingQueue): Promise<void> {
    const { id, item } = queueItem;
    this.processingInProgress.add(id);

    try {
      await this.processRedditItem(item);
      this.stats.totalItemsProcessed++;
      this.stats.lastProcessedTime = Date.now();
      
    } catch (error) {
      console.error(`Failed to process item ${id}:`, error);
      this.recordError('processing', error as Error);
      
      // Retry logic
      queueItem.retries++;
      if (queueItem.retries < 3) {
        console.log(`Retrying item ${id} (attempt ${queueItem.retries + 1})`);
        this.processingQueue.push(queueItem); // Add back to queue for retry
      } else {
        console.error(`Max retries reached for item ${id}, dropping`);
      }
      
    } finally {
      this.processingInProgress.delete(id);
    }
  }

  /**
   * Process a single Reddit item through the complete workflow
   */
  private async processRedditItem(item: RedditItem): Promise<void> {
    const content = this.extractContent(item);
    if (!content || content.length < 10) {
      return; // Skip items with insufficient content
    }

    console.log(`Processing ${item.id} from r/${item.subreddit}`);

    try {
      // Step 1: Extract crypto tickers from the content
      let tickers = this.tickerCache.get(content);
      if (!tickers) {
        tickers = await aiService.extractCryptoTickers(content);
        this.tickerCache.set(content, tickers);
        
        // Clean cache if it gets too large
        if (this.tickerCache.size > 1000) {
          const keys = Array.from(this.tickerCache.keys()).slice(0, 100);
          keys.forEach(key => this.tickerCache.delete(key));
        }
      }

      if (!tickers || tickers.length === 0) {
        return; // No crypto mentions found
      }

      // Step 2: Analyze sentiment
      for (const ticker of tickers.slice(0, 3)) { // Limit to 3 tickers per item to avoid API overuse
        await this.processTicker(ticker, content, item);
      }

    } catch (error) {
      throw new CPTOError(`Failed to process Reddit item ${item.id}`, 'PROCESSING_ERROR', { 
        item: { id: item.id, subreddit: item.subreddit }, 
        error 
      });
    }
  }

  /**
   * Process a specific ticker mentioned in Reddit content
   */
  private async processTicker(ticker: string, content: string, item: RedditItem): Promise<void> {
    try {
      // Check if we've traded this ticker too recently (rate limiting)
      const lastTradeTime = this.recentTrades.get(ticker) || 0;
      const timeSinceLastTrade = Date.now() - lastTradeTime;
      const minTimeBetweenTrades = (60 * 60 * 1000) / config.trading.maxTradesPerHour; // Convert to milliseconds
      
      if (timeSinceLastTrade < minTimeBetweenTrades) {
        console.log(`Skipping ${ticker} - too soon since last trade (${Math.round(timeSinceLastTrade / 1000)}s ago)`);
        return;
      }

      // Analyze sentiment
      const sentiment = await aiService.analyzeSentiment(content, ticker);
      console.log(`Sentiment for ${ticker}: ${sentiment.score.toFixed(2)} (confidence: ${sentiment.confidence.toFixed(2)})`);

      // Check if sentiment meets threshold
      if (Math.abs(sentiment.score) < config.trading.sentimentThreshold) {
        console.log(`Sentiment for ${ticker} below threshold (${config.trading.sentimentThreshold})`);
        return;
      }

      // Get market data from both sources for comparison
      const marketData = await this.getMarketData(ticker);
      const marketTrend = await tokenMetricsClient.getMarketTrends(ticker);

      // Generate trading decision
      const tradeSignal = await aiService.generateTradeDecision(sentiment, marketData, marketTrend);
      
      console.log(`Trade signal for ${ticker}: ${tradeSignal.action} (confidence: ${tradeSignal.confidence.toFixed(2)})`);
      console.log(`Reasoning: ${tradeSignal.reasoning}`);

      // Execute trade if conditions are met
      if (tradeSignal.action !== 'HOLD' && tradeSignal.confidence > 0.6) {
        await this.executeTrade(tradeSignal, item);
      }

    } catch (error) {
      console.warn(`Failed to process ticker ${ticker}:`, error);
      this.recordError(`ticker_${ticker}`, error as Error);
    }
  }

  /**
   * Execute a trade based on the signal
   */
  private async executeTrade(signal: TradeSignal, sourceItem: RedditItem): Promise<void> {
    try {
      console.log(`🚀 Executing ${signal.action} trade for ${signal.ticker}`);
      
      const order: TradeOrder = {
        ticker: signal.ticker,
        side: signal.action.toLowerCase() as 'buy' | 'sell',
        amount_usd: signal.amount_usd,
        order_type: 'market' // Use market orders for simplicity
      };

      // Execute trade using Gemini Exchange
      const tradeResult = await geminiClient.executeTrade(order);
      
      // Update tracking
      this.recentTrades.set(signal.ticker, Date.now());
      this.stats.totalTradesExecuted++;
      
      if (tradeResult.status === 'completed') {
        this.stats.successfulTrades++;
        console.log(`✅ Trade executed successfully: ${tradeResult.order_id}`);
      } else {
        this.stats.failedTrades++;
        console.log(`⚠️ Trade not completed: ${tradeResult.status}`);
      }

      // Emit trade event
      this.emit('tradeExecuted', {
        signal,
        result: tradeResult,
        sourceItem: {
          id: sourceItem.id,
          subreddit: sourceItem.subreddit,
          author: sourceItem.author
        }
      });

    } catch (error) {
      this.stats.failedTrades++;
      this.recordError('trade_execution', error as Error);
      console.error(`❌ Failed to execute trade for ${signal.ticker}:`, error);
      
      this.emit('tradeError', {
        signal,
        error,
        sourceItem: {
          id: sourceItem.id,
          subreddit: sourceItem.subreddit
        }
      });
    }
  }

  /**
   * Get market data with fallback strategy
   * Primary: Gemini Exchange (real-time trading data)
   * Fallback: TokenMetrics (broader market data)
   */
  private async getMarketData(ticker: string): Promise<any> {
    try {
      // Try Gemini first - it has real trading data
      const geminiData = await geminiClient.getPrice(ticker);
      console.log(`📊 Market data from Gemini for ${ticker}: $${geminiData.price}`);
      return geminiData;
    } catch (error) {
      console.warn(`Gemini data unavailable for ${ticker}, falling back to TokenMetrics:`, error);
      try {
        // Fallback to TokenMetrics
        const tokenMetricsData = await tokenMetricsClient.getMarketData(ticker);
        console.log(`📊 Market data from TokenMetrics for ${ticker}: $${tokenMetricsData.price}`);
        return tokenMetricsData;
      } catch (fallbackError) {
        console.error(`Failed to get market data for ${ticker} from both sources`);
        throw fallbackError;
      }
    }
  }

  /**
   * Extract text content from Reddit item
   */
  private extractContent(item: RedditItem): string {
    if ('title' in item) {
      // Reddit post
      return `${item.title} ${item.selftext}`.trim();
    } else {
      // Reddit comment
      return item.body;
    }
  }

  /**
   * Record error statistics
   */
  private recordError(category: string, error: Error): void {
    this.stats.errors[category] = (this.stats.errors[category] || 0) + 1;
    
    // Emit error event for monitoring
    this.emit('error', {
      category,
      error,
      timestamp: Date.now()
    });
  }

  /**
   * Wait for all current processing to complete
   */
  private async waitForProcessingToComplete(): Promise<void> {
    const maxWaitTime = 30000; // 30 seconds
    const startTime = Date.now();
    
    while (this.processingInProgress.size > 0) {
      if (Date.now() - startTime > maxWaitTime) {
        console.warn('Timeout waiting for processing to complete');
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  /**
   * Get recent trades for a specific ticker
   */
  public getRecentTradesForTicker(ticker: string): number | null {
    return this.recentTrades.get(ticker.toUpperCase()) || null;
  }

  /**
   * Clear recent trades (for testing or reset)
   */
  public clearRecentTrades(): void {
    this.recentTrades.clear();
    console.log('Recent trades cache cleared');
  }

  /**
   * Get processing statistics
   */
  public getStats(): TradingStats {
    return { ...this.stats };
  }

  /**
   * Process recent Reddit posts from the last hour for initial data
   * This provides content to analyze immediately on startup
   */
  private async processRecentRedditHistory(): Promise<void> {
    console.log('🕰️ Processing recent Reddit posts from the last hour...');
    
    const oneHourAgo = Math.floor(Date.now() / 1000) - (60 * 60); // 1 hour ago in Unix timestamp
    let totalItemsFound = 0;
    let totalItemsQueued = 0;
    
    try {
      for (const subreddit of config.trading.subreddits) {
        console.log(`🔍 Fetching recent posts from r/${subreddit}...`);
        
        try {
          // Get recent posts from the last few hours (more than 1 hour to ensure we get enough data)
          const posts = await redditClient.getRecentPosts(subreddit, 50);
          
          // Filter posts to only those from the last hour
          const recentPosts = posts.filter(post => post.created_utc >= oneHourAgo);
          totalItemsFound += recentPosts.length;
          
          console.log(`Found ${recentPosts.length} recent posts from r/${subreddit}`);
          
          // Add posts to processing queue
          for (const post of recentPosts) {
            this.addToQueue(post);
            totalItemsQueued++;
            
            // Also try to get recent comments for each post
            try {
              if (post.num_comments > 0) {
                const comments = await redditClient.getPostComments(post.id, 10);
                const recentComments = comments.filter(comment => comment.created_utc >= oneHourAgo);
                
                for (const comment of recentComments) {
                  this.addToQueue(comment);
                  totalItemsQueued++;
                }
                
                if (recentComments.length > 0) {
                  console.log(`Added ${recentComments.length} recent comments from post ${post.id}`);
                }
              }
            } catch (commentError) {
              console.warn(`Failed to fetch comments for post ${post.id}:`, commentError);
            }
          }
          
          // Add a small delay between subreddits to respect rate limits
          if (subreddit !== config.trading.subreddits[config.trading.subreddits.length - 1]) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
        } catch (subredditError) {
          console.warn(`Failed to fetch recent posts from r/${subreddit}:`, subredditError);
        }
      }
      
      console.log(`✅ Historical processing complete: Found ${totalItemsFound} recent items, queued ${totalItemsQueued} for processing`);
      
      if (totalItemsQueued > 0) {
        this.emit('historyProcessed', {
          itemsFound: totalItemsFound,
          itemsQueued: totalItemsQueued,
          subreddits: config.trading.subreddits
        });
      } else {
        console.log('💭 No recent Reddit activity found in the last hour');
      }
      
    } catch (error) {
      console.error('❌ Failed to process recent Reddit history:', error);
      this.recordError('history_processing', error as Error);
      // Don't throw - this is not critical for bot startup
    }
  }
}

// Export singleton instance
export const tradingBot = new TradingBot();