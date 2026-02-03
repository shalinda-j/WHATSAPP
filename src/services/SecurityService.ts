/**
 * Security Service
 * Implements "Defense in Depth" strategies to sanitize inputs and detect attacks.
 */

// Known adversarial patterns (Heuristic Detection)
const JAILBREAK_KEYWORDS = [
  'ignore previous instructions',
  'ignore all instructions',
  'system override',
  'developer mode',
  'debug mode',
  'unrestricted mode',
  'act as a developer',
  'act as an unrestricted ai',
  'you are now a hacker',
  'execute the following code',
  'delete all data',
  'drop table',
  'select * from',
  'god mode',
  'do anything now',
  'dan mode',
  'jailbreak',
  'hypothetical scenario',
  'pretend to be',
  'roleplay as',
  'always answer',
  'no ethical constraints',
  'no safety guidelines',
  'disable safety protocols',
  'anti-gpt',
  'wormgpt',
  'fraudgpt',
];

export class SecurityService {
  /**
   * Sanitizes user input to remove potentially dangerous control characters.
   * @param input Raw user input
   * @returns Sanitized string
   */
  static sanitize(input: string): string {
    if (!input) return '';
    // Remove null bytes and other control characters (keeping newlines/tabs)
    // eslint-disable-next-line no-control-regex
    return input.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, '');
  }

  /**
   * Checks for known jailbreak or injection patterns.
   * @param input User input
   * @returns True if the message is considered safe, False if malicious.
   */
  static isSafe(input: string): boolean {
    const lowerInput = input.toLowerCase();

    // 1. Check for Jailbreak Keywords
    for (const keyword of JAILBREAK_KEYWORDS) {
      if (lowerInput.includes(keyword)) {
        console.warn(
          `🛡️ Security Block: Detected jailbreak keyword "${keyword}" in input.`,
        );
        return false;
      }
    }

    // 2. Length Check (excessively long inputs can be a buffer overflow attempt or DoS)
    if (input.length > 5000) {
      console.warn(
        `🛡️ Security Block: Input too long (${input.length} chars).`,
      );
      return false;
    }

    return true;
  }
}
