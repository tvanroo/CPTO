#!/bin/bash

# Quick Fix: Enable Mock Data Mode for Portfolio Features
# This will make the portfolio balance work with mock data instead of real API calls

echo "🔧 Quick Fix: Enabling Mock Data Mode"
echo "====================================="

# Navigate to project directory
cd /opt/cpto

# Enable mock data mode
echo "📝 Adding SKIP_CONFIG_VALIDATION to .env..."
echo 'SKIP_CONFIG_VALIDATION=true' >> .env

# Add placeholder Gemini credentials if they don't exist
echo "🔑 Adding placeholder Gemini credentials..."
echo 'GEMINI_API_KEY=placeholder_gemini_key' >> .env
echo 'GEMINI_API_SECRET=placeholder_gemini_secret' >> .env
echo 'GEMINI_SANDBOX=true' >> .env

# Show the updated .env file
echo ""
echo "📋 Updated .env file contents:"
echo "-----------------------------"
tail -10 .env

# Restart the processes
echo ""
echo "🔄 Restarting processes..."
pm2 restart cpto-dashboard cpto

echo ""
echo "⏳ Waiting for processes to start..."
sleep 5

# Check status
echo ""
echo "📊 Process status:"
pm2 list | grep cpto

echo ""
echo "✅ Fix applied! Mock data mode enabled."
echo ""
echo "🧪 Test the portfolio balance:"
echo "curl http://localhost:4000/api/portfolio/balance"
echo ""
echo "🌐 Or visit your dashboard and check the portfolio section."
echo ""
echo "📊 Expected mock data:"
echo "  • Total Portfolio: ~$4,000+ USD"
echo "  • USD Balance: $2,500.75"
echo "  • BTC: 0.05432100 (~$2,400)"
echo "  • ETH: 0.87654321 (~$2,500)"
echo "  • LTC: 5.12345678 (~$500)"