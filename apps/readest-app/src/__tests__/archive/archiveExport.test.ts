import { describe, it, expect } from 'vitest';

import { renderTemplate } from '@/features/archive/export/template';
import {
  buildMarkdown,
  buildJson,
  buildTxt,
  parseArchiveJson,
  type ExportBundle,
} from '@/features/archive/export/exporters';

function bundle(): ExportBundle {
  return {
    book: {
      bookHash: 'hash1',
      title: '红楼梦',
      subtitle: null,
      authors: ['曹雪芹'],
      translators: [],
      publisher: null,
      publishYear: 1791,
      pageCount: null,
      isbn: null,
      format: 'ebook',
      series: null,
      fictionType: 'fiction',
      description: null,
      rating: 5,
      status: 'finished',
      currentRound: 2,
      tags: ['2026', '经典'],
    },
    rounds: [
      {
        roundNo: 1,
        status: 'finished',
        startedAt: 1000,
        finishedAt: 2000,
        totalSeconds: 3600,
        rating: 4,
        review: null,
      },
    ],
    notes: [
      {
        id: 'n1',
        kind: 'excerpt',
        roundNo: 2,
        text: '满纸荒唐言',
        note: '开篇题眼',
        cfi: 'epubcfi(/6/4)',
        chapter: '第一回 › 甄士隐',
        page: 3,
        progress: 0.0123,
        color: 'yellow',
        tags: [],
        attachments: [],
        createdAt: 5000,
      },
      {
        id: 'n2',
        kind: 'thought',
        roundNo: 2,
        text: '这一段的叙事结构值得二刷',
        note: null,
        cfi: null,
        chapter: null,
        page: null,
        progress: null,
        color: null,
        tags: ['写法'],
        attachments: [],
        createdAt: 6000,
      },
    ],
  };
}

describe('renderTemplate', () => {
  it('substitutes variables and applies fallbacks', () => {
    const out = renderTemplate('{{chapter}} / {{page}} / {{missing|-}}', {
      chapter: '第一章',
      page: null,
    });
    expect(out).toBe('第一章 /  / -');
  });

  it('leaves unknown vars without fallback empty instead of crashing', () => {
    expect(renderTemplate('a{{nope}}b', {})).toBe('ab');
  });
});

describe('buildMarkdown', () => {
  const md = buildMarkdown(
    bundle(),
    '## {{chapter}}\n\n> {{text}}\n\n{{note}}\n\n{{page}} · ^{{noteId}}',
  );

  it('emits YAML frontmatter with L1 metadata', () => {
    expect(md).toContain('title: 红楼梦');
    expect(md).toContain('authors: [曹雪芹]');
    expect(md).toContain('rating: 5');
    expect(md).toContain('status: finished');
    expect(md.startsWith('---')).toBe(true);
  });

  it('renders every note with stable block id (L6)', () => {
    expect(md).toContain('^n1');
    expect(md).toContain('^n2');
  });

  it('includes chapter path and page (L2) and separates 批注 (L4)', () => {
    expect(md).toContain('第一回 › 甄士隐');
    expect(md).toContain('> 满纸荒唐言');
    expect(md).toContain('开篇题眼');
    expect(md).toContain('3 · ^n1');
  });
});

describe('JSON round-trip (PRD E4)', () => {
  it('re-parses to an equal structure', () => {
    const json = buildJson(bundle());
    const parsed = parseArchiveJson(json);
    expect(parsed.book!.bookHash).toBe('hash1');
    expect(parsed.notes).toHaveLength(2);
    expect(parsed.notes![0]!.text).toBe('满纸荒唐言');
    expect(parsed.rounds![0]!.totalSeconds).toBe(3600);
  });

  it('rejects files that are not archive exports', () => {
    expect(() => parseArchiveJson('{"hello": 1}')).toThrow();
    expect(() => parseArchiveJson('not json at all')).toThrow();
  });
});

describe('buildTxt', () => {
  it('renders excerpts as quotes with location meta', () => {
    const txt = buildTxt(bundle());
    expect(txt).toContain('红楼梦');
    expect(txt).toContain('[第一回 › 甄士隐 · p.3 · 1%]');
    expect(txt).toContain('> 满纸荒唐言');
    expect(txt).toContain('※ 开篇题眼');
  });
});
