// Reddit-related types
export interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  author: string;
  subreddit: string;
  score: number;
  upvote_ratio: number;
  created_utc: number;
  url: string;
  num_comments: number;
}

export interface RedditComment {
  id: string;
  body: string;
  author: string;
  subreddit: string;
  score: number;
  created_utc: number;
  parent_id: string;
}

export type RedditItem = RedditPost | RedditComment;

// Sentiment analysis types
export interface SentimentScore {
  score: number; // -1 to 1, where -1 is very negative, 1 is very positive
  magnitude: number; // 0 to 1, strength of sentiment
  confidence: number; // 0 to 1, AI confidence in analysis
  reasoning: string; // AI explanation of sentiment
}

// Market data types
export interface MarketData {
  ticker: string;
  price: number;
  volume_24h: number;
  market_cap: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  timestamp: number;
}

export interface MarketTrend {
  ticker: string;
  trend: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  indicators: {
    rsi?: number;
    macd?: number;
    moving_averages?: {
      ma_20: number;
      ma_50: number;
      ma_200: number;
    };
  };
  timestamp: number;
}

// Trading types
export interface TradeSignal {
  action: 'BUY' | 'SELL' | 'HOLD';
  ticker: string;
  confidence: number;
  amount_usd: number;
  reasoning: string;
  sentiment_score: number;
  market_score: number;
  timestamp: number;
}

export interface TradeOrder {
  ticker: string;
  side: 'buy' | 'sell';
  amount_usd: number;
  order_type: 'market' | 'limit';
  limit_price?: number;
}

export interface TradeResult {
  order_id: string;
  ticker: string;
  side: 'buy' | 'sell';
  amount_usd: number;
  executed_price: number;
  fees: number;
  status: 'completed' | 'pending' | 'failed';
  timestamp: number;
}

/**
 * Trading modes for bot operation
 */
export type TradingMode = 'manual' | 'autopilot';

/**
 * Pending trade awaiting manual approval
 */
export interface PendingTrade {
  id: string;
  signal: TradeSignal;
  sourceItem: {
    id: string;
    subreddit: string;
    author: string;
    content: string;
  };
  marketData: any;
  marketTrend: any;
  sentiment: SentimentScore;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
}

/**
 * Trade approval action
 */
export interface TradeApproval {
  tradeId: string;
  action: 'approve' | 'reject';
  reason?: string;
  userId?: string;
}

/**
 * OpenAI API cost tracking types
 */
export interface OpenAIUsageMetrics {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAIApiCall {
  id: string;
  timestamp: number;
  model: string;
  usage: OpenAIUsageMetrics;
  cost_usd: number;
  purpose: string; // e.g., 'sentiment_analysis', 'trade_signal_generation'
  input_length: number;
  output_length: number;
}

export interface OpenAICostSummary {
  total_calls: number;
  total_tokens: number;
  total_cost_usd: number;
  cost_by_model: Record<string, {
    calls: number;
    tokens: number;
    cost_usd: number;
  }>;
  cost_by_purpose: Record<string, {
    calls: number;
    tokens: number;
    cost_usd: number;
  }>;
  period_start: number;
  period_end: number;
}

// Database types
export interface DatabaseRedditItem {
  id: string;
  type: 'post' | 'comment';
  content: string;
  author: string;
  subreddit: string;
  score: number;
  created_at: string;
  processed_at: string;
}

export interface DatabaseSentimentResult {
  id: string;
  reddit_item_id: string;
  sentiment_score: number;
  magnitude: number;
  confidence: number;
  reasoning: string;
  created_at: string;
}

export interface DatabaseMarketSnapshot {
  id: string;
  ticker: string;
  price: number;
  volume_24h: number;
  market_cap: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  created_at: string;
}

export interface DatabaseTrade {
  id: string;
  order_id: string;
  ticker: string;
  side: 'buy' | 'sell';
  amount_usd: number;
  executed_price: number;
  fees: number;
  status: 'completed' | 'pending' | 'failed';
  created_at: string;
}

// Configuration types
export interface AppConfig {
  // Reddit API
  reddit: {
    clientId: string;
    clientSecret: string;
    userAgent: string;
    username: string;
    password: string;
  };
  
  // OpenAI
  openai: {
    apiKey: string;
    model: string;
  };
  
  // TokenMetrics
  tokenmetrics: {
    apiKey: string;
    baseUrl: string;
  };
  
  // Gemini Exchange
  gemini: {
    apiKey: string;
    apiSecret: string;
    baseUrl: string;
    sandboxUrl: string;
    useSandbox: boolean;
  };
  
  // App settings
  app: {
    nodeEnv: string;
    port: number;
    logLevel: string;
  };
  
  // Trading settings
  trading: {
    subreddits: string[];
    sentimentThreshold: number;
    tradeAmountUsd: number;
    maxTradesPerHour: number;
    tradingMode: TradingMode;
    pendingTradeExpiryHours: number;
  };
  
  // Database
  database: {
    path: string;
  };
}

// Logging types
export interface LogContext {
  component: string;
  action?: string;
  reddit_item_id?: string;
  ticker?: string;
  trade_id?: string;
  error?: Error;
  [key: string]: any;
}

// Error types
export class CPTOError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'CPTOError';
  }
}

export class RedditAPIError extends CPTOError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'REDDIT_API_ERROR', context);
    this.name = 'RedditAPIError';
  }
}

export class TokenMetricsAPIError extends CPTOError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'TOKENMETRICS_API_ERROR', context);
    this.name = 'TokenMetricsAPIError';
  }
}

export class OpenAIAPIError extends CPTOError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'OPENAI_API_ERROR', context);
    this.name = 'OpenAIAPIError';
  }
}

export class GeminiAPIError extends CPTOError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'GEMINI_API_ERROR', context);
    this.name = 'GeminiAPIError';
  }
}

export class DatabaseError extends CPTOError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'DATABASE_ERROR', context);
    this.name = 'DatabaseError';
  }
}
