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
