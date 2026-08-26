'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';

import type { TOCItem } from '@/libs/document';
import { findTocItemBS } from '@/services/nav';
import type { Book } from '@/types/book';

import { ArchiveBook } from '../types';
import { ArchiveDb, ArchiveNote } from '../db/archiveDb';
import { askAI, AI_DISABLED_HINT, AI_ERROR_HINT, isAIEnabled } from './client';
import { chapterOutline, parseOutlineLines } from './prompts';

/** Depth-first flattening preserving TOC order. */
function flattenToc(items: TOCItem[]): TOCItem[] {
  return items.flatMap((item) => [item, ...flattenToc(item.subitems ?? [])]);
}

/**
 * Chapter outline panel (PRD I 大纲 + 剧透门控): AI-generated one-line
 * teasers cached as thoughts tagged ['大纲','AI']. Spoiler gate — a chapter
 * unlocks once the reader reaches it: finished books unlock everything;
 * otherwise only chapters at/before the current TOC position (default:
 * the first chapter when no reading position is known).
 *
 * The reader passes `currentCfi` later; the detail page omits it today.
 */
const ChapterOutlinePanel: React.FC<{ book: ArchiveBook; currentCfi?: string | null }> = ({
  book,
  currentCfi = null,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const settings = useSettingsStore((state) => state.settings);

  const [entries, setEntries] = useState<ArchiveNote[] | null>(null);
  const [toc, setToc] = useState<TOCItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!appService) return;
    try {
      const db = await ArchiveDb.open(appService);
      const thoughts = await db.listThoughts(book.id);
      setEntries(thoughts.filter((t) => t.tags.includes('大纲')));
    } catch (err) {
      console.warn('archive: failed to load outline cache', err);
      setEntries([]);
    }
  }, [appService, book.id]);

  useEffect(() => {
    void reload();
    if (!appService || !book.bookHash) return;
    // Best-effort: gate degrades gracefully when the nav cache is absent.
    appService
      .loadBookNav({
        hash: book.bookHash,
        title: book.title,
        format: 'EPUB',
        author: '',
        createdAt: 0,
        updatedAt: 0,
      } as Book)
      .then((nav) => setToc(nav?.toc ?? []))
      .catch(() => setToc(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService, book.id]);

  const flat = useMemo(() => (toc ? flattenToc(toc) : null), [toc]);

  /** Flattened index of the furthest unlocked chapter (0 without a position). */
  const currentIndex = useMemo(() => {
    if (!flat || !currentCfi) return 0;
    const item = findTocItemBS(toc ?? [], currentCfi);
    if (!item) return 0;
    const idx = flat.findIndex((f) => f.href === item.href && f.label === item.label);
    return idx >= 0 ? idx : 0;
  }, [flat, toc, currentCfi]);

  const flatIndexOf = useCallback(
    (entry: ArchiveNote, order: number): number | null => {
      if (!flat) return null;
      if (entry.cfi) {
        const idx = flat.findIndex((item) => item.cfi === entry.cfi);
        if (idx >= 0) return idx;
      }
      return order < flat.length ? order : null;
    },
    [flat],
  );

  const generate = async () => {
    if (!appService) return;
    if (!isAIEnabled(settings)) {
      setError(_(AI_DISABLED_HINT));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const nav = await appService.loadBookNav({
        hash: book.bookHash ?? '',
        title: book.title,
        format: 'EPUB',
        author: '',
        createdAt: 0,
        updatedAt: 0,
      } as Book);
      const items = flattenToc(nav?.toc ?? []);
      if (items.length === 0) {
        setError(_('No table of contents found for this book.'));
        return;
      }
      const answer = await askAI(
        settings,
        chapterOutline({
          title: book.title,
          authors: book.authors,
          description: book.description,
          chapters: items.map((item) => item.label),
        }),
      );
      const lines = parseOutlineLines(answer);
      const db = await ArchiveDb.open(appService);
      for (let i = 0; i < Math.min(items.length, lines.length); i++) {
        await db.createThought({
          bookId: book.id,
          roundNo: book.currentRound,
          cfi: items[i]!.cfi ?? null,
          chapterTitle: items[i]!.label,
          content: lines[i]!,
          tags: ['大纲', 'AI'],
        });
      }
      await reload();
    } catch (err) {
      console.warn('archive: outline generation failed', err);
      setError(_(AI_ERROR_HINT));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className='space-y-2 px-4 pt-4'>
      <div className='flex items-center gap-2'>
        <h2 className='text-sm font-semibold text-base-content/70'>{_('Chapter outline')}</h2>
        {entries !== null && entries.length === 0 && (
          <button
            className={clsx('btn btn-xs rounded-full', !busy && 'btn-primary')}
            disabled={busy}
            onClick={() => void generate()}
          >
            {busy ? _('Thinking…') : _('Generate outline')}
          </button>
        )}
      </div>
      {error && <p className='text-xs text-error'>{error}</p>}
      {entries === null ? null : entries.length === 0 ? (
        <p className='text-xs text-base-content/50'>
          {_(
            'Generate spoiler-free teasers for each chapter. Chapters you have read stay visible.',
          )}
        </p>
      ) : (
        <ul className='space-y-1.5'>
          {entries.map((entry, order) => {
            const entryIdx = flatIndexOf(entry, order);
            const locked =
              book.status !== 'finished' && entryIdx !== null && entryIdx > currentIndex;
            return (
              <li key={entry.id} className='rounded-xl bg-base-200/60 px-3 py-2 text-sm'>
                {locked ? (
                  <p className='text-xs text-base-content/40'>
                    🔒{' '}
                    {_('Chapter {{index}} · keep reading to unlock', {
                      index: (entryIdx ?? order) + 1,
                    })}
                  </p>
                ) : (
                  <>
                    {entry.chapterTitle && (
                      <p className='text-[11px] font-semibold text-base-content/60'>
                        {entry.chapterTitle}
                      </p>
                    )}
                    <p>{entry.content}</p>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default ChapterOutlinePanel;
