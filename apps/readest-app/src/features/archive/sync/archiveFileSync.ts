// PRD H — last-writer-wins (LWW v1) sync of the whole reading-archive
// database (archive.db) over the user's third-party file-sync backend.
//
// The unit of sync is the entire SQLite file, exactly like the TTS pack sync
// treats immutable packs: whichever side changed since the last recorded sync
// state wins wholesale. The loser's bytes are preserved as a timestamped
// backup BEFORE the winner overwrites them, so LWW never destroys data
// outright — it only defers merging to the user (PRD H explicitly defers
// row-level merge to a later version).
//
// Baseline bookkeeping lives in archive.db's kv table:
//   - 'archive_sync_last'  ISO timestamp of the last completed pass
//   - 'archive_sync_state' JSON { size, etag } of what this device last
//     observed on BOTH sides after a successful pass (local size + remote
//     head). No state = first contact from this device.
//
// Deletions never propagate (same stance as ttsPackSync): a missing remote
// file reads as "remote unchanged", so an emptied remote can never wipe a
// healthy local archive; the next local push simply recreates it.

import type { AppService } from '@/types/system';
import type { SystemSettings } from '@/types/settings';
import { getActiveFileSyncBackends } from '@/services/sync/cloudSyncProvider';
import { createFileSyncProvider } from '@/services/sync/file/providerRegistry';
import type { FileHead, FileSyncProvider } from '@/services/sync/file/provider';
import { ArchiveDb, resetArchiveDbSingleton } from '@/features/archive/db/archiveDb';

const LOCAL_DB_NAME = 'archive.db';
const REMOTE_DIR_NAME = 'archive';
const KV_LAST_SYNC = 'archive_sync_last';
const KV_LAST_STATE = 'archive_sync_state';

/** What this device last recorded about both sides after a finished pass. */
interface LastSyncState {
  size?: number;
  remoteSize?: number;
  etag?: string;
  /** FNV-1a of the local bytes at last sync — catches same-size in-place edits. */
  localHash?: string;
  /** FNV-1a of the remote bytes at last sync (null when never read). */
  remoteHash?: string | null;
}

/**
 * Cheap content fingerprint (FNV-1a, hex). SQLite rewrites pages in place,
 * so equal-size edits are common — size alone cannot detect them.
 */
const hashBytes = (bytes: ArrayBuffer): string => {
  const view = new Uint8Array(bytes);
  let h = 0x811c9dc5;
  for (let i = 0; i < view.length; i++) {
    h ^= view[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
};

/**
 * Decision matrix (PRD H, LWW v1). `lastSyncStateExists === false` means
 * first contact: there is no shared baseline, so the flags really mean
 * "this side has content".
 *
 * | last-sync state | localChanged | remoteChanged | decision                    |
 * |-----------------|--------------|---------------|-----------------------------|
 * | absent          | yes          | no            | push                        |
 * | absent          | no           | yes           | pull                        |
 * | absent          | yes          | yes           | pull (first-contact adopts) |
 * | absent          | no           | no            | idle                        |
 * | present         | yes          | no            | push                        |
 * | present         | no           | yes           | pull                        |
 * | present         | yes          | yes           | conflict-pull-remote-wins   |
 * | present         | no           | no            | idle                        |
 *
 * Rationale for the two non-obvious rows:
 *  - First contact with content on BOTH sides resolves to a plain pull: this
 *    device has never seen the remote, so it must adopt it instead of
 *    gambling on which bytes are newer. The caller still backs up the local
 *    bytes before overwriting, so nothing is lost.
 *  - A genuine double-change against a KNOWN baseline is the one true
 *    conflict case; per PRD H it resolves remote-wins with the loser backed
 *    up. 'conflict-push-local-wins' stays in the union for a future explicit
 *    "use this device" override — v1 never emits it.
 */
export type ArchiveSyncDecision =
  | 'push'
  | 'pull'
  | 'conflict-pull-remote-wins'
  | 'conflict-push-local-wins'
  | 'idle';

export const extractDecision = (
  localChanged: boolean,
  remoteChanged: boolean,
  lastSyncStateExists: boolean,
): ArchiveSyncDecision => {
  if (!lastSyncStateExists) {
    if (remoteChanged) return 'pull';
    return localChanged ? 'push' : 'idle';
  }
  if (localChanged && remoteChanged) return 'conflict-pull-remote-wins';
  if (localChanged) return 'push';
  if (remoteChanged) return 'pull';
  return 'idle';
};

/** yyyymmddHHMMSS local-time stamp for backup filenames (PRD H naming). */
const backupStamp = (d = new Date()): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
};

const parseState = (raw: string): LastSyncState | null => {
  try {
    const parsed = JSON.parse(raw) as LastSyncState;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const bytesEqual = (a: ArrayBuffer, b: ArrayBuffer): boolean => {
  if (a.byteLength !== b.byteLength) return false;
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  for (let i = 0; i < va.length; i++) {
    if (va[i] !== vb[i]) return false;
  }
  return true;
};

/**
 * One manual sync pass. Returns a human-readable source string (translation
 * key) describing the outcome; callers render it through `_()`. Throws
 * Error('archive.sync.noBackend')
 * when no third-party file-sync backend is enabled/usable.
 */
export const syncNow = async (
  appService: AppService,
  settings: SystemSettings,
): Promise<string> => {
  // Same backend pick as the library sync / TTS packs: highest-priority
  // active third-party backend, honoring the plan pause gate (#4959).
  const backend = getActiveFileSyncBackends(settings)[0];
  const provider: FileSyncProvider | null = backend
    ? await createFileSyncProvider(backend, settings)
    : null;
  if (!provider) throw new Error('archive.sync.noBackend');

  const db = await ArchiveDb.open(appService);
  const remotePath = `${provider.rootPath}/${REMOTE_DIR_NAME}/${LOCAL_DB_NAME}`;

  const head: FileHead | null = await provider.head(remotePath);

  let localBytes: ArrayBuffer | null = null;
  try {
    localBytes = (await appService.readFile(LOCAL_DB_NAME, 'Data', 'binary')) as ArrayBuffer;
  } catch {
    // No local archive yet — reads as "local empty", never fatal.
    localBytes = null;
  }

  // Size-0 anomaly guard: a zero-byte side carries no recoverable data and
  // would poison the baseline (a later real file would always look "changed").
  // Skip the whole pass without touching either side.
  if ((localBytes !== null && localBytes.byteLength === 0) || (head?.size ?? -1) === 0) {
    await db.setKv(KV_LAST_SYNC, new Date().toISOString());
    return 'Skipped sync: an archive file is empty.';
  }

  const stateRaw = await db.getKv(KV_LAST_STATE);
  const lastState = stateRaw ? parseState(stateRaw) : null;

  // Change detection is content-based: the file bytes are already in memory
  // locally, so a cheap FNV-1a hash catches same-size in-place SQLite page
  // edits that a size check would miss. Remote side prefers etag; when the
  // backend omits one we fall back to reading + hashing the remote bytes.
  const localHash = localBytes ? hashBytes(localBytes) : undefined;
  const remoteChangedByHead = head
    ? !lastState ||
      (head.etag && lastState.etag
        ? head.etag !== lastState.etag
        : (head.size ?? -1) !== (lastState.remoteSize ?? -1))
    : false;
  let remoteChanged = remoteChangedByHead;
  if (head && !remoteChanged && remoteChangedByHead === false && lastState?.etag && !head.etag) {
    // Size-unchanged but this backend has no etag: confirm via content hash.
    const probe = await provider.readBinary(remotePath);
    if (probe && probe.byteLength > 0) {
      remoteChanged = hashBytes(probe) !== lastState.remoteHash;
    }
  }
  const localChanged = lastState
    ? localBytes !== null &&
      (localHash !== lastState.localHash || localBytes.byteLength !== (lastState.size ?? -1))
    : localBytes !== null;

  const decision = extractDecision(localChanged, remoteChanged, stateRaw !== null);
  switch (decision) {
    case 'push':
    // 'conflict-push-local-wins' is reserved for a future explicit
    // "use this device" override; if it ever fires it behaves exactly like a
    // push whose remote loser gets backed up first.
    case 'conflict-push-local-wins': {
      await provider.ensureDir([`${provider.rootPath}/${REMOTE_DIR_NAME}`]);
      if (head && (head.size ?? 0) > 0) {
        // Loser preservation (PRD H): the remote is about to be overwritten.
        const remoteBytes = await provider.readBinary(remotePath);
        if (remoteBytes && remoteBytes.byteLength > 0) {
          await provider.writeBinary(
            `${provider.rootPath}/${REMOTE_DIR_NAME}/archive.backup-${backupStamp()}.db`,
            remoteBytes,
          );
        }
      }
      await provider.writeBinary(remotePath, localBytes!);
      await db.setKv(KV_LAST_SYNC, new Date().toISOString());
      await db.setKv(
        KV_LAST_STATE,
        JSON.stringify({
          size: localBytes!.byteLength,
          localHash,
          etag: head?.etag,
          remoteSize: head?.size,
          remoteHash: null,
        } satisfies LastSyncState),
      );
      return 'Reading archive uploaded.';
    }

    case 'pull':
    // True conflict against a known baseline resolves remote-wins in v1
    // (PRD H) — identical mechanics to a pull, and the shared block below
    // backs the local loser up before overwriting it.
    case 'conflict-pull-remote-wins': {
      const remoteBytes = await provider.readBinary(remotePath);
      if (!remoteBytes || remoteBytes.byteLength === 0) {
        await db.setKv(KV_LAST_SYNC, new Date().toISOString());
        return 'Skipped sync: an archive file is empty.';
      }
      if (
        localBytes !== null &&
        localBytes.byteLength > 0 &&
        !bytesEqual(localBytes, remoteBytes)
      ) {
        // Loser preservation (PRD H): local loses every pull — copy it into
        // Data BEFORE the overwrite so a stale device keeps its divergent data.
        await appService.writeFile(`archive.backup-${backupStamp()}.db`, 'Data', localBytes);
      }
      await appService.writeFile(LOCAL_DB_NAME, 'Data', remoteBytes);
      // ArchiveDb memoizes its open promise because OPFS allows only one
      // access handle per file; the handle now points at bytes we just
      // replaced. resetArchiveDbSingleton drops that memoized open so the next
      // ArchiveDb.open re-reads the freshly written file instead of serving
      // stale pre-pull pages.
      resetArchiveDbSingleton();
      const freshDb = await ArchiveDb.open(appService);
      await freshDb.setKv(KV_LAST_SYNC, new Date().toISOString());
      await freshDb.setKv(
        KV_LAST_STATE,
        JSON.stringify({
          size: head?.size ?? remoteBytes.byteLength,
          etag: head?.etag,
          localHash: hashBytes(remoteBytes),
          remoteHash: hashBytes(remoteBytes),
          remoteSize: head?.size,
        } satisfies LastSyncState),
      );
      return decision === 'pull'
        ? 'Reading archive updated from remote.'
        : 'Remote copy won the sync conflict. Your local changes were backed up.';
    }

    case 'idle': {
      await db.setKv(KV_LAST_SYNC, new Date().toISOString());
      await db.setKv(
        KV_LAST_STATE,
        JSON.stringify({
          size: localBytes?.byteLength,
          etag: head?.etag,
          localHash,
          remoteSize: head?.size,
          remoteHash: lastState?.remoteHash ?? null,
        } satisfies LastSyncState),
      );
      return 'Reading archive is up to date.';
    }
  }
};

const KV_LAST_AUTO = 'archive_sync_last_auto';
const AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // at most every 6 hours

/**
 * Fire-and-forget auto sync (PRD H): runs when the archive home mounts and
 * the autoSync toggle is on, throttled to one attempt per AUTO_SYNC_INTERVAL.
 * Every failure is silent — auto sync must never disturb the UI.
 */
export async function maybeAutoSync(
  appService: AppService,
  settings: SystemSettings,
): Promise<void> {
  try {
    if (settings.archive?.enabled === false || settings.archive?.autoSync !== true) return;
    const db = await ArchiveDb.open(appService);
    if (await db.getKv(KV_LAST_AUTO)) {
      const last = Number(await db.getKv(KV_LAST_AUTO));
      if (Number.isFinite(last) && Date.now() - last < AUTO_SYNC_INTERVAL_MS) return;
    }
    await db.setKv(KV_LAST_AUTO, String(Date.now()));
    await syncNow(appService, settings);
  } catch (error) {
    console.warn('archive: auto sync skipped', error);
  }
}
