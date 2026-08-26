'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useTranslation } from '@/hooks/useTranslation';

import { ArchiveDb, SessionMetaRow } from '@/features/archive/db/archiveDb';
import { ArchiveBook } from '@/features/archive/types';

type StatsMode = 'all' | 'month' | 'year';

interface DayCell {
  date: number; // epoch ms of local midnight
  inMonth: boolean;
  sessions: SessionMetaRow[];
}

const WEEKDAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MODE_KEYS: { mode: StatsMode; key: string }[] = [
  { mode: 'all', key: 'All' },
  { mode: 'month', key: 'Month' },
  { mode: 'year', key: 'Year' },
];

const FORMAT_LABELS: Record<string, string> = {
  paper: 'Paper',
  ebook: 'E-book',
  audio: 'Audio',
};

/** Far-future bound (max JS-date ms) so "All time" covers every recorded session. */
const ALL_TIME_END = 8640000000000000;

function localMidnight(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
}

/**
 * Reading stats (PRD §3.5.4): 全部/月/年 periods with a month cover-calendar,
 * summary numbers, a 24h×7d reading heatmap, rating/format distributions,
 * author & publisher Top10, and a yearly finished-cover wall whose numbered
 * gray slots are future reading goals.
 */
const ArchiveStatsPage: React.FC = () => {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const { safeAreaInsets } = useThemeStore();
  const getBookByHash = useLibraryStore((state) => state.getBookByHash);

  // Wall-clock state must be set post-mount: a prerendered period built in
  // August would hydrate-mismatch in September (same guard as the calendar).
  const [mode, setMode] = useState<StatsMode>('month');
  const [anchor, setAnchor] = useState<number | null>(null); // local first-of-month ms
  const [sessions, setSessions] = useState<SessionMetaRow[]>([]);
  const [books, setBooks] = useState<ArchiveBook[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const now = new Date();
    setAnchor(new Date(now.getFullYear(), now.getMonth(), 1).getTime());
  }, []);

  const range = useMemo<[number, number]>(() => {
    if (mode === 'all') return [0, ALL_TIME_END];
    if (anchor === null) return [0, 0];
    if (mode === 'month') {
      return [
        anchor,
        new Date(new Date(anchor).getFullYear(), new Date(anchor).getMonth() + 1, 1).getTime(),
      ];
    }
    return [
      new Date(new Date(anchor).getFullYear(), 0, 1).getTime(),
      new Date(new Date(anchor).getFullYear() + 1, 0, 1).getTime(),
    ];
  }, [mode, anchor]);

  const load = useCallback(async () => {
    if (!appService || anchor === null) return;
    const db = await ArchiveDb.open(appService);
    const [start, end] = range;
    const [nextSessions, nextBooks] = await Promise.all([
      db.listSessionsWithMeta(start, end),
      db.listBooks(),
    ]);
    setSessions(nextSessions);
    setBooks(nextBooks);
    setLoaded(true);
  }, [appService, anchor, range]);

  useEffect(() => {
    void load().catch((error) => console.warn('archive: stats load failed', error));
  }, [load]);

  const shiftPeriod = (delta: number) => {
    if (anchor === null) return;
    const d = new Date(anchor);
    if (mode === 'month') {
      setAnchor(new Date(d.getFullYear(), d.getMonth() + delta, 1).getTime());
    } else if (mode === 'year') {
      setAnchor(new Date(d.getFullYear() + delta, d.getMonth(), 1).getTime());
    }
  };

  // ---- Aggregations ----

  const byDay = useMemo(() => {
    const map: Record<string, SessionMetaRow[]> = {};
    for (const session of sessions) {
      const key = String(localMidnight(session.startedAt));
      (map[key] ??= []).push(session);
    }
    return map;
  }, [sessions]);

  const totalSeconds = useMemo(
    () => sessions.reduce((sum, s) => sum + s.durationSec, 0),
    [sessions],
  );
  const readDays = Object.keys(byDay).length;

  /** Finished books in scope; finish date falls back to creation year per PRD. */
  const finishedBooks = useMemo(() => {
    const [start, end] = range;
    return books
      .filter((b) => b.status === 'finished')
      .map((b) => ({ book: b, finishedAt: b.statusFinishedAt ?? b.createdAt }))
      .filter((x) => x.finishedAt >= start && x.finishedAt < end)
      .sort((a, b) => a.finishedAt - b.finishedAt);
  }, [books, range]);

  const heat = useMemo(() => {
    const cells = new Array<number>(7 * 24).fill(0);
    let max = 0;
    for (const s of sessions) {
      const d = new Date(s.startedAt);
      const idx = d.getDay() * 24 + d.getHours();
      cells[idx]! += s.durationSec;
      if (cells[idx]! > max) max = cells[idx]!;
    }
    return { cells, max };
  }, [sessions]);

  const ratingCounts = useMemo(() => {
    const counts = new Array<number>(6).fill(0); // index 1..5
    for (const s of sessions) {
      if (s.rating != null && s.rating >= 1 && s.rating <= 5) {
        counts[Math.round(s.rating)]! += 1;
      }
    }
    return counts;
  }, [sessions]);

  const formatCounts = useMemo(() => {
    // Distinct books read in the period, grouped by their format.
    const byId = new Map<string, string>();
    for (const s of sessions) byId.set(s.bookId, s.format);
    const counts = new Map<string, number>();
    for (const format of byId.values()) counts.set(format, (counts.get(format) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [sessions]);

  const topLists = useMemo(() => {
    const authorMap = new Map<string, Set<string>>();
    const publisherMap = new Map<string, Set<string>>();
    for (const s of sessions) {
      for (const author of s.authors ?? []) {
        const name = author.trim();
        if (!name) continue;
        (authorMap.get(name) ?? authorMap.set(name, new Set()).get(name)!).add(s.bookId);
      }
      const publisher = s.publisher?.trim();
      if (publisher) {
        (publisherMap.get(publisher) ?? publisherMap.set(publisher, new Set()).get(publisher)!).add(
          s.bookId,
        );
      }
    }
    const toTop = (map: Map<string, Set<string>>) =>
      [...map.entries()]
        .map(([name, ids]) => ({ name, count: ids.size }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    return { authors: toTop(authorMap), publishers: toTop(publisherMap) };
  }, [sessions]);

  const weeks = useMemo<DayCell[][]>(() => {
    if (anchor === null) return [];
    const first = new Date(anchor);
    const gridStart = localMidnight(first.getTime() - first.getDay() * 86400000);
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const cells: DayCell[] = [];
    for (let i = 0; i < 42; i++) {
      const date = gridStart + i * 86400000;
      const d = new Date(date);
      const inMonth = d.getMonth() === first.getMonth();
      if (!inMonth && i >= 28 && cells.length >= 28 + daysInMonth) break;
      cells.push({ date, inMonth, sessions: byDay[String(date)] ?? [] });
      if (i >= 27 && d.getDay() === 6 && inMonth === false) break;
    }
    const rows: DayCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [anchor, byDay]);

  const coverUrl = (hash: string | null) =>
    hash ? (getBookByHash(hash)?.coverImageUrl ?? undefined) : undefined;

  const periodLabel =
    mode === 'all'
      ? ''
      : mode === 'year'
        ? String(new Date(anchor ?? Date.now()).getFullYear())
        : new Date(anchor ?? Date.now()).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
          });

  const maxRating = Math.max(...ratingCounts, 0);
  // Wall tail: a fixed run of gray numbered slots standing for future goals.
  const emptySlots = 12;

  const summaryRows: { label: string; value: string | number }[] = [
    { label: _('Reading time'), value: fmtDuration(totalSeconds) },
    { label: _('Reading days'), value: readDays },
    {
      label: _('Daily average'),
      value: fmtDuration(readDays > 0 ? Math.round(totalSeconds / readDays) : 0),
    },
    { label: _('Books finished'), value: finishedBooks.length },
  ];

  return (
    <div
      className='mx-auto flex h-full w-full max-w-[720px] flex-col bg-base-100 text-base-content'
      style={{ paddingTop: safeAreaInsets?.top }}
    >
      <header className='flex items-center gap-1 px-4 pt-4'>
        <button className='btn btn-ghost btn-sm' onClick={() => router.push('/archive')}>
          ←
        </button>
        <h1 className='text-lg font-bold'>{_('Stats')}</h1>
        <div className='ml-auto flex items-center gap-1'>
          <button
            className={clsx('btn btn-circle btn-ghost btn-sm', mode === 'all' && 'btn-disabled')}
            onClick={() => shiftPeriod(-1)}
            aria-label={mode === 'year' ? _('Previous year') : _('Previous month')}
          >
            ‹
          </button>
          {mode !== 'all' && (
            <span className='min-w-[110px] text-center text-sm tabular-nums'>{periodLabel}</span>
          )}
          <button
            className={clsx('btn btn-circle btn-ghost btn-sm', mode === 'all' && 'btn-disabled')}
            onClick={() => shiftPeriod(1)}
            aria-label={mode === 'year' ? _('Next year') : _('Next month')}
          >
            ›
          </button>
        </div>
      </header>

      {/* Period pills */}
      <div className='flex justify-center px-4 pb-1 pt-2'>
        <div className='flex gap-1 rounded-full bg-base-200 p-1'>
          {MODE_KEYS.map(({ mode: m, key }) => (
            <button
              key={m}
              className={clsx('btn btn-xs rounded-full', mode === m ? 'btn-neutral' : 'btn-ghost')}
              onClick={() => setMode(m)}
            >
              {_(key)}
            </button>
          ))}
        </div>
      </div>

      <div className='flex-1 overflow-y-auto px-4 pb-8'>
        {!loaded ? (
          <p className='pt-10 text-center text-sm text-base-content/40'>{_('Loading…')}</p>
        ) : (
          <>
            {/* Summary rows: gray label + big serif number */}
            <div className='py-2'>
              {summaryRows.map((row) => (
                <div
                  key={row.label}
                  className='border-base-200/70 flex items-baseline justify-between border-b py-2 last:border-b-0'
                >
                  <span className='text-xs text-base-content/50'>{row.label}</span>
                  <span className='font-serif text-2xl tabular-nums'>{row.value}</span>
                </div>
              ))}
            </div>

            {/* Month cover-calendar grid */}
            {mode === 'month' && (
              <section className='pt-2'>
                <div className='grid grid-cols-7 pb-1 text-center text-[11px] text-base-content/40'>
                  {WEEKDAY_KEYS.map((key) => (
                    <span key={key}>{_(key)}</span>
                  ))}
                </div>
                {weeks.map((week, weekIdx) => (
                  <div key={weekIdx} className='grid grid-cols-7 gap-1 pb-1'>
                    {week.map((cell) => (
                      <div
                        key={cell.date}
                        className={clsx(
                          'flex min-h-[56px] flex-col items-center gap-0.5 rounded-xl p-1',
                          cell.inMonth ? 'bg-base-200/60' : 'opacity-35',
                        )}
                      >
                        <span className='text-[11px] tabular-nums text-base-content/60'>
                          {new Date(cell.date).getDate()}
                        </span>
                        <span className='flex max-w-full flex-wrap justify-center gap-[1px] overflow-hidden'>
                          {[...new Set(cell.sessions.map((s) => s.bookHash))]
                            .filter((hash): hash is string => hash != null)
                            .slice(0, 3)
                            .map((hash) => {
                              const url = coverUrl(hash);
                              return url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={hash}
                                  src={url}
                                  alt=''
                                  className='h-[20px] w-[14px] rounded-[2px] object-cover'
                                />
                              ) : (
                                <span
                                  key={hash}
                                  className='h-[20px] w-[14px] rounded-[2px] bg-base-300'
                                />
                              );
                            })}
                          {cell.sessions.length > 3 && (
                            <span className='text-[9px] leading-[20px] text-base-content/40'>
                              +
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </section>
            )}

            {/* 24h × 7d reading heatmap */}
            <section className='pt-5'>
              <h2 className='pb-2 text-sm font-semibold'>{_('Reading heatmap')}</h2>
              <div className='flex gap-1.5'>
                <div className='flex flex-col gap-[2px]'>
                  {WEEKDAY_KEYS.map((key) => (
                    <span
                      key={key}
                      className='h-[14px] text-[9px] leading-[14px] text-base-content/40'
                    >
                      {_(key)}
                    </span>
                  ))}
                </div>
                <div className='min-w-0 flex-1'>
                  <div
                    className='grid gap-[2px]'
                    style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
                  >
                    {Array.from({ length: 7 * 24 }, (_, i) => {
                      const seconds = heat.cells[i] ?? 0;
                      const intensity = heat.max > 0 ? seconds / heat.max : 0;
                      return (
                        <div
                          key={i}
                          className={clsx(
                            'aspect-square rounded-[2px]',
                            seconds === 0 ? 'bg-base-200' : 'bg-neutral',
                          )}
                          style={seconds > 0 ? { opacity: 0.25 + 0.75 * intensity } : undefined}
                        />
                      );
                    })}
                  </div>
                  <div className='flex justify-between pt-1 text-[9px] text-base-content/40'>
                    <span>0h</span>
                    <span>6h</span>
                    <span>12h</span>
                    <span>18h</span>
                    <span>23h</span>
                  </div>
                </div>
              </div>
            </section>

            {/* Rating distribution */}
            <section className='pt-5'>
              <h2 className='pb-2 text-sm font-semibold'>{_('Rating distribution')}</h2>
              {[5, 4, 3, 2, 1].map((rating) => {
                const count = ratingCounts[rating] ?? 0;
                return (
                  <div key={rating} className='flex items-center gap-2 py-1'>
                    <span className='w-8 text-xs tabular-nums text-base-content/60'>{rating}★</span>
                    <div className='h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-base-200'>
                      {count > 0 && (
                        <div
                          className='h-full rounded-full bg-neutral'
                          style={{
                            width: `${maxRating > 0 ? Math.max(6, (count / maxRating) * 100) : 0}%`,
                          }}
                        />
                      )}
                    </div>
                    <span className='w-6 text-right text-xs tabular-nums text-base-content/50'>
                      {count}
                    </span>
                  </div>
                );
              })}
            </section>

            {/* Format distribution */}
            {formatCounts.length > 0 && (
              <section className='pt-5'>
                <h2 className='pb-2 text-sm font-semibold'>{_('Format distribution')}</h2>
                <div className='flex flex-wrap gap-x-6 gap-y-1'>
                  {formatCounts.map(([format, count]) => (
                    <span key={format} className='text-sm'>
                      <span className='text-base-content/70'>
                        {_(FORMAT_LABELS[format] ?? format)}
                      </span>
                      <span className='ml-1.5 font-serif tabular-nums'>{count}</span>
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Author / publisher Top10 */}
            {(topLists.authors.length > 0 || topLists.publishers.length > 0) && (
              <section className='grid gap-5 pt-5 sm:grid-cols-2'>
                {topLists.authors.length > 0 && (
                  <div>
                    <h2 className='pb-2 text-sm font-semibold'>{_('Authors')}</h2>
                    <ol className='divide-base-200/60 divide-y'>
                      {topLists.authors.map((entry, idx) => (
                        <li key={entry.name} className='flex items-baseline gap-2 py-1.5 text-sm'>
                          <span className='w-4 shrink-0 tabular-nums text-base-content/40'>
                            {idx + 1}
                          </span>
                          <span className='min-w-0 flex-1 truncate'>{entry.name}</span>
                          <span className='tabular-nums text-base-content/50'>{entry.count}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {topLists.publishers.length > 0 && (
                  <div>
                    <h2 className='pb-2 text-sm font-semibold'>{_('Publisher')}</h2>
                    <ol className='divide-base-200/60 divide-y'>
                      {topLists.publishers.map((entry, idx) => (
                        <li key={entry.name} className='flex items-baseline gap-2 py-1.5 text-sm'>
                          <span className='w-4 shrink-0 tabular-nums text-base-content/40'>
                            {idx + 1}
                          </span>
                          <span className='min-w-0 flex-1 truncate'>{entry.name}</span>
                          <span className='tabular-nums text-base-content/50'>{entry.count}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </section>
            )}

            {/* Yearly cover wall (All/Year modes) */}
            {mode !== 'month' && (
              <section className='pt-6'>
                <h2 className='pb-2 text-sm font-semibold'>{_('Yearly cover wall')}</h2>
                {finishedBooks.length === 0 ? (
                  <p className='text-sm text-base-content/40'>{_('No books finished yet.')}</p>
                ) : null}
                <div className='grid grid-cols-6 gap-1.5 sm:grid-cols-8'>
                  {finishedBooks.map(({ book }) => {
                    const url = book.bookHash ? coverUrl(book.bookHash) : undefined;
                    return url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={book.id}
                        src={url}
                        alt={book.title}
                        title={book.title}
                        className='aspect-[2/3] w-full rounded-md object-cover'
                      />
                    ) : (
                      <div
                        key={book.id}
                        title={book.title}
                        className='flex aspect-[2/3] w-full items-center justify-center rounded-md bg-base-200 p-1 text-center text-[9px] leading-tight text-base-content/40'
                      >
                        {book.title.slice(0, 12)}
                      </div>
                    );
                  })}
                  {/* Empty slots are goals: numbered placeholders to fill */}
                  {Array.from({ length: emptySlots }, (_, i) => (
                    <div
                      key={`slot-${i}`}
                      className='flex aspect-[2/3] w-full items-center justify-center rounded-md border border-dashed border-base-300 bg-base-200/40 text-sm tabular-nums text-base-content/30'
                    >
                      {finishedBooks.length + i + 1}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ArchiveStatsPage;
