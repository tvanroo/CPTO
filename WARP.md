# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

CPTO (Crypto Trading Platform with Ongoing Analysis) is a sophisticated cryptocurrency trading bot that combines Reddit sentiment analysis with market data to make automated trading decisions using AI. The system is designed for single-user deployment on Ubuntu servers without authentication layers.

## Architecture

```
Reddit API ──┐     ┌── Reddit Client ──┐
             │     │                    │
             ├────▶│   Trading Bot      │───▶ AI Service ──┐
             │     │   (EventEmitter)   │                  │
TokenMetrics ──┘   └── Market Data ─────┘                  │
                                                           │
                   ┌─── Trade Signals ◀───── OpenAI ◀─────┘
                   │
                   ▼
             Trade Execution ──▶ TokenMetrics API
```

**Event-Driven Flow:**
1. Reddit Client streams posts/comments from configured subreddits
2. Trading Bot processes content through AI Service for sentiment analysis
3. Market data fetched from TokenMetrics for relevant tickers
4. AI generates trading decisions based on sentiment + market conditions
5. Trades executed via TokenMetrics API when confidence threshold met

**Key Components:**
- `src/index.ts` - Main application entry with event orchestration
- `src/services/tradingBot.ts` - Core event-driven trading orchestrator
- `src/services/aiService.ts` - OpenAI integration for sentiment analysis
- `src/clients/redditClient.ts` - Reddit streaming with rate limiting
- `src/clients/tokenMetricsClient.ts` - Market data and trade execution
- `src/config/index.ts` - Centralized configuration with validation

## Development Commands

```bash
# Development (with hot reload and mock APIs)
npm run dev                    # Start with nodemon, skip config validation
npm run dev:watch             # Watch mode with file monitoring

# Production Build
npm run build                 # TypeScript compilation to build/
npm run start                 # Run compiled JavaScript
npm run prepare               # Build hook for deployment

# Code Quality
npm run lint                  # ESLint on src/**/*.ts
npm run format               # Prettier formatting
npm run clean                # Remove build directory

# Testing & Validation
npm run test:config          # Validate configuration loading
node demo.js                 # Demo mode with mock data
```

## Configuration

The application uses a comprehensive configuration system in `src/config/index.ts` with environment-based validation:

**Required Environment Variables:**
- `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`
- `OPENAI_API_KEY` (with model selection via `OPENAI_MODEL`)
- `TOKENMETRICS_API_KEY`

**Development Mode:**
- Set `SKIP_CONFIG_VALIDATION=true` or use placeholder API keys
- Enables mock responses from all external APIs
- Reddit, OpenAI, and TokenMetrics clients return simulated data

**Trading Parameters:**
- `SUBREDDITS` - Comma-separated list of subreddits to monitor
- `SENTIMENT_THRESHOLD` - Minimum sentiment score for trades (-1 to 1)
- `TRADE_AMOUNT_USD` - Default trade amount per execution
- `MAX_TRADES_PER_HOUR` - Rate limiting for trade execution

Copy `.env.example` to `.env` and configure with real API keys for production.

## PM2 Production Deployment

The project includes `ecosystem.config.js` for PM2 process management:

```bash
# Production Deployment
npm run build
pm2 start ecosystem.config.js --env production

# Background Process Management (user preference)
pm2 start ecosystem.config.js &          # Start in background
pm2 restart cpto                         # Restart application
pm2 stop cpto                           # Stop application
pm2 logs cpto                           # Tail application logs
pm2 monit                               # Real-time monitoring
pm2 delete cpto                         # Remove from PM2

# Ubuntu Service Integration
pm2 startup                             # Configure system startup
pm2 save                                # Save current processes
```

**Logging Configuration:**
- Error logs: `./logs/cpto-error.log`
- Output logs: `./logs/cpto-out.log` 
- Combined: `./logs/cpto-combined.log`
- Memory restart: 1GB limit with auto-restart

## Key Patterns & Conventions

**Event-Driven Architecture:**
```typescript
// Trading Bot extends EventEmitter for loose coupling
tradingBot.on('tradeExecuted', (data) => {
  console.log(`Trade: ${data.signal.action} ${data.signal.ticker}`);
});

// Clients emit domain events
redditClient.on('newPost', (post) => tradingBot.addToQueue(post));
```

**Configuration Proxy Pattern:**
```typescript
// Lazy-loaded config with validation
export const config = new Proxy({} as AppConfig, {
  get(_target, prop) {
    return getConfig()[prop as keyof AppConfig];
  }
});
```

**Development/Production Switching:**
```typescript
// Mock data in development, real APIs in production
const isDev = process.env.SKIP_CONFIG_VALIDATION === 'true' || 
             config.openai.apiKey.startsWith('placeholder_');
return isDev ? getMockSentiment(text) : callOpenAI(text);
```

**Error Handling with Custom Types:**
```typescript
// Domain-specific error classes extend CPTOError
export class RedditAPIError extends CPTOError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'REDDIT_API_ERROR', context);
  }
}
```

**Rate Limiting & Queuing:**
```typescript
// Built-in processing queue with concurrency control
private processingQueue: ProcessingQueue[] = [];
private maxConcurrentProcessing: number = 3;
private recentTrades: Map<string, number> = new Map();
```

## Type System

The project uses comprehensive TypeScript types in `src/types/index.ts`:

- **Reddit Types**: `RedditPost`, `RedditComment`, `RedditItem`
- **AI Types**: `SentimentScore`, `TradeSignal` 
- **Market Types**: `MarketData`, `MarketTrend`, `TradeOrder`, `TradeResult`
- **Config Types**: `AppConfig` with nested service configurations
- **Error Types**: Domain-specific error classes with context

## Troubleshooting

**API Connection Issues:**
- Check `npm run test:config` for configuration validation
- Verify API keys in `.env` file match service requirements
- Reddit requires descriptive `REDDIT_USER_AGENT` string

**Development Mode:**
- Use `SKIP_CONFIG_VALIDATION=true` to bypass API key requirements
- Demo script (`node demo.js`) provides end-to-end workflow testing
- All clients provide mock data when API keys start with "placeholder_"

**Trading Issues:**
- Monitor `pm2 logs cpto` for trade execution details
- Sentiment threshold and confidence levels filter trade signals
- Rate limiting prevents over-trading via `MAX_TRADES_PER_HOUR`

**Memory/Performance:**
- PM2 configured for 1GB memory restart limit
- Queue size capped at 1000 items with 10% overflow cleanup
- Processing limited to 3 concurrent operations

## MCP Server Integration

For enhanced AI assistance when working with this project, you can use the following MCP server links to provide context-aware documentation:

**Context7 MCP Server Links:**

- **Gemini API Documentation**: `https://context7.com/websites/gemini/llms.txt`
  - Use when working with Gemini cryptocurrency exchange API integration or considering Gemini as a trading platform
- **OpenAI Platform Documentation**: `https://context7.com/websites/platform_openai/llms.txt`
  - Use when working with OpenAI API integration, which is the current primary AI engine for sentiment analysis
- **Reddit Developer API Documentation**: `https://context7.com/websites/reddit-dev-api/llms.txt`
  - Use when working with Reddit API integration, streaming, or troubleshooting Reddit client issues

**Usage Instructions:**

1. These links provide up-to-date API documentation and best practices
2. Reference them when modifying or extending the AI service, Reddit client, or considering new integrations
3. Particularly useful for understanding API rate limits, authentication patterns, and response formats
4. The documentation helps ensure compliance with each platform's terms of service and best practices

## File Structure

```text
src/
├── clients/           # External API integrations
│   ├── redditClient.ts    # Snoowrap Reddit streaming
│   └── tokenMetricsClient.ts # Market data & trade execution
├── services/          # Core business logic
│   ├── aiService.ts       # OpenAI sentiment analysis
│   └── tradingBot.ts      # Event-driven orchestrator
├── config/            # Configuration management
│   └── index.ts           # Environment validation & defaults
├── types/             # TypeScript definitions
│   └── index.ts           # Comprehensive type system
└── index.ts           # Application entry point

ecosystem.config.js    # PM2 configuration
demo.js               # Development demonstration
tsconfig.json         # TypeScript configuration
```

This project prioritizes OpenAI as the primary AI engine with plans for future Anthropic integration. Background processing is preferred to maintain chat availability during operations.