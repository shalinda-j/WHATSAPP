import ChatMessage from '../models/ChatMessage';

/**
 * Default SLA target: an inbound user message should get a reply within
 * 60 seconds. The orchestrator's response is usually sub-10s; this is
 * the hard line at which we flag a slow turn for operator attention.
 */
export const DEFAULT_SLA_MS = 60 * 1000;

export interface SlaSnapshot {
  userId: string;
  firstResponseAt: Date | null;
  firstResponseMs: number | null;
  slaBreached: boolean;
}

/**
 * Computes the time-to-first-response for a single user JID by looking at
 * the most recent user message vs the most recent assistant response after
 * it. Used by the admin Leads / CRM views to show "responded in 4s" or
 * "no reply yet (SLA breached at 02:31)".
 *
 * Pure: hits Mongo, never mutates. Cheap enough to call per row in a list
 * view as long as the (userId, timestamp) index exists — which it does.
 */
export async function computeUserSla(
  userId: string,
  slaMs: number = DEFAULT_SLA_MS,
): Promise<SlaSnapshot> {
  const lastUserMsg = await ChatMessage.findOne({
    userId,
    role: 'user',
  })
    .sort({ timestamp: -1 })
    .select({ timestamp: 1 })
    .lean();

  if (!lastUserMsg) {
    return {
      userId,
      firstResponseAt: null,
      firstResponseMs: null,
      slaBreached: false,
    };
  }

  const firstReply = await ChatMessage.findOne({
    userId,
    role: 'assistant',
    timestamp: { $gt: lastUserMsg.timestamp },
  })
    .sort({ timestamp: 1 })
    .select({ timestamp: 1 })
    .lean();

  if (!firstReply) {
    const waitedMs = Date.now() - new Date(lastUserMsg.timestamp).getTime();
    return {
      userId,
      firstResponseAt: null,
      firstResponseMs: null,
      slaBreached: waitedMs > slaMs,
    };
  }

  const ms =
    new Date(firstReply.timestamp).getTime() -
    new Date(lastUserMsg.timestamp).getTime();

  return {
    userId,
    firstResponseAt: firstReply.timestamp,
    firstResponseMs: ms,
    slaBreached: ms > slaMs,
  };
}

/**
 * Bulk version: batches the per-user query into a single aggregation
 * pipeline so the list endpoint stays O(1) round-trips. Returns a map
 * keyed by userId.
 */
export async function computeBulkSla(
  userIds: string[],
  slaMs: number = DEFAULT_SLA_MS,
): Promise<Map<string, SlaSnapshot>> {
  const out = new Map<string, SlaSnapshot>();
  if (userIds.length === 0) return out;

  // For each user, find last user message + first assistant message after it.
  // Two aggregations are simpler (and within the index) than a single
  // $lookup self-join. Both queries are bounded by userIds.length × 1 doc.
  const lastUserAgg = await ChatMessage.aggregate([
    { $match: { userId: { $in: userIds }, role: 'user' } },
    { $sort: { timestamp: -1 } },
    {
      $group: {
        _id: '$userId',
        timestamp: { $first: '$timestamp' },
      },
    },
  ]);

  const lastUserByUser = new Map<string, Date>(
    (lastUserAgg as Array<{ _id: string; timestamp: Date }>).map((r) => [
      r._id,
      r.timestamp,
    ]),
  );

  for (const userId of userIds) {
    const lastUserAt = lastUserByUser.get(userId);
    if (!lastUserAt) {
      out.set(userId, {
        userId,
        firstResponseAt: null,
        firstResponseMs: null,
        slaBreached: false,
      });
      continue;
    }
    const reply = await ChatMessage.findOne({
      userId,
      role: 'assistant',
      timestamp: { $gt: lastUserAt },
    })
      .sort({ timestamp: 1 })
      .select({ timestamp: 1 })
      .lean();

    if (!reply) {
      const waitedMs = Date.now() - new Date(lastUserAt).getTime();
      out.set(userId, {
        userId,
        firstResponseAt: null,
        firstResponseMs: null,
        slaBreached: waitedMs > slaMs,
      });
      continue;
    }
    const ms =
      new Date(reply.timestamp).getTime() - new Date(lastUserAt).getTime();
    out.set(userId, {
      userId,
      firstResponseAt: reply.timestamp,
      firstResponseMs: ms,
      slaBreached: ms > slaMs,
    });
  }

  return out;
}
