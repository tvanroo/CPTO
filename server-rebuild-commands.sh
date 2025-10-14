#!/bin/bash

# CPTO Server Rebuild and Restart Commands
# Run these commands on your Ubuntu server after git pull

echo "🔄 CPTO Server Rebuild Process"
echo "============================="

# Navigate to project directory
cd /opt/cpto

# 1. Pull latest changes (if not already done)
echo "📥 Pulling latest changes..."
git pull origin main

# 2. Install any new dependencies
echo "📦 Installing dependencies..."
npm install

# 3. Build the TypeScript project
echo "🔨 Building TypeScript..."
npm run build

# 4. Stop current PM2 processes
echo "🛑 Stopping current processes..."
pm2 stop cpto-dashboard || echo "Dashboard not running"
pm2 stop cpto || echo "Main bot not running"

# 5. Start the dashboard
echo "🌐 Starting dashboard..."
pm2 start build/dashboard.js --name cpto-dashboard

# 6. Start the main bot
echo "🤖 Starting main bot..."
pm2 start build/index.js --name cpto

# 7. Save PM2 configuration
echo "💾 Saving PM2 configuration..."
pm2 save

# 8. Show process status
echo "📊 Current process status:"
pm2 list

echo ""
echo "✅ Rebuild and restart complete!"
echo "🌐 Dashboard: http://$(curl -s ifconfig.me):4000"
echo "📋 Check logs: pm2 logs cpto-dashboard"
echo "📋 Check logs: pm2 logs cpto"