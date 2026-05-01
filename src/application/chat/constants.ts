import { getAllowedModels } from '@/domain/tier';
import type { ModelId } from '@/domain/types';

export const GEMINI_2_5_FLASH_MODEL = 'gemini-2.5-flash';
export const GEMINI_2_5_FLASH_LITE_MODEL = 'gemini-2.5-flash-lite';
export const GEMINI_2_5_PRO_MODEL = 'gemini-2.5-pro';

/** All valid chat models, derived from tier configuration. */
export const VALID_CHAT_MODELS: readonly ModelId[] = getAllowedModels('pro');
