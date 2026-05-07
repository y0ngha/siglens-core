import type { Bar, BuySellVolumeResult } from '@/domain/types';

export type FearGreedLabel =
    | 'EXTREME_FEAR'
    | 'FEAR'
    | 'NEUTRAL'
    | 'GREED'
    | 'EXTREME_GREED';

export type FearGreedConfidence = 'normal' | 'limited' | 'insufficient';

export type FearGreedWarning = 'CHRONIC_WEAKNESS' | 'CHRONIC_STRENGTH' | null;

export type FearGreedFactorKey =
    | 'volume_z'
    | 'buysell_imbalance'
    | 'poc_distance'
    | 'ma200_distance'
    | 'range_position';

export type FearGreedGroupName = 'Flow' | 'Trend';

export interface FearGreedFactor {
    key: FearGreedFactorKey;
    rawValue: number;
    /** 0..100, GREED 쪽이 100 */
    percentile: number;
}

export interface FearGreedGroup {
    name: FearGreedGroupName;
    score: number;
    factors: FearGreedFactor[];
}

export interface FearGreedSnapshot {
    score: number;
    label: FearGreedLabel;
    groups: FearGreedGroup[];
    confidence: FearGreedConfidence;
    sampleSize: number;
    warning: FearGreedWarning;
}

export interface FearGreedHistoryPoint {
    /** ISO 'YYYY-MM-DD' */
    date: string;
    /** null during warm-up or when sample is insufficient */
    score: number | null;
    label: FearGreedLabel | null;
}

export interface ComputeFearGreedOptions {
    /** Volume Profile POC 산출 윈도우. default 60 */
    pocWindow?: number;
}

/** @internal Helper — 5-factor raw value bundle used by factors, composition, and walkForward modules only. */
export interface FactorValues {
    volumeZ: number;
    buySellImb: number;
    pocDist: number;
    ma200Dist: number;
    rangePosition: number;
}

/** @internal Input bundle convenience type — not re-exported from the public API. */
export interface FearGreedInput {
    bars: Bar[];
    buySellVolume: BuySellVolumeResult[];
}
