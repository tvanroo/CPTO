import { EventEmitter } from 'events';
import { PendingTrade, TradeSignal, TradeApproval, SentimentScore } from '../types';
import { config } from '../config';
import { dataStorageService } from './dataStorageService';

/**
 * Manages pending trades for manual approval mode
 */
export class PendingTradesManager extends EventEmitter {
  private pendingTrades: Map<string, PendingTrade> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    // Clean up expired trades every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTrades();
    }, 5 * 60 * 1000);
  }

  /**
   * Load pending trades from database on startup
   */
  public async loadFromDatabase(): Promise<number> {
    try {
      const trades = await dataStorageService.loadPendingTrades();
      
      for (const trade of trades) {
        this.pendingTrades.set(trade.id, trade);
      }
      
      console.log(`💾 Loaded ${trades.length} pending trades from database`);
      return trades.length;
    } catch (error) {
      console.error('Failed to load pending trades from database:', error);
      return 0;
    }
  }

  /**
   * Add a trade proposal for manual approval
   */
  public async addPendingTrade(
    signal: TradeSignal,
    sourceItem: {
      id: string;
      subreddit: string;
      author: string;
      content: string;
    },
    marketData: any,
    marketTrend: any,
    sentiment: SentimentScore
  ): Promise<PendingTrade> {
    const tradeId = this.generateTradeId();
    const now = Date.now();
    const expiresAt = now + (config.trading.pendingTradeExpiryHours * 60 * 60 * 1000);

    const pendingTrade: PendingTrade = {
      id: tradeId,
      signal,
      sourceItem,
      marketData,
      marketTrend,
      sentiment,
      createdAt: now,
      expiresAt,
      status: 'pending'
    };

    this.pendingTrades.set(tradeId, pendingTrade);

    // Save to database
    try {
      await dataStorageService.savePendingTrade(pendingTrade);
    } catch (error) {
      console.error('Failed to save pending trade to database:', error);
    }

    console.log(`📝 New pending trade: ${signal.action.toUpperCase()} ${signal.ticker} @ $${signal.amount_usd} (ID: ${tradeId})`);
    
    // Emit event for real-time notifications
    this.emit('newPendingTrade', pendingTrade);

    return pendingTrade;
  }

  /**
   * Approve or reject a pending trade
   */
  public async processTradeApproval(approval: TradeApproval): Promise<PendingTrade | null> {
    const pendingTrade = this.pendingTrades.get(approval.tradeId);
    
    if (!pendingTrade) {
      throw new Error(`Pending trade ${approval.tradeId} not found`);
    }

    if (pendingTrade.status !== 'pending') {
      throw new Error(`Trade ${approval.tradeId} is already ${pendingTrade.status}`);
    }

    // Check if trade has expired
    if (Date.now() > pendingTrade.expiresAt) {
      pendingTrade.status = 'expired';
      this.emit('tradeExpired', pendingTrade);
      throw new Error(`Trade ${approval.tradeId} has expired`);
    }

    // Update trade status
    pendingTrade.status = approval.action === 'approve' ? 'approved' : 'rejected';

    // Update database
    try {
      await dataStorageService.updatePendingTradeStatus(
        approval.tradeId,
        pendingTrade.status,
        approval.reason
      );
    } catch (error) {
      console.error('Failed to update pending trade status in database:', error);
    }

    console.log(`📝 Trade ${approval.tradeId} ${pendingTrade.status.toUpperCase()}: ${pendingTrade.signal.action.toUpperCase()} ${pendingTrade.signal.ticker}`);

    // Emit events for real-time notifications
    this.emit('tradeApprovalProcessed', {
      pendingTrade,
      approval
    });

    if (approval.action === 'approve') {
      this.emit('tradeApproved', pendingTrade);
    } else {
      this.emit('tradeRejected', pendingTrade);
    }

    // Remove from pending trades map after processing
    setTimeout(() => {
      this.pendingTrades.delete(approval.tradeId);
    }, 5000); // Keep for 5 seconds for any final processing

    return pendingTrade;
  }

  /**
   * Get all pending trades
   */
  public getPendingTrades(): PendingTrade[] {
    const now = Date.now();
    return Array.from(this.pendingTrades.values())
      .filter(trade => trade.status === 'pending' && trade.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt); // Newest first
  }

  /**
   * Get all trades (pending, approved, rejected, expired)
   */
  public getAllTrades(): PendingTrade[] {
    return Array.from(this.pendingTrades.values())
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get trade by ID
   */
  public getTradeById(tradeId: string): PendingTrade | null {
    return this.pendingTrades.get(tradeId) || null;
  }

  /**
   * Get statistics about pending trades
   */
  public getStatistics() {
    const trades = Array.from(this.pendingTrades.values());
    const now = Date.now();

    return {
      total: trades.length,
      pending: trades.filter(t => t.status === 'pending' && t.expiresAt > now).length,
      approved: trades.filter(t => t.status === 'approved').length,
      rejected: trades.filter(t => t.status === 'rejected').length,
      expired: trades.filter(t => t.status === 'expired' || t.expiresAt <= now).length,
      oldestPending: trades
        .filter(t => t.status === 'pending' && t.expiresAt > now)
        .reduce((oldest, trade) => 
          !oldest || trade.createdAt < oldest.createdAt ? trade : oldest, 
          null as PendingTrade | null
        )
    };
  }

  /**
   * Bulk approve or reject trades
   */
  public async bulkProcessTrades(tradeIds: string[], action: 'approve' | 'reject', reason?: string): Promise<{
    processed: PendingTrade[];
    errors: { tradeId: string; error: string }[];
  }> {
    const processed: PendingTrade[] = [];
    const errors: { tradeId: string; error: string }[] = [];

    for (const tradeId of tradeIds) {
      try {
        const result = await this.processTradeApproval({
          tradeId,
          action,
          reason: reason || `Bulk ${action} operation`
        });
        if (result) {
          processed.push(result);
        }
      } catch (error) {
        errors.push({
          tradeId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    this.emit('bulkTradeProcessed', {
      action,
      processed: processed.length,
      errors: errors.length,
      reason
    });

    return { processed, errors };
  }

  /**
   * Clear all expired trades
   */
  private cleanupExpiredTrades(): void {
    const now = Date.now();
    let expiredCount = 0;

    for (const [tradeId, trade] of this.pendingTrades.entries()) {
      if (trade.expiresAt <= now && trade.status === 'pending') {
        trade.status = 'expired';
        
        // Update database
        try {
          dataStorageService.updatePendingTradeStatus(tradeId, 'expired').catch(err => 
            console.error('Failed to update expired trade in database:', err)
          );
        } catch (error) {
          // Ignore errors during cleanup
        }
        
        this.emit('tradeExpired', trade);
        expiredCount++;
      }

      // Remove very old trades (older than 24 hours)
      if (trade.createdAt < now - (24 * 60 * 60 * 1000)) {
        this.pendingTrades.delete(tradeId);
      }
    }

    if (expiredCount > 0) {
      console.log(`🧹 Cleaned up ${expiredCount} expired pending trades`);
    }
  }

  /**
   * Generate unique trade ID
   */
  private generateTradeId(): string {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substr(2, 6);
    return `trade_${timestamp}_${randomPart}`;
  }

  /**
   * Clean up resources
   */
  public cleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.pendingTrades.clear();
  }

  /**
   * Check if trading mode requires manual approval
   */
  public static requiresApproval(): boolean {
    return config.trading.tradingMode === 'manual';
  }
}

// Export singleton instance
export const pendingTradesManager = new PendingTradesManager();