import { v4 as uuidv4 } from 'uuid';

import type { AppService } from '@/types/system';
import type { DatabaseRow, DatabaseService } from '@/types/database';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';

import { ARCHIVE_STATUSES, ArchiveBook, ArchiveRound, ArchiveStatus, ArchiveTag } from '../types';
import { applyStatusTransition, StatusState } from '../library/statusMachine';

/** BaseDir passed to AppService.openDatabase — app-level data, like statistics.db. */
const ARCHIVE_DB_PATH = 'archive.db';

interface BookRow extends DatabaseRow {
  id: string;
  book_hash: string | null;
  title: string;
  subtitle: string | null;
  authors: string;
  translators: string | null;
  publisher: string | null;
  publish_year: number | null;
  page_count: number | null;
  isbn: string | null;
  cover_path: string | null;
  format: string;
  series: string | null;
  fiction_type: string | null;
  description: string | null;
  rating: number | null;
  source_url: string | null;
  progress_unit: string | null;
  created_at: number;
  updated_at: number;
  // Joined from reading_status (LEFT JOIN in every book query).
  status: string | null;
  current_round: number | null;
  started_at: number | null;
  finished_at: number | null;
}

interface RoundRow extends DatabaseRow {
  id: string;
  book_id: string;
  round_no: number;
  status: string;
  started_at: number;
  finished_at: number | null;
  total_seconds: number;
  rating: number | null;
  review: string | null;
}

interface SessionRow extends DatabaseRow {
  id: string;
  book_id: string;
  round_no: number;
  device: string | null;
  started_at: number;
  ended_at: number | null;
  duration_sec: number;
  progress_start: number | null;
  progress_end: number | null;
  pages_read: number | null;
  note_count_delta: number;
  open: number;
}

export interface SessionRecord {
  id: string;
  bookId: string;
  roundNo: number;
  device: string | null;
  startedAt: number;
  endedAt: number | null;
  durationSec: number;
  progressStart: number | null;
  progressEnd: number | null;
  pagesRead: number | null;
  noteCountDelta: number;
  open: boolean;
}

/** Session joined with its book's display fields (calendar/list views). */
export interface SessionWithBook extends SessionRecord {
  title: string;
  bookHash: string | null;
}

function mapSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    roundNo: row.round_no,
    device: row.device,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSec: row.duration_sec,
    progressStart: row.progress_start,
    progressEnd: row.progress_end,
    pagesRead: row.pages_read,
    noteCountDelta: row.note_count_delta,
    open: !!row.open,
  };
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function mapBook(row: BookRow): ArchiveBook {
  const format = row.format === 'paper' || row.format === 'audio' ? row.format : 'ebook';
  return {
    id: row.id,
    bookHash: row.book_hash,
    title: row.title,
    subtitle: row.subtitle,
    authors: parseJsonArray(row.authors),
    translators: parseJsonArray(row.translators),
    publisher: row.publisher,
    publishYear: row.publish_year,
    pageCount: row.page_count,
    isbn: row.isbn,
    coverPath: row.cover_path,
    format,
    series: row.series,
    fictionType:
      row.fiction_type === 'fiction' || row.fiction_type === 'nonfiction' ? row.fiction_type : null,
    description: row.description,
    rating: row.rating,
    sourceUrl: row.source_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status:
      row.status && (ARCHIVE_STATUSES as string[]).includes(row.status)
        ? (row.status as ArchiveStatus)
        : 'wish',
    currentRound: row.current_round ?? 1,
    statusStartedAt: row.started_at,
    statusFinishedAt: row.finished_at,
  };
}

// Module-level singleton. OPFS (web build) permits only ONE access handle per
// file per origin — a second concurrent connect() to archive.db throws
// NoModificationAllowedError, so every caller must share one open promise
// (same pattern as StatisticsDb).
let sharedOpen: Promise<ArchiveDb> | null = null;
let lifecycleBound = false;

function bindArchiveLifecycle(): void {
  if (lifecycleBound || typeof document === 'undefined') return;
  lifecycleBound = true;
  // Fold the WAL into the main db when the tab is hidden/closed.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && sharedOpen) {
      void sharedOpen.then((instance) => instance.checkpoint()).catch(() => {});
    }
  });
}

export class ArchiveDb {
  /** Serializes multi-statement writes so concurrent callers cannot nest BEGINs. */
  private writeLock: Promise<void> = Promise.resolve();

  private constructor(private readonly db: DatabaseService) {}

  /** Production entry point — opens + migrates archive.db (per-tab singleton). */
  static async open(appService: AppService): Promise<ArchiveDb> {
    bindArchiveLifecycle();
    if (!sharedOpen) {
      const opening = (async () => {
        const db = await appService.openDatabase('archive', ARCHIVE_DB_PATH, 'Data');
        await migrate(db, getMigrations('archive'));
        return new ArchiveDb(db);
      })();
      sharedOpen = opening;
      // A transient open failure must not poison the memo — retry next call.
      void opening.catch(() => {
        if (sharedOpen === opening) sharedOpen = null;
      });
    }
    return sharedOpen;
  }

  /** Test/advanced entry point — wrap an already-migrated DatabaseService. */
  static from(db: DatabaseService): ArchiveDb {
    return new ArchiveDb(db);
  }
  async checkpoint(): Promise<void> {
    await this.db.execute('PRAGMA wal_checkpoint(TRUNCATE)');
  }

  /** Checkpoint, close the underlying connection, and reset the singleton. */
  async close(): Promise<void> {
    try {
      await this.checkpoint();
    } catch {
      // best-effort — a checkpoint failure must not block close
    }
    await this.db.close();
    sharedOpen = null;
  }

  /** Runs `fn` inside a transaction, serialized behind prior writes. */
  private async withWrite<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.writeLock;
    let release!: () => void;
    this.writeLock = new Promise<void>((resolve) => (release = resolve));
    await prev;
    try {
      await this.db.execute('BEGIN');
      try {
        const result = await fn();
        await this.db.execute('COMMIT');
        return result;
      } catch (err) {
        await this.db.execute('ROLLBACK').catch(() => {});
        throw err;
      }
    } finally {
      release();
    }
  }

  // ---------------------------------------------------------------- books

  async listBooks(): Promise<ArchiveBook[]> {
    const rows = await this.db.select<BookRow>(
      `SELECT b.*, s.status AS status, s.current_round AS current_round,
              s.started_at AS started_at, s.finished_at AS finished_at
       FROM books b LEFT JOIN reading_status s ON s.book_id = b.id
       ORDER BY b.updated_at DESC`,
    );
    return rows.map((r) => mapBook(r));
  }

  async getBook(id: string): Promise<ArchiveBook | null> {
    const rows = await this.db.select<BookRow>(
      `SELECT b.*, s.status AS status, s.current_round AS current_round,
              s.started_at AS started_at, s.finished_at AS finished_at
       FROM books b LEFT JOIN reading_status s ON s.book_id = b.id
       WHERE b.id = ? LIMIT 1`,
      [id],
    );
    return rows[0] ? mapBook(rows[0]) : null;
  }

  async getBookByHash(bookHash: string): Promise<ArchiveBook | null> {
    const rows = await this.db.select<BookRow>(
      `SELECT b.*, s.status AS status, s.current_round AS current_round,
              s.started_at AS started_at, s.finished_at AS finished_at
       FROM books b LEFT JOIN reading_status s ON s.book_id = b.id
       WHERE b.book_hash = ? LIMIT 1`,
      [bookHash],
    );
    return rows[0] ? mapBook(rows[0]) : null;
  }

  /**
   * Finds archive entries whose normalized title matches and whose primary
   * author overlaps — the PRD A1 duplicate hint (title+authors).
   */
  async findPotentialDuplicates(
    title: string,
    authors: string[],
    excludeId?: string,
  ): Promise<ArchiveBook[]> {
    const normalized = title.trim().toLowerCase();
    if (!normalized) return [];
    const all = await this.listBooks();
    const primaryAuthor = authors[0]?.trim().toLowerCase();
    return all.filter((b) => {
      if (excludeId && b.id === excludeId) return false;
      if (b.title.trim().toLowerCase() !== normalized) return false;
      if (!primaryAuthor) return true;
      const existingAuthors = b.authors.map((a) => a.trim().toLowerCase());
      return existingAuthors.includes(primaryAuthor);
    });
  }

  /** Creates an archive entry plus its default status row. Returns the new id. */
  async createBook(input: {
    bookHash?: string | null;
    title: string;
    subtitle?: string | null;
    authors?: string[];
    translators?: string[];
    publisher?: string | null;
    publishYear?: number | null;
    pageCount?: number | null;
    isbn?: string | null;
    coverPath?: string | null;
    format?: ArchiveBook['format'];
    series?: string | null;
    fictionType?: ArchiveBook['fictionType'];
    description?: string | null;
    sourceUrl?: string | null;
    createdAt?: number;
  }): Promise<string> {
    const now = Date.now();
    const id = uuidv4();
    const authors = JSON.stringify(input.authors ?? []);
    const translators = JSON.stringify(input.translators ?? []);
    await this.withWrite(async () => {
      await this.db.execute(
        `INSERT INTO books (
           id, book_hash, title, subtitle, authors, translators, publisher, publish_year,
           page_count, isbn, cover_path, format, series, fiction_type, description,
           source_url, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.bookHash ?? null,
          input.title,
          input.subtitle ?? null,
          authors,
          translators,
          input.publisher ?? null,
          input.publishYear ?? null,
          input.pageCount ?? null,
          input.isbn ?? null,
          input.coverPath ?? null,
          input.format ?? 'ebook',
          input.series ?? null,
          input.fictionType ?? null,
          input.description ?? null,
          input.sourceUrl ?? null,
          input.createdAt ?? now,
          now,
        ],
      );
      await this.db.execute(
        `INSERT INTO reading_status (book_id, status, current_round, updated_at)
         VALUES (?, 'wish', 1, ?)`,
        [id, now],
      );
      if (input.bookHash) {
        await this.db.execute(
          `INSERT OR IGNORE INTO book_files (id, book_id, book_hash, format, added_at)
           VALUES (?, ?, ?, NULL, ?)`,
          [uuidv4(), id, input.bookHash, now],
        );
      }
    });
    return id;
  }

  /** Field patch for manual metadata editing (PRD A1). */
  async updateBookMetadata(
    id: string,
    patch: Partial<
      Pick<
        ArchiveBook,
        | 'title'
        | 'subtitle'
        | 'authors'
        | 'translators'
        | 'publisher'
        | 'publishYear'
        | 'pageCount'
        | 'isbn'
        | 'coverPath'
        | 'format'
        | 'series'
        | 'fictionType'
        | 'description'
        | 'rating'
        | 'sourceUrl'
      >
    >,
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    const assign = (column: string, value: unknown) => {
      sets.push(`${column} = ?`);
      values.push(value);
    };

    if ('title' in patch) assign('title', patch.title!);
    if ('subtitle' in patch) assign('subtitle', patch.subtitle ?? null);
    if ('authors' in patch) assign('authors', JSON.stringify(patch.authors ?? []));
    if ('translators' in patch) assign('translators', JSON.stringify(patch.translators ?? []));
    if ('publisher' in patch) assign('publisher', patch.publisher ?? null);
    if ('publishYear' in patch) assign('publish_year', patch.publishYear ?? null);
    if ('pageCount' in patch) assign('page_count', patch.pageCount ?? null);
    if ('isbn' in patch) assign('isbn', patch.isbn ?? null);
    if ('coverPath' in patch) assign('cover_path', patch.coverPath ?? null);
    if ('format' in patch) assign('format', patch.format ?? 'ebook');
    if ('series' in patch) assign('series', patch.series ?? null);
    if ('fictionType' in patch) assign('fiction_type', patch.fictionType ?? null);
    if ('description' in patch) assign('description', patch.description ?? null);
    if ('rating' in patch) assign('rating', patch.rating ?? null);
    if ('sourceUrl' in patch) assign('source_url', patch.sourceUrl ?? null);

    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(Date.now(), id);
    await this.db.execute(`UPDATE books SET ${sets.join(', ')} WHERE id = ?`, values);
  }

  /**
   * Deletes an archive entry. `deleteHistory=false` (default per PRD A1)
   * detaches instead of deleting when the entry carries sessions/notes — M2+
   * tables make that distinction real; today it always deletes the profile.
   */
  async deleteBook(id: string): Promise<void> {
    await this.withWrite(async () => {
      await this.db.execute('DELETE FROM book_tags WHERE book_id = ?', [id]);
      await this.db.execute('DELETE FROM reading_status WHERE book_id = ?', [id]);
      await this.db.execute('DELETE FROM reading_rounds WHERE book_id = ?', [id]);
      // No FK cascade in this engine (see ReedyDb note) — clean explicitly.
      await this.db.execute('DELETE FROM sessions WHERE book_id = ?', [id]);
      await this.db.execute('DELETE FROM book_files WHERE book_id = ?', [id]);
      await this.db.execute('DELETE FROM books WHERE id = ?', [id]);
    });
  }

  // --------------------------------------------------------------- status

  /**
   * Applies the five-state transition rules (PRD A4), keeping reading_status
   * and reading_rounds consistent.
   */
  async setStatus(id: string, target: ArchiveStatus, now: number = Date.now()): Promise<void> {
    const book = await this.getBook(id);
    if (!book) throw new Error(`archive: setStatus on missing book ${id}`);

    const current: StatusState = {
      status: book.status,
      currentRound: book.currentRound,
      startedAt: book.statusStartedAt,
      finishedAt: book.statusFinishedAt,
    };
    const t = applyStatusTransition(current, target, now);

    await this.withWrite(async () => {
      await this.db.execute(
        `INSERT INTO reading_status (book_id, status, current_round, started_at, finished_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(book_id) DO UPDATE SET
           status = excluded.status,
           current_round = excluded.current_round,
           started_at = excluded.started_at,
           finished_at = excluded.finished_at,
           updated_at = excluded.updated_at`,
        [id, t.status, t.currentRound, t.startedAt, t.finishedAt, now],
      );

      // Entering reading opens (or reuses) the current round row.
      if (t.roundAction === 'open') {
        await this.ensureRoundRow(id, t.currentRound, now);
      }
      // Finishing — including a direct wish → finished mark on an imported
      // book — must materialize the round row before closing it so round
      // numbering never skips (#1 exists even if it was never "reading").
      if (target === 'finished') {
        await this.ensureRoundRow(id, Math.max(1, book.currentRound), now);
        await this.closeOpenRound(id, Math.max(1, book.currentRound), now);
      }
    });
  }

  // --------------------------------------------------------------- rounds

  private async ensureRoundRow(bookId: string, roundNo: number, now: number): Promise<void> {
    await this.db.execute(
      `INSERT INTO reading_rounds (id, book_id, round_no, status, started_at, total_seconds)
       SELECT ?, ?, ?, 'reading', ?, 0
       WHERE NOT EXISTS (SELECT 1 FROM reading_rounds WHERE book_id = ? AND round_no = ?)`,
      [uuidv4(), bookId, roundNo, now, bookId, roundNo],
    );
  }

  private async closeOpenRound(bookId: string, roundNo: number, now: number): Promise<void> {
    await this.db.execute(
      `UPDATE reading_rounds SET status = 'finished', finished_at = ?
       WHERE book_id = ? AND round_no = ? AND status = 'reading'`,
      [now, bookId, roundNo],
    );
  }

  async listRounds(bookId: string): Promise<ArchiveRound[]> {
    const rows = await this.db.select<RoundRow>(
      `SELECT * FROM reading_rounds WHERE book_id = ? ORDER BY round_no ASC`,
      [bookId],
    );
    return rows.map((r) => ({
      id: r.id,
      bookId: r.book_id,
      roundNo: r.round_no,
      status: r.status === 'finished' || r.status === 'abandoned' ? r.status : 'reading',
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      totalSeconds: r.total_seconds,
      rating: r.rating,
      review: r.review,
    }));
  }

  /** Per-round rating/review (PRD B2); also mirrors rating onto the book row. */
  async updateRound(
    bookId: string,
    roundNo: number,
    patch: Partial<Pick<ArchiveRound, 'rating' | 'review'>>,
  ): Promise<void> {
    await this.ensureRoundRow(bookId, roundNo, Date.now());
    if ('rating' in patch) {
      await this.db.execute(
        `UPDATE reading_rounds SET rating = ? WHERE book_id = ? AND round_no = ?`,
        [patch.rating ?? null, bookId, roundNo],
      );
      await this.db.execute(`UPDATE books SET rating = ?, updated_at = ? WHERE id = ?`, [
        patch.rating ?? null,
        Date.now(),
        bookId,
      ]);
    }
    if ('review' in patch) {
      await this.db.execute(
        `UPDATE reading_rounds SET review = ? WHERE book_id = ? AND round_no = ?`,
        [patch.review ?? null, bookId, roundNo],
      );
    }
  }

  // -------------------------------------------------------------- sessions

  /** Opens a new session row (open=1). Callers resolve stale opens first. */
  async startSession(input: {
    bookId: string;
    roundNo: number;
    device?: string | null;
    startedAt: number;
    progressStart?: number | null;
  }): Promise<string> {
    const id = uuidv4();
    await this.db.execute(
      `INSERT INTO sessions (id, book_id, round_no, device, started_at, duration_sec, progress_start, note_count_delta, open)
       VALUES (?, ?, ?, ?, ?, 0, ?, 0, 1)`,
      [
        id,
        input.bookId,
        input.roundNo,
        input.device ?? null,
        input.startedAt,
        input.progressStart ?? null,
      ],
    );
    return id;
  }

  /** Periodic crash-safety checkpoint (PRD B1: ≥60s interval, ≤60s loss). */
  async checkpointSession(
    id: string,
    data: { endedAt: number; durationSec: number; progressEnd?: number | null },
  ): Promise<void> {
    await this.db.execute(
      `UPDATE sessions SET ended_at = ?, duration_sec = ?,
        progress_end = COALESCE(?, progress_end)
       WHERE id = ? AND open = 1`,
      [data.endedAt, Math.max(0, Math.round(data.durationSec)), data.progressEnd ?? null, id],
    );
  }

  /** Finalizes a session and re-computes the round's accumulated time. */
  async finishSession(
    id: string,
    data: {
      endedAt: number;
      durationSec: number;
      progressEnd?: number | null;
      pagesRead?: number | null;
      noteCountDelta?: number;
    },
  ): Promise<void> {
    const duration = Math.max(0, Math.round(data.durationSec));
    await this.db.execute(
      `UPDATE sessions SET ended_at = ?, duration_sec = ?, progress_end = COALESCE(?, progress_end),
        pages_read = COALESCE(?, pages_read), note_count_delta = ?, open = 0
       WHERE id = ?`,
      [
        data.endedAt,
        duration,
        data.progressEnd ?? null,
        data.pagesRead ?? null,
        data.noteCountDelta ?? 0,
        id,
      ],
    );
    await this.refreshRoundTotalsForSession(id);
  }

  private async recomputeRoundTotal(bookId: string, roundNo: number): Promise<void> {
    await this.db.execute(
      `UPDATE reading_rounds SET total_seconds = (
         SELECT COALESCE(SUM(duration_sec), 0) FROM sessions
         WHERE book_id = ? AND round_no = ? AND open = 0
       )
       WHERE book_id = ? AND round_no = ?`,
      [bookId, roundNo, bookId, roundNo],
    );
  }

  private async refreshRoundTotalsForSession(sessionId: string): Promise<void> {
    const rows = await this.db.select<{ book_id: string; round_no: number }>(
      `SELECT book_id, round_no FROM sessions WHERE id = ?`,
      [sessionId],
    );
    if (rows[0]) {
      await this.recomputeRoundTotal(rows[0].book_id, rows[0].round_no);
    }
  }

  /** Backfills progress_start once the first real position is known. */
  async attachSessionProgress(id: string, fraction: number): Promise<void> {
    await this.db.execute(
      `UPDATE sessions SET progress_start = ? WHERE id = ? AND progress_start IS NULL`,
      [fraction, id],
    );
  }

  async listOpenSessions(bookId?: string): Promise<SessionRecord[]> {
    const rows = await this.db.select<SessionRow>(
      bookId
        ? `SELECT * FROM sessions WHERE open = 1 AND book_id = ? ORDER BY started_at ASC`
        : `SELECT * FROM sessions WHERE open = 1 ORDER BY started_at ASC`,
      bookId ? [bookId] : [],
    );
    return rows.map(mapSession);
  }

  /** Manual correction (PRD B1): drop a junk session entirely. */
  async deleteSession(id: string): Promise<void> {
    const coords = await this.db.select<{ book_id: string; round_no: number }>(
      `SELECT book_id, round_no FROM sessions WHERE id = ?`,
      [id],
    );
    await this.db.execute(`DELETE FROM sessions WHERE id = ?`, [id]);
    // The session row is gone now, so recompute from the captured coordinates.
    if (coords[0]) {
      await this.recomputeRoundTotal(coords[0].book_id, coords[0].round_no);
    }
  }

  /** Manual correction (PRD B1): edit a wrong duration. */
  async updateSessionDuration(id: string, durationSec: number): Promise<void> {
    await this.db.execute(`UPDATE sessions SET duration_sec = ? WHERE id = ?`, [
      Math.max(0, Math.round(durationSec)),
      id,
    ]);
    await this.refreshRoundTotalsForSession(id);
  }

  async listSessionsInRange(startMs: number, endMs: number): Promise<SessionWithBook[]> {
    const rows = await this.db.select<SessionRow & { title: string; book_hash: string | null }>(
      `SELECT se.*, b.title AS title, b.book_hash AS book_hash
       FROM sessions se JOIN books b ON b.id = se.book_id
       WHERE se.started_at >= ? AND se.started_at < ? AND se.open = 0
       ORDER BY se.started_at ASC`,
      [startMs, endMs],
    );
    return rows.map((r) => ({ ...mapSession(r), title: r.title, bookHash: r.book_hash }));
  }

  /** Aggregated net seconds read within [startMs, endMs). */
  async sumSecondsInRange(startMs: number, endMs: number): Promise<number> {
    const rows = await this.db.select<{ total: number }>(
      `SELECT COALESCE(SUM(duration_sec), 0) AS total FROM sessions
       WHERE started_at >= ? AND started_at < ? AND open = 0`,
      [startMs, endMs],
    );
    return rows[0]?.total ?? 0;
  }

  // ----------------------------------------------------------------- tags

  async listTags(): Promise<ArchiveTag[]> {
    const rows = await this.db.select<{ id: string; name: string; color: string | null }>(
      `SELECT id, name, color FROM tags ORDER BY name COLLATE NOCASE ASC`,
    );
    return rows;
  }

  /** Gets-or-creates a tag by (case-insensitive) name. */
  async ensureTag(name: string, color?: string | null): Promise<ArchiveTag> {
    const trimmed = name.trim();
    const existing = await this.db.select<{ id: string; name: string; color: string | null }>(
      `SELECT id, name, color FROM tags WHERE name = ? COLLATE NOCASE LIMIT 1`,
      [trimmed],
    );
    if (existing[0]) return existing[0];
    const id = uuidv4();
    await this.db.execute(`INSERT INTO tags (id, name, color) VALUES (?, ?, ?)`, [
      id,
      trimmed,
      color ?? null,
    ]);
    return { id, name: trimmed, color: color ?? null };
  }

  /**
   * Renames a tag. Rejects case-insensitive collisions: tags.name is UNIQUE
   * with BINARY collation but lookups are NOCASE, so allowing 'douban' →
   * 'DOUBAN' would create two rows indistinguishable to every query.
   */
  async renameTag(tagId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    const clash = await this.db.select<{ id: string }>(
      `SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id != ? LIMIT 1`,
      [trimmed, tagId],
    );
    if (clash[0]) {
      throw new Error(`archive: tag name "${trimmed}" already exists`);
    }
    await this.db.execute(`UPDATE tags SET name = ? WHERE id = ?`, [trimmed, tagId]);
  }

  /** Merges `fromTagId` into `intoTagId`, then deletes the absorbed tag. */
  async mergeTags(fromTagId: string, intoTagId: string): Promise<void> {
    await this.withWrite(async () => {
      const rows = await this.db.select<{ book_id: string }>(
        `SELECT book_id FROM book_tags WHERE tag_id = ? AND book_id NOT IN (
           SELECT book_id FROM book_tags WHERE tag_id = ?
         )`,
        [fromTagId, intoTagId],
      );
      for (const row of rows) {
        await this.db.execute(`INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)`, [
          row.book_id,
          intoTagId,
        ]);
      }
      await this.db.execute(`DELETE FROM book_tags WHERE tag_id = ?`, [fromTagId]);
      await this.db.execute(`DELETE FROM tags WHERE id = ?`, [fromTagId]);
    });
  }

  async deleteTag(tagId: string): Promise<void> {
    await this.withWrite(async () => {
      await this.db.execute(`DELETE FROM book_tags WHERE tag_id = ?`, [tagId]);
      await this.db.execute(`DELETE FROM tags WHERE id = ?`, [tagId]);
    });
  }

  /** Replaces the tag set of one book (detail-page tag editor). */
  async setBookTags(bookId: string, tagNames: string[]): Promise<void> {
    const byName: Record<string, string> = {};
    for (const raw of tagNames) {
      const name = raw.trim();
      if (name) byName[name] = name;
    }
    const trimmed = Object.values(byName);
    await this.withWrite(async () => {
      await this.db.execute(`DELETE FROM book_tags WHERE book_id = ?`, [bookId]);
      for (const name of trimmed) {
        const tag = await this.ensureTag(name);
        await this.db.execute(`INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)`, [
          bookId,
          tag.id,
        ]);
      }
    });
  }

  async listBookTagNames(bookId: string): Promise<string[]> {
    const rows = await this.db.select<{ name: string }>(
      `SELECT t.name FROM tags t JOIN book_tags bt ON bt.tag_id = t.id
       WHERE bt.book_id = ? ORDER BY t.name COLLATE NOCASE ASC`,
      [bookId],
    );
    return rows.map((r) => r.name);
  }
}

/** @internal Drops the memoized open promise. Test hook only. */
export function resetArchiveDbForTests(): void {
  sharedOpen = null;
}
