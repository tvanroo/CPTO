import { EventEmitter } from 'events';
import { config } from '../config';
import { redditClient } from '../clients/redditClient';
import { geminiClient } from '../clients/geminiClient';
import { aiService } from './aiService';
import { pendingTradesManager } from './pendingTradesManager';
import { dataStorageService, ProcessedContent } from './dataStorageService';
import { tickerValidationService } from './tickerValidationService';
import {
  RedditPost,
  RedditComment,
  RedditItem,
  TradeSignal,
  TradeOrder,
  CPTOError,
  PendingTrade
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
  private lastLogTime: number = 0; // For debug logging

  constructor() {
    super();
    this.stats = {} as TradingStats; // Initialize before calling methods
    this.initializeStats();
    this.setupEventHandlers();
    this.setupPendingTradeListeners();
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
      // Load historical data from database
      await this.loadHistoricalStats();
      await pendingTradesManager.loadFromDatabase();
      
      // Initialize ticker validation service
      console.log('🎯 Initializing ticker validation...');
      await tickerValidationService.refreshSupportedSymbols();
      
      // Test all connections first
      await this.testConnections();
      
      // Process recent Reddit posts from the last hour for initial data
      await this.processRecentRedditHistory();
      
      // Start Reddit streaming
      await redditClient.startStreaming();
      
      // Set running state before starting processing loop
      this.isRunning = true;
      this.stats.startTime = Date.now();
      
      // Start processing queue
      this.startProcessingLoop();
      
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
   * Load historical statistics from database
   */
  private async loadHistoricalStats(): Promise<void> {
    try {
      const dbStats = await dataStorageService.getTradingStatsFromDB();
      
      this.stats.totalItemsProcessed = dbStats.totalItemsProcessed;
      this.stats.totalTradesExecuted = dbStats.totalTradesExecuted;
      this.stats.successfulTrades = dbStats.successfulTrades;
      this.stats.failedTrades = dbStats.failedTrades;
      this.stats.totalProfitLoss = dbStats.totalProfitLoss;
      
      if (dbStats.totalItemsProcessed > 0 || dbStats.totalTradesExecuted > 0) {
        console.log(`📊 Historical stats loaded: ${dbStats.totalItemsProcessed} items processed, ${dbStats.totalTradesExecuted} trades, ${dbStats.successfulTrades} successful, $${dbStats.totalProfitLoss.toFixed(2)} P&L`);
      }
    } catch (error) {
      console.error('Failed to load historical stats:', error);
    }
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

    // Listen for subreddit management events to control streaming
    this.on('subredditAdded', async (data: { subreddit: string; timestamp: number }) => {
      console.log(`➕ Subreddit added event: r/${data.subreddit}`);
      await redditClient.addStreamingSubreddit(data.subreddit);
    });

    this.on('subredditEnabled', async (data: { subreddit: string; timestamp: number }) => {
      console.log(`✅ Subreddit enabled event: r/${data.subreddit}`);
      await redditClient.addStreamingSubreddit(data.subreddit);
    });

    this.on('subredditDisabled', (data: { subreddit: string; timestamp: number }) => {
      console.log(`⏸️  Subreddit disabled event: r/${data.subreddit}`);
      redditClient.removeStreamingSubreddit(data.subreddit);
    });

    this.on('subredditRemoved', (data: { subreddit: string; timestamp: number }) => {
      console.log(`🗑️  Subreddit removed event: r/${data.subreddit}`);
      redditClient.removeStreamingSubreddit(data.subreddit);
    });
  }

  /**
   * Set up event handlers for pending trades manager
   */
  private setupPendingTradeListeners(): void {
    // Listen for approved trades and execute them
    pendingTradesManager.on('tradeApproved', async (pendingTrade: PendingTrade) => {
      try {
        console.log(`✅ Executing approved trade: ${pendingTrade.signal.action.toUpperCase()} ${pendingTrade.signal.ticker}`);
        
        // Create a mock source item from the pending trade data
        const sourceItem: RedditItem = {
          id: pendingTrade.sourceItem.id,
          author: pendingTrade.sourceItem.author,
          subreddit: pendingTrade.sourceItem.subreddit,
          created_utc: Math.floor(pendingTrade.createdAt / 1000)
        } as RedditItem;
        
        await this.executeTrade(pendingTrade.signal, sourceItem);
        
      } catch (error) {
        console.error(`Failed to execute approved trade ${pendingTrade.id}:`, error);
        this.recordError('approved_trade_execution', error as Error);
        
        this.emit('approvedTradeError', {
          pendingTrade,
          error
        });
      }
    });

    // Listen for rejected trades
    pendingTradesManager.on('tradeRejected', (pendingTrade: PendingTrade) => {
      console.log(`❌ Trade rejected: ${pendingTrade.signal.action.toUpperCase()} ${pendingTrade.signal.ticker} (ID: ${pendingTrade.id})`);
      
      this.emit('tradeRejected', {
        pendingTrade,
        signal: pendingTrade.signal
      });
    });

    // Listen for expired trades
    pendingTradesManager.on('tradeExpired', (pendingTrade: PendingTrade) => {
      console.log(`⏰ Trade expired: ${pendingTrade.signal.action.toUpperCase()} ${pendingTrade.signal.ticker} (ID: ${pendingTrade.id})`);
      
      this.emit('tradeExpired', {
        pendingTrade,
        signal: pendingTrade.signal
      });
    });
  }

  /**
   * Test all external API connections
   */
  private async testConnections(): Promise<void> {
    console.log('Testing API connections...');
    
    const tests = [
      { name: 'OpenAI', test: () => aiService.testConnection() },
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
    console.log('🔄 Starting processing loop...');
    let loopIterations = 0;
    
    const processNext = async () => {
      loopIterations++;
      
      try {
        if (!this.isRunning) {
          console.log('⏹️ Processing loop stopped - bot not running');
          return;
        }

        // Log queue status every 10 seconds for debugging
        const now = Date.now();
        if (!this.lastLogTime || now - this.lastLogTime > 10000) {
          console.log(`📋 Queue status: ${this.processingQueue.length} items queued, ${this.processingInProgress.size} processing (iteration ${loopIterations})`);
          this.lastLogTime = now;
          
          // Log some details about the queue items
          if (this.processingQueue.length > 0) {
            const queueSample = this.processingQueue.slice(0, 3).map(item => `${item.item.id} from r/${item.item.subreddit}`);
            console.log(`📋 Queue sample: ${queueSample.join(', ')}`);
          }
        }

        // Process items if we have capacity
        while (
          this.processingQueue.length > 0 && 
          this.processingInProgress.size < this.maxConcurrentProcessing
        ) {
          const queueItem = this.processingQueue.shift();
          if (queueItem) {
            console.log(`🏗️ Starting to process item ${queueItem.id} (${queueItem.item.id} from r/${queueItem.item.subreddit})`);
            
            // Don't await - allow concurrent processing
            this.processQueueItem(queueItem).catch(error => {
              console.error(`❌ Unhandled error in processQueueItem for ${queueItem.id}:`, error);
              console.error('❌ Error stack:', error.stack);
            });
          }
        }

        // Schedule next iteration
        setTimeout(processNext, 1000); // Check every second
        
      } catch (loopError) {
        console.error('❌ Critical error in processing loop:', loopError);
        console.error('❌ Loop error stack:', loopError instanceof Error ? loopError.stack : 'No stack trace');
        
        // Try to restart the loop after a delay
        setTimeout(processNext, 5000);
      }
    };

    processNext();
  }

  /**
   * Process a single queue item
   */
  private async processQueueItem(queueItem: ProcessingQueue): Promise<void> {
    const { id, item } = queueItem;
    console.log(`🔄 processQueueItem: Starting ${id} (${item.id} from r/${item.subreddit})`);
    
    this.processingInProgress.add(id);
    console.log(`📋 Added ${id} to processing set. Current processing count: ${this.processingInProgress.size}`);

    try {
      console.log(`🔎 Calling processRedditItem for ${id}`);
      await this.processRedditItem(item);
      
      this.stats.totalItemsProcessed++;
      this.stats.lastProcessedTime = Date.now();
      console.log(`✅ Successfully processed ${id}. Total processed: ${this.stats.totalItemsProcessed}`);
      
      // Update subreddit stats in database (track post count per subreddit)
      try {
        await dataStorageService.updateSubredditStats(item.subreddit, this.stats.totalItemsProcessed);
      } catch (statsError) {
        // Don't fail processing if stats update fails
        console.warn(`Failed to update subreddit stats for r/${item.subreddit}:`, statsError);
      }
      
    } catch (error) {
      console.error(`❌ Failed to process item ${id}:`, error);
      console.error(`❌ Error details for ${id}:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : 'No stack trace',
        itemId: item.id,
        subreddit: item.subreddit
      });
      
      this.recordError('processing', error as Error);
      
      // Retry logic
      queueItem.retries++;
      if (queueItem.retries < 3) {
        console.log(`🔄 Retrying item ${id} (attempt ${queueItem.retries + 1})`);
        this.processingQueue.push(queueItem); // Add back to queue for retry
      } else {
        console.error(`❌ Max retries reached for item ${id}, dropping`);
      }
      
    } finally {
      this.processingInProgress.delete(id);
      console.log(`📋 Removed ${id} from processing set. Current processing count: ${this.processingInProgress.size}`);
    }
  }

  /**
   * Process a single Reddit item through the complete workflow
   */
  private async processRedditItem(item: RedditItem): Promise<void> {
    console.log(`🔎 processRedditItem: Starting ${item.id} from r/${item.subreddit}`);
    
    try {
      const content = this.extractContent(item);
      console.log(`🔍 Extracted content from ${item.id}: "${content.substring(0, 100)}..." (${content.length} chars)`);
      
      if (!content || content.length < 10) {
        console.log(`⏭️ Skipping ${item.id} - insufficient content (${content?.length || 0} chars)`);
        return; // Skip items with insufficient content
      }

      console.log(`🔄 Processing ${item.id} from r/${item.subreddit} - extracting tickers`);

      // Step 1: Extract crypto tickers from the content
      let tickers = this.tickerCache.get(content);
      if (!tickers) {
        console.log(`🤖 Calling AI service to extract tickers for ${item.id}`);
        tickers = await aiService.extractCryptoTickers(content);
        console.log(`🤖 AI service returned tickers for ${item.id}: ${JSON.stringify(tickers)}`);
        
        this.tickerCache.set(content, tickers);
        
        // Clean cache if it gets too large
        if (this.tickerCache.size > 1000) {
          const keys = Array.from(this.tickerCache.keys()).slice(0, 100);
          keys.forEach(key => this.tickerCache.delete(key));
        }
      } else {
        console.log(`💾 Using cached tickers for ${item.id}: ${JSON.stringify(tickers)}`);
      }

      // HYBRID TICKER INHERITANCE: Check for inherited tickers from parent
      if ((!tickers || tickers.length === 0) && 'parent_id' in item && item.parent_id) {
        // First, try memory-based inheritance (free)
        const inheritedTickers = redditClient.getInheritedTickers(item.parent_id);
        
        if (inheritedTickers.length > 0) {
          tickers = inheritedTickers;
          console.log(`📎 Inherited ${tickers.length} tickers from parent ${item.parent_id}: ${tickers.join(', ')}`);
        }
        // Second, for high-value orphan comments, fetch parent (selective API cost)
        else if (content.length > 150 && item.score > 10) {
          console.log(`🔍 High-value orphan comment (${item.score} upvotes, ${content.length} chars) - checking parent`);
          const parentComment = await redditClient.getCommentById(item.parent_id);
          
          if (parentComment && parentComment.body) {
            const parentTickers = await aiService.extractCryptoTickers(parentComment.body);
            if (parentTickers.length > 0) {
              tickers = parentTickers;
              console.log(`🎯 Found ${parentTickers.length} tickers in parent: ${parentTickers.join(', ')}`);
            }
          }
        }
      }

      if (!tickers || tickers.length === 0) {
        console.log(`⏭️ No crypto tickers found in ${item.id}, skipping`);
        return; // No crypto mentions found
      }
      
      // Store ticker context for future inheritance
      redditClient.storeTickerContext(item.id, tickers);

      // Step 2: Filter tickers to only those supported by Gemini
      const validTickers = await tickerValidationService.validateAndFilterTickers(tickers);
      
      if (validTickers.length === 0) {
        console.log(`⏭️ No valid Gemini-supported tickers found in ${item.id}, skipping`);
        return;
      }
      
      console.log(`🎖️ Found ${validTickers.length} valid tickers in ${item.id}, processing up to 3: ${validTickers.slice(0, 3).join(', ')}`);
      
      // Step 3: Analyze sentiment
      for (const ticker of validTickers.slice(0, 3)) { // Limit to 3 tickers per item to avoid API overuse
        console.log(`💰 Processing ticker ${ticker} for ${item.id}`);
        await this.processTicker(ticker, content, item);
        console.log(`✅ Completed processing ticker ${ticker} for ${item.id}`);
      }
      
      console.log(`✅ Completed processRedditItem for ${item.id}`);

    } catch (error) {
      console.error(`❌ Error in processRedditItem for ${item.id}:`, error);
      throw new CPTOError(`Failed to process Reddit item ${item.id}`, 'PROCESSING_ERROR', { 
        item: { id: item.id, subreddit: item.subreddit }, 
        error 
      });
    }
  }

  /**
   * Generate unique ID for processed content
   */
  private generateProcessingId(item: RedditItem): string {
    return `processed_${item.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Process a specific ticker mentioned in Reddit content
   */
  private async processTicker(ticker: string, content: string, item: RedditItem): Promise<void> {
    console.log(`💰 processTicker: Starting ${ticker} for ${item.id}`);
    
    try {
      // Check if we've traded this ticker too recently (rate limiting)
      const lastTradeTime = this.recentTrades.get(ticker) || 0;
      const timeSinceLastTrade = Date.now() - lastTradeTime;
      const minTimeBetweenTrades = (60 * 60 * 1000) / config.trading.maxTradesPerHour; // Convert to milliseconds
      
      if (timeSinceLastTrade < minTimeBetweenTrades) {
        console.log(`Skipping ${ticker} - too soon since last trade (${Math.round(timeSinceLastTrade / 1000)}s ago)`);
        return;
      }

      // Analyze sentiment (with selective parent context for borderline cases)
      let sentimentAnalysisText = content;
      let usedParentContext = false;
      
      // For borderline/weak sentiment on comments with parent, include parent context
      if ('parent_id' in item && item.parent_id) {
        // Quick initial sentiment check (reuse cache if available)
        const initialSentiment = await aiService.analyzeSentiment(content, ticker);
        
        // If sentiment is weak/borderline and content is substantial, add parent context
        if (Math.abs(initialSentiment.score) < 0.3 && content.length > 80) {
          console.log(`⚠️ Borderline sentiment (${initialSentiment.score.toFixed(2)}) - fetching parent for context`);
          const parentComment = await redditClient.getCommentById(item.parent_id);
          
          if (parentComment && parentComment.body) {
            sentimentAnalysisText = `Parent context: ${parentComment.body}\n\nReply: ${content}`;
            usedParentContext = true;
            console.log(`📝 Added parent context for clearer sentiment analysis`);
          }
        } else {
          // Use the initial sentiment if it's strong enough (avoid double analysis)
          console.log(`Sentiment for ${ticker}: ${initialSentiment.score.toFixed(2)} (confidence: ${initialSentiment.confidence.toFixed(2)})`);
        }
      }
      
      // Analyze sentiment with potentially enriched context
      let sentiment = usedParentContext ? 
        await aiService.analyzeSentiment(sentimentAnalysisText, ticker) :
        await aiService.analyzeSentiment(content, ticker);
      
      console.log(`Sentiment for ${ticker}: ${sentiment.score.toFixed(2)} (confidence: ${sentiment.confidence.toFixed(2)})${usedParentContext ? ' [with parent context]' : ''}`);
      
      // UPVOTE WEIGHTING: Adjust sentiment based on community validation
      const upvotes = item.score || 0;
      if (upvotes > 5) {
        // Use logarithmic scaling to avoid over-weighting viral content
        // Score of 10 upvotes -> 1.04x multiplier
        // Score of 100 upvotes -> 1.10x multiplier
        // Score of 1000 upvotes -> 1.15x multiplier
        const upvoteMultiplier = 1 + (Math.log10(upvotes) * 0.05);
        const originalScore = sentiment.score;
        sentiment.score = Math.max(-1, Math.min(1, sentiment.score * upvoteMultiplier));
        
        console.log(`👍 Upvote-weighted sentiment: ${originalScore.toFixed(3)} -> ${sentiment.score.toFixed(3)} (${upvotes} upvotes, ${upvoteMultiplier.toFixed(2)}x)`);
      }

      // Get market data from Gemini
      const marketData = await this.getMarketData(ticker);
      const marketTrend = undefined; // Skip TokenMetrics trend data

      // Extract current price for backtesting
      const currentPrice = marketData?.price || null;
      if (currentPrice) {
        console.log(`💵 Captured price for ${ticker}: $${currentPrice.toFixed(2)}`);
      }

      // Generate trading decision
      const tradeSignal = await aiService.generateTradeDecision(sentiment, marketData, marketTrend);
      
      // Store processed content with AI analysis
      try {
        const processedContentId = this.generateProcessingId(item);
        const processedContent: ProcessedContent = {
          id: processedContentId,
          reddit_id: item.id,
          subreddit: item.subreddit,
          author: item.author,
          title: 'title' in item ? item.title : undefined,
          content,
          url: 'url' in item ? item.url : undefined,
          created_utc: item.created_utc,
          type: 'title' in item ? 'post' : 'comment',
          sentiment_score: sentiment.score,
          sentiment_reasoning: sentiment.reasoning,
          extracted_tickers: [tickerValidationService.geminiSymbolToTicker(ticker)],
          confidence_level: sentiment.confidence,
          processing_timestamp: Date.now(),
          trade_signal: tradeSignal.action !== 'HOLD' ? tradeSignal : undefined,
          trade_reasoning: tradeSignal.action !== 'HOLD' ? tradeSignal.reasoning : undefined,
          price_at_analysis: currentPrice
        };
        
        await dataStorageService.storeProcessedContent(processedContent);
        console.log(`💾 Stored analysis for ${ticker} (ID: ${processedContent.id})`);
        
        // Save market snapshot for backtesting
        if (currentPrice && marketData) {
          try {
            const snapshotId = `snapshot_${ticker}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            await dataStorageService.saveMarketSnapshot({
              id: snapshotId,
              ticker: tickerValidationService.geminiSymbolToTicker(ticker),
              price: currentPrice,
              volume_24h: marketData.volume_24h,
              market_cap: marketData.market_cap,
              timestamp: Date.now(),
              source: 'gemini',
              processed_content_id: processedContentId
            });
          } catch (snapshotError) {
            console.warn('Failed to save market snapshot:', snapshotError);
          }
        }
      } catch (storageError) {
        console.warn('Failed to store processed content:', storageError);
        // Don't fail the entire processing pipeline for storage issues
      }

      // Check if sentiment meets threshold
      if (Math.abs(sentiment.score) < config.trading.sentimentThreshold) {
        console.log(`Sentiment for ${ticker} below threshold (${config.trading.sentimentThreshold})`);
        return;
      }
      
      console.log(`Trade signal for ${ticker}: ${tradeSignal.action} (confidence: ${tradeSignal.confidence.toFixed(2)})`);
      console.log(`Reasoning: ${tradeSignal.reasoning}`);

      // Execute trade if conditions are met
      if (tradeSignal.action !== 'HOLD' && tradeSignal.confidence > 0.6) {
        await this.handleTradeDecision(tradeSignal, item, sentiment, marketData, marketTrend, content);
      }

    } catch (error) {
      console.warn(`Failed to process ticker ${ticker}:`, error);
      this.recordError(`ticker_${ticker}`, error as Error);
    }
  }

  /**
   * Handle trade decision based on trading mode (manual vs autopilot)
   */
  private async handleTradeDecision(
    signal: TradeSignal, 
    sourceItem: RedditItem, 
    sentiment: any, 
    marketData: any, 
    marketTrend: any, 
    _content: string
  ): Promise<void> {
    const isManualMode = config.trading.tradingMode === 'manual';
    
    if (isManualMode) {
      // Add to pending trades for manual approval
      try {
        const pendingTrade = await pendingTradesManager.addPendingTrade(
          signal,
          {
            id: sourceItem.id,
            subreddit: sourceItem.subreddit,
            author: sourceItem.author,
            content: this.extractContent(sourceItem)
          },
          marketData,
          marketTrend,
          sentiment
        );

        console.log(`📋 Trade proposal added for manual approval: ${signal.action.toUpperCase()} ${signal.ticker} (ID: ${pendingTrade.id})`);
        
        // Emit event for dashboard notification
        this.emit('tradePendingApproval', {
          pendingTrade,
          signal,
          sourceItem: {
            id: sourceItem.id,
            subreddit: sourceItem.subreddit,
            author: sourceItem.author
          }
        });
        
      } catch (error) {
        console.error(`Failed to add pending trade for ${signal.ticker}:`, error);
        this.recordError('pending_trade', error as Error);
      }
    } else {
      // Autopilot mode - execute immediately
      console.log(`🚀 Autopilot mode: Executing trade immediately`);
      await this.executeTrade(signal, sourceItem);
    }
  }

  /**
   * Execute a trade based on the signal (called from autopilot mode or manual approval)
   */
  private async executeTrade(signal: TradeSignal, sourceItem: RedditItem): Promise<void> {
    try {
      // Check if ticker is disabled
      const isDisabled = await dataStorageService.isTickerDisabled(signal.ticker);
      if (isDisabled) {
        console.log(`⛔ Skipping trade execution for ${signal.ticker} - ticker is disabled`);
        return;
      }
      
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
      
      // Store trade performance data
      try {
        await dataStorageService.storeTradePerformance({
          trade_id: tradeResult.order_id,
          ticker: signal.ticker.toUpperCase(),
          action: signal.action.toLowerCase() as 'buy' | 'sell',
          entry_price: tradeResult.executed_price,
          exit_price: undefined,
          amount_usd: signal.amount_usd,
          reasoning: signal.reasoning,
          source_content_ids: [], // Could be enhanced to track which content triggered this
          executed_at: Date.now(),
          status: tradeResult.status as 'pending' | 'completed' | 'failed',
          pnl_usd: undefined
        });
        console.log(`💾 Stored trade performance data for ${signal.ticker}`);
      } catch (storageError) {
        console.warn('Failed to store trade performance:', storageError);
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
   * Get market data from Gemini Exchange only
   */
  private async getMarketData(ticker: string): Promise<any> {
    try {
      const geminiData = await geminiClient.getPrice(ticker);
      console.log(`📊 Market data from Gemini for ${ticker}: $${geminiData.price}`);
      return geminiData;
    } catch (error) {
      console.error(`Failed to get market data for ${ticker} from Gemini:`, error);
      // Return mock data to prevent pipeline failure
      return {
        ticker: ticker.toUpperCase(),
        price: 0,
        change_24h: 0,
        volume_24h: 0,
        timestamp: Date.now()
      };
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
      // Load active subreddits from database
      let subreddits: string[];
      try {
        subreddits = await dataStorageService.getActiveSubreddits();
        if (subreddits.length === 0) {
          console.warn('⚠️  No active subreddits in database, falling back to config');
          subreddits = config.trading.subreddits;
        } else {
          console.log(`📊 Processing history for ${subreddits.length} active subreddits from database`);
        }
      } catch (dbError) {
        console.warn('Failed to load subreddits from database, using config:', dbError);
        subreddits = config.trading.subreddits;
      }
      
      for (const subreddit of subreddits) {
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
          if (subreddit !== subreddits[subreddits.length - 1]) {
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
          subreddits: subreddits
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