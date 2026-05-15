import mongoose from 'mongoose';
import { agentOrchestrator } from './AgentOrchestrator';
import { channelRouter } from '../channels';
import { Contact } from '../models/CRM';
import Lead from '../models/Lead';
import Tenant from '../models/Tenant';
import AgentConfig from '../models/AgentConfig';

const DEFAULT_DORMANT_THRESHOLD_DAYS = 5;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_TICK_MS = 5 * 60 * 1000; // 5 minutes

let tickInterval: NodeJS.Timeout | null = null;

/**
 * FollowUpScheduler — finds dormant Leads, hydrates contact + metadata,
 * and dispatches each to the orchestrator with metadata.kind='follow_up_cron'
 * so the FollowUpAgent (registered with name='follow_up') executes against
 * a pre-built AgentContext.
 *
 * Safety properties:
 *   1. Will not run if the follow_up AgentConfig is mode='disabled'.
 *   2. Uses Lead.updatedAt as the dormancy clock (NOT contact.lastInteraction,
 *      which the legacy chat flow doesn't reliably update).
 *   3. Rate-limited to BATCH_SIZE rows per tick to keep LLM costs bounded.
 *   4. Skips Leads with status in {accepted, rejected} — those are terminal.
 *   5. Honours the FollowUpAgent's mode: in 'approval' mode the
 *      orchestrator routes outbound to the approval queue (existing
 *      behaviour); in 'autonomous' the outbound is sent via channelRouter.
 */
async function tick(
  tenantId: string,
): Promise<{ scanned: number; fired: number }> {
  // Gate on the agent being enabled.
  const cfg = await AgentConfig.findOne({ name: 'follow_up' });
  if (!cfg || !cfg.isActive || cfg.mode === 'disabled') {
    return { scanned: 0, fired: 0 };
  }

  const threshold = new Date(
    Date.now() - DEFAULT_DORMANT_THRESHOLD_DAYS * 24 * 60 * 60 * 1000,
  );

  const dormantLeads = await Lead.find({
    status: { $in: ['new', 'reviewed', 'contacted'] },
    updatedAt: { $lt: threshold },
  })
    .sort({ updatedAt: 1 })
    .limit(DEFAULT_BATCH_SIZE);

  let fired = 0;
  for (const lead of dormantLeads) {
    // Find a matching Contact if there is one — purely informational
    // metadata, never required.
    const phone = lead.phoneNumber;
    const contact = phone
      ? await Contact.findOne({
          $or: [{ phone }, { whatsappNumber: phone }, { whatsappId: phone }],
        })
      : null;

    const daysSinceLastInteraction = Math.floor(
      (Date.now() - new Date(lead.updatedAt).getTime()) / (24 * 60 * 60 * 1000),
    );

    try {
      const outcome = await agentOrchestrator.handle({
        sessionId: tenantId,
        userId: `${(phone ?? '').replace(/\D/g, '')}@s.whatsapp.net`,
        channel: 'whatsapp',
        language: 'si',
        inputMessage: '', // cron-driven — no inbound text
        conversationHistory: [],
        metadata: {
          kind: 'follow_up_cron',
          lead: lead.toObject(),
          contact: contact ? contact.toObject() : null,
          contactId: contact ? String(contact._id) : undefined,
          daysSinceLastInteraction,
          forceAgent: 'follow_up',
        },
      });

      // Autonomous mode → relay outbound through channel router so the
      // contact actually receives the message. Approval / disabled paths
      // leave outbound queued (orchestrator already did that work).
      if (
        cfg.mode === 'autonomous' &&
        outcome.handled &&
        outcome.outbound &&
        phone
      ) {
        await channelRouter.send({
          channel: 'whatsapp',
          tenantId,
          recipient: `${phone.replace(/\D/g, '')}@s.whatsapp.net`,
          text: outcome.outbound,
        });
        fired++;
      }
    } catch (err) {
      console.error(
        `FollowUpScheduler: dispatch failed for lead ${lead._id}:`,
        err,
      );
    }
  }

  return { scanned: dormantLeads.length, fired };
}

/**
 * Boots the periodic follow-up tick. Idempotent — only one timer per
 * process. The interval is unref'd so it never holds the event loop
 * open at shutdown.
 */
export function startFollowUpScheduler(): void {
  if (tickInterval) return;
  tickInterval = setInterval(async () => {
    try {
      // Today: only the default tenant. Once per-tenant scheduling
      // lands, this maps over every active tenant.
      const tenant = await Tenant.findOne({ slug: 'default' });
      if (!tenant) return;
      await tick(String(tenant._id));
    } catch (err) {
      console.error('FollowUpScheduler tick crashed:', err);
    }
  }, DEFAULT_TICK_MS);
  tickInterval.unref?.();
}

export function stopFollowUpScheduler(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

// Re-export the tick function for unit-test access.
export { tick as _tick };

// silence unused
void mongoose;
