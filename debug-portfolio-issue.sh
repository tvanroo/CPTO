#!/bin/bash

# Debug Portfolio Balance Issue
# Run this on your server to diagnose the Gemini API connection problem

echo "🔍 CPTO Portfolio Debug Script"
echo "=============================="

# Navigate to project directory
cd /opt/cpto

echo "📋 1. Checking environment variables..."
echo "GEMINI_API_KEY exists: $([ -n "$GEMINI_API_KEY" ] && echo "YES" || echo "NO")"
echo "GEMINI_API_SECRET exists: $([ -n "$GEMINI_API_SECRET" ] && echo "YES" || echo "NO")"
echo "GEMINI_SANDBOX: ${GEMINI_SANDBOX:-"not set"}"
echo "SKIP_CONFIG_VALIDATION: ${SKIP_CONFIG_VALIDATION:-"not set"}"

echo ""
echo "📋 2. Checking .env file..."
if [ -f .env ]; then
    echo ".env file exists"
    echo "Gemini keys in .env:"
    grep -E "GEMINI_|SKIP_CONFIG" .env || echo "No Gemini config found in .env"
else
    echo ".env file does not exist"
fi

echo ""
echo "📋 3. Testing API endpoint directly..."
curl -s -w "\nHTTP Status: %{http_code}\n" http://localhost:4000/api/portfolio/balance | head -20

echo ""
echo "📋 4. Checking PM2 logs for errors..."
echo "Dashboard logs (last 10 lines):"
pm2 logs cpto-dashboard --lines 10 --raw | tail -10

echo ""
echo "📋 5. Testing Gemini connection..."
curl -s -w "\nHTTP Status: %{http_code}\n" http://localhost:4000/api/test/gemini

echo ""
echo "🔧 SUGGESTED FIXES:"
echo "=================="
echo ""
echo "Fix 1: Enable mock data mode (RECOMMENDED for testing)"
echo "----------------------------------------"
echo "echo 'SKIP_CONFIG_VALIDATION=true' >> .env"
echo "pm2 restart cpto-dashboard cpto"
echo ""
echo "Fix 2: Add placeholder Gemini keys for development"
echo "-----------------------------------------------"
echo "echo 'GEMINI_API_KEY=placeholder_gemini_key' >> .env"
echo "echo 'GEMINI_API_SECRET=placeholder_gemini_secret' >> .env"
echo "echo 'GEMINI_SANDBOX=true' >> .env"
echo "pm2 restart cpto-dashboard cpto"
echo ""
echo "Fix 3: Use real Gemini sandbox credentials"
echo "----------------------------------------"
echo "# Get sandbox credentials from: https://exchange.sandbox.gemini.com/"
echo "echo 'GEMINI_API_KEY=your_sandbox_key' >> .env"
echo "echo 'GEMINI_API_SECRET=your_sandbox_secret' >> .env" 
echo "echo 'GEMINI_SANDBOX=true' >> .env"
echo "pm2 restart cpto-dashboard cpto"