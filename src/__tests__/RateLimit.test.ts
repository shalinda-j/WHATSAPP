import { isRateLimitError, parseRetryDelayMs } from '../services/AILoadBalancer';

/**
 * Guards the 429 handling that keeps a rate-limited provider from collapsing
 * every reply into the canned fallback template. The load balancer must
 * recognise a Gemini 429 and honour its retryDelay (capped).
 */
describe('isRateLimitError', () => {
  it('detects a numeric 429 status on common shapes', () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError({ statusCode: 429 })).toBe(true);
    expect(isRateLimitError({ response: { status: 429 } })).toBe(true);
  });

  it('detects 429 / quota wording in the message', () => {
    expect(
      isRateLimitError(new Error('[429 Too Many Requests] quota exceeded')),
    ).toBe(true);
    expect(isRateLimitError(new Error('RESOURCE_EXHAUSTED'))).toBe(true);
    expect(isRateLimitError(new Error('rate limit reached'))).toBe(true);
  });

  it('does not misclassify unrelated errors', () => {
    expect(isRateLimitError(new Error('ECONNRESET'))).toBe(false);
    expect(isRateLimitError({ status: 500 })).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
});

describe('parseRetryDelayMs', () => {
  it('reads the server retryDelay (seconds → ms) when under the cap', () => {
    const err = new Error('429 ... "retryDelay":"5s" ...');
    expect(parseRetryDelayMs(err, 1000)).toBe(5000);
  });

  it('caps the retry delay at 8s so a customer is not left hanging', () => {
    const err = new Error('"retryDelay": "60s"');
    expect(parseRetryDelayMs(err, 1000)).toBe(8000);
  });

  it('falls back to the provided exponential value when absent (also capped)', () => {
    expect(parseRetryDelayMs(new Error('boom'), 2000)).toBe(2000);
    expect(parseRetryDelayMs(new Error('boom'), 99000)).toBe(8000);
  });
});
