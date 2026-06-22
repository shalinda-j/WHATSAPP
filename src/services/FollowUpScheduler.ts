import mongoose from 'mongoose';
import { agentOrchestrator } from './AgentOrchestrator';
import { channelRouter } from '../channels';
import { Contact } from '../models/CRM';
import Lead from '../models/Lead';
import Tenant from '../models/Tenant';
import AgentConfig from '../models/AgentConfig';
import { isQuietHoursActive, tenantQuietHours } from './quietHours';
import { isPhoneOptedOut } from './optOut';

const DEFAULT_DORMANT_THRESHOLD_DAYS = 5;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_TICK_MS = 5 * 60 * 1000; // 5 minutes

let tickInterval: NodeJS.Timeout | null = null;

// Re-entrancy guard: a slow tick (many dormant leads × LLM latency) can run
// longer than the interval period. Without this flag a second timer firing
// mid-tick would re-select the same dormant leads and fire duplicate
// follow-ups. Only one tick body runs at a time per process.
let isTicking = false;

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
async function tick(tenantId: string): Promise<{
  scanned: number;
  fired: number;
  skippedQuietHours?: boolean;
  skipped?: boolean;
}> {
  // Re-entrancy guard: bail out immediately if a previous tick is still
  // running so overlapping ticks can't re-select the same dormant leads and
  // dispatch duplicate follow-ups.
  if (isTicking) {
    return { scanned: 0, fired: 0, skipped: true };
  }
  isTicking = true;
  try {
    // Gate on the agent being enabled.
    const cfg = await AgentConfig.findOne({ name: 'follow_up' });
    if (!cfg || !cfg.isActive || cfg.mode === 'disabled') {
      return { scanned: 0, fired: 0 };
    }

    // Tenant-wide quiet hours short-circuit the entire tick. Skipping at the
    // top avoids burning Mongo queries + LLM tokens just to discover at send
    // time that we can't deliver.
    const tenant = await Tenant.findById(tenantId);
    // Null guard: a tenant deleted between scheduling and tick must not be
    // passed down to the quiet-hours / send helpers.
    if (!tenant) {
      return { scanned: 0, fired: 0 };
    }
    if (isQuietHoursActive(tenantQuietHours(tenant))) {
      return { scanned: 0, fired: 0, skippedQuietHours: true };
    }

    const threshold = new Date(
      Date.now() - DEFAULT_DORMANT_THRESHOLD_DAYS * 24 * 60 * 60 * 1000,
    );

    // Tenant-scoped dormant-lead selection. A global query would pull
    // another tenant's leads into this tenant's follow-up dispatch (a
    // cross-tenant message leak), so every selection must be filtered by
    // tenantId.
    // Legacy-tolerant tenant scope. Bot-created leads (LeadService /
    // LeadQualifierAgent) historically were NOT stamped with tenantId, so a
    // strict { tenantId } filter found ZERO existing leads and the follow-up
    // feature silently did nothing even once the agent was reachable. Match
    // this tenant's leads AND legacy un-tenanted rows — the same
    // legacy-tolerant clause used across the rest of the codebase. (New leads
    // are now stamped at creation; this keeps existing rows reachable without
    // a manual backfill. Single-tenant deployments resolve to the default
    // tenant so there is no cross-tenant concern here.)
    const dormantLeads = await Lead.find({
      $or: [
        { tenantId },
        { tenantId: { $exists: false } },
        { tenantId: null },
      ],
      status: { $in: ['new', 'reviewed', 'contacted'] },
      updatedAt: { $lt: threshold },
    })
      .sort({ updatedAt: 1 })
      .limit(DEFAULT_BATCH_SIZE);

    // Batch the Contact lookup instead of N+1 queries. For BATCH_SIZE=10
    // dormant leads this collapses 10 round-trips into 1, and keeps Mongo's
    // load proportional to the tick size rather than to the contact base.
    const phoneNumbers = Array.from(
      new Set(
        dormantLeads
          .map((l: { phoneNumber?: string }) => l.phoneNumber)
          .filter((p: string | undefined): p is string => Boolean(p)),
      ),
    );
    const contactsByPhone = new Map<string, unknown>();
    if (phoneNumbers.length > 0) {
      // Tenant-scope the contact lookup. Without tenantId the $or-by-phone
      // can match ANOTHER tenant's contact that happens to share a phone /
      // whatsappNumber / whatsappId, leaking that contact's PII into this
      // tenant's follow-up dispatch. Scope it to the same tenant whose
      // dormant leads we already selected above.
      const matchingContacts = await Contact.find({
        tenantId,
        $or: [
          { phone: { $in: phoneNumbers } },
          { whatsappNumber: { $in: phoneNumbers } },
          { whatsappId: { $in: phoneNumbers } },
        ],
      }).lean();
      for (const c of matchingContacts as Array<{
        phone?: string;
        whatsappNumber?: string;
        whatsappId?: string;
      }>) {
        // Stamp the contact under every phone-shaped field it matches on so
        // the lookup inside the loop is O(1) regardless of which column hit.
        if (c.phone) contactsByPhone.set(c.phone, c);
        if (c.whatsappNumber) contactsByPhone.set(c.whatsappNumber, c);
        if (c.whatsappId) contactsByPhone.set(c.whatsappId, c);
      }
    }

    let fired = 0;
    for (const lead of dormantLeads) {
      const phone = lead.phoneNumber;
      const contact = phone ? (contactsByPhone.get(phone) ?? null) : null;

      // Skip opted-out contacts: a STOP from the user must silence every
      // future outbound — including agent-driven follow-ups, not just
      // campaign broadcasts.
      if (phone && (await isPhoneOptedOut(phone))) {
        continue;
      }

      const daysSinceLastInteraction = Math.floor(
        (Date.now() - new Date(lead.updatedAt).getTime()) /
          (24 * 60 * 60 * 1000),
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
            // .lean() result is already a plain object — no toObject() call.
            contact: contact ?? null,
            contactId:
              contact && (contact as { _id?: unknown })._id
                ? String((contact as { _id: unknown })._id)
                : undefined,
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
  } finally {
    isTicking = false;
  }
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
      // Run the dormant-lead selection per active tenant. Suspended /
      // archived tenants are skipped so their leads never get follow-ups.
      // The tick() re-entrancy guard serialises these so they don't
      // overlap with a still-running prior interval.
      const tenants = await Tenant.find({ status: 'active' });
      for (const tenant of tenants) {
        if (!tenant) continue;
        await tick(String(tenant._id));
      }
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
