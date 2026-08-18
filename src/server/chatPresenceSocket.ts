/**
 * Socket wiring for Live Chat presence — the "Nimal Perera has this chat open"
 * tag in the conversation list.
 *
 * Kept out of `socket.ts` (which is about CORS and authentication) and written
 * against two tiny interfaces rather than against Socket.io's types, so the
 * whole protocol can be exercised with plain objects. That matters more here
 * than it looks: the failure mode of this file is a mistyped event name, which
 * type-checks perfectly, breaks nothing at boot, and simply never shows a tag.
 */

import {
  chatPresence,
  viewerDisplayName,
  type ChatPresenceRegistry,
  type PresenceTarget,
} from '../services/ChatPresenceService';
import { resolveIdentity } from '../services/PermissionService';

/**
 * Event names, in one place. The client half of this protocol lives in
 * `client/src/pages/ChatInterface.tsx`; there is no shared module between the
 * two builds, so `ChatPresenceSocket.test.ts` reads that file and asserts every
 * name below still appears in it.
 */
export const PRESENCE_EVENTS = {
  /** client → server: "I am now looking at this conversation" */
  open: 'chat:open',
  /** client → server: "I have left it" */
  close: 'chat:close',
  /** client → server: "send me the current picture" */
  list: 'chat:presence:list',
  /** server → client: viewers of ONE conversation changed */
  viewers: 'chat:viewers',
  /** server → client: the full picture, for a tab that just loaded */
  state: 'chat:presence:state',
} as const;

/** Socket identity, taken from the JWT the handshake carried. */
export interface SocketUser {
  /** Admin `_id`. The token field is `id`; `userId` is tolerated for older tokens. */
  id?: string;
  userId?: string;
  username?: string;
  role?: string;
  tenantId?: string;
}

/** The slice of a Socket.io socket this module actually uses. */
export interface PresenceSocket {
  id: string;
  data: {
    user?: SocketUser;
    presenceProfile?: Promise<{ name: string; roleName?: string }>;
    [key: string]: unknown;
  };
  join(room: string): unknown;
  on(event: string, handler: (payload?: unknown) => void): unknown;
  emit(event: string, payload: unknown): unknown;
}

/** Fan-out to everyone in a room — `io.to(room).emit(...)` in production. */
export interface PresenceBus {
  toRoom(room: string, event: string, payload: unknown): void;
}

/**
 * Presence fans out to one room per tenant, never to the whole server: staff
 * names are internal, and a second tenant's operators have no business seeing
 * who at this company is reading which chat.
 */
export const presenceRoom = (tenantId: string) => `presence:${tenantId}`;

/**
 * Which tenant a socket belongs to. Falls back to `default`, matching the
 * `resolveTenant` middleware — single-tenant deployments have no tenantId in
 * their tokens at all, and must still see each other's tags.
 */
export const socketTenant = (socket: PresenceSocket): string =>
  socket.data.user?.tenantId || 'default';

/** The admin behind a socket, tolerating the older `userId` token field. */
export const socketAdminId = (socket: PresenceSocket): string =>
  socket.data.user?.id || socket.data.user?.userId || '';

export function attachChatPresence(
  socket: PresenceSocket,
  bus: PresenceBus,
  registry: ChatPresenceRegistry = chatPresence,
): void {
  const tenantId = socketTenant(socket);
  socket.join(presenceRoom(tenantId));

  /**
   * Broadcast the (possibly now empty) viewer list for each changed chat.
   * Sent to the whole tenant room INCLUDING the announcing socket: the sender
   * needs the merged list too, since a colleague may be on the same chat and
   * the client should not have to reconstruct that itself.
   */
  const publish = (targets: PresenceTarget[]) => {
    for (const target of targets) {
      bus.toRoom(presenceRoom(target.tenantId), PRESENCE_EVENTS.viewers, {
        userId: target.userId,
        viewers: registry.list(target),
      });
    }
  };

  socket.on(PRESENCE_EVENTS.open, (payload) => {
    const userId = readUserId(payload);
    if (!userId) return;
    void announceOpen(socket, tenantId, userId, registry)
      .then(publish)
      .catch((err) => {
        // Presence is decoration. A failure here must never take the socket
        // down with it — the operator would lose live messages over a tag.
        console.warn('⚠️ chat presence open failed:', err);
      });
  });

  socket.on(PRESENCE_EVENTS.close, (payload) => {
    const userId = readUserId(payload);
    if (!userId) return;
    publish(registry.close({ tenantId, userId }, socket.id));
  });

  socket.on(PRESENCE_EVENTS.list, () => {
    socket.emit(PRESENCE_EVENTS.state, registry.snapshot(tenantId));
  });

  socket.on('disconnect', () => {
    // The tab closed or the network dropped. Whoever was tagged by this socket
    // has to be untagged, or the pill outlives the person behind it.
    publish(registry.dropSocket(socket.id));
  });
}

/** Payloads arrive off the wire, so nothing about their shape is guaranteed. */
function readUserId(payload: unknown): string {
  const userId = (payload as { userId?: unknown } | undefined)?.userId;
  return typeof userId === 'string' ? userId.trim() : '';
}

/**
 * Resolve the operator's display name and register the open chat.
 *
 * The name is read from the database rather than the JWT, which carries only a
 * username: a token lives 24h, so someone who filled in their full name would
 * otherwise stay tagged by their login handle for the rest of the day.
 */
async function announceOpen(
  socket: PresenceSocket,
  tenantId: string,
  userId: string,
  registry: ChatPresenceRegistry,
): Promise<PresenceTarget[]> {
  const adminId = socketAdminId(socket);
  if (!adminId) return [];

  // Memoise the PROMISE, not the resolved value. An operator clicking quickly
  // through the inbox fires several open events before the first lookup
  // returns; awaiting one shared promise makes their continuations run in emit
  // order, so the last chat clicked is the one left tagged. Memoising the value
  // instead would let two concurrent lookups finish out of order and strand the
  // tag on a conversation the operator had already left.
  let pending = socket.data.presenceProfile;
  if (!pending) {
    pending = resolveIdentity(adminId)
      .catch(() => null)
      .then((identity) => ({
        // Falls back to the token's username when the account can't be read, so
        // a transient database blip tags the chat with a slightly worse label
        // rather than leaving a colleague invisible on it.
        name: viewerDisplayName({
          fullName: identity?.fullName,
          username: identity?.username || socket.data.user?.username,
        }),
        roleName: identity?.roleName,
      }));
    socket.data.presenceProfile = pending;
  }
  const profile = await pending;

  return registry.open(
    { tenantId, userId },
    {
      socketId: socket.id,
      adminId,
      name: profile.name,
      roleName: profile.roleName,
      since: Date.now(),
    },
  );
}
