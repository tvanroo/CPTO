import { geminiClient } from '../clients/geminiClient';
import { CPTOError } from '../types';

/**
 * Service to validate and filter cryptocurrency tickers based on Gemini's supported symbols
 * Caches symbols to avoid frequent API calls and provides ticker mapping
 */
export class TickerValidationService {
  private supportedSymbols: Set<string> = new Set();
  private symbolsLastUpdated: number = 0;
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  private readonly COMMON_TICKER_MAPPINGS: Map<string, string[]> = new Map([
    // Map common ticker symbols to Gemini symbols
    ['BTC', ['btcusd', 'btceur']],
    ['ETH', ['ethusd', 'etheur', 'ethbtc']],
    ['LTC', ['ltcusd', 'ltceur', 'ltcbtc']],
    ['BCH', ['bchusd', 'bcheur', 'bchbtc']],
    ['LINK', ['linkusd', 'linkeur', 'linkbtc', 'linketh']],
    ['BAT', ['batusd', 'bateur', 'batbtc', 'bateth']],
    ['ZEC', ['zecusd', 'zeceur', 'zecbtc']],
    ['FIL', ['filusd', 'fileur', 'filbtc']],
    ['MATIC', ['maticusd', 'maticeur', 'maticbtc']],
    ['AAVE', ['aaveusd', 'aaveeur', 'aavebtc']],
    ['CRV', ['crvusd', 'crveur', 'crvbtc']],
    ['COMP', ['compusd', 'compeur', 'compbtc']],
    ['UNI', ['uniusd', 'unieur', 'unibtc']],
    ['MKR', ['mkrusd', 'mkreur', 'mkrbtc']],
    ['SNX', ['snxusd', 'snxeur', 'snxbtc']],
    ['SUSHI', ['sushiusd', 'sushieur', 'sushibtc']],
    ['DOGE', ['dogeusd', 'dogeeur', 'dogebtc']],
    ['SHIB', ['shibusd', 'shibeur', 'shibbtc']],
    ['FTM', ['ftmusd', 'ftmeur', 'ftmbtc']],
    ['SAND', ['sandusd', 'sandeur', 'sandbtc']],
    ['GRT', ['grtusd', 'grteur', 'grtbtc']],
    ['LRC', ['lrcusd', 'lrceur', 'lrcbtc']],
    ['ALGO', ['algousd', 'algoeur', 'algobtc']],
    ['AXS', ['axsusd', 'axseur', 'axsbtc']],
    ['CHZ', ['chzusd', 'chzeur', 'chzbtc']],
    ['MANA', ['manausd', 'manaeur', 'manabtc']],
    ['CTSI', ['ctsiusd', 'ctsieur', 'ctsibtc']],
    ['RBN', ['rbnusd', 'rbneth']],
    ['OXT', ['oxtusd', 'oxtbtc']],
    ['GUSD', ['gustusd', 'gusteur']],
    ['DAI', ['daiusd', 'daieur']],
    ['STORJ', ['storjusd', 'storjeur', 'storjbtc']]
  ]);

  constructor() {
    console.log('🎯 TickerValidationService initialized');
  }

  /**
   * Initialize or refresh the supported symbols cache
   */
  public async refreshSupportedSymbols(): Promise<void> {
    try {
      console.log('🔄 Refreshing Gemini supported symbols...');
      const symbols = await geminiClient.getSymbols();
      
      this.supportedSymbols.clear();
      symbols.forEach(symbol => {
        this.supportedSymbols.add(symbol.toLowerCase());
      });
      
      this.symbolsLastUpdated = Date.now();
      console.log(`✅ Loaded ${symbols.length} supported symbols from Gemini`);
      console.log(`📋 Sample symbols: ${Array.from(this.supportedSymbols).slice(0, 10).join(', ')}`);
      
    } catch (error) {
      console.warn('⚠️ Failed to refresh Gemini symbols, using cached data:', error);
      
      // If we have no cached data, use a basic set of common symbols
      if (this.supportedSymbols.size === 0) {
        console.log('💾 Using fallback symbol list');
        const fallbackSymbols = [
          'btcusd', 'ethusd', 'ltcusd', 'bchusd', 'linkusd', 'batusd', 
          'zecusd', 'filusd', 'maticusd', 'aaveusd', 'crvusd', 'compusd',
          'uniusd', 'mkrusd', 'snxusd', 'sushiusd', 'dogeusd', 'shibusd'
        ];
        fallbackSymbols.forEach(symbol => this.supportedSymbols.add(symbol));
        this.symbolsLastUpdated = Date.now();
      }
    }
  }

  /**
   * Check if symbols cache needs refreshing and do it if needed
   */
  private async ensureSymbolsLoaded(): Promise<void> {
    const now = Date.now();
    const needsRefresh = (now - this.symbolsLastUpdated) > this.CACHE_DURATION || this.supportedSymbols.size === 0;
    
    if (needsRefresh) {
      await this.refreshSupportedSymbols();
    }
  }

  /**
   * Validate and filter a list of tickers to only include those supported by Gemini
   * Maps common ticker symbols (BTC, ETH) to Gemini trading pairs (btcusd, ethusd)
   */
  public async validateAndFilterTickers(tickers: string[]): Promise<string[]> {
    await this.ensureSymbolsLoaded();
    
    const validTickers: string[] = [];
    const tickerStats = {
      input: tickers.length,
      mapped: 0,
      supported: 0,
      rejected: 0
    };

    for (const ticker of tickers) {
      const upperTicker = ticker.toUpperCase();
      
      // Try to find matching Gemini symbols for this ticker
      const geminiSymbols = this.findGeminiSymbolsForTicker(upperTicker);
      
      if (geminiSymbols.length > 0) {
        // Use the first (usually USD pair) symbol
        const primarySymbol = geminiSymbols[0];
        validTickers.push(primarySymbol.toUpperCase());
        tickerStats.mapped++;
        
        console.log(`✅ ${upperTicker} → ${primarySymbol.toUpperCase()}`);
      } else {
        tickerStats.rejected++;
        console.log(`❌ ${upperTicker} not supported by Gemini`);
      }
    }

    console.log(`📊 Ticker validation: ${tickerStats.input} input, ${tickerStats.mapped} mapped, ${tickerStats.rejected} rejected`);
    
    return validTickers;
  }

  /**
   * Find Gemini trading pair symbols for a given ticker
   */
  private findGeminiSymbolsForTicker(ticker: string): string[] {
    const matchingSymbols: string[] = [];
    
    // First check our predefined mappings
    if (this.COMMON_TICKER_MAPPINGS.has(ticker)) {
      const mappedSymbols = this.COMMON_TICKER_MAPPINGS.get(ticker) || [];
      for (const symbol of mappedSymbols) {
        if (this.supportedSymbols.has(symbol)) {
          matchingSymbols.push(symbol);
        }
      }
    }
    
    // If no predefined mapping, try common patterns
    if (matchingSymbols.length === 0) {
      const possibleSymbols = [
        `${ticker.toLowerCase()}usd`,
        `${ticker.toLowerCase()}eur`,
        `${ticker.toLowerCase()}btc`,
        `${ticker.toLowerCase()}eth`
      ];
      
      for (const symbol of possibleSymbols) {
        if (this.supportedSymbols.has(symbol)) {
          matchingSymbols.push(symbol);
        }
      }
    }
    
    return matchingSymbols;
  }

  /**
   * Get the primary trading symbol for a ticker (usually USD pair)
   */
  public async getPrimarySymbolForTicker(ticker: string): Promise<string | null> {
    const symbols = await this.validateAndFilterTickers([ticker]);
    return symbols.length > 0 ? symbols[0] : null;
  }

  /**
   * Get all supported symbols (for debugging/monitoring)
   */
  public async getAllSupportedSymbols(): Promise<string[]> {
    await this.ensureSymbolsLoaded();
    return Array.from(this.supportedSymbols).sort();
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): { symbolCount: number, lastUpdated: number, cacheAge: number } {
    return {
      symbolCount: this.supportedSymbols.size,
      lastUpdated: this.symbolsLastUpdated,
      cacheAge: Date.now() - this.symbolsLastUpdated
    };
  }

  /**
   * Convert Gemini symbol back to common ticker format for display
   */
  public geminiSymbolToTicker(geminiSymbol: string): string {
    const symbol = geminiSymbol.toLowerCase();
    
    // Extract base currency from trading pairs
    if (symbol.endsWith('usd')) {
      return symbol.replace('usd', '').toUpperCase();
    } else if (symbol.endsWith('eur')) {
      return symbol.replace('eur', '').toUpperCase();
    } else if (symbol.endsWith('btc')) {
      return symbol.replace('btc', '').toUpperCase();
    } else if (symbol.endsWith('eth')) {
      return symbol.replace('eth', '').toUpperCase();
    }
    
    return geminiSymbol.toUpperCase();
  }
}

// Export singleton instance
export const tickerValidationService = new TickerValidationService();