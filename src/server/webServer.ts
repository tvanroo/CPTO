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
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Security
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
          scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.socket.io"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "ws:", "wss:"],
        },
      },
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