/**
 * MessageQualityService — the final polish applied to EVERY outbound customer
 * message so the bot always sends clean, on-brand WhatsApp text no matter what
 * formatting the LLM produced.
 *
 * Pure-code and FAIL-SAFE by design: if cleaning ever reduces a non-empty
 * message to nothing, the original is returned — a customer is never sent
 * silence because of this step.
 */

// WhatsApp renders fine well beyond this, but enrollment replies are meant to
// be short (2–3 sentences). We only truncate as a last resort, on a boundary.
const DEFAULT_MAX_LEN = 1500;

export class MessageQualityService {
  clean(input: string, maxLen: number = DEFAULT_MAX_LEN): string {
    if (!input) return input;
    const original = input;
    let s = input;

    // Markdown bold **x** / __x__ → WhatsApp bold *x* (one asterisk).
    s = s.replace(/\*\*(.+?)\*\*/g, '*$1*');
    s = s.replace(/__(.+?)__/g, '*$1*');

    // Strip markdown headings (#, ##, …) at the start of a line.
    s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');

    // Strip list-bullet markers ("- ", "* ", "• ") at the start of a line.
    // Anchored to line-start + trailing space so it never touches "9-5" or
    // an inline *bold* token.
    s = s.replace(/^\s{0,3}[-*•]\s+/gm, '');

    // Collapse 3+ blank lines down to a single blank line.
    s = s.replace(/\n{3,}/g, '\n\n');

    // Trim trailing whitespace per line, then overall.
    s = s.replace(/[ \t]+$/gm, '').trim();

    // Last-resort length cap on a sentence/line/word boundary.
    if (s.length > maxLen) {
      const slice = s.slice(0, maxLen);
      const boundary = Math.max(
        slice.lastIndexOf('. '),
        slice.lastIndexOf('\n'),
        slice.lastIndexOf(' '),
      );
      s = (boundary > maxLen * 0.6 ? slice.slice(0, boundary) : slice).trim();
    }

    return s.length > 0 ? s : original;
  }
}

export const messageQuality = new MessageQualityService();
export default messageQuality;
