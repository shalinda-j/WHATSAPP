import { agentRegistry } from './AgentRegistry';
import { LeadQualifierAgent } from './LeadQualifierAgent';
import { LEAD_QUALIFIER_V1_PROMPT } from './prompts/lead-qualifier-v1';
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
    changelog: 'Initial production prompt (v1) — BANT extraction with strict no-hallucination rules and language-mirroring reply.',
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
    { $setOnInsert: { name: seed.agentName, mode: 'disabled' }, $set: { currentPromptVersion: 1 } },
    { upsert: true },
  );

  console.log(`🌱 Seeded ${seed.agentName} prompt v1`);
}

export async function registerCoreAgents(): Promise<void> {
  agentRegistry.register(new LeadQualifierAgent());

  for (const seed of PROMPT_SEEDS) {
    try {
      await seedPromptIfMissing(seed);
    } catch (err) {
      console.error(`Failed to seed prompt for ${seed.agentName}:`, err);
    }
  }

  await agentRegistry.forceReload();
  console.log(
    `🤖 Registered agents: ${agentRegistry.list().join(', ') || '(none)'}`,
  );
}
