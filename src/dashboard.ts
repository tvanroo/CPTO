#!/usr/bin/env node
/**
 * CPTO Web Dashboard
 * Standalone web interface for monitoring and controlling the CPTO trading bot
 */

import { webServer } from './server/webServer';

async function startDashboard() {
  try {
    console.log('🌐 Starting CPTO Web Dashboard...');
    
    await webServer.start();
    
    console.log('✅ CPTO Dashboard started successfully!');
    console.log('📊 Features available:');
    console.log('   • Real-time log streaming');
    console.log('   • Bot control (start/stop/restart)');
    console.log('   • API connection testing');
    console.log('   • Trading statistics');
    console.log('   • Configuration management');
    console.log('   • PM2 process management');
    
  } catch (error) {
    console.error('❌ Failed to start CPTO Dashboard:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT. Shutting down dashboard gracefully...');
  try {
    await webServer.stop();
    console.log('✅ Dashboard shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM. Shutting down dashboard gracefully...');
  try {
    await webServer.stop();
    console.log('✅ Dashboard shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

// Start the dashboard
startDashboard();