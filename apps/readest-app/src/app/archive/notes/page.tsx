'use client';

import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { navigateToReader } from '@/utils/nav';

import { ArchiveDb, type ArchivedNoteWithBook } from '@/features/archive/db/archiveDb';
import { useArchiveLibrary } from '@/features/archive/hooks/useArchiveLibrary';

/**
 * Global note library (PRD D4): cross-book full-text search over thoughts,
 * newest first. Click a note to open its book in the reader.
 */
const ArchiveNotesPage: React.FC = () => {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const { safeAreaInsets } = useThemeStore();
  const { enabled } = useArchiveLibrary();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ArchivedNoteWithBook[] | null>(null);

  useEffect(() => {
    if (!enabled) router.replace('/library');
  }, [enabled, router]);

  useEffect(() => {
    if (!appService) return;
    const timer = setTimeout(
      () => {
        void (async () => {
          try {
            const db = await ArchiveDb.open(appService);
            setResults(await db.searchThoughts(query));
          } catch (error) {
            console.warn('archive: note search failed', error);
            setResults([]);
          }
        })();
      },
      query ? 250 : 0,
    );
    return () => clearTimeout(timer);
  }, [appService, query]);

  return (
    <div
      className='mx-auto flex h-full w-full max-w-[720px] flex-col bg-base-100 text-base-content'
      style={{ paddingTop: safeAreaInsets?.top }}
    >
      <header className='flex items-center gap-2 px-4 pt-4'>
        <button className='btn btn-ghost btn-sm' onClick={() => router.push('/archive')}>
          ←
        </button>
        <h1 className='text-lg font-bold'>{_('Note Library')}</h1>
      </header>

      <div className='px-4 pt-3'>
        <input
          type='text'
          className='input input-sm w-full rounded-full bg-base-200'
          placeholder={_('Search all notes…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <ul className='mt-3 flex-1 space-y-2 overflow-y-auto px-4 pb-8'>
        {results === null ? (
          <p className='pt-10 text-center text-sm text-base-content/40'>{_('Loading…')}</p>
        ) : results.length === 0 ? (
          <p className='pt-10 text-center text-sm text-base-content/40'>{_('No matching notes')}</p>
        ) : (
          results.map((note) => (
            <li key={note.id}>
              <button
                className={clsx('w-full rounded-2xl bg-base-200/60 px-3 py-2 text-start text-sm')}
                onClick={() => {
                  if (note.bookHash && appService?.hasWindow === false) {
                    navigateToReader(router, [note.bookHash]);
                  } else {
                    router.push(`/archive/detail?id=${note.bookId}`);
                  }
                }}
              >
                <p className='text-[11px] text-base-content/40'>
                  {note.bookTitle}
                  {note.chapterTitle ? ` · ${note.chapterTitle}` : ''}
                  {' · '}
                  {new Date(note.createdAt).toLocaleDateString()}
                </p>
                <p className='line-clamp-3 whitespace-pre-wrap'>{note.content}</p>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
};

export default ArchiveNotesPage;
