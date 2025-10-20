#!/bin/bash

# CPTO - Subreddit Management Feature Deployment Script
# This script deploys the new feature to your Ubuntu server

set -e  # Exit on any error

echo "🚀 Starting CPTO Subreddit Management Feature Deployment..."
echo ""

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "📂 Current directory: $(pwd)"
echo ""

# Check if we're in a git repository
if [ ! -d ".git" ]; then
    echo "❌ Error: Not in a git repository"
    exit 1
fi

# Stash any uncommitted changes
echo "📦 Stashing any uncommitted changes..."
git stash push -m "Auto-stash before deployment $(date +%Y%m%d-%H%M%S)" || true
echo ""

# Pull latest changes
echo "⬇️  Pulling latest changes from GitHub..."
git fetch origin
git checkout main
git pull origin main
echo ""

# Install/update dependencies
echo "📦 Installing dependencies..."
npm install
echo ""

# Build the application
echo "🔨 Building application..."
npm run build
echo ""

# Check if PM2 is running CPTO
echo "🔍 Checking PM2 status..."
if pm2 list | grep -q "cpto"; then
    echo "✅ CPTO is running in PM2"
    
    # Restart PM2 in the background
    echo "🔄 Restarting CPTO with PM2 (background)..."
    pm2 restart cpto
    
    # Wait a moment for restart
    sleep 2
    
    # Show status
    echo ""
    echo "📊 PM2 Status:"
    pm2 status
    
    echo ""
    echo "📋 Recent logs (last 20 lines):"
    pm2 logs cpto --lines 20 --nostream
    
else
    echo "⚠️  CPTO not found in PM2. Starting fresh..."
    pm2 start ecosystem.config.js --env production
    pm2 save
    
    echo ""
    echo "📊 PM2 Status:"
    pm2 status
fi

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Verify the database migration ran successfully:"
echo "      pm2 logs cpto | grep 'managed_subreddits'"
echo ""
echo "   2. Access the Subreddit Management UI:"
echo "      http://your-server:3000/tickers → Click 'Subreddits' tab"
echo ""
echo "   3. Monitor logs for any issues:"
echo "      pm2 logs cpto"
echo ""
echo "   4. Check detailed documentation:"
echo "      cat docs/SUBREDDIT_MANAGEMENT.md"
echo ""

# Pop any stashed changes
if git stash list | grep -q "Auto-stash before deployment"; then
    echo "📤 Restoring stashed changes..."
    git stash pop || true
fi

echo "🎉 Done!"
