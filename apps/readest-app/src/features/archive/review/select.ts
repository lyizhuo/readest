/**
 * Daily note review selection (fork feature, PRD F).
 *
 * Pure weighted sampling — no database or React dependencies, so it stays
 * trivially testable. Candidates are archive notes older than 90 days
 * (fresh notes don't need resurfacing); each candidate's weight grows with
 * its age in years and triples when it has never appeared in a previous
 * daily review.
 */

export interface DailyReviewCandidate {
  id: string;
  content: string;
  createdAt: number;
  bookTitle: string;
  bookHash: string;
  cfi: string | null;
  chapterTitle: string | null;
}

/** Notes newer than this are excluded — the daily review is for old highlights. */
const MIN_AGE_DAYS = 90;

export const DAILY_REVIEW_MIN_COUNT = 3;
export const DAILY_REVIEW_MAX_COUNT = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

const ageInDays = (createdAt: number, todayMs: number): number =>
  Math.floor((todayMs - createdAt) / DAY_MS);

/**
 * Picks `count` (default: a rng-driven value in [3..5]) candidates for
 * today's review. Weighted random sampling without replacement; never throws
 * on empty input — returns whatever survives filtering, possibly [].
 */
export function selectDailyNotes(
  candidates: DailyReviewCandidate[],
  todayMs: number,
  shownMap: Record<string, number>,
  rng: () => number,
  count?: number,
): DailyReviewCandidate[] {
  const eligible = candidates.filter((c) => ageInDays(c.createdAt, todayMs) >= MIN_AGE_DAYS);
  if (eligible.length === 0) return [];

  let target =
    count ??
    DAILY_REVIEW_MIN_COUNT +
      Math.floor(rng() * (DAILY_REVIEW_MAX_COUNT - DAILY_REVIEW_MIN_COUNT + 1));
  target = Math.max(
    DAILY_REVIEW_MIN_COUNT,
    Math.min(DAILY_REVIEW_MAX_COUNT, target, eligible.length),
  );

  const pool = eligible.map((candidate) => {
    const yearsAge = Math.floor(ageInDays(candidate.createdAt, todayMs) / 365);
    const everShown = shownMap[candidate.id] !== undefined;
    return { candidate, weight: (1 + yearsAge) * (everShown ? 1 : 3) };
  });

  const picked: DailyReviewCandidate[] = [];
  while (picked.length < target && pool.length > 0) {
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = rng() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      roll -= pool[i]!.weight;
      if (roll < 0) {
        index = i;
        break;
      }
    }
    const entry = pool[index];
    if (!entry) break;
    picked.push(entry.candidate);
    pool.splice(index, 1);
  }
  return picked;
}
