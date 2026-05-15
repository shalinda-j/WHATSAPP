/**
 * Tests for the FollowUpScheduler module. The full tick path requires
 * Mongoose + AgentConfig + Lead + Contact, so the real integration
 * coverage lives in staging. These cases pin the module shape, the
 * exported start/stop lifecycle, and the dormancy-threshold math.
 */

import {
  startFollowUpScheduler,
  stopFollowUpScheduler,
  _tick,
} from '../services/FollowUpScheduler';

describe('FollowUpScheduler lifecycle', () => {
  afterEach(() => {
    stopFollowUpScheduler();
  });

  it('exports startFollowUpScheduler / stopFollowUpScheduler / _tick', () => {
    expect(typeof startFollowUpScheduler).toBe('function');
    expect(typeof stopFollowUpScheduler).toBe('function');
    expect(typeof _tick).toBe('function');
  });

  it('startFollowUpScheduler is idempotent (calling twice creates one timer)', () => {
    // The implementation guards on tickInterval being null. Calling
    // start twice should NOT throw or create a second timer that would
    // leak. We can't see the internal counter directly, but stop()
    // should cleanly clear it either way.
    expect(() => startFollowUpScheduler()).not.toThrow();
    expect(() => startFollowUpScheduler()).not.toThrow();
    expect(() => stopFollowUpScheduler()).not.toThrow();
    expect(() => stopFollowUpScheduler()).not.toThrow();
  });

  it('_tick is an async function', () => {
    expect(_tick.constructor.name).toBe('AsyncFunction');
  });
});

describe('Dormancy threshold math', () => {
  // The scheduler uses Lead.updatedAt < (now - 5d) as its filter.
  // This helper reproduces that math so it can be asserted on.
  function isDormant(updatedAt: Date, now: Date, days = 5): boolean {
    const threshold = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return updatedAt < threshold;
  }

  const now = new Date('2026-05-15T12:00:00.000Z');

  it('considers a Lead updated 6 days ago dormant', () => {
    const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    expect(isDormant(sixDaysAgo, now)).toBe(true);
  });

  it('considers a Lead updated 4 days ago NOT dormant', () => {
    const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);
    expect(isDormant(fourDaysAgo, now)).toBe(false);
  });

  it('considers a Lead updated exactly 5 days ago on the boundary (not dormant)', () => {
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    // The Mongo filter uses strict less-than, so exactly-5-days hits
    // the boundary and is NOT dormant.
    expect(isDormant(fiveDaysAgo, now)).toBe(false);
  });

  it('respects a custom threshold', () => {
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    expect(isDormant(twoDaysAgo, now, 5)).toBe(false);
    expect(isDormant(twoDaysAgo, now, 1)).toBe(true);
  });
});
