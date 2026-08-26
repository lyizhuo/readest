/**
 * Pure countdown math for the immersive timer page. Deliberately free of
 * store / React dependencies so it stays trivially testable and reusable.
 */

/** Seconds left on a countdown armed at `startedAtMs` for `targetSec`. */
export function computeRemaining(startedAtMs: number, targetSec: number, nowMs: number): number {
  const elapsed = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  return Math.max(0, targetSec - elapsed);
}

/** `MM:SS`; minutes are not wrapped at 60 so 90 min reads `90:00`. */
export function formatRemaining(remainingSec: number): string {
  const total = Math.max(0, Math.floor(remainingSec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** The single tick that should ring the bell: the countdown just hit zero. */
export function shouldNotify(remaining: number): boolean {
  return remaining <= 0;
}
