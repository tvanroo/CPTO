import dotenv from 'dotenv';
import { AppConfig } from '../types';

// Load environment variables
dotenv.config();

/**
 * Validates and returns a required environment variable
 */
function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    if (process.env.NODE_ENV === 'test' || process.env.SKIP_CONFIG_VALIDATION === 'true') {
      console.warn(`Warning: Required environment variable ${key} is not set, using placeholder`);
      return `placeholder_${key.toLowerCase()}`;
    }
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

/**
 * Gets an optional environment variable with a default value
 */
function getOptionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

/**
 * Gets a numeric environment variable with validation
 */
function getNumericEnv(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) {
    return defaultValue;
  }
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid number, got: ${value}`);
  }
  return parsed;
}

/**
 * Validates and creates the application configuration
 */
export function createConfig(): AppConfig {
  try {
    // Check if we're in a test environment or missing critical env vars
    if (process.env.NODE_ENV === 'test' || process.env.SKIP_CONFIG_VALIDATION === 'true') {
      console.log('Skipping strict config validation for test environment');
    }
    
    const config: AppConfig = {
      // Reddit API Configuration
      reddit: {
        clientId: getRequiredEnv('REDDIT_CLIENT_ID'),
        clientSecret: getRequiredEnv('REDDIT_CLIENT_SECRET'),
        userAgent: getRequiredEnv('REDDIT_USER_AGENT'),
        username: getRequiredEnv('REDDIT_USERNAME'),
        password: getRequiredEnv('REDDIT_PASSWORD'),
      },

      // OpenAI Configuration
      openai: {
        apiKey: getRequiredEnv('OPENAI_API_KEY'),
        model: getOptionalEnv('OPENAI_MODEL', 'gpt-4-turbo'),
      },

      // TokenMetrics Configuration
      tokenmetrics: {
        apiKey: getRequiredEnv('TOKENMETRICS_API_KEY'),
        baseUrl: getOptionalEnv('TOKENMETRICS_BASE_URL', 'https://api.tokenmetrics.com'),
      },

      // Application Configuration
      app: {
        nodeEnv: getOptionalEnv('NODE_ENV', 'development'),
        port: getNumericEnv('PORT', 3000),
        logLevel: getOptionalEnv('LOG_LEVEL', 'info'),
      },

      // Trading Configuration
      trading: {
        subreddits: getOptionalEnv('SUBREDDITS', 'CryptoCurrency,Bitcoin,ethereum,altcoin,CryptoMoonShots')
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0),
        sentimentThreshold: getNumericEnv('SENTIMENT_THRESHOLD', 0.6),
        tradeAmountUsd: getNumericEnv('TRADE_AMOUNT_USD', 100),
        maxTradesPerHour: getNumericEnv('MAX_TRADES_PER_HOUR', 5),
      },

      // Database Configuration
      database: {
        path: getOptionalEnv('DATABASE_PATH', './data/cpto.db'),
      },
    };

    // Validate configuration values
    validateConfig(config);

    return config;
  } catch (error) {
    console.error('Configuration Error:', error);
    process.exit(1);
  }
}

/**
 * Validates the configuration for logical consistency
 */
function validateConfig(config: AppConfig): void {
  // Validate sentiment threshold
  if (config.trading.sentimentThreshold < -1 || config.trading.sentimentThreshold > 1) {
    throw new Error('SENTIMENT_THRESHOLD must be between -1 and 1');
  }

  // Validate trade amount
  if (config.trading.tradeAmountUsd <= 0) {
    throw new Error('TRADE_AMOUNT_USD must be greater than 0');
  }

  // Validate max trades per hour
  if (config.trading.maxTradesPerHour <= 0) {
    throw new Error('MAX_TRADES_PER_HOUR must be greater than 0');
  }

  // Validate subreddits
  if (config.trading.subreddits.length === 0) {
    throw new Error('At least one subreddit must be specified in SUBREDDITS');
  }

  // Validate port
  if (config.app.port < 1 || config.app.port > 65535) {
    throw new Error('PORT must be between 1 and 65535');
  }

  // Validate OpenAI model
  const validModels = ['gpt-4', 'gpt-4-turbo', 'gpt-4-turbo-preview', 'gpt-3.5-turbo'];
  if (!validModels.includes(config.openai.model)) {
    console.warn(`Warning: OpenAI model '${config.openai.model}' is not in the list of known models. This may cause API errors.`);
  }
}

/**
 * Global configuration instance - lazy loaded
 */
let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    _config = createConfig();
  }
  return _config;
}

// For backward compatibility
export const config = new Proxy({} as AppConfig, {
  get(_target, prop) {
    return getConfig()[prop as keyof AppConfig];
  }
});

/**
 * Helper to check if running in development mode
 */
export const isDevelopment = () => getConfig().app.nodeEnv === 'development';

/**
 * Helper to check if running in production mode
 */
export const isProduction = () => getConfig().app.nodeEnv === 'production';

/**
 * Export types for use in other modules
 */
export type { AppConfig } from '../types';