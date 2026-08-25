import { ArchiveBook } from '../types';

/**
 * PRD A5 — library CSV export. UTF-8 with BOM so Excel renders Chinese
 * correctly; fields per spec:
 * title, subtitle, authors, translators, publisher, publish_year, page_count,
 * isbn, format, series, fiction_type, status, rating, tags(;-joined),
 * total_reading_minutes, finished_rounds, created_at.
 */
export interface CsvExportRow {
  book: ArchiveBook;
  tags: string[];
  totalReadingMinutes: number;
  finishedRounds: number;
}

/**
 * RFC 4180 quoting plus CWE-1236 mitigation: cells starting with =, +, - or @
 * would execute as spreadsheet formulas (title/authors/tags carry
 * third-party EPUB metadata), so they get a leading `'` guard.
 */
function csvEscape(value: string): string {
  let escaped = value;
  if (/^[=+\-@\t]/.test(escaped)) escaped = `'${escaped}`;
  if (/[",\r\n]/.test(escaped)) escaped = `"${escaped.replaceAll('"', '""')}"`;
  return escaped;
}

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function buildLibraryCsv(rows: CsvExportRow[]): string {
  const header = [
    'title',
    'subtitle',
    'authors',
    'translators',
    'publisher',
    'publish_year',
    'page_count',
    'isbn',
    'format',
    'series',
    'fiction_type',
    'status',
    'rating',
    'tags',
    'total_reading_minutes',
    'finished_rounds',
    'created_at',
  ];

  const lines = [header.join(',')];
  for (const { book, tags, totalReadingMinutes, finishedRounds } of rows) {
    const fields = [
      book.title,
      book.subtitle ?? '',
      book.authors.join(';'),
      book.translators.join(';'),
      book.publisher ?? '',
      book.publishYear != null ? String(book.publishYear) : '',
      book.pageCount != null ? String(book.pageCount) : '',
      book.isbn ?? '',
      book.format,
      book.series ?? '',
      book.fictionType ?? '',
      book.status,
      book.rating != null ? String(book.rating) : '',
      tags.join(';'),
      String(Math.round(totalReadingMinutes)),
      String(finishedRounds),
      fmtDate(book.createdAt),
    ];
    lines.push(fields.map(csvEscape).join(','));
  }
  // BOM first so Excel detects UTF-8.
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
