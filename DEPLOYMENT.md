# Deployment Guide (CPTO)

This document describes how to deploy, run, monitor, and upgrade CPTO in production. It assumes a single-user Ubuntu server with no external user-facing HTTP endpoints.

- Supported OS: Ubuntu 22.04 LTS (recommended)
- Node.js: v18.x LTS or newer
- Process manager: PM2
- Primary AI provider: OpenAI (configurable)

## 1) One-time Server Preparation

1. Create a system user (optional but recommended)
   ```bash
   sudo adduser cpto --disabled-password --gecos "CPTO Bot"
   sudo usermod -aG sudo cpto
   ```
2. Install Node.js 18 LTS
   - Using NodeSource:
     ```bash
     curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
     sudo apt-get install -y nodejs build-essential
     ```
   - Or with nvm:
     ```bash
     curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
     source ~/.nvm/nvm.sh
     nvm install 18
     nvm alias default 18
     ```
3. Install PM2 globally
   ```bash
   sudo npm install -g pm2
   ```
4. Optional: PM2 logrotate (recommended)
   ```bash
   pm2 install pm2-logrotate
   pm2 set pm2-logrotate:max_size 50M
   pm2 set pm2-logrotate:retain 10
   pm2 set pm2-logrotate:compress true
   ```
5. Ensure time sync (important for trading timestamps)
   ```bash
   sudo apt-get update && sudo apt-get install -y chrony
   sudo systemctl enable --now chrony
   ```

## 2) Remote Deployment from Local Machine

If you're deploying from your local machine (e.g., MacOS) to the Ubuntu server:

### SSH Setup

1. Generate SSH key (if you don't have one)
   ```bash
   ssh-keygen -t ed25519 -C "cpto-deployment"
   ```
2. Copy SSH key to server
   ```bash
   ssh-copy-id user@your-server-ip
   ```
3. Test SSH connection
   ```bash
   ssh user@your-server-ip
   ```

### Deployment Methods

**Option A: Git-based deployment (recommended)**

1. SSH into server
   ```bash
   ssh user@your-server-ip
   ```
2. Clone repository on server
   ```bash
   git clone <repository-url>
   cd CPTO
   ```
3. Follow first-time deployment steps below

**Option B: SCP/rsync deployment**

1. Build locally
   ```bash
   npm ci
   npm run build
   ```
2. Copy files to server (excluding node_modules)
   ```bash
   rsync -avz --exclude 'node_modules' --exclude '.git' \
     ./ user@your-server-ip:/path/to/CPTO/
   ```
3. SSH into server and install dependencies
   ```bash
   ssh user@your-server-ip
   cd /path/to/CPTO
   npm ci --production
   ```

**Option C: Automated deployment script**

Create a deployment script locally (e.g., `deploy.sh`):
```bash
#!/bin/bash
set -e

# Load deployment config
source .env.deploy

echo "🚀 Deploying to ${SERVER_HOST}..."

# Sync files
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude '.env' \
  ./ ${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}/

# Remote commands
ssh ${SERVER_USER}@${SERVER_HOST} << 'EOF'
  cd ${SERVER_PATH}
  npm ci --production
  npm run build
  pm2 reload cpto || pm2 start ecosystem.config.js --env production
  pm2 save
EOF

echo "✅ Deployment complete!"
```

Make it executable:
```bash
chmod +x deploy.sh
```

### Environment File Management

**IMPORTANT**: Never commit or transfer .env files via git.

1. Create `.env.deploy` locally (add to .gitignore):
   ```bash
   # Remote server connection
   SERVER_HOST=your-server-ip
   SERVER_USER=cpto
   SERVER_PATH=/home/cpto/CPTO
   SERVER_SSH_KEY=~/.ssh/id_ed25519
   ```

2. Transfer .env securely to server (first time only):
   ```bash
   scp .env user@your-server-ip:/path/to/CPTO/.env
   ssh user@your-server-ip "chmod 600 /path/to/CPTO/.env"
   ```

3. Or create .env directly on server:
   ```bash
   ssh user@your-server-ip
   cd /path/to/CPTO
   cp .env.example .env
   nano .env  # Edit with real values
   chmod 600 .env
   ```

## 3) First-time Deployment

1. Clone the repository (if not using remote deployment)
   ```bash
   git clone <repository-url>
   cd CPTO
   ```
2. Install dependencies
   ```bash
   npm ci
   ```
3. Configure environment (if not already done)
   ```bash
   cp .env.example .env
   # Edit .env to add real API keys and configuration
   ```
   Required keys (see README for full list):
   - Reddit: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD, REDDIT_USER_AGENT
   - OpenAI: OPENAI_API_KEY, OPENAI_MODEL
   - TokenMetrics: TOKENMETRICS_API_KEY

   Notes:
   - For local/dev you can set SKIP_CONFIG_VALIDATION=true to enable mock clients.
   - Do NOT commit .env; keep it on the server only.

4. Build the app
   ```bash
   npm run build
   ```
5. Start with PM2 (background by default)
   ```bash
   pm2 start ecosystem.config.js --env production
   pm2 status
   ```
6. Enable auto-start on reboot (Ubuntu)
   ```bash
   pm2 startup
   pm2 save
   ```

The PM2 app name is defined as "cpto" in ecosystem.config.js. Logs are written to ./logs/.

## 4) Operating the Service

- Check status
  ```bash
  pm2 status
  ```
- Tail logs
  ```bash
  pm2 logs cpto
  ```
- Restart (background, non-blocking)
  ```bash
  pm2 restart cpto
  ```
- Stop / Delete
  ```bash
  pm2 stop cpto
  pm2 delete cpto
  ```
- Real-time monitor
  ```bash
  pm2 monit
  ```

## 5) Upgrade / Redeploy

When a new version is pushed:

```bash
cd /path/to/CPTO
git pull
npm ci
npm run build
pm2 reload cpto   # or `pm2 restart cpto`
pm2 save          # persists current process list
```

Rollback:

```bash
git checkout <previous-tag-or-commit>
npm ci
npm run build
pm2 restart cpto
```

**Remote upgrade:**
```bash
# From local machine
ssh user@your-server-ip << 'EOF'
  cd /path/to/CPTO
  git pull
  npm ci
  npm run build
  pm2 reload cpto
  pm2 save
EOF
```

Or use your deployment script:
```bash
./deploy.sh
```

## 6) Logs and Troubleshooting

Log files (see ecosystem.config.js):
- ./logs/cpto-out.log (stdout)
- ./logs/cpto-error.log (stderr)
- ./logs/cpto-combined.log (merged)

Helpful commands:
```bash
pm2 logs cpto --lines 200
pm2 describe cpto
pm2 env 0   # inspect env for app id 0
```

Common issues:
- API credentials invalid or missing → verify .env, run `npm run test:config` if available.
- Rate limits → reduce throughput or adjust MAX_TRADES_PER_HOUR.
- Memory restarts → default max is 1G; inspect for spikes; increase cautiously in ecosystem.config.js if needed.

**Remote log viewing:**
```bash
ssh user@your-server-ip "pm2 logs cpto --lines 100 --nostream"
```

## 7) Security & Secrets

- Keep .env readable only by the service user:
  ```bash
  chmod 600 .env
  ```
- Never echo or log secret values.
- Limit server access and keep Node/PM2 updated.
- Use a dedicated non-root user (e.g., cpto) to run the service.

- SSH key authentication:
  ```bash
  # Use specific key
  ssh -i ~/.ssh/cpto_key user@server-ip
  
  # Or add to ~/.ssh/config
  Host cpto-server
    HostName your-server-ip
    User cpto
    IdentityFile ~/.ssh/cpto_key
    Port 22
  ```

## 8) Local Development vs. Production

- Local/dev:
  ```bash
  npm run dev               # hot reload, mock external APIs if SKIP_CONFIG_VALIDATION=true
  ```
- Production:
  ```bash
  npm run build
  pm2 start ecosystem.config.js --env production
  ```

## 9) Environment Variables (Summary)

See README for the full table. Key parameters you will likely tune:
- SUBREDDITS
- SENTIMENT_THRESHOLD
- TRADE_AMOUNT_USD
- MAX_TRADES_PER_HOUR
- LOG_LEVEL

**Deployment-specific (local .env.deploy):**
- SERVER_HOST - IP or hostname of deployment server
- SERVER_USER - SSH username
- SERVER_PATH - Absolute path to CPTO on server
- SERVER_SSH_KEY - Path to SSH private key

## 10) Backups

- Backup the .env file and any persistent artifacts you add under data/ (if created in the future).
- Logs are rotational/ephemeral; preserve only if required for audits.

**Remote backup:**
```bash
scp user@server-ip:/path/to/CPTO/.env ./backups/.env.backup-$(date +%Y%m%d)
```

## 11) Notes

- The app is event-driven and does not expose a public HTTP port; firewall changes are typically unnecessary.
- PM2 starts processes in the background by default, satisfying the preference to keep the shell free for other tasks.