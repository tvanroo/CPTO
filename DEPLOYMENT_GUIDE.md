# Ticker Analytics & Selection Feature - Deployment Guide

## What Was Implemented

This feature adds comprehensive ticker analytics and selection capabilities across the CPTO platform:

### Backend
1. **New API Endpoints**:
   - `GET /api/analytics/ticker-stats` - Comprehensive ticker statistics
   - `GET /api/analytics/ticker-stats/top` - Top N tickers by metric

2. **New Database Method**:
   - `dataStorageService.getTickerStatistics()` - Aggregates sentiment, price, and correlation data

3. **Type Definitions**:
   - `TickerStatistics` interface
   - `TickerStatisticsOptions` interface

### Frontend - Ticker Management Page
1. **Analytics Controls**:
   - Time range selector (24h, 7d, 30d)
   - Base currency toggle (USD/BTC)
   - Refresh analytics button
   - Select Top N button
   - Open Selected in Chart button

2. **Enhanced Table**:
   - Checkbox column for ticker selection
   - Sortable analytics columns:
     - Avg Sentiment
     - Price Change %
     - Total Mentions
     - Correlation
     - Data Points
   - Details button per ticker
   - Visual dimming for tickers with insufficient data

3. **Cross-page Navigation**:
   - Select tickers and navigate to Sentiment vs Price chart
   - Preferences persisted to localStorage

### Frontend - Sentiment Analysis Page
(See SENTIMENT_ANALYSIS_UPDATES.md for detailed implementation)

1. **URL Parameter Support**:
   - Pre-select tickers via `?tickers=BTC,ETH`
   - Apply time range via `?days=7`
   - Set base currency via `?base=USD`
   - Auto-load chart when params present

2. **Data-Aware Ticker List**:
   - Badges showing mentions and data points
   - Visual indication for tickers with/without data
   - Sorting by multiple metrics
   - Top N selection modal

## Build & Deploy Steps

### 1. Pre-Deployment Checklist

```bash
# Backup database
cd /Users/toby/Documents/GitHub/CPTO
cp data/database.sqlite data/database.backup-$(date +%F).sqlite

# Verify you're on the correct branch
git status

# Create feature branch (if not already done)
# git checkout -b feat/ticker-analytics-and-selection
```

### 2. Apply Sentiment Analysis Updates

Since the sentiment-analysis.html changes are extensive, you'll need to manually apply them from `SENTIMENT_ANALYSIS_UPDATES.md`:

1. Open `public/sentiment-analysis.html`
2. Add `window.tickerStats = new Map();` to state variables (after line 376)
3. Replace the `loadTickers()` function (around line 392) with the version from the guide
4. Update `renderTickerCheckboxes()` function (around line 415) with the version from the guide  
5. Add the three new functions at the end:
   - `sortAndRenderTickers()`
   - `showTopNSelector()`
   - `applyTopNSelection()`

### 3. Build the Application

```bash
# From project root
npm run build
```

### 4. Deploy with PM2 (Background Mode)

```bash
# Restart the application in background
pm2 restart cpto

# Or if starting for the first time
pm2 start ecosystem.config.js --env production

# Verify it's running
pm2 status

# Monitor logs (optional - can keep in separate terminal)
pm2 logs cpto --lines 50
```

### 5. Verify Deployment

#### API Endpoint Tests

```bash
# Test ticker stats endpoint
curl "http://localhost:4000/api/analytics/ticker-stats?days=7&base=USD&minMentions=5" | jq

# Test top endpoint
curl "http://localhost:4000/api/analytics/ticker-stats/top?metric=priceChangePercent&order=desc&limit=10&days=7" | jq
```

#### UI Tests

1. **Ticker Management Page** (`http://localhost:4000/tickers`):
   - ✅ Analytics section loads with time range and currency selectors
   - ✅ Table shows all new columns (Sentiment, Price Change, Mentions, Correlation, Data Points)
   - ✅ Clicking column headers sorts the table
   - ✅ Select checkboxes and click "Open Selected in Chart" navigates correctly
   - ✅ Click "Select Top N" button, enter `price:desc:10`, and verify navigation
   - ✅ Details button shows ticker analytics in alert

2. **Sentiment Analysis Page** (`http://localhost:4000/sentiment-analysis`):
   - ✅ Visit with params: `/sentiment-analysis?tickers=BTC,ETH&days=7&base=USD`
   - ✅ Tickers should be pre-selected
   - ✅ Time range should be 7 Days
   - ✅ Currency should be USD
   - ✅ Chart should auto-load after 500ms
   - ✅ Ticker list shows badges (Xm, Yd)
   - ✅ Sorting dropdown reorders list
   - ✅ Top N selection works

3. **Cross-Page Flow**:
   - ✅ Select tickers on Ticker Management
   - ✅ Click "Open Selected in Chart"
   - ✅ Verify URL params are correct
   - ✅ Verify chart loads with selected tickers

### 6. Database Indexes (Performance)

Verify these indexes exist (they should be created automatically during app startup, but check if performance is slow):

```bash
# Connect to SQLite database
sqlite3 data/database.sqlite

# Check indexes
.indexes processed_content
.indexes market_snapshots

# Create if missing (unlikely)
CREATE INDEX IF NOT EXISTS idx_processed_content_timestamp ON processed_content(processing_timestamp);
CREATE INDEX IF NOT EXISTS idx_market_snapshots_ticker_time ON market_snapshots(ticker, timestamp);

# Exit
.exit
```

### 7. Monitor Performance

```bash
# Watch logs for slow queries
pm2 logs cpto | grep "Fetching ticker statistics"

# Check response times
# Should be <1s for ticker-stats without correlation
# May be 1-3s with correlation for 100+ tickers
```

## Rollback Plan

If issues arise:

```bash
# Stop the application
pm2 stop cpto

# Restore database backup
cp data/database.backup-YYYY-MM-DD.sqlite data/database.sqlite

# Checkout previous commit
git log --oneline -n 10
git checkout <previous-commit-hash>

# Rebuild and restart
npm run build
pm2 restart cpto

# Verify
pm2 logs cpto
```

## Configuration Options

### Default Settings (can be changed in code):
- **minMentions**: 5 (tickers need at least 5 mentions for full analytics)
- **Default time range**: 7 days
- **Default currency**: USD
- **Correlation calculation**: OFF by default (performance)

### User Preferences (persisted in localStorage):
- Time range selection
- Base currency selection
- Last selected tickers (on Sentiment Analysis page)

## Known Limitations & Future Enhancements

1. **Performance**:
   - Correlation calculation is expensive; only computed when explicitly requested
   - Sequential ticker processing; could be parallelized with p-limit (Phase 2)

2. **Data Coverage**:
   - Only tickers in watchlist or recently analyzed are included
   - Could expand to all Gemini-supported tickers (Phase 2)

3. **UI**:
   - Top N selector uses simple prompt(); could be upgraded to modal dialog
   - No CSV export yet (Phase 2)

## Troubleshooting

### "No analytics data" on Ticker Management page
- Check that processed_content table has recent data
- Verify market_snapshots table has price data
- Ensure at least 5 mentions per ticker (or lower minMentions threshold)

### Slow ticker stats endpoint
- Check database indexes
- Reduce time range (use 24h instead of 30d for testing)
- Disable correlation (includeCorrelation=false)

### Chart doesn't auto-load with URL params
- Check browser console for JavaScript errors
- Verify ticker names in URL are uppercase
- Clear browser cache and reload

### Cross-page navigation not working
- Verify base URL (should be /sentiment-analysis not /sentiment-analysis.html)
- Check that query params are properly encoded

## Post-Deployment Monitoring

Monitor for 24-48 hours:
- PM2 logs: `pm2 logs cpto`
- Error rates in logs
- Response times for new endpoints
- User feedback on analytics accuracy

## Support

For issues or questions:
- Check logs: `pm2 logs cpto`
- Review implementation guides: SENTIMENT_ANALYSIS_UPDATES.md
- Verify database state: `sqlite3 data/database.sqlite`
