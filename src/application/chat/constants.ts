import { getAllowedModels } from '@/domain/tier';
import type { ModelId } from '@/domain/types';

export const GEMINI_2_5_FLASH_MODEL = 'gemini-2.5-flash';
export const GEMINI_2_5_FLASH_LITE_MODEL = 'gemini-2.5-flash-lite';
export const GEMINI_2_5_PRO_MODEL = 'gemini-2.5-pro';

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
