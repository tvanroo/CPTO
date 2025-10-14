# Manual vs Autopilot Trading Mode Implementation

## 🎯 **Feature Overview**

Your CPTO bot now supports two trading modes:

1. **📋 Manual Mode**: Trades require your approval before execution
2. **🚀 Autopilot Mode**: Trades execute automatically (original behavior)

## ⚙️ **Configuration**

Add these environment variables to your `.env` file:

```bash
# Trading mode: 'manual' or 'autopilot'
TRADING_MODE=manual

# Hours before pending trades expire (manual mode only)
PENDING_TRADE_EXPIRY_HOURS=2
```

## 🎮 **Dashboard Interface**

### **New Dashboard Components:**

1. **Trading Mode Toggle**
   - Switch between Manual and Autopilot modes
   - Located in Configuration section
   - UI updates immediately, server restart required for actual mode change

2. **Pending Trades Card**
   - Shows all trades awaiting approval (Manual mode only)
   - Real-time statistics: Pending, Approved, Rejected counts
   - Disabled/grayed out in Autopilot mode

3. **Individual Trade Cards**
   - **Trade Details**: Action (BUY/SELL), Ticker, Amount, Confidence
   - **Market Context**: Sentiment score, reasoning, source subreddit
   - **Time Limit**: Countdown timer showing time until expiry
   - **Actions**: Approve, Reject, or View Details buttons

4. **Bulk Actions**
   - "Approve All" button for mass approval
   - "Reject All" button for mass rejection
   - Confirmation dialogs prevent accidental bulk operations

## 🔄 **How It Works**

### **Manual Mode Flow:**
1. Bot analyzes Reddit posts and generates trade signals
2. Instead of executing immediately, trades are added to pending queue
3. You receive real-time notification of new pending trade
4. Dashboard shows trade card with all relevant information
5. You approve or reject trades individually or in bulk
6. Approved trades execute immediately through Gemini
7. Rejected trades are logged and discarded
8. Trades auto-expire after configured time limit

### **Autopilot Mode Flow:**
1. Bot analyzes Reddit posts and generates trade signals
2. Trades execute immediately (original behavior)
3. Pending trades system is bypassed
4. All trades happen automatically without human intervention

## 🌐 **API Endpoints**

```javascript
// Get pending trades
GET /api/trades/pending

// Get all trades (pending, approved, rejected, expired)
GET /api/trades/all

// Approve specific trade
POST /api/trades/:tradeId/approve
Body: { reason: "Manual approval reason" }

// Reject specific trade
POST /api/trades/:tradeId/reject
Body: { reason: "Manual rejection reason" }

// Bulk approve/reject
POST /api/trades/bulk/approve
POST /api/trades/bulk/reject
Body: { tradeIds: ["trade1", "trade2"], reason: "Bulk operation" }

// Get statistics
GET /api/trades/statistics

// Request trading mode change
POST /api/trading/mode
Body: { mode: "manual" | "autopilot" }
```

## 🔔 **Real-Time Notifications**

The dashboard receives live updates for:
- **New pending trades**: Immediate notification when bot finds opportunity
- **Trade approvals**: Confirmation when you approve trades
- **Trade rejections**: Acknowledgment when you reject trades  
- **Trade expirations**: Warning when trades expire without action
- **Bulk operations**: Status updates for mass approve/reject actions

## 🎛️ **Usage Examples**

### **Starting in Manual Mode:**
1. Set `TRADING_MODE=manual` in `.env`
2. Restart bot: `pm2 restart cpto cpto-dashboard`
3. Start bot from dashboard
4. Bot processes Reddit posts and creates pending trades
5. Dashboard shows notification: "📋 New trade awaiting approval: BUY BTC ($100)"
6. Review trade details and click "Approve" or "Reject"

### **Switching to Autopilot:**
1. Set `TRADING_MODE=autopilot` in `.env`
2. Restart bot: `pm2 restart cpto cpto-dashboard`
3. Bot now executes all qualifying trades automatically
4. Pending trades section becomes disabled in dashboard

## 🛡️ **Safety Features**

1. **Trade Expiration**: Pending trades expire after 2 hours (configurable)
2. **Confirmation Dialogs**: Bulk operations require confirmation
3. **Real-time Updates**: Dashboard automatically refreshes trade status
4. **Rate Limiting**: Same rate limits apply regardless of mode
5. **Logging**: All approvals/rejections are logged with timestamps and reasons

## 📊 **Dashboard Statistics**

The Pending Trades card shows:
- **Pending**: Number of trades awaiting your decision
- **Approved Today**: Trades you've approved in current session
- **Rejected Today**: Trades you've rejected in current session

## ⚡ **Performance Impact**

**Manual Mode:**
- ➕ **Benefits**: Full control, review before execution, no unwanted trades
- ➖ **Drawbacks**: Requires active monitoring, may miss time-sensitive opportunities

**Autopilot Mode:**
- ➕ **Benefits**: Immediate execution, no manual intervention needed, faster response
- ➖ **Drawbacks**: No human oversight, potential for unwanted trades

## 🔧 **Configuration Options**

```bash
# Essential settings for manual mode
TRADING_MODE=manual              # Enable manual approval
PENDING_TRADE_EXPIRY_HOURS=2     # Trades expire after 2 hours
SENTIMENT_THRESHOLD=0.6          # Higher threshold for fewer trades
MAX_TRADES_PER_HOUR=5           # Rate limiting still applies
TRADE_AMOUNT_USD=100            # Default trade amount
```

## 🚀 **Deployment**

To deploy this new feature:

1. **Update Code**: All files already updated with manual trading support
2. **Update Environment**: Add `TRADING_MODE=manual` and `PENDING_TRADE_EXPIRY_HOURS=2` to `.env`
3. **Build & Restart**: `npm run build && pm2 restart cpto cpto-dashboard`
4. **Verify**: Dashboard should show new "Pending Trades" card and "Trading Mode" toggle

## 🎯 **Recommended Usage Patterns**

**For Conservative Trading:**
- Use Manual mode with `SENTIMENT_THRESHOLD=0.7`
- Review each trade carefully
- Approve only high-confidence signals

**For Active Trading:**
- Use Autopilot mode with `SENTIMENT_THRESHOLD=0.5`
- Set appropriate `MAX_TRADES_PER_HOUR` limit
- Monitor results regularly

**For Learning/Testing:**
- Start with Manual mode and `TRADE_AMOUNT_USD=10`
- Review bot's reasoning for each trade
- Switch to Autopilot once comfortable with performance

## 🐛 **Troubleshooting**

**Pending Trades Not Appearing:**
- Check `TRADING_MODE=manual` in `.env`
- Verify bot is running and processing Reddit posts
- Check dashboard logs for errors

**Trades Not Executing After Approval:**
- Check Gemini API connectivity
- Verify sufficient account balance
- Review PM2 logs: `pm2 logs cpto`

**Dashboard Not Updating:**
- Refresh browser page
- Check Socket.IO connection in browser console
- Verify dashboard is running: `pm2 list`

## 🎉 **Ready to Use!**

Your CPTO bot now offers the flexibility to:
- ✅ **Trade with confidence** using manual approval
- ✅ **Scale automatically** using autopilot mode  
- ✅ **Switch modes** based on market conditions
- ✅ **Monitor everything** through the enhanced dashboard

The manual approval system gives you complete control over your trading strategy while maintaining all the intelligence and analysis capabilities of your bot!