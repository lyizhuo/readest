import { ArchiveStatus } from '../types';

/**
 * Pure five-state lifecycle rules (PRD A4). No I/O so transitions are unit
 * tested without a database:
 *
 * - entering `reading`: `startedAt` is stamped when unset; re-entering from
 *   `finished` opens a NEW round (`currentRound` + 1);
 * - entering `finished`: `finishedAt` stamped;
 * - `abandoned`/`paused`/`wish` preserve every historical field.
 */
export interface StatusState {
  status: ArchiveStatus;
  currentRound: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface StatusTransition {
  status: ArchiveStatus;
  /** Round number after the transition (bumped when restarting from finished). */
  currentRound: number;
  startedAt: number | null;
  finishedAt: number | null;
  /**
   * Round bookkeeping for the caller:
   * - 'open': ensure an open round row exists for `currentRound`;
   * - 'none': no round mutation.
   */
  roundAction: 'open' | 'none';
}

export function applyStatusTransition(
  current: StatusState,
  target: ArchiveStatus,
  now: number,
): StatusTransition {
  const restarts = current.status === 'finished' && target === 'reading';
  const currentRound = restarts ? current.currentRound + 1 : current.currentRound;

  const startedAt =
    target === 'reading' ? (restarts ? now : (current.startedAt ?? now)) : current.startedAt;
  // Leaving `finished` for a non-reading state must NOT wipe the recorded
  // finish date (e.g. finished → paused keeps its history); only re-entering
  // reading resets it.
  const finishedAt = target === 'finished' ? now : target === 'reading' ? null : current.finishedAt;

  return {
    status: target,
    currentRound,
    startedAt,
    finishedAt,
    roundAction: target === 'reading' ? 'open' : 'none',
  };
}
