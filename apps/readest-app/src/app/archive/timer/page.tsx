'use client';

import clsx from 'clsx';
import React, { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

import { useTranslation } from '@/hooks/useTranslation';

import {
  selectElapsedSeconds,
  useArchiveSessionStore,
} from '@/features/archive/store/sessionStore';

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Fullscreen immersive timer (PRD §3.5.3): always-dark page with oversized
 * session digits; ✕ discards, ✓ saves the session.
 */
const ArchiveTimerPage: React.FC = () => {
  const _ = useTranslation();
  const router = useRouter();
  const active = useArchiveSessionStore((state) => state.active);
  const todaySeconds = useArchiveSessionStore((state) => state.todaySeconds);
  const elapsed = useArchiveSessionStore(selectElapsedSeconds);

  // Keep the screen awake for the whole immersive session (best effort).
  useEffect(() => {
    let sentinel: { release: () => Promise<void> } | null = null;
    const wakeLock = navigator.wakeLock as
      | {
          request?: (type: 'screen') => Promise<{ release: () => Promise<void> }>;
        }
      | undefined;
    if (wakeLock?.request) {
      wakeLock
        .request('screen')
        .then((s) => {
          sentinel = s;
        })
        .catch(() => {});
    }
    return () => {
      void sentinel?.release().catch(() => {});
    };
  }, []);

  // Redirect happens in an effect (never during render/prerender).
  const bouncedRef = useRef(false);
  useEffect(() => {
    if (!active && !bouncedRef.current) {
      bouncedRef.current = true;
      router.replace('/archive');
    }
  }, [active, router]);

  if (!active) {
    return (
      <div className='fixed inset-0 z-[60] flex items-center justify-center bg-black text-sm text-white/40'>
        {_('No running session')}
      </div>
    );
  }
  const running = active.lastResumeAt !== null;

  const handleDiscard = async () => {
    await useArchiveSessionStore.getState().discard();
    router.replace('/archive');
  };

  const handleSave = async () => {
    await useArchiveSessionStore.getState().finish();
    router.replace('/archive');
  };

  const handlePauseResume = () => {
    const store = useArchiveSessionStore.getState();
    if (running) {
      void store.pause();
    } else {
      store.resume();
    }
  };

  return (
    <div className='fixed inset-0 z-[60] flex flex-col bg-black text-white'>
      <header className='flex items-center justify-between px-5 pt-5'>
        <button
          className='btn btn-circle btn-ghost text-white/70 hover:text-white'
          onClick={handleDiscard}
          aria-label={_('Discard and close')}
        >
          ✕
        </button>
        <button
          className='btn btn-circle btn-ghost text-white/70 hover:text-white'
          onClick={handleSave}
          aria-label={_('Save session')}
        >
          ✓
        </button>
      </header>

      <main className='flex flex-1 flex-col items-center justify-center gap-4'>
        <p
          className={clsx(
            'font-mono tabular-nums tracking-widest',
            'text-6xl sm:text-7xl',
            running ? 'text-white' : 'text-warning',
          )}
        >
          {fmt(elapsed)}
        </p>
        <p className='max-w-[70%] truncate text-sm text-white/50'>{active.title}</p>
        <p className='text-xs text-white/30'>
          {_('Today {{minutes}} min', { minutes: Math.round(todaySeconds / 60) })}
        </p>
      </main>

      <footer className='flex items-center justify-center gap-16 pb-16'>
        <button
          className='btn btn-circle btn-lg border border-white/20 bg-transparent text-white/80 hover:bg-white/10'
          onClick={() => router.back()}
          title={_('Back to reading')}
        >
          {_('Note')}
        </button>
        <button
          className='btn btn-circle btn-lg border border-white/20 bg-transparent text-xl text-white hover:bg-white/10'
          onClick={handlePauseResume}
          aria-label={running ? _('Pause') : _('Resume')}
        >
          {running ? '❚❚' : '▶'}
        </button>
      </footer>
    </div>
  );
};

export default ArchiveTimerPage;
