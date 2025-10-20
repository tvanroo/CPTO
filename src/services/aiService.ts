import OpenAI from 'openai';
import { config } from '../config';
import { SentimentScore, TradeSignal, MarketData, MarketTrend, OpenAIAPIError } from '../types';
import { dataStorageService } from './dataStorageService';

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
   * Track OpenAI API call - just log for monitoring, actual costs tracked via OpenAI billing API
   */
  private trackApiCall(
    response: OpenAI.Chat.Completions.ChatCompletion, 
    purpose: string,
    _inputText: string = '',
    _outputText: string = ''
  ): void {
    const isDev = process.env.SKIP_CONFIG_VALIDATION === 'true' || 
                 config.openai.apiKey.startsWith('placeholder_');
    
    // Only log real API calls, not mock calls
    if (isDev || !response.usage) {
      return;
    }

    // Simple logging for monitoring
    console.log(`📊 OpenAI API call: ${response.model} - ${response.usage.total_tokens} tokens (${purpose})`);
  }

  /**
   * Get model-specific parameters
   */
  private getModelParams(): { supportsTemperature: boolean } {
    // These models don't support custom temperature values - they only accept default (1)
    const modelsWithoutCustomTemp = [
      'gpt-5-nano',    // OpenAI gpt-5-nano
      'gpt-4o-mini',   // OpenAI gpt-4o-mini
      'o4-mini',       // OpenAI o4-mini (alternative naming)
      'o1-mini',       // OpenAI o1-mini series
      'o1-preview'     // OpenAI o1-preview series
    ];
    
    const supportsTemperature = !modelsWithoutCustomTemp.some(model => 
      this.model.toLowerCase().includes(model.toLowerCase())
    );
    
    console.log(`Model ${this.model} temperature support: ${supportsTemperature}`);
    return { supportsTemperature };
  }

  /**
   * Check if we have similar recent analysis to reuse
   */
  private async findSimilarAnalysis(text: string, ticker?: string): Promise<SentimentScore | null> {
    try {
      if (!ticker) return null;
      
      const recentAnalysis = await dataStorageService.getRecentAnalysisForTicker(ticker, 4); // Last 4 hours (expanded for better reuse)
      
      // Look for very similar content (same author, similar length, recent)
      for (const analysis of recentAnalysis) {
        const similarity = this.calculateTextSimilarity(text, analysis.content);
        // Expanded: 0.90 threshold (from 0.85) for higher quality matches, 4 hour window (from 1h)
        if (similarity > 0.90 && (Date.now() - analysis.processing_timestamp) < 14400000) { // 4 hours
          // Increment reuse count for cost tracking
          await dataStorageService.incrementReuseCount(analysis.id);
          
          console.log(`♻️  Reusing similar analysis for ${ticker} (similarity: ${(similarity * 100).toFixed(1)}%)`);
          return {
            score: analysis.sentiment_score,
            magnitude: Math.abs(analysis.sentiment_score),
            confidence: analysis.confidence_level,
            reasoning: `[REUSED] ${analysis.sentiment_reasoning}`
          };
        }
      }
      
      return null;
    } catch (error) {
      console.warn('Error checking for similar analysis:', error);
      return null;
    }
  }

  /**
   * Calculate text similarity (simple approach)
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    const words2 = new Set(text2.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * Get historical context for better decision making
   */
  private async getHistoricalContext(ticker: string): Promise<string> {
    try {
      const recentAnalysis = await dataStorageService.getRecentAnalysisForTicker(ticker, 6); // Last 6 hours
      
      if (recentAnalysis.length === 0) {
        return '';
      }
      
      const contextSummary = recentAnalysis.slice(0, 5).map(analysis => {
        const timeAgo = Math.round((Date.now() - analysis.processing_timestamp) / (1000 * 60));
        return `${timeAgo}m ago: sentiment=${analysis.sentiment_score.toFixed(2)} conf=${analysis.confidence_level.toFixed(2)} - ${analysis.sentiment_reasoning.substring(0, 100)}`;
      }).join('\n');
      
      return `\nRecent ${ticker} Analysis Context (last 6 hours):\n${contextSummary}\n`;
    } catch (error) {
      console.warn('Error getting historical context:', error);
      return '';
    }
  }

  /**
   * Analyze sentiment of Reddit text content
   */
  public async analyzeSentiment(text: string, ticker?: string): Promise<SentimentScore> {
    // Return mock sentiment in development mode
    if (config.openai.apiKey.startsWith('placeholder_') || process.env.SKIP_CONFIG_VALIDATION === 'true') {
      return this.getMockSentiment(text, ticker);
    }
    
    // Check for similar recent analysis to reuse
    const similarAnalysis = await this.findSimilarAnalysis(text, ticker);
    if (similarAnalysis) {
      return similarAnalysis;
    }
    
    try {
      // Get historical context to improve analysis
      const historicalContext = ticker ? await this.getHistoricalContext(ticker) : '';
      const prompt = this.buildSentimentPrompt(text, ticker, historicalContext);
      const modelParams = this.getModelParams();
      
      const requestParams: any = {
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
        max_completion_tokens: 200,
      };
      
      // Only add temperature if the model supports it
      if (modelParams.supportsTemperature) {
        requestParams.temperature = 0.1; // Low temperature for consistent analysis
      }
      
      const response = await this.openai.chat.completions.create(requestParams);

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new OpenAIAPIError('Empty response from OpenAI');
      }

      // Track API call for cost monitoring
      this.trackApiCall(response, 'sentiment_analysis', text, content);

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
      const modelParams = this.getModelParams();
      
      const requestParams: any = {
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
        max_completion_tokens: 300,
      };
      
      // Only add temperature if the model supports it
      if (modelParams.supportsTemperature) {
        requestParams.temperature = 0.2; // Slightly higher for some creativity in reasoning
      }
      
      const response = await this.openai.chat.completions.create(requestParams);

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new OpenAIAPIError('Empty response from OpenAI trading decision');
      }

      // Track API call for cost monitoring
      this.trackApiCall(response, 'trade_signal_generation', prompt, content);

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

      const modelParams = this.getModelParams();
      
      const requestParams: any = {
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
        max_completion_tokens: 100,
      };
      
      // Only add temperature if the model supports it
      if (modelParams.supportsTemperature) {
        requestParams.temperature = 0.1;
      }
      
      const response = await this.openai.chat.completions.create(requestParams);

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        return [];
      }

      // Track API call for cost monitoring
      this.trackApiCall(response, 'ticker_extraction', text, content);

      try {
        // Strip markdown code blocks if present
        let jsonContent = content;
        if (content.includes('```')) {
          // Extract JSON from markdown code blocks
          const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            jsonContent = jsonMatch[1].trim();
          }
        }
        
        const tickers = JSON.parse(jsonContent);
        return Array.isArray(tickers) ? tickers.filter(t => typeof t === 'string') : [];
      } catch (parseError: unknown) {
        console.warn('Failed to parse ticker extraction response:', content);
        if (parseError instanceof Error) {
          console.warn('Parse error:', parseError.message);
        } else {
          console.warn('Parse error:', parseError);
        }
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

      const modelParams = this.getModelParams();
      
      const requestParams: any = {
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
        max_completion_tokens: 250,
      };
      
      // Only add temperature if the model supports it
      if (modelParams.supportsTemperature) {
        requestParams.temperature = 0.3;
      }
      
      const response = await this.openai.chat.completions.create(requestParams);

      const content = response.choices[0]?.message?.content?.trim() || 'Unable to generate summary';
      
      // Track API call for cost monitoring
      this.trackApiCall(response, 'content_summarization', combinedText, content);
      
      return content;

    } catch (error) {
      console.warn('Failed to summarize Reddit content:', error);
      return 'Summary generation failed';
    }
  }

  /**
   * Build sentiment analysis prompt
   */
  private buildSentimentPrompt(text: string, ticker?: string, historicalContext?: string): string {
    const tickerContext = ticker ? ` Focus specifically on sentiment toward ${ticker}.` : '';
    const contextSection = historicalContext ? `\n\n${historicalContext}\nUse this context to better understand sentiment patterns and consistency.` : '';
    
    return `Analyze the sentiment of this Reddit text about cryptocurrency:${tickerContext}${contextSection}

Text: "${text}"

Consider:
- Explicit positive/negative language
- Implied bullish/bearish sentiment
- Excitement, fear, uncertainty, doubt (FUD)
- Technical analysis mentions
- Price predictions and expectations
- Community mood and confidence
- Consistency with recent sentiment trends (if provided)`;
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
      const modelParams = this.getModelParams();
      
      const requestParams: any = {
        model: this.model,
        messages: [
          { role: 'system', content: 'You are a test assistant.' },
          { role: 'user', content: 'Respond with: "Connection successful"' }
        ],
        max_completion_tokens: 10,
      };
      
      // Only add temperature if the model supports it
      if (modelParams.supportsTemperature) {
        requestParams.temperature = 0;
      }
      
      const response = await this.openai.chat.completions.create(requestParams);

      const content = response.choices[0]?.message?.content?.trim();
      console.log('OpenAI API connection successful');
      console.log(`Response content: "${content}"`);
      
      // Track API call for cost monitoring
      this.trackApiCall(response, 'connection_test', 'Connection test', content || '');
      
      // If we got a valid response, the connection is working
      // Don't require exact text match as different models may respond differently
      return !!(response && response.choices && response.choices[0]);
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