import { describe, it, expect } from 'vitest';

import {
  computeRemaining,
  formatRemaining,
  shouldNotify,
} from '@/features/archive/timer/countdown';
import { LITERARY_CLOCK, lookupClock } from '@/features/archive/timer/literaryClock';

describe('countdown', () => {
  const START = 1_000_000;

  it('computes remaining seconds from wall-clock start', () => {
    // 0s in → full target
    expect(computeRemaining(START, 25 * 60, START)).toBe(1500);
    // 59.9s in on a 25 min timer → floor semantics keep one extra second
    expect(computeRemaining(START, 1500, START + 59_900)).toBe(1441);
    expect(computeRemaining(START, 1500, START + 60_000)).toBe(1440);
  });

  it('hits exactly zero at the boundary and clamps below', () => {
    expect(computeRemaining(START, 90, START + 90_000)).toBe(0);
    expect(computeRemaining(START, 90, START + 90_001)).toBe(0);
    expect(computeRemaining(START, 90, START + 3600_000)).toBe(0);
  });

  it('clamps a not-yet-started clock to the full target (no negative elapsed)', () => {
    expect(computeRemaining(START, 60, START - 500)).toBe(60);
  });

  it('formats MM:SS with unwrapped minutes', () => {
    expect(formatRemaining(0)).toBe('00:00');
    expect(formatRemaining(5)).toBe('00:05');
    expect(formatRemaining(59)).toBe('00:59');
    expect(formatRemaining(60)).toBe('01:00');
    expect(formatRemaining(90 * 60)).toBe('90:00');
    expect(formatRemaining(-3)).toBe('00:00');
    expect(formatRemaining(149.9)).toBe('02:29');
  });

  it('notifies only at zero', () => {
    expect(shouldNotify(0)).toBe(true);
    expect(shouldNotify(-1)).toBe(true);
    expect(shouldNotify(1)).toBe(false);
    expect(shouldNotify(1500)).toBe(false);
  });
});

describe('literaryClock', () => {
  /** Local-time constructor — lookupClock reads local getHours/getMinutes. */
  function at(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(2026, 7, 26, h, m, 0, 0).getTime();
  }

  it('curates at least 40 well-formed entries', () => {
    expect(LITERARY_CLOCK.length).toBeGreaterThanOrEqual(40);
    for (const entry of LITERARY_CLOCK) {
      expect(entry.hhmm).toMatch(/^\d{2}:\d{2}$/);
      expect(entry.line.length).toBeGreaterThan(0);
      expect(entry.line.length).toBeLessThanOrEqual(40);
      expect(entry.source.length).toBeGreaterThan(0);
    }
  });

  it('returns the exact entry when now lands on it', () => {
    expect(lookupClock(at('23:15'))?.hhmm).toBe('23:15');
  });

  it('picks the nearest entry inside a sparse stretch', () => {
    // 05:55 is 5 min from 06:00 but 10 from 05:45 → 06:00 must win.
    expect(lookupClock(at('05:55'))?.hhmm).toBe('06:00');
  });

  it('wraps around midnight', () => {
    // 23:55 is 25 min from 23:30 vs 35 min from 00:30 → plain nearest wins.
    expect(lookupClock(at('23:55'))?.hhmm).toBe('23:30');
    // 00:10 is 20 min to 00:30 vs 40 min to 23:30 → wraps across midnight.
    expect(lookupClock(at('00:10'))?.hhmm).toBe('00:30');
  });

  it('includes exactly ±30 minutes', () => {
    // 14:00 sits exactly 30 min from 13:30 and 60 from 15:00 → inclusive hit.
    expect(lookupClock(at('14:00'))?.hhmm).toBe('13:30');
  });

  it('returns null beyond the ±30 minute tolerance', () => {
    // The curated table leaves a siesta gap 13:30→15:00; its middle is >30 from both.
    expect(lookupClock(at('14:15'))).toBeNull();
  });
});
