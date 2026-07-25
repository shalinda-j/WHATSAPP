import {
  describeHistoryMessage,
  historyTimestampToDate,
  isSkippableHistoryJid,
  mapHistoryMessage,
} from '../services/ChatHistorySyncService';

// Minimal WAMessage-shaped fixtures — the mapper only touches key,
// messageTimestamp, message and pushName.
const makeMessage = (overrides: Record<string, any> = {}): any => ({
  key: { remoteJid: '94771234567@s.whatsapp.net', id: 'ABC123', fromMe: false },
  messageTimestamp: 1_750_000_000,
  message: { conversation: 'ayubowan' },
  ...overrides,
});

describe('isSkippableHistoryJid', () => {
  it('skips status/broadcast/newsletter and empty jids', () => {
    expect(isSkippableHistoryJid('status@broadcast')).toBe(true);
    expect(isSkippableHistoryJid('123@broadcast')).toBe(true);
    expect(isSkippableHistoryJid('abc@newsletter')).toBe(true);
    expect(isSkippableHistoryJid('')).toBe(true);
    expect(isSkippableHistoryJid(undefined)).toBe(true);
  });

  it('keeps direct chats, LID chats and groups', () => {
    expect(isSkippableHistoryJid('94771234567@s.whatsapp.net')).toBe(false);
    expect(isSkippableHistoryJid('29141520924734@lid')).toBe(false);
    expect(isSkippableHistoryJid('12036304@g.us')).toBe(false);
  });
});

describe('historyTimestampToDate', () => {
  it('converts epoch seconds from every shape Baileys uses', () => {
    const expected = new Date(1_750_000_000_000).toISOString();
    expect(historyTimestampToDate(1_750_000_000)?.toISOString()).toBe(expected);
    expect(historyTimestampToDate('1750000000')?.toISOString()).toBe(expected);
    expect(
      historyTimestampToDate({ toNumber: () => 1_750_000_000 })?.toISOString(),
    ).toBe(expected);
  });

  it('rejects missing, zero and unparsable timestamps', () => {
    expect(historyTimestampToDate(undefined)).toBeNull();
    expect(historyTimestampToDate(null)).toBeNull();
    expect(historyTimestampToDate(0)).toBeNull();
    expect(historyTimestampToDate(-5)).toBeNull();
    expect(historyTimestampToDate('later')).toBeNull();
  });
});

describe('describeHistoryMessage', () => {
  it('reads plain and extended text', () => {
    expect(describeHistoryMessage({ conversation: 'hello' })).toEqual({
      type: 'text',
      content: 'hello',
    });
    expect(
      describeHistoryMessage({ extendedTextMessage: { text: 'hi there' } }),
    ).toEqual({ type: 'text', content: 'hi there' });
  });

  it('unwraps ephemeral and view-once envelopes', () => {
    expect(
      describeHistoryMessage({
        ephemeralMessage: { message: { conversation: 'vanishing' } },
      }),
    ).toEqual({ type: 'text', content: 'vanishing' });
    expect(
      describeHistoryMessage({
        viewOnceMessageV2: { message: { imageMessage: { caption: 'once' } } },
      }),
    ).toEqual({ type: 'image', content: 'once' });
  });

  it('gives captionless media a readable placeholder', () => {
    expect(describeHistoryMessage({ imageMessage: {} })).toEqual({
      type: 'image',
      content: '[image]',
    });
    expect(describeHistoryMessage({ videoMessage: {} })).toEqual({
      type: 'video',
      content: '[video]',
    });
    expect(describeHistoryMessage({ stickerMessage: {} })).toEqual({
      type: 'sticker',
      content: '[sticker]',
    });
    expect(describeHistoryMessage({ audioMessage: { ptt: true } })).toEqual({
      type: 'voice',
      content: '[voice message]',
    });
    expect(describeHistoryMessage({ audioMessage: { ptt: false } })).toEqual({
      type: 'voice',
      content: '[audio]',
    });
    expect(
      describeHistoryMessage({ documentMessage: { fileName: 'cv.pdf' } }),
    ).toEqual({ type: 'document', content: '[document: cv.pdf]' });
    expect(describeHistoryMessage({ locationMessage: {} })).toEqual({
      type: 'text',
      content: '[location]',
    });
    expect(describeHistoryMessage({ contactMessage: {} })).toEqual({
      type: 'text',
      content: '[contact card]',
    });
  });

  it('prefers a real caption over the placeholder', () => {
    expect(
      describeHistoryMessage({ imageMessage: { caption: 'my passport' } }),
    ).toEqual({ type: 'image', content: 'my passport' });
  });

  it('returns null for messages with no visible body', () => {
    expect(describeHistoryMessage(null)).toBeNull();
    expect(describeHistoryMessage({})).toBeNull();
    expect(describeHistoryMessage({ protocolMessage: { type: 0 } })).toBeNull();
    expect(
      describeHistoryMessage({ reactionMessage: { text: '👍' } }),
    ).toBeNull();
    expect(
      describeHistoryMessage({ senderKeyDistributionMessage: {} }),
    ).toBeNull();
    expect(describeHistoryMessage({ conversation: '   ' })).toBeNull();
  });
});

describe('mapHistoryMessage', () => {
  it('maps an inbound text message onto a chat row', () => {
    const doc = mapHistoryMessage(makeMessage({ pushName: 'Nimal' }), 'dev-1');
    expect(doc).toMatchObject({
      userId: '94771234567@s.whatsapp.net',
      role: 'user',
      type: 'text',
      content: 'ayubowan',
      read: true,
      waMessageId: 'ABC123',
      metadata: {
        sessionId: 'dev-1',
        pushName: 'Nimal',
        realPhone: '94771234567',
        source: 'history_sync',
      },
    });
    expect(doc?.timestamp.toISOString()).toBe(
      new Date(1_750_000_000_000).toISOString(),
    );
  });

  it('marks outbound history as the assistant side', () => {
    const doc = mapHistoryMessage(
      makeMessage({
        key: {
          remoteJid: '94771234567@s.whatsapp.net',
          id: 'X1',
          fromMe: true,
        },
      }),
      'dev-1',
    );
    expect(doc?.role).toBe('assistant');
  });

  it('always marks history as read so unread badges stay accurate', () => {
    expect(mapHistoryMessage(makeMessage(), 'dev-1')?.read).toBe(true);
  });

  it('stamps the tenant only when one is supplied', () => {
    const withTenant = mapHistoryMessage(makeMessage(), 'dev-1', 'tenant-1');
    expect(withTenant?.tenantId).toBe('tenant-1');
    expect(mapHistoryMessage(makeMessage(), 'dev-1', null)).not.toHaveProperty(
      'tenantId',
    );
  });

  it('resolves the real phone of a LID chat from senderPn', () => {
    const doc = mapHistoryMessage(
      makeMessage({
        key: {
          remoteJid: '29141520924734@lid',
          id: 'L1',
          fromMe: false,
          senderPn: '94771234567@s.whatsapp.net',
        },
      }),
      'dev-1',
    );
    expect(doc?.userId).toBe('29141520924734@lid');
    expect(doc?.metadata.realPhone).toBe('94771234567');
  });

  it('omits realPhone for a LID with nothing to resolve from', () => {
    const doc = mapHistoryMessage(
      makeMessage({
        key: { remoteJid: '29141520924734@lid', id: 'L2', fromMe: false },
      }),
      'dev-1',
    );
    expect(doc?.metadata.realPhone).toBeUndefined();
  });

  it('rejects broadcasts, id-less, timestamp-less and bodyless messages', () => {
    expect(
      mapHistoryMessage(
        makeMessage({ key: { remoteJid: 'status@broadcast', id: 'S1' } }),
        'dev-1',
      ),
    ).toBeNull();
    expect(
      mapHistoryMessage(
        makeMessage({
          key: { remoteJid: '94771234567@s.whatsapp.net', id: null },
        }),
        'dev-1',
      ),
    ).toBeNull();
    expect(
      mapHistoryMessage(makeMessage({ messageTimestamp: 0 }), 'dev-1'),
    ).toBeNull();
    expect(
      mapHistoryMessage(
        makeMessage({ message: { protocolMessage: {} } }),
        'dev-1',
      ),
    ).toBeNull();
    expect(mapHistoryMessage({} as any, 'dev-1')).toBeNull();
  });

  it('keeps group history', () => {
    const doc = mapHistoryMessage(
      makeMessage({
        key: { remoteJid: '12036304@g.us', id: 'G1', fromMe: false },
      }),
      'dev-1',
    );
    expect(doc?.userId).toBe('12036304@g.us');
  });
});
