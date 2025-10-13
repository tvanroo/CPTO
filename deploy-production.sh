#!/bin/bash
# CPTO Production Deployment Script
# Run this from the /opt/cpto directory on your Ubuntu server

set -e  # Exit on any error

echo "🚀 Deploying CPTO to production..."

# Verify we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the CPTO project directory."
    exit 1
fi

# Verify .env file exists
if [ ! -f ".env" ]; then
    echo "❌ Error: .env file not found. Please create your production .env file first."
    echo "You can copy .env.example as a starting point:"
    echo "cp .env.example .env"
    echo "Then edit .env with your production API keys."
    exit 1
fi

# Pull latest changes (if using git)
if [ -d ".git" ]; then
    echo "📥 Pulling latest changes..."
    git pull origin main
fi

# Install dependencies
echo "📦 Installing production dependencies..."
npm ci --production=false

# Build the application
echo "🔨 Building application..."
npm run build

# Verify build exists
if [ ! -d "build" ]; then
    echo "❌ Error: Build directory not found. Build failed."
    exit 1
fi

# Create logs directory if it doesn't exist
echo "📝 Setting up logs directory..."
mkdir -p logs

# Stop existing PM2 process if running
if pm2 list | grep -q "cpto"; then
    echo "⏹️  Stopping existing CPTO process..."
    pm2 stop cpto || true
    pm2 delete cpto || true
fi

# Test configuration (will use real API keys but won't start full app)
echo "🔧 Testing configuration..."
if npm run test:config; then
    echo "✅ Configuration test passed"
else
    echo "❌ Configuration test failed. Please check your .env file."
    exit 1
fi

# Start with PM2 in production mode (in background as per user preference)
echo "🚀 Starting CPTO with PM2 in background..."
pm2 start ecosystem.config.js --env production &

# Wait a moment for the process to start
sleep 5

# Check if the process is running
if pm2 list | grep -q "online.*cpto"; then
    echo "✅ CPTO is now running in production mode!"
    
    # Configure PM2 for auto-startup
    echo "⚙️  Configuring PM2 auto-startup..."
    sudo env PATH=$PATH:/usr/bin $(which pm2) startup systemd -u $USER --hp $HOME
    pm2 save
    
    echo "✅ PM2 auto-startup configured"
else
    echo "❌ Failed to start CPTO. Check PM2 logs:"
    pm2 logs cpto --lines 20
    exit 1
fi

echo ""
echo "🎉 CPTO deployment completed successfully!"
echo ""
echo "📊 Monitoring commands:"
echo "  pm2 status          # Check process status"
echo "  pm2 logs cpto       # View live logs"
echo "  pm2 monit          # Real-time monitoring dashboard"
echo "  pm2 restart cpto   # Restart the application"
echo "  pm2 stop cpto      # Stop the application"
echo ""
echo "📝 Log files are located in:"
echo "  ./logs/cpto-error.log    # Error logs"
echo "  ./logs/cpto-out.log      # Output logs"
echo "  ./logs/cpto-combined.log # Combined logs"
echo ""
echo "🔍 To check if trading is active, monitor the logs:"
echo "  tail -f logs/cpto-combined.log"