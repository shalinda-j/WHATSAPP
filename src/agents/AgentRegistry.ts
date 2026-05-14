import { IAgent } from '../interfaces/IAgent';
import { AgentContext } from '../types/agent';
import AgentConfig, { IAgentConfig } from '../models/AgentConfig';

const CONFIG_CACHE_TTL_MS = 60 * 1000;

interface RegisteredAgent {
  instance: IAgent;
  config: IAgentConfig | null;
}

export class AgentRegistry {
  private agents: Map<string, RegisteredAgent> = new Map();
  private lastConfigLoad = 0;
  private configLoadPromise: Promise<void> | null = null;

  register(agent: IAgent): void {
    if (this.agents.has(agent.name)) {
      throw new Error(`Agent already registered: ${agent.name}`);
    }
    this.agents.set(agent.name, { instance: agent, config: null });
    // Invalidate so next call hydrates config for the new agent
    this.lastConfigLoad = 0;
  }

  unregister(name: string): void {
    this.agents.delete(name);
  }

  list(): string[] {
    return Array.from(this.agents.keys());
  }

  getConfig(name: string): IAgentConfig | null {
    return this.agents.get(name)?.config ?? null;
  }

  async forceReload(): Promise<void> {
    this.lastConfigLoad = 0;
    await this.ensureConfigsLoaded();
  }

  private async ensureConfigsLoaded(): Promise<void> {
    const now = Date.now();
    if (this.agents.size === 0) return;
    if (now - this.lastConfigLoad < CONFIG_CACHE_TTL_MS) return;
    if (this.configLoadPromise) return this.configLoadPromise;

    this.configLoadPromise = this.loadConfigs();
    try {
      await this.configLoadPromise;
    } finally {
      this.configLoadPromise = null;
    }
  }

  private async loadConfigs(): Promise<void> {
    try {
      const names = Array.from(this.agents.keys());
      const configs = await AgentConfig.find({ name: { $in: names } });
      const byName = new Map<string, IAgentConfig>();
      for (const c of configs) byName.set(c.name, c);

      for (const name of names) {
        const entry = this.agents.get(name);
        if (!entry) continue;
        let config = byName.get(name) ?? null;
        if (!config) {
          // Bootstrap a default-disabled config so the agent surfaces in the
          // admin dashboard and can be enabled with one click — never silently
          // run an agent without an operator-visible config row.
          config = await AgentConfig.create({
            name,
            description: entry.instance.description,
            mode: 'disabled',
          });
        }
        entry.config = config;
        // Sync mode from DB → in-memory (single source of truth = Mongo)
        (entry.instance as any).mode = config.mode;
      }
      this.lastConfigLoad = Date.now();
    } catch (err) {
      console.error('AgentRegistry.loadConfigs failed:', err);
    }
  }

  /**
   * Returns the best candidate agent for the given context, or null if no
   * agent meets its configured confidence threshold. Runs canHandle() on
   * every active agent in parallel; ties broken by registration order.
   */
  async findBestAgent(ctx: AgentContext): Promise<{
    agent: IAgent;
    config: IAgentConfig;
    confidence: number;
  } | null> {
    await this.ensureConfigsLoaded();

    const candidates: Array<{
      entry: RegisteredAgent;
      score: number;
    }> = [];

    const scoringTasks = Array.from(this.agents.values())
      .filter(
        (e) => e.config && e.config.isActive && e.config.mode !== 'disabled',
      )
      .map(async (entry) => {
        try {
          const score = await entry.instance.canHandle(ctx);
          if (score >= (entry.config!.confidenceThreshold ?? 0.5)) {
            candidates.push({ entry, score });
          }
        } catch (err) {
          console.error(
            `AgentRegistry: canHandle threw for ${entry.instance.name}:`,
            err,
          );
        }
      });

    await Promise.all(scoringTasks);

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    return {
      agent: best.entry.instance,
      config: best.entry.config!,
      confidence: best.score,
    };
  }
}

export const agentRegistry = new AgentRegistry();
