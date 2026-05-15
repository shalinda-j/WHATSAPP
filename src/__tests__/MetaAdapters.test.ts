/**
 * Tests for the Meta-channel adapters' ingestWebhook normalisation.
 * Pure function on the payload shape — no Mongo, no Graph API. The
 * send() path needs a real Meta access token and is exercised in
 * staging once business verification completes.
 */

import { InstagramAdapter } from '../channels/InstagramAdapter';
import { FacebookMessengerAdapter } from '../channels/FacebookMessengerAdapter';
import { InboundMessage } from '../channels/types';

function captureHandlers(adapter: { onInbound: (h: any) => void }) {
  const captured: InboundMessage[] = [];
  adapter.onInbound(async (msg: InboundMessage) => {
    captured.push(msg);
  });
  return captured;
}

describe('InstagramAdapter.ingestWebhook', () => {
  it('normalises a single message event into an InboundMessage', async () => {
    const adapter = new InstagramAdapter();
    const captured = captureHandlers(adapter);
    await adapter.ingestWebhook('tenant-1', {
      entry: [
        {
          messaging: [
            {
              sender: { id: '123-sender' },
              recipient: { id: '456-business' },
              message: { text: 'hi there' },
              timestamp: 1747000000000,
            },
          ],
        },
      ],
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      channel: 'instagram',
      tenantId: 'tenant-1',
      externalUserId: '123-sender',
      externalThreadId: '456-business',
      text: 'hi there',
    });
    expect(captured[0].receivedAt).toBeInstanceOf(Date);
  });

  it('handles multiple entries and multiple events per entry', async () => {
    const adapter = new InstagramAdapter();
    const captured = captureHandlers(adapter);
    await adapter.ingestWebhook('t', {
      entry: [
        {
          messaging: [
            {
              sender: { id: 'a' },
              recipient: { id: 'biz' },
              message: { text: 'one' },
            },
            {
              sender: { id: 'b' },
              recipient: { id: 'biz' },
              message: { text: 'two' },
            },
          ],
        },
        {
          messaging: [
            {
              sender: { id: 'c' },
              recipient: { id: 'biz' },
              message: { text: 'three' },
            },
          ],
        },
      ],
    });
    expect(captured.map((m) => m.text)).toEqual(['one', 'two', 'three']);
  });

  it('handles empty payloads without throwing', async () => {
    const adapter = new InstagramAdapter();
    const captured = captureHandlers(adapter);
    await adapter.ingestWebhook('t', {});
    await adapter.ingestWebhook('t', { entry: [] });
    await adapter.ingestWebhook('t', { entry: [{ messaging: [] }] });
    expect(captured).toHaveLength(0);
  });

  it('leaves text undefined when the event has no text field', async () => {
    const adapter = new InstagramAdapter();
    const captured = captureHandlers(adapter);
    await adapter.ingestWebhook('t', {
      entry: [
        {
          messaging: [
            { sender: { id: 'a' }, recipient: { id: 'biz' }, message: {} },
          ],
        },
      ],
    });
    expect(captured[0].text).toBeUndefined();
  });
});

describe('FacebookMessengerAdapter.ingestWebhook', () => {
  it('normalises a Messenger event into an InboundMessage', async () => {
    const adapter = new FacebookMessengerAdapter();
    const captured = captureHandlers(adapter);
    await adapter.ingestWebhook('tenant-fb', {
      entry: [
        {
          id: 'page-id-789',
          messaging: [
            {
              sender: { id: 'user-1' },
              message: { text: 'hello messenger' },
              timestamp: 1747000000000,
            },
          ],
        },
      ],
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      channel: 'facebook',
      tenantId: 'tenant-fb',
      externalUserId: 'user-1',
      externalThreadId: 'page-id-789',
      text: 'hello messenger',
    });
  });

  it('captures the page id as externalThreadId (not recipient.id)', async () => {
    // Messenger uses the page id from entry, not recipient — this
    // matches what the outbound send() uses to identify the page.
    const adapter = new FacebookMessengerAdapter();
    const captured = captureHandlers(adapter);
    await adapter.ingestWebhook('t', {
      entry: [
        {
          id: 'page-A',
          messaging: [
            {
              sender: { id: 'user-1' },
              recipient: { id: 'page-A' },
              message: { text: 'x' },
            },
          ],
        },
      ],
    });
    expect(captured[0].externalThreadId).toBe('page-A');
  });
});
