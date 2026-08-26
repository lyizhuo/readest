'use client';

import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useTranslation } from '@/hooks/useTranslation';

import {
  selectElapsedSeconds,
  useArchiveSessionStore,
} from '@/features/archive/store/sessionStore';
import {
  computeRemaining,
  formatRemaining,
  shouldNotify,
} from '@/features/archive/timer/countdown';
import LiteraryClock from '@/features/archive/timer/LiteraryClock';

const PRESET_MINUTES = [25, 45, 60, 90] as const;
const MAX_CUSTOM_MIN = 600;

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Fullscreen immersive timer (PRD §3.5.3): always-dark page with oversized
 * session digits; ✕ discards, ✓ saves the session. An optional local focus
 * countdown (25/45/60/90 min or custom) runs independently of the net-time
 * clock: hitting zero pauses the session clock and fires one notification,
 * but the session itself continues until saved or discarded.
 *
 * C3 scope note: keeping a persistent countdown notification alive in the
 * background on Android requires a foreground service (native Kotlin work),
 * which is out of reach from this JS surface. We therefore do best-effort
 * one-shot Web Notification API pings instead.
 */
const ArchiveTimerPage: React.FC = () => {
  const _ = useTranslation();
  const router = useRouter();
  const active = useArchiveSessionStore((state) => state.active);
  const todaySeconds = useArchiveSessionStore((state) => state.todaySeconds);
  const elapsed = useArchiveSessionStore(selectElapsedSeconds);

  const [arm, setArm] = useState<{ startedAtMs: number; targetSec: number } | null>(null);
  const [fired, setFired] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [customMin, setCustomMin] = useState('');

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

  // Local countdown tick — deliberately independent of the store's net clock.
  useEffect(() => {
    if (!arm) return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 500);
    return () => clearInterval(id);
  }, [arm]);

  const remaining = arm ? computeRemaining(arm.startedAtMs, arm.targetSec, nowTick) : null;

  const notify = (body: string) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      new Notification(_('Reading timer'), { body });
    } catch {
      // Some platforms (e.g. Android Chrome without a service worker) throw.
    }
  };

  const handleArm = (minutes: number) => {
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_CUSTOM_MIN) return;
    // Lazy permission ask: only at the moment the user actually arms a timer.
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => {});
    }
    setFired(false);
    setArm({ startedAtMs: Date.now(), targetSec: Math.round(minutes * 60) });
  };

  const handleCancelCountdown = () => {
    setArm(null);
    setFired(false);
  };

  // Redirect happens in an effect (never during render/prerender).
  const bouncedRef = useRef(false);
  useEffect(() => {
    if (!active && !bouncedRef.current) {
      bouncedRef.current = true;
      router.replace('/archive');
    }
  }, [active, router]);

  // Countdown completion: ring once and pause the session clock; the session
  // itself keeps living (paused) until saved or discarded.
  useEffect(() => {
    if (!arm || fired || remaining === null || !shouldNotify(remaining)) return;
    setFired(true);
    notify(
      _('{{title}} · {{minutes}} min today', {
        title: active?.title ?? '',
        minutes: Math.round(todaySeconds / 60),
      }),
    );
    void useArchiveSessionStore.getState().pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arm, fired, remaining]);

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
    const sec = selectElapsedSeconds(useArchiveSessionStore.getState());
    await useArchiveSessionStore.getState().finish();
    if (sec >= 60) {
      notify(_('Saved {{minutes}} min', { minutes: Math.round(sec / 60) }));
    }
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

  const digitsCls = clsx(
    'font-mono tabular-nums tracking-widest',
    'text-6xl sm:text-7xl',
    fired && 'animate-pulse',
    arm
      ? (remaining as number) < 60
        ? 'text-[#F5C242]'
        : 'text-white'
      : running
        ? 'text-white'
        : 'text-warning',
  );

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
        <p className={digitsCls}>{arm ? formatRemaining(remaining as number) : fmt(elapsed)}</p>
        <p className='max-w-[70%] truncate text-sm text-white/50'>{active.title}</p>
        <p className='text-xs text-white/30'>
          {_('Today {{minutes}} min', { minutes: Math.round(todaySeconds / 60) })}
        </p>

        {!running && <LiteraryClock nowMs={nowTick} />}

        {!arm ? (
          <div className='flex flex-wrap items-center justify-center gap-2 px-6 pt-2'>
            {PRESET_MINUTES.map((min) => (
              <button
                key={min}
                className='btn btn-sm rounded-full border border-white/20 bg-transparent text-white/80 hover:bg-white/10'
                onClick={() => handleArm(min)}
              >
                {_('{{n}} min', { n: min })}
              </button>
            ))}
            <input
              type='number'
              min={1}
              max={MAX_CUSTOM_MIN}
              inputMode='numeric'
              value={customMin}
              onChange={(e) => setCustomMin(e.target.value)}
              placeholder={_('Custom min')}
              className='input input-sm w-24 rounded-full border border-white/20 bg-transparent text-center text-white placeholder:text-white/30'
            />
            <button
              className='btn btn-sm rounded-full bg-white/10 text-white hover:bg-white/20'
              disabled={!customMin}
              onClick={() => handleArm(Number(customMin))}
            >
              {_('Start countdown')}
            </button>
          </div>
        ) : (
          <div className='flex items-center gap-3 pt-2 text-xs text-white/40'>
            <span>{fired ? _('Countdown done') : _('Focus countdown')}</span>
            <button
              className='btn btn-xs rounded-full border border-white/20 bg-transparent text-white/60 hover:bg-white/10'
              onClick={handleCancelCountdown}
            >
              {_('Cancel countdown')}
            </button>
          </div>
        )}
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
