import { Channel } from '../types/agent';

export interface ChannelPerformance {
  channel: Channel;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  converted: number;
  costUsd: number;
  conversionRate: number;
  costPerConversion: number;
}

export interface MarketingInsightsReport {
  tenantId: string;
  windowDays: number;
  generatedAt: Date;
  perChannel: ChannelPerformance[];
  topCampaigns: Array<{
    campaignId: string;
    name: string;
    converted: number;
    conversionRate: number;
  }>;
  /** LLM-generated narrative — what worked, what didn't, what to try next. */
  narrative?: string;
  /** Actionable suggestions surfaced by the MarketingInsightsAgent. */
  recommendations: Array<{
    title: string;
    detail: string;
    severity: 'info' | 'opportunity' | 'warning';
  }>;
}

/**
 * Builds analyst-ready reports + plumbs the data into the
 * MarketingInsightsAgent (Phase 6) for narrative + recommendation
 * generation.
 *
 * Phase 1: skeleton report shape so the frontend Insights page can be built
 * against the real contract.
 */
export class MarketingInsightsService {
  async perChannelPerformance(
    _tenantId: string,
    _windowDays = 30,
  ): Promise<ChannelPerformance[]> {
    // Aggregation pipeline against CampaignExecution + AgentExecution +
    // billed token costs grouped by channel.
    return [];
  }

  async buildReport(
    tenantId: string,
    windowDays = 30,
  ): Promise<MarketingInsightsReport> {
    const perChannel = await this.perChannelPerformance(tenantId, windowDays);
    return {
      tenantId,
      windowDays,
      generatedAt: new Date(),
      perChannel,
      topCampaigns: [],
      recommendations: [],
    };
  }
}

export const marketingInsightsService = new MarketingInsightsService();
