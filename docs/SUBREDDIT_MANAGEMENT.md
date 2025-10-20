# Subreddit Management Feature

## Overview

The Subreddit Management feature allows you to dynamically control which subreddits CPTO monitors for cryptocurrency sentiment analysis without restarting the application. This feature provides a user-friendly interface to add, remove, enable/disable subreddits, and discover new crypto-focused communities.

## Features

### 1. Dynamic Subreddit Control
- **Add Subreddits**: Validate and add new subreddits with real-time Reddit API verification
- **Remove Subreddits**: Delete subreddits from monitoring with confirmation dialogs
- **Enable/Disable**: Toggle subreddit monitoring on/off without removing them from the database
- **Live Updates**: Changes take effect immediately via event-driven architecture

### 2. Smart Subreddit Suggestions
- **Auto-Discovery**: System analyzes Reddit mentions in processed content
- **Crypto-Focus Detection**: Automatically identifies crypto-related subreddits
- **Relevance Scoring**: Suggestions ranked by mention frequency
- **One-Click Add**: Quick-add buttons for suggested subreddits

### 3. Real-Time Validation
- **Reddit API Check**: Verifies subreddit existence before adding
- **Privacy Detection**: Identifies and rejects private subreddits
- **Ban Detection**: Prevents adding banned/quarantined subreddits
- **Subscriber Counts**: Displays community size during validation

### 4. Comprehensive Statistics
- **Total Subreddits**: Count of all managed subreddits
- **Active Monitoring**: Number of currently enabled subreddits
- **Crypto-Focused**: Count of crypto-specific communities
- **Posts Analyzed**: Aggregated processing statistics per subreddit

## Architecture

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS managed_subreddits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subreddit TEXT UNIQUE NOT NULL,
    enabled INTEGER DEFAULT 1,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_post_count INTEGER DEFAULT 0,
    is_crypto_focused INTEGER DEFAULT 0
);
```

### Event Flow

```
User Action (Frontend)
    ↓
API Endpoint (webServer.ts)
    ↓
Data Storage (dataStorageService.ts)
    ↓
Event Emission (tradingBot)
    ↓
Reddit Client (redditClient.ts) - Start/Stop Streaming
    ↓
WebSocket Broadcast (Socket.IO)
    ↓
Frontend Update (Real-time UI refresh)
```

### Key Components

1. **Frontend** (`public/tickers.html`)
   - Tabbed interface with Subreddits tab
   - Real-time validation with debounce
   - WebSocket listeners for live updates
   - Search and filtering functionality

2. **Backend API** (`src/server/webServer.ts`)
   - `GET /api/subreddits` - List all managed subreddits
   - `POST /api/subreddits/validate/:subreddit` - Validate subreddit
   - `POST /api/subreddits/add` - Add new subreddit
   - `POST /api/subreddits/enable/:subreddit` - Enable monitoring
   - `POST /api/subreddits/disable/:subreddit` - Disable monitoring
   - `DELETE /api/subreddits/remove/:subreddit` - Remove subreddit
   - `GET /api/subreddits/suggestions` - Get suggested subreddits

3. **Data Layer** (`src/services/dataStorageService.ts`)
   - Database operations with transactions
   - Suggestion generation with caching (10-minute TTL)
   - Post count statistics tracking

4. **Reddit Integration** (`src/clients/redditClient.ts`)
   - Dynamic stream management (add/remove without restart)
   - Subreddit validation with Reddit API
   - Crypto-focus detection via keyword matching
   - Caching with 1-hour TTL

5. **Event Orchestration** (`src/services/tradingBot.ts`)
   - Event emission for subreddit lifecycle
   - Integration with Reddit client for stream control
   - Post processing and statistics updates

## Usage

### Web Interface

1. **Navigate to Subreddit Management**
   - Open CPTO dashboard
   - Go to "Ticker Management" page
   - Click "Subreddits" tab

2. **Add a New Subreddit**
   - Enter subreddit name (e.g., "bitcoin" or "r/bitcoin")
   - System automatically validates against Reddit API
   - View validation results (crypto-focus, subscriber count)
   - Click "Add Subreddit" when validation passes

3. **Manage Existing Subreddits**
   - Use toggle switches to enable/disable monitoring
   - Click "Remove" button to delete (requires confirmation)
   - Search/filter subreddits using search box

4. **Discover New Communities**
   - View "Suggested Subreddits" section
   - Review mention counts and sample posts
   - Click "Quick Add" to add suggested communities

### API Usage

```bash
# List all managed subreddits
curl http://localhost:3000/api/subreddits

# Validate a subreddit
curl -X POST http://localhost:3000/api/subreddits/validate/cryptotrading

# Add a new subreddit
curl -X POST http://localhost:3000/api/subreddits/add \
  -H "Content-Type: application/json" \
  -d '{"subreddit": "cryptotrading"}'

# Enable a subreddit
curl -X POST http://localhost:3000/api/subreddits/enable/cryptotrading

# Disable a subreddit
curl -X POST http://localhost:3000/api/subreddits/disable/cryptotrading

# Remove a subreddit
curl -X DELETE http://localhost:3000/api/subreddits/remove/cryptotrading

# Get suggestions
curl http://localhost:3000/api/subreddits/suggestions?limit=10
```

## Configuration

### Initial Setup

On first run, the system automatically imports subreddits from your `SUBREDDITS` environment variable:

```bash
# .env
SUBREDDITS=cryptocurrency,bitcoin,ethtrader,cryptomarkets
```

These are added to the database during migration and can be managed via the UI afterward.

### Crypto-Focus Keywords

The system identifies crypto-focused subreddits using these keywords (case-insensitive):
- crypto, cryptocurrency, cryptocurrencies
- bitcoin, btc, ethereum, eth
- blockchain, defi, nft
- trading, trader, market

You can modify the keyword list in `src/clients/redditClient.ts`:

```typescript
private isCryptoFocused(description: string): boolean {
    const cryptoKeywords = [
        'crypto', 'cryptocurrency', 'cryptocurrencies',
        // ... add more keywords
    ];
    // ...
}
```

### Suggestion Settings

Suggestions are generated from recent processed Reddit content:

```typescript
// In dataStorageService.ts
async getSuggestedSubreddits(limit: number = 10): Promise<SubredditSuggestion[]> {
    // Analyzes last 1000 processed posts
    // Groups by mentioned subreddit
    // Filters out already managed subreddits
    // Returns top N by mention count
}
```

Suggestion cache TTL: 10 minutes (configurable in `dataStorageService.ts`)

## WebSocket Events

The frontend receives real-time updates via Socket.IO:

```javascript
socket.on('subredditAdded', (data) => {
    // data: { subreddit, timestamp }
    console.log(`New subreddit added: ${data.subreddit}`);
});

socket.on('subredditRemoved', (data) => {
    // data: { subreddit, timestamp }
    console.log(`Subreddit removed: ${data.subreddit}`);
});

socket.on('subredditEnabled', (data) => {
    // data: { subreddit, timestamp }
    console.log(`Subreddit enabled: ${data.subreddit}`);
});

socket.on('subredditDisabled', (data) => {
    // data: { subreddit, timestamp }
    console.log(`Subreddit disabled: ${data.subreddit}`);
});
```

## Migration

The database migration runs automatically on application startup:

```sql
-- Creates managed_subreddits table
-- Imports from SUBREDDITS env variable (one-time)
-- Idempotent and transaction-wrapped
```

To manually run migration:

```bash
npm run build
node build/services/dataStorageService.js
```

## Testing

### Manual Testing Checklist

- [ ] Add a valid public subreddit (e.g., "bitcoin")
- [ ] Try to add an invalid subreddit (validation should fail)
- [ ] Try to add a private subreddit (should reject)
- [ ] Enable/disable a subreddit (stream should start/stop)
- [ ] Remove a subreddit (should prompt confirmation)
- [ ] View suggestions (should show crypto-related subreddits)
- [ ] Quick-add a suggestion (should validate and add)
- [ ] Search/filter subreddit list
- [ ] Verify WebSocket real-time updates work
- [ ] Check subreddit stats update correctly

### API Testing

```bash
# Test validation endpoint
curl -X POST http://localhost:3000/api/subreddits/validate/testsubreddit

# Test add endpoint with invalid data
curl -X POST http://localhost:3000/api/subreddits/add \
  -H "Content-Type: application/json" \
  -d '{"subreddit": ""}'

# Test duplicate add (should fail gracefully)
curl -X POST http://localhost:3000/api/subreddits/add \
  -H "Content-Type: application/json" \
  -d '{"subreddit": "bitcoin"}'
```

## Troubleshooting

### Subreddit Not Streaming

1. Check if subreddit is enabled: `GET /api/subreddits`
2. Verify Reddit client is running: Check PM2 logs
3. Check for rate limiting: Review `redditClient.ts` cache
4. Validate subreddit exists: `POST /api/subreddits/validate/:name`

### Suggestions Not Appearing

1. Ensure posts are being processed (check database)
2. Verify subreddit mentions in `raw_content` field
3. Check suggestion cache hasn't expired (10-min TTL)
4. Confirm at least 1000 posts have been processed

### Validation Always Failing

1. Check Reddit API credentials in `.env`
2. Verify Reddit rate limits not exceeded
3. Test with known public subreddit (e.g., "bitcoin")
4. Check for network/firewall issues blocking Reddit API

### WebSocket Not Updating

1. Verify Socket.IO connection: Check browser console
2. Confirm events are being emitted server-side
3. Check for multiple browser tabs (can cause confusion)
4. Restart the web server if needed

## Performance Considerations

### Caching Strategy

- **Validation Cache**: 1 hour TTL per subreddit (reduces Reddit API calls)
- **Suggestion Cache**: 10 minutes TTL (balances freshness vs. performance)
- **Database Queries**: Use indexes on `subreddit` and `enabled` columns

### Rate Limiting

- Reddit API has strict rate limits (60 requests/minute for unauthenticated)
- Validation responses are cached to minimize API calls
- Consider adding request queuing for bulk operations

### Scalability

- Current design supports ~100 managed subreddits
- Reddit streaming uses single connection with multiple subreddits
- Database uses SQLite (consider PostgreSQL for >10k subreddits)

## Future Enhancements

### Planned Features

- [ ] Subreddit performance metrics (sentiment trends, post volume)
- [ ] Bulk import/export subreddit lists
- [ ] Scheduled enable/disable (e.g., only monitor during trading hours)
- [ ] Subreddit grouping/tagging (e.g., "DeFi", "Memecoins")
- [ ] Advanced filtering (by crypto-focus, subscriber count, activity)

### API Improvements

- [ ] Pagination for large subreddit lists
- [ ] Sorting options (by name, added date, post count)
- [ ] Bulk operations (enable/disable multiple subreddits)
- [ ] Webhook notifications for subreddit events

### UI Enhancements

- [ ] Drag-and-drop subreddit prioritization
- [ ] Visual charts for subreddit post volumes
- [ ] Color-coding by sentiment performance
- [ ] Export subreddit data to CSV/JSON

## Contributing

When adding subreddit management features:

1. Update this documentation
2. Add tests for new endpoints
3. Emit appropriate events for real-time updates
4. Update TypeScript types in `src/types/index.ts`
5. Test with both development and production configs

## Related Files

- `src/services/dataStorageService.ts` - Database operations
- `src/clients/redditClient.ts` - Reddit API integration
- `src/services/tradingBot.ts` - Event orchestration
- `src/server/webServer.ts` - HTTP API endpoints
- `public/tickers.html` - Frontend UI
- `src/types/index.ts` - TypeScript type definitions

## License

Part of the CPTO project. See main LICENSE file for details.
