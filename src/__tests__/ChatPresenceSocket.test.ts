import fs from 'fs';
import path from 'path';
import {
  attachChatPresence,
  PRESENCE_EVENTS,
  presenceRoom,
  socketAdminId,
  socketTenant,
  type PresenceSocket,
} from '../server/chatPresenceSocket';
import { ChatPresenceRegistry } from '../services/ChatPresenceService';

/**
 * The socket half of Live Chat presence.
 *
 * The registry is covered in ChatPresence.test.ts; what is left here is the
 * wiring, whose characteristic failure is silent — a mistyped event name or a
 * broadcast sent to the wrong room type-checks perfectly, boots fine, and
 * simply never shows a tag. So these drive the real handlers through a fake
 * socket, and the last block pins the event names against the client that has
 * to agree on them.
 */

jest.mock('../services/PermissionService', () => ({
  resolveIdentity: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveIdentity } = require('../services/PermissionService');

type Emission = { event: string; payload: any };
type RoomEmission = Emission & { room: string };

/** A socket that records what it was told, and can replay its handlers. */
function fakeSocket(over: { id?: string; user?: any } = {}) {
  const handlers = new Map<string, (payload?: unknown) => void>();
  const joined: string[] = [];
  const emitted: Emission[] = [];
  const socket: PresenceSocket = {
    id: over.id ?? 'sock-1',
    data: {
      user: over.user ?? {
        id: 'admin-1',
        username: 'nimal.p',
        tenantId: 'tenant-a',
      },
    },
    join: (room: string) => joined.push(room),
    on: (event, handler) => handlers.set(event, handler),
    emit: (event, payload) => emitted.push({ event, payload }),
  };
  return {
    socket,
    joined,
    emitted,
    /** Deliver an inbound event, as Socket.io would. */
    fire: (event: string, payload?: unknown) => handlers.get(event)?.(payload),
    has: (event: string) => handlers.has(event),
  };
}

function fakeBus() {
  const sent: RoomEmission[] = [];
  return {
    sent,
    bus: {
      toRoom: (room: string, event: string, payload: unknown) =>
        sent.push({ room, event, payload }),
    },
    /** Only the viewer broadcasts for one conversation. */
    viewersFor(userId: string) {
      return sent
        .filter((s) => s.event === PRESENCE_EVENTS.viewers && s.payload.userId)
        .filter((s) => s.payload.userId === userId);
    },
  };
}

/** Let the memoised identity lookup settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

const CHAT = '94771234567@s.whatsapp.net';

beforeEach(() => {
  (resolveIdentity as jest.Mock).mockReset();
  (resolveIdentity as jest.Mock).mockResolvedValue({
    id: 'admin-1',
    username: 'nimal.p',
    fullName: 'Nimal Perera',
    roleName: 'Support Agent',
  });
});

describe('socket identity', () => {
  it('scopes a socket to the tenant in its token', () => {
    const { socket } = fakeSocket();
    expect(socketTenant(socket)).toBe('tenant-a');
  });

  it('falls back to the default tenant, like the HTTP middleware does', () => {
    // Single-tenant deployments have no tenantId in their tokens at all. If
    // these landed in different rooms, colleagues would never see each other.
    const { socket } = fakeSocket({ user: { id: 'admin-1' } });
    expect(socketTenant(socket)).toBe('default');
  });

  it('reads the admin id from the field the login route actually signs', () => {
    expect(socketAdminId(fakeSocket().socket)).toBe('admin-1');
  });

  it('tolerates an older token that carried userId instead', () => {
    const { socket } = fakeSocket({ user: { userId: 'admin-9' } });
    expect(socketAdminId(socket)).toBe('admin-9');
  });
});

describe('attachChatPresence', () => {
  it('joins the tenant room so broadcasts can reach it', () => {
    const { socket, joined } = fakeSocket();
    attachChatPresence(socket, fakeBus().bus, new ChatPresenceRegistry());
    expect(joined).toEqual([presenceRoom('tenant-a')]);
  });

  it('subscribes to every inbound event the client sends', () => {
    const f = fakeSocket();
    attachChatPresence(f.socket, fakeBus().bus, new ChatPresenceRegistry());
    expect(f.has(PRESENCE_EVENTS.open)).toBe(true);
    expect(f.has(PRESENCE_EVENTS.close)).toBe(true);
    expect(f.has(PRESENCE_EVENTS.list)).toBe(true);
    expect(f.has('disconnect')).toBe(true);
  });

  it('broadcasts the viewer, by name, when a chat is opened', async () => {
    const f = fakeSocket();
    const b = fakeBus();
    attachChatPresence(f.socket, b.bus, new ChatPresenceRegistry());

    f.fire(PRESENCE_EVENTS.open, { userId: CHAT });
    await flush();

    const broadcasts = b.viewersFor(CHAT);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].room).toBe(presenceRoom('tenant-a'));
    expect(broadcasts[0].payload.viewers[0].name).toBe('Nimal Perera');
    expect(broadcasts[0].payload.viewers[0].roleName).toBe('Support Agent');
  });

  it('broadcasts to a room the announcing socket is itself in', async () => {
    // The client shows the operator their OWN tag, so the broadcast has to
    // reach the socket that triggered it. This pins one half of that — the room
    // it is addressed to is the room the socket joined, not some other one. The
    // other half (that the adapter fans out to the whole room rather than
    // everyone-but-the-sender) lives in socket.ts and is checked below.
    const f = fakeSocket();
    const b = fakeBus();
    attachChatPresence(f.socket, b.bus, new ChatPresenceRegistry());

    f.fire(PRESENCE_EVENTS.open, { userId: CHAT });
    await flush();

    expect(f.joined).toContain(b.viewersFor(CHAT)[0].room);
    expect(b.viewersFor(CHAT)[0].payload.viewers[0].adminId).toBe('admin-1');
  });

  it('lists everyone on the chat, not only the operator who arrived last', async () => {
    // Two employees clicking the same conversation is the case the tag exists
    // for; each of them has to see both names, not just the other's.
    const registry = new ChatPresenceRegistry();
    const b = fakeBus();

    const first = fakeSocket();
    attachChatPresence(first.socket, b.bus, registry);
    first.fire(PRESENCE_EVENTS.open, { userId: CHAT });
    await flush();

    (resolveIdentity as jest.Mock).mockResolvedValue({
      id: 'admin-2',
      username: 'kamal',
      fullName: 'Kamal Silva',
    });
    const second = fakeSocket({
      id: 'sock-2',
      user: { id: 'admin-2', username: 'kamal', tenantId: 'tenant-a' },
    });
    attachChatPresence(second.socket, b.bus, registry);
    second.fire(PRESENCE_EVENTS.open, { userId: CHAT });
    await flush();

    const latest = b.viewersFor(CHAT).pop()!;
    expect(latest.payload.viewers.map((v: any) => v.name)).toEqual([
      'Nimal Perera',
      'Kamal Silva',
    ]);
  });

  it('shows the full name, not the login handle', async () => {
    // The JWT only carries the username, which is why the name is resolved
    // from the database instead of read off the token.
    const f = fakeSocket();
    const b = fakeBus();
    attachChatPresence(f.socket, b.bus, new ChatPresenceRegistry());
    f.fire(PRESENCE_EVENTS.open, { userId: CHAT });
    await flush();
    expect(b.viewersFor(CHAT)[0].payload.viewers[0].name).not.toBe('nimal.p');
  });

  it('still tags the chat when the account lookup fails', async () => {
    // A database blip should cost a nicer label, not make a colleague
    // invisible on a conversation somebody else is about to answer.
    (resolveIdentity as jest.Mock).mockRejectedValue(new Error('db down'));
    const f = fakeSocket();
    const b = fakeBus();
    attachChatPresence(f.socket, b.bus, new ChatPresenceRegistry());

    f.fire(PRESENCE_EVENTS.open, { userId: CHAT });
    await flush();

    expect(b.viewersFor(CHAT)[0].payload.viewers[0].name).toBe('nimal.p');
  });

  it('broadcasts an empty list when the viewer leaves', async () => {
    // The empty array is the signal to remove the tag — dropping the broadcast
    // entirely would leave the pill on every other operator's screen.
    const f = fakeSocket();
    const b = fakeBus();
    attachChatPresence(f.socket, b.bus, new ChatPresenceRegistry());

    f.fire(PRESENCE_EVENTS.open, { userId: CHAT });
    await flush();
    f.fire(PRESENCE_EVENTS.close, { userId: CHAT });

    expect(b.viewersFor(CHAT).pop()!.payload.viewers).toEqual([]);
  });

  it('clears the tag when the socket disconnects', async () => {
    const f = fakeSocket();
    const b = fakeBus();
    attachChatPresence(f.socket, b.bus, new ChatPresenceRegistry());

    f.fire(PRESENCE_EVENTS.open, { userId: CHAT });
    await flush();
    f.fire('disconnect');

    expect(b.viewersFor(CHAT).pop()!.payload.viewers).toEqual([]);
  });

  it('untags the old chat and tags the new one on a switch', async () => {
    const f = fakeSocket();
    const b = fakeBus();
    attachChatPresence(f.socket, b.bus, new ChatPresenceRegistry());

    f.fire(PRESENCE_EVENTS.open, { userId: CHAT });
    await flush();
    f.fire(PRESENCE_EVENTS.open, { userId: 'chat-2' });
    await flush();

    expect(b.viewersFor(CHAT).pop()!.payload.viewers).toEqual([]);
    expect(b.viewersFor('chat-2').pop()!.payload.viewers).toHaveLength(1);
  });

  it('leaves the last chat tagged when several are opened in a burst', async () => {
    // Clicking quickly down the inbox fires all three before the first identity
    // lookup returns. The handler memoises the lookup PROMISE precisely so the
    // continuations run in emit order; memoising the resolved value instead
    // lets them finish out of order and strands the tag on a conversation the
    // operator has already left.
    //
    // Each lookup is made to resolve FASTER than the one before it, so an
    // implementation that doesn't share one promise finishes them backwards —
    // which is what makes this a real test of the ordering rather than a test
    // of Node's microtask queue.
    let delay = 30;
    (resolveIdentity as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ username: 'nimal.p' }), (delay -= 10)),
        ),
    );

    const f = fakeSocket();
    const registry = new ChatPresenceRegistry();
    attachChatPresence(f.socket, fakeBus().bus, registry);

    f.fire(PRESENCE_EVENTS.open, { userId: 'chat-1' });
    f.fire(PRESENCE_EVENTS.open, { userId: 'chat-2' });
    f.fire(PRESENCE_EVENTS.open, { userId: 'chat-3' });
    await new Promise((resolve) => setTimeout(resolve, 80));

    const at = (userId: string) =>
      registry.list({ tenantId: 'tenant-a', userId });
    expect(at('chat-3')).toHaveLength(1);
    expect(at('chat-1')).toEqual([]);
    expect(at('chat-2')).toEqual([]);
  });

  it('replies to a snapshot request with what the tenant can see', async () => {
    const registry = new ChatPresenceRegistry();
    // A colleague already has the chat open, from before this tab connected.
    const colleague = fakeSocket({
      id: 'sock-2',
      user: { id: 'admin-2', username: 'kamal', tenantId: 'tenant-a' },
    });
    attachChatPresence(colleague.socket, fakeBus().bus, registry);
    colleague.fire(PRESENCE_EVENTS.open, { userId: CHAT });
    await flush();

    const f = fakeSocket();
    attachChatPresence(f.socket, fakeBus().bus, registry);
    f.fire(PRESENCE_EVENTS.list);

    const state = f.emitted.find((e) => e.event === PRESENCE_EVENTS.state);
    expect(state).toBeDefined();
    expect(state!.payload).toHaveLength(1);
    expect(state!.payload[0].userId).toBe(CHAT);
  });

  it('never leaks a tag across tenants', async () => {
    const registry = new ChatPresenceRegistry();
    const other = fakeSocket({
      id: 'sock-2',
      user: { id: 'admin-2', username: 'kamal', tenantId: 'tenant-b' },
    });
    const otherBus = fakeBus();
    attachChatPresence(other.socket, otherBus.bus, registry);
    other.fire(PRESENCE_EVENTS.open, { userId: CHAT });
    await flush();

    // Same conversation id, different tenant — and the default tenant holds
    // every legacy row, so this collision is ordinary, not exotic.
    expect(otherBus.sent[0].room).toBe(presenceRoom('tenant-b'));

    const f = fakeSocket();
    attachChatPresence(f.socket, fakeBus().bus, registry);
    f.fire(PRESENCE_EVENTS.list);
    const state = f.emitted.find((e) => e.event === PRESENCE_EVENTS.state);
    expect(state!.payload).toEqual([]);
  });

  it('ignores a malformed payload instead of throwing on the socket', async () => {
    // These arrive off the wire; nothing guarantees their shape, and an
    // exception in a handler takes down more than the tag.
    const f = fakeSocket();
    const b = fakeBus();
    attachChatPresence(f.socket, b.bus, new ChatPresenceRegistry());

    expect(() => f.fire(PRESENCE_EVENTS.open, undefined)).not.toThrow();
    expect(() => f.fire(PRESENCE_EVENTS.open, { userId: '  ' })).not.toThrow();
    expect(() => f.fire(PRESENCE_EVENTS.open, { userId: 42 })).not.toThrow();
    expect(() => f.fire(PRESENCE_EVENTS.close, {})).not.toThrow();
    await flush();
    expect(b.sent).toEqual([]);
  });

  it('does not register a socket with no admin id behind it', async () => {
    const f = fakeSocket({ user: { tenantId: 'tenant-a' } });
    const b = fakeBus();
    attachChatPresence(f.socket, b.bus, new ChatPresenceRegistry());

    f.fire(PRESENCE_EVENTS.open, { userId: CHAT });
    await flush();

    expect(b.sent).toEqual([]);
  });
});

describe('the client agrees on the protocol', () => {
  // There is no shared module between the backend and the Vite build, so the
  // two halves of this protocol can drift silently: rename an event here and
  // the tag just stops appearing, with nothing failing anywhere. This reads the
  // client and checks the names are still spelled the same on both sides.
  const client = fs.readFileSync(
    path.join(__dirname, '../../client/src/pages/ChatInterface.tsx'),
    'utf8',
  );

  it.each(Object.entries(PRESENCE_EVENTS))(
    'uses %s ("%s") in ChatInterface.tsx',
    (_name, event) => {
      expect(client).toContain(`'${event}'`);
    },
  );

  it('fans presence out to the whole room, sender included', () => {
    // `io.to(room)` reaches every member; `socket.to(room)` reaches everyone
    // EXCEPT the sender. Since the client renders the operator their own tag,
    // the second form would make your own pill silently never appear — and
    // because the adapter is a closure inside initSocket, nothing else in this
    // file can see which one it used.
    const server = fs.readFileSync(
      path.join(__dirname, '../server/socket.ts'),
      'utf8',
    );
    const adapter = server.slice(
      server.indexOf('attachChatPresence('),
      server.indexOf('.emit(event, payload)'),
    );
    expect(adapter).toContain('io.to(room)');
    expect(adapter).not.toContain('socket.to(room)');
  });

  it('asks for the snapshot on connect, not only on first render', () => {
    // A reconnect arrives as a brand new socket with nothing registered
    // server-side; without re-announcing there, an operator silently vanishes
    // from the chat they are sitting on.
    const connectHandler = client.slice(
      client.indexOf("newSocket.on('connect'"),
    );
    expect(connectHandler).toContain(PRESENCE_EVENTS.list);
    expect(connectHandler).toContain(PRESENCE_EVENTS.open);
  });
});
