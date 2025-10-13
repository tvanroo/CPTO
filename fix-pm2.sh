#!/bin/bash
# Fix PM2 installation for snap Node.js
# Run this on your Ubuntu server after Node.js is installed via snap

echo "🔧 Fixing PM2 installation for snap Node.js..."

# Check Node.js status
echo "📋 Current Node.js status:"
echo "Node.js: $(node --version)"
echo "npm: $(npm --version)"
echo ""

# Method 1: Install PM2 with snap
echo "🔄 Method 1: Installing PM2 with snap..."
sudo snap install pm2

# Add snap PM2 to PATH
export PATH="/snap/bin:$PATH"
if ! grep -q "/snap/bin" ~/.bashrc; then
    echo 'export PATH="/snap/bin:$PATH"' >> ~/.bashrc
fi

# Test PM2
if command -v pm2 &> /dev/null; then
    echo "✅ PM2 installed via snap: $(pm2 --version)"
    exit 0
fi

# Method 2: Fix npm permissions and install PM2
echo "🔄 Method 2: Fixing npm permissions and installing PM2..."

# Create npm global directory in home folder
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'

# Add to PATH
export PATH="$HOME/.npm-global/bin:$PATH"
if ! grep -q ".npm-global/bin" ~/.bashrc; then
    echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
fi

# Now install PM2
npm install -g pm2

# Test PM2
if command -v pm2 &> /dev/null; then
    echo "✅ PM2 installed via npm: $(pm2 --version)"
    exit 0
fi

# Method 3: Use yarn to install PM2 (if available)
if command -v yarn &> /dev/null; then
    echo "🔄 Method 3: Installing PM2 with yarn..."
    yarn global add pm2
    
    # Add yarn global bin to PATH
    YARN_GLOBAL_BIN=$(yarn global bin)
    export PATH="$YARN_GLOBAL_BIN:$PATH"
    if ! grep -q "yarn global bin" ~/.bashrc; then
        echo "export PATH=\"\$(yarn global bin):\$PATH\"" >> ~/.bashrc
    fi
    
    if command -v pm2 &> /dev/null; then
        echo "✅ PM2 installed via yarn: $(pm2 --version)"
        exit 0
    fi
fi

# Method 4: Install yarn first, then PM2
echo "🔄 Method 4: Installing yarn, then PM2..."
npm install -g yarn

if command -v yarn &> /dev/null; then
    yarn global add pm2
    
    # Add yarn global bin to PATH
    YARN_GLOBAL_BIN=$(yarn global bin)
    export PATH="$YARN_GLOBAL_BIN:$PATH"
    if ! grep -q "yarn global bin" ~/.bashrc; then
        echo "export PATH=\"\$(yarn global bin):\$PATH\"" >> ~/.bashrc
    fi
    
    if command -v pm2 &> /dev/null; then
        echo "✅ PM2 installed via yarn: $(pm2 --version)"
        exit 0
    fi
fi

echo "❌ Failed to install PM2. Let's try manual installation..."

# Method 5: Local installation (fallback)
echo "🔄 Method 5: Local PM2 installation..."
mkdir -p ~/pm2-local
cd ~/pm2-local
npm init -y
npm install pm2

# Create a symlink
sudo ln -sf ~/pm2-local/node_modules/.bin/pm2 /usr/local/bin/pm2

if command -v pm2 &> /dev/null; then
    echo "✅ PM2 installed locally with symlink: $(pm2 --version)"
    exit 0
fi

echo "❌ All PM2 installation methods failed."
echo "You can continue with the deployment and run PM2 using npx:"
echo "  npx pm2 start ecosystem.config.js --env production"