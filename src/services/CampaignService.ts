import mongoose from 'mongoose';
import MarketingCampaign, {
  IMarketingCampaign,
} from '../models/MarketingCampaign';
import CampaignExecution from '../models/CampaignExecution';
import { channelRouter } from '../channels';
import { Channel } from '../types/agent';

export interface CampaignLaunchOptions {
  tenantId: string;
  campaignId: string;
  /** Override the configured trigger and run immediately. */
  runNow?: boolean;
}

/**
 * Owns the campaign lifecycle:
 *   create → schedule → expand to recipients → enqueue executions →
 *   throttle send → record stats → correlate outcomes.
 *
 * Phase 1: every method below is a skeleton. Implementation order:
 *   1. expandRecipients (uses SegmentationService.materialise())
 *   2. enqueueExecutions (batch insert into CampaignExecution)
 *   3. tickSender (worker loop honouring rateLimitPerMinute + quietHours)
 *   4. recordWebhookEvent (delivery/read/reply callbacks per channel)
 *   5. correlateConversion (hook into Lead/Booking outcome events)
 */
export class CampaignService {
  async list(tenantId: string): Promise<IMarketingCampaign[]> {
    return MarketingCampaign.find({ tenantId }).sort({ createdAt: -1 });
  }

  async create(
    tenantId: string,
    payload: Partial<IMarketingCampaign>,
  ): Promise<IMarketingCampaign> {
    return MarketingCampaign.create({
      ...payload,
      tenantId: new mongoose.Types.ObjectId(tenantId),
    });
  }

  async update(
    tenantId: string,
    campaignId: string,
    patch: Partial<IMarketingCampaign>,
  ): Promise<IMarketingCampaign | null> {
    return MarketingCampaign.findOneAndUpdate(
      { _id: campaignId, tenantId },
      { $set: patch },
      { new: true },
    );
  }

  async launch(_opts: CampaignLaunchOptions): Promise<{ queued: number }> {
    // Phase 1:
    //   const campaign = await MarketingCampaign.findOne(...)
    //   const recipients = await segmentationService.materialise(campaign.segmentId)
    //   const docs = recipients.flatMap(r =>
    //     campaign.channels.map(ch => ({
    //       tenantId, campaignId, variantId: weightedPick(campaign.variants),
    //       channel: ch, recipientExternalId: r.handles[ch], status: 'queued'
    //     }))
    //   )
    //   await CampaignExecution.insertMany(docs)
    //   await MarketingCampaign.updateOne({ _id }, { $set: { status: 'running' }})
    return { queued: 0 };
  }

  /**
   * Worker loop tick — pulls next batch of queued executions, sends them via
   * channelRouter, updates stats. Phase 1 will run this on setInterval.
   */
  async tickSender(_tenantId: string): Promise<void> {
    // const next = await CampaignExecution.find({
    //   tenantId: _tenantId, status: 'queued'
    // }).limit(BATCH_SIZE)
    // for (const exec of next) {
    //   const result = await channelRouter.send({
    //     channel: exec.channel, tenantId, recipient: exec.recipientExternalId,
    //     text: variant.messageBody
    //   })
    //   exec.status = result.ok ? 'sent' : 'failed'
    //   exec.externalMessageId = result.externalMessageId
    //   await exec.save()
    // }
    void channelRouter; // silence unused for skeleton
  }

  /**
   * Called when an inbound message correlates to a previously-sent campaign
   * execution (matched by external message id thread). Feeds the reply-rate
   * metric and downstream conversion attribution.
   */
  async recordReply(
    _tenantId: string,
    _externalMessageId: string,
  ): Promise<void> {
    // CampaignExecution.updateOne({ externalMessageId }, { status: 'replied', repliedAt: now })
  }

  /**
   * Conversion attribution. Called by:
   *   - LeadService when Lead.status flips to a positive terminal state
   *   - BookingService when a Booking is finalised
   *
   * Looks back N days, finds CampaignExecutions for the same user, and marks
   * the most recent one as outcome='converted' for last-touch attribution.
   */
  async correlateConversion(
    _tenantId: string,
    _contactId: string,
    _kind: 'lead_converted' | 'booking_created',
  ): Promise<void> {
    // Look-back window 14 days; mark last campaign exec as outcome='converted'.
  }

  async pause(tenantId: string, campaignId: string): Promise<void> {
    await MarketingCampaign.updateOne(
      { _id: campaignId, tenantId },
      { $set: { status: 'paused' } },
    );
  }

  async resume(tenantId: string, campaignId: string): Promise<void> {
    await MarketingCampaign.updateOne(
      { _id: campaignId, tenantId },
      { $set: { status: 'running' } },
    );
  }

  /** Aggregate per-channel funnel stats — used by /api/marketing/insights. */
  async funnel(
    _tenantId: string,
    _campaignId: string,
  ): Promise<Record<Channel | 'total', number>[]> {
    return [];
  }
}

export const campaignService = new CampaignService();
// silence unused import for skeleton
void CampaignExecution;
