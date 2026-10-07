import type { GeminiModelInfo, Settings } from '../types';
import type { DescribedExercise, DescribeInput } from './shared';

export type { DescribedExercise, DescribedSet, DescribeInput } from './shared';

/**
 * The AI that turns a description into an exercise: Google Gemini with the
 * person's own key (as in the calorie tracker). The provider code is only
 * downloaded when first used.
 */

/** Aliases Google keeps pointing at its newest Flash models. */
export const GEMINI_SHORTCUTS: (GeminiModelInfo & { hint: string })[] = [
  { id: 'gemini-flash-lite-latest', label: 'Flash-Lite (newest)', hint: 'most free uses' },
  { id: 'gemini-flash-latest', label: 'Flash (newest)', hint: 'more accurate' },
];

const MAX_MODELS_TO_TRY = 5;

type AiSettings = Pick<Settings, 'geminiKey' | 'geminiModel' | 'geminiModels' | 'geminiAutoSwitch'>;

/** True when there's a key to use. */
export function aiReady(settings: Pick<Settings, 'geminiKey'>): boolean {
  return settings.geminiKey.trim().length > 0;
}

/** A readable name for a Gemini model ID. */
export function geminiLabel(settings: Pick<Settings, 'geminiModels'>, id: string): string {
  return GEMINI_SHORTCUTS.find((m) => m.id === id)?.label ?? settings.geminiModels.find((m) => m.id === id)?.label ?? id;
}

/**
 * Models to try, in order: the chosen one, then (with automatic switching on)
 * the "newest" aliases and the other Flash models on the key, then one Gemma
 * model. Pro models are left out of switching: free keys can't use them.
 */
export function geminiChain(settings: AiSettings): string[] {
  const chosen = settings.geminiModel;
  if (!settings.geminiAutoSwitch) return [chosen];
  const listed = settings.geminiModels.map((m) => m.id);
  const flash = listed.filter((id) => /^gemini-.*flash/i.test(id));
  const gemma = listed.filter((id) => /^gemma-/i.test(id) && !/-(1b|270m)/i.test(id)).slice(0, 1);
  const order = [chosen, ...GEMINI_SHORTCUTS.map((m) => m.id), ...flash, ...gemma];
  return [...new Set(order)].filter((id) => id === chosen || !/pro/i.test(id)).slice(0, MAX_MODELS_TO_TRY);
}

export interface DescribeResult {
  exercise: DescribedExercise;
  /** Who answered, e.g. "Gemini · Flash-Lite (newest)". */
  source: string;
}

export async function describeExercise(
  settings: AiSettings,
  input: DescribeInput,
  signal?: AbortSignal,
  onProgress?: (message: string) => void,
): Promise<DescribeResult> {
  const { describeWithGemini } = await import('./gemini');
  const { exercise, model } = await describeWithGemini(settings.geminiKey.trim(), geminiChain(settings), input, signal, onProgress, (id) =>
    geminiLabel(settings, id),
  );
  return { exercise, source: `Gemini · ${geminiLabel(settings, model)}` };
}

export async function listGeminiModels(apiKey: string): Promise<GeminiModelInfo[]> {
  const { listGeminiModels } = await import('./gemini');
  return listGeminiModels(apiKey.trim());
}
