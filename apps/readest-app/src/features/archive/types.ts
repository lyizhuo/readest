/**
 * Reading-archive domain types (fork feature).
 *
 * All persistence lives in archive.db (SQLite via AppService.openDatabase);
 * these types are the TS projections of those rows. Timestamps are epoch
 * milliseconds like the rest of the app.
 */

/** Five-state reading lifecycle from the PRD (supersedes upstream 4-state). */
export type ArchiveStatus = 'wish' | 'reading' | 'finished' | 'abandoned' | 'paused';

/** One re-read pass over a book. Notes/sessions/rating hang off rounds. */
export interface ArchiveRound {
  id: string;
  bookId: string;
  roundNo: number;
  status: 'reading' | 'finished' | 'abandoned';
  startedAt: number;
  finishedAt: number | null;
  /** Exact accumulated net seconds across sessions of this round. */
  totalSeconds: number;
  rating: number | null;
  review: string | null;
}

export interface ArchiveBook {
  id: string;
  /** Upstream Book.hash of the primary file edition; null for paper/audio-only entries. */
  bookHash: string | null;
  title: string;
  subtitle: string | null;
  /** JSON array of author names. */
  authors: string[];
  /** JSON array of translator names. */
  translators: string[];
  publisher: string | null;
  publishYear: number | null;
  pageCount: number | null;
  isbn: string | null;
  coverPath: string | null;
  format: 'paper' | 'ebook' | 'audio';
  series: string | null;
  fictionType: 'fiction' | 'nonfiction' | null;
  description: string | null;
  rating: number | null;
  sourceUrl: string | null;
  createdAt: number;
  updatedAt: number;

  /** Joined from reading_status. */
  status: ArchiveStatus;
  currentRound: number;
  statusStartedAt: number | null;
  statusFinishedAt: number | null;
}

export interface ArchiveTag {
  id: string;
  name: string;
  color: string | null;
}

export interface ArchiveBookFile {
  id: string;
  bookId: string;
  /** Upstream Book.hash of an edition linked to this archive entry. */
  bookHash: string;
  format: string | null;
  addedAt: number;
}

export const ARCHIVE_STATUSES: ArchiveStatus[] = [
  'wish',
  'reading',
  'finished',
  'abandoned',
  'paused',
];

export const ARCHIVE_STATUS_KEYS: Record<ArchiveStatus, string> = {
  wish: 'Wishlist',
  reading: 'Reading',
  finished: 'Finished',
  abandoned: 'Abandoned',
  paused: 'Paused',
};
