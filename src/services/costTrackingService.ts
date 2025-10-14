import { OpenAIApiCall, OpenAICostSummary, OpenAIUsageMetrics } from '../types/index';

// Simple UUID generator to avoid ES module issues
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * OpenAI API pricing per model (as of 2024)
 * Prices in USD per 1K tokens
 */
const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4-turbo-preview': { input: 0.01, output: 0.03 },
  'gpt-4-1106-preview': { input: 0.01, output: 0.03 },
  'gpt-4-0125-preview': { input: 0.01, output: 0.03 },
  'gpt-3.5-turbo': { input: 0.0015, output: 0.002 },
  'gpt-3.5-turbo-1106': { input: 0.001, output: 0.002 },
  'gpt-3.5-turbo-0125': { input: 0.0005, output: 0.0015 },
  'o1-preview': { input: 0.015, output: 0.06 },
  'o1-mini': { input: 0.003, output: 0.012 },
  'o4-mini': { input: 0.003, output: 0.012 }, // Assuming same as o1-mini
  'text-embedding-3-small': { input: 0.00002, output: 0 },
  'text-embedding-3-large': { input: 0.00013, output: 0 },
  'text-embedding-ada-002': { input: 0.0001, output: 0 }
};

export class CostTrackingService {
  private apiCalls: OpenAIApiCall[] = [];
  private readonly maxStoredCalls = 10000; // Limit memory usage

  constructor() {
    console.log('CostTrackingService initialized');
  }

  /**
   * Calculate cost for an OpenAI API call
   */
  private calculateCost(model: string, usage: OpenAIUsageMetrics): number {
    const pricing = OPENAI_PRICING[model.toLowerCase()];
    
    if (!pricing) {
      console.warn(`Unknown OpenAI model for pricing: ${model}, using gpt-3.5-turbo rates`);
      const fallbackPricing = OPENAI_PRICING['gpt-3.5-turbo'];
      return (usage.prompt_tokens * fallbackPricing.input + usage.completion_tokens * fallbackPricing.output) / 1000;
    }

    return (usage.prompt_tokens * pricing.input + usage.completion_tokens * pricing.output) / 1000;
  }

  /**
   * Track a new OpenAI API call
   */
  trackApiCall(
    model: string,
    usage: OpenAIUsageMetrics,
    purpose: string,
    inputLength: number = 0,
    outputLength: number = 0
  ): OpenAIApiCall {
    const apiCall: OpenAIApiCall = {
      id: generateId(),
      timestamp: Date.now(),
      model,
      usage,
      cost_usd: this.calculateCost(model, usage),
      purpose,
      input_length: inputLength,
      output_length: outputLength
    };

    this.apiCalls.push(apiCall);

    // Limit memory usage by keeping only recent calls
    if (this.apiCalls.length > this.maxStoredCalls) {
      this.apiCalls = this.apiCalls.slice(-this.maxStoredCalls);
    }

    console.log(`Tracked OpenAI API call: ${model} - $${apiCall.cost_usd.toFixed(4)} (${usage.total_tokens} tokens)`);
    
    return apiCall;
  }

  /**
   * Get cost summary for a specific time period
   */
  getCostSummary(startTime: number = 0, endTime: number = Date.now()): OpenAICostSummary {
    const relevantCalls = this.apiCalls.filter(call => 
      call.timestamp >= startTime && call.timestamp <= endTime
    );

    const summary: OpenAICostSummary = {
      total_calls: relevantCalls.length,
      total_tokens: 0,
      total_cost_usd: 0,
      cost_by_model: {},
      cost_by_purpose: {},
      period_start: startTime,
      period_end: endTime
    };

    for (const call of relevantCalls) {
      // Update totals
      summary.total_tokens += call.usage.total_tokens;
      summary.total_cost_usd += call.cost_usd;

      // Update cost by model
      if (!summary.cost_by_model[call.model]) {
        summary.cost_by_model[call.model] = {
          calls: 0,
          tokens: 0,
          cost_usd: 0
        };
      }
      summary.cost_by_model[call.model].calls += 1;
      summary.cost_by_model[call.model].tokens += call.usage.total_tokens;
      summary.cost_by_model[call.model].cost_usd += call.cost_usd;

      // Update cost by purpose
      if (!summary.cost_by_purpose[call.purpose]) {
        summary.cost_by_purpose[call.purpose] = {
          calls: 0,
          tokens: 0,
          cost_usd: 0
        };
      }
      summary.cost_by_purpose[call.purpose].calls += 1;
      summary.cost_by_purpose[call.purpose].tokens += call.usage.total_tokens;
      summary.cost_by_purpose[call.purpose].cost_usd += call.cost_usd;
    }

    return summary;
  }

  /**
   * Get cost summary for the past 24 hours
   */
  getCostSummaryLast24Hours(): OpenAICostSummary {
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    return this.getCostSummary(twentyFourHoursAgo);
  }

  /**
   * Get cumulative cost summary (all time)
   */
  getCumulativeCostSummary(): OpenAICostSummary {
    return this.getCostSummary();
  }

  /**
   * Get recent API calls for debugging
   */
  getRecentApiCalls(limit: number = 50): OpenAIApiCall[] {
    return this.apiCalls
      .slice(-limit)
      .reverse(); // Most recent first
  }

  /**
   * Clear old API calls (keep only last N days)
   */
  cleanupOldCalls(daysToKeep: number = 7): void {
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    const oldLength = this.apiCalls.length;
    
    this.apiCalls = this.apiCalls.filter(call => call.timestamp >= cutoffTime);
    
    const removedCount = oldLength - this.apiCalls.length;
    if (removedCount > 0) {
      console.log(`Cleaned up ${removedCount} old API call records`);
    }
  }

  /**
   * Get current statistics
   */
  getStats(): {
    totalCallsTracked: number;
    oldestCall: number | null;
    newestCall: number | null;
  } {
    return {
      totalCallsTracked: this.apiCalls.length,
      oldestCall: this.apiCalls.length > 0 ? this.apiCalls[0].timestamp : null,
      newestCall: this.apiCalls.length > 0 ? this.apiCalls[this.apiCalls.length - 1].timestamp : null
    };
  }
}

// Export singleton instance
export const costTrackingService = new CostTrackingService();