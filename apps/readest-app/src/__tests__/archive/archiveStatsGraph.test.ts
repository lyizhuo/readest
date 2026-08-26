import { describe, it, expect, beforeEach } from 'vitest';

import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import type { DatabaseService } from '@/types/database';
import { ArchiveDb, resetArchiveDbForTests } from '@/features/archive/db/archiveDb';

async function freshDb(): Promise<DatabaseService> {
  const db = await NodeDatabaseService.open(':memory:');
  await migrate(db, getMigrations('archive'));
  return db;
}

describe('stats meta aggregation source', () => {
  let db: DatabaseService;
  let archive: ArchiveDb;

  beforeEach(async () => {
    resetArchiveDbForTests();
    db = await freshDb();
    archive = ArchiveDb.from(db);
  });

  it('joins session rows with book metadata for range aggregation', async () => {
    const paper = await archive.createBook({
      bookHash: 'm1',
      title: '纸质书',
      authors: ['甲'],
      format: 'paper',
    });
    const ebook = await archive.createBook({
      bookHash: 'm2',
      title: '电子书',
      authors: ['乙', '丙'],
      publisher: '某社',
      fictionType: 'fiction',
    });
    await archive.updateBookMetadata(ebook, { rating: 4 });
    await archive.setStatus(paper, 'reading', 1000);
    await archive.setStatus(ebook, 'reading', 1000);
    const s1 = await archive.startSession({ bookId: paper, roundNo: 1, startedAt: 2000 });
    await archive.finishSession(s1, { endedAt: 3000, durationSec: 1800 });
    const s2 = await archive.startSession({ bookId: ebook, roundNo: 1, startedAt: 5000 });
    await archive.finishSession(s2, { endedAt: 5600, durationSec: 600 });

    // Open session must not appear.
    await archive.startSession({ bookId: ebook, roundNo: 1, startedAt: 9000 });

    const rows = await archive.listSessionsWithMeta(0, Date.now() + 1);
    expect(rows).toHaveLength(2);

    const byBook = new Map(rows.map((r) => [r.title, r]));
    expect(byBook.get('纸质书')!.authors).toEqual(['甲']);
    expect(byBook.get('纸质书')!.format).toBe('paper');
    expect(byBook.get('电子书')!.publisher).toBe('某社');
    expect(byBook.get('电子书')!.fictionType).toBe('fiction');
    expect(byBook.get('电子书')!.rating).toBe(4);

    const totalSec = rows.reduce((sum, r) => sum + r.durationSec, 0);
    expect(totalSec).toBe(2400);
  });
});

describe('graph DAO', () => {
  let db: DatabaseService;
  let archive: ArchiveDb;
  let bookId: string;

  beforeEach(async () => {
    resetArchiveDbForTests();
    db = await freshDb();
    archive = ArchiveDb.from(db);
    bookId = await archive.createBook({ bookHash: 'g1', title: 'Graph Book' });
  });

  it('replaces and lists a full graph with alias/pending round-trip', async () => {
    await archive.replaceGraph(
      bookId,
      [
        {
          id: 'n1',
          name: '奥雷里亚诺上校',
          aliases: ['奥雷里亚诺·布恩迪亚'],
          description: '革命军首领',
          firstChapter: '第一章',
          firstCfi: 'epubcfi(/6/2)',
          confidence: 0.95,
        },
        {
          id: 'n2',
          name: '乌尔苏拉',
          description: '家族女主人',
          firstChapter: '第一章',
          confidence: 0.5,
          pending: true,
        },
      ],
      [
        {
          id: 'e1',
          fromNode: 'n1',
          toNode: 'n2',
          type: '亲缘',
          evidence: '她的儿子',
          chapter: '第一章',
          confidence: 0.9,
        },
        {
          id: 'e2',
          fromNode: 'n2',
          toNode: 'n1',
          type: '亲缘',
          evidence: '反向重复关系',
          chapter: '第二章',
          confidence: 0.8,
        },
      ],
    );

    const nodes = await archive.listGraphNodes(bookId);
    expect(nodes.map((n) => n.name)).toEqual(['奥雷里亚诺上校', '乌尔苏拉']);
    expect(nodes[0]!.aliases).toEqual(['奥雷里亚诺·布恩迪亚']);
    expect(nodes[1]!.pending).toBe(true);

    const edges = await archive.listGraphEdges(bookId);
    expect(edges).toHaveLength(1); // orientation-normalized dedupe collapses e2
    expect(edges[0]!.evidence).toBe('她的儿子');

    // Re-replace clears previous content entirely.
    await archive.replaceGraph(bookId, [], []);
    expect(await archive.listGraphNodes(bookId)).toEqual([]);
    expect(await archive.listGraphEdges(bookId)).toEqual([]);
  });

  it('toggles pending flags independently for nodes and edges', async () => {
    await archive.replaceGraph(
      bookId,
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      [{ id: 'ab', fromNode: 'a', toNode: 'b', type: '对立', evidence: 'quote' }],
    );
    await archive.setGraphNodePending('a', true);
    await archive.setGraphEdgePending('ab', true);

    expect((await archive.listGraphNodes(bookId)).find((n) => n.id === 'a')!.pending).toBe(true);
    expect((await archive.listGraphEdges(bookId))[0]!.pending).toBe(true);

    await archive.setGraphNodePending('a', false);
    await archive.setGraphEdgePending('ab', false);
    expect((await archive.listGraphNodes(bookId)).find((n) => n.id === 'a')!.pending).toBe(false);
    expect((await archive.listGraphEdges(bookId))[0]!.pending).toBe(false);
  });
});
