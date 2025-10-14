#!/bin/bash

# Debug Real Gemini API Connection Issues
# Run this on your server to diagnose why real API calls are failing

echo "🔍 Debugging Real Gemini API Connection"
echo "======================================"

# Navigate to project directory
cd /opt/cpto

echo "📋 1. Checking .env file configuration..."
if [ -f .env ]; then
    echo "✅ .env file exists"
    echo ""
    echo "Environment variables related to Gemini:"
    grep -E "GEMINI_|SKIP_CONFIG" .env | sed 's/=.*/=***HIDDEN***/' || echo "❌ No Gemini config found"
    echo ""
    echo "Full .env check (values hidden for security):"
    while IFS= read -r line; do
        if [[ $line == GEMINI_API_KEY=* ]]; then
            echo "GEMINI_API_KEY=***${line: -4}***"
        elif [[ $line == GEMINI_API_SECRET=* ]]; then
            echo "GEMINI_API_SECRET=***${line: -4}***"
        elif [[ $line == *API* ]] || [[ $line == *SECRET* ]] || [[ $line == *KEY* ]]; then
            echo "${line%%=*}=***HIDDEN***"
        else
            echo "$line"
        fi
    done < .env
else
    echo "❌ .env file does not exist!"
    exit 1
fi

echo ""
echo "📋 2. Testing environment variable loading..."
# Source the .env file and test
set -a
source .env
set +a

echo "GEMINI_API_KEY length: ${#GEMINI_API_KEY} characters"
echo "GEMINI_API_SECRET length: ${#GEMINI_API_SECRET} characters"
echo "GEMINI_SANDBOX: ${GEMINI_SANDBOX:-"not set"}"
echo "SKIP_CONFIG_VALIDATION: ${SKIP_CONFIG_VALIDATION:-"not set"}"

echo ""
echo "📋 3. Checking PM2 environment loading..."
echo "PM2 processes with environment:"
pm2 show cpto-dashboard | grep -A 20 "Environment"

echo ""
echo "📋 4. Testing API endpoint with detailed error..."
echo "Making request to portfolio balance endpoint..."
curl -v -H "Content-Type: application/json" http://localhost:4000/api/portfolio/balance 2>&1

echo ""
echo "📋 5. Checking PM2 logs for specific errors..."
echo "Recent dashboard logs (last 20 lines):"
pm2 logs cpto-dashboard --lines 20 --raw | grep -E "(error|Error|ERROR|fail|Fail|FAIL)" || echo "No error messages found"

echo ""
echo "📋 6. Testing Gemini connection endpoint..."
curl -v http://localhost:4000/api/test/gemini 2>&1

echo ""
echo "🔧 POTENTIAL FIXES:"
echo "=================="
echo ""
echo "Fix 1: Ensure PM2 loads .env file correctly"
echo "-------------------------------------------"
echo "pm2 stop cpto-dashboard cpto"
echo "pm2 delete cpto-dashboard cpto"
echo "pm2 start ecosystem.config.js"
echo ""
echo "Fix 2: Check if your Gemini API keys are valid"
echo "----------------------------------------------"
echo "# Test your API key directly with Gemini's API:"
echo "# Visit: https://docs.gemini.com/rest-api/"
echo ""
echo "Fix 3: Verify Gemini API key permissions"
echo "----------------------------------------"
echo "# Your API key needs 'Auditor' permission for balance queries"
echo "# Check at: https://exchange.gemini.com/settings/api"
echo ""
echo "Fix 4: Check if you're hitting rate limits"
echo "-----------------------------------------"
echo "# Gemini has rate limits: 120 requests per minute for private APIs"
echo "# Wait a few minutes if you've been testing frequently"
echo ""
echo "Fix 5: Manually test API key format"
echo "----------------------------------"
echo "# Your API key should start with 'account-' for production"
echo "# or 'account-' for sandbox"
echo ""
echo "Fix 6: Enable debug mode for more detailed logs"
echo "----------------------------------------------"
echo "echo 'NODE_ENV=development' >> .env"
echo "pm2 restart cpto-dashboard cpto"