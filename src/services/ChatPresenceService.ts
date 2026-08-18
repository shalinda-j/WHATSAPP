/**
 * Who has this conversation open right now.
 *
 * The Live Chat page is shared: several employees watch the same inbox, and
 * until now nothing on screen said that the chat you are about to reply to is
 * already open on a colleague's monitor. Two people answer the same customer,
 * or one waits on the other because neither can tell whether anybody picked it
 * up.
 *
 * This is presence, not assignment. It answers "who is looking at this" and
 * disappears the moment they navigate away — it deliberately does NOT lock the
 * conversation or claim ownership, because an operator who steps away should
 * not leave a chat blocked behind them.
 *
 * The registry lives in memory on purpose. Presence has no meaning after a
 * restart: every socket is gone with it, so persisted rows would only be
 * ghosts. Clients re-announce on reconnect, which rebuilds the whole map
 * within a second of the process coming back.
 */

/** One open Live Chat tab, viewing one conversation. */
export interface ChatViewer {
  /** Socket that announced it — the unit we add and remove by. */
  socketId: string;
  /** Admin account behind the socket. Two tabs share one adminId. */
  adminId: string;
  /** What the tag shows: full name where we have one, else the username. */
  name: string;
  roleName?: string;
  /** Epoch ms the chat was opened, so the UI can say how long it has been up. */
  since: number;
}

/** A conversation, scoped to the tenant that owns it. */
export interface PresenceTarget {
  tenantId: string;
  /** WhatsApp JID / contact id — the Live Chat conversation key. */
  userId: string;
}

/** What gets broadcast for one conversation. */
export interface ViewerBroadcast extends PresenceTarget {
  viewers: ChatViewer[];
}

const KEY_SEPARATOR = '::';

/**
 * Presence is per tenant. Keying on the conversation id alone would leak one
 * tenant's staff names into another tenant's panel the moment two tenants had
 * a contact with the same JID — which is not exotic, since the default tenant
 * holds every legacy row.
 */
export function presenceKey(tenantId: string, userId: string): string {
  return `${tenantId}${KEY_SEPARATOR}${userId}`;
}

/**
 * Recover the tenant + conversation a key was built from. Splits on the FIRST
 * separator: a tenant id never contains one, but a JID conceivably could, and
 * losing the tail of a conversation id would silently tag the wrong chat.
 */
export function parsePresenceKey(key: string): PresenceTarget {
  const at = key.indexOf(KEY_SEPARATOR);
  if (at < 0) return { tenantId: 'default', userId: key };
  return {
    tenantId: key.slice(0, at),
    userId: key.slice(at + KEY_SEPARATOR.length),
  };
}

/**
 * The tag should read "Nimal Perera", not "nimal.p" — an operator recognises a
 * colleague by name. Falls back through what the account actually has rather
 * than rendering an empty pill.
 */
export function viewerDisplayName(identity: {
  fullName?: string | null;
  username?: string | null;
}): string {
  const full = (identity.fullName || '').trim();
  if (full) return full;
  const username = (identity.username || '').trim();
  return username || 'Unknown user';
}

/**
 * One pill per person, not per browser tab.
 *
 * An operator with the panel open on a desktop and a phone is one colleague,
 * and rendering their name twice makes the row look like two people are on the
 * chat. Keeps the earliest `since` — the answer to "how long has this been
 * open" is when they first opened it, not when the second tab appeared.
 */
export function dedupeViewersByAdmin(viewers: ChatViewer[]): ChatViewer[] {
  const byAdmin = new Map<string, ChatViewer>();
  for (const viewer of viewers) {
    const existing = byAdmin.get(viewer.adminId);
    if (!existing || viewer.since < existing.since) {
      byAdmin.set(viewer.adminId, viewer);
    }
  }
  return [...byAdmin.values()].sort((a, b) => a.since - b.since);
}

/**
 * In-memory registry. Instantiable rather than a bare module-level map so the
 * tests get a clean one per case instead of leaking state between them; the
 * app uses the `chatPresence` singleton at the bottom of this file.
 */
export class ChatPresenceRegistry {
  /** conversation key -> socketId -> viewer */
  private byChat = new Map<string, Map<string, ChatViewer>>();
  /** socketId -> conversation keys it is currently viewing */
  private bySocket = new Map<string, Set<string>>();

  /**
   * Mark a socket as viewing a conversation.
   *
   * A socket views ONE conversation at a time — the operator clicked a
   * different row, they did not open a second one — so this first clears
   * whatever that socket was on. Without that, every click would leave the
   * previous chat tagged forever and the sidebar would slowly fill with the
   * names of people who had long since moved on.
   *
   * Returns every conversation whose viewer list changed, so the caller knows
   * exactly what to broadcast: the newly opened chat, plus the one just left.
   */
  open(target: PresenceTarget, viewer: ChatViewer): PresenceTarget[] {
    const key = presenceKey(target.tenantId, target.userId);
    const changed = this.releaseSocketExcept(viewer.socketId, key);

    const viewers = this.byChat.get(key) ?? new Map<string, ChatViewer>();
    const previous = viewers.get(viewer.socketId);
    // Re-announcing the same chat (a reconnect, or a duplicate emit) keeps the
    // original `since` so the elapsed time doesn't reset under the operator.
    viewers.set(viewer.socketId, {
      ...viewer,
      since: previous?.since ?? viewer.since,
    });
    this.byChat.set(key, viewers);

    const keys = this.bySocket.get(viewer.socketId) ?? new Set<string>();
    keys.add(key);
    this.bySocket.set(viewer.socketId, keys);

    if (!previous) changed.push(parsePresenceKey(key));
    return changed;
  }

  /** Stop viewing one conversation. Returns it when something was removed. */
  close(target: PresenceTarget, socketId: string): PresenceTarget[] {
    const key = presenceKey(target.tenantId, target.userId);
    return this.removeKey(socketId, key) ? [parsePresenceKey(key)] : [];
  }

  /**
   * The socket went away (tab closed, network dropped, laptop lid shut).
   * Returns every conversation that has to be re-broadcast.
   */
  dropSocket(socketId: string): PresenceTarget[] {
    return this.releaseSocketExcept(socketId, null);
  }

  /** Current viewers of one conversation, one entry per person. */
  list(target: PresenceTarget): ChatViewer[] {
    const viewers = this.byChat.get(
      presenceKey(target.tenantId, target.userId),
    );
    return viewers ? dedupeViewersByAdmin([...viewers.values()]) : [];
  }

  /**
   * Everything one tenant can currently see, for a panel that just loaded.
   * A newly opened tab has to learn about chats other people already had open
   * before it connected — those generate no events of their own.
   */
  snapshot(tenantId: string): ViewerBroadcast[] {
    const out: ViewerBroadcast[] = [];
    for (const [key, viewers] of this.byChat) {
      const target = parsePresenceKey(key);
      if (target.tenantId !== tenantId) continue;
      if (viewers.size === 0) continue;
      out.push({
        ...target,
        viewers: dedupeViewersByAdmin([...viewers.values()]),
      });
    }
    return out;
  }

  /** How many conversations currently carry a tag. */
  size(): number {
    return this.byChat.size;
  }

  /** Remove one socket from one conversation. True when it was there. */
  private removeKey(socketId: string, key: string): boolean {
    const viewers = this.byChat.get(key);
    if (!viewers?.delete(socketId)) return false;
    // Drop the empty shells — otherwise the map grows by one entry per
    // conversation ever opened and never shrinks for the life of the process.
    if (viewers.size === 0) this.byChat.delete(key);

    const keys = this.bySocket.get(socketId);
    keys?.delete(key);
    if (keys && keys.size === 0) this.bySocket.delete(socketId);
    return true;
  }

  /** Clear a socket from every conversation except (optionally) one. */
  private releaseSocketExcept(
    socketId: string,
    keep: string | null,
  ): PresenceTarget[] {
    const keys = this.bySocket.get(socketId);
    if (!keys) return [];
    const changed: PresenceTarget[] = [];
    // Snapshot the key set: removeKey mutates it as we iterate.
    for (const key of [...keys]) {
      if (key === keep) continue;
      if (this.removeKey(socketId, key)) changed.push(parsePresenceKey(key));
    }
    return changed;
  }
}

export const chatPresence = new ChatPresenceRegistry();
