import type { AppService } from '@/types/system';
import type { SystemSettings } from '@/types/settings';
import { ArchiveDb } from '../db/archiveDb';
import { loadExcerpts } from '../notes/excerptAccess';
import { parseArchiveJson } from './exporters';
import { buildJson, buildMarkdown, buildTxt, ExportBundle, ExportNote } from './exporters';

export type ExportScope =
  | { kind: 'book'; bookId: string; roundFilter: 'current' | 'all' }
  | { kind: 'tag'; tag: string; roundFilter: 'all' };

export type ExportFormat = 'markdown' | 'json' | 'txt';

/**
 * Gathers the six-layer bundle (PRD E2) for one archive book and renders it.
 * Excerpts come live from upstream config.json (single source of truth);
 * thoughts come from archive.db. Round filtering: thoughts carry round_no;
 * excerpts are attributed by createdAt falling inside the round window.
 */
export async function exportBook(
  appService: AppService,
  settings: SystemSettings,
  bookId: string,
  roundFilter: 'current' | 'all',
  format: ExportFormat,
  templateMd: string,
): Promise<{ filename: string; content: string } | null> {
  const db = await ArchiveDb.open(appService);
  const book = await db.getBook(bookId);
  if (!book) return null;

  const [rounds, thoughts, tagNames] = await Promise.all([
    db.listRounds(bookId),
    db.listThoughts(bookId),
    db.listBookTagNames(bookId),
  ]);

  const excerpts = book.bookHash
    ? await loadExcerpts(appService, settings, {
        hash: book.bookHash,
        title: book.title,
      }).catch(() => [])
    : [];

  const currentRoundNo = book.currentRound;
  const inRoundWindow = (
    createdAt: number,
    startedAt: number,
    finishedAt: number | null,
  ): boolean => createdAt >= startedAt && createdAt <= (finishedAt ?? Date.now());

  // Excerpts carry no explicit round — infer from which round window the
  // highlight timestamp falls into (PRD E2/L4 轮次号).
  const roundForTimestamp = (createdAt: number): number => {
    const hit = rounds.find((r) => inRoundWindow(createdAt, r.startedAt, r.finishedAt));
    return hit?.roundNo ?? currentRoundNo;
  };

  const notes: ExportNote[] = [
    ...excerpts
      .filter(
        (excerpt) =>
          !excerpt.deletedAt &&
          (roundFilter === 'all' ||
            inRoundWindow(
              excerpt.createdAt,
              rounds.find((r) => r.roundNo === currentRoundNo)?.startedAt ?? 0,
              rounds.find((r) => r.roundNo === currentRoundNo)?.finishedAt ?? null,
            )) &&
          (excerpt.text || excerpt.note),
      )
      .map((excerpt) => ({
        id: excerpt.id,
        kind: 'excerpt' as const,
        roundNo: roundForTimestamp(excerpt.createdAt),
        text: excerpt.text ?? '',
        note: excerpt.note || null,
        cfi: excerpt.cfi ?? null,
        chapter: excerpt.chapterPath ?? null,
        page: excerpt.page ?? null,
        progress: null,
        color: excerpt.color ?? null,
        tags: [],
        attachments: [],
        createdAt: excerpt.createdAt,
      })),
    ...thoughts
      .filter((thought) => roundFilter === 'all' || thought.roundNo === currentRoundNo)
      .map((thought) => ({
        id: thought.id,
        kind: 'thought' as const,
        roundNo: thought.roundNo,
        text: thought.content,
        note: null,
        cfi: thought.cfi,
        chapter: thought.chapterTitle,
        page: thought.page,
        progress: thought.progress,
        color: null,
        tags: thought.tags,
        attachments: thought.attachments,
        createdAt: thought.createdAt,
      })),
  ].sort((a, b) => a.createdAt - b.createdAt);

  const bundle: ExportBundle = {
    book: {
      bookHash: book.bookHash,
      title: book.title,
      subtitle: book.subtitle,
      authors: book.authors,
      translators: book.translators,
      publisher: book.publisher,
      publishYear: book.publishYear,
      pageCount: book.pageCount,
      isbn: book.isbn,
      format: book.format,
      series: book.series,
      fictionType: book.fictionType,
      description: book.description,
      rating: book.rating,
      status: book.status,
      currentRound: book.currentRound,
      tags: tagNames,
    },
    rounds: rounds.map((r) => ({
      roundNo: r.roundNo,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      totalSeconds: r.totalSeconds,
      rating: r.rating,
      review: r.review,
    })),
    notes,
  };

  const safeTitle = book.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  const suffix = roundFilter === 'current' ? `第${book.currentRound}轮` : '全部';
  switch (format) {
    case 'markdown':
      return {
        filename: `${safeTitle}-${suffix}.md`,
        content: buildMarkdown(bundle, templateMd),
      };
    case 'json':
      return { filename: `${safeTitle}-${suffix}.json`, content: buildJson(bundle) };
    case 'txt':
      return { filename: `${safeTitle}-${suffix}.txt`, content: buildTxt(bundle) };
  }
}

/** Downloads generated content via a blob link. */
export function downloadContent(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Round-trip import (PRD E4): re-attaches exported JSON to its book by hash
 * and upserts every thought by stable id.
 */
export async function importArchiveJson(appService: AppService, raw: string): Promise<number> {
  const parsed = parseArchiveJson(raw);
  const db = await ArchiveDb.open(appService);

  let imported = 0;
  for (const note of parsed.notes ?? []) {
    if (note.kind !== 'thought') continue; // excerpts are upstream-owned
    const bookHash = parsed.book?.bookHash ?? null;
    if (!bookHash) continue;
    const book = await db.getBookByHash(bookHash);
    if (!book) continue;
    // LWW semantics (PRD H v1): never let a re-import clobber newer local
    // edits or resurrect locally deleted thoughts.
    await db.upsertThoughtFromImport({
      id: note.id,
      bookId: book.id,
      roundNo: note.roundNo ?? book.currentRound,
      parentNoteId: null,
      cfi: note.cfi,
      chapterTitle: note.chapter,
      page: note.page,
      progress: note.progress,
      content: note.text,
      attachments: note.attachments ?? [],
      tags: note.tags ?? [],
      createdAt: note.createdAt,
      updatedAt: Math.max(note.createdAt, Date.now()),
      deletedAt: null,
    });
    imported++;
  }
  return imported;
}
