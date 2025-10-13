#!/usr/bin/env node
/**
 * Test Gemini Exchange integration
 * Runs in development mode with mock data
 */

console.log('🧪 Testing CPTO with Gemini Exchange integration...\n');

// Set development mode
process.env.SKIP_CONFIG_VALIDATION = 'true';
process.env.NODE_ENV = 'development';

const { geminiClient } = require('./build/clients/geminiClient');
const { tradingBot } = require('./build/services/tradingBot');

async function testGeminiIntegration() {
  try {
    console.log('1️⃣ Testing Gemini API connection...');
    const connectionTest = await geminiClient.testConnection();
    console.log(`   Connection successful: ${connectionTest}\n`);

    console.log('2️⃣ Testing market data fetching...');
    const btcData = await geminiClient.getPrice('BTC');
    console.log(`   BTC Market Data: $${btcData.price.toFixed(2)}`);
    console.log(`   Volume 24h: ${btcData.volume_24h.toLocaleString()}\n`);

    console.log('3️⃣ Testing trade execution (mock)...');
    const mockTrade = await geminiClient.executeTrade({
      ticker: 'BTC',
      side: 'buy',
      amount_usd: 100,
      order_type: 'market'
    });
    console.log(`   Mock trade executed: ${mockTrade.order_id}`);
    console.log(`   Status: ${mockTrade.status}`);
    console.log(`   Fees: $${mockTrade.fees.toFixed(2)}\n`);

    console.log('4️⃣ Testing trading bot connection tests...');
    // Create a new instance just for testing connections
    const testBot = tradingBot;
    
    // Test all API connections
    await testBot.start();
    console.log('   All trading bot connections successful!\n');

    await testBot.stop();

    console.log('✅ All Gemini integration tests passed!');
    console.log('\n📋 Summary:');
    console.log('   - Gemini API client: ✅ Working');
    console.log('   - Market data fetching: ✅ Working');
    console.log('   - Trade execution: ✅ Working (mock mode)');
    console.log('   - Trading bot integration: ✅ Working');
    console.log('\n🚀 CPTO is ready with Gemini Exchange integration!');
    console.log('\nNext steps:');
    console.log('1. Get real Gemini API keys from https://exchange.gemini.com/');
    console.log('2. Add keys to your production .env file');
    console.log('3. Start with sandbox mode (GEMINI_USE_SANDBOX=true)');
    console.log('4. Deploy and test with real market data');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testGeminiIntegration();