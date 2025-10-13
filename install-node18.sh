#!/bin/bash
# Definitive Node.js 18 installation for Ubuntu 22.04
# This script ensures Node.js 18+ is properly installed for CPTO

echo "🚀 Installing Node.js 18+ for CPTO deployment..."

# Remove any existing Node.js installations
echo "🗑️  Removing existing Node.js installations..."
sudo apt remove -y nodejs npm
sudo snap remove node 2>/dev/null || true

# Remove any leftover files
sudo rm -rf /usr/local/bin/node /usr/local/bin/npm
sudo rm -rf /usr/bin/node /usr/bin/npm

# Method 1: Use NVM (Node Version Manager) - most reliable
echo "📦 Installing Node.js 18 using NVM..."
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Load NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# Install Node.js 18
nvm install 18
nvm use 18
nvm alias default 18

# Add to bashrc for persistence
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.bashrc
echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> ~/.bashrc
echo '[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"' >> ~/.bashrc

# Reload bashrc
source ~/.bashrc || true

# Verify installation
echo "🔍 Verifying Node.js installation..."
node_version=$(node --version)
npm_version=$(npm --version)

echo "✅ Node.js: $node_version"
echo "✅ npm: $npm_version"

# Check if version is adequate
node_major=$(echo $node_version | sed 's/v//' | cut -d'.' -f1)
if [ "$node_major" -lt 16 ]; then
    echo "❌ Node.js version is still too old: $node_version"
    echo "🔄 Trying alternative method..."
    
    # Method 2: Try binary installation
    echo "📥 Installing Node.js 18 from official binaries..."
    cd /tmp
    wget https://nodejs.org/dist/v18.20.4/node-v18.20.4-linux-x64.tar.xz
    tar -xf node-v18.20.4-linux-x64.tar.xz
    sudo cp -r node-v18.20.4-linux-x64/{bin,include,lib,share} /usr/local/
    
    # Verify again
    node_version=$(node --version)
    npm_version=$(npm --version)
    echo "✅ Node.js (binary): $node_version"
    echo "✅ npm (binary): $npm_version"
fi

# Test npm functionality
echo "🧪 Testing npm..."
npm --version > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✅ npm is working correctly"
else
    echo "❌ npm test failed"
    exit 1
fi

# Install PM2
echo "📦 Installing PM2..."
npm install -g pm2

# Verify PM2
if command -v pm2 &> /dev/null; then
    echo "✅ PM2 installed: $(pm2 --version)"
else
    echo "❌ PM2 installation failed"
    exit 1
fi

# Create a simple test
echo "🧪 Testing PM2..."
echo "console.log('PM2 test successful')" > /tmp/test.js
pm2 start /tmp/test.js --name test
sleep 2
pm2 logs test --lines 1
pm2 delete test
rm /tmp/test.js

echo "🎉 Node.js 18+ and PM2 installation completed successfully!"
echo ""
echo "📋 Installed versions:"
echo "  Node.js: $(node --version)"
echo "  npm: $(npm --version)"  
echo "  PM2: $(pm2 --version)"
echo ""
echo "🚀 Next steps:"
echo "1. Navigate to your project: cd /opt/cpto"
echo "2. Pull latest changes: git pull"
echo "3. Run deployment: ./deploy-production.sh"