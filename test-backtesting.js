#!/usr/bin/env node

/**
 * Test script for CPTO Backtesting API endpoints
 */

const BASE_URL = 'http://localhost:4000'; // Dashboard server port

async function testBacktestingEndpoints() {
    console.log('🧪 Testing CPTO Backtesting API Endpoints\n');

    try {
        // Test 1: Get Presets
        console.log('1️⃣ Testing GET /api/backtesting/presets');
        const presetsResponse = await fetch(`${BASE_URL}/api/backtesting/presets`);
        if (presetsResponse.ok) {
            const presetsData = await presetsResponse.json();
            console.log('✅ Presets endpoint working');
            console.log(`   Available presets: ${Object.keys(presetsData.presets).join(', ')}\n`);
        } else {
            console.log('❌ Presets endpoint failed:', presetsResponse.status, '\n');
        }

        // Test 2: Run a Simple Backtest
        console.log('2️⃣ Testing POST /api/backtesting/run');
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const now = new Date();
        
        const backtestConfig = {
            ticker: 'BTC',
            startDate: thirtyDaysAgo.toISOString().split('T')[0],
            endDate: now.toISOString().split('T')[0],
            initialBalance: 10000,
            tradeAmountUSD: 100,
            sentimentThreshold: 0.3,
            confidenceThreshold: 0.7,
            maxTradesPerDay: 5
        };

        const backtestResponse = await fetch(`${BASE_URL}/api/backtesting/run`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(backtestConfig)
        });

        if (backtestResponse.ok) {
            const backtestData = await backtestResponse.json();
            console.log('✅ Backtest endpoint working');
            console.log(`   Total trades: ${backtestData.backtest.performance.totalTrades}`);
            console.log(`   Win rate: ${backtestData.backtest.performance.winRate.toFixed(1)}%`);
            console.log(`   Final return: ${backtestData.backtest.performance.totalPnLPercent.toFixed(2)}%\n`);
        } else {
            const errorData = await backtestResponse.text();
            console.log('❌ Backtest endpoint failed:', backtestResponse.status);
            console.log('   Error:', errorData, '\n');
        }

        // Test 3: Sentiment Momentum Analysis
        console.log('3️⃣ Testing GET /api/backtesting/sentiment-momentum/:ticker');
        const momentumResponse = await fetch(`${BASE_URL}/api/backtesting/sentiment-momentum/BTC?days=30`);
        
        if (momentumResponse.ok) {
            const momentumData = await momentumResponse.json();
            console.log('✅ Sentiment momentum endpoint working');
            console.log(`   Bullish momentum trades: ${momentumData.analysis.patterns.bullishMomentum.trades}`);
            console.log(`   Bearish momentum trades: ${momentumData.analysis.patterns.bearishMomentum.trades}`);
            console.log(`   Reversal signals: ${momentumData.analysis.patterns.reversalSignals.length}\n`);
        } else {
            const errorData = await momentumResponse.text();
            console.log('❌ Sentiment momentum endpoint failed:', momentumResponse.status);
            console.log('   Error:', errorData, '\n');
        }

        // Test 4: Strategy Optimization
        console.log('4️⃣ Testing POST /api/backtesting/optimize');
        const optimizeConfig = {
            parameter: 'sentimentThreshold',
            values: [0.1, 0.2, 0.3, 0.4, 0.5],
            startDate: thirtyDaysAgo.toISOString().split('T')[0],
            endDate: now.toISOString().split('T')[0]
        };

        const optimizeResponse = await fetch(`${BASE_URL}/api/backtesting/optimize`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(optimizeConfig)
        });

        if (optimizeResponse.ok) {
            const optimizeData = await optimizeResponse.json();
            console.log('✅ Strategy optimization endpoint working');
            console.log(`   Parameter: ${optimizeData.optimization.parameter}`);
            console.log(`   Optimal value: ${optimizeData.optimization.optimal.value}`);
            console.log(`   Best Sharpe ratio: ${optimizeData.optimization.optimal.score.toFixed(3)}\n`);
        } else {
            const errorData = await optimizeResponse.text();
            console.log('❌ Strategy optimization endpoint failed:', optimizeResponse.status);
            console.log('   Error:', errorData, '\n');
        }

        console.log('🎉 Backtesting API testing completed!\n');
        console.log('📱 Dashboard URLs:');
        console.log(`   Main Dashboard: ${BASE_URL}/`);
        console.log(`   Backtesting Dashboard: ${BASE_URL}/backtesting.html`);

    } catch (error) {
        console.error('❌ Test failed with error:', error.message);
        console.log('\n💡 Make sure the CPTO dashboard server is running on port 4000');
        console.log('   You can start it by running the main CPTO application');
    }
}

// Run tests
testBacktestingEndpoints();