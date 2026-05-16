import mongoose from 'mongoose';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import MarketingCampaign, {
  IMarketingCampaign,
} from '../models/MarketingCampaign';
import CampaignExecution from '../models/CampaignExecution';
import Tenant from '../models/Tenant';
import AgentPromptVersion from '../models/AgentPromptVersion';
import { Contact } from '../models/CRM';
import { aiLoadBalancer } from './AILoadBalancer';
import { channelRouter } from '../channels';
import { Channel } from '../types/agent';
import { CAMPAIGN_GENERATOR_V1_PROMPT } from '../agents/prompts/campaign-generator-v1';

export interface CampaignLaunchOptions {
  tenantId: string;
  campaignId: string;
  /** Override the configured trigger and run immediately. */
  runNow?: boolean;
}

export interface GenerateVariantsOptions {
  tenantId: string;
  campaignId: string;
  audienceDescription: string;
  goal: string;
  channels?: Channel[];
  variantCount?: number;
  languageHint?: string;
}

const CHANNEL_VALUES: Channel[] = [
  'whatsapp',
  'telegram',
  'instagram',
  'facebook',
  'email',
];

const VariantSchema = z.object({
  variantId: z.string().min(1).max(60),
  messageBody: z.string().min(1).max(3000),
  channel: z.enum(['whatsapp', 'telegram', 'instagram', 'facebook', 'email']),
  estimatedReadTimeSec: z.number().min(0).default(15),
  rationale: z.string().min(1).max(400),
});

const GeneratorOutputSchema = z.object({
  variants: z.array(VariantSchema).min(0).max(10),
  shouldAttachImage: z.boolean().default(false),
  callToAction: z.string().max(400).default(''),
});

type GeneratorOutput = z.infer<typeof GeneratorOutputSchema>;

export function stripJsonFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

export function pickRecipientHandle(
  contact: any,
  channel: Channel,
): string | undefined {
  switch (channel) {
    case 'whatsapp': {
      const raw = contact.whatsappNumber || contact.whatsappId || contact.phone;
      if (!raw) return undefined;
      const digits = String(raw).replace(/\D/g, '');
      if (!digits) return undefined;
      return `${digits}@s.whatsapp.net`;
    }
    case 'email':
      return contact.email || undefined;
    default:
      // Other channels need their own handle field on Contact (e.g.
      // telegramChatId, instagramId) which is a Phase 5 schema add.
      return undefined;
  }
}

export function weightedPickVariantId(
  variants: Array<{ variantId: string; weight?: number }>,
): string | undefined {
  if (variants.length === 0) return undefined;
  const total = variants.reduce((s, v) => s + Math.max(0, v.weight ?? 1), 0);
  if (total <= 0) return variants[0].variantId;
  let pick = Math.random() * total;
  for (const v of variants) {
    pick -= Math.max(0, v.weight ?? 1);
    if (pick <= 0) return v.variantId;
  }
  return variants[variants.length - 1].variantId;
}

export function isInQuietHours(
  campaign: Pick<IMarketingCampaign, 'quietHours'>,
  now: Date = new Date(),
): boolean {
  const qh = campaign.quietHours;
  if (
    !qh ||
    typeof qh.startHour !== 'number' ||
    typeof qh.endHour !== 'number'
  ) {
    return false;
  }
  const hour = now.getHours();
  if (qh.startHour <= qh.endHour) {
    return hour >= qh.startHour && hour < qh.endHour;
  }
  // Wraps midnight.
  return hour >= qh.startHour || hour < qh.endHour;
}

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

  /**
   * Operator-invoked A/B variant generator. Calls the CampaignGenerator
   * agent's v1 prompt via the AI load balancer, validates the JSON output
   * against GeneratorOutputSchema, persists the variants onto the campaign
   * (replacing any existing AI-generated variants but preserving human-
   * authored ones), and records token usage on the agent's prompt-version
   * metrics row.
   */
  async generateVariants(opts: GenerateVariantsOptions): Promise<{
    variants: GeneratorOutput['variants'];
    callToAction: string;
    shouldAttachImage: boolean;
    tokensUsed: number;
    provider: string;
  }> {
    const tenant = await Tenant.findById(opts.tenantId);
    const campaign = await MarketingCampaign.findOne({
      _id: opts.campaignId,
      tenantId: opts.tenantId,
    });
    if (!campaign) throw new Error('campaign_not_found');

    const channels =
      opts.channels && opts.channels.length > 0
        ? opts.channels
        : ((campaign.channels as Channel[]) ?? ['whatsapp']);
    const variantCount = Math.max(1, Math.min(opts.variantCount ?? 3, 5));
    const language =
      opts.languageHint ?? tenant?.brand?.primaryLanguage ?? 'si';
    const brandVoice = tenant?.brand?.voice ?? 'warm, professional';
    const industry = tenant?.brand?.industry ?? 'general business';

    const userMessage = [
      `BRAND_VOICE: ${brandVoice}`,
      `INDUSTRY: ${industry}`,
      `LANGUAGE_MIX: ${language}`,
      `CAMPAIGN_NAME: ${campaign.name}`,
      `CAMPAIGN_GOAL: ${opts.goal}`,
      `AUDIENCE_DESCRIPTION: ${opts.audienceDescription}`,
      `CHANNELS: ${channels.join(', ')}`,
      `N_VARIANTS: ${variantCount}`,
    ].join('\n');

    const raw = await aiLoadBalancer.sendMessageRaw({
      systemPrompt: CAMPAIGN_GENERATOR_V1_PROMPT,
      userMessage,
    });

    let parsed: GeneratorOutput;
    try {
      const json = JSON.parse(stripJsonFences(raw.text));
      const result = GeneratorOutputSchema.safeParse(json);
      if (!result.success) {
        throw new Error(
          `generator_output_invalid: ${result.error.message.slice(0, 200)}`,
        );
      }
      parsed = result.data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`generator_parse_failed: ${msg}`);
    }

    // Persist generated variants — replace existing AI-generated variants,
    // preserve operator-authored ones so human edits aren't lost.
    const existingHuman = (campaign.variants ?? []).filter(
      (v) => v.generatedBy !== 'campaign_generator_agent',
    );
    const newVariants = parsed.variants.map((v) => ({
      variantId: v.variantId || `ai-${randomUUID().slice(0, 8)}`,
      weight: Math.floor(100 / parsed.variants.length),
      messageBody: v.messageBody,
      generatedBy: 'campaign_generator_agent' as const,
    }));
    campaign.variants = [...existingHuman, ...newVariants] as any;
    await campaign.save();

    const tokensUsed = raw.inputTokens + raw.outputTokens;
    // Fire-and-forget metrics — never block the response on this.
    AgentPromptVersion.updateOne(
      { agentName: 'campaign_generator', version: 1 },
      {
        $inc: {
          'metrics.uses': 1,
          'metrics.totalLatencyMs': raw.latencyMs,
          'metrics.totalTokens': tokensUsed,
        },
        $set: { 'metrics.lastUsedAt': new Date() },
      },
    ).catch((err) =>
      console.error('CampaignService.generateVariants metrics update:', err),
    );

    return {
      variants: parsed.variants,
      callToAction: parsed.callToAction,
      shouldAttachImage: parsed.shouldAttachImage,
      tokensUsed,
      provider: raw.provider,
    };
  }

  /**
   * Expand the campaign to a concrete list of CampaignExecution rows
   * (one per recipient × channel pair) and flip the campaign to
   * 'running'. WhatsApp-first: for any other channel listed on the
   * campaign we still create executions, but they'll only actually send
   * once that channel has an active ChannelConnection.
   */
  async launch(opts: CampaignLaunchOptions): Promise<{ queued: number }> {
    const campaign = await MarketingCampaign.findOne({
      _id: opts.campaignId,
      tenantId: opts.tenantId,
    });
    if (!campaign) throw new Error('campaign_not_found');
    if (!campaign.variants || campaign.variants.length === 0) {
      throw new Error('no_variants');
    }
    const channels = (campaign.channels as Channel[]) ?? ['whatsapp'];
    if (channels.length === 0) throw new Error('no_channels');

    // Eligible contacts. Priority order:
    //   1. If campaign.segmentId is set, materialise via the
    //      SegmentationService rule engine (compile-to-Mongo, intersect
    //      Lead-scoped rules through phone numbers).
    //   2. Else, find any Contact with at least one usable handle for
    //      one of the campaign's channels. This is the "broadcast"
    //      fallback for campaigns that haven't been narrowed yet.
    let contacts: any[];
    if (campaign.segmentId) {
      const { segmentationService } = await import('./SegmentationService');
      const materialised = await segmentationService.materialise(
        opts.tenantId,
        String(campaign.segmentId),
      );
      if (materialised.length === 0) {
        throw new Error('segment_empty');
      }
      const ids = materialised.map(
        (r) => new mongoose.Types.ObjectId(r.contactId),
      );
      contacts = await Contact.find({ _id: { $in: ids } });
    } else {
      const channelHandleQuery: Record<string, any>[] = [];
      if (channels.includes('whatsapp')) {
        channelHandleQuery.push({ whatsappNumber: { $exists: true, $ne: '' } });
        channelHandleQuery.push({ whatsappId: { $exists: true, $ne: '' } });
        channelHandleQuery.push({ phone: { $exists: true, $ne: '' } });
      }
      if (channels.includes('email')) {
        channelHandleQuery.push({ email: { $exists: true, $ne: '' } });
      }
      if (channelHandleQuery.length === 0) {
        throw new Error('no_routable_channel');
      }
      // Hard 10k cap on the broadcast audience. If a campaign genuinely
      // needs to reach more contacts in one launch, the operator should
      // build a Segment (paginated, async-friendly) instead. Without this
      // cap a misconfigured query could load the entire contact table
      // into memory in one go.
      contacts = await Contact.find({ $or: channelHandleQuery })
        .limit(10_000)
        .lean();
    }

    const docs: any[] = [];
    for (const contact of contacts) {
      for (const channel of channels) {
        const recipient = pickRecipientHandle(contact, channel);
        if (!recipient) continue;
        const variantId = weightedPickVariantId(campaign.variants ?? []);
        if (!variantId) continue;
        docs.push({
          tenantId: campaign.tenantId,
          campaignId: campaign._id,
          variantId,
          channel,
          recipientExternalId: recipient,
          contactId: contact._id,
          status: 'queued',
        });
      }
    }
    if (docs.length > 0) {
      await CampaignExecution.insertMany(docs, { ordered: false });
    }
    await MarketingCampaign.updateOne(
      { _id: campaign._id },
      {
        $set: { status: 'running' },
        $inc: { 'stats.queued': docs.length },
      },
    );
    return { queued: docs.length };
  }

  /**
   * Worker loop tick — pulls the next batch of queued executions for the
   * tenant, respects per-campaign rate limits and quiet hours, and sends
   * each via channelRouter. Idempotent: a CampaignExecution moves out of
   * 'queued' before send() so a crashed worker can re-pick its row
   * without double-sending (the in-flight 'sending' status is the
   * single-writer guard).
   */
  async tickSender(tenantId: string): Promise<{ sent: number }> {
    const BATCH = 25;
    const queued = await CampaignExecution.find({
      tenantId,
      status: 'queued',
    }).limit(BATCH);
    if (queued.length === 0) return { sent: 0 };

    // Group by campaignId so we can apply per-campaign rate limits.
    const byCampaign = new Map<string, typeof queued>();
    for (const exec of queued) {
      const k = String(exec.campaignId);
      const bucket = byCampaign.get(k);
      if (bucket) bucket.push(exec as any);
      else byCampaign.set(k, [exec] as any);
    }

    let sent = 0;
    for (const [campaignKey, execs] of byCampaign.entries()) {
      const campaign = await MarketingCampaign.findById(campaignKey);
      if (!campaign || campaign.status !== 'running') continue;
      if (isInQuietHours(campaign)) continue;

      const limit = Math.max(1, campaign.rateLimitPerMinute ?? 30);
      // Convert per-minute limit to a per-tick cap; the loop runs roughly
      // every 30 seconds, so half the per-minute cap is the slice.
      const slice = Math.max(1, Math.floor(limit / 2));
      const subset = execs.slice(0, slice);

      const variantById = new Map(
        (campaign.variants ?? []).map((v) => [v.variantId, v]),
      );
      for (const exec of subset) {
        // Single-writer guard: only the worker that successfully moves
        // queued → sending may proceed.
        const claimed = await CampaignExecution.findOneAndUpdate(
          { _id: exec._id, status: 'queued' },
          { $set: { status: 'sending' }, $inc: { attemptCount: 1 } },
          { new: true },
        );
        if (!claimed) continue;

        const variant = variantById.get(exec.variantId);
        if (!variant) {
          await CampaignExecution.updateOne(
            { _id: claimed._id },
            {
              $set: {
                status: 'failed',
                errorMessage: 'variant_not_found_on_campaign',
              },
            },
          );
          continue;
        }
        const result = await channelRouter.send({
          channel: exec.channel,
          tenantId,
          recipient: exec.recipientExternalId,
          text: variant.messageBody,
        });
        const now = new Date();
        if (result.ok) {
          await CampaignExecution.updateOne(
            { _id: claimed._id },
            {
              $set: {
                status: 'sent',
                sentAt: now,
                externalMessageId: result.externalMessageId,
              },
            },
          );
          await MarketingCampaign.updateOne(
            { _id: campaign._id },
            { $inc: { 'stats.sent': 1 } },
          );
          sent++;
        } else {
          await CampaignExecution.updateOne(
            { _id: claimed._id },
            {
              $set: {
                status: 'failed',
                errorMessage: result.error,
              },
            },
          );
        }
      }
    }
    return { sent };
  }

  async recordReply(
    _tenantId: string,
    _externalMessageId: string,
  ): Promise<void> {
    // Phase 3 — match externalMessageId → CampaignExecution → mark 'replied'.
  }

  async correlateConversion(
    _tenantId: string,
    _contactId: string,
    _kind: 'lead_converted' | 'booking_created',
  ): Promise<void> {
    // Phase 3 — last-touch attribution within a 14-day window.
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

  async funnel(
    _tenantId: string,
    _campaignId: string,
  ): Promise<Record<Channel | 'total', number>[]> {
    return [];
  }
}

export const campaignService = new CampaignService();
// silence unused import (kept for downstream Phase 3 wiring)
void CHANNEL_VALUES;

// Multi-tenant safe: one interval per tenantId so several tenants can run
// their own pipelines concurrently. Previously a single module-level
// timer meant the second startCampaignSender() call was silently ignored
// — leaving every other tenant's campaigns un-ticked.
const senderIntervals: Map<string, NodeJS.Timeout> = new Map();

/**
 * Boots the periodic campaign sender for a single tenant. Idempotent per
 * tenantId. Stop via stopCampaignSender(tenantId) — or stopCampaignSender()
 * with no arg to halt every tenant timer.
 */
export function startCampaignSender(
  tenantId: string,
  intervalMs = 30_000,
): void {
  if (senderIntervals.has(tenantId)) return;
  const t = setInterval(async () => {
    try {
      await campaignService.tickSender(tenantId);
    } catch (err) {
      console.error(
        `campaignService.tickSender failed for tenant ${tenantId}:`,
        err,
      );
    }
  }, intervalMs);
  // Don't keep the event loop alive solely for this timer.
  t.unref?.();
  senderIntervals.set(tenantId, t);
}

export function stopCampaignSender(tenantId?: string): void {
  if (tenantId) {
    const existing = senderIntervals.get(tenantId);
    if (existing) {
      clearInterval(existing);
      senderIntervals.delete(tenantId);
    }
    return;
  }
  for (const [id, t] of senderIntervals) {
    clearInterval(t);
    senderIntervals.delete(id);
  }
}

