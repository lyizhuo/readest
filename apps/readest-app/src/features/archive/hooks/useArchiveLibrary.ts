'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';

import { ArchiveBook, ArchiveTag } from '../types';
import { ArchiveDb } from '../db/archiveDb';
import { ensureArchiveEntries } from '../sync/profileSync';

/**
 * Loads archive entries joined with upstream covers and exposes mutations.
 * Also performs the A1 auto-profiling pass on every load so freshly imported
 * books appear without a dedicated import hook.
 */
export function useArchiveLibrary() {
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const libraryBooks = useLibraryStore((state) => state.library);
  const getBookByHash = useLibraryStore((state) => state.getBookByHash);

  const [books, setBooks] = useState<ArchiveBook[]>([]);
  const [tags, setTags] = useState<ArchiveTag[]>([]);
  const [loaded, setLoaded] = useState(false);
  const seqRef = useRef(0);

  const enabled = settings.archive?.enabled !== false;

  const refresh = useCallback(async () => {
    if (!appService || !enabled) return;
    const seq = ++seqRef.current;
    await ensureArchiveEntries(
      appService,
      libraryBooks.filter((b) => !b.deletedAt),
    );
    const db = await ArchiveDb.open(appService);
    const [nextBooks, nextTags] = await Promise.all([db.listBooks(), db.listTags()]);
    if (seq !== seqRef.current) return;
    setBooks(nextBooks);
    setTags(nextTags);
    setLoaded(true);
  }, [appService, enabled, libraryBooks]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Cover URL from the upstream library record (already resolved by loadLibraryBooks). */
  const getCoverUrl = useCallback(
    (bookHash: string | null): string | undefined =>
      bookHash ? (getBookByHash(bookHash)?.coverImageUrl ?? undefined) : undefined,
    [getBookByHash],
  );

  return { appService, enabled, loaded, books, tags, refresh, getCoverUrl };
}
