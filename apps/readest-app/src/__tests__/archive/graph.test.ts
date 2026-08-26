import { describe, expect, it } from 'vitest';

import { canonicalName, mergeChapterInto, progressiveFilter } from '@/features/archive/graph/merge';
import { parseExtraction } from '@/features/archive/graph/parse';
import type {
  GraphEdgeState,
  GraphNodeState,
  GraphExtraction,
} from '@/features/archive/graph/types';

function node(partial: Partial<GraphNodeState> & { id: string; name: string }): GraphNodeState {
  return {
    aliases: [],
    description: null,
    firstChapter: null,
    firstCfi: null,
    confidence: 1,
    pending: false,
    ...partial,
  };
}

function edge(
  partial: Partial<GraphEdgeState> & { id: string; fromNode: string; toNode: string },
): GraphEdgeState {
  return {
    type: 'friend',
    evidence: 'quote',
    chapter: null,
    firstCfi: null,
    confidence: 1,
    pending: false,
    ...partial,
  };
}

describe('canonical alias matching', () => {
  const nodes = [
    node({ id: 'n1', name: '林黛玉', aliases: ['颦儿', 'Lin'] }),
    node({ id: 'n2', name: 'Harry Potter', aliases: ['Potter'] }),
  ];

  it('matches by name and alias, case-insensitively', () => {
    expect(canonicalName('林黛玉', nodes)).toBe('林黛玉');
    expect(canonicalName('颦儿', nodes)).toBe('林黛玉');
    expect(canonicalName('potter', nodes)).toBe('Harry Potter');
    expect(canonicalName('HARRY POTTER', nodes)).toBe('Harry Potter');
  });

  it('returns null for unknown names', () => {
    expect(canonicalName('薛蟠', nodes)).toBeNull();
    expect(canonicalName('  ', nodes)).toBeNull();
  });
});

describe('cross-chapter merge', () => {
  const extraction1: GraphExtraction = {
    characters: [
      {
        name: '林黛玉',
        aliases: ['颦儿'],
        description: '多愁善感的才女',
        firstChapter: '第一章',
        confidence: 0.9,
      },
    ],
    relations: [],
  };
  const extraction2: GraphExtraction = {
    characters: [
      {
        name: '颦儿',
        aliases: ['潇湘妃子'],
        description: null,
        firstChapter: '第二章',
        confidence: 0.5,
      },
      {
        name: '贾宝玉',
        aliases: [],
        description: '怡红公子',
        firstChapter: '第二章',
        confidence: 0.8,
      },
    ],
    relations: [
      {
        from: '颦儿',
        to: '贾宝玉',
        type: '知己',
        evidence: '宝玉见了她便觉亲切',
        chapter: '第二章',
        confidence: 0.7,
      },
    ],
  };

  it('merges the same character across chapters keeping earliest chapter + min confidence', () => {
    const afterFirst = mergeChapterInto([], [], extraction1, '第一章');
    expect(afterFirst.nodes).toHaveLength(1);

    const afterSecond = mergeChapterInto(afterFirst.nodes, afterFirst.edges, extraction2, '第二章');
    expect(afterSecond.nodes.map((n) => n.name).sort()).toEqual(['林黛玉', '贾宝玉']);

    const daiyu = afterSecond.nodes.find((n) => n.name === '林黛玉')!;
    // Alias from chapter two folded into the canonical node.
    expect(daiyu.aliases).toContain('潇湘妃子');
    // First appearance stays anchored to the earliest chapter.
    expect(daiyu.firstChapter).toBe('第一章');
    // Confidence degrades to the min; below threshold → manual confirmation.
    expect(daiyu.confidence).toBe(0.5);
    expect(daiyu.pending).toBe(true);
    // Existing description is not overwritten.
    expect(daiyu.description).toBe('多愁善感的才女');
  });

  it('does not mutate its inputs', () => {
    const afterFirst = mergeChapterInto([], [], extraction1, '第一章');
    const snapshot = JSON.stringify(afterFirst.nodes);
    mergeChapterInto(afterFirst.nodes, afterFirst.edges, extraction2, '第二章');
    expect(JSON.stringify(afterFirst.nodes)).toBe(snapshot);
  });
});

describe('edge dedupe by from|to|type', () => {
  const chars = (chapter: string): GraphExtraction => ({
    characters: [
      { name: '甲', aliases: [], description: null, firstChapter: chapter, confidence: 0.9 },
      { name: '乙', aliases: [], description: null, firstChapter: chapter, confidence: 0.9 },
    ],
    relations: [
      {
        from: '甲',
        to: '乙',
        type: 'rival',
        evidence: `第${chapter}章的原文证据`,
        chapter,
        confidence: chapter === '第一章' ? 0.8 : 0.4,
      },
    ],
  });

  it('keeps one edge with earliest chapter + min confidence', () => {
    const first = mergeChapterInto([], [], chars('第一章'), '第一章');
    expect(first.edges).toHaveLength(1);

    const second = mergeChapterInto(first.nodes, first.edges, chars('第二章'), '第二章');
    expect(second.edges).toHaveLength(1);
    expect(second.edges[0]!.chapter).toBe('第一章');
    expect(second.edges[0]!.confidence).toBe(0.4);
    expect(second.edges[0]!.pending).toBe(true);
  });

  it('collapses reversed direction into the same undirected edge (min confidence wins)', () => {
    const first = mergeChapterInto(
      [],
      [],
      {
        characters: chars('c').characters,
        relations: [
          { from: '甲', to: '乙', type: 'Rival', evidence: 'x', chapter: 'c1', confidence: 0.9 },
        ],
      },
      'c1',
    );
    const merged = mergeChapterInto(
      first.nodes,
      first.edges,
      {
        characters: chars('c').characters,
        relations: [
          { from: '乙', to: '甲', type: 'rival', evidence: 'y', chapter: 'c2', confidence: 0.4 },
        ],
      },
      'c2',
    );
    // Undirected pair + case-normalized type → one edge; cautious min confidence.
    expect(merged.edges).toHaveLength(1);
    expect(merged.edges[0]!.confidence).toBe(0.4);
    expect(merged.edges[0]!.pending).toBe(true);
  });
});

describe('parseExtraction rejection rules', () => {
  it('parses fenced output with prose around it', () => {
    const raw =
      'Here you go:\n```json\n{"characters":[{"name":"A","aliases":[],"confidence":0.9}],"relations":[]}\n```\nDone.';
    const parsed = parseExtraction(raw);
    expect(parsed?.characters.map((c) => c.name)).toEqual(['A']);
  });

  it('drops relations without evidence or with unresolvable endpoints', () => {
    const raw = JSON.stringify({
      characters: [
        {
          name: 'Alice',
          aliases: ['Al'],
          description: 'hero',
          firstChapter: 'ch1',
          confidence: 0.9,
        },
      ],
      relations: [
        { from: 'Alice', to: 'Bob', type: 'friend', evidence: '', chapter: 'ch1', confidence: 0.9 },
        {
          from: 'al',
          to: 'Alice',
          type: 'kin',
          evidence: 'they are sisters',
          chapter: 'ch1',
          confidence: 0.8,
        },
        {
          from: 'Alice',
          to: 'Zed',
          type: 'friend',
          evidence: 'real quote',
          chapter: 'ch1',
          confidence: 0.8,
        },
        {
          from: 'Alice',
          to: 'ALICE',
          type: 'self',
          evidence: 'mirror scene',
          chapter: 'ch1',
          confidence: 0.7,
        },
      ],
    });
    const parsed = parseExtraction(raw)!;
    // Empty evidence dropped; 'Zed' not among extracted characters dropped;
    // case-insensitive alias ('al') and name ('ALICE') endpoints resolve.
    expect(parsed.relations.map((r) => r.type)).toEqual(['kin', 'self']);
    expect(parsed.relations[0]).toMatchObject({ from: 'Alice', to: 'Alice' });
  });

  it('returns null for non-JSON answers', () => {
    expect(parseExtraction('Sorry, I cannot help with that.')).toBeNull();
    expect(parseExtraction('{"characters": [{broken')).toBeNull();
  });

  it('clamps out-of-range confidences', () => {
    const parsed = parseExtraction('{"characters":[{"name":"A","confidence":5}],"relations":[]}')!;
    expect(parsed.characters[0]!.confidence).toBe(1);
    const parsed2 = parseExtraction('{"characters":[{"name":"A"}],"relations":[]}')!;
    // Missing confidence defaults to cautious 0.5 (→ pending queue).
    expect(parsed2.characters[0]!.confidence).toBe(0.5);
  });
});

describe('progressive spoiler filter', () => {
  const nodes = [
    node({ id: 'a', name: 'A', firstChapter: 'ch1' }),
    node({ id: 'b', name: 'B', firstChapter: 'ch3' }),
    node({ id: 'c', name: 'C', firstChapter: null }),
  ];
  const edges = [
    edge({ id: 'e1', fromNode: 'a', toNode: 'b' }),
    edge({ id: 'e2', fromNode: 'a', toNode: 'c' }),
  ];

  it('keeps read chapters and unknown-first-chapter nodes, drops the rest', () => {
    const filtered = progressiveFilter(nodes, edges, new Set(['ch1']));
    expect(filtered.nodes.map((n) => n.id).sort()).toEqual(['a', 'c']);
    // Edge into a hidden node must disappear entirely (PRD J2).
    expect(filtered.edges.map((e) => e.id)).toEqual(['e2']);
  });

  it('keeps everything when the whole book has been read', () => {
    const filtered = progressiveFilter(nodes, edges, new Set(['ch1', 'ch3']));
    expect(filtered.nodes).toHaveLength(3);
    expect(filtered.edges).toHaveLength(2);
  });
});
