import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import { TradeSignal } from '../types/index';

export interface ProcessedContent {
  id: string;
  reddit_id: string;
  subreddit: string;
  author: string;
  title?: string;
  content: string;
  url?: string;
  created_utc: number;
  type: 'post' | 'comment';
  
  // AI Analysis Results
  sentiment_score: number;
  sentiment_reasoning: string;
  extracted_tickers: string[];
  confidence_level: number;
  processing_timestamp: number;
  
  // Trade Decision (if any)
  trade_signal?: TradeSignal;
  trade_reasoning?: string;
  
  // Price tracking for backtesting
  price_at_analysis?: number;
  price_1h_later?: number;
  price_24h_later?: number;
  price_change_1h?: number;
  price_change_24h?: number;
}

export interface MarketSnapshot {
  id: string;
  ticker: string;
  price: number;
  volume_24h?: number;
  market_cap?: number;
  timestamp: number;
  source: string;
  processed_content_id?: string;
}

export interface CurrencyWatchlistItem {
  ticker: string;
  current_sentiment: number;
  sentiment_trend: number; // Change over time
  mention_count: number;
  last_updated: number;
  confidence_avg: number;
  recent_analysis: ProcessedContent[];
}

export interface TradePerformance {
  trade_id: string;
  ticker: string;
  action: 'buy' | 'sell';
  entry_price: number;
  exit_price?: number;
  amount_usd: number;
  reasoning: string;
  source_content_ids: string[];
  executed_at: number;
  status: 'pending' | 'completed' | 'failed';
  pnl_usd?: number;
}

/**
 * Data Storage Service for Reddit content analysis and trading history
 * Uses SQLite for efficient local storage with JSON support
 */
export class DataStorageService {
  private db: Database | null = null;
  private readonly dbPath: string;
  private suggestionsCache: { data: any[]; timestamp: number } | null = null;
  private readonly suggestionsCacheTTL = 10 * 60 * 1000; // 10 minutes

  constructor() {
    this.dbPath = path.join(process.cwd(), 'data', 'cpto_analysis.db');
  }

  /**
   * Initialize the database and create tables
   */
  async initialize(): Promise<void> {
    try {
      // Ensure data directory exists
      const fs = await import('fs');
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Open database connection
      this.db = await open({
        filename: this.dbPath,
        driver: sqlite3.Database
      });

      await this.createTables();
      await this.runMigrations();
      console.log(`📊 Data Storage Service initialized: ${this.dbPath}`);
    } catch (error) {
      console.error('Failed to initialize data storage service:', error);
      throw error;
    }
  }

  /**
   * Create database tables with proper schema
   */
  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Processed Reddit content with AI analysis
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_content (
        id TEXT PRIMARY KEY,
        reddit_id TEXT UNIQUE NOT NULL,
        subreddit TEXT NOT NULL,
        author TEXT NOT NULL,
        title TEXT,
        content TEXT NOT NULL,
        url TEXT,
        created_utc INTEGER NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('post', 'comment')),
        
        -- AI Analysis Results
        sentiment_score REAL NOT NULL,
        sentiment_reasoning TEXT NOT NULL,
        extracted_tickers TEXT NOT NULL, -- JSON array
        confidence_level REAL NOT NULL,
        processing_timestamp INTEGER NOT NULL,
        
        -- Trade Decision (optional)
        trade_signal TEXT, -- JSON object
        trade_reasoning TEXT,
        
        -- Cost optimization tracking
        reuse_count INTEGER NOT NULL DEFAULT 0,
        
        -- Indexes for efficient querying
        UNIQUE(reddit_id)
      );

      CREATE INDEX IF NOT EXISTS idx_processed_content_timestamp 
        ON processed_content(processing_timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_processed_content_subreddit 
        ON processed_content(subreddit);
      CREATE INDEX IF NOT EXISTS idx_processed_content_sentiment 
        ON processed_content(sentiment_score DESC);
    `);

    // Currency watchlist with aggregated scores
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS currency_watchlist (
        ticker TEXT PRIMARY KEY,
        current_sentiment REAL NOT NULL DEFAULT 0,
        sentiment_trend REAL NOT NULL DEFAULT 0,
        mention_count INTEGER NOT NULL DEFAULT 0,
        last_updated INTEGER NOT NULL,
        confidence_avg REAL NOT NULL DEFAULT 0,
        
        -- Store recent analysis IDs for quick access
        recent_analysis_ids TEXT NOT NULL DEFAULT '[]' -- JSON array
      );

      CREATE INDEX IF NOT EXISTS idx_watchlist_sentiment 
        ON currency_watchlist(current_sentiment DESC);
    `);

    // Trade performance tracking
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS trade_performance (
        trade_id TEXT PRIMARY KEY,
        ticker TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('buy', 'sell')),
        entry_price REAL NOT NULL,
        exit_price REAL,
        amount_usd REAL NOT NULL,
        reasoning TEXT NOT NULL,
        source_content_ids TEXT NOT NULL, -- JSON array
        executed_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
        pnl_usd REAL
      );

      CREATE INDEX IF NOT EXISTS idx_trade_performance_ticker 
        ON trade_performance(ticker);
      CREATE INDEX IF NOT EXISTS idx_trade_performance_executed 
        ON trade_performance(executed_at DESC);
    `);

    // Market price snapshots for backtesting
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS market_snapshots (
        id TEXT PRIMARY KEY,
        ticker TEXT NOT NULL,
        price REAL NOT NULL,
        volume_24h REAL,
        market_cap REAL,
        timestamp INTEGER NOT NULL,
        source TEXT NOT NULL,
        processed_content_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_market_snapshots_ticker 
        ON market_snapshots(ticker);
      CREATE INDEX IF NOT EXISTS idx_market_snapshots_timestamp 
        ON market_snapshots(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_market_snapshots_ticker_time 
        ON market_snapshots(ticker, timestamp DESC);
    `);

    // Disabled tickers configuration
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS disabled_tickers (
        ticker TEXT PRIMARY KEY,
        disabled_at INTEGER NOT NULL,
        reason TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_disabled_tickers_ticker 
        ON disabled_tickers(ticker);
    `);

    // Pending trades for manual approval mode
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending_trades (
        id TEXT PRIMARY KEY,
        signal_data TEXT NOT NULL, -- JSON
        source_item_data TEXT NOT NULL, -- JSON
        market_data TEXT, -- JSON
        market_trend_data TEXT, -- JSON
        sentiment_data TEXT NOT NULL, -- JSON
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        processed_at INTEGER,
        approval_reason TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_pending_trades_status 
        ON pending_trades(status);
      CREATE INDEX IF NOT EXISTS idx_pending_trades_created 
        ON pending_trades(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_pending_trades_expires 
        ON pending_trades(expires_at);
    `);

    // Managed subreddits configuration
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS managed_subreddits (
        subreddit TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        added_at INTEGER NOT NULL,
        last_post_count INTEGER NOT NULL DEFAULT 0,
        last_checked INTEGER,
        is_crypto_focused INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_managed_subreddits_enabled 
        ON managed_subreddits(enabled);
    `);

    console.log('✅ Database tables created/verified');
    
    // Create indexes for performance
    await this.createPerformanceIndexes();
  }
  
  /**
   * Create performance indexes
   */
  private async createPerformanceIndexes(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    // Indexes for sentiment/price analysis queries
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_processed_content_ts 
        ON processed_content(processing_timestamp);
      
      CREATE INDEX IF NOT EXISTS idx_market_snapshots_ts 
        ON market_snapshots(timestamp);
      
      CREATE INDEX IF NOT EXISTS idx_market_snapshots_ticker_ts 
        ON market_snapshots(ticker, timestamp);
      
      CREATE INDEX IF NOT EXISTS idx_trade_performance_ticker_ts 
        ON trade_performance(ticker, executed_at);
    `);
    
    console.log('✅ Performance indexes created/verified');
  }

  /**
   * Run database migrations to update schema
   */
  private async runMigrations(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const tableInfo = await this.db.all(`PRAGMA table_info(processed_content)`);
    
    // Check if reuse_count column exists, if not add it
    const hasReuseCount = tableInfo.some((col: any) => col.name === 'reuse_count');
    if (!hasReuseCount) {
      await this.db.exec(`
        ALTER TABLE processed_content 
        ADD COLUMN reuse_count INTEGER NOT NULL DEFAULT 0;
      `);
      console.log('✅ Added reuse_count column to processed_content table');
    }

    // Check if price tracking columns exist, if not add them
    const hasPriceAtAnalysis = tableInfo.some((col: any) => col.name === 'price_at_analysis');
    if (!hasPriceAtAnalysis) {
      await this.db.exec(`
        ALTER TABLE processed_content ADD COLUMN price_at_analysis REAL;
        ALTER TABLE processed_content ADD COLUMN price_1h_later REAL;
        ALTER TABLE processed_content ADD COLUMN price_24h_later REAL;
        ALTER TABLE processed_content ADD COLUMN price_change_1h REAL;
        ALTER TABLE processed_content ADD COLUMN price_change_24h REAL;
      `);
      console.log('✅ Added price tracking columns to processed_content table');
    }

    // Migrate subreddits from config to managed_subreddits table
    await this.migrateSubredditsFromConfig();
  }

  /**
   * Migrate subreddits from SUBREDDITS environment variable to managed_subreddits table
   * This runs once on first initialization
   */
  private async migrateSubredditsFromConfig(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Check if managed_subreddits table has any rows
    const count = await this.db.get('SELECT COUNT(*) as count FROM managed_subreddits');
    
    if (count.count > 0) {
      // Migration already done
      return;
    }

    // Import config to get subreddits list
    const { config } = await import('../config');
    const subreddits = config.trading.subreddits || [];

    if (subreddits.length === 0) {
      console.log('⚠️  No subreddits found in config, skipping migration');
      return;
    }

    console.log(`🔄 Migrating ${subreddits.length} subreddits from config to database...`);

    // Crypto-focused keywords for heuristic detection
    const cryptoKeywords = ['crypto', 'btc', 'bitcoin', 'eth', 'ethereum', 'defi', 'blockchain', 'altcoin'];

    await this.db.run('BEGIN TRANSACTION');

    try {
      const now = Date.now();

      for (const subreddit of subreddits) {
        // Normalize subreddit name: strip r/ or /r/ prefix, lowercase, trim
        const normalized = this.normalizeSubredditName(subreddit);

        if (!normalized) {
          console.warn(`⚠️  Skipping invalid subreddit name: ${subreddit}`);
          continue;
        }

        // Check if subreddit name contains crypto keywords (simple heuristic)
        const lowerName = normalized.toLowerCase();
        const isCryptoFocused = cryptoKeywords.some(keyword => lowerName.includes(keyword)) ? 1 : 0;

        await this.db.run(`
          INSERT OR IGNORE INTO managed_subreddits (
            subreddit, enabled, added_at, last_post_count, last_checked, is_crypto_focused
          ) VALUES (?, ?, ?, ?, ?, ?)
        `, [normalized, 1, now, 0, null, isCryptoFocused]);

        console.log(`  ✅ Migrated: r/${normalized} (crypto-focused: ${isCryptoFocused ? 'yes' : 'no'})`);
      }

      await this.db.run('COMMIT');
      console.log(`✅ Successfully migrated ${subreddits.length} subreddits to database`);
    } catch (error) {
      await this.db.run('ROLLBACK');
      console.error('❌ Failed to migrate subreddits:', error);
      throw error;
    }
  }

  /**
   * Normalize subreddit name: strip r/ or /r/ prefix, lowercase, trim
   */
  private normalizeSubredditName(name: string): string {
    if (!name || typeof name !== 'string') {
      return '';
    }

    let normalized = name.trim();

    // Strip r/ or /r/ prefix
    normalized = normalized.replace(/^\/r\/|^r\//i, '');

    // Lowercase
    normalized = normalized.toLowerCase();

    return normalized;
  }

  /**
   * Store processed Reddit content with AI analysis
   */
  async storeProcessedContent(content: ProcessedContent): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run(`
      INSERT OR REPLACE INTO processed_content (
        id, reddit_id, subreddit, author, title, content, url, created_utc, type,
        sentiment_score, sentiment_reasoning, extracted_tickers, confidence_level,
        processing_timestamp, trade_signal, trade_reasoning, reuse_count, price_at_analysis
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      content.id,
      content.reddit_id,
      content.subreddit,
      content.author,
      content.title,
      content.content,
      content.url,
      content.created_utc,
      content.type,
      content.sentiment_score,
      content.sentiment_reasoning,
      JSON.stringify(content.extracted_tickers),
      content.confidence_level,
      content.processing_timestamp,
      content.trade_signal ? JSON.stringify(content.trade_signal) : null,
      content.trade_reasoning,
      0, // initial reuse_count
      content.price_at_analysis || null
    ]);

    // Update currency watchlist for any extracted tickers
    if (content.extracted_tickers.length > 0) {
      await this.updateCurrencyWatchlist(content);
    }
  }

  /**
   * Update currency watchlist with new analysis
   */
  private async updateCurrencyWatchlist(content: ProcessedContent): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    for (const ticker of content.extracted_tickers) {
      // Get current watchlist entry
      const existing = await this.db.get(
        'SELECT * FROM currency_watchlist WHERE ticker = ?',
        [ticker.toUpperCase()]
      );

      if (existing) {
        // Update existing entry with new sentiment
        const newMentionCount = existing.mention_count + 1;
        const newSentimentAvg = ((existing.current_sentiment * existing.mention_count) + content.sentiment_score) / newMentionCount;
        const sentimentTrend = content.sentiment_score - existing.current_sentiment;
        const newConfidenceAvg = ((existing.confidence_avg * existing.mention_count) + content.confidence_level) / newMentionCount;

        // Update recent analysis IDs (keep last 10)
        const recentIds = JSON.parse(existing.recent_analysis_ids || '[]');
        recentIds.unshift(content.id);
        const updatedRecentIds = recentIds.slice(0, 10);

        await this.db.run(`
          UPDATE currency_watchlist SET
            current_sentiment = ?,
            sentiment_trend = ?,
            mention_count = ?,
            last_updated = ?,
            confidence_avg = ?,
            recent_analysis_ids = ?
          WHERE ticker = ?
        `, [
          newSentimentAvg,
          sentimentTrend,
          newMentionCount,
          Date.now(),
          newConfidenceAvg,
          JSON.stringify(updatedRecentIds),
          ticker.toUpperCase()
        ]);
      } else {
        // Create new watchlist entry
        await this.db.run(`
          INSERT INTO currency_watchlist (
            ticker, current_sentiment, sentiment_trend, mention_count,
            last_updated, confidence_avg, recent_analysis_ids
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          ticker.toUpperCase(),
          content.sentiment_score,
          0, // No trend for first entry
          1,
          Date.now(),
          content.confidence_level,
          JSON.stringify([content.id])
        ]);
      }
    }
  }

  /**
   * Get recent processed content for a specific ticker
   */
  async getRecentAnalysisForTicker(ticker: string, limit: number = 10): Promise<ProcessedContent[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = await this.db.all(`
      SELECT * FROM processed_content 
      WHERE extracted_tickers LIKE ?
      ORDER BY processing_timestamp DESC
      LIMIT ?
    `, [`%"${ticker.toUpperCase()}"%`, limit]);

    return rows.map(this.parseProcessedContent);
  }

  /**
   * Get currency watchlist with current scores
   */
  async getCurrencyWatchlist(): Promise<CurrencyWatchlistItem[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = await this.db.all(`
      SELECT * FROM currency_watchlist
      ORDER BY current_sentiment DESC
    `);

    const watchlistItems: CurrencyWatchlistItem[] = [];

    for (const row of rows) {
      const recentIds = JSON.parse(row.recent_analysis_ids || '[]');
      const recentAnalysis: ProcessedContent[] = [];

      // Fetch recent analysis content
      if (recentIds.length > 0) {
        const placeholders = recentIds.map(() => '?').join(',');
        const analysisRows = await this.db.all(
          `SELECT * FROM processed_content WHERE id IN (${placeholders}) ORDER BY processing_timestamp DESC`,
          recentIds
        );
        recentAnalysis.push(...analysisRows.map(this.parseProcessedContent));
      }

      watchlistItems.push({
        ticker: row.ticker,
        current_sentiment: row.current_sentiment,
        sentiment_trend: row.sentiment_trend,
        mention_count: row.mention_count,
        last_updated: row.last_updated,
        confidence_avg: row.confidence_avg,
        recent_analysis: recentAnalysis
      });
    }

    return watchlistItems;
  }

  /**
   * Get recent processed content for dashboard display
   */
  async getRecentProcessedContent(limit: number = 50): Promise<ProcessedContent[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = await this.db.all(`
      SELECT * FROM processed_content
      ORDER BY processing_timestamp DESC
      LIMIT ?
    `, [limit]);

    return rows.map(this.parseProcessedContent);
  }

  /**
   * Store trade performance data
   */
  async storeTradePerformance(trade: TradePerformance): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run(`
      INSERT OR REPLACE INTO trade_performance (
        trade_id, ticker, action, entry_price, exit_price, amount_usd,
        reasoning, source_content_ids, executed_at, status, pnl_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      trade.trade_id,
      trade.ticker,
      trade.action,
      trade.entry_price,
      trade.exit_price,
      trade.amount_usd,
      trade.reasoning,
      JSON.stringify(trade.source_content_ids),
      trade.executed_at,
      trade.status,
      trade.pnl_usd
    ]);
  }

  /**
   * Get historical context for better AI decision making
   */
  async getHistoricalContext(ticker?: string, daysBack: number = 7): Promise<{
    recentAnalysis: ProcessedContent[];
    tradeHistory: TradePerformance[];
    sentimentTrend: { date: string; sentiment: number; }[];
  }> {
    if (!this.db) throw new Error('Database not initialized');

    const cutoffTime = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
    
    // Get recent analysis
    let analysisQuery = `
      SELECT * FROM processed_content 
      WHERE processing_timestamp >= ?
    `;
    const analysisParams: any[] = [cutoffTime];

    if (ticker) {
      analysisQuery += ` AND extracted_tickers LIKE ?`;
      analysisParams.push(`%"${ticker.toUpperCase()}"%`);
    }

    analysisQuery += ` ORDER BY processing_timestamp DESC LIMIT 100`;

    const analysisRows = await this.db.all(analysisQuery, analysisParams);
    const recentAnalysis = analysisRows.map(this.parseProcessedContent);

    // Get trade history
    let tradeQuery = `
      SELECT * FROM trade_performance 
      WHERE executed_at >= ?
    `;
    const tradeParams: any[] = [cutoffTime];

    if (ticker) {
      tradeQuery += ` AND ticker = ?`;
      tradeParams.push(ticker.toUpperCase());
    }

    tradeQuery += ` ORDER BY executed_at DESC`;

    const tradeRows = await this.db.all(tradeQuery, tradeParams);
    const tradeHistory = tradeRows.map(this.parseTradePerformance);

    // Calculate sentiment trend (daily averages)
    const sentimentTrend = this.calculateSentimentTrend(recentAnalysis, daysBack);

    return {
      recentAnalysis,
      tradeHistory,
      sentimentTrend
    };
  }

  /**
   * Parse database row to ProcessedContent object
   */
  private parseProcessedContent(row: any): ProcessedContent {
    return {
      id: row.id,
      reddit_id: row.reddit_id,
      subreddit: row.subreddit,
      author: row.author,
      title: row.title,
      content: row.content,
      url: row.url,
      created_utc: row.created_utc,
      type: row.type,
      sentiment_score: row.sentiment_score,
      sentiment_reasoning: row.sentiment_reasoning,
      extracted_tickers: JSON.parse(row.extracted_tickers || '[]'),
      confidence_level: row.confidence_level,
      processing_timestamp: row.processing_timestamp,
      trade_signal: row.trade_signal ? JSON.parse(row.trade_signal) : undefined,
      trade_reasoning: row.trade_reasoning
    };
  }

  /**
   * Parse database row to TradePerformance object
   */
  private parseTradePerformance(row: any): TradePerformance {
    return {
      trade_id: row.trade_id,
      ticker: row.ticker,
      action: row.action,
      entry_price: row.entry_price,
      exit_price: row.exit_price,
      amount_usd: row.amount_usd,
      reasoning: row.reasoning,
      source_content_ids: JSON.parse(row.source_content_ids || '[]'),
      executed_at: row.executed_at,
      status: row.status,
      pnl_usd: row.pnl_usd
    };
  }

  /**
   * Calculate daily sentiment trend
   */
  private calculateSentimentTrend(analysis: ProcessedContent[], daysBack: number): { date: string; sentiment: number; }[] {
    const dailyData = new Map<string, { total: number; count: number }>();
    
    for (const item of analysis) {
      const date = new Date(item.processing_timestamp).toISOString().split('T')[0];
      const existing = dailyData.get(date) || { total: 0, count: 0 };
      existing.total += item.sentiment_score;
      existing.count += 1;
      dailyData.set(date, existing);
    }

    const trend: { date: string; sentiment: number; }[] = [];
    for (let i = daysBack - 1; i >= 0; i--) {
      const date = new Date(Date.now() - (i * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
      const data = dailyData.get(date);
      trend.push({
        date,
        sentiment: data ? data.total / data.count : 0
      });
    }

    return trend;
  }

  /**
   * Increment reuse count for content (for cost tracking)
   */
  async incrementReuseCount(contentId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run(
      'UPDATE processed_content SET reuse_count = reuse_count + 1 WHERE id = ?',
      [contentId]
    );
  }

  /**
   * Get sentiment trend analysis with multiple timeframes
   */
  async getSentimentTrendAnalysis(ticker: string, days: number = 30): Promise<{
    daily: Array<{ date: string; avgSentiment: number; volume: number; confidence: number }>;
    hourly: Array<{ hour: string; avgSentiment: number; volume: number }>;
    summary: { trend: 'bullish' | 'bearish' | 'neutral'; strength: number; volatility: number };
  }> {
    if (!this.db) throw new Error('Database not initialized');
    
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    
    // Get all analysis for this ticker
    const analyses = await this.db.all(`
      SELECT sentiment_score, confidence_level, processing_timestamp
      FROM processed_content
      WHERE extracted_tickers LIKE ? AND processing_timestamp >= ?
      ORDER BY processing_timestamp ASC
    `, [`%"${ticker.toUpperCase()}"%`, cutoffTime]);
    
    if (analyses.length === 0) {
      return {
        daily: [],
        hourly: [],
        summary: { trend: 'neutral', strength: 0, volatility: 0 }
      };
    }
    
    // Calculate daily trends
    const dailyData = new Map<string, { total: number; count: number; confidenceSum: number }>();
    const hourlyData = new Map<string, { total: number; count: number }>();
    
    analyses.forEach(analysis => {
      const date = new Date(analysis.processing_timestamp);
      const dayKey = date.toISOString().split('T')[0];
      const hourKey = `${dayKey}T${date.getHours().toString().padStart(2, '0')}:00:00.000Z`;
      
      // Daily aggregation
      const daily = dailyData.get(dayKey) || { total: 0, count: 0, confidenceSum: 0 };
      daily.total += analysis.sentiment_score;
      daily.count += 1;
      daily.confidenceSum += analysis.confidence_level;
      dailyData.set(dayKey, daily);
      
      // Hourly aggregation (last 7 days only)
      if (Date.now() - analysis.processing_timestamp < 7 * 24 * 60 * 60 * 1000) {
        const hourly = hourlyData.get(hourKey) || { total: 0, count: 0 };
        hourly.total += analysis.sentiment_score;
        hourly.count += 1;
        hourlyData.set(hourKey, hourly);
      }
    });
    
    // Convert to arrays
    const daily = Array.from(dailyData.entries()).map(([date, data]) => ({
      date,
      avgSentiment: data.total / data.count,
      volume: data.count,
      confidence: data.confidenceSum / data.count
    }));
    
    const hourly = Array.from(hourlyData.entries()).map(([hour, data]) => ({
      hour,
      avgSentiment: data.total / data.count,
      volume: data.count
    }));
    
    // Calculate summary statistics
    const sentiments = daily.map(d => d.avgSentiment);
    const avgSentiment = sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
    const variance = sentiments.reduce((sum, val) => sum + Math.pow(val - avgSentiment, 2), 0) / sentiments.length;
    const volatility = Math.sqrt(variance);
    
    // Determine trend (last 7 days vs previous 7 days)
    const recent = daily.slice(-7).reduce((sum, d) => sum + d.avgSentiment, 0) / Math.min(7, daily.length);
    const previous = daily.slice(-14, -7).reduce((sum, d) => sum + d.avgSentiment, 0) / Math.min(7, daily.slice(-14, -7).length);
    
    let trend: 'bullish' | 'bearish' | 'neutral';
    const trendStrength = Math.abs(recent - previous);
    
    if (trendStrength < 0.1) trend = 'neutral';
    else if (recent > previous) trend = 'bullish';
    else trend = 'bearish';
    
    return {
      daily,
      hourly,
      summary: {
        trend,
        strength: trendStrength,
        volatility
      }
    };
  }
  
  /**
   * Get ticker correlation analysis
   */
  async getTickerCorrelationAnalysis(ticker1: string, ticker2: string, days: number = 30): Promise<{
    correlation: number;
    sharedMentions: number;
    sentiment1: { avg: number; trend: number };
    sentiment2: { avg: number; trend: number };
    timeAlignment: Array<{ date: string; sentiment1: number; sentiment2: number }>;
  }> {
    if (!this.db) throw new Error('Database not initialized');
    
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    
    // Get analyses for both tickers with daily aggregation
    const query = `
      SELECT 
        DATE(processing_timestamp / 1000, 'unixepoch') as date,
        AVG(CASE WHEN extracted_tickers LIKE ? THEN sentiment_score END) as sentiment1,
        AVG(CASE WHEN extracted_tickers LIKE ? THEN sentiment_score END) as sentiment2,
        COUNT(CASE WHEN extracted_tickers LIKE ? AND extracted_tickers LIKE ? THEN 1 END) as shared
      FROM processed_content
      WHERE processing_timestamp >= ?
        AND (extracted_tickers LIKE ? OR extracted_tickers LIKE ?)
      GROUP BY DATE(processing_timestamp / 1000, 'unixepoch')
      HAVING sentiment1 IS NOT NULL AND sentiment2 IS NOT NULL
      ORDER BY date ASC
    `;
    
    const results = await this.db.all(query, [
      `%"${ticker1.toUpperCase()}"%`, `%"${ticker2.toUpperCase()}"%`,
      `%"${ticker1.toUpperCase()}"%`, `%"${ticker2.toUpperCase()}"%`,
      cutoffTime,
      `%"${ticker1.toUpperCase()}"%`, `%"${ticker2.toUpperCase()}"%`
    ]);
    
    if (results.length < 2) {
      return {
        correlation: 0,
        sharedMentions: 0,
        sentiment1: { avg: 0, trend: 0 },
        sentiment2: { avg: 0, trend: 0 },
        timeAlignment: []
      };
    }
    
    // Calculate correlation
    const sentiments1 = results.map(r => r.sentiment1).filter(s => s !== null);
    const sentiments2 = results.map(r => r.sentiment2).filter(s => s !== null);
    
    const correlation = this.calculateCorrelation(sentiments1, sentiments2);
    const sharedMentions = results.reduce((sum, r) => sum + (r.shared || 0), 0);
    
    return {
      correlation,
      sharedMentions,
      sentiment1: {
        avg: sentiments1.reduce((a, b) => a + b, 0) / sentiments1.length,
        trend: sentiments1[sentiments1.length - 1] - sentiments1[0]
      },
      sentiment2: {
        avg: sentiments2.reduce((a, b) => a + b, 0) / sentiments2.length,
        trend: sentiments2[sentiments2.length - 1] - sentiments2[0]
      },
      timeAlignment: results.map(r => ({
        date: r.date,
        sentiment1: r.sentiment1,
        sentiment2: r.sentiment2
      }))
    };
  }
  
  /**
   * Get subreddit influence analysis
   */
  async getSubredditInfluenceAnalysis(days: number = 30): Promise<Array<{
    subreddit: string;
    totalMentions: number;
    avgSentiment: number;
    avgConfidence: number;
    uniqueTickers: number;
    influence: number;
    topTickers: Array<{ ticker: string; mentions: number; avgSentiment: number }>;
  }>> {
    if (!this.db) throw new Error('Database not initialized');
    
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    
    const subredditStats = await this.db.all(`
      SELECT 
        subreddit,
        COUNT(*) as total_mentions,
        AVG(sentiment_score) as avg_sentiment,
        AVG(confidence_level) as avg_confidence,
        COUNT(DISTINCT extracted_tickers) as unique_tickers
      FROM processed_content
      WHERE processing_timestamp >= ?
      GROUP BY subreddit
      ORDER BY total_mentions DESC
    `, [cutoffTime]);
    
    const results = [];
    
    for (const stat of subredditStats) {
      // Get top tickers for this subreddit
      const topTickers = await this.db.all(`
        SELECT 
          ticker,
          mention_count as mentions,
          current_sentiment as avg_sentiment
        FROM currency_watchlist
        ORDER BY mention_count DESC
        LIMIT 5
      `);
      
      // Calculate influence score (weighted by volume, sentiment strength, and confidence)
      const influence = (stat.total_mentions * 0.4) + 
                       (Math.abs(stat.avg_sentiment) * 100 * 0.3) + 
                       (stat.avg_confidence * 100 * 0.3);
      
      results.push({
        subreddit: stat.subreddit,
        totalMentions: stat.total_mentions,
        avgSentiment: stat.avg_sentiment,
        avgConfidence: stat.avg_confidence,
        uniqueTickers: stat.unique_tickers,
        influence,
        topTickers
      });
    }
    
    return results.sort((a, b) => b.influence - a.influence);
  }
  
  /**
   * Get AI decision accuracy tracking
   */
  async getAIAccuracyTracking(days: number = 30): Promise<{
    overall: { accuracy: number; totalDecisions: number; confidence: number };
    byConfidenceRange: Array<{ range: string; accuracy: number; count: number }>;
    trendOverTime: Array<{ date: string; accuracy: number; avgConfidence: number }>;
    byTicker: Array<{ ticker: string; accuracy: number; decisions: number }>;
  }> {
    if (!this.db) throw new Error('Database not initialized');
    
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    
    // For now, we'll simulate accuracy based on confidence levels
    // In a real implementation, this would compare predictions to actual outcomes
    const decisions = await this.db.all(`
      SELECT 
        confidence_level,
        sentiment_score,
        extracted_tickers,
        processing_timestamp,
        DATE(processing_timestamp / 1000, 'unixepoch') as date
      FROM processed_content
      WHERE processing_timestamp >= ?
        AND trade_signal IS NOT NULL
      ORDER BY processing_timestamp ASC
    `, [cutoffTime]);
    
    if (decisions.length === 0) {
      return {
        overall: { accuracy: 0, totalDecisions: 0, confidence: 0 },
        byConfidenceRange: [],
        trendOverTime: [],
        byTicker: []
      };
    }
    
    // Simulate accuracy based on confidence (higher confidence = higher accuracy)
    const accuracySimulation = decisions.map(d => ({
      ...d,
      accurate: d.confidence_level > 0.7 ? Math.random() > 0.2 : Math.random() > 0.5
    }));
    
    const totalAccurate = accuracySimulation.filter(d => d.accurate).length;
    const overallAccuracy = totalAccurate / decisions.length;
    const avgConfidence = decisions.reduce((sum, d) => sum + d.confidence_level, 0) / decisions.length;
    
    return {
      overall: {
        accuracy: overallAccuracy,
        totalDecisions: decisions.length,
        confidence: avgConfidence
      },
      byConfidenceRange: this.calculateAccuracyByConfidenceRange(accuracySimulation),
      trendOverTime: this.calculateAccuracyTrend(accuracySimulation),
      byTicker: this.calculateAccuracyByTicker(accuracySimulation)
    };
  }
  
  // Helper methods
  private calculateCorrelation(arr1: number[], arr2: number[]): number {
    if (arr1.length !== arr2.length || arr1.length < 2) return 0;
    
    const mean1 = arr1.reduce((a, b) => a + b, 0) / arr1.length;
    const mean2 = arr2.reduce((a, b) => a + b, 0) / arr2.length;
    
    const numerator = arr1.reduce((sum, val, i) => sum + (val - mean1) * (arr2[i] - mean2), 0);
    const denominator = Math.sqrt(
      arr1.reduce((sum, val) => sum + Math.pow(val - mean1, 2), 0) *
      arr2.reduce((sum, val) => sum + Math.pow(val - mean2, 2), 0)
    );
    
    return denominator === 0 ? 0 : numerator / denominator;
  }
  
  private calculateAccuracyByConfidenceRange(decisions: any[]): any[] {
    const ranges = [
      { min: 0, max: 0.5, label: '0-50%' },
      { min: 0.5, max: 0.7, label: '50-70%' },
      { min: 0.7, max: 0.85, label: '70-85%' },
      { min: 0.85, max: 1, label: '85-100%' }
    ];
    
    return ranges.map(range => {
      const inRange = decisions.filter(d => d.confidence_level >= range.min && d.confidence_level < range.max);
      const accurate = inRange.filter(d => d.accurate).length;
      
      return {
        range: range.label,
        accuracy: inRange.length > 0 ? accurate / inRange.length : 0,
        count: inRange.length
      };
    });
  }
  
  private calculateAccuracyTrend(decisions: any[]): any[] {
    const dailyData = new Map<string, { accurate: number; total: number; confidenceSum: number }>();
    
    decisions.forEach(d => {
      const existing = dailyData.get(d.date) || { accurate: 0, total: 0, confidenceSum: 0 };
      existing.total += 1;
      existing.confidenceSum += d.confidence_level;
      if (d.accurate) existing.accurate += 1;
      dailyData.set(d.date, existing);
    });
    
    return Array.from(dailyData.entries()).map(([date, data]) => ({
      date,
      accuracy: data.accurate / data.total,
      avgConfidence: data.confidenceSum / data.total
    }));
  }
  
  private calculateAccuracyByTicker(decisions: any[]): any[] {
    const tickerData = new Map<string, { accurate: number; total: number }>();
    
    decisions.forEach(d => {
      const tickers = JSON.parse(d.extracted_tickers || '[]');
      tickers.forEach((ticker: string) => {
        const existing = tickerData.get(ticker) || { accurate: 0, total: 0 };
        existing.total += 1;
        if (d.accurate) existing.accurate += 1;
        tickerData.set(ticker, existing);
      });
    });
    
    return Array.from(tickerData.entries())
      .map(([ticker, data]) => ({
        ticker,
        accuracy: data.accurate / data.total,
        decisions: data.total
      }))
      .filter(t => t.decisions >= 3) // Only include tickers with at least 3 decisions
      .sort((a, b) => b.decisions - a.decisions);
  }
  
  /**
   * Get comprehensive ticker statistics for analytics
   */
  async getTickerStatistics(options: {
    days?: number;
    baseCurrency?: 'USD' | 'BTC';
    minMentions?: number;
    includeCorrelation?: boolean;
    limit?: number;
    tickers?: string[];
  } = {}): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const {
      days = 7,
      baseCurrency = 'USD',
      minMentions = 5,
      includeCorrelation = false,
      limit,
      tickers
    } = options;
    
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    
    // Step 1: Determine ticker set
    let tickerSet: Set<string>;
    
    if (tickers && tickers.length > 0) {
      tickerSet = new Set(tickers.map(t => t.toUpperCase()));
    } else {
      // Get tickers from watchlist
      const watchlistRows = await this.db.all(
        'SELECT DISTINCT ticker FROM currency_watchlist'
      );
      
      // Get recent tickers from processed_content
      const recentTickerRows = await this.db.all(`
        SELECT DISTINCT json_each.value as ticker
        FROM processed_content, json_each(extracted_tickers)
        WHERE processing_timestamp >= ?
      `, [cutoffTime]);
      
      tickerSet = new Set<string>();
      watchlistRows.forEach(row => tickerSet.add(row.ticker));
      recentTickerRows.forEach(row => tickerSet.add(row.ticker));
    }
    
    const tickerList = Array.from(tickerSet);
    
    // Step 2: Process each ticker
    const results: any[] = [];
    
    for (const ticker of tickerList) {
      try {
        // Get sentiment data
        const sentimentRows = await this.db.all(`
          SELECT sentiment_score, confidence_level, processing_timestamp
          FROM processed_content
          WHERE extracted_tickers LIKE ? AND processing_timestamp >= ?
          ORDER BY processing_timestamp ASC
        `, [`%"${ticker}"%`, cutoffTime]);
        
        const totalMentions = sentimentRows.length;
        const hasData = totalMentions >= minMentions;
        
        let avgSentiment = 0;
        let avgConfidence = 0;
        let lastAnalyzedAt: number | null = null;
        let dataPoints = 0;
        
        if (sentimentRows.length > 0) {
          avgSentiment = sentimentRows.reduce((sum, row) => sum + row.sentiment_score, 0) / sentimentRows.length;
          avgConfidence = sentimentRows.reduce((sum, row) => sum + row.confidence_level, 0) / sentimentRows.length;
          lastAnalyzedAt = sentimentRows[sentimentRows.length - 1].processing_timestamp;
          dataPoints = sentimentRows.length;
        }
        
        // Get price data
        const priceRows = await this.db.all(`
          SELECT price, timestamp
          FROM market_snapshots
          WHERE ticker = ? AND timestamp >= ? AND timestamp <= ?
          ORDER BY timestamp ASC
        `, [ticker, cutoffTime, Date.now()]);
        
        let priceChangePercent = 0;
        if (priceRows.length >= 2) {
          const firstPrice = priceRows[0].price;
          const lastPrice = priceRows[priceRows.length - 1].price;
          priceChangePercent = ((lastPrice - firstPrice) / firstPrice) * 100;
        }
        
        // Calculate correlation if requested and data is sufficient
        let sentimentPriceCorrelation: number | null = null;
        
        if (includeCorrelation && hasData && priceRows.length >= 3) {
          // Build time-aligned sentiment-price pairs
          const validPairs: Array<{ sentiment: number; priceReturn: number }> = [];
          
          // Create a map of timestamps to prices for faster lookup
          const priceMap = new Map<number, number>();
          priceRows.forEach(row => priceMap.set(row.timestamp, row.price));
          
          // For each sentiment point, find nearest price within 1 hour window
          for (let i = 1; i < sentimentRows.length; i++) {
            const sentiment = sentimentRows[i].sentiment_score;
            const timestamp = sentimentRows[i].processing_timestamp;
            
            // Find closest price within 1 hour
            let closestPrice: number | null = null;
            let minDiff = 60 * 60 * 1000; // 1 hour
            
            for (const [priceTime, price] of priceMap.entries()) {
              const diff = Math.abs(priceTime - timestamp);
              if (diff < minDiff) {
                minDiff = diff;
                closestPrice = price;
              }
            }
            
            // Also need previous price for return calculation
            const prevTimestamp = sentimentRows[i - 1].processing_timestamp;
            let prevPrice: number | null = null;
            minDiff = 60 * 60 * 1000;
            
            for (const [priceTime, price] of priceMap.entries()) {
              const diff = Math.abs(priceTime - prevTimestamp);
              if (diff < minDiff) {
                minDiff = diff;
                prevPrice = price;
              }
            }
            
            if (closestPrice && prevPrice && prevPrice > 0) {
              const priceReturn = Math.log(closestPrice / prevPrice);
              validPairs.push({ sentiment, priceReturn });
            }
          }
          
          // Calculate correlation if we have enough pairs
          if (validPairs.length >= 3) {
            const sentiments = validPairs.map(p => p.sentiment);
            const returns = validPairs.map(p => p.priceReturn);
            sentimentPriceCorrelation = this.calculateCorrelation(sentiments, returns);
          }
        }
        
        results.push({
          ticker,
          avgSentiment,
          priceChangePercent,
          totalMentions,
          dataPoints,
          lastAnalyzedAt,
          avgConfidence,
          sentimentPriceCorrelation,
          hasData
        });
        
      } catch (error) {
        console.error(`Error processing ticker ${ticker}:`, error);
        // Return minimal data on error
        results.push({
          ticker,
          avgSentiment: 0,
          priceChangePercent: 0,
          totalMentions: 0,
          dataPoints: 0,
          lastAnalyzedAt: null,
          avgConfidence: 0,
          sentimentPriceCorrelation: null,
          hasData: false
        });
      }
    }
    
    // Sort by totalMentions descending
    results.sort((a, b) => b.totalMentions - a.totalMentions);
    
    // Apply limit if specified
    if (limit && limit > 0) {
      return results.slice(0, limit);
    }
    
    return results;
  }
  
  /**
   * Get trading statistics from database for bot startup
   */
  async getTradingStatsFromDB(): Promise<{
    totalItemsProcessed: number;
    totalTradesExecuted: number;
    successfulTrades: number;
    failedTrades: number;
    totalProfitLoss: number;
  }> {
    if (!this.db) throw new Error('Database not initialized');

    const tradeStats = await this.db.get(`
      SELECT 
        COUNT(*) as total_trades,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        COALESCE(SUM(pnl_usd), 0) as total_pnl
      FROM trade_performance
    `);

    // Count unique processed Reddit items
    const itemsProcessed = await this.db.get(`
      SELECT COUNT(DISTINCT reddit_id) as total_items
      FROM processed_content
    `);

    return {
      totalItemsProcessed: itemsProcessed.total_items || 0,
      totalTradesExecuted: tradeStats.total_trades || 0,
      successfulTrades: tradeStats.successful || 0,
      failedTrades: tradeStats.failed || 0,
      totalProfitLoss: tradeStats.total_pnl || 0
    };
  }

  /**
   * Save a pending trade to database
   */
  async savePendingTrade(pendingTrade: any): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run(`
      INSERT OR REPLACE INTO pending_trades (
        id, signal_data, source_item_data, market_data, market_trend_data,
        sentiment_data, status, created_at, expires_at, processed_at, approval_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      pendingTrade.id,
      JSON.stringify(pendingTrade.signal),
      JSON.stringify(pendingTrade.sourceItem),
      pendingTrade.marketData ? JSON.stringify(pendingTrade.marketData) : null,
      pendingTrade.marketTrend ? JSON.stringify(pendingTrade.marketTrend) : null,
      JSON.stringify(pendingTrade.sentiment),
      pendingTrade.status,
      pendingTrade.createdAt,
      pendingTrade.expiresAt,
      pendingTrade.processed_at || null,
      pendingTrade.approval_reason || null
    ]);
  }

  /**
   * Load active pending trades from database
   */
  async loadPendingTrades(): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');

    const now = Date.now();
    const rows = await this.db.all(`
      SELECT * FROM pending_trades
      WHERE status = 'pending' AND expires_at > ?
      ORDER BY created_at DESC
    `, [now]);

    return rows.map(row => ({
      id: row.id,
      signal: JSON.parse(row.signal_data),
      sourceItem: JSON.parse(row.source_item_data),
      marketData: row.market_data ? JSON.parse(row.market_data) : null,
      marketTrend: row.market_trend_data ? JSON.parse(row.market_trend_data) : null,
      sentiment: JSON.parse(row.sentiment_data),
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at
    }));
  }

  /**
   * Update pending trade status in database
   */
  async updatePendingTradeStatus(tradeId: string, status: string, reason?: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run(`
      UPDATE pending_trades 
      SET status = ?, processed_at = ?, approval_reason = ?
      WHERE id = ?
    `, [status, Date.now(), reason || null, tradeId]);
  }

  /**
   * Save market price snapshot
   */
  async saveMarketSnapshot(snapshot: MarketSnapshot): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run(`
      INSERT INTO market_snapshots (
        id, ticker, price, volume_24h, market_cap, timestamp, source, processed_content_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      snapshot.id,
      snapshot.ticker,
      snapshot.price,
      snapshot.volume_24h || null,
      snapshot.market_cap || null,
      snapshot.timestamp,
      snapshot.source,
      snapshot.processed_content_id || null
    ]);
  }

  /**
   * Update future prices for processed content (1h and 24h later)
   */
  async updateFuturePrices(contentId: string, price_1h?: number, price_24h?: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const content = await this.db.get(
      'SELECT price_at_analysis FROM processed_content WHERE id = ?',
      [contentId]
    );

    if (!content || !content.price_at_analysis) return;

    const updates: string[] = [];
    const params: any[] = [];

    if (price_1h !== undefined) {
      updates.push('price_1h_later = ?', 'price_change_1h = ?');
      params.push(price_1h, ((price_1h - content.price_at_analysis) / content.price_at_analysis) * 100);
    }

    if (price_24h !== undefined) {
      updates.push('price_24h_later = ?', 'price_change_24h = ?');
      params.push(price_24h, ((price_24h - content.price_at_analysis) / content.price_at_analysis) * 100);
    }

    if (updates.length === 0) return;

    params.push(contentId);

    await this.db.run(
      `UPDATE processed_content SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
  }

  /**
   * Check if a ticker is disabled
   */
  async isTickerDisabled(ticker: string): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.get(
      'SELECT ticker FROM disabled_tickers WHERE ticker = ?',
      [ticker.toUpperCase()]
    );

    return !!result;
  }

  /**
   * Disable a ticker
   */
  async disableTicker(ticker: string, reason?: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run(
      'INSERT OR REPLACE INTO disabled_tickers (ticker, disabled_at, reason) VALUES (?, ?, ?)',
      [ticker.toUpperCase(), Date.now(), reason || null]
    );
  }

  /**
   * Enable a ticker (remove from disabled list)
   */
  async enableTicker(ticker: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run(
      'DELETE FROM disabled_tickers WHERE ticker = ?',
      [ticker.toUpperCase()]
    );
  }

  /**
   * Get all disabled tickers
   */
  async getDisabledTickers(): Promise<string[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = await this.db.all(
      'SELECT ticker FROM disabled_tickers ORDER BY ticker'
    );

    return rows.map(row => row.ticker);
  }

  // ===================== MANAGED SUBREDDITS METHODS =====================

  /**
   * Get active (enabled) subreddits for streaming
   */
  async getActiveSubreddits(): Promise<string[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = await this.db.all(
      'SELECT subreddit FROM managed_subreddits WHERE enabled = 1 ORDER BY subreddit'
    );

    return rows.map(row => row.subreddit);
  }

  /**
   * Get all managed subreddits with full details
   */
  async getAllManagedSubreddits(): Promise<Array<{
    subreddit: string;
    enabled: boolean;
    added_at: number;
    last_post_count: number;
    last_checked: number | null;
    is_crypto_focused: boolean;
  }>> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = await this.db.all(
      'SELECT * FROM managed_subreddits ORDER BY subreddit'
    );

    return rows.map(row => ({
      subreddit: row.subreddit,
      enabled: row.enabled === 1,
      added_at: row.added_at,
      last_post_count: row.last_post_count,
      last_checked: row.last_checked,
      is_crypto_focused: row.is_crypto_focused === 1
    }));
  }

  /**
   * Add a new subreddit to managed list
   */
  async addSubreddit(name: string, isCryptoFocused: boolean = false): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const normalized = this.normalizeSubredditName(name);
    
    if (!normalized) {
      throw new Error('Invalid subreddit name');
    }

    // Validate name format
    if (!normalized.match(/^[A-Za-z0-9][A-Za-z0-9_]{2,20}$/)) {
      throw new Error('Subreddit name must be 3-21 characters, alphanumeric and underscores only');
    }

    try {
      await this.db.run(`
        INSERT INTO managed_subreddits (
          subreddit, enabled, added_at, last_post_count, last_checked, is_crypto_focused
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [normalized, 1, Date.now(), 0, null, isCryptoFocused ? 1 : 0]);
    } catch (error: any) {
      if (error.message && error.message.includes('UNIQUE constraint failed')) {
        throw new Error(`Subreddit r/${normalized} is already being monitored`);
      }
      throw error;
    }
  }

  /**
   * Remove a subreddit from managed list
   */
  async removeSubreddit(name: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const normalized = this.normalizeSubredditName(name);
    
    const result = await this.db.run(
      'DELETE FROM managed_subreddits WHERE subreddit = ?',
      [normalized]
    );

    if (result.changes === 0) {
      throw new Error(`Subreddit r/${normalized} not found`);
    }
  }

  /**
   * Enable a subreddit for monitoring
   */
  async enableSubreddit(name: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const normalized = this.normalizeSubredditName(name);
    
    const result = await this.db.run(
      'UPDATE managed_subreddits SET enabled = 1 WHERE subreddit = ?',
      [normalized]
    );

    if (result.changes === 0) {
      throw new Error(`Subreddit r/${normalized} not found`);
    }
  }

  /**
   * Disable a subreddit from monitoring
   */
  async disableSubreddit(name: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const normalized = this.normalizeSubredditName(name);
    
    const result = await this.db.run(
      'UPDATE managed_subreddits SET enabled = 0 WHERE subreddit = ?',
      [normalized]
    );

    if (result.changes === 0) {
      throw new Error(`Subreddit r/${normalized} not found`);
    }
  }

  /**
   * Update subreddit stats after processing
   */
  async updateSubredditStats(name: string, postCount: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const normalized = this.normalizeSubredditName(name);
    
    await this.db.run(`
      UPDATE managed_subreddits 
      SET last_post_count = ?, last_checked = ?
      WHERE subreddit = ?
    `, [postCount, Date.now(), normalized]);
  }

  /**
   * Get suggested subreddits based on mentions in processed content
   */
  async getSuggestedSubreddits(limit: number = 10): Promise<Array<{
    subreddit: string;
    mentionCount: number;
    samplePosts: string[];
    inferredCryptoFocus: boolean;
  }>> {
    if (!this.db) throw new Error('Database not initialized');

    // Check cache
    if (this.suggestionsCache && Date.now() - this.suggestionsCache.timestamp < this.suggestionsCacheTTL) {
      return this.suggestionsCache.data.slice(0, limit);
    }

    console.log('🔍 Generating subreddit suggestions from processed content...');

    // Get recent content from last 30 days or last 10k items
    const cutoffTime = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentContent = await this.db.all(`
      SELECT id, subreddit, title, content, processing_timestamp
      FROM processed_content
      WHERE processing_timestamp >= ?
      ORDER BY processing_timestamp DESC
      LIMIT 10000
    `, [cutoffTime]);

    if (recentContent.length === 0) {
      this.suggestionsCache = { data: [], timestamp: Date.now() };
      return [];
    }

    // Get already managed subreddits to filter out
    const managedSubreddits = new Set(await this.getActiveSubreddits());
    const allManaged = await this.db.all('SELECT subreddit FROM managed_subreddits');
    allManaged.forEach(row => managedSubreddits.add(row.subreddit));

    // Crypto keywords for filtering
    const cryptoKeywords = [
      'bitcoin', 'btc', 'crypto', 'cryptocurrency', 'ethereum', 'eth',
      'altcoin', 'defi', 'blockchain', 'trading', 'invest', 'finance',
      'coin', 'token', 'nft', 'web3', 'satoshi', 'hodl'
    ];

    // Extract subreddit mentions using regex
    // Pattern: r/SubredditName or /r/SubredditName
    const mentionPattern = /(?:^|[\s(])(?:r\/|\/r\/)([A-Za-z0-9][A-Za-z0-9_]{2,20})(?=[\s),.\/]|$)/gi;
    
    const mentions = new Map<string, { count: number; samples: Set<string>; contexts: string[] }>();

    for (const item of recentContent) {
      const text = `${item.title || ''} ${item.content || ''}`;
      const matches = [...text.matchAll(mentionPattern)];

      for (const match of matches) {
        const subreddit = match[1].toLowerCase();
        
        // Skip if already managed or is current subreddit
        if (managedSubreddits.has(subreddit) || subreddit === item.subreddit.toLowerCase()) {
          continue;
        }

        // Extract context around the mention (50 chars before and after)
        const matchIndex = match.index || 0;
        const contextStart = Math.max(0, matchIndex - 50);
        const contextEnd = Math.min(text.length, matchIndex + match[0].length + 50);
        const context = text.substring(contextStart, contextEnd).trim();

        if (!mentions.has(subreddit)) {
          mentions.set(subreddit, { count: 0, samples: new Set(), contexts: [] });
        }

        const entry = mentions.get(subreddit)!;
        entry.count++;
        
        if (item.title && entry.samples.size < 3) {
          entry.samples.add(item.title);
        }
        
        if (entry.contexts.length < 5) {
          entry.contexts.push(context);
        }
      }
    }

    // Filter and rank suggestions
    const suggestions = Array.from(mentions.entries())
      .map(([subreddit, data]) => {
        // Check if crypto-focused based on context analysis
        const allContexts = data.contexts.join(' ').toLowerCase();
        const inferredCryptoFocus = cryptoKeywords.some(keyword => 
          allContexts.includes(keyword) || subreddit.includes(keyword)
        );

        return {
          subreddit,
          mentionCount: data.count,
          samplePosts: Array.from(data.samples).slice(0, 3),
          inferredCryptoFocus
        };
      })
      // Filter to crypto-focused only
      .filter(s => s.inferredCryptoFocus)
      // Sort by mention count descending
      .sort((a, b) => b.mentionCount - a.mentionCount);

    // Cache the results
    this.suggestionsCache = { data: suggestions, timestamp: Date.now() };

    console.log(`✅ Found ${suggestions.length} suggested subreddits (showing top ${limit})`);

    return suggestions.slice(0, limit);
  }

  /**
   * Invalidate suggestions cache (call when new content is processed)
   */
  invalidateSuggestionsCache(): void {
    this.suggestionsCache = null;
  }

  /**
   * Get processing statistics for cost optimization monitoring
   */
  async getProcessingStats(): Promise<{
    totalProcessed: number;
    totalTokensUsed: number;
    totalTokensSaved: number;
    avgConfidence: number;
    topTickers: Array<{ ticker: string; mentions: number }>;
  }> {
    if (!this.db) throw new Error('Database not initialized');

    const totalProcessed = await this.db.get(`SELECT COUNT(*) as count FROM processed_content`);
    
    const tokenStats = await this.db.get(`
      SELECT 
        SUM(reuse_count) as total_saved,
        AVG(confidence_level) as avg_confidence
      FROM processed_content
    `);

    // Get top mentioned tickers
    const tickerRows = await this.db.all(`
      SELECT ticker, mention_count as mentions 
      FROM currency_watchlist 
      ORDER BY mention_count DESC 
      LIMIT 10
    `);

    return {
      totalProcessed: totalProcessed.count || 0,
      totalTokensUsed: 0, // We don't track individual token usage in this service
      totalTokensSaved: tokenStats.total_saved || 0,
      avgConfidence: tokenStats.avg_confidence || 0,
      topTickers: tickerRows || []
    };
  }

  /**
   * Clean up old data to manage database size
   */
  async cleanup(daysToKeep: number = 30): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    
    await this.db.run(
      'DELETE FROM processed_content WHERE processing_timestamp < ?',
      [cutoffTime]
    );

    await this.db.run(
      'DELETE FROM trade_performance WHERE executed_at < ? AND status != "pending"',
      [cutoffTime]
    );

    console.log(`🧹 Cleaned up data older than ${daysToKeep} days`);
  }

  /**
   * Get sentiment vs price correlation data for visualization
   */
  async getSentimentPriceCorrelation(options: {
    tickers: string[];
    startTime: number;
    endTime: number;
    interval: 'hourly' | 'daily';
    baseCurrency: 'USD' | 'BTC';
  }): Promise<any> {
    if (!this.db) throw new Error('Database not initialized');
    
    const { tickers, startTime, endTime, interval, baseCurrency } = options;
    
    // Helper to create time buckets
    const getBucketStart = (timestamp: number): number => {
      const date = new Date(timestamp);
      if (interval === 'hourly') {
        date.setMinutes(0, 0, 0);
      } else {
        date.setHours(0, 0, 0, 0);
      }
      return date.getTime();
    };
    
    // Query sentiment data
    const placeholders = tickers.map(() => '?').join(',');
    const sentimentRows = await this.db.all(`
      SELECT 
        extracted_tickers,
        processing_timestamp,
        sentiment_score,
        confidence_level
      FROM processed_content
      WHERE processing_timestamp >= ? AND processing_timestamp <= ?
      ORDER BY processing_timestamp ASC
    `, [startTime, endTime]);
    
    // Query market snapshots
    const priceRows = await this.db.all(`
      SELECT 
        ticker,
        timestamp,
        price
      FROM market_snapshots
      WHERE ticker IN (${placeholders})
        AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `, [...tickers.map(t => t.toUpperCase()), startTime, endTime]);
    
    // Query trade signals
    const tradeRows = await this.db.all(`
      SELECT 
        ticker,
        executed_at,
        action,
        reasoning
      FROM trade_performance
      WHERE ticker IN (${placeholders})
        AND executed_at >= ? AND executed_at <= ?
      ORDER BY executed_at ASC
    `, [...tickers.map(t => t.toUpperCase()), startTime, endTime]);
    
    // Define bucket data structure
    interface SentimentBucket {
      scores: number[];
      confidences: number[];
      count: number;
    }
    
    // Organize sentiment data by ticker and bucket
    const sentimentByTickerBucket = new Map<string, Map<number, SentimentBucket>>();
    
    for (const row of sentimentRows) {
      const extractedTickers = JSON.parse(row.extracted_tickers || '[]');
      const bucketStart = getBucketStart(row.processing_timestamp);
      
      for (const ticker of extractedTickers) {
        if (!tickers.includes(ticker.toUpperCase())) continue;
        
        if (!sentimentByTickerBucket.has(ticker)) {
          sentimentByTickerBucket.set(ticker, new Map());
        }
        
        const bucketMap = sentimentByTickerBucket.get(ticker)!;
        if (!bucketMap.has(bucketStart)) {
          bucketMap.set(bucketStart, { scores: [], confidences: [], count: 0 });
        }
        
        const bucket = bucketMap.get(bucketStart)!;
        bucket.scores.push(row.sentiment_score);
        bucket.confidences.push(row.confidence_level);
        bucket.count++;
      }
    }
    
    // Organize price data by ticker and bucket
    const priceByTickerBucket = new Map<string, Map<number, number[]>>();
    
    for (const row of priceRows) {
      const bucketStart = getBucketStart(row.timestamp);
      
      if (!priceByTickerBucket.has(row.ticker)) {
        priceByTickerBucket.set(row.ticker, new Map());
      }
      
      const bucketMap = priceByTickerBucket.get(row.ticker)!;
      if (!bucketMap.has(bucketStart)) {
        bucketMap.set(bucketStart, []);
      }
      
      bucketMap.get(bucketStart)!.push(row.price);
    }
    
    // Organize trade signals by ticker and timestamp
    const tradesByTicker = new Map<string, Array<{ timestamp: number; action: string; reasoning: string }>>();
    
    for (const row of tradeRows) {
      if (!tradesByTicker.has(row.ticker)) {
        tradesByTicker.set(row.ticker, []);
      }
      tradesByTicker.get(row.ticker)!.push({
        timestamp: row.executed_at,
        action: row.action.toUpperCase(),
        reasoning: row.reasoning
      });
    }
    
    // Get BTC price history if needed
    let btcPriceHistory: Array<{ timestamp: number; priceUSD: number }> = [];
    if (baseCurrency === 'BTC') {
      const btcRows = await this.db.all(`
        SELECT timestamp, price
        FROM market_snapshots
        WHERE ticker = 'BTC' 
          AND timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp ASC
      `, [startTime, endTime]);
      
      btcPriceHistory = btcRows.map(row => ({
        timestamp: row.timestamp,
        priceUSD: row.price
      }));
    }
    
    // Helper to find closest BTC price
    const findClosestBTCPrice = (timestamp: number): number | null => {
      if (btcPriceHistory.length === 0) return null;
      
      let closest = btcPriceHistory[0];
      let minDiff = Math.abs(timestamp - closest.timestamp);
      
      for (const entry of btcPriceHistory) {
        const diff = Math.abs(timestamp - entry.timestamp);
        if (diff < minDiff) {
          minDiff = diff;
          closest = entry;
        }
      }
      
      // Only return if within reasonable time window (1 day)
      if (minDiff < 24 * 60 * 60 * 1000) {
        return closest.priceUSD;
      }
      return null;
    };
    
    // Build data points for each ticker
    const result: any = {
      tickers: {},
      btcPriceHistory,
      timeRange: {
        start: startTime,
        end: endTime,
        interval
      },
      timestamp: new Date().toISOString()
    };
    
    for (const ticker of tickers) {
      const tickerUpper = ticker.toUpperCase();
      const sentimentBuckets = sentimentByTickerBucket.get(tickerUpper) || new Map();
      const priceBuckets = priceByTickerBucket.get(tickerUpper) || new Map();
      const trades = tradesByTicker.get(tickerUpper) || [];
      
      // Get all unique bucket timestamps
      const allBuckets = new Set<number>();
      sentimentBuckets.forEach((_, bucket) => allBuckets.add(bucket));
      priceBuckets.forEach((_, bucket) => allBuckets.add(bucket));
      
      const sortedBuckets = Array.from(allBuckets).sort((a, b) => a - b);
      
      const dataPoints: any[] = [];
      let totalSentiment = 0;
      let totalMentions = 0;
      let sentimentCount = 0;
      const prices: number[] = [];
      
      for (const bucketStart of sortedBuckets) {
        const sentimentData = sentimentBuckets.get(bucketStart);
        const priceData = priceBuckets.get(bucketStart);
        
        // Calculate averages
        let avgSentiment = 0;
        let avgConfidence = 0;
        let mentionCount = 0;
        
        if (sentimentData) {
          avgSentiment = sentimentData.scores.reduce((a: number, b: number) => a + b, 0) / sentimentData.scores.length;
          avgConfidence = sentimentData.confidences.reduce((a: number, b: number) => a + b, 0) / sentimentData.confidences.length;
          mentionCount = sentimentData.count;
          
          // Clamp sentiment to [-1, 1]
          avgSentiment = Math.max(-1, Math.min(1, avgSentiment));
          
          totalSentiment += avgSentiment;
          totalMentions += mentionCount;
          sentimentCount++;
        }
        
        let priceUSD: number | null = null;
        if (priceData && priceData.length > 0) {
          // Use average price for the bucket
          priceUSD = priceData.reduce((a: number, b: number) => a + b, 0) / priceData.length;
          prices.push(priceUSD);
        }
        
        // Convert to BTC if needed
        let priceBTC: number | null = null;
        if (baseCurrency === 'BTC' && priceUSD !== null) {
          if (tickerUpper === 'BTC') {
            priceBTC = 1.0;
          } else {
            const btcPrice = findClosestBTCPrice(bucketStart);
            if (btcPrice) {
              priceBTC = priceUSD / btcPrice;
            }
          }
        }
        
        // Find trade signal for this bucket
        const tradeSignal = trades.find(t => {
          const tradeBucket = getBucketStart(t.timestamp);
          return tradeBucket === bucketStart;
        });
        
        // Only include data points where we have sentiment or price data
        if (sentimentData || priceData) {
          dataPoints.push({
            timestamp: bucketStart,
            sentimentScore: sentimentData ? avgSentiment : null,
            confidence: sentimentData ? avgConfidence : null,
            mentionCount: mentionCount,
            priceUSD,
            priceBTC,
            tradeSignal: tradeSignal ? {
              action: tradeSignal.action as 'BUY' | 'SELL',
              reasoning: tradeSignal.reasoning
            } : undefined
          });
        }
      }
      
      // Calculate summary statistics
      const avgSentiment = sentimentCount > 0 ? totalSentiment / sentimentCount : 0;
      
      let priceChangePercent = 0;
      if (prices.length >= 2) {
        const firstPrice = prices[0];
        const lastPrice = prices[prices.length - 1];
        priceChangePercent = ((lastPrice - firstPrice) / firstPrice) * 100;
      }
      
      // Calculate Pearson correlation
      let correlation: number | null = null;
      const validPairs: Array<{ sentiment: number; priceReturn: number }> = [];
      
      for (let i = 1; i < dataPoints.length; i++) {
        const current = dataPoints[i];
        const previous = dataPoints[i - 1];
        
        if (current.sentimentScore !== null && 
            current.priceUSD !== null && 
            previous.priceUSD !== null && 
            previous.priceUSD > 0) {
          
          const priceToUse = baseCurrency === 'BTC' && current.priceBTC !== null && previous.priceBTC !== null
            ? current.priceBTC / previous.priceBTC
            : current.priceUSD / previous.priceUSD;
          
          const priceReturn = Math.log(priceToUse);
          validPairs.push({ sentiment: current.sentimentScore, priceReturn });
        }
      }
      
      if (validPairs.length >= 3) {
        correlation = this.calculateCorrelation(
          validPairs.map(p => p.sentiment),
          validPairs.map(p => p.priceReturn)
        );
      }
      
      result.tickers[tickerUpper] = {
        dataPoints,
        summary: {
          avgSentiment,
          priceChangePercent,
          totalMentions,
          sentimentPriceCorrelation: correlation
        }
      };
    }
    
    return result;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
}

// Export singleton instance
export const dataStorageService = new DataStorageService();
