import mongoose from 'mongoose';
import AgentApprovalQueue, {
  IAgentApprovalQueue,
} from '../models/AgentApprovalQueue';
import AgentExecution from '../models/AgentExecution';
import AgentFeedback from '../models/AgentFeedback';
import AgentPromptVersion from '../models/AgentPromptVersion';
import { WebhookService } from './WebhookService';

const APPROVAL_BACKLOG_ALERT_THRESHOLD = 25;
let lastApprovalAlertAt = 0;
const APPROVAL_ALERT_COOLDOWN_MS = 15 * 60 * 1000;

function tryEmit(event: string, payload: unknown): void {
  // Socket.io is optional at this layer — in test/cron contexts the server
  // isn't running. Failure to emit must not break the queue operation.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getIO } = require('../server/socket');
    getIO().emit(event, payload);
  } catch {
    /* swallow — no live admin connections */
  }
}

export class AgentApprovalQueueService {
  async enqueue(params: {
    executionId: mongoose.Types.ObjectId;
    traceId: string;
    agentName: string;
    userId: string;
    sessionId: string;
    channel: string;
    proposedMessage: string;
    expiresInMs?: number;
  }): Promise<IAgentApprovalQueue> {
    const expiresAt = new Date(
      Date.now() + (params.expiresInMs ?? 1000 * 60 * 60 * 4),
    );
    const entry = await AgentApprovalQueue.create({
      executionId: params.executionId,
      traceId: params.traceId,
      agentName: params.agentName,
      userId: params.userId,
      sessionId: params.sessionId,
      channel: params.channel,
      proposedMessage: params.proposedMessage,
      status: 'pending',
      expiresAt,
    });

    await AgentPromptVersion.updateOne(
      // The execution row already pinned promptVersion; reflection layer will
      // back-correlate. Here we only bump queuedApprovals on the *current*
      // version since that's what was used.
      { agentName: params.agentName, isCurrent: true },
      { $inc: { 'metrics.queuedApprovals': 1 } },
    );

    tryEmit('agent:approval:new', {
      id: entry._id,
      traceId: entry.traceId,
      agentName: entry.agentName,
      userId: entry.userId,
      proposedMessage: entry.proposedMessage,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
    });

    // Ops alert when the pending backlog crosses the threshold, so the
    // on-call operator gets paged before approvals start expiring. The
    // cooldown prevents one slow-reviewing operator from flooding Slack
    // with one alert per enqueue.
    const pending = await this.pendingCount().catch(() => 0);
    if (
      pending >= APPROVAL_BACKLOG_ALERT_THRESHOLD &&
      Date.now() - lastApprovalAlertAt > APPROVAL_ALERT_COOLDOWN_MS
    ) {
      lastApprovalAlertAt = Date.now();
      void WebhookService.triggerOpsAlert({
        level: pending >= APPROVAL_BACKLOG_ALERT_THRESHOLD * 2 ? 'error' : 'warn',
        title: 'Agent approval queue backlog',
        body: `Pending approvals: ${pending}. Reviews are falling behind — outbound for agents in approval mode is blocked until cleared.`,
        fields: {
          pending,
          threshold: APPROVAL_BACKLOG_ALERT_THRESHOLD,
          agent: params.agentName,
        },
      });
    }

    return entry;
  }

  async approve(
    approvalId: string,
    reviewer: string,
  ): Promise<{ outbound: string; entry: IAgentApprovalQueue }> {
    // Atomic conditional update — guarantees only one approve() wins when
    // two operators (or duplicate clicks) race. Without this, both calls
    // could read status='pending' and both .save() with status='approved',
    // causing a double-send downstream.
    const entry = await AgentApprovalQueue.findOneAndUpdate(
      { _id: approvalId, status: 'pending' },
      {
        $set: {
          status: 'approved',
          reviewedBy: reviewer,
          reviewedAt: new Date(),
        },
      },
      { new: true },
    );
    if (!entry) {
      // Differentiate "doesn't exist" vs "already resolved" so the
      // operator gets a useful error message.
      const existing = await AgentApprovalQueue.findById(approvalId).lean();
      if (!existing) throw new Error('Approval not found');
      throw new Error(`Approval already ${existing.status}`);
    }

    await AgentExecution.updateOne(
      { _id: entry.executionId },
      { $set: { outcome: 'success' } },
    );

    tryEmit('agent:approval:resolved', {
      id: entry._id,
      status: 'approved',
    });

    return { outbound: entry.proposedMessage, entry };
  }

  async reject(
    approvalId: string,
    reviewer: string,
    note: string | null,
  ): Promise<IAgentApprovalQueue> {
    // Atomic conditional update — same race-condition reasoning as approve().
    const entry = await AgentApprovalQueue.findOneAndUpdate(
      { _id: approvalId, status: 'pending' },
      {
        $set: {
          status: 'rejected',
          reviewedBy: reviewer,
          reviewedAt: new Date(),
          reviewerNotes: note,
        },
      },
      { new: true },
    );
    if (!entry) {
      const existing = await AgentApprovalQueue.findById(approvalId).lean();
      if (!existing) throw new Error('Approval not found');
      throw new Error(`Approval already ${existing.status}`);
    }

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
        note,
        createdBy: reviewer,
      });

      await AgentPromptVersion.updateOne(
        { agentName: execution.agentName, version: execution.promptVersion },
        {
          $inc: {
            'metrics.approvalRejects': 1,
            'metrics.negativeFeedback': 1,
          },
        },
      );
    }

    tryEmit('agent:approval:resolved', {
      id: entry._id,
      status: 'rejected',
    });

    return entry;
  }

  async edit(
    approvalId: string,
    reviewer: string,
    editedText: string,
    note: string | null,
  ): Promise<{ outbound: string; entry: IAgentApprovalQueue }> {
    const entry = await AgentApprovalQueue.findById(approvalId);
    if (!entry) throw new Error('Approval not found');
    if (entry.status !== 'pending') {
      throw new Error(`Approval already ${entry.status}`);
    }

    entry.editedMessage = editedText;
    entry.status = 'edited';
    entry.reviewedBy = reviewer;
    entry.reviewedAt = new Date();
    entry.reviewerNotes = note;
    await entry.save();

    const execution = await AgentExecution.findById(entry.executionId);
    if (execution) {
      execution.outcome = 'success';
      await execution.save();

      // Score 0 — neither a clean win nor a reject; the diff itself is the
      // signal for future prompt evolution.
      await AgentFeedback.create({
        executionId: execution._id,
        agentName: execution.agentName,
        promptVersion: execution.promptVersion,
        source: 'admin_approval_edit',
        score: 0,
        note,
        createdBy: reviewer,
        diffPayload: {
          proposed: entry.proposedMessage,
          edited: editedText,
        },
      });
    }

    tryEmit('agent:approval:resolved', {
      id: entry._id,
      status: 'edited',
    });

    return { outbound: editedText, entry };
  }

  async markSent(approvalId: string): Promise<void> {
    await AgentApprovalQueue.updateOne(
      { _id: approvalId },
      { $set: { status: 'sent', sentAt: new Date() } },
    );
  }

  async listPending(params: {
    agentName?: string;
    channel?: string;
    limit?: number;
    skip?: number;
  }): Promise<IAgentApprovalQueue[]> {
    const q: Record<string, unknown> = { status: 'pending' };
    if (params.agentName) q.agentName = params.agentName;
    if (params.channel) q.channel = params.channel;
    return AgentApprovalQueue.find(q)
      .sort({ createdAt: -1 })
      .skip(params.skip ?? 0)
      .limit(params.limit ?? 50);
  }

  async pendingCount(): Promise<number> {
    return AgentApprovalQueue.countDocuments({ status: 'pending' });
  }
}

export const agentApprovalQueueService = new AgentApprovalQueueService();
