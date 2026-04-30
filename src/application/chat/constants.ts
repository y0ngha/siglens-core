import type { ChatModel } from '@/domain/types';

export const GEMINI_2_5_FLASH_MODEL = 'gemini-2.5-flash';
export const GEMINI_2_5_FLASH_LITE_MODEL = 'gemini-2.5-flash-lite';
export const GEMINI_2_5_PRO_MODEL = 'gemini-2.5-pro';

export const VALID_CHAT_MODELS = [
    GEMINI_2_5_FLASH_MODEL,
    GEMINI_2_5_FLASH_LITE_MODEL,
    GEMINI_2_5_PRO_MODEL,
] as const satisfies readonly ChatModel[];
