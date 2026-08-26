import { v4 as uuidv4 } from 'uuid';

import type { ExtractedRelation, GraphExtraction } from './types';
import { GRAPH_PENDING_THRESHOLD, type GraphEdgeState, type GraphNodeState } from './types';

export interface MergedGraph {
  nodes: GraphNodeState[];
  edges: GraphEdgeState[];
}

/**
 * Case-insensitive name/alias lookup over accumulated nodes. Returns the
 * canonical (stored) node name, or null when no node matches.
 */
export function canonicalName(name: string, nodes: GraphNodeState[]): string | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  for (const node of nodes) {
    if (node.name.trim().toLowerCase() === key) return node.name;
    for (const alias of node.aliases) {
      if (alias.trim().toLowerCase() === key) return node.name;
    }
  }
  return null;
}

function normalizeType(type: string): string {
  return type.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Stable dedupe key for edges: UNORDERED endpoint pair + normalized relation
 * type. A→B and B→A of the same type describe the same real-world relation,
 * and replaceGraph's UNIQUE index is orientation-normalized too — keeping the
 * merge layer directed here would silently drop the loser's min-confidence.
 */
function edgeKey(fromId: string, toId: string, type: string): string {
  const [lo, hi] = fromId <= toId ? [fromId, toId] : [toId, fromId];
  return `${lo}|${hi}|${normalizeType(type)}`;
}

function pendingOf(confidence: number): boolean {
  return confidence < GRAPH_PENDING_THRESHOLD;
}

function mergeAliases(existing: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const alias of [...existing, ...incoming]) {
    const key = alias.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(alias.trim());
  }
  return out;
}

/**
 * Folds one chapter's extraction into the running graph state (pure — the
 * input arrays are not mutated):
 * - characters are matched by canonical name/alias (case-insensitive) and
 *   merged (pure); new names become fresh nodes anchored to this chapter;
 * - merged/new nodes keep the EARLIEST known firstChapter and the MIN
 *   confidence across chapters;
 * - relations resolve their endpoints through {@link canonicalName} and dedupe
 *   on from|to|type keeping the earliest chapter + min confidence.
 */
export function mergeChapterInto(
  nodes: GraphNodeState[],
  edges: GraphEdgeState[],
  extraction: GraphExtraction,
  chapterLabel: string,
): MergedGraph {
  const nextNodes: GraphNodeState[] = nodes.map((node) => ({
    ...node,
    aliases: [...node.aliases],
  }));
  const idByName = new Map<string, string>();
  const idOf = (name: string): string | null => {
    const key = name.trim().toLowerCase();
    return idByName.get(key) ?? null;
  };

  for (const char of extraction.characters) {
    const canonical = canonicalName(char.name, nextNodes);
    if (canonical) {
      const node = nextNodes.find((n) => n.name === canonical)!;
      const confidence = Math.min(node.confidence, char.confidence);
      node.aliases = mergeAliases(node.aliases, [char.name, ...char.aliases]);
      node.description = node.description ?? char.description;
      node.firstChapter = node.firstChapter ?? char.firstChapter ?? chapterLabel;
      node.confidence = confidence;
      node.pending = pendingOf(confidence);
      continue;
    }
    const node: GraphNodeState = {
      id: uuidv4(),
      name: char.name,
      aliases: char.aliases,
      description: char.description,
      firstChapter: char.firstChapter ?? chapterLabel,
      firstCfi: null,
      confidence: char.confidence,
      pending: pendingOf(char.confidence),
    };
    nextNodes.push(node);
  }

  // Index every known spelling → node id for endpoint resolution.
  for (const node of nextNodes) {
    idByName.set(node.name.trim().toLowerCase(), node.id);
    for (const alias of node.aliases) {
      if (!idByName.has(alias.trim().toLowerCase())) {
        idByName.set(alias.trim().toLowerCase(), node.id);
      }
    }
  }

  const nextEdges: GraphEdgeState[] = edges.map((edge) => ({ ...edge }));
  const byKey = new Map<string, GraphEdgeState>();
  for (const edge of nextEdges) byKey.set(edgeKey(edge.fromNode, edge.toNode, edge.type), edge);

  for (const rel of extraction.relations as ExtractedRelation[]) {
    const fromId = idOf(rel.from);
    const toId = idOf(rel.to);
    if (!fromId || !toId) continue; // unreachable after parse, kept as a guard
    const key = edgeKey(fromId, toId, rel.type);
    const existing = byKey.get(key);
    if (existing) {
      const confidence = Math.min(existing.confidence, rel.confidence);
      existing.chapter = existing.chapter ?? rel.chapter ?? chapterLabel;
      existing.confidence = confidence;
      existing.pending = pendingOf(confidence);
      continue;
    }
    const edge: GraphEdgeState = {
      id: uuidv4(),
      fromNode: fromId,
      toNode: toId,
      type: rel.type.trim(),
      evidence: rel.evidence,
      chapter: rel.chapter ?? chapterLabel,
      firstCfi: null,
      confidence: rel.confidence,
      pending: pendingOf(rel.confidence),
    };
    nextEdges.push(edge);
    byKey.set(key, edge);
  }

  return { nodes: nextNodes, edges: nextEdges };
}

/**
 * Spoiler-free view (PRD J2 hard requirement): keep only nodes whose
 * firstChapter has been read (nodes with unknown first chapter stay visible),
 * then keep only edges whose BOTH endpoints survive.
 */
export function progressiveFilter(
  nodes: GraphNodeState[],
  edges: GraphEdgeState[],
  readable: Set<string>,
): MergedGraph {
  const kept = nodes.filter((node) => !node.firstChapter || readable.has(node.firstChapter));
  const keptIds = new Set(kept.map((node) => node.id));
  const keptEdges = edges.filter((edge) => keptIds.has(edge.fromNode) && keptIds.has(edge.toNode));
  return { nodes: kept, edges: keptEdges };
}

/**
 * Spoiler gate (PRD J2): the set of chapter labels at or before the reader's
 * current position. A finished book (or a book without a usable CFI) unlocks
 * everything when `finished` is true; without a CFI only nothing is unlocked
 * unless finished — callers decide their own default by passing finished.
 */
export function readableChapterSet(
  toc: { label: string; href?: string; cfi?: string }[],
  currentCfi: string | null,
  finished: boolean,
): Set<string> {
  const labels = toc.map((item) => item.label).filter(Boolean);
  if (finished) return new Set(labels);
  if (!currentCfi) return new Set();
  // TOC entries are stored in reading order; the first entry whose cfi is a
  // prefix of the current CFI marks the boundary chapter.
  const idx = toc.findIndex((item) => item.cfi && currentCfi.startsWith(item.cfi));
  if (idx < 0) return new Set(labels.slice(0, 1));
  return new Set(
    toc
      .slice(0, idx + 1)
      .map((item) => item.label)
      .filter(Boolean),
  );
}
