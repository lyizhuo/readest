import { describe, expect, it } from 'vitest';

import { extractDecision, syncNow } from '@/features/archive/sync/archiveFileSync';
import type { AppService } from '@/types/system';
import type { SystemSettings } from '@/types/settings';

/**
 * PRD H LWW v1 decision matrix — see the table on extractDecision. The flags
 * mean "changed since the recorded baseline"; with no baseline (first
 * contact) they mean "side has content".
 */
describe('extractDecision (PRD H LWW v1)', () => {
  // First contact — no last-sync state.
  it('pushes a local-only archive on first contact', () => {
    expect(extractDecision(true, false, false)).toBe('push');
  });

  it('pulls when only the remote has content on first contact', () => {
    expect(extractDecision(false, true, false)).toBe('pull');
  });

  it('adopts an existing remote even when local also has content on first contact', () => {
    // This device has never seen the remote: never clobber it, pull instead.
    expect(extractDecision(true, true, false)).toBe('pull');
  });

  it('is idle when neither side has content on first contact', () => {
    expect(extractDecision(false, false, false)).toBe('idle');
  });

  // Steady state — a shared baseline exists.
  it('pushes a local-only change', () => {
    expect(extractDecision(true, false, true)).toBe('push');
  });

  it('pulls a remote-only change', () => {
    expect(extractDecision(false, true, true)).toBe('pull');
  });

  it('resolves a double change as conflict with remote winning', () => {
    expect(extractDecision(true, true, true)).toBe('conflict-pull-remote-wins');
  });

  it('is idle when nothing changed against the baseline', () => {
    expect(extractDecision(false, false, true)).toBe('idle');
  });
});

describe('syncNow', () => {
  it('throws archive.sync.noBackend when no third-party backend is enabled', async () => {
    await expect(syncNow({} as unknown as AppService, {} as SystemSettings)).rejects.toThrow(
      'archive.sync.noBackend',
    );
  });
});
