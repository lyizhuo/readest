import { generateText } from 'ai';

import { getAIProvider } from '@/services/ai/providers';
import type { SystemSettings } from '@/types/settings';

/**
 * Archive AI access layer: single funnel over the upstream provider stack
 * (`@/services/ai/providers`) so every archive AI surface shares the same
 * enablement check and error behavior. Callers render friendly inline
 * messages — a failed/unconfigured model must never crash the page.
 */
export function isAIEnabled(settings: SystemSettings): boolean {
  return settings?.aiSettings?.enabled === true;
}

/** Friendly gate message shared by all archive AI UIs. */
export const AI_DISABLED_HINT = 'AI is turned off. Enable it in Settings to use this.';

/** Shared failure message shown whenever the provider call itself fails. */
export const AI_ERROR_HINT = 'AI request failed. Please check your model settings and retry.';

/**
 * One-shot text completion for archive prompts. Throws when AI is disabled
 * or the provider errors; callers catch and render `AI_ERROR_HINT`.
 */
export async function askAI(
  settings: SystemSettings,
  prompt: string,
  opts?: { system?: string },
): Promise<string> {
  if (!isAIEnabled(settings)) {
    throw new Error('archive-ai: disabled');
  }
  const provider = getAIProvider(settings.aiSettings);
  const result = await generateText({
    model: provider.getModel(),
    system: opts?.system,
    prompt,
  });
  return result.text.trim();
}
