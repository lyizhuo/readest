import type { AppService } from '@/types/system';
import type { SystemSettings } from '@/types/settings';

import { askAI, isAIEnabled } from '@/features/archive/ai/client';

import { ArchiveDb, type GraphEdgeInput, type GraphNodeInput } from '../db/archiveDb';
import { buildExtractionPrompt } from './prompts';
import { parseExtraction } from './parse';
import { mergeChapterInto, type MergedGraph } from './merge';
import type { GraphEdgeState, GraphNodeState } from './types';

export interface GraphChapter {
  label: string;
  text: string;
}

export interface GenerateGraphOptions {
  appService: AppService;
  settings: SystemSettings;
  bookId: string;
  /** Chapters supplied by the caller, in reading order. */
  chapters: GraphChapter[];
  onProgress?: (done: number, total: number) => void;
}

/** kv checkpoint for 断点续跑 — survives reloads mid-generation per book. */
interface GraphCheckpoint extends MergedGraph {
  nextIndex: number;
}

function checkpointKey(bookId: string): string {
  return `graph_progress_${bookId}`;
}

async function loadCheckpoint(db: ArchiveDb, bookId: string): Promise<GraphCheckpoint> {
  const raw = await db.getKv(checkpointKey(bookId));
  if (!raw) return { nextIndex: 0, nodes: [], edges: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<GraphCheckpoint> | null;
    if (
      parsed &&
      typeof parsed.nextIndex === 'number' &&
      Number.isInteger(parsed.nextIndex) &&
      parsed.nextIndex >= 0 &&
      Array.isArray(parsed.nodes) &&
      Array.isArray(parsed.edges)
    ) {
      return {
        nextIndex: parsed.nextIndex,
        nodes: parsed.nodes as GraphNodeState[],
        edges: parsed.edges as GraphEdgeState[],
      };
    }
  } catch {
    // Corrupt checkpoint — start over rather than fail the whole run.
  }
  return { nextIndex: 0, nodes: [], edges: [] };
}

/**
 * Generates (or resumes) a full character graph for one book (PRD J):
 * - one askAI call per chapter with a STRICT-JSON extraction prompt;
 * - per-chapter kv checkpoint (`graph_progress_<bookId>`) so an interrupted
 *   run continues where it stopped instead of re-billing every chapter;
 * - low-confidence items (< 0.6) are flagged pending for manual confirmation
 *   (PRD J3);
 * - the accumulated graph replaces any previous graph via replaceGraph.
 * The stored graph is ALWAYS the full-book graph — spoiler-free views are a
 * read-time concern handled by {@link progressiveFilter} in the UI.
 */
export async function generateGraph({
  appService,
  settings,
  bookId,
  chapters,
  onProgress,
}: GenerateGraphOptions): Promise<void> {
  if (!isAIEnabled(settings)) {
    throw new Error('AI is not enabled');
  }
  const db = await ArchiveDb.open(appService);
  let state = await loadCheckpoint(db, bookId);

  for (let i = Math.min(state.nextIndex, chapters.length); i < chapters.length; i++) {
    const chapter = chapters[i]!;
    try {
      const raw = await askAI(settings, buildExtractionPrompt(chapter.label, chapter.text));
      const extraction = parseExtraction(raw);
      if (extraction) {
        state = {
          ...mergeChapterInto(state.nodes, state.edges, extraction, chapter.label),
          nextIndex: i + 1,
        };
      } else {
        state = { ...state, nextIndex: i + 1 };
      }
    } catch {
      // A single failed chapter must not lose prior progress; mark it done.
      state = { ...state, nextIndex: i + 1 };
    }
    await db.setKv(checkpointKey(bookId), JSON.stringify(state));
    onProgress?.(state.nextIndex, chapters.length);
  }

  await db.replaceGraph(bookId, state.nodes as GraphNodeInput[], state.edges as GraphEdgeInput[]);
  // Empty value marks the run complete — no stale resume on regeneration.
  await db.setKv(checkpointKey(bookId), '');
}
