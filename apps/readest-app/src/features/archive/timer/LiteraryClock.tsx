'use client';

import React, { useMemo } from 'react';

import { lookupClock } from '@/features/archive/timer/literaryClock';

/**
 * Shows the literature line closest to the current wall time (±30 min) in the
 * paused/idle area of the immersive timer. Renders nothing off-window.
 */
const LiteraryClock: React.FC<{ nowMs: number }> = ({ nowMs }) => {
  const entry = useMemo(() => lookupClock(nowMs), [nowMs]);
  if (!entry) return null;
  return (
    <div className='max-w-[80%] text-center'>
      <p className='text-sm leading-relaxed text-white/60'>{entry.line}</p>
      <p className='mt-1 text-xs text-white/30'>
        {entry.hhmm} · {entry.source}
      </p>
    </div>
  );
};

export default LiteraryClock;
