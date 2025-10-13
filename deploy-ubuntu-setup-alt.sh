#!/bin/bash
# CPTO Ubuntu Server Setup Script (Alternative Method)
# Run this on your Ubuntu 22.04 server if the main setup script fails

set -e  # Exit on any error

echo "🚀 Setting up Ubuntu server for CPTO deployment (Alternative method)..."

# Update system
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Method 1: Try using Ubuntu's default Node.js
echo "🟢 Installing Node.js from Ubuntu repositories..."
sudo apt install -y nodejs npm

# Check versions
if command -v node &> /dev/null && command -v npm &> /dev/null; then
    node_version=$(node --version)
    npm_version=$(npm --version)
    echo "✅ Node.js installed: $node_version"
    echo "✅ npm installed: $npm_version"
    
    # Check if version is adequate (should be 12+)
    node_major_version=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$node_major_version" -lt 16 ]; then
        echo "⚠️  Node.js version is older than recommended. Installing newer version..."
        
        # Method 2: Use snap to install newer Node.js
        sudo snap install node --classic
        
        # Update PATH to use snap version
        export PATH="/snap/bin:$PATH"
        echo 'export PATH="/snap/bin:$PATH"' >> ~/.bashrc
        
        if command -v node &> /dev/null; then
            node_version=$(node --version)
            npm_version=$(npm --version)
            echo "✅ Updated Node.js: $node_version"
            echo "✅ Updated npm: $npm_version"
        fi
    fi
else
    echo "❌ Failed to install Node.js with apt. Trying snap method..."
    
    # Method 2: Use snap
    sudo snap install node --classic
    
    # Update PATH
    export PATH="/snap/bin:$PATH"
    echo 'export PATH="/snap/bin:$PATH"' >> ~/.bashrc
    
    if command -v node &> /dev/null && command -v npm &> /dev/null; then
        node_version=$(node --version)
        npm_version=$(npm --version)
        echo "✅ Node.js installed via snap: $node_version"
        echo "✅ npm installed via snap: $npm_version"
    else
        echo "❌ All Node.js installation methods failed"
        exit 1
    fi
fi

# Install PM2 globally
echo "⚙️  Installing PM2 globally..."
npm install -g pm2

# Verify PM2 installation
if command -v pm2 &> /dev/null; then
    pm2_version=$(pm2 --version)
    echo "✅ PM2 installed: $pm2_version"
else
    echo "❌ PM2 installation failed"
    exit 1
fi

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
echo "🔍 Installed versions:"
echo "  Node.js: $(node --version)"
echo "  npm: $(npm --version)"
echo "  PM2: $(pm2 --version)"
echo ""
echo "Next steps:"
echo "1. Clone your CPTO repository to /opt/cpto/"
echo "2. Set up your .env file with production API keys"
echo "3. Run the deployment script"
echo ""
echo "Repository clone commands:"
echo "cd /opt && git clone <your-repo-url> cpto"
echo "# OR if using SSH:"
echo "cd /opt && git clone git@github.com:your-username/CPTO.git cpto"