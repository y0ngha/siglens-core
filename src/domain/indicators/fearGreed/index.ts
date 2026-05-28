export type {
    FearGreedLabel,
    FearGreedConfidence,
    FearGreedWarning,
    FearGreedFactorKey,
    FearGreedGroupName,
    FearGreedFactor,
    FearGreedGroup,
    FearGreedSnapshot,
    FearGreedHistoryPoint,
    ComputeFearGreedOptions,
} from '@/domain/indicators/fearGreed/types';

export {
    computeFearGreedIndex,
    computeFearGreedHistory,
} from '@/domain/indicators/fearGreed/walkForward';

export {
    FEAR_GREED_LABEL_CUTOFFS,
    scoreToLabel,
} from '@/domain/indicators/fearGreed/composition';
export { POC_WINDOW_DEFAULT } from '@/domain/indicators/fearGreed/factors';
