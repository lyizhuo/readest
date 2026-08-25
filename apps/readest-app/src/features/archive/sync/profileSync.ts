import { Book } from '@/types/book';
import type { AppService } from '@/types/system';

import { ArchiveBook } from '../types';
import { ArchiveDb } from '../db/archiveDb';

/**
 * Module A1 — automatic profile creation.
 *
 * Every non-deleted library book gets an archive.db entry keyed by
 * Book.hash. Creation-only: later upstream metadata edits never clobber
 * user edits made on the archive side (the archive row is authoritative
 * once created). Runs are idempotent and cheap (one indexed lookup per
 * book), so callers may invoke it after every library load.
 */
export interface ProfileSyncResult {
  created: number;
  skipped: number;
}

function splitContributors(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;、]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function bookToProfileInput(book: Book): Parameters<ArchiveDb['createBook']>[0] {
  const meta = book.metadata;
  const publishedYear = (() => {
    if (!meta?.published) return null;
    const match = /\d{4}/.exec(String(meta.published));
    return match ? Number(match[0]) : null;
  })();

  return {
    bookHash: book.hash,
    title: book.title || book.sourceTitle || 'Untitled',
    subtitle: typeof meta?.subtitle === 'string' ? meta.subtitle : null,
    authors: splitContributors(book.author),
    publisher: meta?.publisher ?? null,
    publishYear: publishedYear,
    isbn: meta?.isbn ?? null,
    coverPath: `${book.hash}/cover.png`,
    format: 'ebook',
    series: typeof meta?.series === 'string' ? meta.series : null,
    description: typeof meta?.description === 'string' ? meta.description : null,
    createdAt: book.createdAt,
  };
}

/** Maps the upstream four-state shelf status onto the archive five-state one. */
export function mapUpstreamReadingStatus(
  book: Book,
): 'wish' | 'reading' | 'finished' | 'abandoned' {
  switch (book.readingStatus) {
    case 'reading':
      return 'reading';
    case 'finished':
      return 'finished';
    case 'abandoned':
      return 'abandoned';
    default:
      return 'wish';
  }
}

/**
 * Ensures every library book has an archive entry. Never throws into the
 * caller — a failed archive sync must not break the library surface
 * (PRD 0.4: closing the module restores exact upstream behavior).
 */
export async function ensureArchiveEntries(
  appService: AppService,
  books: Book[],
): Promise<ProfileSyncResult> {
  let created = 0;
  let skipped = 0;
  try {
    const db = await ArchiveDb.open(appService);
    for (const book of books) {
      if (book.deletedAt) continue;
      const existing = await db.getBookByHash(book.hash);
      if (existing) {
        skipped++;
        continue;
      }
      const input = bookToProfileInput(book);
      const id = await db.createBook(input);
      // Seed the five-state status from whatever the shelf already knew.
      await db.setStatus(id, mapUpstreamReadingStatus(book));
      created++;
    }
  } catch (error) {
    console.warn('archive: profile sync failed', error);
  }
  return { created, skipped };
}

export type { ArchiveBook };
