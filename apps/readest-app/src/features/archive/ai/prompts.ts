/**
 * Chinese-output prompt builders for the archive AI surfaces (PRD I).
 * All builders return plain strings; answers are expected back as
 * structured Markdown which the UI renders verbatim (pre-wrap).
 */

export interface PreReadInput {
  title: string;
  authors: string[];
  publisher?: string | null;
  publishYear?: number | null;
  fictionType?: 'fiction' | 'nonfiction' | null;
  description?: string | null;
  rating?: number | null;
}

const CHINESE_MD = '请用简体中文回答，输出使用 Markdown（小标题 + 要点），不要复述本指令。';

/** Ask-AI prompt for one excerpt; the reader question is optional. */
export function askAboutExcerpt(
  excerpt: { text?: string; note?: string },
  question?: string,
): string {
  const parts = [
    `我在读书时划了一段重点：`,
    excerpt.text ? `「${excerpt.text}」` : '',
    excerpt.note ? `我的批注：${excerpt.note}` : '',
    question
      ? `我的问题：${question}`
      : `请解释这段话的含义、背景或值得注意之处，并给出一个延伸思考的角度。`,
    CHINESE_MD,
  ];
  return parts.filter(Boolean).join('\n');
}

/** 值不值得读 — pre-read assessment from archive metadata only. */
export function preReadAssessment(input: PreReadInput): string {
  const meta = [
    `书名：${input.title}`,
    input.authors.length > 0 ? `作者：${input.authors.join('、')}` : '',
    input.publisher ? `出版社：${input.publisher}` : '',
    input.publishYear != null ? `出版年份：${input.publishYear}` : '',
    input.fictionType ? `类型：${input.fictionType === 'fiction' ? '小说' : '非虚构'}` : '',
    input.description ? `内容简介：${input.description}` : '',
    input.rating != null ? `我的历史评分：${input.rating}/5` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    `我正在考虑是否（重）读下面这本书，请基于这些信息给出一份“值不值得读”的评估：`,
    meta,
    ``,
    `请按以下结构输出：`,
    `## 一句话结论`,
    `## 这本书的独特价值`,
    `- 2~4 个要点`,
    `## 适合谁 / 不适合谁`,
    `- 各 1~3 个要点`,
    `## 阅读建议`,
    `- 怎么读更高效（跳读、精读、配合什么资料等）`,
    ``,
    `信息不足时明确说明推测成分，不要编造具体情节或数据。`,
    CHINESE_MD,
  ].join('\n');
}

/**
 * Chapter outline prompt: one spoiler-light teaser line per chapter, in the
 * exact input order so the caller can zip lines back to TOC items.
 */
export function chapterOutline(input: {
  title: string;
  authors: string[];
  description?: string | null;
  chapters: string[];
}): string {
  return [
    `请为《${input.title}》${input.authors.length > 0 ? `（作者：${input.authors.join('、')}）` : ''}生成章节大纲预告。`,
    input.description ? `内容简介：${input.description}` : '',
    ``,
    `要求：每一章给一句不超过 40 字的预告，只做导读，绝不剧透关键情节转折和结局。`,
    `严格按下面的章节顺序逐章输出，每行格式为：- 章节标题：预告`,
    `不要输出多余的小标题或说明。`,
    ``,
    ...input.chapters.map((label, idx) => `${idx + 1}. ${label}`),
    ``,
    CHINESE_MD,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** Extracts the per-chapter teaser lines from an outline answer. */
export function parseOutlineLines(answer: string): string[] {
  return answer
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^([-*•]|\d+[.、)])/.test(line))
    .map((line) =>
      line
        .replace(/^([-*•]|\d+[.、)])\s*/, '')
        .replace(/\*\*/g, '')
        .trim(),
    )
    .filter(Boolean);
}
