import { describe, it, expect, beforeEach } from 'vitest';

import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import type { DatabaseService } from '@/types/database';
import { ArchiveDb, resetArchiveDbForTests } from '@/features/archive/db/archiveDb';
import { ensureArchiveEntries } from '@/features/archive/sync/profileSync';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';

async function freshDb(): Promise<DatabaseService> {
  const db = await NodeDatabaseService.open(':memory:');
  await migrate(db, getMigrations('archive'));
  return db;
}

describe('archive migration', () => {
  it('creates the PRD A2 tables', async () => {
    const db = await freshDb();
    const tables = await db.select<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    );
    const names = tables.map((t) => t.name);
    for (const expected of [
      'books',
      'book_files',
      'reading_status',
      'tags',
      'book_tags',
      'reading_rounds',
      '__migrations',
    ]) {
      expect(names).toContain(expected);
    }
  });
});

describe('ArchiveDb', () => {
  let db: DatabaseService;
  let archive: ArchiveDb;

  beforeEach(async () => {
    db = await freshDb();
    archive = ArchiveDb.from(db);
  });

  it('creates a book with default wish status and finds it by hash', async () => {
    const id = await archive.createBook({ bookHash: 'h1', title: '书一', authors: ['作者'] });
    const book = await archive.getBookByHash('h1');
    expect(book).not.toBeNull();
    expect(book!.id).toBe(id);
    expect(book!.status).toBe('wish');
    expect(book!.currentRound).toBe(1);
    expect(book!.authors).toEqual(['作者']);
  });

  it('is idempotent on repeated create with the same hash (UNIQUE)', async () => {
    await archive.createBook({ bookHash: 'dup', title: 'A' });
    await expect(archive.createBook({ bookHash: 'dup', title: 'B' })).rejects.toThrow();
  });

  it('walks the full lifecycle: reading → finished → reading bumps round', async () => {
    const id = await archive.createBook({ bookHash: 'life', title: 'Life' });

    await archive.setStatus(id, 'reading', 1000);
    let book = (await archive.getBook(id))!;
    expect(book.status).toBe('reading');
    expect(book.statusStartedAt).toBe(1000);
    expect((await archive.listRounds(id)).length).toBe(1);

    await archive.setStatus(id, 'finished', 2000);
    book = (await archive.getBook(id))!;
    expect(book.status).toBe('finished');
    expect(book.statusFinishedAt).toBe(2000);
    let rounds = await archive.listRounds(id);
    expect(rounds[0]!.status).toBe('finished');
    expect(rounds[0]!.finishedAt).toBe(2000);

    // Second read: new round, history preserved.
    await archive.setStatus(id, 'reading', 3000);
    book = (await archive.getBook(id))!;
    expect(book.status).toBe('reading');
    expect(book.currentRound).toBe(2);
    expect(book.statusStartedAt).toBe(3000);
    rounds = await archive.listRounds(id);
    expect(rounds.map((r) => r.roundNo)).toEqual([1, 2]);
    expect(rounds[1]!.status).toBe('reading');
  });

  it('materializes round #1 when finishing a book that never was reading', async () => {
    // The common imported-book path: wish → finished directly. Round #1 must
    // exist (finished) so the later restart opens #2 without skipping #1.
    const id = await archive.createBook({ bookHash: 'df1', title: 'DF' });
    await archive.setStatus(id, 'finished', 1000);

    let rounds = await archive.listRounds(id);
    expect(rounds.map((r) => r.roundNo)).toEqual([1]);
    expect(rounds[0]!.status).toBe('finished');
    expect(rounds[0]!.finishedAt).toBe(1000);

    await archive.setStatus(id, 'reading', 2000);
    rounds = await archive.listRounds(id);
    expect(rounds.map((r) => r.roundNo)).toEqual([1, 2]);
    expect(rounds[0]!.status).toBe('finished');
    expect(rounds[1]!.status).toBe('reading');
    expect((await archive.getBook(id))!.currentRound).toBe(2);
  });

  it('pausing and abandoning preserves startedAt', async () => {
    const id = await archive.createBook({ bookHash: 'p1', title: 'P' });
    await archive.setStatus(id, 'reading', 1000);
    await archive.setStatus(id, 'paused', 2000);
    const paused = (await archive.getBook(id))!;
    expect(paused.status).toBe('paused');
    expect(paused.statusStartedAt).toBe(1000);

    await archive.setStatus(id, 'abandoned', 3000);
    const abandoned = (await archive.getBook(id))!;
    expect(abandoned.status).toBe('abandoned');
    expect(abandoned.statusStartedAt).toBe(1000);
  });

  it('keeps finished_at when a finished book is paused or abandoned', async () => {
    const id = await archive.createBook({ bookHash: 'fp1', title: 'FP' });
    await archive.setStatus(id, 'finished', 2000);
    await archive.setStatus(id, 'paused', 3000);
    expect((await archive.getBook(id))!.statusFinishedAt).toBe(2000);
    await archive.setStatus(id, 'abandoned', 4000);
    expect((await archive.getBook(id))!.statusFinishedAt).toBe(2000);
  });

  it('edits metadata without touching untouched fields', async () => {
    const id = await archive.createBook({
      bookHash: 'm1',
      title: 'Old',
      authors: ['A'],
      publisher: 'Pub',
    });
    await archive.updateBookMetadata(id, { title: 'New', rating: 4 });
    const book = (await archive.getBook(id))!;
    expect(book.title).toBe('New');
    expect(book.rating).toBe(4);
    expect(book.publisher).toBe('Pub');
    expect(book.authors).toEqual(['A']);
  });

  it('dedupes tags case-insensitively and replaces book tag sets', async () => {
    const id = await archive.createBook({ bookHash: 't1', title: 'T' });
    await archive.setBookTags(id, ['2026', '豆瓣年度榜']);
    // Case-insensitive duplicate must not create a second tag row.
    await archive.setBookTags(id, ['2026', 'douban']);
    await archive.ensureTag('DOUBAN'); // same key different casing
    expect((await archive.listTags()).length).toBe(3);
    expect(await archive.listBookTagNames(id)).toEqual(['2026', 'douban']);
  });

  it('merges tags and deletes the absorbed one', async () => {
    const id1 = await archive.createBook({ bookHash: 'g1', title: 'G1' });
    const id2 = await archive.createBook({ bookHash: 'g2', title: 'G2' });
    const from = await archive.ensureTag('来源A');
    const into = await archive.ensureTag('来源B');
    await archive.setBookTags(id1, ['来源A']);
    await archive.setBookTags(id2, ['来源B']);

    await archive.mergeTags(from.id, into.id);

    expect(await archive.listBookTagNames(id1)).toEqual(['来源B']);
    expect(await archive.listBookTagNames(id2)).toEqual(['来源B']);
    expect((await archive.listTags()).map((t) => t.name)).toEqual(['来源B']);
  });

  it('finds potential duplicates by normalized title + primary author', async () => {
    const first = await archive.createBook({
      bookHash: 'd1',
      title: '红楼梦',
      authors: ['曹雪芹'],
    });
    await archive.createBook({ bookHash: 'd2', title: '红楼梦 ', authors: ['曹雪芹'] }); // same work
    await archive.createBook({ bookHash: 'd3', title: '红楼梦', authors: ['佚名'] });

    // No exclusion: the queried book itself is included (d3 differs by author).
    const dupesOfFirst = await archive.findPotentialDuplicates('红楼梦', ['曹雪芹']);
    expect(dupesOfFirst.map((b) => b.bookHash).sort()).toEqual(['d1', 'd2'].sort());

    // excludeId keeps self out of the list.
    const dupesExcludingFirst = await archive.findPotentialDuplicates('红楼梦', ['曹雪芹'], first);
    expect(dupesExcludingFirst.map((b) => b.bookHash)).toEqual(['d2']);
  });

  it('deletes a profile with all dependent rows', async () => {
    const id = await archive.createBook({ bookHash: 'x1', title: 'X' });
    await archive.setStatus(id, 'reading', 1000);
    await archive.setBookTags(id, ['tag-x']);
    await archive.deleteBook(id);
    expect(await archive.getBook(id)).toBeNull();
    // book_tags rows cascade away; the tag itself is global and survives.
    expect((await archive.listTags()).map((t) => t.name)).toEqual(['tag-x']);
    expect(await archive.listRounds(id)).toEqual([]);
  });
});

describe('ensureArchiveEntries', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    // The production open() memoizes a module-level singleton; reset it so
    // each test's fresh in-memory db is actually the one being used.
    resetArchiveDbForTests();
    db = await freshDb();
  });

  const makeAppService = () =>
    ({
      openDatabase: async () => db,
    }) as unknown as AppService;

  const makeBook = (overrides: Partial<Book>): Book =>
    ({
      hash: 'k1',
      format: 'EPUB',
      title: '书',
      author: '某人',
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      ...overrides,
    }) as Book;

  it('creates profiles for new books and maps upstream status', async () => {
    const appService = makeAppService();
    const result = await ensureArchiveEntries(appService, [
      makeBook({ hash: 'k1', readingStatus: 'reading' }),
      makeBook({ hash: 'k2' }),
    ]);
    expect(result.created).toBe(2);

    const archive = ArchiveDb.from(db);
    expect((await archive.getBookByHash('k1'))!.status).toBe('reading');
    expect((await archive.getBookByHash('k2'))!.status).toBe('wish');
  });

  it('is idempotent — second run creates nothing', async () => {
    const appService = makeAppService();
    const books = [makeBook({ hash: 'k1' })];
    await ensureArchiveEntries(appService, books);
    const second = await ensureArchiveEntries(appService, books);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('skips tombstoned books', async () => {
    const appService = makeAppService();
    const result = await ensureArchiveEntries(appService, [
      makeBook({ hash: 'gone', deletedAt: Date.now() }),
    ]);
    expect(result.created).toBe(0);
  });

  it('never throws into the caller even when the database fails', async () => {
    const appService = {
      openDatabase: async () => {
        throw new Error('boom');
      },
    } as unknown as AppService;
    const result = await ensureArchiveEntries(appService, [makeBook({})]);
    expect(result.created).toBe(0);
  });
});
