'use client';

import React, { useEffect, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';

import { selectDailyNotes } from './select';
import {
  DAILY_REVIEW_SHOWN_KEY,
  loadDailyCandidates,
  loadReviewState,
  saveReviewState,
  shouldShowForToday,
} from './db';
import DailyReviewModal from './DailyReviewModal';
import type { DailyReviewCandidate } from './select';

/**
 * Mounts the daily note review once per local day on the library page
 * (fork feature, PRD F). The whole flow fails silently: if archive.db can't
 * be opened or the module gate is off, the library renders untouched.
 */
const DailyReviewHost: React.FC = () => {
  const { appService } = useEnv();
  const settings = useSettingsStore((state) => state.settings);
  const [notes, setNotes] = useState<DailyReviewCandidate[] | null>(null);

  useEffect(() => {
    if (settings.archive?.enabled === false) return;
    if (!appService) return;
    let cancelled = false;
    void (async () => {
      try {
        // Guard: at most one review per local calendar day. The day marker is
        // written by the modal's close handler (after content actually shows)
        // so a crash mid-load never silently skips a day; same-day remounts
        // stay quiet because the marker only exists after a real show.
        const state = await loadReviewState(appService);
        if (!state || !shouldShowForToday(state.lastDay, Date.now())) return;
        const candidates = await loadDailyCandidates(appService);
        const picked = selectDailyNotes(candidates, Date.now(), state.shownMap, Math.random);
        if (!cancelled && picked.length > 0) {
          setNotes(picked);
          await saveReviewState(appService, {
            ...state.shownMap,
            ...Object.fromEntries(picked.map((note) => [note.id, Date.now()])),
          });
        }
      } catch {
        // silent — the daily review must never disturb the library page
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appService, settings.archive?.enabled]);

  // Never mount the modal empty: an always-open <dialog> would cover the
  // library and swallow every tap.
  return notes && notes.length > 0 ? (
    <DailyReviewModal notes={notes} onClose={() => setNotes(null)} />
  ) : null;
};

export default DailyReviewHost;

// Re-exported for tests / future callers that key off the kv entry names.
export { DAILY_REVIEW_SHOWN_KEY };
