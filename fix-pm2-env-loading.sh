#!/bin/bash

# Fix PM2 Environment Loading for Gemini API
# This ensures PM2 properly loads your .env file with real API credentials

echo "🔧 Fixing PM2 Environment Loading"
echo "================================="

# Navigate to project directory
cd /opt/cpto

echo "📋 1. Checking current .env file..."
if [ ! -f .env ]; then
    echo "❌ .env file not found! Creating one..."
    touch .env
fi

# Show current environment variables (masked)
echo "Current Gemini config in .env:"
grep -E "GEMINI_|SKIP_CONFIG" .env | sed 's/\(=\).*/\1***MASKED***/' || echo "No Gemini config found"

echo ""
echo "🛑 2. Stopping current PM2 processes..."
pm2 stop cpto-dashboard cpto || true
pm2 delete cpto-dashboard cpto || true

echo ""
echo "📝 3. Ensuring proper environment configuration..."

# Remove any SKIP_CONFIG_VALIDATION that might force mock mode
sed -i '/SKIP_CONFIG_VALIDATION/d' .env 2>/dev/null || true

# Ensure we have the required structure for ecosystem.config.js
echo ""
echo "📋 4. Checking ecosystem.config.js..."
if [ ! -f ecosystem.config.js ]; then
    echo "⚠️ ecosystem.config.js not found. Creating one..."
    cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'cpto',
      script: 'build/index.js',
      env: {
        NODE_ENV: 'production'
      },
      env_file: '.env',
      error_file: './logs/cpto-error.log',
      out_file: './logs/cpto-out.log',
      log_file: './logs/cpto-combined.log',
      time: true,
      max_memory_restart: '1G'
    },
    {
      name: 'cpto-dashboard',
      script: 'build/dashboard.js',
      env: {
        NODE_ENV: 'production'
      },
      env_file: '.env',
      error_file: './logs/dashboard-error.log',
      out_file: './logs/dashboard-out.log',
      log_file: './logs/dashboard-combined.log',
      time: true,
      max_memory_restart: '500M'
    }
  ]
};
EOF
else
    echo "✅ ecosystem.config.js exists"
fi

echo ""
echo "📁 5. Creating logs directory..."
mkdir -p logs

echo ""
echo "🔄 6. Starting processes with ecosystem config..."
pm2 start ecosystem.config.js

echo ""
echo "⏳ 7. Waiting for processes to initialize..."
sleep 10

echo ""
echo "📊 8. Checking process status..."
pm2 list

echo ""
echo "🧪 9. Testing Gemini API connection..."
echo "Testing API connection endpoint:"
curl -s http://localhost:4000/api/test/gemini | jq '.' || curl -s http://localhost:4000/api/test/gemini

echo ""
echo ""
echo "🧪 10. Testing portfolio balance endpoint..."
echo "Testing portfolio balance:"
curl -s http://localhost:4000/api/portfolio/balance | jq '.' || curl -s http://localhost:4000/api/portfolio/balance

echo ""
echo ""
echo "📋 11. Recent logs for troubleshooting:"
echo "Dashboard logs (last 10 lines):"
pm2 logs cpto-dashboard --lines 10 --raw | tail -10

echo ""
echo "✅ PM2 Environment Fix Complete!"
echo ""
echo "🔍 If you still see errors, check:"
echo "1. Your Gemini API key has 'Auditor' permissions"
echo "2. You're not hitting rate limits (120 req/min)"
echo "3. Your API key format is correct (starts with 'account-')"
echo ""
echo "🌐 Visit your dashboard: http://$(curl -s ifconfig.me):4000"
echo ""
echo "🔧 To view detailed logs: pm2 logs cpto-dashboard"