#!/bin/bash
# Node.js Installation Troubleshooting Script
# Run this on your Ubuntu server to fix Node.js installation issues

echo "🔧 Troubleshooting Node.js installation..."

# Check current status
echo "📋 Current status:"
echo "Node.js: $(command -v node && node --version || echo 'Not found')"
echo "npm: $(command -v npm && npm --version || echo 'Not found')"
echo "PATH: $PATH"
echo ""

# Method 1: Reload shell and check PATH
echo "🔄 Step 1: Reloading shell environment..."
source ~/.bashrc 2>/dev/null || true
source ~/.bash_profile 2>/dev/null || true
export PATH="/usr/bin:/usr/local/bin:/snap/bin:$PATH"

echo "Updated PATH: $PATH"

if command -v node &> /dev/null && command -v npm &> /dev/null; then
    echo "✅ Node.js and npm found after PATH update!"
    echo "Node.js: $(node --version)"
    echo "npm: $(npm --version)"
    exit 0
fi

# Method 2: Try installing with snap
echo "🔄 Step 2: Installing Node.js with snap..."
sudo snap install node --classic

# Update PATH for snap
export PATH="/snap/bin:$PATH"
echo 'export PATH="/snap/bin:$PATH"' >> ~/.bashrc

echo "Updated PATH with snap: $PATH"

if command -v node &> /dev/null && command -v npm &> /dev/null; then
    echo "✅ Node.js installed successfully with snap!"
    echo "Node.js: $(node --version)"
    echo "npm: $(npm --version)"
    
    # Install PM2
    echo "Installing PM2..."
    npm install -g pm2
    echo "✅ PM2 installed: $(pm2 --version)"
    exit 0
fi

# Method 3: Manual installation from Ubuntu repos
echo "🔄 Step 3: Installing from Ubuntu repositories..."
sudo apt update
sudo apt install -y nodejs npm

if command -v node &> /dev/null && command -v npm &> /dev/null; then
    echo "✅ Node.js installed from Ubuntu repos!"
    echo "Node.js: $(node --version)"
    echo "npm: $(npm --version)"
    
    # Install PM2
    echo "Installing PM2..."
    npm install -g pm2
    echo "✅ PM2 installed: $(pm2 --version)"
    exit 0
fi

# Method 4: Try NVM (Node Version Manager)
echo "🔄 Step 4: Installing with NVM..."
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

if command -v nvm &> /dev/null; then
    nvm install 18
    nvm use 18
    
    if command -v node &> /dev/null && command -v npm &> /dev/null; then
        echo "✅ Node.js installed with NVM!"
        echo "Node.js: $(node --version)"
        echo "npm: $(npm --version)"
        
        # Install PM2
        echo "Installing PM2..."
        npm install -g pm2
        echo "✅ PM2 installed: $(pm2 --version)"
        exit 0
    fi
fi

echo "❌ All installation methods failed. Manual intervention required."
echo ""
echo "Please try these steps manually:"
echo "1. Check if you have sudo access: sudo whoami"
echo "2. Update package lists: sudo apt update"
echo "3. Install Node.js: sudo apt install -y nodejs npm"
echo "4. Check installation: node --version && npm --version"
echo "5. If still failing, check Ubuntu version: lsb_release -a"