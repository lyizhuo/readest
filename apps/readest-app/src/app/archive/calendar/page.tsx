'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useTranslation } from '@/hooks/useTranslation';

import { SessionWithBook, ArchiveDb } from '@/features/archive/db/archiveDb';

interface DayCell {
  date: number; // epoch ms of local midnight
  inMonth: boolean;
  sessions: SessionWithBook[];
}

const WEEKDAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
 * 阅读日历 (PRD B3): month grid whose day cells show covers of the books read
 * that day; tapping a day opens its session detail sheet with delete /
 * duration-edit corrections.
 */
const ArchiveCalendarPage: React.FC = () => {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const { safeAreaInsets } = useThemeStore();
  const getBookByHash = useLibraryStore((state) => state.getBookByHash);

  // Wall-clock state must be set post-mount: a prerendered grid built in
  // August would hydrate-mismatch in September (server/client HTML differ).
  const [monthOffset, setMonthOffset] = useState<number | null>(null);
  const [sessions, setSessions] = useState<SessionWithBook[]>([]);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const now = new Date();
    setMonthOffset(new Date(now.getFullYear(), now.getMonth(), 1).getTime());
  }, []);

  const load = useCallback(async () => {
    if (!appService || monthOffset === null) return;
    const db = await ArchiveDb.open(appService);
    const start = monthOffset;
    const end = new Date(
      new Date(monthOffset).getFullYear(),
      new Date(monthOffset).getMonth() + 1,
      1,
    ).getTime();
    setSessions(await db.listSessionsInRange(start, end));
    setLoaded(true);
  }, [appService, monthOffset]);

  useEffect(() => {
    void load().catch((error) => console.warn('archive: calendar load failed', error));
  }, [load]);

  const byDay = useMemo(() => {
    const map: Record<string, SessionWithBook[]> = {};
    for (const session of sessions) {
      const key = String(localMidnight(session.startedAt));
      (map[key] ??= []).push(session);
    }
    return map;
  }, [sessions]);

  const weeks: DayCell[][] = useMemo(() => {
    if (monthOffset === null) return [];
    const first = new Date(monthOffset);
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
  }, [monthOffset, byDay]);

  const totalSeconds = sessions.reduce((sum, s) => sum + s.durationSec, 0);
  const readDays = Object.keys(byDay).length;

  const coverUrl = (hash: string | null) =>
    hash ? (getBookByHash(hash)?.coverImageUrl ?? undefined) : undefined;

  const handleDeleteSession = async (id: string) => {
    if (!appService) return;
    const db = await ArchiveDb.open(appService);
    await db.deleteSession(id);
    setSelectedDay(null);
    await load();
  };

  const handleEditDuration = async (session: SessionWithBook) => {
    const input = window.prompt(
      _('Edit duration (minutes)'),
      String(Math.max(1, Math.round(session.durationSec / 60))),
    );
    if (input === null || !/^\d+$/.test(input)) return;
    if (!appService) return;
    const db = await ArchiveDb.open(appService);
    await db.updateSessionDuration(session.id, Number(input) * 60);
    setSelectedDay(null);
    await load();
  };

  const monthLabel =
    monthOffset === null
      ? ''
      : new Date(monthOffset).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
        });

  const daySessions = selectedDay !== null ? (byDay[String(selectedDay)] ?? []) : [];

  return (
    <div
      className='mx-auto flex h-full w-full max-w-[720px] flex-col bg-base-100 text-base-content'
      style={{ paddingTop: safeAreaInsets?.top }}
    >
      <header className='flex items-center gap-1 px-4 pt-4'>
        <button className='btn btn-ghost btn-sm' onClick={() => router.push('/archive')}>
          ←
        </button>
        <h1 className='text-lg font-bold'>{_('Calendar')}</h1>
        <div className='ml-auto flex items-center gap-1'>
          <button
            className='btn btn-circle btn-ghost btn-sm'
            onClick={() => {
              if (monthOffset === null) return;
              setMonthOffset(
                new Date(
                  new Date(monthOffset).getFullYear(),
                  new Date(monthOffset).getMonth() - 1,
                  1,
                ).getTime(),
              );
            }}
            aria-label={_('Previous month')}
          >
            ‹
          </button>
          <span className='min-w-[110px] text-center text-sm tabular-nums'>{monthLabel}</span>
          <button
            className='btn btn-circle btn-ghost btn-sm'
            onClick={() => {
              if (monthOffset === null) return;
              setMonthOffset(
                new Date(
                  new Date(monthOffset).getFullYear(),
                  new Date(monthOffset).getMonth() + 1,
                  1,
                ).getTime(),
              );
            }}
            aria-label={_('Next month')}
          >
            ›
          </button>
        </div>
      </header>

      {/* Summary row: small gray label + large serif-ish numbers */}
      <div className='flex items-end justify-between px-5 py-3'>
        <div>
          <p className='text-xs text-base-content/50'>{_('Reading time')}</p>
          <p className='font-serif text-3xl tabular-nums'>{fmtDuration(totalSeconds)}</p>
        </div>
        <div className='text-right'>
          <p className='text-xs text-base-content/50'>{_('Reading days')}</p>
          <p className='font-serif text-3xl tabular-nums'>{readDays}</p>
        </div>
      </div>

      <div className='grid grid-cols-7 px-3 pb-1 text-center text-[11px] text-base-content/40'>
        {WEEKDAY_KEYS.map((key) => (
          <span key={key}>{_(key)}</span>
        ))}
      </div>

      <div className='flex-1 overflow-y-auto px-3 pb-6'>
        {!loaded ? (
          <p className='pt-10 text-center text-sm text-base-content/40'>{_('Loading…')}</p>
        ) : (
          weeks.map((week, weekIdx) => (
            <div key={weekIdx} className='grid grid-cols-7 gap-1 pb-1'>
              {week.map((cell) => (
                <button
                  key={cell.date}
                  className={clsx(
                    'flex min-h-[52px] flex-col items-center gap-0.5 rounded-xl p-1',
                    cell.inMonth ? 'bg-base-200/60' : 'opacity-35',
                  )}
                  onClick={() => cell.sessions.length > 0 && setSelectedDay(cell.date)}
                >
                  <span className='text-[11px] tabular-nums text-base-content/60'>
                    {new Date(cell.date).getDate()}
                  </span>
                  <span className='flex max-w-full flex-wrap justify-center gap-[1px] overflow-hidden'>
                    {[...new Set(cell.sessions.map((s) => s.bookHash))].slice(0, 3).map((hash) => {
                      const url = coverUrl(hash);
                      return url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={hash}
                          src={url}
                          alt=''
                          className='h-[18px] w-[13px] rounded-[2px] object-cover'
                        />
                      ) : (
                        <span key={hash} className='h-[18px] w-[13px] rounded-[2px] bg-base-300' />
                      );
                    })}
                    {cell.sessions.length > 3 && (
                      <span className='text-[9px] leading-[18px] text-base-content/40'>+</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Day session detail sheet */}
      {selectedDay !== null && (
        <dialog className='modal modal-open' open>
          <div className='modal-box max-w-md rounded-t-3xl sm:rounded-2xl'>
            <h3 className='pb-2 text-lg font-bold'>
              {new Date(selectedDay).toLocaleDateString(undefined, {
                month: 'long',
                day: 'numeric',
              })}
            </h3>
            <ul className='divide-base-200/60 divide-y'>
              {daySessions.map((session) => (
                <li key={session.id} className='flex items-center gap-2 py-2 text-sm'>
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate font-semibold'>{session.title}</span>
                    <span className='text-xs tabular-nums text-base-content/50'>
                      {fmtDuration(session.durationSec)}
                      {' · '}
                      {new Date(session.startedAt).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {' – '}
                      {session.endedAt != null &&
                        new Date(session.endedAt).toLocaleTimeString(undefined, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                    </span>
                  </span>
                  <button
                    className='btn btn-ghost btn-xs'
                    onClick={() => handleEditDuration(session)}
                  >
                    {_('Edit')}
                  </button>
                  <button
                    className='btn btn-ghost btn-xs text-error'
                    onClick={() => handleDeleteSession(session.id)}
                  >
                    {_('Delete')}
                  </button>
                </li>
              ))}
            </ul>
            <div className='modal-action'>
              <button className='btn btn-sm rounded-full' onClick={() => setSelectedDay(null)}>
                {_('Done')}
              </button>
            </div>
          </div>
          <button
            className='modal-backdrop'
            onClick={() => setSelectedDay(null)}
            aria-label={_('Close')}
          />
        </dialog>
      )}
    </div>
  );
};

export default ArchiveCalendarPage;
