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
   * Resolve a specific agent by name, bypassing canHandle() scoring. Used for
   * cron/operator-forced dispatch (e.g. the follow-up scheduler) where the
   * caller already knows which agent must run. Still respects the operator's
   * config: a disabled or inactive agent is never force-run, so this returns
   * null in those cases and the orchestrator falls through to 'no_handler'.
   */
  async getForced(name: string): Promise<{
    agent: IAgent;
    config: IAgentConfig;
    confidence: number;
  } | null> {
    await this.ensureConfigsLoaded();
    const entry = this.agents.get(name);
    if (!entry || !entry.config) return null;
    const config = entry.config;
    if (!config.isActive || config.mode === 'disabled') return null;
    return { agent: entry.instance, config, confidence: 1 };
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

    // Honour per-channel-account binding allowlist when the caller restricts
    // it to a non-empty set. NOTE: ChannelConnection.agentBindings DEFAULTS to
    // `[]` for every connection (see the model + types/agent.ts), and that
    // default means "every registered agent eligible (legacy default)" — NOT
    // "no agents bound". So both `undefined` and an empty array fall through to
    // "any agent eligible"; only a non-empty allowlist actually filters. (An
    // operator who wants to silence a channel disables the agents or the
    // connection, rather than saving an empty binding set.)
    const allowlist = ctx.agentBindings;
    const scoringTasks = Array.from(this.agents.values())
      .filter(
        (e) => e.config && e.config.isActive && e.config.mode !== 'disabled',
      )
      .filter((e) =>
        allowlist === undefined || allowlist.length === 0
          ? true
          : allowlist.includes(e.instance.name),
      )
      .map(async (entry) => {
        const config = entry.config;
        // The filter above guarantees config is present, but the compiler
        // can't see across .filter() so we re-check rather than !-assert.
        if (!config) return;
        try {
          const score = await entry.instance.canHandle(ctx);
          if (score >= (config.confidenceThreshold ?? 0.5)) {
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
    const bestConfig = best.entry.config;
    if (!bestConfig) return null;
    return {
      agent: best.entry.instance,
      config: bestConfig,
      confidence: best.score,
    };
  }
}

export const agentRegistry = new AgentRegistry();
