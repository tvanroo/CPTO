import { dataStorageService } from './dataStorageService';

export interface BacktestConfig {
  ticker?: string;
  startDate: number;
  endDate: number;
  initialBalance: number;
  tradeAmountUSD: number;
  
  // Strategy parameters
  sentimentThreshold: number;
  confidenceThreshold: number;
  maxTradesPerDay: number;
  
  // Risk management
  stopLoss?: number; // Percentage
  takeProfit?: number; // Percentage
  maxDrawdown?: number; // Percentage
}

export interface BacktestTrade {
  id: string;
  ticker: string;
  action: 'BUY' | 'SELL';
  timestamp: number;
  sentimentScore: number;
  confidence: number;
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  pnl?: number;
  pnlPercent?: number;
  reason: string;
}

export interface BacktestResult {
  config: BacktestConfig;
  trades: BacktestTrade[];
  performance: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalPnL: number;
    totalPnLPercent: number;
    avgPnLPerTrade: number;
    bestTrade: number;
    worstTrade: number;
    maxDrawdown: number;
    sharpeRatio: number;
    profitFactor: number;
    finalBalance: number;
  };
  timeline: Array<{
    date: string;
    balance: number;
    drawdown: number;
    trades: number;
  }>;
  analysis: {
    sentimentAccuracy: number;
    bestSentimentRange: { min: number; max: number; winRate: number };
    bestConfidenceRange: { min: number; max: number; winRate: number };
    timeOfDayAnalysis: Array<{ hour: number; trades: number; winRate: number }>;
    subredditPerformance: Array<{ subreddit: string; trades: number; winRate: number }>;
  };
}

export interface StrategyOptimization {
  parameter: string;
  values: number[];
  results: Array<{
    value: number;
    winRate: number;
    totalPnL: number;
    trades: number;
    sharpeRatio: number;
  }>;
  optimal: {
    value: number;
    metric: string; // 'winRate' | 'totalPnL' | 'sharpeRatio'
    score: number;
  };
}

/**
 * Backtesting and Analytics Service
 * Provides comprehensive strategy testing and performance analysis
 */
export class BacktestingService {
  
  /**
   * Run a comprehensive backtest with the given configuration
   */
  async runBacktest(config: BacktestConfig): Promise<BacktestResult> {
    console.log(`🔄 Starting backtest for ${config.ticker || 'ALL'} from ${new Date(config.startDate).toISOString().split('T')[0]} to ${new Date(config.endDate).toISOString().split('T')[0]}`);
    
    // Get historical data
    const historicalData = await this.getHistoricalData(config);
    
    if (historicalData.length === 0) {
      throw new Error('No historical data available for the specified time range');
    }
    
    // Simulate trading strategy
    const trades = await this.simulateTrading(historicalData, config);
    
    // Calculate performance metrics
    const performance = this.calculatePerformanceMetrics(trades, config);
    
    // Generate timeline analysis
    const timeline = this.generateTimeline(trades, config);
    
    // Perform detailed analysis
    const analysis = this.performDetailedAnalysis(trades, historicalData);
    
    console.log(`✅ Backtest completed: ${trades.length} trades, ${performance.winRate.toFixed(1)}% win rate, ${performance.totalPnLPercent.toFixed(2)}% return`);
    
    return {
      config,
      trades,
      performance,
      timeline,
      analysis
    };
  }
  
  /**
   * Optimize strategy parameters through systematic testing
   */
  async optimizeStrategy(baseConfig: BacktestConfig, parameter: string, values: number[]): Promise<StrategyOptimization> {
    console.log(`🔧 Optimizing ${parameter} with ${values.length} different values`);
    
    const results: Array<{
      value: number;
      winRate: number;
      totalPnL: number;
      trades: number;
      sharpeRatio: number;
    }> = [];
    
    for (const value of values) {
      const config = { ...baseConfig };
      (config as any)[parameter] = value;
      
      try {
        const backtest = await this.runBacktest(config);
        results.push({
          value,
          winRate: backtest.performance.winRate,
          totalPnL: backtest.performance.totalPnLPercent,
          trades: backtest.performance.totalTrades,
          sharpeRatio: backtest.performance.sharpeRatio
        });
      } catch (error) {
        console.warn(`Failed to backtest ${parameter}=${value}:`, error);
        results.push({
          value,
          winRate: 0,
          totalPnL: 0,
          trades: 0,
          sharpeRatio: 0
        });
      }
    }
    
    // Find optimal value (prioritize Sharpe ratio, then total PnL)
    const optimal = results.reduce((best, current) => {
      if (current.sharpeRatio > best.score || 
          (current.sharpeRatio === best.score && current.totalPnL > (results.find(r => r.value === best.value)?.totalPnL || 0))) {
        return { value: current.value, metric: 'sharpeRatio', score: current.sharpeRatio };
      }
      return best;
    }, { value: results[0]?.value || 0, metric: 'sharpeRatio', score: results[0]?.sharpeRatio || 0 });
    
    console.log(`🎯 Optimal ${parameter}: ${optimal.value} (Sharpe: ${optimal.score.toFixed(3)})`);
    
    return {
      parameter,
      values,
      results,
      optimal
    };
  }
  
  /**
   * Compare multiple strategies side by side
   */
  async compareStrategies(strategies: Array<{ name: string; config: BacktestConfig }>): Promise<{
    comparison: Array<{
      name: string;
      winRate: number;
      totalPnL: number;
      sharpeRatio: number;
      maxDrawdown: number;
      trades: number;
    }>;
    winner: string;
  }> {
    console.log(`📊 Comparing ${strategies.length} strategies`);
    
    const results = [];
    
    for (const strategy of strategies) {
      try {
        const backtest = await this.runBacktest(strategy.config);
        results.push({
          name: strategy.name,
          winRate: backtest.performance.winRate,
          totalPnL: backtest.performance.totalPnLPercent,
          sharpeRatio: backtest.performance.sharpeRatio,
          maxDrawdown: backtest.performance.maxDrawdown,
          trades: backtest.performance.totalTrades
        });
      } catch (error) {
        console.warn(`Failed to backtest strategy ${strategy.name}:`, error);
        results.push({
          name: strategy.name,
          winRate: 0,
          totalPnL: 0,
          sharpeRatio: 0,
          maxDrawdown: 0,
          trades: 0
        });
      }
    }
    
    // Determine winner based on risk-adjusted returns (Sharpe ratio)
    const winner = results.reduce((best, current) => 
      current.sharpeRatio > best.sharpeRatio ? current : best
    ).name;
    
    console.log(`🏆 Best strategy: ${winner}`);
    
    return {
      comparison: results,
      winner
    };
  }
  
  /**
   * Analyze sentiment momentum patterns
   */
  async analyzeSentimentMomentum(ticker: string, days: number = 30): Promise<{
    momentum: Array<{ date: string; sentiment: number; momentum: number; accuracy: number }>;
    patterns: {
      bullishMomentum: { threshold: number; accuracy: number; trades: number };
      bearishMomentum: { threshold: number; accuracy: number; trades: number };
      reversalSignals: Array<{ date: string; signal: 'bullish_reversal' | 'bearish_reversal'; accuracy: number }>;
    };
  }> {
    console.log(`📈 Analyzing sentiment momentum for ${ticker} over ${days} days`);
    
    // Get sentiment trend data
    const trendData = await dataStorageService.getSentimentTrendAnalysis(ticker, days);
    
    if (trendData.daily.length < 3) {
      throw new Error('Insufficient data for momentum analysis');
    }
    
    // Calculate momentum (rate of change in sentiment)
    const momentum = [];
    for (let i = 1; i < trendData.daily.length; i++) {
      const current = trendData.daily[i];
      const previous = trendData.daily[i - 1];
      const momentumValue = current.avgSentiment - previous.avgSentiment;
      
      momentum.push({
        date: current.date,
        sentiment: current.avgSentiment,
        momentum: momentumValue,
        accuracy: this.simulateAccuracy(current.avgSentiment, current.confidence) // Simulated accuracy
      });
    }
    
    // Identify patterns
    const bullishMomentumTrades = momentum.filter(m => m.momentum > 0.1);
    const bearishMomentumTrades = momentum.filter(m => m.momentum < -0.1);
    
    const patterns = {
      bullishMomentum: {
        threshold: 0.1,
        accuracy: bullishMomentumTrades.length > 0 ? 
          bullishMomentumTrades.reduce((sum, m) => sum + m.accuracy, 0) / bullishMomentumTrades.length : 0,
        trades: bullishMomentumTrades.length
      },
      bearishMomentum: {
        threshold: -0.1,
        accuracy: bearishMomentumTrades.length > 0 ?
          bearishMomentumTrades.reduce((sum, m) => sum + m.accuracy, 0) / bearishMomentumTrades.length : 0,
        trades: bearishMomentumTrades.length
      },
      reversalSignals: this.identifyReversalSignals(momentum)
    };
    
    return { momentum, patterns };
  }
  
  // Private helper methods
  
  private async getHistoricalData(config: BacktestConfig) {
    // In a real implementation, this would fetch actual price data
    // For now, we'll use processed content with simulated price movements
    
    const processedContent = await dataStorageService.getRecentProcessedContent(1000);
    
    return processedContent
      .filter(content => {
        const timestamp = content.processing_timestamp;
        const hasTargetTicker = !config.ticker || content.extracted_tickers.includes(config.ticker);
        const inTimeRange = timestamp >= config.startDate && timestamp <= config.endDate;
        return hasTargetTicker && inTimeRange;
      })
      .sort((a, b) => a.processing_timestamp - b.processing_timestamp);
  }
  
  private async simulateTrading(historicalData: any[], config: BacktestConfig): Promise<BacktestTrade[]> {
    const trades: BacktestTrade[] = [];
    let balance = config.initialBalance;
    let dailyTradeCount = 0;
    let lastTradeDate = '';
    
    for (const data of historicalData) {
      const currentDate = new Date(data.processing_timestamp).toDateString();
      
      // Reset daily trade counter
      if (currentDate !== lastTradeDate) {
        dailyTradeCount = 0;
        lastTradeDate = currentDate;
      }
      
      // Check if we should trade based on strategy parameters
      const shouldTrade = this.shouldExecuteTrade(data, config, dailyTradeCount);
      
      if (shouldTrade && balance >= config.tradeAmountUSD) {
        const trade: BacktestTrade = {
          id: `backtest_${data.id}`,
          ticker: data.extracted_tickers[0] || 'UNKNOWN',
          action: data.sentiment_score > 0 ? 'BUY' : 'SELL',
          timestamp: data.processing_timestamp,
          sentimentScore: data.sentiment_score,
          confidence: data.confidence_level,
          entryPrice: this.simulatePrice(data.extracted_tickers[0], data.processing_timestamp),
          quantity: config.tradeAmountUSD,
          reason: data.sentiment_reasoning.substring(0, 100)
        };
        
        // Simulate exit after 24 hours with random price movement influenced by sentiment
        trade.exitPrice = this.simulateExitPrice(trade.entryPrice, trade.sentimentScore, trade.confidence);
        trade.pnl = (trade.exitPrice - trade.entryPrice) * (trade.quantity / trade.entryPrice);
        trade.pnlPercent = ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
        
        if (trade.action === 'SELL') {
          trade.pnl = -trade.pnl; // Inverse for short positions
          trade.pnlPercent = -trade.pnlPercent;
        }
        
        balance += trade.pnl;
        trades.push(trade);
        dailyTradeCount++;
      }
    }
    
    return trades;
  }
  
  private shouldExecuteTrade(data: any, config: BacktestConfig, dailyTradeCount: number): boolean {
    // Check sentiment threshold
    if (Math.abs(data.sentiment_score) < config.sentimentThreshold) {
      return false;
    }
    
    // Check confidence threshold
    if (data.confidence_level < config.confidenceThreshold) {
      return false;
    }
    
    // Check daily trade limit
    if (dailyTradeCount >= config.maxTradesPerDay) {
      return false;
    }
    
    return true;
  }
  
  private simulatePrice(ticker: string, _timestamp: number): number {
    // Simulate realistic crypto prices based on ticker and time
    const basePrice = {
      'BTC': 35000,
      'ETH': 2200,
      'ADA': 0.45,
      'DOT': 7.5,
      'LINK': 12.8
    }[ticker] || 100;
    
    // Add some realistic price variation (±5%)
    const variation = (Math.random() - 0.5) * 0.1;
    return basePrice * (1 + variation);
  }
  
  private simulateExitPrice(entryPrice: number, sentiment: number, confidence: number): number {
    // Simulate price movement based on sentiment and confidence
    // Higher sentiment + confidence = higher probability of positive movement
    const sentimentInfluence = sentiment * confidence;
    const randomMovement = (Math.random() - 0.5) * 0.1; // ±5% random
    const sentimentMovement = sentimentInfluence * 0.05; // Up to ±2.5% from sentiment
    
    return entryPrice * (1 + randomMovement + sentimentMovement);
  }
  
  private calculatePerformanceMetrics(trades: BacktestTrade[], config: BacktestConfig) {
    if (trades.length === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalPnL: 0,
        totalPnLPercent: 0,
        avgPnLPerTrade: 0,
        bestTrade: 0,
        worstTrade: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        profitFactor: 0,
        finalBalance: config.initialBalance
      };
    }
    
    const winningTrades = trades.filter(t => t.pnl! > 0);
    const losingTrades = trades.filter(t => t.pnl! <= 0);
    const totalPnL = trades.reduce((sum, t) => sum + t.pnl!, 0);
    const totalPnLPercent = (totalPnL / config.initialBalance) * 100;
    
    const pnlValues = trades.map(t => t.pnl!);
    const bestTrade = Math.max(...pnlValues);
    const worstTrade = Math.min(...pnlValues);
    
    // Calculate maximum drawdown
    let maxDrawdown = 0;
    let peak = config.initialBalance;
    let currentBalance = config.initialBalance;
    
    for (const trade of trades) {
      currentBalance += trade.pnl!;
      if (currentBalance > peak) {
        peak = currentBalance;
      }
      const drawdown = ((peak - currentBalance) / peak) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    
    // Calculate Sharpe ratio (simplified)
    const avgReturn = totalPnLPercent / trades.length;
    const returnVariance = trades.reduce((sum, t) => {
      const tradeReturn = (t.pnl! / config.tradeAmountUSD) * 100;
      return sum + Math.pow(tradeReturn - avgReturn, 2);
    }, 0) / trades.length;
    const returnStdDev = Math.sqrt(returnVariance);
    const sharpeRatio = returnStdDev === 0 ? 0 : avgReturn / returnStdDev;
    
    // Calculate profit factor
    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl!, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl!, 0));
    const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? 999 : 0) : grossProfit / grossLoss;
    
    return {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: (winningTrades.length / trades.length) * 100,
      totalPnL,
      totalPnLPercent,
      avgPnLPerTrade: totalPnL / trades.length,
      bestTrade,
      worstTrade,
      maxDrawdown,
      sharpeRatio,
      profitFactor,
      finalBalance: config.initialBalance + totalPnL
    };
  }
  
  private generateTimeline(trades: BacktestTrade[], config: BacktestConfig) {
    const timeline = [];
    let currentBalance = config.initialBalance;
    let peak = config.initialBalance;
    
    // Group trades by day
    const tradesByDate = new Map<string, BacktestTrade[]>();
    trades.forEach(trade => {
      const date = new Date(trade.timestamp).toISOString().split('T')[0];
      if (!tradesByDate.has(date)) {
        tradesByDate.set(date, []);
      }
      tradesByDate.get(date)!.push(trade);
    });
    
    // Generate daily timeline
    for (const [date, dayTrades] of tradesByDate.entries()) {
      const dayPnL = dayTrades.reduce((sum, t) => sum + t.pnl!, 0);
      currentBalance += dayPnL;
      
      if (currentBalance > peak) {
        peak = currentBalance;
      }
      
      const drawdown = ((peak - currentBalance) / peak) * 100;
      
      timeline.push({
        date,
        balance: currentBalance,
        drawdown,
        trades: dayTrades.length
      });
    }
    
    return timeline;
  }
  
  private performDetailedAnalysis(trades: BacktestTrade[], _historicalData: any[]) {
    // Simulate sentiment accuracy
    let correctPredictions = 0;
    trades.forEach(trade => {
      const predicted = trade.action === 'BUY' ? trade.sentimentScore > 0 : trade.sentimentScore < 0;
      const actual = trade.pnl! > 0;
      if (predicted === actual) correctPredictions++;
    });
    
    const sentimentAccuracy = trades.length > 0 ? (correctPredictions / trades.length) * 100 : 0;
    
    // Analyze sentiment ranges
    const sentimentRanges = [
      { min: 0.7, max: 1.0 },
      { min: 0.3, max: 0.7 },
      { min: 0.0, max: 0.3 },
      { min: -0.3, max: 0.0 },
      { min: -0.7, max: -0.3 },
      { min: -1.0, max: -0.7 }
    ];
    
    const bestSentimentRange = sentimentRanges
      .map(range => {
        const rangeTrades = trades.filter(t => 
          Math.abs(t.sentimentScore) >= range.min && Math.abs(t.sentimentScore) < range.max
        );
        const wins = rangeTrades.filter(t => t.pnl! > 0).length;
        return {
          ...range,
          winRate: rangeTrades.length > 0 ? (wins / rangeTrades.length) * 100 : 0
        };
      })
      .reduce((best, current) => current.winRate > best.winRate ? current : best);
    
    // Analyze confidence ranges
    const confidenceRanges = [
      { min: 0.85, max: 1.0 },
      { min: 0.7, max: 0.85 },
      { min: 0.5, max: 0.7 },
      { min: 0.0, max: 0.5 }
    ];
    
    const bestConfidenceRange = confidenceRanges
      .map(range => {
        const rangeTrades = trades.filter(t => 
          t.confidence >= range.min && t.confidence < range.max
        );
        const wins = rangeTrades.filter(t => t.pnl! > 0).length;
        return {
          ...range,
          winRate: rangeTrades.length > 0 ? (wins / rangeTrades.length) * 100 : 0
        };
      })
      .reduce((best, current) => current.winRate > best.winRate ? current : best);
    
    // Time of day analysis (simplified)
    const timeOfDayAnalysis = Array.from({ length: 24 }, (_, hour) => {
      const hourTrades = trades.filter(t => new Date(t.timestamp).getHours() === hour);
      const wins = hourTrades.filter(t => t.pnl! > 0).length;
      return {
        hour,
        trades: hourTrades.length,
        winRate: hourTrades.length > 0 ? (wins / hourTrades.length) * 100 : 0
      };
    }).filter(h => h.trades > 0);
    
    // Subreddit performance (simulated)
    const subredditPerformance = [
      { subreddit: 'CryptoCurrency', trades: Math.floor(trades.length * 0.4), winRate: 65 + Math.random() * 20 },
      { subreddit: 'Bitcoin', trades: Math.floor(trades.length * 0.3), winRate: 60 + Math.random() * 25 },
      { subreddit: 'ethereum', trades: Math.floor(trades.length * 0.2), winRate: 70 + Math.random() * 15 },
      { subreddit: 'altcoin', trades: Math.floor(trades.length * 0.1), winRate: 50 + Math.random() * 30 }
    ].filter(s => s.trades > 0);
    
    return {
      sentimentAccuracy,
      bestSentimentRange,
      bestConfidenceRange,
      timeOfDayAnalysis,
      subredditPerformance
    };
  }
  
  private simulateAccuracy(sentiment: number, confidence: number): number {
    // Higher sentiment + confidence generally leads to higher accuracy
    const baseAccuracy = 0.5;
    const sentimentBonus = Math.abs(sentiment) * 0.2;
    const confidenceBonus = confidence * 0.2;
    const randomFactor = (Math.random() - 0.5) * 0.2;
    
    return Math.max(0, Math.min(1, baseAccuracy + sentimentBonus + confidenceBonus + randomFactor));
  }
  
  private identifyReversalSignals(momentum: any[]) {
    const reversals = [];
    
    for (let i = 2; i < momentum.length; i++) {
      const current = momentum[i];
      const previous = momentum[i - 1];
      const beforePrevious = momentum[i - 2];
      
      // Bullish reversal: negative momentum turning positive
      if (beforePrevious.momentum < -0.1 && previous.momentum < 0 && current.momentum > 0.1) {
        reversals.push({
          date: current.date,
          signal: 'bullish_reversal' as const,
          accuracy: this.simulateAccuracy(current.sentiment, 0.8)
        });
      }
      
      // Bearish reversal: positive momentum turning negative
      if (beforePrevious.momentum > 0.1 && previous.momentum > 0 && current.momentum < -0.1) {
        reversals.push({
          date: current.date,
          signal: 'bearish_reversal' as const,
          accuracy: this.simulateAccuracy(current.sentiment, 0.8)
        });
      }
    }
    
    return reversals;
  }
}

// Export singleton instance
export const backtestingService = new BacktestingService();