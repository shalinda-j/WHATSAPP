import Config from '../models/Config';

/**
 * Global kill-switch for the bot's automated replies. When paused, inbound
 * messages are still received, saved and shown in Live Chat — the bot just
 * doesn't auto-handle them, so a human takes over (e.g. to break a reply loop)
 * WITHOUT disconnecting the device.
 *
 * ponytail: single in-memory boolean. The API and the bot run in the SAME
 * process (monolith), so toggling is instant. Persisted to Config only so a
 * restart mid-incident doesn't silently resume the bot. Per-device pausing is
 * a future add if the single switch proves too blunt.
 */
let paused = false;

export function isAiPaused(): boolean {
  return paused;
}

export async function setAiPaused(next: boolean): Promise<boolean> {
  paused = next;
  await Config.findOneAndUpdate(
    { key: 'AI_AUTOREPLY_PAUSED' },
    { value: next ? 'true' : 'false' },
    { upsert: true },
  ).catch((e) => console.error('setAiPaused persist failed:', e));
  return paused;
}

/** Load the persisted state on boot (defaults to running). */
export async function loadAiPaused(): Promise<void> {
  const row = await Config.findOne({ key: 'AI_AUTOREPLY_PAUSED' })
    .lean<{ value?: string }>()
    .catch(() => null);
  paused = row?.value === 'true';
  if (paused) console.log('⏸️ AI auto-reply is PAUSED (loaded from config)');
}
