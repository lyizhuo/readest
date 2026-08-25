'use client';

import clsx from 'clsx';
import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useEnv } from '@/context/EnvContext';

import { ArchiveBook } from '../types';
import { useArchiveSessionStore } from '../store/sessionStore';

/** Warm-yellow accent per PRD §3.5.0 (exposed as a CSS variable, not hardcoded everywhere). */
export const ARCHIVE_ACCENT_VAR = '--archive-accent';

function GoalRing({ seconds, goalMinutes }: { seconds: number; goalMinutes: number }): string {
  const pct = goalMinutes > 0 ? Math.min(1, seconds / 60 / goalMinutes) : 0;
  return pct.toString();
}

/**
 * 在读首页 (PRD §3.5.1): daily-goal ring + horizontally paged carousel of
 * currently-reading books with warm-yellow 开始计时 actions.
 */
const ReadingHome: React.FC<{
  books: ArchiveBook[];
  getCoverUrl: (hash: string | null) => string | undefined;
}> = ({ books, getCoverUrl }) => {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const todaySeconds = useArchiveSessionStore((state) => state.todaySeconds);
  const readingBooks = books.filter((b) => b.status === 'reading');

  useEffect(() => {
    if (!appService) return;
    useArchiveSessionStore.getState().bindAppService(appService);
    useArchiveSessionStore.getState().refreshToday();
  }, [appService]);

  // Library records carry resolved cover URLs + progress numbers.
  const getBookByHash = useLibraryStore((state) => state.getBookByHash);
  const progressLabel = (hash: string | null): string => {
    if (!hash) return '';
    const progress = getBookByHash(hash)?.progress;
    return progress && progress[1] > 0 ? `${progress[0]}/${progress[1]}` : '';
  };

  const goalMinutes = settings.archive?.dailyGoalMinutes ?? 60;
  const goalPct = Number(GoalRing({ seconds: todaySeconds, goalMinutes }));

  const handleStartTimer = async (book: ArchiveBook) => {
    // Sessions key off the e-book file; paper/audio entries cannot track.
    if (!appService || !book.bookHash) return;
    await useArchiveSessionStore.getState().startForBook({
      bookId: book.id,
      bookHash: book.bookHash,
      title: book.title,
    });
    router.push('/archive/timer');
  };

  return (
    <section className='px-4 pb-2 pt-1'>
      <div
        className='flex flex-col items-center gap-3 rounded-3xl bg-base-200/50 py-4'
        style={{ [ARCHIVE_ACCENT_VAR]: '#F5C242' } as React.CSSProperties}
      >
        {/* Daily goal ring */}
        <div className='flex items-center gap-2'>
          <svg width='40' height='40' viewBox='0 0 40 40' className='-rotate-90'>
            <circle
              cx='20'
              cy='20'
              r='16'
              fill='none'
              strokeWidth='4'
              className='stroke-base-300'
            />
            <circle
              cx='20'
              cy='20'
              r='16'
              fill='none'
              strokeWidth='4'
              strokeLinecap='round'
              className='transition-all'
              stroke={`var(${ARCHIVE_ACCENT_VAR}, #F5C242)`}
              strokeDasharray={`${goalPct * 100.53} 100.53`}
            />
          </svg>
          <span className='text-sm tabular-nums text-base-content/70'>
            {_('Today {{read}}/{{goal}} min', {
              read: Math.round(todaySeconds / 60),
              goal: goalMinutes,
            })}
          </span>
        </div>

        {/* Currently-reading carousel */}
        {readingBooks.length === 0 ? (
          <p className='py-4 text-center text-sm text-base-content/50'>
            {_('No books in progress. Pick one below to start.')}
          </p>
        ) : (
          <ul className='flex w-full snap-x gap-6 overflow-x-auto px-6 py-2'>
            {readingBooks.map((book) => (
              <li
                key={book.id}
                className='flex w-full max-w-[240px] flex-none snap-center flex-col items-center gap-2'
              >
                <button
                  className='block shadow-lg transition-transform hover:scale-[1.02]'
                  onClick={() => router.push(`/archive/detail?id=${book.id}`)}
                  aria-label={book.title}
                >
                  {getCoverUrl(book.bookHash) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={getCoverUrl(book.bookHash)}
                      alt={book.title}
                      className='h-44 w-32 rounded-xl object-cover'
                    />
                  ) : (
                    <div className='flex h-44 w-32 items-center justify-center rounded-xl bg-base-300 p-2 text-center text-xs text-base-content/40'>
                      {book.title}
                    </div>
                  )}
                </button>
                <p className='max-w-full truncate font-bold'>{book.title}</p>
                <p className='max-w-full truncate text-xs text-base-content/50'>
                  {book.authors.join(', ') || _('Unknown author')}
                </p>
                <p className='max-w-full truncate text-xs tabular-nums text-base-content/50'>
                  {progressLabel(book.bookHash)}
                </p>
                {book.currentRound > 1 && (
                  <span className='text-[11px] text-base-content/40'>
                    {_('Round {{n}}', { n: book.currentRound })}
                  </span>
                )}
                <div className='flex flex-col items-stretch gap-1.5'>
                  <button
                    className='btn btn-sm rounded-full border-none text-black'
                    style={{ background: `var(${ARCHIVE_ACCENT_VAR}, #F5C242)` }}
                    onClick={() => handleStartTimer(book)}
                  >
                    ▶ {_('Start Timer')}
                  </button>
                  <button
                    className='btn btn-sm rounded-full bg-base-300 border-none'
                    onClick={() => router.push(`/archive/detail?id=${book.id}`)}
                  >
                    {_('Details')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Carousel position dots */}
        {readingBooks.length > 1 && (
          <div className='flex gap-1'>
            {readingBooks.map((book) => (
              <span key={book.id} className={clsx('h-1 w-1 rounded-full bg-base-content/30')} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default ReadingHome;
