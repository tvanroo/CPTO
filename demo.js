#!/usr/bin/env node

// Demo script to show CPTO functionality
process.env.SKIP_CONFIG_VALIDATION = 'true';
process.env.NODE_ENV = 'development';

console.log(`
╔═══════════════════════════════════════════════════╗
║                     CPTO DEMO                     ║
║   Crypto Trading Platform with Ongoing analysis  ║
╚═══════════════════════════════════════════════════╝
`);

async function runDemo() {
  try {
    // Initialize the configuration
    const { getConfig } = require('./build/config');
    const config = getConfig();
    
    console.log('🔧 Configuration:');
    console.log(`   Environment: ${config.app.nodeEnv}`);
    console.log(`   OpenAI Model: ${config.openai.model}`);
    console.log(`   Monitoring Subreddits: ${config.trading.subreddits.join(', ')}`);
    console.log(`   Trade Amount: $${config.trading.tradeAmountUsd}`);
    console.log(`   Sentiment Threshold: ${config.trading.sentimentThreshold}`);
    console.log('');

    // Initialize API clients
    console.log('🚀 Initializing API clients...');
    const { redditClient } = require('./build/clients/redditClient');
    const { tokenMetricsClient } = require('./build/clients/tokenMetricsClient');
    const { aiService } = require('./build/services/aiService');
    console.log('');

    // Test API connections
    console.log('🔗 Testing API connections...');
    const [redditStatus, tokenMetricsStatus, aiStatus] = await Promise.all([
      redditClient.getRateLimitInfo(),
      tokenMetricsClient.testConnection(),
      aiService.testConnection()
    ]);
    console.log('');

    // Demo Reddit content analysis
    console.log('📊 Demo: Analyzing Reddit content...');
    const sampleTexts = [
      "Bitcoin to the moon! 🚀 I think BTC will reach $100k soon based on recent trends",
      "Ethereum gas fees are killing me. ETH network is too congested",
      "HODL diamond hands! 💎 Never selling my crypto portfolio"
    ];

    for (const text of sampleTexts) {
      console.log(`\n📝 Analyzing: "${text.substring(0, 50)}..."`);
      
      // Extract tickers
      const tickers = await aiService.extractCryptoTickers(text);
      console.log(`   🎯 Found tickers: ${tickers.join(', ') || 'None'}`);
      
      if (tickers.length > 0) {
        const ticker = tickers[0];
        
        // Analyze sentiment
        const sentiment = await aiService.analyzeSentiment(text, ticker);
        console.log(`   😊 Sentiment: ${sentiment.score.toFixed(2)} (${sentiment.confidence.toFixed(2)} confidence)`);
        console.log(`   💭 Reasoning: ${sentiment.reasoning}`);
        
        // Get market data
        const marketData = await tokenMetricsClient.getMarketData(ticker);
        const marketTrend = await tokenMetricsClient.getMarketTrends(ticker);
        console.log(`   💰 ${ticker} Price: $${marketData.price.toFixed(2)} (${marketData.price_change_percentage_24h.toFixed(1)}%)`);
        console.log(`   📈 Trend: ${marketTrend.trend} (${(marketTrend.confidence * 100).toFixed(1)}% confidence)`);
        
        // Generate trading decision
        const tradeSignal = await aiService.generateTradeDecision(sentiment, marketData, marketTrend);
        console.log(`   🎯 Trade Signal: ${tradeSignal.action} (${(tradeSignal.confidence * 100).toFixed(1)}% confidence)`);
        console.log(`   💡 Decision: ${tradeSignal.reasoning}`);
        
        // Simulate trade execution if signal is actionable
        if (tradeSignal.action !== 'HOLD' && tradeSignal.confidence > 0.6) {
          const tradeOrder = {
            ticker: tradeSignal.ticker,
            side: tradeSignal.action.toLowerCase(),
            amount_usd: tradeSignal.amount_usd,
            order_type: 'market'
          };
          
          const tradeResult = await tokenMetricsClient.executeTrade(tradeOrder);
          console.log(`   ✅ Mock Trade Executed: ${tradeResult.order_id} - ${tradeResult.status}`);
        }
      }
    }

    console.log(`
🎉 Demo completed successfully!

📋 Summary of CPTO capabilities demonstrated:
✅ Configuration management with development mode
✅ Reddit content processing with mock data
✅ AI-powered sentiment analysis
✅ Cryptocurrency ticker extraction
✅ Market data integration
✅ Trading signal generation
✅ Mock trade execution

🚀 To run the full trading bot:
   npm run dev

🔧 To run with real API keys:
   1. Copy .env.example to .env
   2. Add your Reddit, OpenAI, and TokenMetrics API keys
   3. Run: npm start
`);

  } catch (error) {
    console.error('❌ Demo failed:', error);
    process.exit(1);
  }
}

runDemo();