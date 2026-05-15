/**
 * Tests for IntentClassifierService. Sub-millisecond, deterministic
 * classifier — these tests just confirm the well-known intent
 * mappings stay stable so downstream agents that key off of intent
 * (LeadQualifier's BANT extraction, DealAgent's booking detection)
 * don't quietly stop firing.
 */

import { classifyIntent } from '../services/IntentClassifierService';

describe('classifyIntent', () => {
  it('classifies common greetings', () => {
    expect(classifyIntent('hi')).toBe('greeting');
    expect(classifyIntent('hello there')).toBe('greeting');
    expect(classifyIntent('ayubowan')).toBe('greeting');
  });

  it('classifies booking intent', () => {
    const got = classifyIntent('I want to book an appointment for tomorrow');
    expect(got).toBe('booking_request');
  });

  it('classifies pricing questions', () => {
    expect(classifyIntent('how much does it cost?')).toBe('pricing_question');
    expect(classifyIntent('what is the price for visa?')).toBe(
      'pricing_question',
    );
  });

  it('classifies complaints', () => {
    const got = classifyIntent('I have a complaint about your service');
    expect(got).toBe('complaint');
  });

  it('falls through to unknown for short or unrecognised input', () => {
    expect(classifyIntent('asdf')).toBe('unknown');
    expect(classifyIntent('x')).toBe('unknown');
  });

  it('handles empty / whitespace input without throwing', () => {
    expect(() => classifyIntent('')).not.toThrow();
    expect(() => classifyIntent('   ')).not.toThrow();
    expect(classifyIntent('')).toBe('unknown');
  });
});
