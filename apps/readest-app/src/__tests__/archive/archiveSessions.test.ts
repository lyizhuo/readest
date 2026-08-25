import { describe, it, expect, beforeEach } from 'vitest';

import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import type { DatabaseService } from '@/types/database';
import { ArchiveDb } from '@/features/archive/db/archiveDb';

async function freshDb(): Promise<DatabaseService> {
  const db = await NodeDatabaseService.open(':memory:');
  await migrate(db, getMigrations('archive'));
  return db;
}

describe('ArchiveDb sessions', () => {
  let db: DatabaseService;
  let archive: ArchiveDb;
  let bookId: string;

  beforeEach(async () => {
    db = await freshDb();
    archive = ArchiveDb.from(db);
    bookId = await archive.createBook({ bookHash: 's1', title: 'Session Book' });
  });

  it('opens, checkpoints, and finishes a session with round total sync', async () => {
    await archive.setStatus(bookId, 'reading', 1000);
    const id = await archive.startSession({ bookId, roundNo: 1, startedAt: 2000 });

    let opens = await archive.listOpenSessions(bookId);
    expect(opens.map((s) => s.id)).toEqual([id]);

    await archive.checkpointSession(id, { endedAt: 2600, durationSec: 600 });
    await archive.finishSession(id, {
      endedAt: 3000,
      durationSec: 1000,
      progressEnd: 0.5,
      noteCountDelta: 2,
    });

    opens = await archive.listOpenSessions(bookId);
    expect(opens).toEqual([]);

    const sessions = await archive.listSessionsInRange(0, Date.now() + 1);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.durationSec).toBe(1000);
    expect(sessions[0]!.progressEnd).toBe(0.5);
    expect(sessions[0]!.noteCountDelta).toBe(2);
    expect(sessions[0]!.title).toBe('Session Book');

    const rounds = await archive.listRounds(bookId);
    expect(rounds[0]!.totalSeconds).toBe(1000);
  });

  it('sums only closed sessions in range', async () => {
    await archive.setStatus(bookId, 'reading', 1000);
    const a = await archive.startSession({ bookId, roundNo: 1, startedAt: 2000 });
    await archive.finishSession(a, { endedAt: 3000, durationSec: 600 });
    // An open (still running) session must not count toward totals.
    await archive.startSession({ bookId, roundNo: 1, startedAt: 5000 });

    expect(await archive.sumSecondsInRange(0, Date.now() + 1)).toBe(600);
  });

  it('deleting a junk session subtracts from the round total', async () => {
    await archive.setStatus(bookId, 'reading', 1000);
    const a = await archive.startSession({ bookId, roundNo: 1, startedAt: 2000 });
    await archive.finishSession(a, { endedAt: 3000, durationSec: 900 });
    const b = await archive.startSession({ bookId, roundNo: 1, startedAt: 4000 });
    await archive.finishSession(b, { endedAt: 4500, durationSec: 300 });

    await archive.deleteSession(b);

    const rounds = await archive.listRounds(bookId);
    expect(rounds[0]!.totalSeconds).toBe(900);
  });

  it('editing duration updates round total', async () => {
    await archive.setStatus(bookId, 'reading', 1000);
    const a = await archive.startSession({ bookId, roundNo: 1, startedAt: 2000 });
    await archive.finishSession(a, { endedAt: 3000, durationSec: 1200 });

    await archive.updateSessionDuration(a, 60);

    const rounds = await archive.listRounds(bookId);
    expect(rounds[0]!.totalSeconds).toBe(60);
  });
});
