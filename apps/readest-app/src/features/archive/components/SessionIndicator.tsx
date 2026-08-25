'use client';

import clsx from 'clsx';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

import { useTranslation } from '@/hooks/useTranslation';

import { selectElapsedSeconds, useArchiveSessionStore } from '../store/sessionStore';

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Reader corner indicator (PRD C1): a small always-present pill showing the
 * current session time; tap to expand pause / resume / fullscreen controls.
 * Renders nothing while no session is active or the module is off.
 */
const SessionIndicator: React.FC = () => {
  const _ = useTranslation();
  const router = useRouter();
  const active = useArchiveSessionStore((state) => state.active);
  const elapsed = useArchiveSessionStore(selectElapsedSeconds);
  const [expanded, setExpanded] = useState(false);

  if (!active) return null;

  const handlePauseResume = () => {
    const store = useArchiveSessionStore.getState();
    if (active.lastResumeAt === null) {
      store.resume();
    } else {
      void store.pause();
    }
  };

  return (
    <div
      className={clsx(
        'absolute right-3 z-40 flex flex-col items-end gap-1 text-xs',
        expanded ? 'bottom-14' : 'bottom-24',
      )}
    >
      {expanded && (
        <div className='bg-base-300/90 rounded-2xl px-3 py-2 shadow-lg backdrop-blur-sm'>
          <p className='mb-1 max-w-[160px] truncate font-semibold'>{active.title}</p>
          <div className='flex items-center gap-1.5'>
            <button className='btn btn-xs rounded-full' onClick={handlePauseResume}>
              {active.lastResumeAt === null ? _('Resume') : _('Pause')}
            </button>
            <button
              className='btn btn-xs btn-neutral rounded-full'
              onClick={() => router.push('/archive/timer')}
              title={_('Fullscreen timer')}
            >
              {_('Timer')}
            </button>
          </div>
        </div>
      )}
      <button
        className={clsx(
          'font-mono tabular-nums',
          'bg-base-300/80 text-base-content/70 hover:text-base-content',
          'rounded-full px-2.5 py-1 shadow-sm backdrop-blur-sm transition-colors',
          !active.lastResumeAt && 'opacity-60',
        )}
        title={_('Reading session')}
        onClick={() => setExpanded((prev) => !prev)}
      >
        ⏱ {fmt(elapsed)}
        {active.lastResumeAt === null && ' ⏸'}
      </button>
    </div>
  );
};

export default SessionIndicator;
