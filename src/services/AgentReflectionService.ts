import mongoose from 'mongoose';
import AgentExecution from '../models/AgentExecution';
import AgentFeedback from '../models/AgentFeedback';
import AgentPromptVersion from '../models/AgentPromptVersion';
import AgentConfig from '../models/AgentConfig';
import AgentApprovalQueue from '../models/AgentApprovalQueue';

const OUTCOME_LOOKBACK_DAYS = 7;
const PROMOTION_TICK_MS = 1000 * 60 * 60; // hourly
const EXPIRY_TICK_MS = 1000 * 60; // every minute

export class AgentReflectionService {
  private promotionTimer: NodeJS.Timeout | null = null;
  private expiryTimer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.promotionTimer || this.expiryTimer) return;
    this.expiryTimer = setInterval(
      () =>
        this.expireStaleApprovals().catch(this.logErr('expireStaleApprovals')),
      EXPIRY_TICK_MS,
    );
    this.promotionTimer = setInterval(
      () => this.runPromotionPass().catch(this.logErr('runPromotionPass')),
      PROMOTION_TICK_MS,
    );
    console.log(
      '🧠 AgentReflectionService started (expiry every 1min, promotion every 1h)',
    );
  }

  stop(): void {
    if (this.promotionTimer) clearInterval(this.promotionTimer);
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    this.promotionTimer = null;
    this.expiryTimer = null;
  }

  /**
   * Lead status changed → walk back through recent executions for that user
   * and credit/blame the agents that touched the conversation.
   */
  async correlateLeadOutcome(
    userId: string,
    leadId: mongoose.Types.ObjectId,
    newStatus: string,
  ): Promise<void> {
    const score: -1 | 0 | 1 =
      newStatus === 'accepted' || newStatus === 'interviewed'
        ? 1
        : newStatus === 'rejected'
        ? -1
        : 0;
    if (score === 0) return;

    const since = new Date(
      Date.now() - 1000 * 60 * 60 * 24 * OUTCOME_LOOKBACK_DAYS,
    );
    const recent = await AgentExecution.find({
      userId,
      createdAt: { $gte: since },
      outcome: { $in: ['success', 'queued_for_approval'] },
    }).limit(50);

    if (recent.length === 0) return;

    const feedbackDocs = recent.map((ex) => ({
      executionId: ex._id,
      agentName: ex.agentName,
      promptVersion: ex.promptVersion,
      source: 'outcome_lead_status' as const,
      score,
      note: `lead status → ${newStatus}`,
      linkedLeadId: leadId,
    }));
    await AgentFeedback.insertMany(feedbackDocs, { ordered: false }).catch(
      this.logErr('correlateLeadOutcome insert'),
    );

    // Update per-prompt-version counters
    const counter =
      score > 0 ? 'metrics.positiveFeedback' : 'metrics.negativeFeedback';
    const grouped = new Map<string, number>();
    for (const ex of recent) {
      const key = `${ex.agentName}::${ex.promptVersion}`;
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }
    await Promise.all(
      Array.from(grouped.entries()).map(([key, n]) => {
        const [agentName, vStr] = key.split('::');
        return AgentPromptVersion.updateOne(
          { agentName, version: Number(vStr) },
          { $inc: { [counter]: n } },
        );
      }),
    );
  }

  async correlateBookingOutcome(
    userId: string,
    bookingId: mongoose.Types.ObjectId,
    action: 'created' | 'cancelled' | 'completed',
  ): Promise<void> {
    const score: -1 | 0 | 1 =
      action === 'created' || action === 'completed' ? 1 : -1;
    const source =
      action === 'cancelled'
        ? 'outcome_booking_cancelled'
        : 'outcome_booking_created';
    const since = new Date(
      Date.now() - 1000 * 60 * 60 * 24 * OUTCOME_LOOKBACK_DAYS,
    );
    const recent = await AgentExecution.find({
      userId,
      createdAt: { $gte: since },
      outcome: { $in: ['success', 'queued_for_approval'] },
    }).limit(50);
    if (recent.length === 0) return;

    const feedbackDocs = recent.map((ex) => ({
      executionId: ex._id,
      agentName: ex.agentName,
      promptVersion: ex.promptVersion,
      source,
      score,
      note: `booking ${action}`,
      linkedBookingId: bookingId,
    }));
    await AgentFeedback.insertMany(feedbackDocs, { ordered: false }).catch(
      this.logErr('correlateBookingOutcome insert'),
    );
  }

  /**
   * Mark approval queue entries past their TTL as 'expired' BEFORE the Mongo
   * TTL job deletes them — gives us a chance to register negative feedback.
   */
  async expireStaleApprovals(): Promise<void> {
    const now = new Date();
    const stale = await AgentApprovalQueue.find({
      status: 'pending',
      expiresAt: { $lte: now },
    }).limit(200);

    for (const entry of stale) {
      entry.status = 'expired';
      entry.reviewedAt = now;
      await entry.save();

      const execution = await AgentExecution.findById(entry.executionId);
      if (execution) {
        execution.outcome = 'rejected_by_admin';
        await execution.save();
        await AgentFeedback.create({
          executionId: execution._id,
          agentName: execution.agentName,
          promptVersion: execution.promptVersion,
          source: 'admin_approval_reject',
          score: -1,
          note: 'auto-expired without review',
        });
      }
    }
  }

  /**
   * A/B promotion pass — for each agent with a candidate version, compare
   * (positive - negative) per prompt version over the recent sample window.
   * Promote candidate when policy === 'auto' AND it wins by both sample
   * count and net feedback by the configured pValue proxy (minSamples).
   */
  async runPromotionPass(): Promise<void> {
    const configs = await AgentConfig.find({
      isActive: true,
      candidatePromptVersion: { $ne: null },
    });
    for (const cfg of configs) {
      try {
        await this.evaluateAgent(cfg.name);
      } catch (err) {
        console.error(`Promotion eval failed for ${cfg.name}:`, err);
      }
    }
  }

  private async evaluateAgent(agentName: string): Promise<void> {
    const cfg = await AgentConfig.findOne({ name: agentName });
    if (!cfg || cfg.candidatePromptVersion == null) return;

    const [current, candidate] = await Promise.all([
      AgentPromptVersion.findOne({
        agentName,
        version: cfg.currentPromptVersion,
      }),
      AgentPromptVersion.findOne({
        agentName,
        version: cfg.candidatePromptVersion,
      }),
    ]);
    if (!current || !candidate) return;

    const candidateUses = candidate.metrics.uses;
    if (candidateUses < cfg.autoPromoteMinSamples) return;

    const currentNet =
      (current.metrics.positiveFeedback - current.metrics.negativeFeedback) /
      Math.max(1, current.metrics.uses);
    const candidateNet =
      (candidate.metrics.positiveFeedback -
        candidate.metrics.negativeFeedback) /
      Math.max(1, candidate.metrics.uses);

    if (candidateNet <= currentNet) return;

    if (cfg.promotionPolicy === 'auto') {
      await this.promote(agentName, candidate.version, current.version);
      console.log(
        `🧠 Auto-promoted ${agentName} v${
          candidate.version
        } (net=${candidateNet.toFixed(3)} > current=${currentNet.toFixed(3)})`,
      );
    }
    // 'manual' policy: keep candidate as-is; admin sees the lead in UI and promotes manually
  }

  async promote(
    agentName: string,
    newVersion: number,
    oldVersion: number,
  ): Promise<void> {
    await AgentPromptVersion.updateOne(
      { agentName, version: oldVersion },
      { $set: { isCurrent: false, archivedAt: new Date() } },
    );
    await AgentPromptVersion.updateOne(
      { agentName, version: newVersion },
      { $set: { isCurrent: true, isCandidate: false } },
    );
    await AgentConfig.updateOne(
      { name: agentName },
      {
        $set: {
          currentPromptVersion: newVersion,
          candidatePromptVersion: null,
        },
      },
    );
  }

  private logErr(label: string) {
    return (err: unknown) =>
      console.error(`AgentReflectionService.${label}:`, err);
  }
}

export const agentReflectionService = new AgentReflectionService();
