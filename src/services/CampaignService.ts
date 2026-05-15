import mongoose from 'mongoose';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import MarketingCampaign, {
  IMarketingCampaign,
} from '../models/MarketingCampaign';
import CampaignExecution from '../models/CampaignExecution';
import Tenant from '../models/Tenant';
import AgentPromptVersion from '../models/AgentPromptVersion';
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

function stripJsonFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
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
      variantId: v.variantId || `ai-${nanoid(8)}`,
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

  async launch(_opts: CampaignLaunchOptions): Promise<{ queued: number }> {
    // Phase 3 sender pipeline — kept as a stub deliberately:
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
   * channelRouter, updates stats. Phase 3 will run this on setInterval.
   */
  async tickSender(_tenantId: string): Promise<void> {
    // Phase 3 implementation; left intentionally empty.
    void channelRouter;
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
void CampaignExecution;
void CHANNEL_VALUES;
