import type { UsageActionType } from '@/domain/types';

/** @internal Usage-log action for a premium-model call; shared by chat and agent turns. */
export const PREMIUM_MODEL_USAGE_ACTION =
    'premium_model' satisfies UsageActionType;
