import {
  ChatPresenceRegistry,
  dedupeViewersByAdmin,
  parsePresenceKey,
  presenceKey,
  viewerDisplayName,
  type ChatViewer,
} from '../services/ChatPresenceService';

/**
 * "Who has this chat open" tags in Live Chat.
 *
 * Several employees share one inbox, and nothing on screen used to say that
 * the conversation you are about to answer is already open on a colleague's
 * screen. These cover the registry behind that tag — mostly the ways a tag can
 * outlive the person it names, which is the failure that matters: a stale pill
 * makes an operator hold back from a customer nobody is actually serving.
 */

const viewer = (over: Partial<ChatViewer> = {}): ChatViewer => ({
  socketId: 'sock-1',
  adminId: 'admin-1',
  name: 'Nimal Perera',
  since: 1_000,
  ...over,
});

const chat = { tenantId: 'tenant-a', userId: '94771234567@s.whatsapp.net' };

describe('presenceKey', () => {
  it('round-trips a tenant and a conversation', () => {
    expect(parsePresenceKey(presenceKey('tenant-a', 'chat-1'))).toEqual({
      tenantId: 'tenant-a',
      userId: 'chat-1',
    });
  });

  it('keeps a conversation id that itself contains the separator', () => {
    // Splitting on the LAST separator would silently truncate the JID and tag
    // a conversation that doesn't exist.
    const target = parsePresenceKey(presenceKey('tenant-a', 'a::b::c'));
    expect(target.userId).toBe('a::b::c');
    expect(target.tenantId).toBe('tenant-a');
  });

  it('keeps two tenants apart for the same conversation id', () => {
    expect(presenceKey('tenant-a', 'chat-1')).not.toBe(
      presenceKey('tenant-b', 'chat-1'),
    );
  });
});

describe('viewerDisplayName', () => {
  it('prefers the full name — an operator recognises a colleague by it', () => {
    expect(
      viewerDisplayName({ fullName: 'Nimal Perera', username: 'nimal.p' }),
    ).toBe('Nimal Perera');
  });

  it('falls back to the username rather than an empty pill', () => {
    expect(viewerDisplayName({ fullName: '', username: 'nimal.p' })).toBe(
      'nimal.p',
    );
    expect(viewerDisplayName({ fullName: '   ', username: 'nimal.p' })).toBe(
      'nimal.p',
    );
    expect(viewerDisplayName({ username: 'nimal.p' })).toBe('nimal.p');
  });

  it('never returns an empty string', () => {
    expect(viewerDisplayName({})).toBe('Unknown user');
    expect(viewerDisplayName({ fullName: null, username: null })).toBe(
      'Unknown user',
    );
  });
});

describe('dedupeViewersByAdmin', () => {
  it('shows one pill per person, not per browser tab', () => {
    // Desktop plus phone is one colleague. Two pills reads as two people on
    // the chat, which is exactly the thing the tag is meant to disambiguate.
    const merged = dedupeViewersByAdmin([
      viewer({ socketId: 'a', since: 500 }),
      viewer({ socketId: 'b', since: 900 }),
    ]);
    expect(merged).toHaveLength(1);
  });

  it('keeps the earliest open time across a person’s tabs', () => {
    const merged = dedupeViewersByAdmin([
      viewer({ socketId: 'b', since: 900 }),
      viewer({ socketId: 'a', since: 500 }),
    ]);
    expect(merged[0].since).toBe(500);
  });

  it('keeps distinct people and orders by who arrived first', () => {
    const merged = dedupeViewersByAdmin([
      viewer({ adminId: 'admin-2', socketId: 'b', name: 'Kamal', since: 900 }),
      viewer({ adminId: 'admin-1', socketId: 'a', name: 'Nimal', since: 500 }),
    ]);
    expect(merged.map((v) => v.name)).toEqual(['Nimal', 'Kamal']);
  });

  it('handles an empty list', () => {
    expect(dedupeViewersByAdmin([])).toEqual([]);
  });
});

describe('ChatPresenceRegistry', () => {
  let registry: ChatPresenceRegistry;
  beforeEach(() => {
    registry = new ChatPresenceRegistry();
  });

  it('tags a conversation once somebody opens it', () => {
    registry.open(chat, viewer());
    expect(registry.list(chat).map((v) => v.name)).toEqual(['Nimal Perera']);
  });

  it('reports the chat as changed so the caller knows what to broadcast', () => {
    expect(registry.open(chat, viewer())).toEqual([chat]);
  });

  it('keeps previous chats claimed when the operator clicks another row', () => {
    const other = { ...chat, userId: 'chat-2' };
    registry.open(chat, viewer());
    const changed = registry.open(other, viewer());

    expect(registry.list(chat)).toHaveLength(1);
    expect(registry.list(other)).toHaveLength(1);
    expect(changed).toEqual([other]);
  });

  it('does not reset the open time when the same chat is re-announced', () => {
    // A reconnect re-emits chat:open. Taking the new timestamp would make the
    // "open for 40 minutes" tooltip restart at zero every time the network
    // hiccupped.
    registry.open(chat, viewer({ since: 1_000 }));
    registry.open(chat, viewer({ since: 9_000 }));
    expect(registry.list(chat)[0].since).toBe(1_000);
  });

  it('reports no change when a chat is re-announced', () => {
    registry.open(chat, viewer());
    expect(registry.open(chat, viewer())).toEqual([]);
  });

  it('drops the tag when the operator leaves the conversation', () => {
    registry.open(chat, viewer());
    expect(registry.close(chat, 'sock-1')).toEqual([chat]);
    expect(registry.list(chat)).toEqual([]);
  });

  it('ignores a close for a chat that was never open', () => {
    expect(registry.close(chat, 'sock-1')).toEqual([]);
  });

  it('clears every tag a dead socket left behind', () => {
    // The tab closed, or the laptop lid shut. No cleanup runs in the browser
    // for those, so the disconnect path is the only thing standing between a
    // dropped connection and a pill that never goes away.
    registry.open(chat, viewer());
    expect(registry.dropSocket('sock-1')).toEqual([chat]);
    expect(registry.list(chat)).toEqual([]);
  });

  it('leaves a colleague tagged when a different socket disconnects', () => {
    registry.open(chat, viewer({ socketId: 'sock-1', adminId: 'admin-1' }));
    registry.open(
      chat,
      viewer({ socketId: 'sock-2', adminId: 'admin-2', name: 'Kamal' }),
    );

    registry.dropSocket('sock-1');
    expect(registry.list(chat).map((v) => v.name)).toEqual(['Kamal']);
  });

  it('keeps a person tagged while any of their tabs is still open', () => {
    registry.open(chat, viewer({ socketId: 'sock-1', since: 500 }));
    registry.open(chat, viewer({ socketId: 'sock-2', since: 900 }));

    registry.dropSocket('sock-1');
    expect(registry.list(chat)).toHaveLength(1);
  });

  it('clears every accumulated claim when its socket disconnects', () => {
    // Empty viewer maps have to be deleted, not left as husks: this runs in a
    // long-lived process and an operator works through hundreds of chats a
    // day.
    for (let i = 0; i < 50; i++) {
      registry.open({ ...chat, userId: `chat-${i}` }, viewer());
    }
    expect(registry.size()).toBe(50);

    registry.dropSocket('sock-1');
    expect(registry.size()).toBe(0);
  });

  it('never shows one tenant the names of another tenant’s staff', () => {
    // The same JID exists under two tenants far more often than it sounds —
    // the default tenant holds every legacy row.
    const otherTenant = { tenantId: 'tenant-b', userId: chat.userId };
    registry.open(chat, viewer({ name: 'Nimal' }));
    registry.open(
      otherTenant,
      viewer({ socketId: 'sock-2', adminId: 'admin-2', name: 'Kamal' }),
    );

    expect(registry.list(chat).map((v) => v.name)).toEqual(['Nimal']);
    expect(registry.list(otherTenant).map((v) => v.name)).toEqual(['Kamal']);
  });

  it('snapshots only the asking tenant, for a panel that just loaded', () => {
    // A tab that connects now gets no events for chats other people already
    // had open, so without the snapshot it would show an empty inbox for the
    // first several minutes.
    registry.open(chat, viewer());
    registry.open(
      { tenantId: 'tenant-b', userId: 'chat-9' },
      viewer({ socketId: 'sock-2', adminId: 'admin-2' }),
    );

    const snapshot = registry.snapshot('tenant-a');
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].userId).toBe(chat.userId);
    expect(snapshot[0].viewers[0].name).toBe('Nimal Perera');
  });

  it('snapshots nothing when nobody is looking at anything', () => {
    expect(registry.snapshot('tenant-a')).toEqual([]);
  });

  it('collapses a person’s tabs in the snapshot too', () => {
    registry.open(chat, viewer({ socketId: 'sock-1' }));
    registry.open(chat, viewer({ socketId: 'sock-2' }));
    expect(registry.snapshot('tenant-a')[0].viewers).toHaveLength(1);
  });
});
