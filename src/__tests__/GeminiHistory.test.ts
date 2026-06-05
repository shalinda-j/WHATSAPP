import { buildGeminiPayload } from '../services/gemini';
import { AIChatMessage } from '../interfaces/AIService';

/**
 * Guards the "first reply works, the second message falls back to the canned
 * template" production bug. Gemini 400s when a multiturn history does not
 * start with a user turn, does not strictly alternate, or has empty parts —
 * and that only happens once a conversation HAS history. buildGeminiPayload
 * must always emit a valid payload.
 */
const m = (role: AIChatMessage['role'], content: string): AIChatMessage => ({
  role,
  content,
});

describe('buildGeminiPayload', () => {
  it('pulls the system message out as systemInstruction', () => {
    const p = buildGeminiPayload([m('system', 'You are a bot'), m('user', 'hi')]);
    expect(p?.systemInstruction).toBe('You are a bot');
    expect(p?.history).toEqual([]);
    expect(p?.sendText).toBe('hi');
  });

  it('history always begins with a user turn (drops a leading model turn)', () => {
    // This is the classic turn-2 break: a history window that starts mid-turn
    // on a model/assistant reply.
    const p = buildGeminiPayload([
      m('assistant', 'Welcome!'),
      m('user', 'do you have jobs in Japan'),
    ]);
    expect(p).not.toBeNull();
    expect(p!.history.length === 0 || p!.history[0].role === 'user').toBe(true);
    expect(p!.sendText).toBe('do you have jobs in Japan');
  });

  it('strictly alternates by merging consecutive same-role turns', () => {
    const p = buildGeminiPayload([
      m('user', 'hi'),
      m('user', 'are you there'),
      m('assistant', 'yes'),
      m('user', 'what courses'),
    ]);
    const roles = p!.history.map((t) => t.role);
    // No two adjacent turns share a role.
    for (let i = 1; i < roles.length; i++) {
      expect(roles[i]).not.toBe(roles[i - 1]);
    }
    expect(p!.sendText).toBe('what courses');
  });

  it('drops empty / whitespace-only turns', () => {
    const p = buildGeminiPayload([
      m('user', '   '),
      m('assistant', 'hello'),
      m('user', 'real question'),
    ]);
    expect(p!.history.every((t) => t.parts[0].text.trim().length > 0)).toBe(
      true,
    );
    expect(p!.sendText).toBe('real question');
  });

  it('produces a history that ends with a model turn (so sendText is a valid next user turn)', () => {
    const p = buildGeminiPayload([
      m('user', 'q1'),
      m('assistant', 'a1'),
      m('user', 'q2'),
    ]);
    expect(p!.history[p!.history.length - 1].role).toBe('model');
    expect(p!.sendText).toBe('q2');
  });

  it('returns null when there is no user turn to send', () => {
    expect(buildGeminiPayload([m('system', 's'), m('assistant', 'a')])).toBeNull();
    expect(buildGeminiPayload([])).toBeNull();
  });
});
