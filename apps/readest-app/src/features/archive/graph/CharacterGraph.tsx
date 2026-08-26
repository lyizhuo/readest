'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';

import { ArchiveDb, type GraphEdgeRecord, type GraphNodeRecord } from '../db/archiveDb';
import { progressiveFilter } from './merge';
import { generateGraph, type GraphChapter } from './runner';

const VIEW_SIZE = 520;
const CENTER = VIEW_SIZE / 2;

interface NodeLayout {
  x: number;
  y: number;
  radius: number;
}

/**
 * Radial character graph (PRD J2/J3): center = highest-degree node,
 * concentric rings by graph distance. Read-time spoiler protection filters
 * to chapters the user has actually read unless they opt into the full view.
 */
const CharacterGraph: React.FC<{
  bookId: string;
  readableChapters?: Set<string>;
  /**
   * Static chapters (reader context) OR a lazy loader (archive detail page,
   * where text extraction needs an explicit user-triggered book open).
   */
  chapters?: GraphChapter[];
  loadChapters?: () => Promise<GraphChapter[]>;
}> = ({ bookId, readableChapters, chapters, loadChapters }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const settings = useSettingsStore((state) => state.settings);

  const [nodes, setNodes] = useState<GraphNodeRecord[]>([]);
  const [edges, setEdges] = useState<GraphEdgeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFullBook, setShowFullBook] = useState(!readableChapters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!appService) return;
    const db = await ArchiveDb.open(appService);
    setNodes(await db.listGraphNodes(bookId));
    setEdges(await db.listGraphEdges(bookId));
  }, [appService, bookId]);

  useEffect(() => {
    void reload()
      .catch(() => setError(_('Failed to load the character graph')))
      .finally(() => setLoading(false));
  }, [reload, _]);

  // PRD J2 hard requirement: progressive view keeps only read-chapter items.
  const visible = useMemo(() => {
    if (showFullBook || !readableChapters) return { nodes, edges };
    return progressiveFilter(nodes, edges, readableChapters);
  }, [showFullBook, readableChapters, nodes, edges]);

  const layout = useMemo(() => {
    return computeRadialLayout(visible.nodes, visible.edges);
  }, [visible.nodes, visible.edges]);

  const selected = selectedId ? visible.nodes.find((n) => n.id === selectedId) : undefined;
  const incidentEdges = useMemo(() => {
    if (!selectedId) return [];
    return visible.edges.filter((e) => e.fromNode === selectedId || e.toNode === selectedId);
  }, [visible.edges, selectedId]);

  const nodeName = useCallback(
    (id: string) => visible.nodes.find((n) => n.id === id)?.name ?? '?',
    [visible.nodes],
  );

  const confirmNode = async (id: string) => {
    if (!appService) return;
    await ArchiveDb.open(appService).then((db) => db.setGraphNodePending(id, false));
    await reload();
  };

  const confirmEdge = async (id: string) => {
    if (!appService) return;
    await ArchiveDb.open(appService).then((db) => db.setGraphEdgePending(id, false));
    await reload();
  };

  const canGenerate = !!appService && (!!chapters?.length || !!loadChapters);
  const runGeneration = async () => {
    if (!appService || !canGenerate || busy) return;
    setBusy(true);
    setError(null);
    try {
      await generateGraph({
        appService,
        settings,
        bookId,
        chapters: chapters ?? (await loadChapters!()),
        onProgress: (done, total) => setProgress({ done, total }),
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  if (loading) {
    return <p className='px-4 pt-4 text-sm opacity-60'>{_('Loading…')}</p>;
  }

  if (visible.nodes.length === 0) {
    return (
      <div className='space-y-3 px-4 pt-4'>
        {error && <p className='text-error text-sm'>{error}</p>}
        {canGenerate ? (
          <>
            <button className='btn btn-primary btn-sm' disabled={busy} onClick={runGeneration}>
              {_('Generate graph')}
            </button>
            {progress && (
              <p className='text-sm opacity-70'>
                {_('Extracting characters')} · {progress.done} / {progress.total}
              </p>
            )}
          </>
        ) : (
          <p className='text-sm opacity-60'>
            {_('No character graph yet — open this book and generate one while reading.')}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className='space-y-3 px-4 pt-4'>
      <div className='flex flex-wrap items-center gap-2'>
        {readableChapters && (
          <div className='join'>
            <button
              className={`btn btn-xs join-item ${showFullBook ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setShowFullBook(true)}
            >
              {_('Show whole book')}
            </button>
            <button
              className={`btn btn-xs join-item ${!showFullBook ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setShowFullBook(false)}
            >
              {_('Read so far')}
            </button>
          </div>
        )}
        {!showFullBook && (
          <span className='badge badge-warning badge-outline badge-xs'>
            {_('Spoiler-free: unread chapters hidden')}
          </span>
        )}
      </div>

      {error && <p className='text-error text-sm'>{error}</p>}
      {progress && (
        <p className='text-sm opacity-70'>
          {_('Extracting characters')} · {progress.done} / {progress.total}
        </p>
      )}

      <div className='flex flex-col gap-4 lg:flex-row'>
        <svg
          viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
          className='w-full max-w-lg text-base-content lg:w-[60%]'
          onClick={() => setSelectedId(null)}
        >
          {visible.edges.map((edge) => {
            const from = layout.positions.get(edge.fromNode);
            const to = layout.positions.get(edge.toNode);
            if (!from || !to) return null;
            return (
              <line
                key={edge.id}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke='currentColor'
                strokeWidth={edge.pending ? 1 : 1.5}
                strokeDasharray={edge.pending ? '4 3' : undefined}
                opacity={0.35}
              />
            );
          })}
          {visible.nodes.map((node) => {
            const pos = layout.positions.get(node.id);
            if (!pos) return null;
            const isSelected = node.id === selectedId;
            return (
              <g key={node.id} onClick={(e) => e.stopPropagation()}>
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={pos.radius}
                  fill='currentColor'
                  className={`cursor-pointer ${isSelected ? 'fill-primary' : 'opacity-40'}`}
                  stroke='currentColor'
                  strokeWidth={isSelected ? 2 : 1}
                  strokeDasharray={node.pending ? '3 2' : undefined}
                  onClick={() => setSelectedId(isSelected ? null : node.id)}
                />
                <text
                  x={pos.x}
                  y={pos.y + pos.radius + 12}
                  textAnchor='middle'
                  fontSize={11}
                  fill='currentColor'
                  className='pointer-events-none select-none'
                >
                  {node.name}
                </text>
              </g>
            );
          })}
        </svg>

        {selected && (
          <aside className='w-full space-y-2 self-start rounded-box border border-base-300 p-3 lg:w-[40%]'>
            <div className='flex items-center justify-between gap-2'>
              <h4 className='font-medium'>{selected.name}</h4>
              {selected.pending && (
                <button
                  className='btn btn-warning btn-xs'
                  onClick={() => void confirmNode(selected.id)}
                >
                  {_('Confirm')}
                </button>
              )}
            </div>
            {selected.description && <p className='text-sm opacity-80'>{selected.description}</p>}
            {selected.aliases.length > 0 && (
              <p className='text-xs opacity-60'>
                {_('Aliases')}: {selected.aliases.join('、')}
              </p>
            )}
            <div className='divider my-1' />
            <h5 className='text-xs font-semibold uppercase opacity-60'>{_('Relations')}</h5>
            {incidentEdges.length === 0 ? (
              <p className='text-sm opacity-50'>{_('No relations recorded')}</p>
            ) : (
              <ul className='space-y-2'>
                {incidentEdges.map((edge) => (
                  <li key={edge.id} className='rounded bg-base-200 p-2 text-sm'>
                    <div className='flex items-center justify-between gap-2'>
                      <span className='font-medium'>
                        {nodeName(edge.fromNode)} — {edge.type} → {nodeName(edge.toNode)}
                      </span>
                      {edge.pending && (
                        <button
                          className='btn btn-warning btn-xs'
                          onClick={() => void confirmEdge(edge.id)}
                        >
                          {_('Confirm')}
                        </button>
                      )}
                    </div>
                    {edge.chapter && <span className='text-xs opacity-60'>{edge.chapter}</span>}
                    <blockquote className='border-l-2 border-base-300 pl-2 text-xs italic opacity-70'>
                      “{edge.evidence}”
                    </blockquote>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>

      {(visible.nodes.some((n) => n.pending) || visible.edges.some((e) => e.pending)) && (
        <p className='text-warning text-xs'>
          {_('Dashed items are low-confidence — review and confirm them.')}
        </p>
      )}
    </div>
  );
};

/**
 * Radial layout: highest-degree node at the center, remaining nodes on
 * concentric rings by BFS distance over the undirected edge set (unreachable
 * nodes land on an outermost loose ring).
 */
function computeRadialLayout(
  nodes: readonly { id: string }[],
  edges: readonly { fromNode: string; toNode: string }[],
): { positions: Map<string, NodeLayout> } {
  const positions = new Map<string, NodeLayout>();
  if (nodes.length === 0) return { positions };

  const degrees = new Map<string, number>();
  for (const node of nodes) degrees.set(node.id, 0);
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) adjacency.set(node.id, new Set());
  for (const edge of edges) {
    if (!degrees.has(edge.fromNode) || !degrees.has(edge.toNode)) continue;
    degrees.set(edge.fromNode, degrees.get(edge.fromNode)! + 1);
    degrees.set(edge.toNode, degrees.get(edge.toNode)! + 1);
    adjacency.get(edge.fromNode)!.add(edge.toNode);
    adjacency.get(edge.toNode)!.add(edge.fromNode);
  }

  let center = nodes[0]!.id;
  let maxDegree = -1;
  for (const [id, degree] of degrees) {
    if (degree > maxDegree) {
      maxDegree = degree;
      center = id;
    }
  }

  const ringOf = new Map<string, number>([[center, 0]]);
  let frontier = [center];
  let maxRing = 0;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id)!) {
        if (!ringOf.has(neighbor)) {
          ringOf.set(neighbor, ringOf.get(id)! + 1);
          maxRing = Math.max(maxRing, ringOf.get(neighbor)!);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  const looseRing = maxRing + 1;
  for (const node of nodes) {
    if (!ringOf.has(node.id)) ringOf.set(node.id, looseRing);
  }

  const radiusFor = (ring: number) =>
    ring === 0 ? 0 : 70 + ((VIEW_SIZE / 2 - 90) * ring) / Math.max(maxRing, looseRing);
  const byRing = new Map<number, string[]>();
  for (const node of nodes) {
    const ring = ringOf.get(node.id)!;
    const list = byRing.get(ring) ?? [];
    list.push(node.id);
    byRing.set(ring, list);
  }
  for (const [ring, ids] of byRing) {
    if (ring === 0) {
      positions.set(ids[0]!, { x: CENTER, y: CENTER, radius: 16 });
      continue;
    }
    ids.forEach((id, index) => {
      const angle = (2 * Math.PI * index) / ids.length + ring * 0.6;
      const radius = radiusFor(ring);
      positions.set(id, {
        x: CENTER + radius * Math.cos(angle),
        y: CENTER + radius * Math.sin(angle),
        radius: 8 + Math.min(degrees.get(id)!, 12),
      });
    });
  }
  return { positions };
}

export default CharacterGraph;
