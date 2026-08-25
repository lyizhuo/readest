import { describe, it, expect } from 'vitest';

import { applyStatusTransition } from '@/features/archive/library/statusMachine';
import { buildLibraryCsv } from '@/features/archive/library/csvExport';
import { bookToProfileInput } from '@/features/archive/sync/profileSync';
import { ArchiveBook } from '@/features/archive/types';
import { Book } from '@/types/book';

describe('statusMachine', () => {
  const base = {
    status: 'wish' as const,
    currentRound: 1,
    startedAt: null,
    finishedAt: null,
  };

  it('stamps startedAt when entering reading from wish', () => {
    const t = applyStatusTransition(base, 'reading', 1000);
    expect(t.startedAt).toBe(1000);
    expect(t.currentRound).toBe(1);
    expect(t.roundAction).toBe('open');
    expect(t.finishedAt).toBeNull();
  });

  it('stamps finishedAt when finishing (round closing handled by the DB layer)', () => {
    const reading = { ...base, status: 'reading' as const, startedAt: 1000 };
    const t = applyStatusTransition(reading, 'finished', 2000);
    expect(t.finishedAt).toBe(2000);
    expect(t.roundAction).toBe('none');
    expect(t.currentRound).toBe(1);
  });

  it('keeps the recorded finish date when leaving finished without restarting', () => {
    const finished = {
      status: 'finished' as const,
      currentRound: 1,
      startedAt: 1000,
      finishedAt: 2000,
    };
    for (const target of ['paused', 'abandoned', 'wish'] as const) {
      const t = applyStatusTransition(finished, target, 9000);
      expect(t.finishedAt).toBe(2000);
      expect(t.startedAt).toBe(1000);
    }
  });

  it('bumps round and reopens when restarting from finished', () => {
    const finished = {
      status: 'finished' as const,
      currentRound: 2,
      startedAt: 1000,
      finishedAt: 2000,
    };
    const t = applyStatusTransition(finished, 'reading', 3000);
    expect(t.currentRound).toBe(3);
    expect(t.startedAt).toBe(3000);
    expect(t.finishedAt).toBeNull();
    expect(t.roundAction).toBe('open');
  });

  it('preserves history when abandoning or pausing', () => {
    const reading = { ...base, status: 'reading' as const, startedAt: 1000 };
    for (const target of ['abandoned', 'paused'] as const) {
      const t = applyStatusTransition(reading, target, 5000);
      expect(t.startedAt).toBe(1000);
      expect(t.finishedAt).toBeNull();
      expect(t.roundAction).toBe('none');
    }
  });

  it('resuming from paused keeps the same round and original start', () => {
    const paused = {
      status: 'paused' as const,
      currentRound: 4,
      startedAt: 1000,
      finishedAt: null,
    };
    const t = applyStatusTransition(paused, 'reading', 9000);
    expect(t.currentRound).toBe(4);
    expect(t.startedAt).toBe(1000);
    expect(t.roundAction).toBe('open');
  });
});

function csvRow(overrides: Partial<ArchiveBook>): CsvRowInput {
  return {
    book: {
      id: 'b1',
      bookHash: 'hash',
      title: 'T',
      subtitle: null,
      authors: [],
      translators: [],
      publisher: null,
      publishYear: null,
      pageCount: null,
      isbn: null,
      coverPath: null,
      format: 'ebook',
      series: null,
      fictionType: null,
      description: null,
      rating: null,
      sourceUrl: null,
      createdAt: 0,
      updatedAt: 0,
      status: 'wish',
      currentRound: 1,
      statusStartedAt: null,
      statusFinishedAt: null,
      ...overrides,
    },
    tags: [],
    totalReadingMinutes: 0,
    finishedRounds: 0,
  };
}
type CsvRowInput = Parameters<typeof buildLibraryCsv>[0][number];

describe('buildLibraryCsv', () => {
  it('starts with a UTF-8 BOM and the PRD A5 header row', () => {
    const csv = buildLibraryCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')[0]).toBe(
      'title,subtitle,authors,translators,publisher,publish_year,page_count,isbn,format,series,fiction_type,status,rating,tags,total_reading_minutes,finished_rounds,created_at',
    );
  });

  it('escapes commas and quotes per RFC 4180', () => {
    const csv = buildLibraryCsv([csvRow({ title: 'Say "Hi", Now', authors: ['A, B'] })]);
    const line = csv.split('\r\n')[1]!;
    expect(line.startsWith('"Say ""Hi"", Now",,"A, B",')).toBe(true);
  });

  it('joins tags with semicolons and rounds minutes', () => {
    const rows: CsvRowInput[] = [
      { ...csvRow({ title: 'X' }), tags: ['2026', '豆瓣'], totalReadingMinutes: 12.6 },
    ];
    const line = buildLibraryCsv(rows).split('\r\n')[1]!;
    expect(line).toContain('2026;豆瓣');
    expect(line).toContain(',13,'); // rounded minutes column
    expect(line).not.toContain('12.6');
  });

  it('guards against spreadsheet formula injection for leading =, +, -, @', () => {
    const rows: CsvRowInput[] = [
      csvRow({ title: '=HYPERLINK("http://evil","x")' }),
      csvRow({ title: '-2 + 3', authors: ['@cmd'] }),
    ];
    const lines = buildLibraryCsv(rows).split('\r\n');
    expect(lines[1]!.startsWith('"\'=HYPERLINK')).toBe(true);
    expect(lines[2]).toContain("'-2 + 3");
    expect(lines[2]).toContain("'@cmd");
  });
});

describe('bookToProfileInput', () => {
  const makeBook = (overrides: Partial<Book>): Book =>
    ({
      hash: 'abc123',
      format: 'EPUB',
      title: '百年孤独',
      author: '加西亚·马尔克斯',
      createdAt: 42,
      updatedAt: 42,
      ...overrides,
    }) as Book;

  it('maps file metadata into profile fields', () => {
    const input = bookToProfileInput(
      makeBook({
        metadata: {
          title: '百年孤独',
          author: 'García Márquez',
          publisher: '南海出版公司',
          published: '2011-06-01',
          isbn: '9787544253994',
          subtitle: '50周年纪念版',
          series: '新经典文库',
          description: '布恩迪亚家族',
        } as Book['metadata'],
      }),
    );
    expect(input.bookHash).toBe('abc123');
    expect(input.title).toBe('百年孤独');
    expect(input.publisher).toBe('南海出版公司');
    expect(input.publishYear).toBe(2011);
    expect(input.isbn).toBe('9787544253994');
    expect(input.subtitle).toBe('50周年纪念版');
    expect(input.series).toBe('新经典文库');
    expect(input.coverPath).toBe('abc123/cover.png');
    expect(input.createdAt).toBe(42);
  });

  it('falls back to filename title and keeps author as single contributor', () => {
    const input = bookToProfileInput(makeBook({ title: '', sourceTitle: 'fallback.epub' }));
    expect(input.title).toBe('fallback.epub');
    expect(input.authors).toEqual(['加西亚·马尔克斯']);
  });

  it('returns null year for unparseable published dates', () => {
    const input = bookToProfileInput(
      makeBook({ metadata: { published: 'unknown' } as Book['metadata'] }),
    );
    expect(input.publishYear).toBeNull();
  });
});
