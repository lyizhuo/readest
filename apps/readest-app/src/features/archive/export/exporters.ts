import { renderTemplate } from './template';

/**
 * Six-layer-context exporters (PRD E). Markdown is template-driven; JSON is
 * the full structured projection that round-trips back into the app; TXT is
 * the plain fallback. No quantity limits — ever (PRD E4).
 */

export interface ExportNote {
  id: string;
  kind: 'excerpt' | 'thought';
  roundNo: number;
  /** Excerpt原文 / thought正文 */
  text: string;
  /** 我的批注（与摘录分离，PRD E2/L4） */
  note: string | null;
  cfi: string | null;
  chapter: string | null;
  page: number | null;
  progress: number | null;
  color: string | null;
  tags: string[];
  attachments: string[];
  createdAt: number;
}

export interface ExportRound {
  roundNo: number;
  status: string;
  startedAt: number | null;
  finishedAt: number | null;
  totalSeconds: number;
  rating: number | null;
  review: string | null;
}

export interface ExportBook {
  /** Upstream Book.hash — the import key for round-tripping. */
  bookHash: string | null;
  title: string;
  subtitle: string | null;
  authors: string[];
  translators: string[];
  publisher: string | null;
  publishYear: number | null;
  pageCount: number | null;
  isbn: string | null;
  format: string;
  series: string | null;
  fictionType: string | null;
  description: string | null;
  rating: number | null;
  status: string;
  currentRound: number;
  tags: string[];
}

export interface ExportBundle {
  book: ExportBook;
  rounds: ExportRound[];
  notes: ExportNote[];
}

function fmtDate(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function yamlEscape(value: string): string {
  return /[:#\[\]{}"']/.test(value) ? `"${value.replaceAll('"', String.raw`\"`)}"` : value;
}

export function buildMarkdown(bundle: ExportBundle, noteTemplate: string): string {
  const { book, rounds, notes } = bundle;
  const frontmatter = [
    '---',
    `title: ${yamlEscape(book.title)}`,
    ...(book.subtitle ? [`subtitle: ${yamlEscape(book.subtitle)}`] : []),
    `authors: [${book.authors.map(yamlEscape).join(', ')}]`,
    ...(book.translators.length > 0
      ? [`translators: [${book.translators.map(yamlEscape).join(', ')}]`]
      : []),
    ...(book.publisher ? [`publisher: ${yamlEscape(book.publisher)}`] : []),
    ...(book.publishYear != null ? [`publish_year: ${book.publishYear}`] : []),
    ...(book.isbn ? [`isbn: "${book.isbn}"`] : []),
    `format: ${book.format}`,
    ...(book.series ? [`series: ${yamlEscape(book.series)}`] : []),
    ...(book.fictionType ? [`fiction_type: ${book.fictionType}`] : []),
    `status: ${book.status}`,
    `rounds_finished: ${rounds.filter((r) => r.status === 'finished').length}`,
    ...(book.rating != null ? [`rating: ${book.rating}`] : []),
    ...(book.tags.length > 0 ? [`tags: [${book.tags.map(yamlEscape).join(', ')}]`] : []),
    '---',
    '',
    `# ${book.title}`,
    '',
  ].join('\n');

  const body = notes
    .map((note) => {
      const rendered = renderTemplate(noteTemplate, {
        chapter: note.chapter ?? '',
        text: note.text,
        note: note.note ?? '',
        page: note.page ?? '',
        progress: note.progress != null ? Math.round(note.progress * 100) : '',
        tags: note.tags.join(', '),
        date: fmtDate(note.createdAt),
        cfi: note.cfi ?? '',
        noteId: note.id,
        title: book.title,
        author: book.authors.join(', '),
        round: note.roundNo,
      });
      return rendered.trimEnd();
    })
    .join('\n\n');

  const roundsSection =
    rounds.length > 0
      ? ['\n---\n', '## 阅读轮次'].concat(
          rounds.map(
            (r) =>
              `- 第 ${r.roundNo} 轮 · ${r.status} · ${fmtDate(r.startedAt)} → ${fmtDate(r.finishedAt)} · ${Math.round(r.totalSeconds / 60)} min${r.review ? ` · ${r.review}` : ''}`,
          ),
          '\n',
        )
      : [];

  return `${frontmatter}\n${body}${roundsSection.join('\n')}\n`;
}

/** Plain-text fallback (PRD E3). */
export function buildTxt(bundle: ExportBundle): string {
  const { book, notes } = bundle;
  const header = [
    book.title,
    book.authors.join(', '),
    book.translators.length > 0 ? `译：${book.translators.join(', ')}` : '',
    ''.padEnd(40, '='),
    '',
  ]
    .filter(Boolean)
    .join('\n');

  const lines = notes.map((note) => {
    const meta = [
      note.chapter ?? '',
      note.page != null ? `p.${note.page}` : '',
      note.progress != null ? `${Math.round(note.progress * 100)}%` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const parts = [`[${meta}]`];
    if (note.kind === 'excerpt') parts.push(`> ${note.text}`);
    if (note.note) parts.push(`※ ${note.note}`);
    if (note.tags.length > 0) parts.push(`标签：${note.tags.join('、')}`);
    parts.push(`^${note.id}`, '');
    return parts.join('\n');
  });

  return `${header}\n${lines.join('\n')}`;
}

/** Full structured projection (PRD E3 JSON); safe to import back. */
export function buildJson(bundle: ExportBundle): string {
  return JSON.stringify({ version: 1, exportedAt: Date.now(), ...bundle }, null, 2);
}

export interface ImportableExport {
  book?: Partial<ExportBook>;
  rounds?: ExportRound[];
  notes?: ExportNote[];
}

/** Parses our own JSON export; throws on shape mismatch. */
export function parseArchiveJson(raw: string): ImportableExport {
  const parsed = JSON.parse(raw) as ImportableExport & { version?: number };
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.notes)) {
    throw new Error('Invalid archive export file');
  }
  return parsed;
}
