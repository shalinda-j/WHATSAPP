import { agentRegistry } from './AgentRegistry';
import { LeadQualifierAgent } from './LeadQualifierAgent';
import { PersonalizationAgent } from './PersonalizationAgent';
import { DealAgent } from './DealAgent';
import { CampaignGeneratorAgent } from './CampaignGeneratorAgent';
import { ContentRecommenderAgent } from './ContentRecommenderAgent';
import { SegmentationAgent } from './SegmentationAgent';
import { FollowUpAgent } from './FollowUpAgent';
import { LEAD_QUALIFIER_V1_PROMPT } from './prompts/lead-qualifier-v1';
import { PERSONALIZATION_V1_PROMPT } from './prompts/personalization-v1';
import { DEAL_AGENT_V1_PROMPT } from './prompts/deal-agent-v1';
import { CAMPAIGN_GENERATOR_V1_PROMPT } from './prompts/campaign-generator-v1';
import { CONTENT_RECOMMENDER_V1_PROMPT } from './prompts/content-recommender-v1';
import { SEGMENTATION_V1_PROMPT } from './prompts/segmentation-v1';
import { FOLLOWUP_V1_PROMPT } from './prompts/followup-v1';
import AgentConfig from '../models/AgentConfig';
import AgentPromptVersion from '../models/AgentPromptVersion';

interface PromptSeed {
  agentName: string;
  systemPrompt: string;
  changelog: string;
}

const PROMPT_SEEDS: PromptSeed[] = [
  {
    agentName: 'lead_qualifier',
    systemPrompt: LEAD_QUALIFIER_V1_PROMPT,
    changelog:
      'Initial production prompt (v1) — BANT extraction with strict no-hallucination rules and language-mirroring reply.',
  },
  {
    agentName: 'personalization',
    systemPrompt: PERSONALIZATION_V1_PROMPT,
    changelog:
      'Initial production prompt (v1) — CRM-aware greeting with name/tag extraction.',
  },
  {
    agentName: 'deal_agent',
    systemPrompt: DEAL_AGENT_V1_PROMPT,
    changelog:
      'Initial production prompt (v1) — closing pitch with Lead-aware personalization and booking-intent extraction.',
  },
  {
    agentName: 'campaign_generator',
    systemPrompt: CAMPAIGN_GENERATOR_V1_PROMPT,
    changelog:
      'Initial prompt (v1) — A/B campaign variant generator with per-channel length limits and anti-spam rules.',
  },
  {
    agentName: 'content_recommender',
    systemPrompt: CONTENT_RECOMMENDER_V1_PROMPT,
    changelog:
      'Initial prompt (v1) — next-best-content picker with id-allowlist enforcement.',
  },
  {
    agentName: 'segmentation',
    systemPrompt: SEGMENTATION_V1_PROMPT,
    changelog:
      'Initial prompt (v1) — NL → rule-engine compiler with field-path allowlist.',
  },
  {
    agentName: 'follow_up',
    systemPrompt: FOLLOWUP_V1_PROMPT,
    changelog:
      'Initial prompt (v1) — dormant-lead re-engagement with language-mirroring and quiet-hours awareness.',
  },
];

async function seedPromptIfMissing(seed: PromptSeed): Promise<void> {
  const existing = await AgentPromptVersion.findOne({
    agentName: seed.agentName,
    version: 1,
  });
  if (existing) return;

  await AgentPromptVersion.create({
    agentName: seed.agentName,
    version: 1,
    systemPrompt: seed.systemPrompt,
    changelog: seed.changelog,
    createdBy: 'system_bootstrap',
    isCurrent: true,
    isCandidate: false,
  });

  // Ensure the config row exists (the registry creates one on registration,
  // but the seed runs after registry.register() so the row already exists —
  // this is just a safety net) and that currentPromptVersion points to 1.
  await AgentConfig.updateOne(
    { name: seed.agentName },
    {
      $setOnInsert: { name: seed.agentName, mode: 'disabled' },
      $set: { currentPromptVersion: 1 },
    },
    { upsert: true },
  );

  console.log(`🌱 Seeded ${seed.agentName} prompt v1`);
}

export async function registerCoreAgents(): Promise<void> {
  agentRegistry.register(new LeadQualifierAgent());
  agentRegistry.register(new PersonalizationAgent());
  agentRegistry.register(new DealAgent());
  agentRegistry.register(new CampaignGeneratorAgent());
  agentRegistry.register(new ContentRecommenderAgent());
  agentRegistry.register(new SegmentationAgent());
  agentRegistry.register(new FollowUpAgent());

  for (const seed of PROMPT_SEEDS) {
    try {
      await seedPromptIfMissing(seed);
    } catch (err) {
      console.error(`Failed to seed prompt for ${seed.agentName}:`, err);
    }
  }

  await agentRegistry.forceReload();

  // FIX: Conversational agents must be active for the conversion pipeline to
  // work. The AgentRegistry creates them with mode='disabled' on first boot so
  // they appear in the dashboard but don't run until an operator enables them.
  // That design intent was correct for operator-invoked agents (campaign
  // generator, segmentation, follow_up) but wrong for the always-on
  // conversational agents (lead_qualifier, personalization, deal_agent,
  // content_recommender). We activate those here — matching the filter used in
  // AgentRegistry.findBestAgent(): isActive=true AND mode!='disabled'.
  // Using `mode: 'disabled'` in the filter means we only activate agents that
  // haven't already been deliberately set to something else via the admin UI.
  const CONVERSATIONAL_AGENTS = [
    'lead_qualifier',
    'personalization',
    'deal_agent',
    'content_recommender',
  ] as const;

  let activatedCount = 0;
  for (const agentName of CONVERSATIONAL_AGENTS) {
    const result = await AgentConfig.updateOne(
      { name: agentName, mode: 'disabled' },
      { $set: { mode: 'autonomous', isActive: true } },
    );
    if (result.modifiedCount > 0) {
      activatedCount++;
      console.log(`✅ Agent '${agentName}' activated → autonomous mode`);
    }
  }
  if (activatedCount > 0) {
    // Reload registry so in-memory mode reflects the DB update immediately.
    await agentRegistry.forceReload();
  }

  console.log(
    `🤖 Registered agents: ${agentRegistry.list().join(', ') || '(none)'}`,
  );
}
