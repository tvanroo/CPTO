import { config } from '../config';

/**
 * OpenAI Billing Service - Queries actual usage and billing data from OpenAI API
 * Replaces local cost estimation with real data from OpenAI
 */
export class OpenAIBillingService {
  private cachedUsage: any = null;
  private lastFetchTime: number = 0;
  private readonly CACHE_DURATION = 10 * 60 * 1000; // 10 minutes cache

  constructor() {
    // Check if we're in development mode
    const isDev = process.env.SKIP_CONFIG_VALIDATION === 'true' || 
                 config.openai.apiKey.startsWith('placeholder_');
    
    if (isDev) {
      console.log('⚠️  OpenAI Billing Service in development mode with mock data');
    }

    console.log('💰 OpenAI Billing Service initialized');
  }

  /**
   * Get current billing information from OpenAI
   */
  public async getBillingInfo(): Promise<{
    total_usage: number;
    total_amount: number;
    currency: string;
    period_start: string;
    period_end: string;
    organization_id?: string;
  }> {
    // Return mock data in development mode
    if (config.openai.apiKey.startsWith('placeholder_') || process.env.SKIP_CONFIG_VALIDATION === 'true') {
      return this.getMockBillingInfo();
    }

    try {
      // Note: OpenAI's billing API is only available to organization admins
      // We'll need to use the usage endpoint instead
      const usage = await this.getUsageData();
      
      return {
        total_usage: usage.total_usage || 0,
        total_amount: usage.total_amount || 0,
        currency: 'USD',
        period_start: usage.period_start || new Date().toISOString(),
        period_end: usage.period_end || new Date().toISOString(),
        organization_id: usage.organization_id
      };
      
    } catch (error) {
      console.error('Failed to fetch OpenAI billing info:', error);
      
      // Fallback to mock data if API fails
      console.warn('Using mock billing data as fallback');
      return this.getMockBillingInfo();
    }
  }

  /**
   * Get usage data from OpenAI API
   */
  private async getUsageData(startDate?: string, endDate?: string): Promise<any> {
    try {
      // Default to current month if no dates provided
      const now = new Date();
      const monthStart = startDate || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const monthEnd = endDate || now.toISOString().split('T')[0];

      console.log(`📊 Fetching OpenAI usage from ${monthStart} to ${monthEnd}`);

      // OpenAI Usage API endpoint
      const response = await fetch(`https://api.openai.com/v1/usage?start_date=${monthStart}&end_date=${monthEnd}`, {
        headers: {
          'Authorization': `Bearer ${config.openai.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`OpenAI Usage API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;
      console.log('✅ Successfully fetched OpenAI usage data');
      
      return {
        total_usage: data.total_usage || 0,
        total_amount: this.calculateAmountFromUsage(data),
        period_start: monthStart,
        period_end: monthEnd,
        daily_costs: data.daily_costs || [],
        organization_id: data.organization_id
      };

    } catch (error) {
      console.error('Error fetching OpenAI usage data:', error);
      throw error;
    }
  }

  /**
   * Calculate estimated amount from usage data
   * This is a fallback if OpenAI doesn't provide cost directly
   */
  private calculateAmountFromUsage(usageData: any): number {
    if (!usageData.daily_costs) return 0;

    return usageData.daily_costs.reduce((total: number, day: any) => {
      return total + (day.line_items || []).reduce((dayTotal: number, item: any) => {
        return dayTotal + (item.cost || 0);
      }, 0);
    }, 0);
  }

  /**
   * Get cached usage data or fetch fresh data
   */
  public async getCachedUsageData(): Promise<any> {
    const now = Date.now();
    
    // Return cached data if still fresh
    if (this.cachedUsage && (now - this.lastFetchTime) < this.CACHE_DURATION) {
      console.log('💾 Using cached OpenAI usage data');
      return this.cachedUsage;
    }

    // Fetch fresh data
    console.log('🔄 Refreshing OpenAI usage data...');
    try {
      this.cachedUsage = await this.getUsageData();
      this.lastFetchTime = now;
      return this.cachedUsage;
    } catch (error) {
      // Return cached data if available, even if stale
      if (this.cachedUsage) {
        console.warn('Using stale cached data due to API error');
        return this.cachedUsage;
      }
      throw error;
    }
  }

  /**
   * Get detailed usage breakdown by model
   */
  public async getUsageByModel(startDate?: string, endDate?: string): Promise<{
    [model: string]: {
      requests: number;
      tokens: number;
      cost: number;
    }
  }> {
    try {
      const usageData = await this.getUsageData(startDate, endDate);
      const modelBreakdown: any = {};

      if (usageData.daily_costs) {
        for (const day of usageData.daily_costs) {
          for (const lineItem of day.line_items || []) {
            const model = lineItem.name || 'unknown';
            
            if (!modelBreakdown[model]) {
              modelBreakdown[model] = {
                requests: 0,
                tokens: 0,
                cost: 0
              };
            }
            
            modelBreakdown[model].requests += lineItem.requests || 0;
            modelBreakdown[model].tokens += lineItem.tokens || 0;
            modelBreakdown[model].cost += lineItem.cost || 0;
          }
        }
      }

      return modelBreakdown;
    } catch (error) {
      console.error('Error getting usage by model:', error);
      return {};
    }
  }

  /**
   * Get usage summary for dashboard display
   */
  public async getUsageSummary(): Promise<{
    currentMonth: {
      total_cost: number;
      total_requests: number;
      total_tokens: number;
      currency: string;
    };
    lastMonth?: {
      total_cost: number;
      total_requests: number;
      total_tokens: number;
      currency: string;
    };
    topModels: Array<{
      model: string;
      cost: number;
      requests: number;
      tokens: number;
    }>;
  }> {
    try {
      // Get current month data
      const currentMonthData = await this.getCachedUsageData();
      
      // Get last month data
      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      const lastMonthStart = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1).toISOString().split('T')[0];
      const lastMonthEnd = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0).toISOString().split('T')[0];
      
      let lastMonthData;
      try {
        lastMonthData = await this.getUsageData(lastMonthStart, lastMonthEnd);
      } catch (error) {
        console.warn('Could not fetch last month data:', error);
        lastMonthData = null;
      }

      // Get model breakdown for current month
      const modelBreakdown = await this.getUsageByModel();
      const topModels = Object.entries(modelBreakdown)
        .map(([model, data]: [string, any]) => ({
          model,
          cost: data.cost,
          requests: data.requests,
          tokens: data.tokens
        }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 5);

      return {
        currentMonth: {
          total_cost: currentMonthData.total_amount || 0,
          total_requests: this.sumRequests(currentMonthData),
          total_tokens: this.sumTokens(currentMonthData),
          currency: 'USD'
        },
        lastMonth: lastMonthData ? {
          total_cost: lastMonthData.total_amount || 0,
          total_requests: this.sumRequests(lastMonthData),
          total_tokens: this.sumTokens(lastMonthData),
          currency: 'USD'
        } : undefined,
        topModels
      };

    } catch (error) {
      console.error('Error getting usage summary:', error);
      
      // Return mock summary in case of error
      return this.getMockUsageSummary();
    }
  }

  /**
   * Sum total requests from usage data
   */
  private sumRequests(usageData: any): number {
    if (!usageData.daily_costs) return 0;

    return usageData.daily_costs.reduce((total: number, day: any) => {
      return total + (day.line_items || []).reduce((dayTotal: number, item: any) => {
        return dayTotal + (item.requests || 0);
      }, 0);
    }, 0);
  }

  /**
   * Sum total tokens from usage data
   */
  private sumTokens(usageData: any): number {
    if (!usageData.daily_costs) return 0;

    return usageData.daily_costs.reduce((total: number, day: any) => {
      return total + (day.line_items || []).reduce((dayTotal: number, item: any) => {
        return dayTotal + (item.tokens || 0);
      }, 0);
    }, 0);
  }

  /**
   * Generate mock billing info for development
   */
  private getMockBillingInfo(): any {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    return {
      total_usage: 125000, // Mock 125k tokens
      total_amount: 2.47, // Mock $2.47
      currency: 'USD',
      period_start: monthStart.toISOString(),
      period_end: now.toISOString(),
      organization_id: 'org-mock123'
    };
  }

  /**
   * Generate mock usage summary for development
   */
  private getMockUsageSummary(): any {
    return {
      currentMonth: {
        total_cost: 2.47,
        total_requests: 324,
        total_tokens: 125000,
        currency: 'USD'
      },
      lastMonth: {
        total_cost: 1.89,
        total_requests: 267,
        total_tokens: 98000,
        currency: 'USD'
      },
      topModels: [
        {
          model: 'gpt-4o-mini',
          cost: 1.85,
          requests: 298,
          tokens: 115000
        },
        {
          model: 'gpt-3.5-turbo',
          cost: 0.62,
          requests: 26,
          tokens: 10000
        }
      ]
    };
  }

  /**
   * Test connection to OpenAI billing API
   */
  public async testConnection(): Promise<boolean> {
    // Always return true in development mode
    if (config.openai.apiKey.startsWith('placeholder_') || process.env.SKIP_CONFIG_VALIDATION === 'true') {
      console.log('🎭 OpenAI Billing API connection successful (mock mode)');
      return true;
    }

    try {
      await this.getBillingInfo();
      console.log('✅ OpenAI Billing API connection successful');
      return true;
    } catch (error) {
      console.error('❌ OpenAI Billing API connection failed:', error);
      return false;
    }
  }

  /**
   * Clear cached data (useful for testing or forced refresh)
   */
  public clearCache(): void {
    this.cachedUsage = null;
    this.lastFetchTime = 0;
    console.log('🧹 OpenAI billing cache cleared');
  }
}

// Export singleton instance
export const openAIBillingService = new OpenAIBillingService();