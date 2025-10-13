import OpenAI from 'openai';
import { config } from '../config';
import { SentimentScore, TradeSignal, MarketData, MarketTrend, OpenAIAPIError } from '../types';

/**
 * AI Service using OpenAI for sentiment analysis and trading decisions
 * Configurable to support different models and providers
 */
export class AIService {
  private openai: OpenAI;
  private model: string;

  constructor() {
    // Check if we're in development mode
    const isDev = process.env.SKIP_CONFIG_VALIDATION === 'true' || 
                 config.openai.apiKey.startsWith('placeholder_');
    
    if (isDev) {
      console.log('⚠️  Running AI Service in development mode with mock responses');
      this.openai = {} as OpenAI; // Mock OpenAI instance
    } else {
      this.openai = new OpenAI({
        apiKey: config.openai.apiKey,
      });
    }
    
    this.model = config.openai.model;
    console.log(`AI Service initialized with model: ${this.model}`);
  }

  /**
   * Analyze sentiment of Reddit text content
   */
  public async analyzeSentiment(text: string, ticker?: string): Promise<SentimentScore> {
    // Return mock sentiment in development mode
    if (config.openai.apiKey.startsWith('placeholder_') || process.env.SKIP_CONFIG_VALIDATION === 'true') {
      return this.getMockSentiment(text, ticker);
    }
    
    try {
      const prompt = this.buildSentimentPrompt(text, ticker);
      
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are an expert cryptocurrency sentiment analyst. Analyze text content from Reddit and return ONLY a valid JSON object with the following structure:
{
  "score": -1.0 to 1.0 (where -1 is extremely negative, 0 is neutral, 1 is extremely positive),
  "magnitude": 0.0 to 1.0 (strength of sentiment regardless of direction),
  "confidence": 0.0 to 1.0 (how confident you are in your analysis),
  "reasoning": "Brief explanation of your analysis"
}`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1, // Low temperature for consistent analysis
        max_completion_tokens: 200,
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new OpenAIAPIError('Empty response from OpenAI');
      }

      // Parse the JSON response
      let sentimentData;
      try {
        sentimentData = JSON.parse(content);
      } catch (parseError) {
        throw new OpenAIAPIError('Failed to parse sentiment response as JSON', { content, parseError });
      }

      // Validate the response structure
      const sentiment: SentimentScore = {
        score: this.clampValue(sentimentData.score || 0, -1, 1),
        magnitude: this.clampValue(sentimentData.magnitude || 0, 0, 1),
        confidence: this.clampValue(sentimentData.confidence || 0, 0, 1),
        reasoning: sentimentData.reasoning || 'No reasoning provided'
      };

      return sentiment;

    } catch (error) {
      if (error instanceof OpenAIAPIError) {
        throw error;
      }
      throw new OpenAIAPIError('Failed to analyze sentiment', { error, text: text.substring(0, 100) });
    }
  }

  /**
   * Generate a trading decision based on sentiment and market data
   */
  public async generateTradeDecision(
    sentimentScore: SentimentScore,
    marketData: MarketData,
    marketTrend?: MarketTrend
  ): Promise<TradeSignal> {
    // Return mock trading decision in development mode
    if (config.openai.apiKey.startsWith('placeholder_') || process.env.SKIP_CONFIG_VALIDATION === 'true') {
      return this.getMockTradeDecision(sentimentScore, marketData, marketTrend);
    }
    
    try {
      const prompt = this.buildTradingDecisionPrompt(sentimentScore, marketData, marketTrend);
      
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are an expert cryptocurrency trading AI. Based on Reddit sentiment analysis and market data, make trading decisions. Return ONLY a valid JSON object with this structure:
{
  "action": "BUY" | "SELL" | "HOLD",
  "ticker": "crypto ticker symbol",
  "confidence": 0.0 to 1.0 (confidence in your decision),
  "amount_usd": dollar amount to trade (within reasonable limits),
  "reasoning": "detailed explanation of your decision",
  "sentiment_score": sentiment score that influenced decision,
  "market_score": your assessment of market conditions (-1 to 1)
}

Trading Rules:
- Only recommend BUY/SELL if confidence > 0.6
- Consider both sentiment and technical indicators
- Factor in risk management
- Limit trades to reasonable amounts based on market conditions
- Be conservative with volatile or uncertain conditions`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.2, // Slightly higher for some creativity in reasoning
        max_completion_tokens: 300,
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new OpenAIAPIError('Empty response from OpenAI trading decision');
      }

      // Parse the JSON response
      let tradeData;
      try {
        tradeData = JSON.parse(content);
      } catch (parseError) {
        throw new OpenAIAPIError('Failed to parse trading decision response as JSON', { content, parseError });
      }

      // Validate and format the response
      const signal: TradeSignal = {
        action: this.validateAction(tradeData.action),
        ticker: (tradeData.ticker || marketData.ticker).toUpperCase(),
        confidence: this.clampValue(tradeData.confidence || 0, 0, 1),
        amount_usd: Math.min(tradeData.amount_usd || config.trading.tradeAmountUsd, config.trading.tradeAmountUsd * 2), // Cap at 2x default
        reasoning: tradeData.reasoning || 'No reasoning provided',
        sentiment_score: sentimentScore.score,
        market_score: this.clampValue(tradeData.market_score || 0, -1, 1),
        timestamp: Date.now()
      };

      return signal;

    } catch (error) {
      if (error instanceof OpenAIAPIError) {
        throw error;
      }
      throw new OpenAIAPIError('Failed to generate trading decision', { error });
    }
  }

  /**
   * Extract cryptocurrency tickers mentioned in text
   */
  public async extractCryptoTickers(text: string): Promise<string[]> {
    // Return mock tickers in development mode
    if (config.openai.apiKey.startsWith('placeholder_') || process.env.SKIP_CONFIG_VALIDATION === 'true') {
      return this.getMockTickers(text);
    }
    
    try {
      const prompt = `Analyze this Reddit text and extract all cryptocurrency ticker symbols mentioned (like BTC, ETH, ADA, etc.). Return only a JSON array of ticker symbols in uppercase, no explanations:

Text: "${text.substring(0, 500)}"`;

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are a cryptocurrency ticker extraction expert. Return only valid JSON arrays of ticker symbols.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_completion_tokens: 100,
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        return [];
      }

      try {
        const tickers = JSON.parse(content);
        return Array.isArray(tickers) ? tickers.filter(t => typeof t === 'string') : [];
      } catch (parseError) {
        console.warn('Failed to parse ticker extraction response:', content);
        return [];
      }

    } catch (error) {
      console.warn('Failed to extract crypto tickers:', error);
      return [];
    }
  }

  /**
   * Summarize multiple Reddit posts/comments for analysis
   */
  public async summarizeRedditContent(texts: string[], ticker: string): Promise<string> {
    try {
      const combinedText = texts.join('\n---\n').substring(0, 4000); // Limit to avoid token limits
      
      const prompt = `Summarize the overall sentiment and key points about ${ticker} from these Reddit posts/comments. Focus on:
1. General sentiment (bullish/bearish/neutral)
2. Key concerns or excitement points
3. Notable technical or fundamental mentions
4. Overall community mood

Reddit Content:
${combinedText}`;

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are a cryptocurrency community sentiment summarizer. Provide concise, objective summaries of Reddit discussions.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_completion_tokens: 250,
      });

      return response.choices[0]?.message?.content?.trim() || 'Unable to generate summary';

    } catch (error) {
      console.warn('Failed to summarize Reddit content:', error);
      return 'Summary generation failed';
    }
  }

  /**
   * Build sentiment analysis prompt
   */
  private buildSentimentPrompt(text: string, ticker?: string): string {
    const tickerContext = ticker ? ` Focus specifically on sentiment toward ${ticker}.` : '';
    return `Analyze the sentiment of this Reddit text about cryptocurrency:${tickerContext}

Text: "${text}"

Consider:
- Explicit positive/negative language
- Implied bullish/bearish sentiment
- Excitement, fear, uncertainty, doubt (FUD)
- Technical analysis mentions
- Price predictions and expectations
- Community mood and confidence`;
  }

  /**
   * Build trading decision prompt
   */
  private buildTradingDecisionPrompt(
    sentiment: SentimentScore,
    market: MarketData,
    trend?: MarketTrend
  ): string {
    const trendInfo = trend ? `
Market Trend Analysis:
- Overall trend: ${trend.trend}
- Trend confidence: ${trend.confidence}
- RSI: ${trend.indicators.rsi || 'N/A'}
- MACD: ${trend.indicators.macd || 'N/A'}` : '';

    return `Make a trading decision for ${market.ticker} based on this data:

Sentiment Analysis:
- Score: ${sentiment.score} (-1 to 1)
- Magnitude: ${sentiment.magnitude}
- Confidence: ${sentiment.confidence}
- Reasoning: ${sentiment.reasoning}

Market Data:
- Current price: $${market.price}
- 24h volume: $${market.volume_24h}
- 24h price change: ${market.price_change_percentage_24h}%
- Market cap: $${market.market_cap}${trendInfo}

Consider:
- Risk/reward ratio
- Current market volatility
- Sentiment alignment with technicals
- Position sizing based on confidence
- Market conditions and liquidity`;
  }

  /**
   * Validate trading action
   */
  private validateAction(action: string): 'BUY' | 'SELL' | 'HOLD' {
    const upperAction = (action || '').toUpperCase();
    if (['BUY', 'SELL', 'HOLD'].includes(upperAction)) {
      return upperAction as 'BUY' | 'SELL' | 'HOLD';
    }
    return 'HOLD'; // Default to HOLD for invalid actions
  }

  /**
   * Clamp a numeric value between min and max
   */
  private clampValue(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value || 0));
  }

  /**
   * Generate mock sentiment for development
   */
  private getMockSentiment(text: string, ticker?: string): SentimentScore {
    const words = text.toLowerCase();
    let score = 0;
    
    // Simple keyword-based mock sentiment
    if (words.includes('moon') || words.includes('bullish') || words.includes('buy')) score += 0.3;
    if (words.includes('crash') || words.includes('bearish') || words.includes('sell')) score -= 0.3;
    if (words.includes('hodl') || words.includes('diamond hands')) score += 0.2;
    if (words.includes('fud') || words.includes('dump')) score -= 0.2;
    
    // Add some randomness
    score += (Math.random() - 0.5) * 0.4;
    score = Math.max(-1, Math.min(1, score));
    
    return {
      score,
      magnitude: Math.abs(score),
      confidence: 0.7 + Math.random() * 0.2,
      reasoning: `Mock sentiment analysis: detected ${score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral'} sentiment in text about ${ticker || 'crypto'}`
    };
  }
  
  /**
   * Generate mock trade decision for development
   */
  private getMockTradeDecision(
    sentimentScore: SentimentScore,
    marketData: MarketData,
    marketTrend?: MarketTrend
  ): TradeSignal {
    // Simple mock decision logic
    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let confidence = 0.5;
    
    if (sentimentScore.score > 0.5 && sentimentScore.confidence > 0.6) {
      action = 'BUY';
      confidence = 0.7;
    } else if (sentimentScore.score < -0.5 && sentimentScore.confidence > 0.6) {
      action = 'SELL';
      confidence = 0.7;
    }
    
    return {
      action,
      ticker: marketData.ticker,
      confidence,
      amount_usd: config.trading.tradeAmountUsd,
      reasoning: `Mock trading decision: ${action} based on sentiment ${sentimentScore.score.toFixed(2)} and market data`,
      sentiment_score: sentimentScore.score,
      market_score: marketTrend?.confidence || 0.5,
      timestamp: Date.now()
    };
  }
  
  /**
   * Generate mock crypto tickers for development
   */
  private getMockTickers(text: string): string[] {
    const commonTickers = ['BTC', 'ETH', 'ADA', 'DOT', 'LINK', 'UNI', 'MATIC'];
    const words = text.toUpperCase();
    const foundTickers: string[] = [];
    
    // Simple pattern matching for common terms
    if (words.includes('BITCOIN') || words.includes('BTC')) foundTickers.push('BTC');
    if (words.includes('ETHEREUM') || words.includes('ETH')) foundTickers.push('ETH');
    if (words.includes('CARDANO') || words.includes('ADA')) foundTickers.push('ADA');
    
    // If no specific matches, return a random ticker
    if (foundTickers.length === 0 && Math.random() > 0.3) {
      foundTickers.push(commonTickers[Math.floor(Math.random() * commonTickers.length)]);
    }
    
    return foundTickers;
  }

  /**
   * Test OpenAI connection
   */
  public async testConnection(): Promise<boolean> {
    // Always return true in development mode
    if (config.openai.apiKey.startsWith('placeholder_') || process.env.SKIP_CONFIG_VALIDATION === 'true') {
      console.log('🎭 OpenAI API connection successful (mock mode)');
      return true;
    }
    
    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: 'You are a test assistant.' },
          { role: 'user', content: 'Respond with: "Connection successful"' }
        ],
        max_completion_tokens: 10,
        temperature: 0
      });

      const content = response.choices[0]?.message?.content?.trim();
      console.log('OpenAI API connection successful');
      return content?.includes('Connection successful') || false;
    } catch (error) {
      console.error('OpenAI API connection failed:', error);
      return false;
    }
  }

  /**
   * Get current model information
   */
  public getModelInfo(): { model: string; provider: string } {
    return {
      model: this.model,
      provider: 'OpenAI'
    };
  }

  /**
   * Update model (for future multi-provider support)
   */
  public setModel(model: string): void {
    this.model = model;
    console.log(`AI Service model updated to: ${model}`);
  }
}

// Export singleton instance
export const aiService = new AIService();