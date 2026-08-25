'use client';

import { useEffect, useRef } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { getBookProgress } from '@/store/readerProgressStore';
import { FIXED_LAYOUT_FORMATS } from '@/types/book';

import { SESSION_IDLE_PAUSE_SEC, useArchiveSessionStore } from '../store/sessionStore';
import { ArchiveDb } from '../db/archiveDb';

/**
 * Reader-side session tracker (PRD B1/C1): auto-starts a session when a
 * book opens, keeps the idle clock fed by page turns, checkpoints every
 * minute, and finalizes on unmount or in-place book switch. Entirely inert
 * when the archive module is disabled or the book has no archive profile.
 */
export function useArchiveSession(bookKey: string, bookHash: string | undefined): void {
  const { appService } = useEnv();
  const archiveEnabled = useSettingsStore(
    (state) => (state.settings.archive?.enabled ?? true) === true,
  );

  // Bind once per app run so the store can persist without React context.
  useEffect(() => {
    useArchiveSessionStore.getState().bindAppService(appService ?? null);
  }, [appService]);

  // Which hash currently owns the tracked session (per-book, not one-shot).
  const startedHashRef = useRef<string | null>(null);
  // Latest key/flag for the mount-time cleanup closure.
  const latestRef = useRef({ bookKey, archiveEnabled });
  latestRef.current = { bookKey, archiveEnabled };

  useEffect(() => {
    if (!archiveEnabled || !appService || !bookHash) return;
    if (startedHashRef.current === bookHash) return;

    const previousHash = startedHashRef.current;
    startedHashRef.current = bookHash;

    void (async () => {
      const store = useArchiveSessionStore.getState();
      // In-place book switch: finalize the previous book's session first so
      // reading time never accrues across books.
      if (previousHash && store.active && store.active.bookHash !== bookHash) {
        await store.finish({
          fraction: getBookProgress(latestRef.current.bookKey)?.fraction ?? null,
        });
      }

      const db = await ArchiveDb.open(appService).catch(() => null);
      if (!db) return;
      const profile = await db.getBookByHash(bookHash).catch(() => null);
      if (!profile) return;
      const fresh = useArchiveSessionStore.getState().active;
      if (fresh && fresh.bookHash !== bookHash) return; // raced — leave it
      await useArchiveSessionStore.getState().startForBook({
        bookId: profile.id,
        bookHash,
        title: profile.title,
        fraction: getBookProgress(bookKey)?.fraction ?? null,
        startPage: getCurrentPage(bookKey),
      });
    })();
  }, [archiveEnabled, appService, bookHash]);

  // Feed the idle clock on every relocate/progress event; also enrich
  // progress_start lazily — at auto-start time the view has not reported any
  // position yet, so the first relocate is the real starting point.
  const lastProgressLocRef = useRef<string | null>(null);
  useEffect(() => {
    if (!archiveEnabled) return;
    const progress = getBookProgress(bookKey);
    const loc = progress?.location ?? null;
    if (loc && loc !== lastProgressLocRef.current) {
      lastProgressLocRef.current = loc;
      const store = useArchiveSessionStore.getState();
      store.notifyActivity();
      if (store.active && store.active.bookHash === bookHash) {
        void store.attachProgress(progress?.fraction ?? null, getCurrentPage(bookKey));
      }
    }
  });

  // Background/lock: stop the clock; the next page turn resumes seamlessly.
  useEffect(() => {
    if (!archiveEnabled) return;
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      const store = useArchiveSessionStore.getState();
      if (store.active && store.active.lastResumeAt !== null) {
        void store.pauseAuto();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveEnabled]);

  // Finalize on unmount (reader window/page closing).
  useEffect(() => {
    return () => {
      const { bookKey: key, archiveEnabled: enabled } = latestRef.current;
      if (!enabled) return;
      const { active } = useArchiveSessionStore.getState();
      if (!active) return;
      void useArchiveSessionStore.getState().finish({
        fraction: getBookProgress(key)?.fraction ?? null,
        pagesRead: pagesBetween(getCurrentPage(key), active.startPage),
        noteCountDelta: countNotesCreatedBetween(key, active.startedAt, Date.now()),
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Pages read this session, only meaningful for fixed-layout (page-unit) books. */
function pagesBetween(endPage: number | null, startPage: number | null): number | null {
  if (endPage === null || startPage === null) return null;
  return Math.abs(endPage - startPage);
}

function getBookData(bookKey: string) {
  return useBookDataStore.getState().getBookData(bookKey);
}

function getCurrentPage(bookKey: string): number | null {
  const data = getBookData(bookKey);
  const format = data?.book?.format;
  if (!format || !FIXED_LAYOUT_FORMATS.has(format)) return null;
  const progress = data?.config?.progress;
  return progress ? progress[0] : null;
}

/** Notes created during [startedAt, endedAt] for this book (PRD B1 field). */
function countNotesCreatedBetween(bookKey: string, startedAt: number, endedAt: number): number {
  const notes = useBookDataStore.getState().getConfig(bookKey)?.booknotes ?? [];
  return notes.filter(
    (note) =>
      !note.deletedAt &&
      note.createdAt >= startedAt - SESSION_IDLE_PAUSE_SEC * 1000 &&
      note.createdAt <= endedAt + 1000,
  ).length;
}
