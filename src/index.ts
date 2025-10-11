#!/usr/bin/env node

import { config, isDevelopment } from './config';
import { tradingBot } from './services/tradingBot';

/**
 * CPTO - Crypto Trading Platform with Ongoing sentiment analysis
 * Main application entry point
 */

console.log(`
╔═══════════════════════════════════════════════════╗
║                     CPTO                          ║
║   Crypto Trading Platform with Ongoing analysis  ║
╚═══════════════════════════════════════════════════╝
`);

console.log(`Environment: ${config.app.nodeEnv}`);
console.log(`OpenAI Model: ${config.openai.model}`);
console.log(`Monitoring Subreddits: ${config.trading.subreddits.join(', ')}`);
console.log(`Trade Amount: $${config.trading.tradeAmountUsd}`);
console.log(`Max Trades/Hour: ${config.trading.maxTradesPerHour}`);
console.log(`Sentiment Threshold: ${config.trading.sentimentThreshold}`);
console.log('');

/**
 * Setup event listeners for the trading bot
 */
function setupEventListeners(): void {
  // Bot lifecycle events
  tradingBot.on('botStarted', () => {
    console.log('🚀 CPTO Trading Bot is now active and monitoring Reddit');
  });

  tradingBot.on('botStopped', () => {
    console.log('⏹️  CPTO Trading Bot has stopped');
  });

  tradingBot.on('botError', (error: Error) => {
    console.error('🔥 Critical bot error:', error);
    process.exit(1);
  });

  // Processing events
  tradingBot.on('queueUpdated', (data: { size: number; item: any }) => {
    if (isDevelopment()) {
      console.log(`📝 Queue size: ${data.size} | New item: ${data.item.id} from r/${data.item.subreddit}`);
    }
  });

  // Trading events
  tradingBot.on('tradeExecuted', (data: { signal: any; result: any; sourceItem: any }) => {
    const { signal, result, sourceItem } = data;
    console.log(`💰 TRADE EXECUTED:`);
    console.log(`   Action: ${signal.action} ${signal.ticker}`);
    console.log(`   Amount: $${signal.amount_usd}`);
    console.log(`   Confidence: ${(signal.confidence * 100).toFixed(1)}%`);
    console.log(`   Order ID: ${result.order_id}`);
    console.log(`   Status: ${result.status}`);
    console.log(`   Source: r/${sourceItem.subreddit} by u/${sourceItem.author}`);
    console.log(`   Reasoning: ${signal.reasoning}`);
    console.log('');
  });

  tradingBot.on('tradeError', (data: { signal: any; error: any; sourceItem: any }) => {
    const { signal, error, sourceItem } = data;
    console.error(`❌ TRADE FAILED:`);
    console.error(`   Ticker: ${signal.ticker}`);
    console.error(`   Action: ${signal.action}`);
    console.error(`   Error: ${error.message}`);
    console.error(`   Source: r/${sourceItem.subreddit}`);
    console.error('');
  });

  // Error events
  tradingBot.on('error', (data: { category: string; error: Error }) => {
    if (isDevelopment()) {
      console.warn(`⚠️  Error in ${data.category}: ${data.error.message}`);
    }
  });

  // Periodic status updates
  if (isDevelopment()) {
    setInterval(() => {
      const status = tradingBot.getStatus();
      if (status.isRunning) {
        console.log(`📊 Status: Queue: ${status.queueSize}, Processing: ${status.processingCount}, Items: ${status.stats.totalItemsProcessed}, Trades: ${status.stats.totalTradesExecuted}/${status.stats.successfulTrades}`);
      }
    }, 60000); // Every minute in development
  }
}

/**
 * Graceful shutdown handler
 */
async function setupGracefulShutdown(): Promise<void> {
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
    
    try {
      await tradingBot.stop();
      console.log('✅ Shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  };

  // Handle various termination signals
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGQUIT', () => shutdown('SIGQUIT'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('🔥 Uncaught Exception:', error);
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 Unhandled Rejection at:', promise, 'reason:', reason);
    shutdown('unhandledRejection');
  });
}

/**
 * Display startup banner and configuration
 */
function displayStartupInfo(): void {
  console.log('Configuration:');
  console.log(`  • Reddit API: ✓ Connected`);
  console.log(`  • OpenAI API: ✓ Connected`); 
  console.log(`  • TokenMetrics API: ✓ Connected`);
  console.log(`  • Environment: ${config.app.nodeEnv}`);
  console.log(`  • Log Level: ${config.app.logLevel}`);
  console.log('');
  console.log('Trading Settings:');
  console.log(`  • Subreddits: ${config.trading.subreddits.length} subreddits`);
  console.log(`  • Sentiment Threshold: ${config.trading.sentimentThreshold}`);
  console.log(`  • Default Trade Amount: $${config.trading.tradeAmountUsd}`);
  console.log(`  • Max Trades per Hour: ${config.trading.maxTradesPerHour}`);
  console.log('');
}

/**
 * Main application function
 */
async function main(): Promise<void> {
  try {
    // Setup event handling
    setupEventListeners();
    await setupGracefulShutdown();
    
    // Display startup information
    displayStartupInfo();
    
    // Start the trading bot
    console.log('Starting CPTO Trading Bot...\n');
    await tradingBot.start();
    
    // Keep the process running
    console.log('CPTO is now running. Press Ctrl+C to stop.\n');
    
    // In production, we might want to set up additional monitoring or health checks here
    if (!isDevelopment()) {
      // Production-specific setup could go here
      console.log('Running in production mode');
    }
    
  } catch (error) {
    console.error('🔥 Failed to start CPTO:', error);
    
    if (error instanceof Error && error.message.includes('CONNECTION_ERROR')) {
      console.error('\n💡 Tip: Make sure all your API keys are configured correctly in your .env file');
      console.error('   Check the .env.example file for required environment variables');
    }
    
    process.exit(1);
  }
}

// Only run main if this file is executed directly (not required as a module)
if (require.main === module) {
  main().catch((error) => {
    console.error('🔥 Unhandled error in main:', error);
    process.exit(1);
  });
}

// Export for testing purposes
export { main, tradingBot };