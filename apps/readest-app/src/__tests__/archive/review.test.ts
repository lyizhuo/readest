import { describe, it, expect } from 'vitest';

import {
  DAILY_REVIEW_MAX_COUNT,
  DAILY_REVIEW_MIN_COUNT,
  selectDailyNotes,
} from '@/features/archive/review/select';
import { localDayKey, shouldShowForToday } from '@/features/archive/review/db';
import type { DailyReviewCandidate } from '@/features/archive/review/select';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Deterministic PRNG so every draw sequence is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let nextId = 0;
const makeCandidate = (
  ageDays: number,
  todayMs: number,
  overrides: Partial<DailyReviewCandidate> = {},
): DailyReviewCandidate => ({
  id: `note-${nextId++}`,
  content: `content ${nextId}`,
  createdAt: todayMs - ageDays * DAY_MS,
  bookTitle: '书',
  bookHash: `hash-${nextId}`,
  cfi: null,
  chapterTitle: null,
  ...overrides,
});

describe('selectDailyNotes', () => {
  const TODAY = Date.UTC(2026, 7, 26);

  it('excludes notes younger than 90 days', () => {
    const fresh = makeCandidate(89, TODAY);
    const old = makeCandidate(90, TODAY);
    const picked = selectDailyNotes([fresh, old], TODAY, {}, Math.random, 5);
    expect(picked.map((n) => n.id)).toContain(old.id);
    expect(picked.map((n) => n.id)).not.toContain(fresh.id);
  });

  it('includes a note exactly 90 days old (boundary)', () => {
    const edge = makeCandidate(90, TODAY);
    expect(selectDailyNotes([edge], TODAY, {}, Math.random, 3).map((n) => n.id)).toEqual([edge.id]);
  });

  it('strongly prefers never-shown notes across 100 draws', () => {
    // One never-shown candidate against three previously-shown ones; the
    // never-shown note carries 3× weight, so it must appear in essentially
    // every draw's selection.
    const veteranA = makeCandidate(400, TODAY);
    const veteranB = makeCandidate(400, TODAY);
    const veteranC = makeCandidate(400, TODAY);
    const newcomer = makeCandidate(400, TODAY);
    const shownMap = {
      [veteranA.id]: TODAY - DAY_MS,
      [veteranB.id]: TODAY - DAY_MS,
      [veteranC.id]: TODAY - DAY_MS,
    };
    const pool = [veteranA, veteranB, veteranC, newcomer];
    const counts: Record<string, number> = {
      [veteranA.id]: 0,
      [veteranB.id]: 0,
      [veteranC.id]: 0,
      [newcomer.id]: 0,
    };
    for (let seed = 1; seed <= 100; seed++) {
      const picked = selectDailyNotes(pool, TODAY, shownMap, mulberry32(seed), 3);
      for (const note of picked) counts[note.id] = (counts[note.id] ?? 0) + 1;
    }
    // The 3× never-shown weight must make the newcomer dominate every
    // previously-shown candidate across the 100 draws.
    const cN = counts[newcomer.id] ?? 0;
    const cA = counts[veteranA.id] ?? 0;
    const cB = counts[veteranB.id] ?? 0;
    const cC = counts[veteranC.id] ?? 0;
    expect(cN).toBeGreaterThan(cA);
    expect(cN).toBeGreaterThan(cB);
    expect(cN).toBeGreaterThan(cC);
    expect(cN).toBeGreaterThanOrEqual(90);
  });

  it('keeps the default count inside the 3..5 bounds over many seeds', () => {
    const pool = Array.from({ length: 50 }, (_, i) => makeCandidate(365 + i, TODAY));
    for (let seed = 1; seed <= 50; seed++) {
      const picked = selectDailyNotes(pool, TODAY, {}, mulberry32(seed));
      expect(picked.length).toBeGreaterThanOrEqual(DAILY_REVIEW_MIN_COUNT);
      expect(picked.length).toBeLessThanOrEqual(DAILY_REVIEW_MAX_COUNT);
    }
  });

  it('clamps an out-of-range explicit count into 3..5', () => {
    const pool = Array.from({ length: 20 }, (_, i) => makeCandidate(365 + i, TODAY));
    expect(selectDailyNotes(pool, TODAY, {}, Math.random, 99).length).toBe(DAILY_REVIEW_MAX_COUNT);
    // Below the floor it still returns at least MIN — but never more than
    // the eligible pool itself.
    const tiny = [makeCandidate(400, TODAY), makeCandidate(401, TODAY)];
    expect(selectDailyNotes(tiny, TODAY, {}, Math.random, 1).length).toBe(2);
  });

  it('never picks duplicates and samples without replacement', () => {
    const pool = Array.from({ length: 10 }, (_, i) => makeCandidate(300 + i, TODAY));
    for (let seed = 1; seed <= 25; seed++) {
      const picked = selectDailyNotes(pool, TODAY, {}, mulberry32(seed), 5);
      const ids = new Set(picked.map((n) => n.id));
      expect(ids.size).toBe(picked.length);
    }
  });

  it('returns [] when nothing is eligible or input is empty', () => {
    const fresh = makeCandidate(10, TODAY);
    expect(selectDailyNotes([], TODAY, {}, Math.random)).toEqual([]);
    expect(selectDailyNotes([fresh], TODAY, {}, Math.random)).toEqual([]);
  });
});

describe('daily review day guard', () => {
  it('formats local calendar day as zero-padded YYYY-MM-DD', () => {
    expect(localDayKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
    expect(localDayKey(new Date(2026, 11, 31, 0, 0).getTime())).toBe('2026-12-31');
  });

  it('agrees with the local Date getters for a UTC-midnight timestamp', () => {
    // A UTC midnight falls on different calendar days per timezone; the key
    // must always match what the *local* Date getters report.
    const ms = Date.UTC(2026, 7, 26, 0, 0);
    const d = new Date(ms);
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    expect(localDayKey(ms)).toBe(expected);
  });

  it('shows once per local day and stays quiet afterwards', () => {
    const now = new Date(2026, 7, 26, 9, 0).getTime();
    expect(shouldShowForToday(null, now)).toBe(true);
    expect(shouldShowForToday('2026-08-25', now)).toBe(true);
    expect(shouldShowForToday('2026-08-26', now)).toBe(false);
    // Same guard later the same day.
    const evening = new Date(2026, 7, 26, 22, 0).getTime();
    expect(shouldShowForToday('2026-08-26', evening)).toBe(false);
    // Next day shows again.
    const tomorrow = new Date(2026, 7, 27, 0, 1).getTime();
    expect(shouldShowForToday('2026-08-26', tomorrow)).toBe(true);
  });
});
