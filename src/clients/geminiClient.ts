import axios, { AxiosInstance, AxiosResponse } from 'axios';
import crypto from 'crypto';
import { config } from '../config';
import { MarketData, TradeOrder, TradeResult, GeminiAPIError } from '../types';

/**
 * Gemini Exchange API Client
 * Handles cryptocurrency trading through Gemini's REST API
 * Supports both sandbox and production environments
 */
export class GeminiClient {
  private client: AxiosInstance;
  private apiKey: string;
  private apiSecret: string;
  private baseURL: string;

  constructor() {
    this.apiKey = config.gemini.apiKey;
    this.apiSecret = config.gemini.apiSecret;
    this.baseURL = config.gemini.useSandbox ? config.gemini.sandboxUrl : config.gemini.baseUrl;
    
    // Check if we're in development mode
    const isDev = process.env.SKIP_CONFIG_VALIDATION === 'true' || 
                 this.apiKey.startsWith('placeholder_');
    
    if (isDev) {
      console.log('⚠️  Running Gemini client in development mode with mock data');
    }
    
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'text/plain',
        'User-Agent': 'CPTO/1.0'
      }
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          const errorMsg = error.response.data?.message || error.response.data?.reason || error.message;
          throw new GeminiAPIError(
            `Gemini API Error: ${error.response.status} - ${errorMsg}`,
            {
              status: error.response.status,
              data: error.response.data,
              url: error.config?.url
            }
          );
        } else if (error.request) {
          throw new GeminiAPIError(
            'Gemini API: No response received',
            { error: error.message }
          );
        } else {
          throw new GeminiAPIError(
            `Gemini API Error: ${error.message}`,
            { error }
          );
        }
      }
    );

    console.log(`Gemini client initialized (${config.gemini.useSandbox ? 'sandbox' : 'production'} mode)`);
  }

  /**
   * Generate authentication headers for private API calls
   */
  private getAuthHeaders(payload: object): Record<string, string> {
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const signature = crypto
      .createHmac('sha384', this.apiSecret)
      .update(encodedPayload)
      .digest('hex');

    return {
      'X-GEMINI-APIKEY': this.apiKey,
      'X-GEMINI-PAYLOAD': encodedPayload,
      'X-GEMINI-SIGNATURE': signature
    };
  }

  /**
   * Get current price and basic market data for a symbol
   */
  public async getPrice(symbol: string): Promise<MarketData> {
    // Return mock data in development mode
    if (this.apiKey.startsWith('placeholder_') || process.env.SKIP_CONFIG_VALIDATION === 'true') {
      return this.getMockMarketData(symbol);
    }
    
    try {
      // Get current ticker data
      const tickerResponse: AxiosResponse = await this.client.get(`/v1/pubticker/${symbol.toLowerCase()}`);
      
      // Get 24hr stats
      const statsResponse: AxiosResponse = await this.client.get(`/v2/ticker/${symbol.toLowerCase()}`);
      
      return this.formatMarketData(symbol, tickerResponse.data, statsResponse.data);
    } catch (error) {
      throw new GeminiAPIError(`Failed to get price for ${symbol}`, { symbol, error });
    }
  }

  /**
   * Get available trading symbols
   */
  public async getSymbols(): Promise<string[]> {
    try {
      const response: AxiosResponse = await this.client.get('/v1/symbols');
      return response.data;
    } catch (error) {
      throw new GeminiAPIError('Failed to get trading symbols', { error });
    }
  }

  /**
   * Execute a trade order
   */
  public async executeTrade(order: TradeOrder): Promise<TradeResult> {
    // Return mock data in development mode
    if (this.apiKey.startsWith('placeholder_') || process.env.SKIP_CONFIG_VALIDATION === 'true') {
      console.log(`🎭 Mock Gemini trade executed: ${order.side.toUpperCase()} ${order.ticker} for $${order.amount_usd}`);
      return {
        order_id: `gemini_mock_${Date.now()}`,
        ticker: order.ticker.toUpperCase(),
        side: order.side,
        amount_usd: order.amount_usd,
        executed_price: 50000 + Math.random() * 10000, // Mock price
        fees: order.amount_usd * 0.0035, // Gemini's 0.35% maker fee
        status: 'completed' as const,
        timestamp: Date.now()
      };
    }
    
    try {
      const marketData = await this.getPrice(order.ticker);
      const quantity = order.amount_usd / marketData.price;
      
      const nonce = Date.now();
      const payload = {
        request: '/v1/order/new',
        nonce: nonce.toString(),
        symbol: order.ticker.toLowerCase(),
        amount: quantity.toString(),
        price: order.limit_price ? order.limit_price.toString() : marketData.price.toString(),
        side: order.side,
        type: order.order_type === 'market' ? 'exchange market' : 'exchange limit',
        options: ['immediate-or-cancel'] // Helps with market orders
      };

      const response: AxiosResponse = await this.client.post('/v1/order/new', '', {
        headers: this.getAuthHeaders(payload)
      });
      
      return this.formatTradeResult(response.data, order.amount_usd);
    } catch (error) {
      throw new GeminiAPIError(`Failed to execute trade for ${order.ticker}`, { order, error });
    }
  }

  /**
   * Get order status
   */
  public async getOrderStatus(orderId: string): Promise<TradeResult> {
    try {
      const nonce = Date.now();
      const payload = {
        request: '/v1/order/status',
        nonce: nonce.toString(),
        order_id: orderId
      };

      const response: AxiosResponse = await this.client.post('/v1/order/status', '', {
        headers: this.getAuthHeaders(payload)
      });
      
      return this.formatTradeResult(response.data);
    } catch (error) {
      throw new GeminiAPIError(`Failed to get order status for ${orderId}`, { orderId, error });
    }
  }

  /**
   * Get account balances
   */
  public async getAccountBalances(): Promise<any> {
    try {
      const nonce = Date.now();
      const payload = {
        request: '/v1/balances',
        nonce: nonce.toString()
      };

      const response: AxiosResponse = await this.client.post('/v1/balances', '', {
        headers: this.getAuthHeaders(payload)
      });
      
      return response.data;
    } catch (error) {
      throw new GeminiAPIError('Failed to get account balances', { error });
    }
  }

  /**
   * Get trading history
   */
  public async getTradingHistory(symbol?: string, limit: number = 50): Promise<TradeResult[]> {
    try {
      const nonce = Date.now();
      const payload: any = {
        request: '/v1/mytrades',
        nonce: nonce.toString(),
        limit_trades: limit
      };

      if (symbol) {
        payload.symbol = symbol.toLowerCase();
      }

      const response: AxiosResponse = await this.client.post('/v1/mytrades', '', {
        headers: this.getAuthHeaders(payload)
      });
      
      return response.data.map((trade: any) => this.formatTradeResult(trade));
    } catch (error) {
      throw new GeminiAPIError('Failed to get trading history', { error });
    }
  }

  /**
   * Cancel an order
   */
  public async cancelOrder(orderId: string): Promise<any> {
    try {
      const nonce = Date.now();
      const payload = {
        request: '/v1/order/cancel',
        nonce: nonce.toString(),
        order_id: orderId
      };

      const response: AxiosResponse = await this.client.post('/v1/order/cancel', '', {
        headers: this.getAuthHeaders(payload)
      });
      
      return response.data;
    } catch (error) {
      throw new GeminiAPIError(`Failed to cancel order ${orderId}`, { orderId, error });
    }
  }

  /**
   * Format raw market data to our MarketData interface
   */
  private formatMarketData(symbol: string, tickerData: any, statsData?: any): MarketData {
    const price = parseFloat(tickerData.last || tickerData.price || 0);
    const volume24h = parseFloat(statsData?.volume?.USD || tickerData.volume?.USD || 0);
    
    return {
      ticker: symbol.toUpperCase(),
      price,
      volume_24h: volume24h,
      market_cap: 0, // Gemini doesn't provide market cap
      price_change_24h: parseFloat(statsData?.change || 0),
      price_change_percentage_24h: parseFloat(statsData?.change || 0) / price * 100,
      timestamp: Date.now()
    };
  }

  /**
   * Format raw trade data to our TradeResult interface
   */
  private formatTradeResult(data: any, amountUsd?: number): TradeResult {
    const executedAmount = parseFloat(data.executed_amount || data.amount || 0);
    const avgPrice = parseFloat(data.avg_execution_price || data.price || 0);
    
    return {
      order_id: data.order_id || data.id || '',
      ticker: (data.symbol || '').toUpperCase(),
      side: data.side || 'buy',
      amount_usd: amountUsd || (executedAmount * avgPrice),
      executed_price: avgPrice,
      fees: parseFloat(data.fee_amount || 0),
      status: this.mapOrderStatus(data.is_live, data.is_cancelled, data.executed_amount),
      timestamp: parseInt(data.timestamp || Date.now()) * (data.timestamp ? 1000 : 1)
    };
  }

  /**
   * Map Gemini order status to our standard format
   */
  private mapOrderStatus(isLive: boolean, isCancelled: boolean, executedAmount: string): 'completed' | 'pending' | 'failed' {
    if (isCancelled) {
      return 'failed';
    } else if (isLive) {
      return 'pending';
    } else if (parseFloat(executedAmount || '0') > 0) {
      return 'completed';
    } else {
      return 'failed';
    }
  }

  /**
   * Generate mock market data for development
   */
  private getMockMarketData(symbol: string): MarketData {
    const symbolUpper = symbol.toUpperCase();
    let basePrice = 1.5;
    
    // Set realistic base prices for popular symbols
    if (symbolUpper.includes('BTC')) basePrice = 45000;
    else if (symbolUpper.includes('ETH')) basePrice = 2800;
    else if (symbolUpper.includes('LTC')) basePrice = 95;
    else if (symbolUpper.includes('BCH')) basePrice = 250;
    
    const randomFactor = 0.95 + Math.random() * 0.1; // ±5% variation
    const price = basePrice * randomFactor;
    
    return {
      ticker: symbolUpper,
      price,
      volume_24h: Math.random() * 10000000,
      market_cap: 0,
      price_change_24h: (Math.random() - 0.5) * price * 0.1,
      price_change_percentage_24h: (Math.random() - 0.5) * 10,
      timestamp: Date.now()
    };
  }

  /**
   * Test connection to Gemini API
   */
  public async testConnection(): Promise<boolean> {
    // Always return true in development mode
    if (this.apiKey.startsWith('placeholder_') || process.env.SKIP_CONFIG_VALIDATION === 'true') {
      console.log('🎭 Gemini API connection successful (mock mode)');
      return true;
    }
    
    try {
      // Test with a simple public API call
      await this.getSymbols();
      console.log('Gemini API connection successful');
      return true;
    } catch (error) {
      console.error('Gemini API connection failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const geminiClient = new GeminiClient();