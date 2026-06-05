import mongoose from 'mongoose';
import { Channel } from '../types/agent';
import CampaignExecution from '../models/CampaignExecution';
import MarketingCampaign from '../models/MarketingCampaign';

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

// "Delivered" counts any state at-or-past delivery (delivered/read/replied).
// "Read" counts read or replied. "Sent" counts anything that actually left
// the queue (sent and every later state). Bounced/failed are excluded from
// the funnel counts (they never reached the recipient).
const SENT_STATES = ['sent', 'delivered', 'read', 'replied'];
const DELIVERED_STATES = ['delivered', 'read', 'replied'];
const READ_STATES = ['read', 'replied'];

/**
 * Builds analyst-ready marketing performance reports by aggregating real
 * CampaignExecution rows per channel and per campaign for a tenant, then
 * surfacing deterministic, data-driven recommendations. No external LLM call
 * is required for the core numbers — they come straight from the database.
 */
export class MarketingInsightsService {
  async perChannelPerformance(
    tenantId: string,
    windowDays = 30,
  ): Promise<ChannelPerformance[]> {
    if (!tenantId) return [];
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const tid = new mongoose.Types.ObjectId(String(tenantId));

    const rows = await CampaignExecution.aggregate([
      { $match: { tenantId: tid, createdAt: { $gte: since } } },
      {
        $group: {
          _id: '$channel',
          sent: {
            $sum: { $cond: [{ $in: ['$status', SENT_STATES] }, 1, 0] },
          },
          delivered: {
            $sum: { $cond: [{ $in: ['$status', DELIVERED_STATES] }, 1, 0] },
          },
          read: {
            $sum: { $cond: [{ $in: ['$status', READ_STATES] }, 1, 0] },
          },
          replied: {
            $sum: { $cond: [{ $eq: ['$status', 'replied'] }, 1, 0] },
          },
          converted: {
            $sum: { $cond: [{ $eq: ['$outcome', 'converted'] }, 1, 0] },
          },
        },
      },
      { $sort: { sent: -1 } },
    ]);

    return rows.map((r: any) => {
      const sent = r.sent || 0;
      const converted = r.converted || 0;
      // Cost is not yet metered per execution; surface 0 rather than a guess.
      const costUsd = 0;
      return {
        channel: r._id as Channel,
        sent,
        delivered: r.delivered || 0,
        read: r.read || 0,
        replied: r.replied || 0,
        converted,
        costUsd,
        conversionRate: sent > 0 ? converted / sent : 0,
        costPerConversion: converted > 0 ? costUsd / converted : 0,
      };
    });
  }

  /**
   * Top campaigns by conversions in the window. Joins execution outcomes back
   * to campaign names so the UI can show a leaderboard.
   */
  async topCampaigns(
    tenantId: string,
    windowDays = 30,
    limit = 5,
  ): Promise<MarketingInsightsReport['topCampaigns']> {
    if (!tenantId) return [];
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const tid = new mongoose.Types.ObjectId(String(tenantId));

    const rows = await CampaignExecution.aggregate([
      { $match: { tenantId: tid, createdAt: { $gte: since } } },
      {
        $group: {
          _id: '$campaignId',
          sent: {
            $sum: { $cond: [{ $in: ['$status', SENT_STATES] }, 1, 0] },
          },
          converted: {
            $sum: { $cond: [{ $eq: ['$outcome', 'converted'] }, 1, 0] },
          },
        },
      },
      { $sort: { converted: -1, sent: -1 } },
      { $limit: limit },
    ]);

    if (rows.length === 0) return [];

    const ids = rows.map((r: any) => r._id);
    const campaigns = await MarketingCampaign.find({ _id: { $in: ids } })
      .select('name')
      .lean();
    const nameById = new Map(
      campaigns.map((c: any) => [String(c._id), c.name as string]),
    );

    return rows.map((r: any) => {
      const sent = r.sent || 0;
      const converted = r.converted || 0;
      return {
        campaignId: String(r._id),
        name: nameById.get(String(r._id)) || 'Unknown campaign',
        converted,
        conversionRate: sent > 0 ? converted / sent : 0,
      };
    });
  }

  /**
   * Deterministic, data-driven recommendations derived from the aggregates —
   * honest and actionable, no fabricated numbers.
   */
  private buildRecommendations(
    perChannel: ChannelPerformance[],
  ): MarketingInsightsReport['recommendations'] {
    const recs: MarketingInsightsReport['recommendations'] = [];
    if (perChannel.length === 0) return recs;

    const totalSent = perChannel.reduce((s, c) => s + c.sent, 0);
    const totalConverted = perChannel.reduce((s, c) => s + c.converted, 0);

    // Best & worst converting channels with enough volume to be meaningful.
    const ranked = [...perChannel]
      .filter((c) => c.sent >= 10)
      .sort((a, b) => b.conversionRate - a.conversionRate);

    if (ranked.length > 0) {
      const best = ranked[0];
      recs.push({
        title: `${best.channel} is your best converting channel`,
        detail: `${best.channel} converts at ${(best.conversionRate * 100).toFixed(1)}% (${best.converted}/${best.sent}). Consider shifting more budget here.`,
        severity: 'opportunity',
      });
      const worst = ranked[ranked.length - 1];
      if (ranked.length > 1 && worst.conversionRate < best.conversionRate / 2) {
        recs.push({
          title: `${worst.channel} is underperforming`,
          detail: `${worst.channel} converts at only ${(worst.conversionRate * 100).toFixed(1)}%. Review the message/offer or pause it.`,
          severity: 'warning',
        });
      }
    }

    // Delivery health: high send but low delivery suggests bad numbers / blocks.
    for (const c of perChannel) {
      if (c.sent >= 20 && c.delivered / c.sent < 0.7) {
        recs.push({
          title: `Low delivery rate on ${c.channel}`,
          detail: `Only ${((c.delivered / c.sent) * 100).toFixed(0)}% of ${c.channel} messages were delivered. Check for invalid recipients or rate limits.`,
          severity: 'warning',
        });
      }
    }

    if (totalSent > 0 && totalConverted === 0) {
      recs.push({
        title: 'No conversions recorded yet',
        detail: `You've sent ${totalSent} messages but recorded no conversions. Make sure booking/lead outcomes are being attributed back to campaigns.`,
        severity: 'info',
      });
    }

    return recs;
  }

  async buildReport(
    tenantId: string,
    windowDays = 30,
  ): Promise<MarketingInsightsReport> {
    const [perChannel, topCampaigns] = await Promise.all([
      this.perChannelPerformance(tenantId, windowDays),
      this.topCampaigns(tenantId, windowDays),
    ]);
    return {
      tenantId,
      windowDays,
      generatedAt: new Date(),
      perChannel,
      topCampaigns,
      recommendations: this.buildRecommendations(perChannel),
    };
  }
}

export const marketingInsightsService = new MarketingInsightsService();
