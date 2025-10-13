#!/bin/bash
# debug-pm2.sh
# Debug PM2 startup issues

echo "🔍 Debugging PM2 startup issues..."

# Source NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 18

echo ""
echo "🔧 Environment Check:"
echo "Node.js: $(node --version)"
echo "npm: $(npm --version)"
echo "PM2: $(pm2 --version)"
echo "Current directory: $(pwd)"

echo ""
echo "📁 File Structure Check:"
ls -la build/ 2>/dev/null || echo "❌ build/ directory not found"
ls -la build/index.js 2>/dev/null || echo "❌ build/index.js not found"
ls -la .env 2>/dev/null || echo "❌ .env file not found"

echo ""
echo "📋 PM2 Status:"
pm2 list

echo ""
echo "📝 PM2 Logs (last 50 lines):"
pm2 logs cpto --lines 50 || echo "No logs available"

echo ""
echo "🧪 Test Direct Node.js Execution:"
echo "Testing if the built application can run directly..."
if [ -f "build/index.js" ]; then
    echo "Running: node build/index.js (will timeout after 10 seconds)"
    timeout 10s node build/index.js || {
        exit_code=$?
        if [ $exit_code -eq 124 ]; then
            echo "✅ Application started successfully (timed out as expected)"
        else
            echo "❌ Application failed to start (exit code: $exit_code)"
        fi
    }
else
    echo "❌ build/index.js not found"
fi

echo ""
echo "📄 Check ecosystem.config.js:"
if [ -f "ecosystem.config.js" ]; then
    echo "✅ ecosystem.config.js found"
    echo "Script path: $(node -e "console.log(require('./ecosystem.config.js').apps[0].script)")"
else
    echo "❌ ecosystem.config.js not found"
fi

echo ""
echo "🗂️ Log Files:"
ls -la logs/ 2>/dev/null || echo "❌ logs/ directory not found"

echo ""
echo "🔍 Check for specific error patterns in logs:"
if [ -d "logs" ]; then
    echo "Checking error log for issues..."
    tail -20 logs/cpto-error.log 2>/dev/null || echo "No error log available"
    echo ""
    echo "Checking output log..."
    tail -20 logs/cpto-out.log 2>/dev/null || echo "No output log available"
fi

echo ""
echo "🧪 Environment Variables Check:"
echo "NODE_ENV: ${NODE_ENV:-'not set'}"
echo "LOG_LEVEL: ${LOG_LEVEL:-'not set'}"

echo ""
echo "💡 Troubleshooting suggestions:"
echo "1. Try starting PM2 with more verbose logging:"
echo "   pm2 start ecosystem.config.js --env production --log-type=json"
echo ""
echo "2. Try starting the app directly first:"
echo "   NODE_ENV=production node build/index.js"
echo ""
echo "3. Check if there are any missing dependencies:"
echo "   npm list --production"