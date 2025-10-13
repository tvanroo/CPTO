#!/bin/bash
# fix-pm2-installation.sh
# Fix PM2 installation issues after Node.js 18 installation

echo "🔧 Fixing PM2 installation issues..."

# Fix .npmrc configuration conflicts
echo "📝 Fixing .npmrc configuration..."
if [ -f ~/.npmrc ]; then
    echo "Backing up existing .npmrc..."
    cp ~/.npmrc ~/.npmrc.backup
    echo "Removing conflicting npm configurations..."
    sed -i '/^prefix=/d' ~/.npmrc
    sed -i '/^globalconfig=/d' ~/.npmrc
fi

# Use NVM Node.js 18 and clear prefix
echo "🔄 Switching to Node.js 18 with NVM..."
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use --delete-prefix v18.20.8

# Verify Node.js and npm versions
echo "🔍 Verifying Node.js installation..."
echo "✅ Node.js: $(node --version)"
echo "✅ npm: $(npm --version)"

# Clear npm cache
echo "🧹 Clearing npm cache..."
npm cache clean --force

# Install PM2 globally
echo "📦 Installing PM2 globally..."
npm install -g pm2

# Verify PM2 installation
if command -v pm2 &> /dev/null; then
    echo "✅ PM2 installed successfully: $(pm2 --version)"
    
    # Test PM2 functionality
    echo "🧪 Testing PM2..."
    pm2 list
    
    echo "✅ PM2 installation and configuration completed successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Navigate to your project directory: cd /opt/cpto"
    echo "2. Run the deployment script: ./deploy-production.sh"
else
    echo "❌ PM2 installation failed"
    echo "Debugging information:"
    echo "Node.js path: $(which node)"
    echo "npm path: $(which npm)"
    echo "npm config list:"
    npm config list
    exit 1
fi