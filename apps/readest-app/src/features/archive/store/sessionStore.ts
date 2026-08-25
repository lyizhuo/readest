import { create } from 'zustand';

import type { AppService } from '@/types/system';
import { ArchiveDb } from '@/features/archive/db/archiveDb';

/** Auto-pause after this long without reading activity (page turn etc.). */
export const SESSION_IDLE_PAUSE_SEC = 90;
/** Crash-safety checkpoint cadence (PRD B1: worst-case loss ≤ 60s). */
const CHECKPOINT_SEC = 60;
/** An open session untouched for longer than this is stale (crashed/killed). */
const STALE_OPEN_SEC = 180;

export interface ActiveSession {
  id: string;
  bookId: string;
  bookHash: string;
  title: string;
  roundNo: number;
  /** Net seconds already checkpointed into the db row. */
  bankedSec: number;
  /** Epoch ms of the current running stretch; null while paused. */
  lastResumeAt: number | null;
  startedAt: number;
  progressStart: number | null;
  /** Page number at session start (fixed-layout books only). */
  startPage: number | null;
}

export interface FinishSessionInput {
  fraction?: number | null;
  pagesRead?: number | null;
  noteCountDelta?: number;
}

export interface StartSessionInput {
  bookId: string;
  bookHash: string;
  title: string;
  fraction?: number | null;
  startPage?: number | null;
}

interface ArchiveSessionState {
  active: ActiveSession | null;
  todaySeconds: number;
  /** Ticked once per second while a session exists, for reactive digits. */
  nowMs: number;
}

interface ArchiveSessionActions {
  bindAppService: (appService: AppService | null) => void;
  /** Reading activity happened (page turn) — feeds the idle clock. */
  notifyActivity: () => void;
  startForBook: (input: StartSessionInput & { todaySeconds?: number }) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => void;
  /** Background/lock: stop the clock now; next activity resumes seamlessly. */
  pauseAuto: () => Promise<void>;
  finish: (input?: FinishSessionInput) => Promise<void>;
  /** Throws the session away (✕ button) — nothing is recorded. */
  discard: () => Promise<void>;
  refreshToday: () => void;

  /** Lazily enriches the live session with the first reported position. */
  attachProgress: (fraction: number | null, startPage: number | null) => Promise<void>;
}

/** Non-reactive runtime refs kept out of React state. */
const sessionRuntime: {
  appService: AppService | null;
  lastActivityMs: number;
  autoPaused: boolean;
} = { appService: null, lastActivityMs: 0, autoPaused: false };

let ticker: ReturnType<typeof setInterval> | null = null;

function elapsedOf(active: ActiveSession, now: number): number {
  return (
    active.bankedSec +
    (active.lastResumeAt !== null ? Math.floor((now - active.lastResumeAt) / 1000) : 0)
  );
}

async function bankTime(): Promise<void> {
  const state = useArchiveSessionStore.getState();
  const { active } = state;
  if (!active || !sessionRuntime.appService) return;
  const now = Date.now();
  try {
    const db = await ArchiveDb.open(sessionRuntime.appService);
    await db.checkpointSession(active.id, { endedAt: now, durationSec: elapsedOf(active, now) });
    useArchiveSessionStore.setState((prev) => {
      // The checkpoint UPDATE awaited above: the session may have been
      // paused (pause() already persisted its duration) or finished while
      // in flight — never resurrect a stopped clock.
      if (!prev.active || prev.active.id !== active.id || prev.active.lastResumeAt === null) {
        return prev;
      }
      return {
        active: {
          ...prev.active,
          // Bank everything so far and restart the running stretch.
          bankedSec: elapsedOf(prev.active, now),
          lastResumeAt: now,
        },
      };
    });
  } catch (error) {
    console.warn('archive: session checkpoint failed', error);
  }
}

function ensureTicker(): void {
  if (ticker) return;
  ticker = setInterval(() => {
    const { active } = useArchiveSessionStore.getState();
    useArchiveSessionStore.setState({ nowMs: Date.now() });
    if (!active || active.lastResumeAt === null) return;

    const idleMs = Date.now() - sessionRuntime.lastActivityMs;
    if (idleMs > SESSION_IDLE_PAUSE_SEC * 1000) {
      sessionRuntime.autoPaused = true;
      void useArchiveSessionStore.getState().pause();
      return;
    }
    if (elapsedOf(active, Date.now()) - active.bankedSec >= CHECKPOINT_SEC) {
      void bankTime();
    }
  }, 1000);
}

function localDayRange(now = Date.now()): [number, number] {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const start = d.getTime();
  return [start, start + 24 * 3600 * 1000];
}

async function checkpointActive(id: string, bankedSec: number): Promise<void> {
  if (!sessionRuntime.appService) return;
  try {
    const db = await ArchiveDb.open(sessionRuntime.appService);
    await db.checkpointSession(id, { endedAt: Date.now(), durationSec: bankedSec });
  } catch (error) {
    console.warn('archive: pause checkpoint failed', error);
  }
}

export const useArchiveSessionStore = create<ArchiveSessionState & ArchiveSessionActions>(
  (set, get) => ({
    active: null,
    todaySeconds: 0,
    nowMs: 0,

    bindAppService: (appService) => {
      sessionRuntime.appService = appService;
      ensureTicker();
    },

    notifyActivity: () => {
      sessionRuntime.lastActivityMs = Date.now();
      // Turning a page after an idle/background auto-pause seamlessly resumes
      // (the user is clearly still reading); manual pauses stay paused.
      const { active } = get();
      if (sessionRuntime.autoPaused && active && active.lastResumeAt === null) {
        sessionRuntime.autoPaused = false;
        get().resume();
      }
    },

    startForBook: async ({ bookId, bookHash, title, fraction, startPage, todaySeconds }) => {
      const { appService } = sessionRuntime;
      if (!appService) return;
      sessionRuntime.lastActivityMs = Date.now();
      sessionRuntime.autoPaused = false;
      const now = Date.now();
      try {
        const db = await ArchiveDb.open(appService);

        // Resolve open rows left behind by crashes/kills/app switches.
        const opens = await db.listOpenSessions();
        for (const stale of opens) {
          const untouchedMs = now - (stale.endedAt ?? stale.startedAt);
          if (stale.bookId === bookId && untouchedMs < STALE_OPEN_SEC * 1000) {
            // Fresh enough — adopt this session instead of duplicating it.
            set({
              active: {
                id: stale.id,
                bookId,
                bookHash,
                title,
                roundNo: stale.roundNo,
                bankedSec: stale.durationSec,
                lastResumeAt: now,
                startedAt: stale.startedAt,
                progressStart: stale.progressStart,
                startPage: null,
              },
              ...(todaySeconds !== undefined ? { todaySeconds } : {}),
            });
            return;
          }
          await db.finishSession(stale.id, {
            endedAt: stale.endedAt ?? now,
            durationSec: stale.durationSec,
          });
        }

        const profile = await db.getBook(bookId);
        if (!profile) return; // not archived — nothing to track
        let roundNo = profile.currentRound;
        if (profile.status !== 'reading') {
          // Opening a book IS reading (PRD C1 auto-start); from `finished`
          // this also opens the next re-read round (PRD B2).
          await db.setStatus(bookId, 'reading', now);
          roundNo = (await db.getBook(bookId))?.currentRound ?? roundNo;
        }

        const sessionId = await db.startSession({
          bookId,
          roundNo,
          startedAt: now,
          progressStart: fraction ?? null,
        });
        set({
          active: {
            id: sessionId,
            bookId,
            bookHash,
            title,
            roundNo,
            bankedSec: 0,
            lastResumeAt: now,
            startedAt: now,
            progressStart: fraction ?? null,
            startPage: startPage ?? null,
          },
          ...(todaySeconds !== undefined ? { todaySeconds } : {}),
        });
      } catch (error) {
        console.warn('archive: failed to start session', error);
      }
    },

    pause: async () => {
      const { active } = get();
      if (!active || active.lastResumeAt === null) return;
      const now = Date.now();
      const banked = active.bankedSec + Math.max(0, Math.floor((now - active.lastResumeAt) / 1000));
      set({ active: { ...active, bankedSec: banked, lastResumeAt: null } });
      await checkpointActive(active.id, banked);
    },

    resume: () => {
      const { active } = get();
      if (!active || active.lastResumeAt !== null) return;
      sessionRuntime.lastActivityMs = Date.now();
      sessionRuntime.autoPaused = false;
      set({ active: { ...active, lastResumeAt: Date.now() } });
    },

    pauseAuto: async () => {
      const { active } = get();
      if (!active || active.lastResumeAt === null) return;
      sessionRuntime.autoPaused = true;
      await get().pause();
    },

    finish: async (input) => {
      const { active } = get();
      if (!active) return;
      const now = Date.now();
      const total = elapsedOf(active, now);
      const { appService } = sessionRuntime;
      set({ active: null });
      if (!appService) return;
      try {
        const db = await ArchiveDb.open(appService);
        await db.finishSession(active.id, {
          endedAt: now,
          durationSec: total,
          progressEnd: input?.fraction ?? null,
          pagesRead: input?.pagesRead ?? null,
          noteCountDelta: input?.noteCountDelta ?? 0,
        });
        get().refreshToday();
      } catch (error) {
        console.warn('archive: failed to finish session', error);
      }
    },

    discard: async () => {
      const { active } = get();
      if (!active) return;
      set({ active: null });
      const { appService } = sessionRuntime;
      if (!appService) return;
      try {
        const db = await ArchiveDb.open(appService);
        await db.deleteSession(active.id);
        get().refreshToday();
      } catch (error) {
        console.warn('archive: failed to discard session', error);
      }
    },

    refreshToday: () => {
      const appService = sessionRuntime.appService;
      if (!appService) return;
      void (async () => {
        try {
          const db = await ArchiveDb.open(appService);
          const [start, end] = localDayRange();
          set({ todaySeconds: await db.sumSecondsInRange(start, end) });
        } catch (error) {
          console.warn('archive: failed to refresh daily total', error);
        }
      })();
    },

    attachProgress: async (fraction, startPage) => {
      const { active } = get();
      if (!active || active.progressStart !== null) return;
      const appService = sessionRuntime.appService;
      set({
        active: {
          ...active,
          progressStart: fraction ?? null,
          startPage: active.startPage ?? startPage,
        },
      });
      if (!appService || fraction === null) return;
      try {
        const db = await ArchiveDb.open(appService);
        await db.attachSessionProgress(active.id, fraction);
      } catch (error) {
        console.warn('archive: failed to attach progress', error);
      }
    },
  }),
);

type ArchiveSessionStore = ArchiveSessionState & ArchiveSessionActions;

/** Live net seconds of the active session (0 when none). */
export function selectElapsedSeconds(state: ArchiveSessionStore): number {
  const { active, nowMs } = state;
  if (!active) return 0;
  return (
    active.bankedSec +
    (active.lastResumeAt !== null
      ? Math.max(0, Math.floor((nowMs - active.lastResumeAt) / 1000))
      : 0)
  );
}
