# CPTO - Crypto Trading Platform with Ongoing Analysis

A sophisticated cryptocurrency trading bot that combines Reddit sentiment analysis with market data to make automated trading decisions using AI.

## 🌟 Features

- **Reddit Sentiment Analysis**: Real-time monitoring of cryptocurrency discussions on Reddit
- **AI-Powered Decision Making**: Uses OpenAI GPT-4 Turbo for sentiment analysis and trading decisions
- **Market Data Integration**: Connects to TokenMetrics API for real-time market data and trading
- **Automated Trading**: Executes trades based on sentiment and market analysis
- **Background Processing**: Runs as a background service with PM2 orchestration
- **Rate Limiting**: Built-in rate limiting and API management
- **Error Handling**: Comprehensive error handling with retry mechanisms

## 🏗️ Architecture

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│   Reddit    │───▶│    CPTO      │───▶│ TokenMetrics│
│     API     │    │ Trading Bot  │    │     API     │
└─────────────┘    └──────┬───────┘    └─────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │   OpenAI    │
                   │     API     │
                   └─────────────┘
```

**Data Flow:**
1. Monitor Reddit posts/comments from crypto subreddits
2. Extract cryptocurrency tickers from content
3. Analyze sentiment using OpenAI
4. Fetch market data from TokenMetrics
5. Generate trading signals with AI
6. Execute trades if conditions are met

## 📋 Prerequisites

- Node.js 18+ 
- npm or yarn
- API keys for:
  - Reddit API (client ID, client secret, username, password)
  - OpenAI API
  - TokenMetrics API
- PM2 (for production deployment)

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd CPTO
npm install
```

### 2. Configuration

Copy the example environment file and configure your API keys:

```bash
cp .env.example .env
```

Edit `.env` with your API credentials:

```env
# Reddit API Configuration
REDDIT_CLIENT_ID=your_reddit_client_id
REDDIT_CLIENT_SECRET=your_reddit_client_secret
REDDIT_USER_AGENT=CPTO/1.0 by YourUsername
REDDIT_USERNAME=your_reddit_username
REDDIT_PASSWORD=your_reddit_password

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4-turbo

# TokenMetrics API Configuration
TOKENMETRICS_API_KEY=your_tokenmetrics_api_key
TOKENMETRICS_BASE_URL=https://api.tokenmetrics.com

# Trading Configuration
SUBREDDITS=CryptoCurrency,Bitcoin,ethereum,altcoin,CryptoMoonShots
SENTIMENT_THRESHOLD=0.6
TRADE_AMOUNT_USD=100
MAX_TRADES_PER_HOUR=5
```

### 3. Build and Run

```bash
# Development
npm run dev

# Production build
npm run build
npm start
```

## 🔧 Development

### Available Scripts

```bash
npm run dev          # Start in development mode with hot reload
npm run build        # Build for production
npm start            # Start production build
npm run lint         # Run ESLint
npm run format       # Format code with Prettier
```

### Project Structure

```
src/
├── clients/           # API clients
│   ├── redditClient.ts    # Reddit API integration
│   └── tokenMetricsClient.ts # TokenMetrics API integration
├── services/          # Core business logic
│   ├── aiService.ts       # OpenAI integration
│   └── tradingBot.ts      # Main trading orchestrator
├── config/            # Configuration management
│   └── index.ts
├── types/             # TypeScript type definitions
│   └── index.ts
└── index.ts           # Application entry point
```

## 🚀 Production Deployment

### Using PM2 (Recommended)

1. **Install PM2 globally:**
```bash
npm install -g pm2
```

2. **Build the application:**
```bash
npm run build
```

3. **Start with PM2:**
```bash
# Development
pm2 start ecosystem.config.js

# Production
pm2 start ecosystem.config.js --env production
```

4. **PM2 Management Commands:**
```bash
pm2 status           # Check status
pm2 logs cpto        # View logs
pm2 restart cpto     # Restart application
pm2 stop cpto        # Stop application  
pm2 delete cpto      # Remove from PM2
pm2 monit           # Monitor in real-time
```

5. **Setup PM2 auto-startup (Ubuntu):**
```bash
pm2 startup
pm2 save
```

### Ubuntu Server Setup

1. **Install Node.js:**
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

2. **Clone and setup project:**
```bash
git clone <repository-url>
cd CPTO
npm install
cp .env.example .env
# Edit .env with your API keys
npm run build
```

3. **Install and configure PM2:**
```bash
sudo npm install -g pm2
pm2 start ecosystem.config.js --env production
pm2 startup
sudo env PATH=$PATH:/usr/bin $(which pm2) startup systemd -u $USER --hp $HOME
pm2 save
```

## ⚙️ Configuration Options

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `PORT` | Server port | `3000` |
| `LOG_LEVEL` | Logging level | `info` |
| `SUBREDDITS` | Comma-separated subreddits | `CryptoCurrency,Bitcoin,ethereum` |
| `SENTIMENT_THRESHOLD` | Minimum sentiment for trades | `0.6` |
| `TRADE_AMOUNT_USD` | Default trade amount | `100` |
| `MAX_TRADES_PER_HOUR` | Rate limit for trades | `5` |

### Trading Parameters

- **Sentiment Threshold**: Range -1 to 1, higher values are more conservative
- **Trade Amount**: USD amount per trade
- **Max Trades per Hour**: Rate limiting to prevent overtrading
- **Confidence Threshold**: AI must be >60% confident to execute trades

## 📊 Monitoring and Logs

### Log Files (PM2)
- `logs/cpto-out.log` - Standard output
- `logs/cpto-error.log` - Error logs  
- `logs/cpto-combined.log` - Combined logs

### Real-time Monitoring
```bash
pm2 monit           # PM2 monitoring dashboard
pm2 logs --lines 100 # View recent logs
```

## 🛡️ Security Considerations

- Store API keys securely using environment variables
- Never commit `.env` files to version control
- Run on isolated server or container
- Monitor API rate limits and costs
- Implement proper error handling for failed trades
- Consider using encrypted configuration for production

## 🔍 Troubleshooting

### Common Issues

1. **API Connection Failures**
   - Verify API keys are correct
   - Check network connectivity
   - Ensure rate limits aren't exceeded

2. **Reddit API Issues**
   - Verify Reddit app credentials
   - Check if account has proper permissions
   - Ensure user agent string is descriptive

3. **Build Errors**
   - Run `npm install` to ensure dependencies
   - Check Node.js version (18+ required)
   - Clear `node_modules` and reinstall if needed

4. **Trading Issues**
   - Verify TokenMetrics API key and permissions
   - Check account balance and trading permissions
   - Review sentiment threshold settings

### Debug Mode

Set `LOG_LEVEL=debug` in your `.env` file for verbose logging.

## 🚧 Extending the Platform

### Adding New AI Providers

The AI service is designed to be extensible. To add Anthropic or other providers:

1. Update `src/services/aiService.ts`
2. Add new configuration options
3. Implement provider-specific logic
4. Update type definitions

### Adding New Data Sources

To add additional market data or social media sources:

1. Create new client in `src/clients/`
2. Update types in `src/types/index.ts`
3. Integrate with main trading bot

### Custom Trading Strategies

Modify `src/services/tradingBot.ts` to implement:
- Custom sentiment scoring
- Technical analysis indicators
- Risk management rules
- Portfolio management

## 📝 License

This project is for educational and personal use only. Trading cryptocurrencies involves substantial risk of loss and is not suitable for all investors.

## ⚠️ Disclaimer

**USE AT YOUR OWN RISK**: This software is experimental and for educational purposes. Cryptocurrency trading is highly risky and volatile. The authors are not responsible for any financial losses incurred through the use of this software.

- Always test with small amounts first
- Monitor the bot's performance regularly
- Be aware of API costs and rate limits
- Understand the risks of automated trading
- Never invest more than you can afford to lose

---

## 🤝 Support

For questions or issues:
1. Check the troubleshooting section
2. Review logs for error messages
3. Ensure all API keys are configured correctly
4. Check GitHub issues for similar problems