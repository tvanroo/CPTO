import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { spawn, exec } from 'child_process';
import { config } from '../config';
import { tradingBot } from '../services/tradingBot';
import { geminiClient } from '../clients/geminiClient';
import { tokenMetricsClient } from '../clients/tokenMetricsClient';
import { aiService } from '../services/aiService';
import { pendingTradesManager } from '../services/pendingTradesManager';
import { costTrackingService } from '../services/costTrackingService';
import { dataStorageService } from '../services/dataStorageService';

/**
 * Web server for CPTO Dashboard
 * Provides real-time monitoring and control interface
 */
export class WebServer {
  private app: express.Application;
  private server: any;
  private io: SocketIOServer;
  private port: number;
  private logWatchers: Map<string, any> = new Map();

  constructor() {
    this.port = config.app.port + 1000; // Use port 4000 if main app is on 3000
    this.app = express();
    this.server = createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketHandlers();
    this.setupTradingBotListeners();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Security - Disable CSP for development
    this.app.use(helmet({
      contentSecurityPolicy: false, // Disable CSP entirely
    }));

    // CORS
    this.app.use(cors());

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // Limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP'
    });
    this.app.use(limiter);

    // Logging
    this.app.use(morgan('combined'));

    // JSON parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Serve static files
    this.app.use(express.static(path.join(__dirname, '../../public')));
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Serve the dashboard
    this.app.get('/', (_req, res) => {
      res.sendFile(path.join(__dirname, '../../public/dashboard.html'));
    });

    // Bot control routes
    this.app.post('/api/bot/:action', async (req, res) => {
      const { action } = req.params;
      
      try {
        let result: any = {};
        
        switch (action) {
          case 'start':
            await tradingBot.start();
            result = { status: 'started', message: 'Trading bot started successfully' };
            break;
            
          case 'stop':
            await tradingBot.stop();
            result = { status: 'stopped', message: 'Trading bot stopped successfully' };
            break;
            
          case 'restart':
            await tradingBot.stop();
            await new Promise(resolve => setTimeout(resolve, 2000));
            await tradingBot.start();
            result = { status: 'restarted', message: 'Trading bot restarted successfully' };
            break;
            
          case 'status':
            result = tradingBot.getStatus();
            break;
            
          default:
            return res.status(400).json({ error: 'Invalid action' });
        }
        
        this.io.emit('botStatusUpdate', result);
        return res.json(result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: errorMessage });
      }
    });

    // API connection testing
    this.app.post('/api/test/:service', async (req, res) => {
      const { service } = req.params;
      
      try {
        let result: any = {};
        
        switch (service) {
          case 'openai':
            result.connected = await aiService.testConnection();
            result.service = 'OpenAI';
            result.model = aiService.getModelInfo();
            break;
            
          case 'tokenmetrics':
            result.connected = await tokenMetricsClient.testConnection();
            result.service = 'TokenMetrics';
            break;
            
          case 'gemini':
            result.connected = await geminiClient.testConnection();
            result.service = 'Gemini';
            result.mode = config.gemini.useSandbox ? 'sandbox' : 'production';
            break;
            
          case 'all':
            result = {
              openai: {
                connected: await aiService.testConnection(),
                service: 'OpenAI',
                model: aiService.getModelInfo()
              },
              tokenmetrics: {
                connected: await tokenMetricsClient.testConnection(),
                service: 'TokenMetrics'
              },
              gemini: {
                connected: await geminiClient.testConnection(),
                service: 'Gemini',
                mode: config.gemini.useSandbox ? 'sandbox' : 'production'
              }
            };
            break;
            
          default:
            return res.status(400).json({ error: 'Invalid service' });
        }
        
        return res.json(result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: errorMessage, connected: false });
      }
    });

    // Configuration management
    this.app.get('/api/config', (_req, res) => {
      const safeConfig = {
        app: config.app,
        trading: config.trading,
        gemini: {
          useSandbox: config.gemini.useSandbox,
          baseUrl: config.gemini.baseUrl,
          sandboxUrl: config.gemini.sandboxUrl
        },
        openai: {
          model: config.openai.model
        }
      };
      res.json(safeConfig);
    });

    // PM2 management
    this.app.post('/api/pm2/:action', (req, res) => {
      const { action } = req.params;
      const validActions = ['start', 'stop', 'restart', 'status', 'logs'];
      
      if (!validActions.includes(action)) {
        return res.status(400).json({ error: 'Invalid PM2 action' });
      }
      
      let command = '';
      switch (action) {
        case 'start':
          command = 'pm2 start ecosystem.config.js --env production';
          break;
        case 'stop':
          command = 'pm2 stop cpto';
          break;
        case 'restart':
          command = 'pm2 restart cpto';
          break;
        case 'status':
          command = 'pm2 jlist cpto';
          break;
        case 'logs':
          command = 'pm2 logs cpto --lines 50 --raw';
          break;
      }
      
      return exec(command, (error, stdout, stderr) => {
        if (error) {
          return res.status(500).json({ error: error.message });
        }
        
        let result: any = { stdout, stderr };
        
        if (action === 'status' || action === 'logs') {
          try {
            if (action === 'status') {
              result.data = JSON.parse(stdout);
            } else {
              result.data = stdout.split('\n').filter((line: string) => line.trim());
            }
          } catch (e) {
            result.data = stdout;
          }
        }
        
        return res.json(result);
      });
    });

    // Portfolio management
    this.app.get('/api/portfolio/balance', async (_req, res) => {
      try {
        const balances = await geminiClient.getAccountBalances();
        
        // Calculate total USD value and format response
        let totalUsdValue = 0;
        const formattedBalances = [];
        
        for (const balance of balances) {
          const symbol = balance.currency;
          const available = parseFloat(balance.available);
          const availableForWithdrawal = parseFloat(balance.availableForWithdrawal || '0');
          
          if (available > 0) {
            let usdValue = 0;
            
            // Get USD value for non-USD currencies
            if (symbol !== 'USD') {
              try {
                const marketData = await geminiClient.getPrice(`${symbol}USD`);
                usdValue = available * marketData.price;
              } catch (priceError) {
                // If we can't get price data, still include the balance but with 0 USD value
                console.warn(`Could not get price for ${symbol}:`, priceError);
              }
            } else {
              usdValue = available;
            }
            
            totalUsdValue += usdValue;
            
            formattedBalances.push({
              currency: symbol,
              available: available,
              availableForWithdrawal: availableForWithdrawal,
              usdValue: usdValue,
              formattedValue: `$${usdValue.toFixed(2)}`
            });
          }
        }
        
        // Sort by USD value descending
        formattedBalances.sort((a, b) => b.usdValue - a.usdValue);
        
        const portfolioData = {
          totalUsdValue: totalUsdValue,
          formattedTotal: `$${totalUsdValue.toFixed(2)}`,
          balances: formattedBalances,
          timestamp: new Date().toISOString(),
          exchangeMode: config.gemini.useSandbox ? 'sandbox' : 'production'
        };
        
        res.json(portfolioData);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ 
          error: errorMessage, 
          totalUsdValue: 0, 
          formattedTotal: '$0.00',
          balances: [] 
        });
      }
    });
    
    // Trading history
    this.app.get('/api/portfolio/trades', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit as string) || 20;
        const symbol = req.query.symbol as string;
        
        const trades = await geminiClient.getTradingHistory(symbol, limit);
        
        const formattedTrades = trades.map(trade => ({
          ...trade,
          formattedAmount: `$${trade.amount_usd.toFixed(2)}`,
          formattedPrice: `$${trade.executed_price.toFixed(2)}`,
          formattedFees: `$${trade.fees.toFixed(2)}`,
          formattedDate: new Date(trade.timestamp).toLocaleString()
        }));
        
        res.json({
          trades: formattedTrades,
          count: formattedTrades.length,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ 
          error: errorMessage, 
          trades: [], 
          count: 0 
        });
      }
    });

    // Pending trades management
    this.app.get('/api/trades/pending', (_req, res) => {
      try {
        const pendingTrades = pendingTradesManager.getPendingTrades();
        const statistics = pendingTradesManager.getStatistics();
        
        res.json({
          trades: pendingTrades,
          statistics,
          tradingMode: config.trading.tradingMode,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    });
    
    this.app.get('/api/trades/all', (_req, res) => {
      try {
        const allTrades = pendingTradesManager.getAllTrades();
        const statistics = pendingTradesManager.getStatistics();
        
        res.json({
          trades: allTrades,
          statistics,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    });
    
    this.app.post('/api/trades/:tradeId/approve', async (req, res) => {
      const { tradeId } = req.params;
      const { reason } = req.body;
      
      try {
        const approvedTrade = await pendingTradesManager.processTradeApproval({
          tradeId,
          action: 'approve',
          reason,
          userId: 'dashboard-user' // Could be extended with real user auth
        });
        
        if (approvedTrade) {
          this.io.emit('tradeApproved', {
            trade: approvedTrade,
            message: `Trade ${tradeId} approved for execution`
          });
          
          res.json({
            success: true,
            message: `Trade ${tradeId} approved for execution`,
            trade: approvedTrade
          });
        } else {
          res.status(404).json({ error: 'Trade not found' });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(400).json({ error: errorMessage });
      }
    });
    
    this.app.post('/api/trades/:tradeId/reject', async (req, res) => {
      const { tradeId } = req.params;
      const { reason } = req.body;
      
      try {
        const rejectedTrade = await pendingTradesManager.processTradeApproval({
          tradeId,
          action: 'reject',
          reason,
          userId: 'dashboard-user'
        });
        
        if (rejectedTrade) {
          this.io.emit('tradeRejected', {
            trade: rejectedTrade,
            message: `Trade ${tradeId} rejected`
          });
          
          res.json({
            success: true,
            message: `Trade ${tradeId} rejected`,
            trade: rejectedTrade
          });
        } else {
          res.status(404).json({ error: 'Trade not found' });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(400).json({ error: errorMessage });
      }
    });
    
    this.app.post('/api/trades/bulk/:action', async (req, res) => {
      const { action } = req.params;
      const { tradeIds, reason } = req.body;
      
      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'Invalid action. Must be approve or reject' });
      }
      
      if (!Array.isArray(tradeIds) || tradeIds.length === 0) {
        return res.status(400).json({ error: 'tradeIds must be a non-empty array' });
      }
      
      try {
        const result = await pendingTradesManager.bulkProcessTrades(
          tradeIds,
          action as 'approve' | 'reject',
          reason
        );
        
        this.io.emit('bulkTradeProcessed', {
          action,
          processed: result.processed.length,
          errors: result.errors.length,
          message: `Bulk ${action}: ${result.processed.length} processed, ${result.errors.length} errors`
        });
        
        return res.json({
          success: true,
          message: `Bulk ${action} completed`,
          processed: result.processed.length,
          errors: result.errors.length,
          details: result
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: errorMessage });
      }
    });
    
    this.app.get('/api/trades/statistics', (_req, res) => {
      try {
        const statistics = pendingTradesManager.getStatistics();
        
        res.json({
          ...statistics,
          tradingMode: config.trading.tradingMode,
          expiryHours: config.trading.pendingTradeExpiryHours,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    });
    
    this.app.post('/api/trading/mode', (req, res) => {
      const { mode } = req.body;
      
      if (!['manual', 'autopilot'].includes(mode)) {
        return res.status(400).json({ error: 'Invalid trading mode. Must be manual or autopilot' });
      }
      
      // Note: In a production system, you'd want to update the config file or environment
      // For now, we'll just inform the user that a restart is needed
      return res.json({
        success: true,
        message: `Trading mode change to '${mode}' requested. Update TRADING_MODE environment variable and restart the application.`,
        currentMode: config.trading.tradingMode,
        requestedMode: mode
      });
    });

    // System info
    this.app.get('/api/system', (_req, res) => {
      exec('df -h / && free -h && uptime', (_error, stdout, _stderr) => {
        const systemInfo = {
          disk: stdout.split('\n')[1] || 'N/A',
          memory: stdout.split('\n').find(line => line.includes('Mem:')) || 'N/A',
          uptime: stdout.split('\n').pop() || 'N/A',
          timestamp: new Date().toISOString()
        };
        
        res.json(systemInfo);
      });
    });
    
    // OpenAI cost tracking
    this.app.get('/api/costs/summary', (_req, res) => {
      try {
        const cumulative = costTrackingService.getCumulativeCostSummary();
        const last24Hours = costTrackingService.getCostSummaryLast24Hours();
        
        res.json({
          cumulative,
          last24Hours,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    });
    
    this.app.get('/api/costs/cumulative', (_req, res) => {
      try {
        const summary = costTrackingService.getCumulativeCostSummary();
        
        res.json({
          ...summary,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    });
    
    this.app.get('/api/costs/24h', (_req, res) => {
      try {
        const summary = costTrackingService.getCostSummaryLast24Hours();
        
        res.json({
          ...summary,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    });
    
    this.app.get('/api/costs/recent', (req, res) => {
      try {
        const limit = parseInt(req.query.limit as string) || 50;
        const recentCalls = costTrackingService.getRecentApiCalls(limit);
        const stats = costTrackingService.getStats();
        
        res.json({
          calls: recentCalls,
          stats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    });
    
    this.app.delete('/api/costs/cleanup/:days', (req, res) => {
      try {
        const days = parseInt(req.params.days) || 7;
        if (days < 1 || days > 365) {
          return res.status(400).json({ error: 'Days must be between 1 and 365' });
        }
        
        costTrackingService.cleanupOldCalls(days);
        const stats = costTrackingService.getStats();
        
        return res.json({
          success: true,
          message: `Cleaned up API calls older than ${days} days`,
          stats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: errorMessage });
      }
    });
    
    // SQLite Data Analytics Endpoints
    
    // Get recent processed content
    this.app.get('/api/analytics/processed-content', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit as string) || 50;
        const content = await dataStorageService.getRecentProcessedContent(limit);
        
        res.json({
          content,
          count: content.length,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    });
    
    // Get currency watchlist with scores
    this.app.get('/api/analytics/watchlist', async (_req, res) => {
      try {
        const watchlist = await dataStorageService.getCurrencyWatchlist();
        
        res.json({
          watchlist,
          count: watchlist.length,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    });
    
    // Get sentiment trends for a ticker
    this.app.get('/api/analytics/sentiment-trends/:ticker', async (req, res) => {
      try {
        const { ticker } = req.params;
        const days = parseInt(req.query.days as string) || 7;
        const data = await dataStorageService.getHistoricalContext(ticker.toUpperCase(), days);
        
        res.json({
          ticker: ticker.toUpperCase(),
          days,
          recentAnalysis: data.recentAnalysis,
          tradeHistory: data.tradeHistory,
          sentimentTrend: data.sentimentTrend,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    });
    
    // Get analysis for specific ticker
    this.app.get('/api/analytics/ticker/:ticker/analysis', async (req, res) => {
      try {
        const { ticker } = req.params;
        const limit = parseInt(req.query.limit as string) || 20;
        const analysis = await dataStorageService.getRecentAnalysisForTicker(ticker.toUpperCase(), limit);
        
        res.json({
          ticker: ticker.toUpperCase(),
          analysis,
          count: analysis.length,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    });
    
    // Get processing statistics and cost savings
    this.app.get('/api/analytics/processing-stats', async (_req, res) => {
      try {
        const stats = await dataStorageService.getProcessingStats();
        
        res.json({
          ...stats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    });
    
    // Get historical analysis context (general overview)
    this.app.get('/api/analytics/overview', async (req, res) => {
      try {
        const days = parseInt(req.query.days as string) || 7;
        const overview = await dataStorageService.getHistoricalContext(undefined, days);
        
        res.json({
          days,
          overview,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    });
    
    // Advanced Analytics Endpoints (Phase 2)
    
    // Get detailed sentiment trend analysis
    this.app.get('/api/analytics/advanced/sentiment-trend/:ticker', async (req, res) => {
      try {
        const { ticker } = req.params;
        const days = parseInt(req.query.days as string) || 30;
        const trendAnalysis = await dataStorageService.getSentimentTrendAnalysis(ticker.toUpperCase(), days);
        
        res.json({
          ticker: ticker.toUpperCase(),
          days,
          analysis: trendAnalysis,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    });
    
    // Get ticker correlation analysis
    this.app.get('/api/analytics/advanced/correlation/:ticker1/:ticker2', async (req, res) => {
      try {
        const { ticker1, ticker2 } = req.params;
        const days = parseInt(req.query.days as string) || 30;
        const correlation = await dataStorageService.getTickerCorrelationAnalysis(
          ticker1.toUpperCase(), 
          ticker2.toUpperCase(), 
          days
        );
        
        res.json({
          ticker1: ticker1.toUpperCase(),
          ticker2: ticker2.toUpperCase(),
          days,
          correlation,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    });
    
    // Get subreddit influence analysis
    this.app.get('/api/analytics/advanced/subreddit-influence', async (req, res) => {
      try {
        const days = parseInt(req.query.days as string) || 30;
        const influence = await dataStorageService.getSubredditInfluenceAnalysis(days);
        
        res.json({
          days,
          analysis: influence,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    });
    
    // Get AI decision accuracy tracking
    this.app.get('/api/analytics/advanced/ai-accuracy', async (req, res) => {
      try {
        const days = parseInt(req.query.days as string) || 30;
        const accuracy = await dataStorageService.getAIAccuracyTracking(days);
        
        res.json({
          days,
          accuracy,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    });
    
    // Get comprehensive analytics dashboard data
    this.app.get('/api/analytics/advanced/dashboard', async (req, res) => {
      try {
        const days = parseInt(req.query.days as string) || 7;
        
        // Get data for multiple analyses in parallel
        const [subredditInfluence, aiAccuracy] = await Promise.all([
          dataStorageService.getSubredditInfluenceAnalysis(days),
          dataStorageService.getAIAccuracyTracking(days)
        ]);
        
        res.json({
          days,
          dashboard: {
            subredditInfluence,
            aiAccuracy,
            topTickers: subredditInfluence.reduce((acc, sr) => {
              sr.topTickers.forEach(ticker => {
                const existing = acc.find(t => t.ticker === ticker.ticker);
                if (existing) {
                  existing.totalMentions += ticker.mentions;
                  existing.avgSentiment = (existing.avgSentiment + ticker.avgSentiment) / 2;
                } else {
                  acc.push({
                    ticker: ticker.ticker,
                    totalMentions: ticker.mentions,
                    avgSentiment: ticker.avgSentiment
                  });
                }
              });
              return acc;
            }, [] as any[])
          },
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    });
    
    // Get sentiment pattern analysis for multiple tickers
    this.app.post('/api/analytics/advanced/sentiment-patterns', async (req, res) => {
      try {
        const { tickers, days } = req.body;
        
        if (!Array.isArray(tickers) || tickers.length === 0) {
          return res.status(400).json({ error: 'Tickers array is required' });
        }
        
        if (tickers.length > 10) {
          return res.status(400).json({ error: 'Maximum 10 tickers allowed' });
        }
        
        const analysisPromises = tickers.map((ticker: string) =>
          dataStorageService.getSentimentTrendAnalysis(ticker.toUpperCase(), days || 30)
        );
        
        const analyses = await Promise.all(analysisPromises);
        
        const patterns = tickers.map((ticker: string, index: number) => ({
          ticker: ticker.toUpperCase(),
          analysis: analyses[index]
        }));
        
        return res.json({
          tickers: tickers.map(t => t.toUpperCase()),
          days: days || 30,
          patterns,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: errorMessage });
      }
    });
    
    // Get trading success correlation analysis
    this.app.get('/api/analytics/advanced/trading-success', async (req, res) => {
      try {
        const days = parseInt(req.query.days as string) || 30;
        
        // For now, return a placeholder structure
        // In a full implementation, this would correlate sentiment with actual trade performance
        const successAnalysis = {
          sentimentToSuccessCorrelation: 0.73, // Simulated correlation
          confidenceToSuccessCorrelation: 0.84,
          bestPerformingRanges: [
            { sentimentRange: '0.7-1.0', successRate: 0.82, trades: 24 },
            { sentimentRange: '0.4-0.7', successRate: 0.68, trades: 41 },
            { sentimentRange: '0.0-0.4', successRate: 0.45, trades: 18 }
          ],
          subredditPerformance: [
            { subreddit: 'CryptoCurrency', avgSuccess: 0.71, trades: 83 },
            { subreddit: 'Bitcoin', avgSuccess: 0.68, trades: 62 },
            { subreddit: 'ethereum', avgSuccess: 0.75, trades: 29 }
          ]
        };
        
        res.json({
          days,
          analysis: successAnalysis,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    });
  }

  /**
   * Setup Socket.IO handlers for real-time communication
   */
  private setupSocketHandlers(): void {
    this.io.on('connection', (socket) => {
      console.log('Dashboard client connected:', socket.id);

      // Send initial bot status
      socket.emit('botStatusUpdate', tradingBot.getStatus());

      // Handle log streaming requests
      socket.on('startLogStreaming', (options) => {
        this.startLogStreaming(socket, options);
      });

      socket.on('stopLogStreaming', () => {
        this.stopLogStreaming(socket);
      });

      // Handle bot control requests
      socket.on('botControl', async (action) => {
        try {
          let result: any = {};
          
          switch (action) {
            case 'start':
              await tradingBot.start();
              result = { status: 'started', message: 'Bot started' };
              break;
            case 'stop':
              await tradingBot.stop();
              result = { status: 'stopped', message: 'Bot stopped' };
              break;
            case 'restart':
              await tradingBot.stop();
              await new Promise(resolve => setTimeout(resolve, 2000));
              await tradingBot.start();
              result = { status: 'restarted', message: 'Bot restarted' };
              break;
          }
          
          this.io.emit('botStatusUpdate', result);
        } catch (error) {
          socket.emit('error', { message: error instanceof Error ? error.message : 'Unknown error' });
        }
      });

      socket.on('disconnect', () => {
        console.log('Dashboard client disconnected:', socket.id);
        this.stopLogStreaming(socket);
      });
    });
  }

  /**
   * Start streaming logs to a socket
   */
  private startLogStreaming(socket: any, _options: any = {}): void {
    const logFiles = [
      './logs/cpto-combined.log',
      './logs/cpto-error.log',
      './logs/cpto-out.log'
    ];

    // Also try PM2 logs
    const pm2LogDir = `${process.env.HOME}/.pm2/logs`;
    const pm2LogFiles = [
      `${pm2LogDir}/cpto-out.log`,
      `${pm2LogDir}/cpto-error.log`
    ];

    const allLogFiles = [...logFiles, ...pm2LogFiles];
    
    // Find existing log files
    const existingFiles = allLogFiles.filter(file => fs.existsSync(file));
    
    if (existingFiles.length === 0) {
      socket.emit('logUpdate', {
        level: 'warn',
        message: 'No log files found',
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Watch the first available log file
    const logFile = existingFiles[0];
    
    try {
      const tail = spawn('tail', ['-f', '-n', '50', logFile]);
      
      tail.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter((line: string) => line.trim());
        lines.forEach((line: string) => {
          if (line.trim()) {
            socket.emit('logUpdate', {
              level: this.detectLogLevel(line),
              message: line,
              timestamp: new Date().toISOString(),
              source: path.basename(logFile)
            });
          }
        });
      });
      
      tail.stderr.on('data', (data) => {
        socket.emit('logUpdate', {
          level: 'error',
          message: `Log streaming error: ${data.toString()}`,
          timestamp: new Date().toISOString()
        });
      });
      
      tail.on('close', (code) => {
        if (code !== 0) {
          socket.emit('logUpdate', {
            level: 'warn',
            message: `Log streaming stopped (exit code: ${code})`,
            timestamp: new Date().toISOString()
          });
        }
      });
      
      this.logWatchers.set(socket.id, tail);
      
    } catch (error) {
      socket.emit('logUpdate', {
        level: 'error',
        message: `Failed to start log streaming: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Stop streaming logs for a socket
   */
  private stopLogStreaming(socket: any): void {
    const watcher = this.logWatchers.get(socket.id);
    if (watcher) {
      watcher.kill();
      this.logWatchers.delete(socket.id);
    }
  }

  /**
   * Detect log level from log line
   */
  private detectLogLevel(line: string): string {
    const lowerLine = line.toLowerCase();
    if (lowerLine.includes('error') || lowerLine.includes('❌') || lowerLine.includes('failed')) return 'error';
    if (lowerLine.includes('warn') || lowerLine.includes('warning') || lowerLine.includes('⚠️')) return 'warn';
    if (lowerLine.includes('success') || lowerLine.includes('✅') || lowerLine.includes('started')) return 'success';
    if (lowerLine.includes('info') || lowerLine.includes('🔍') || lowerLine.includes('📊')) return 'info';
    return 'info';
  }

  /**
   * Setup trading bot event listeners for real-time updates
   */
  private setupTradingBotListeners(): void {
    // Listen for bot events and broadcast to connected clients
    tradingBot.on('botStarted', () => {
      this.io.emit('botStatusUpdate', { status: 'started', message: 'Bot started' });
    });
    
    tradingBot.on('botStopped', () => {
      this.io.emit('botStatusUpdate', { status: 'stopped', message: 'Bot stopped' });
    });
    
    tradingBot.on('historyProcessed', (data) => {
      this.io.emit('historyProcessed', {
        message: `Processed ${data.itemsQueued} Reddit items from ${data.subreddits.join(', ')}`,
        data: data
      });
    });
    
    tradingBot.on('queueUpdated', (data) => {
      this.io.emit('queueUpdate', {
        queueSize: data.size,
        newItem: {
          id: data.item.id,
          subreddit: data.item.subreddit,
          author: data.item.author
        }
      });
    });
    
    tradingBot.on('tradeExecuted', (data) => {
      this.io.emit('tradeExecuted', {
        ticker: data.signal.ticker,
        action: data.signal.action,
        amount: data.signal.amount_usd,
        price: data.result.executed_price,
        status: data.result.status,
        source: data.sourceItem.subreddit
      });
      
      // Also send notification
      this.io.emit('notification', {
        type: data.result.status === 'completed' ? 'success' : 'warning',
        message: `${data.signal.action.toUpperCase()} ${data.signal.ticker} for $${data.signal.amount_usd} - ${data.result.status}`
      });
    });
    
    tradingBot.on('processingError', (error) => {
      this.io.emit('notification', {
        type: 'error',
        message: `Processing error: ${error.message}`
      });
    });
    
    // Listen for pending trade events
    pendingTradesManager.on('newPendingTrade', (pendingTrade) => {
      this.io.emit('newPendingTrade', {
        trade: pendingTrade,
        message: `New trade pending approval: ${pendingTrade.signal.action.toUpperCase()} ${pendingTrade.signal.ticker}`
      });
      
      this.io.emit('notification', {
        type: 'info',
        message: `📋 New trade awaiting approval: ${pendingTrade.signal.action.toUpperCase()} ${pendingTrade.signal.ticker} ($${pendingTrade.signal.amount_usd})`
      });
    });
    
    pendingTradesManager.on('tradeApprovalProcessed', (data) => {
      const { pendingTrade, approval } = data;
      this.io.emit('tradeApprovalProcessed', {
        trade: pendingTrade,
        approval,
        message: `Trade ${approval.action}: ${pendingTrade.signal.action.toUpperCase()} ${pendingTrade.signal.ticker}`
      });
    });
    
    pendingTradesManager.on('tradeExpired', (pendingTrade) => {
      this.io.emit('tradeExpired', {
        trade: pendingTrade,
        message: `Trade expired: ${pendingTrade.signal.action.toUpperCase()} ${pendingTrade.signal.ticker}`
      });
      
      this.io.emit('notification', {
        type: 'warning',
        message: `⏰ Trade expired: ${pendingTrade.signal.action.toUpperCase()} ${pendingTrade.signal.ticker}`
      });
    });
    
    // Listen for portfolio refresh requests
    tradingBot.on('portfolioRefreshNeeded', (data) => {
      this.io.emit('portfolioRefreshNeeded', {
        reason: data.reason || 'Trading analysis',
        timestamp: new Date().toISOString()
      });
    });
    
    console.log('✅ Trading bot and pending trades event listeners setup complete');
  }
  
  /**
   * Trigger portfolio refresh for all connected clients
   */
  public triggerPortfolioRefresh(reason: string = 'Manual request'): void {
    this.io.emit('portfolioRefreshNeeded', {
      reason,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Start the web server
   */
  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, () => {
        console.log(`🌐 CPTO Dashboard running on http://localhost:${this.port}`);
        console.log(`🔗 Access your trading bot dashboard at the above URL`);
        resolve();
      }).on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  /**
   * Stop the web server
   */
  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      // Stop all log watchers
      this.logWatchers.forEach(watcher => watcher.kill());
      this.logWatchers.clear();
      
      this.server.close(() => {
        console.log('🌐 CPTO Dashboard stopped');
        resolve();
      });
    });
  }
}

// Export singleton instance
export const webServer = new WebServer();