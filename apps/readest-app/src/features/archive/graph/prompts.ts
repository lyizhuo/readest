/**
 * Prompt builder for per-chapter character/relation extraction (PRD J).
 *
 * The model must answer with STRICT JSON only. Anti-hallucination rule J3:
 * every relation carries `evidence` — a verbatim short quote copied from the
 * chapter text — and the parser drops any relation without one.
 */
export function buildExtractionPrompt(chapterLabel: string, text: string): string {
  return `You are extracting the character graph of a book, one chapter at a time.

Chapter: ${chapterLabel}
---
${text}
---
Identify every NAMED character that appears or is clearly referenced in this
chapter, and every significant relationship between them shown in this chapter.

Answer with STRICT JSON only — no markdown fences, no commentary:
{
  "characters": [
    {
      "name": "canonical character name",
      "aliases": ["other names / nicknames used in this chapter"],
      "description": "one short sentence describing the character",
      "firstChapter": "chapter label where the character FIRST appears, or null if you cannot tell",
      "confidence": 0.0
    }
  ],
  "relations": [
    {
      "from": "character name",
      "to": "character name",
      "type": "short relation label e.g. friend / rival / mother",
      "evidence": "VERBATIM short quote from the chapter text proving this relation — copy it exactly, do not paraphrase or invent",
      "chapter": "${chapterLabel}",
      "confidence": 0.0
    }
  ]
}

Hard rules:
- \`evidence\` is REQUIRED for every relation and must be copied verbatim from
  the chapter text above. Relations without real textual evidence are
  hallucinations and will be discarded.
- \`from\` and \`to\` must be names listed in \`characters\`.
- \`confidence\` is a number between 0 and 1 reflecting how certain the
  appearance/relation is from this chapter alone.
- Do not use knowledge outside this chapter to invent characters or relations;
  if unsure, lower the confidence instead.`;
}
