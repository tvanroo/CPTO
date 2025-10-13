#!/bin/bash
# CPTO Ubuntu Server Setup Script
# Run this on your Ubuntu 22.04 server

set -e  # Exit on any error

echo "🚀 Setting up Ubuntu server for CPTO deployment..."

# Update system
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js 18.x
echo "🟢 Installing Node.js 18.x..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Reload shell environment
source ~/.bashrc || true
export PATH="/usr/bin:/usr/local/bin:$PATH"

# Wait a moment for installation to complete
sleep 2

# Verify Node.js installation
if command -v node &> /dev/null; then
    node_version=$(node --version)
    echo "✅ Node.js installed: $node_version"
else
    echo "❌ Node.js installation failed"
    exit 1
fi

if command -v npm &> /dev/null; then
    npm_version=$(npm --version)
    echo "✅ npm installed: $npm_version"
else
    echo "❌ npm not found, trying to install manually..."
    sudo apt-get install -y npm
    if command -v npm &> /dev/null; then
        npm_version=$(npm --version)
        echo "✅ npm installed: $npm_version"
    else
        echo "❌ npm installation failed"
        exit 1
    fi
fi

# Install PM2 globally
echo "⚙️  Installing PM2 globally..."
sudo npm install -g pm2

# Verify PM2 installation
pm2_version=$(pm2 --version)
echo "✅ PM2 installed: $pm2_version"

# Create application directory
echo "📁 Creating application directory..."
sudo mkdir -p /opt/cpto
sudo chown $USER:$USER /opt/cpto

# Create logs directory
echo "📝 Creating logs directory..."
mkdir -p /opt/cpto/logs

# Install git (if not already installed)
if ! command -v git &> /dev/null; then
    echo "📚 Installing git..."
    sudo apt install -y git
fi

# Install other useful utilities
echo "🔧 Installing additional utilities..."
sudo apt install -y curl wget htop

echo "✅ Ubuntu server setup complete!"
echo ""
echo "Next steps:"
echo "1. Clone your CPTO repository to /opt/cpto/"
echo "2. Set up your .env file with production API keys"
echo "3. Run the deployment script"
echo ""
echo "Repository clone command:"
echo "cd /opt && git clone https://github.com/tvanroo/CPTO.git cpto"
echo "# OR if using SSH:"
echo "cd /opt && git clone git@github.com:tvanroo/CPTO.git cpto"
