import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { config } from '../config';
import { MarketData, MarketTrend, TradeOrder, TradeResult, TokenMetricsAPIError } from '../types';

/**
 * TokenMetrics API Client
 * Handles market data fetching and trade execution through TokenMetrics API
 */
export class TokenMetricsClient {
  private client: AxiosInstance;
  private apiKey: string;
  private baseURL: string;

  constructor() {
    this.apiKey = config.tokenmetrics.apiKey;
    this.baseURL = config.tokenmetrics.baseUrl;
    
    // Check if we're in development mode
    const isDev = process.env.SKIP_CONFIG_VALIDATION === 'true' || 
                 this.apiKey.startsWith('placeholder_');
    
    if (isDev) {
      console.log('⚠️  Running TokenMetrics client in development mode with mock data');
    }
    
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'CPTO/1.0'
      }
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          throw new TokenMetricsAPIError(
            `TokenMetrics API Error: ${error.response.status} - ${error.response.data?.message || error.message}`,
            {
              status: error.response.status,
              data: error.response.data,
              url: error.config?.url
            }
          );
        } else if (error.request) {
          throw new TokenMetricsAPIError(
            'TokenMetrics API: No response received',
            { error: error.message }
          );
        } else {
          throw new TokenMetricsAPIError(
            `TokenMetrics API Error: ${error.message}`,
            { error }
          );
        }
      }
    );

    console.log('TokenMetrics client initialized');
  }

  /**
   * Get current price and basic market data for a ticker
   */
  public async getPrice(ticker: string): Promise<MarketData> {
    // Return mock data in development mode
    if (this.apiKey.startsWith('placeholder_') || process.env.SKIP_CONFIG_VALIDATION === 'true') {
      return this.getMockMarketData(ticker);
    }
    
    try {
      const response: AxiosResponse = await this.client.get(`/v1/price/${ticker.toUpperCase()}`);
      
      return this.formatMarketData(ticker, response.data);
    } catch (error) {
      throw new TokenMetricsAPIError(`Failed to get price for ${ticker}`, { ticker, error });
    }
  }

  /**
   * Get detailed market data for a ticker
   */
  public async getMarketData(ticker: string): Promise<MarketData> {
    // Return mock data in development mode
    if (this.apiKey.startsWith('placeholder_') || process.env.SKIP_CONFIG_VALIDATION === 'true') {
      return this.getMockMarketData(ticker);
    }
    
    try {
      const response: AxiosResponse = await this.client.get(`/v1/market-data/${ticker.toUpperCase()}`);
      
      return this.formatMarketData(ticker, response.data);
    } catch (error) {
      throw new TokenMetricsAPIError(`Failed to get market data for ${ticker}`, { ticker, error });
    }
  }

  /**
   * Get market trends and technical indicators for a ticker
   */
  public async getMarketTrends(ticker: string): Promise<MarketTrend> {
    // Return mock data in development mode
    if (this.apiKey.startsWith('placeholder_') || process.env.SKIP_CONFIG_VALIDATION === 'true') {
      return this.getMockMarketTrend(ticker);
    }
    
    try {
      const response: AxiosResponse = await this.client.get(`/v1/trends/${ticker.toUpperCase()}`);
      
      return this.formatMarketTrend(ticker, response.data);
    } catch (error) {
      throw new TokenMetricsAPIError(`Failed to get market trends for ${ticker}`, { ticker, error });
    }
  }

  /**
   * Execute a trade order
   */
  public async executeTrade(order: TradeOrder): Promise<TradeResult> {
    // Return mock data in development mode (simulate successful trade)
    if (this.apiKey.startsWith('placeholder_') || process.env.SKIP_CONFIG_VALIDATION === 'true') {
      console.log(`🎭 Mock trade executed: ${order.side.toUpperCase()} ${order.ticker} for $${order.amount_usd}`);
      return {
        order_id: `mock_order_${Date.now()}`,
        ticker: order.ticker.toUpperCase(),
        side: order.side,
        amount_usd: order.amount_usd,
        executed_price: 50000 + Math.random() * 10000, // Mock price
        fees: order.amount_usd * 0.001, // 0.1% fee
        status: 'completed' as const,
        timestamp: Date.now()
      };
    }
    
    try {
      const payload = {
        symbol: order.ticker.toUpperCase(),
        side: order.side,
        type: order.order_type,
        quantity: await this.calculateQuantity(order.amount_usd, order.ticker),
        price: order.limit_price,
        time_in_force: 'GTC' // Good Till Cancelled
      };

      const response: AxiosResponse = await this.client.post('/v1/orders', payload);
      
      return this.formatTradeResult(response.data);
    } catch (error) {
      throw new TokenMetricsAPIError(`Failed to execute trade for ${order.ticker}`, { order, error });
    }
  }

  /**
   * Get order status
   */
  public async getOrderStatus(orderId: string): Promise<TradeResult> {
    try {
      const response: AxiosResponse = await this.client.get(`/v1/orders/${orderId}`);
      
      return this.formatTradeResult(response.data);
    } catch (error) {
      throw new TokenMetricsAPIError(`Failed to get order status for ${orderId}`, { orderId, error });
    }
  }

  /**
   * Get account balance
   */
  public async getAccountBalance(): Promise<any> {
    try {
      const response: AxiosResponse = await this.client.get('/v1/account/balance');
      
      return response.data;
    } catch (error) {
      throw new TokenMetricsAPIError('Failed to get account balance', { error });
    }
  }

  /**
   * Get trading history
   */
  public async getTradingHistory(limit: number = 50): Promise<TradeResult[]> {
    try {
      const response: AxiosResponse = await this.client.get('/v1/orders/history', {
        params: { limit }
      });
      
      return response.data.map((trade: any) => this.formatTradeResult(trade));
    } catch (error) {
      throw new TokenMetricsAPIError('Failed to get trading history', { error });
    }
  }

  /**
   * Get top crypto currencies by market cap
   */
  public async getTopCryptos(limit: number = 100): Promise<MarketData[]> {
    try {
      const response: AxiosResponse = await this.client.get('/v1/top-cryptos', {
        params: { limit }
      });
      
      return response.data.map((crypto: any) => 
        this.formatMarketData(crypto.symbol, crypto)
      );
    } catch (error) {
      throw new TokenMetricsAPIError('Failed to get top cryptos', { error });
    }
  }

  /**
   * Search for crypto tickers by name or symbol
   */
  public async searchCryptos(query: string): Promise<any[]> {
    try {
      const response: AxiosResponse = await this.client.get('/v1/search', {
        params: { q: query }
      });
      
      return response.data.results || [];
    } catch (error) {
      throw new TokenMetricsAPIError(`Failed to search for cryptos: ${query}`, { query, error });
    }
  }

  /**
   * Get API status and rate limit information
   */
  public async getAPIStatus(): Promise<any> {
    try {
      const response: AxiosResponse = await this.client.get('/v1/status');
      
      return response.data;
    } catch (error) {
      throw new TokenMetricsAPIError('Failed to get API status', { error });
    }
  }

  /**
   * Format raw market data to our MarketData interface
   */
  private formatMarketData(ticker: string, data: any): MarketData {
    return {
      ticker: ticker.toUpperCase(),
      price: parseFloat(data.price || data.last_price || 0),
      volume_24h: parseFloat(data.volume_24h || data.volume || 0),
      market_cap: parseFloat(data.market_cap || 0),
      price_change_24h: parseFloat(data.price_change_24h || data.change_24h || 0),
      price_change_percentage_24h: parseFloat(data.price_change_percentage_24h || data.change_percentage_24h || 0),
      timestamp: Date.now()
    };
  }

  /**
   * Format raw trend data to our MarketTrend interface
   */
  private formatMarketTrend(ticker: string, data: any): MarketTrend {
    // Determine trend based on various indicators
    let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.5;

    if (data.trend_signal) {
      const lowerTrend = data.trend_signal.toLowerCase();
      if (['bullish', 'bearish', 'neutral'].includes(lowerTrend)) {
        trend = lowerTrend as 'bullish' | 'bearish' | 'neutral';
      }
      confidence = data.confidence || 0.5;
    } else {
      // Calculate trend based on price movement and indicators
      const priceChange = data.price_change_percentage_24h || 0;
      const rsi = data.rsi || 50;
      
      if (priceChange > 5 && rsi < 70) {
        trend = 'bullish';
        confidence = Math.min(0.8, (priceChange + (70 - rsi)) / 100);
      } else if (priceChange < -5 && rsi > 30) {
        trend = 'bearish';
        confidence = Math.min(0.8, Math.abs(priceChange + (rsi - 30)) / 100);
      }
    }

    return {
      ticker: ticker.toUpperCase(),
      trend,
      confidence: Math.max(0.1, Math.min(1.0, confidence)),
      indicators: {
        rsi: data.rsi,
        macd: data.macd,
        moving_averages: data.moving_averages ? {
          ma_20: data.moving_averages.ma_20,
          ma_50: data.moving_averages.ma_50,
          ma_200: data.moving_averages.ma_200
        } : undefined
      },
      timestamp: Date.now()
    };
  }

  /**
   * Format raw trade data to our TradeResult interface
   */
  private formatTradeResult(data: any): TradeResult {
    return {
      order_id: data.order_id || data.id || '',
      ticker: data.symbol || data.ticker || '',
      side: data.side || 'buy',
      amount_usd: parseFloat(data.notional || data.amount_usd || 0),
      executed_price: parseFloat(data.executed_price || data.price || 0),
      fees: parseFloat(data.fees || data.commission || 0),
      status: this.mapOrderStatus(data.status || 'pending'),
      timestamp: data.timestamp || Date.now()
    };
  }

  /**
   * Map various order status formats to our standard format
   */
  private mapOrderStatus(status: string): 'completed' | 'pending' | 'failed' {
    const normalizedStatus = status.toLowerCase();
    
    if (['filled', 'complete', 'executed', 'done'].includes(normalizedStatus)) {
      return 'completed';
    } else if (['rejected', 'cancelled', 'failed', 'error'].includes(normalizedStatus)) {
      return 'failed';
    } else {
      return 'pending';
    }
  }

  /**
   * Calculate quantity based on USD amount and current price
   */
  private async calculateQuantity(amountUSD: number, ticker: string): Promise<number> {
    try {
      const marketData = await this.getPrice(ticker);
      return amountUSD / marketData.price;
    } catch (error) {
      // Fallback: return 0 if we can't get price
      console.warn(`Failed to calculate quantity for ${ticker}, using 0:`, error);
      return 0;
    }
  }

  /**
   * Generate mock market data for development
   */
  private getMockMarketData(ticker: string): MarketData {
    const basePrice = ticker === 'BTC' ? 45000 : ticker === 'ETH' ? 2800 : 1.5;
    const randomFactor = 0.9 + Math.random() * 0.2; // ±10% variation
    
    return {
      ticker: ticker.toUpperCase(),
      price: basePrice * randomFactor,
      volume_24h: Math.random() * 1000000000,
      market_cap: Math.random() * 100000000000,
      price_change_24h: (Math.random() - 0.5) * 1000,
      price_change_percentage_24h: (Math.random() - 0.5) * 20,
      timestamp: Date.now()
    };
  }
  
  /**
   * Generate mock market trend data for development
   */
  private getMockMarketTrend(ticker: string): MarketTrend {
    const trends: ('bullish' | 'bearish' | 'neutral')[] = ['bullish', 'bearish', 'neutral'];
    const randomTrend = trends[Math.floor(Math.random() * trends.length)];
    
    return {
      ticker: ticker.toUpperCase(),
      trend: randomTrend,
      confidence: 0.5 + Math.random() * 0.4, // 0.5 to 0.9
      indicators: {
        rsi: 30 + Math.random() * 40, // 30-70
        macd: (Math.random() - 0.5) * 100,
        moving_averages: {
          ma_20: 45000 + Math.random() * 5000,
          ma_50: 44000 + Math.random() * 6000,
          ma_200: 40000 + Math.random() * 8000
        }
      },
      timestamp: Date.now()
    };
  }

  /**
   * Test connection to TokenMetrics API
   */
  public async testConnection(): Promise<boolean> {
    // Always return true in development mode
    if (this.apiKey.startsWith('placeholder_') || process.env.SKIP_CONFIG_VALIDATION === 'true') {
      console.log('🎭 TokenMetrics API connection successful (mock mode)');
      return true;
    }
    
    try {
      await this.getAPIStatus();
      console.log('TokenMetrics API connection successful');
      return true;
    } catch (error) {
      console.error('TokenMetrics API connection failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const tokenMetricsClient = new TokenMetricsClient();