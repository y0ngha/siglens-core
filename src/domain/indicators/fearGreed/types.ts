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

export interface FearGreedFactor {
    key: FearGreedFactorKey;
    rawValue: number;
    /** 0..100, GREED 쪽이 100 */
    percentile: number;
}

export interface FearGreedGroup {
    name: 'Flow' | 'Trend';
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
    score: number | null;
    label: FearGreedLabel | null;
}

export interface ComputeFearGreedOptions {
    /** Volume Profile POC 산출 윈도우. default 60 */
    pocWindow?: number;
}

/** 내부 5-factor raw 값 묶음 (private; export 안 함) */
export interface FactorValues {
    volumeZ: number;
    buySellImb: number;
    pocDist: number;
    ma200Dist: number;
    rangePosition: number;
}

/** 입력 묶음 — 컨슈머 호출부 단순화에 도움 */
export interface FearGreedInput {
    bars: Bar[];
    buySellVolume: BuySellVolumeResult[];
}
