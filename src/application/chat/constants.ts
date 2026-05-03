import { getAllowedModels } from '@/domain/tier';
import type { ModelId } from '@/domain/types';

export const GEMINI_2_5_FLASH_MODEL = 'gemini-2.5-flash';
export const GEMINI_2_5_FLASH_LITE_MODEL = 'gemini-2.5-flash-lite';
export const GEMINI_2_5_PRO_MODEL = 'gemini-2.5-pro';

/**
 * All valid chat models, derived from the default tier configuration at module
 * load time. Kept exported for backward-compatibility (see `index.ts` and
 * `index.client.ts`).
 *
 * NOTE: This is a static snapshot of `getAllowedModels('pro', TIER_CONFIG)`
 * captured when this module is first evaluated. Consumers that wire up a
 * custom `TierConfig` via dependency injection (for example, when calling
 * `requestChatCompletion`) should rely on the use-case's runtime model check,
 * which derives the allowed list from the resolved tier configuration on each
 * call rather than from this constant.
 */
export const VALID_CHAT_MODELS: readonly ModelId[] = getAllowedModels('pro');
