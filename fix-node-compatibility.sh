#!/bin/bash
# Fix Node.js compatibility issues
# Run this on your Ubuntu server to fix the snap Node.js npm compatibility issue

echo "🔧 Fixing Node.js compatibility issues..."

# Remove problematic snap Node.js
echo "🗑️  Removing snap Node.js installation..."
sudo snap remove node || true

# Method 1: Use NodeSource repository (the original method that should work now)
echo "🟢 Installing Node.js 18.x from NodeSource..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
if command -v node &> /dev/null && command -v npm &> /dev/null; then
    echo "✅ Node.js installed successfully:"
    echo "  Node.js: $(node --version)"
    echo "  npm: $(npm --version)"
    
    # Test npm functionality
    echo "🧪 Testing npm..."
    npm --version >/dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "✅ npm is working correctly"
    else
        echo "❌ npm test failed, trying alternative..."
        # Method 2: Reinstall npm
        sudo apt-get install -y npm
    fi
else
    echo "❌ NodeSource installation failed, trying Ubuntu repositories..."
    
    # Method 2: Ubuntu repositories
    sudo apt update
    sudo apt install -y nodejs npm
fi

# Update PATH in bashrc
echo "🔄 Updating PATH..."
export PATH="/usr/bin:/usr/local/bin:$PATH"
if ! grep -q "export PATH=\"/usr/bin:/usr/local/bin:\$PATH\"" ~/.bashrc; then
    echo 'export PATH="/usr/bin:/usr/local/bin:$PATH"' >> ~/.bashrc
fi

# Reload shell
source ~/.bashrc || true

# Final verification
echo "🔍 Final verification:"
echo "Node.js: $(node --version)"
echo "npm: $(npm --version)"
echo "Node.js location: $(which node)"
echo "npm location: $(which npm)"

# Test npm with a simple command
npm list -g --depth=0 >/dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✅ npm is fully functional"
else
    echo "⚠️  npm may have issues, but continuing..."
fi

# Install PM2
echo "📦 Installing PM2..."
npm install -g pm2

if command -v pm2 &> /dev/null; then
    echo "✅ PM2 installed: $(pm2 --version)"
else
    echo "❌ PM2 installation failed"
    exit 1
fi

echo "🎉 Node.js compatibility issues fixed!"
echo ""
echo "Next steps:"
echo "1. Navigate to your project: cd /opt/cpto"
echo "2. Run the deployment script: ./deploy-production.sh"