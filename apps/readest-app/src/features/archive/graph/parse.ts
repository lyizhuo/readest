import type { ExtractedCharacter, GraphExtraction } from './types';

/** Default confidence when the model omits an unparseable one (J3: cautious → pending). */
const DEFAULT_CONFIDENCE = 0.5;

/**
 * Pulls the first balanced `{ ... }` block out of a raw model answer,
 * tolerating ```json fences and surrounding prose.
 */
function extractJsonBlock(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(n)) return DEFAULT_CONFIDENCE;
  return Math.min(1, Math.max(0, n));
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = optionalString(item);
    if (s) out.push(s);
  }
  return out;
}

function parseCharacters(rawList: unknown[]): ExtractedCharacter[] {
  const out: ExtractedCharacter[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const name = optionalString(obj['name']);
    if (!name) continue;
    out.push({
      name,
      aliases: stringArray(obj['aliases']),
      description: optionalString(obj['description']),
      firstChapter: optionalString(obj['firstChapter']),
      confidence: clampConfidence(obj['confidence']),
    });
  }
  return out;
}

interface ExtractedRelation {
  from: string;
  to: string;
  type: string;
  evidence: string;
  chapter: string | null;
  confidence: number;
}

/**
 * Robust parser for one chapter's model output (PRD J3):
 * - strips markdown fences / prose, extracts the first JSON object;
 * - validates shapes and clamps confidences into [0, 1];
 * - DROPS any relation without non-empty verbatim evidence;
 * - DROPS relations whose endpoints cannot be resolved (case-insensitive,
 *   aliases included) to an extracted character.
 * Returns null when no usable JSON object exists at all.
 */
export function parseExtraction(raw: string): GraphExtraction | null {
  const json = extractJsonBlock(raw ?? '');
  if (!json) return null;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;

  const characters = parseCharacters(Array.isArray(obj['characters']) ? obj['characters'] : []);

  // Case-insensitive name/alias → canonical name resolution map.
  const resolve = new Map<string, string>();
  const keyOf = (s: string) => s.trim().toLowerCase();
  for (const ch of characters) {
    if (!resolve.has(keyOf(ch.name))) resolve.set(keyOf(ch.name), ch.name);
    for (const alias of ch.aliases) {
      if (!resolve.has(keyOf(alias))) resolve.set(keyOf(alias), ch.name);
    }
  }

  const relations: ExtractedRelation[] = [];
  const rawRelations = Array.isArray(obj['relations']) ? obj['relations'] : [];
  for (const item of rawRelations) {
    if (!item || typeof item !== 'object') continue;
    const rel = item as Record<string, unknown>;
    // J3 anti-hallucination: evidence is REQUIRED.
    const evidence = optionalString(rel['evidence']);
    const from = optionalString(rel['from']);
    const to = optionalString(rel['to']);
    const type = optionalString(rel['type']);
    if (!evidence || !from || !to || !type) continue;
    const fromName = resolve.get(keyOf(from));
    const toName = resolve.get(keyOf(to));
    if (!fromName || !toName) continue;
    relations.push({
      from: fromName,
      to: toName,
      type,
      evidence,
      chapter: optionalString(rel['chapter']),
      confidence: clampConfidence(rel['confidence']),
    });
  }

  return { characters, relations };
}
