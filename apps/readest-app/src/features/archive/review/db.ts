/**
 * Direct archive.db access for the daily note review (fork feature, PRD F).
 *
 * ArchiveDb's public methods are per-book, but the daily review needs a
 * cross-book listing over all non-deleted notes — so this module replicates
 * the open path from ../db/archiveDb (openDatabase('archive', ...) +
 * migrate) and issues raw SQL instead. Every exported function degrades
 * silently: a failed open/query must never break the library page.
 */

import type { AppService } from '@/types/system';
import type { DatabaseRow } from '@/types/database';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';

import { selectDailyNotes } from './select';
import type { DailyReviewCandidate } from './select';

export const DAILY_REVIEW_SHOWN_KEY = 'daily_review_shown';
export const DAILY_REVIEW_LAST_DAY_KEY = 'daily_review_last_day';

/** Local calendar day as YYYY-MM-DD — the once-per-day guard key format. */
export function localDayKey(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

interface NoteJoinRow extends DatabaseRow {
  id: string;
  content: string;
  created_at: number;
  cfi: string | null;
  chapter_title: string | null;
  title: string;
  book_hash: string | null;
}

/**
 * Opens archive.db directly and lists every live, non-empty note across all
 * books. Returns [] on any failure.
 */
export async function loadDailyCandidates(appService: AppService): Promise<DailyReviewCandidate[]> {
  try {
    const db = await appService.openDatabase('archive', 'archive.db', 'Data');
    await migrate(db, getMigrations('archive'));
    const rows = await db.select<NoteJoinRow>(
      `SELECT n.id, n.content, n.created_at, n.cfi, n.chapter_title,
              b.title, b.book_hash
         FROM notes n
         JOIN books b ON b.id = n.book_id
        WHERE n.deleted_at IS NULL AND n.content != ''`,
    );
    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      createdAt: row.created_at,
      bookTitle: row.title,
      bookHash: row.book_hash ?? '',
      cfi: row.cfi,
      chapterTitle: row.chapter_title,
    }));
  } catch {
    return [];
  }
}

/**
 * Reads both review kv entries in one shot. Returns null on failure so the
 * caller can treat "unknown" the same as "never shown today".
 */
export async function loadReviewState(appService: AppService): Promise<{
  shownMap: Record<string, number>;
  lastDay: string | null;
} | null> {
  try {
    const db = await appService.openDatabase('archive', 'archive.db', 'Data');
    await migrate(db, getMigrations('archive'));
    const rows = await db.select<{ key: string; value: string }>(
      `SELECT key, value FROM kv WHERE key IN (?, ?)`,
      [DAILY_REVIEW_SHOWN_KEY, DAILY_REVIEW_LAST_DAY_KEY],
    );
    let shownMap: Record<string, number> = {};
    let lastDay: string | null = null;
    for (const row of rows) {
      if (row.key === DAILY_REVIEW_LAST_DAY_KEY) {
        lastDay = row.value;
      } else {
        try {
          shownMap = JSON.parse(row.value);
        } catch {
          shownMap = {};
        }
      }
    }
    return { shownMap, lastDay };
  } catch {
    return null;
  }
}

/** Persists shown-map + last-shown-day; best-effort, failures ignored. */
export async function saveReviewState(
  appService: AppService,
  shownMap: Record<string, number>,
): Promise<void> {
  try {
    const db = await appService.openDatabase('archive', 'archive.db', 'Data');
    await migrate(db, getMigrations('archive'));
    await db.execute(
      `INSERT INTO kv (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [DAILY_REVIEW_SHOWN_KEY, JSON.stringify(shownMap)],
    );
    await db.execute(
      `INSERT INTO kv (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [DAILY_REVIEW_LAST_DAY_KEY, localDayKey(Date.now())],
    );
  } catch {
    // silent — the guard just resets next mount
  }
}

/**
 * Once-per-local-day decision: show only when nothing was recorded for the
 * current local day. Pure so the guard is testable without a database.
 */
export function shouldShowForToday(lastDay: string | null, nowMs: number): boolean {
  return lastDay !== localDayKey(nowMs);
}

export { selectDailyNotes };
