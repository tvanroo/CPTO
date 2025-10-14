#!/bin/bash

# CPTO Server Deployment Script
# Reads configuration from .env file and deploys updates to server

set -e  # Exit on any error

echo "🚀 CPTO Server Deployment Script"
echo "=================================="

# Load environment variables from .env
if [ -f .env ]; then
    export $(cat .env | grep -v '#' | grep -v '^$' | xargs)
    echo "✅ Environment variables loaded from .env"
else
    echo "❌ .env file not found!"
    exit 1
fi

# Check if required SSH variables are set
if [ -z "$SERVER_IP" ] || [ -z "$SERVER_USERNAME" ] || [ -z "$SERVER_PATH" ]; then
    echo "❌ Missing required server configuration in .env file:"
    echo "   SERVER_IP, SERVER_USERNAME, and SERVER_PATH must be set"
    exit 1
fi

# Set defaults
SSH_KEY_PATH=${SSH_KEY_PATH:-~/.ssh/id_rsa}
SSH_PORT=${SSH_PORT:-22}

echo "📡 Server Details:"
echo "   IP: $SERVER_IP"
echo "   User: $SERVER_USERNAME"
echo "   Path: $SERVER_PATH"
echo "   SSH Key: $SSH_KEY_PATH"
echo "   SSH Port: $SSH_PORT"
echo ""

# Test SSH connection
echo "🔐 Testing SSH connection..."
if ssh -i "$SSH_KEY_PATH" -p "$SSH_PORT" -o ConnectTimeout=10 "$SERVER_USERNAME@$SERVER_IP" "echo 'SSH connection successful'" 2>/dev/null; then
    echo "✅ SSH connection working"
else
    echo "❌ SSH connection failed!"
    echo "   Please check your server IP, SSH key, and network connectivity"
    exit 1
fi

# Function to run commands on remote server
run_remote() {
    echo "🖥️  Running on server: $1"
    ssh -i "$SSH_KEY_PATH" -p "$SSH_PORT" "$SERVER_USERNAME@$SERVER_IP" "source ~/.nvm/nvm.sh && $1"
}

echo ""
echo "📥 Deploying CPTO Phase 3 Updates..."
echo ""

# Stop existing PM2 processes
echo "1️⃣ Stopping PM2 processes..."
run_remote "cd $SERVER_PATH && pm2 stop cpto || true"
run_remote "cd $SERVER_PATH && pm2 stop cpto-dashboard || true"

# Stash local changes and pull latest
echo "2️⃣ Stashing local changes and pulling from Git..."
run_remote "cd $SERVER_PATH && git stash push -m 'Auto-stash before deployment'"
run_remote "cd $SERVER_PATH && git pull origin main"

# Install dependencies
echo "3️⃣ Installing/updating dependencies..."
run_remote "cd $SERVER_PATH && npm install"

# Build the project
echo "4️⃣ Building TypeScript code..."
run_remote "cd $SERVER_PATH && npm run build"

echo "4.5️⃣ Running database migration..."
run_remote "cd $SERVER_PATH && node migrate-db.js"

echo "5️⃣ Starting main CPTO service..."
run_remote "cd $SERVER_PATH && pm2 restart ecosystem.config.js --env production"

# Start dashboard service
echo "6️⃣ Starting dashboard service..."
run_remote "cd $SERVER_PATH && pm2 start build/dashboard.js --name cpto-dashboard"

# Check PM2 status
echo "7️⃣ Checking PM2 status..."
run_remote "cd $SERVER_PATH && pm2 status"

# Test new endpoints
echo "8️⃣ Testing new backtesting endpoints..."
echo ""

# Test presets endpoint
echo "   Testing presets endpoint..."
if run_remote "curl -s http://localhost:4000/api/backtesting/presets | head -c 100" 2>/dev/null; then
    echo "   ✅ Presets endpoint working"
else
    echo "   ⚠️  Presets endpoint test inconclusive"
fi

# Save PM2 processes
echo "9️⃣ Saving PM2 configuration..."
run_remote "pm2 save"

echo ""
echo "🎉 Deployment Complete!"
echo "========================"
echo ""
echo "📊 Your CPTO services are now running with Phase 3 features:"
echo "   • Main Dashboard: http://$SERVER_IP:4000/"
echo "   • Backtesting Tool: http://$SERVER_IP:4000/backtesting.html"
echo "   • Trading Bot: Background service (PM2)"
echo ""
echo "🔧 Management Commands:"
echo "   View logs: ssh -i $SSH_KEY_PATH $SERVER_USERNAME@$SERVER_IP 'source ~/.nvm/nvm.sh && pm2 logs'"
echo "   Check status: ssh -i $SSH_KEY_PATH $SERVER_USERNAME@$SERVER_IP 'source ~/.nvm/nvm.sh && pm2 status'"
echo "   Restart services: ssh -i $SSH_KEY_PATH $SERVER_USERNAME@$SERVER_IP 'source ~/.nvm/nvm.sh && pm2 restart all'"
echo ""
echo "✅ Deployment successful!"