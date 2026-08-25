import type { AppService } from '@/types/system';
import type { SystemSettings } from '@/types/settings';
import type { Book, BookConfig, BookNote } from '@/types/book';
import type { BookNav } from '@/services/nav';
import { findParentPath, findTocItemBS } from '@/services/nav/lookup';

/**
 * Excerpt access layer (PRD D1/D4): excerpts stay owned by upstream
 * config.json booknotes; this module reads them on demand and enriches with
 * archive-side context. No duplication of note data.
 */

/** Full TOC path for a CFI, e.g. "第二部 › 第 5 章 › 5.2" (PRD E2/L2). */
export function tocPathForCfi(toc: BookNav['toc'], cfi: string): string | null {
  const item = findTocItemBS(toc, cfi);
  if (!item) return null;
  const parents = findParentPath(toc, item.href);
  const chain = parents.length > 0 ? parents : [item];
  const labels = chain.map((t) => t.label).filter(Boolean);
  return labels.length > 0 ? labels.join(' › ') : null;
}

/** Minimal Book identity accepted by loadBookConfig / loadBookNav. */
function bookRef(hash: string, title: string): Book {
  return {
    hash,
    title,
    format: 'EPUB',
    author: '',
    createdAt: 0,
    updatedAt: 0,
  } as Book;
}

/** Loads all upstream annotations for a book, enriched with chapter paths. */
export async function loadExcerpts(
  appService: AppService,
  settings: SystemSettings,
  book: { hash: string; title: string },
): Promise<ExcerptWithChapter[]> {
  const config: BookConfig = await appService.loadBookConfig(
    bookRef(book.hash, book.title),
    settings,
  );
  const notes = config.booknotes ?? [];
  if (notes.length === 0) return [];

  let toc: BookNav['toc'] | undefined;
  try {
    const nav = await appService.loadBookNav(bookRef(book.hash, book.title));
    toc = nav?.toc;
  } catch {
    // nav cache missing — chapter path stays null rather than failing.
  }

  return notes.map((note) => ({
    ...note,
    chapterPath: toc && note.cfi ? (tocPathForCfi(toc, note.cfi) ?? null) : null,
  }));
}

export interface ExcerptWithChapter extends BookNote {
  /** Complete TOC path of the highlight location (PRD E2 L2-Should). */
  chapterPath: string | null;
}
