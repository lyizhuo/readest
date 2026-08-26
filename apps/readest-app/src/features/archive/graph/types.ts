import type { GraphEdgeInput, GraphNodeInput } from '../db/archiveDb';

/** One character extracted from a chapter by the LLM (PRD J). */
export interface ExtractedCharacter {
  name: string;
  aliases: string[];
  description: string | null;
  /** Chapter label where the character first appears (per the model). */
  firstChapter: string | null;
  confidence: number;
}

/** One relation extracted from a chapter. `evidence` is REQUIRED (PRD J3). */
export interface ExtractedRelation {
  from: string;
  to: string;
  type: string;
  /** Verbatim short quote from the chapter backing this relation. */
  evidence: string;
  chapter: string | null;
  confidence: number;
}

/** Parsed STRICT-JSON payload of one chapter extraction. */
export interface GraphExtraction {
  characters: ExtractedCharacter[];
  relations: ExtractedRelation[];
}

/**
 * In-memory accumulation form of a graph node — structurally identical to
 * {@link GraphNodeInput} with all optionals resolved, so it can be handed to
 * `ArchiveDb.replaceGraph` directly and serialized into the kv checkpoint.
 */
export interface GraphNodeState extends GraphNodeInput {
  aliases: string[];
  description: string | null;
  firstChapter: string | null;
  firstCfi: string | null;
  confidence: number;
  pending: boolean;
}

/** In-memory accumulation form of a graph edge (see {@link GraphNodeState}). */
export interface GraphEdgeState extends GraphEdgeInput {
  evidence: string;
  chapter: string | null;
  firstCfi: string | null;
  confidence: number;
  pending: boolean;
}

/** Confidence below which a node/edge lands in the manual-confirm queue. */
export const GRAPH_PENDING_THRESHOLD = 0.6;
