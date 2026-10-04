import { getAllowedModels } from '@/domain/tier';
import type { ModelId } from '@/domain/types';

/**
 * Cheapest Gemini line — the fixed model for short structured helper tasks
 * (economic events, indicator translation). News cards moved to DeepSeek in
 * 2026-10 for prefix caching (see `NEWS_CARD_MODEL_ID`).
 *
 * Succeeds `GEMINI_2_5_FLASH_LITE_MODEL`, removed with the 2.5 generation.
 * Free access class, and one of only two Gemini models that can disable
 * thinking outright (`reasoning.off` is `thinkingLevel: 'minimal'`).
 */
export const GEMINI_FLASH_LITE_MODEL = 'gemini-3.5-flash-lite';
/** Default chat + briefing model. DeepSeek V4.1 Flash (non-thinking, free access class). */
export const DEEPSEEK_V4_1_FLASH_MODEL = 'deepseek-v4.1-flash';
/** DeepSeek V4.1 Pro (thinking/reasoning, member access class). */
export const DEEPSEEK_V4_1_PRO_MODEL = 'deepseek-v4.1-pro';

/**
 * All valid chat models, derived from the default tier configuration at module
 * load time. Re-exported from `index.ts` and `index.client.ts` for consumer
 * convenience — do not remove without a semver-major bump.
 *
 * **Static snapshot only.** This list is captured once when this module is
 * first evaluated. Consumers that pass a custom `TierConfig` via dependency
 * injection (e.g. when calling `requestChatCompletion`) should not rely on
 * this constant for runtime model validation — the use-case derives its allowed
 * list from the resolved tier configuration on each call.
 */
export const VALID_CHAT_MODELS: readonly ModelId[] = getAllowedModels('pro');
