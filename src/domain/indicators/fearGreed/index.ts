export {
    computeFearGreedIndex,
    computeFearGreedHistory,
} from '@/domain/indicators/fearGreed/walkForward';

export {
    FEAR_GREED_LABEL_CUTOFFS,
    scoreToLabel,
} from '@/domain/indicators/fearGreed/composition';
export { POC_WINDOW_DEFAULT } from '@/domain/indicators/fearGreed/factors';
export {
    computeLabelTransitions,
    computeMarketScoreGap,
    EXTREME_FEAR_GREED_ZONES,
    EXTREME_ZONE_FORWARD_HORIZONS,
    EXTREME_ZONE_MIN_SAMPLE,
    summarizeExtremeZoneOutcomes,
} from '@/domain/indicators/fearGreed/regimeStats';
