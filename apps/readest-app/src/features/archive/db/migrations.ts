import { MigrationEntry } from '@/services/database/migrate';

/**
 * archive.db schema migrations. Append-only: never reorder or edit an
 * applied entry — add a new dated entry instead (see services/database/migrate.ts).
 */
export const ARCHIVE_MIGRATIONS: MigrationEntry[] = [
  {
    name: '2026082601_archive_initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY,
        book_hash TEXT UNIQUE,
        title TEXT NOT NULL,
        subtitle TEXT,
        authors TEXT NOT NULL DEFAULT '[]',
        translators TEXT NOT NULL DEFAULT '[]',
        publisher TEXT,
        publish_year INTEGER,
        page_count INTEGER,
        isbn TEXT,
        cover_path TEXT,
        format TEXT NOT NULL DEFAULT 'ebook',
        series TEXT,
        fiction_type TEXT,
        description TEXT,
        rating INTEGER,
        source_url TEXT,
        progress_unit TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);

      -- Additional file editions of the same work (different translations /
      -- versions). The primary edition lives on books.book_hash.
      CREATE TABLE IF NOT EXISTS book_files (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        book_hash TEXT NOT NULL UNIQUE,
        format TEXT,
        added_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reading_status (
        book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'wish',
        current_round INTEGER NOT NULL DEFAULT 1,
        started_at INTEGER,
        finished_at INTEGER,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reading_status_status ON reading_status(status);

      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT
      );

      CREATE TABLE IF NOT EXISTS book_tags (
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (book_id, tag_id)
      );

      CREATE TABLE IF NOT EXISTS reading_rounds (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        round_no INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'reading',
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        total_seconds INTEGER NOT NULL DEFAULT 0,
        rating INTEGER,
        review TEXT,
        UNIQUE (book_id, round_no)
      );
    `,
  },
  {
    name: '2026082602_archive_sessions',
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        round_no INTEGER NOT NULL DEFAULT 1,
        device TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        duration_sec INTEGER NOT NULL DEFAULT 0,
        progress_start REAL,
        progress_end REAL,
        pages_read INTEGER,
        note_count_delta INTEGER NOT NULL DEFAULT 0,
        open INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_book_start ON sessions(book_id, started_at);

      CREATE INDEX IF NOT EXISTS idx_sessions_start ON sessions(started_at);

      CREATE INDEX IF NOT EXISTS idx_sessions_open ON sessions(open);
    `,
  },
];
