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

    console.log('✅ Database tables created/verified');
  }

  /**
   * Run database migrations to update schema
   */
  private async runMigrations(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Check if reuse_count column exists, if not add it
    const tableInfo = await this.db.all(`PRAGMA table_info(processed_content)`);
    const hasReuseCount = tableInfo.some((col: any) => col.name === 'reuse_count');
    
    if (!hasReuseCount) {
      await this.db.exec(`
        ALTER TABLE processed_content 
        ADD COLUMN reuse_count INTEGER NOT NULL DEFAULT 0;
      `);
      console.log('✅ Added reuse_count column to processed_content table');
    }
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
        processing_timestamp, trade_signal, trade_reasoning, reuse_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      0 // initial reuse_count
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