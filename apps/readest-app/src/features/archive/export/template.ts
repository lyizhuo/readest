/**
 * Jinja-flavoured template rendering (PRD E3): `{{var}}` tokens with an
 * optional default filter `{{var|fallback}}`. Unknown variables render as
 * empty strings so a hand-edited template never crashes an export.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number | null>,
): string {
  return template.replace(
    /\{\{\s*(\w+)\s*(?:\|\s*([^}]*)\s*)?\}\}/g,
    (_match, name: string, fallback?: string) => {
      const value = vars[name];
      if (value === undefined || value === null) return fallback ?? '';
      return String(value);
    },
  );
}

export const DEFAULT_EXPORT_TEMPLATE_MD = [
  '## {{chapter}}',
  '',
  '> {{text}}',
  '',
  '{{note}}',
  '',
  `{{page}} · {{progress}}% · {{tags}} · ^{{noteId}}`,
  '',
].join('\n');

export const LITERARY_EXPORT_TEMPLATE_MD = [
  '### {{chapter}}',
  '',
  '> {{text}}',
  '',
  '{{note}}',
  '',
  `—— {{page}} 页 · ^{{noteId}}`,
  '',
].join('\n');
