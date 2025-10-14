#!/bin/bash

# CPTO Dashboard Update Deployment Script
# Deploys the updated dashboard with 1-hour lookback and portfolio features

set -e  # Exit on any error

# Configuration
SERVER_IP="192.168.1.130"
SERVER_USER="tvanroo"
SERVER_PATH="/opt/cpto"
LOCAL_PROJECT_PATH="/Users/toby/Documents/GitHub/CPTO"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 CPTO Dashboard Update Deployment${NC}"
echo "================================="

# Function to print status
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if we have the correct files locally
echo "📋 Checking local files..."
if [ ! -f "$LOCAL_PROJECT_PATH/public/dashboard.html" ]; then
    print_error "dashboard.html not found locally!"
    exit 1
fi

if [ ! -f "$LOCAL_PROJECT_PATH/src/server/webServer.ts" ]; then
    print_error "webServer.ts not found locally!"
    exit 1
fi

if [ ! -f "$LOCAL_PROJECT_PATH/src/services/tradingBot.ts" ]; then
    print_error "tradingBot.ts not found locally!"
    exit 1
fi

print_status "All required files found locally"

# Build the project locally first
echo "🔨 Building project locally..."
cd "$LOCAL_PROJECT_PATH"
npm run build
if [ $? -ne 0 ]; then
    print_error "Local build failed!"
    exit 1
fi
print_status "Local build successful"

# Copy updated files to server
echo "📤 Copying updated files to server..."

# Copy dashboard HTML
scp "$LOCAL_PROJECT_PATH/public/dashboard.html" "$SERVER_USER@$SERVER_IP:$SERVER_PATH/public/"
if [ $? -eq 0 ]; then
    print_status "Dashboard HTML copied"
else
    print_error "Failed to copy dashboard HTML"
    exit 1
fi

# Copy server files
scp "$LOCAL_PROJECT_PATH/src/server/webServer.ts" "$SERVER_USER@$SERVER_IP:$SERVER_PATH/src/server/"
if [ $? -eq 0 ]; then
    print_status "Web server file copied"
else
    print_error "Failed to copy web server file"
    exit 1
fi

# Copy trading bot file
scp "$LOCAL_PROJECT_PATH/src/services/tradingBot.ts" "$SERVER_USER@$SERVER_IP:$SERVER_PATH/src/services/"
if [ $? -eq 0 ]; then
    print_status "Trading bot file copied"
else
    print_error "Failed to copy trading bot file"
    exit 1
fi

# Run deployment commands on server
echo "🖥️ Running deployment commands on server..."
ssh "$SERVER_USER@$SERVER_IP" << 'ENDSSH'
set -e

# Colors for remote output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}📍 Remote deployment starting...${NC}"

# Navigate to project directory
cd /opt/cpto

# Build the updated project
echo "🔨 Building project on server..."
npm run build
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Server build failed!${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Server build successful${NC}"

# Stop current processes
echo "🛑 Stopping current processes..."
pm2 stop cpto-dashboard || true
pm2 stop cpto || true
echo -e "${GREEN}✅ Processes stopped${NC}"

# Start processes
echo "🚀 Starting updated processes..."
pm2 start build/dashboard.js --name cpto-dashboard
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to start dashboard${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Dashboard started${NC}"

pm2 start build/index.js --name cpto
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to start main bot${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Main bot started${NC}"

# Check process status
echo "📊 Process status:"
pm2 list

echo -e "${GREEN}🎉 Remote deployment completed successfully!${NC}"
ENDSSH

if [ $? -eq 0 ]; then
    print_status "Remote deployment successful"
else
    print_error "Remote deployment failed"
    exit 1
fi

echo ""
echo -e "${GREEN}🎉 Dashboard Update Deployment Complete!${NC}"
echo ""
echo "🔗 Features Added:"
echo "   • 1-hour Reddit history lookback on bot startup"
echo "   • Real-time portfolio balance display"
echo "   • Trading history modal with recent trades"
echo "   • Real-time event notifications"
echo "   • Auto-refresh portfolio after trades"
echo ""
echo "🌐 Access your updated dashboard at: http://$SERVER_IP:4000"
echo ""
echo -e "${YELLOW}📋 Next Steps:${NC}"
echo "   1. Visit the dashboard URL above"
echo "   2. Start the bot to see 1-hour lookback in action"
echo "   3. Check portfolio balance and recent trades"
echo "   4. Monitor real-time events and notifications"
echo ""