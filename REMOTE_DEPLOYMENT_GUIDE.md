# Remote Deployment Guide

## Quick Deploy Script

To deploy changes from your local machine to the remote Ubuntu server, use this one-liner:

```bash
cd /Users/toby/Documents/GitHub/CPTO && source .env && ssh -i ${SSH_KEY_PATH} -p ${SSH_PORT} ${SERVER_USERNAME}@${SERVER_IP} "source ~/.nvm/nvm.sh && cd ${SERVER_PATH} && git pull && pm2 restart cpto"
```

## Environment Variables (.env)

The deployment uses these variables from `.env`:

```bash
SERVER_IP=<your-server-ip>        # Ubuntu server IP address
SERVER_USERNAME=tvanroo            # SSH username
SERVER_PATH=/opt/cpto              # Path to CPTO on server
SSH_KEY_PATH=~/.ssh/id_ed25519     # SSH private key location
SSH_PORT=22                        # SSH port (default 22)
```

## Step-by-Step Process

### 1. Push Changes to GitHub

```bash
git add -A
git commit -m "Your commit message"
git push
```

### 2. Deploy to Remote Server

**Option A: Single Command (Recommended)**
```bash
cd ~/Documents/GitHub/CPTO && \
source .env && \
ssh -i ${SSH_KEY_PATH} -p ${SSH_PORT} ${SERVER_USERNAME}@${SERVER_IP} \
"source ~/.nvm/nvm.sh && cd ${SERVER_PATH} && git pull && pm2 restart cpto"
```

**Option B: Interactive SSH Session**
```bash
# Connect to server
ssh -i ~/.ssh/id_ed25519 tvanroo@<SERVER_IP>

# On the server
cd /opt/cpto
git pull
pm2 restart cpto
pm2 list  # Verify status
```

### 3. Verify Deployment

```bash
# Check PM2 status
source .env && ssh -i ${SSH_KEY_PATH} ${SERVER_USERNAME}@${SERVER_IP} "source ~/.nvm/nvm.sh && pm2 list"

# Check application logs
source .env && ssh -i ${SSH_KEY_PATH} ${SERVER_USERNAME}@${SERVER_IP} "source ~/.nvm/nvm.sh && pm2 logs cpto --lines 50"
```

## Important Notes

### NVM Requirement
⚠️ **Critical:** The server uses NVM (Node Version Manager), so you **must** source it before running `pm2`:

```bash
source ~/.nvm/nvm.sh
```

Without this, you'll get `pm2: command not found` errors in non-interactive SSH sessions.

### Background Restart Preference
Per user preference, PM2 restarts should maintain chat availability. The commands above run in the foreground but complete quickly. For truly background operations:

```bash
ssh ... "source ~/.nvm/nvm.sh && cd ${SERVER_PATH} && git pull && pm2 restart cpto > /dev/null 2>&1 &"
```

### Server Details
- **Operating System:** Ubuntu Server
- **Node.js:** Managed via NVM
- **Process Manager:** PM2
- **App Location:** `/opt/cpto`
- **App Name in PM2:** `cpto`

## Troubleshooting

### PM2 Not Found
**Error:** `bash: pm2: command not found`

**Solution:** Source NVM before running PM2 commands:
```bash
source ~/.nvm/nvm.sh && pm2 ...
```

### Permission Denied
**Error:** `Permission denied (publickey)`

**Solution:** Verify SSH key path in `.env` is correct and key has proper permissions:
```bash
chmod 600 ~/.ssh/id_ed25519
```

### Git Pull Fails
**Error:** `error: Your local changes would be overwritten`

**Solution:** SSH into server and stash/discard local changes:
```bash
ssh -i ~/.ssh/id_ed25519 tvanroo@<SERVER_IP>
cd /opt/cpto
git stash  # or git reset --hard origin/feature/unify-dashboard
```

### PM2 Restart Issues
**Error:** Process keeps restarting or crashes

**Solution:** Check logs for errors:
```bash
ssh ... "source ~/.nvm/nvm.sh && pm2 logs cpto --lines 100"
```

## Automation Script (Optional)

Create a deploy script `deploy.sh`:

```bash
#!/bin/bash
set -e  # Exit on error

echo "🚀 Starting deployment to remote server..."

# Source environment variables
source .env

# Deploy
ssh -i ${SSH_KEY_PATH} -p ${SSH_PORT} ${SERVER_USERNAME}@${SERVER_IP} << 'ENDSSH'
  # Source NVM
  source ~/.nvm/nvm.sh
  
  # Navigate to app directory
  cd /opt/cpto
  
  # Pull latest changes
  echo "📥 Pulling latest changes..."
  git pull
  
  # Install dependencies (if needed)
  # npm install
  
  # Rebuild TypeScript (if needed)
  # npm run build
  
  # Restart PM2
  echo "🔄 Restarting PM2..."
  pm2 restart cpto
  
  # Show status
  echo "✅ Deployment complete!"
  pm2 list
ENDSSH

echo "✅ Remote deployment successful!"
```

Make it executable:
```bash
chmod +x deploy.sh
./deploy.sh
```

## Dashboard Access

After deployment, the dashboard should be accessible at:
- **Local/SSH tunnel:** `http://localhost:4000`
- **Remote:** `http://<SERVER_IP>:4000`

## Rollback Procedure

If you need to rollback to a previous version:

```bash
ssh -i ~/.ssh/id_ed25519 tvanroo@<SERVER_IP>
cd /opt/cpto
git log --oneline -10  # Find commit hash
git reset --hard <commit-hash>
source ~/.nvm/nvm.sh
pm2 restart cpto
```

---

**Last Updated:** 2025-10-19  
**Server:** Ubuntu @ /opt/cpto  
**Branch:** feature/unify-dashboard
