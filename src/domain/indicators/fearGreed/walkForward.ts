import type { Bar, BuySellVolumeResult } from '@/domain/types';
import { computeFactorsAtT } from '@/domain/indicators/fearGreed/factors';
import {
    composeSnapshot,
    FEAR_GREED_CONFIDENCE_THRESHOLDS,
} from '@/domain/indicators/fearGreed/composition';
import type {
    ComputeFearGreedOptions,
    FactorValues,
    FearGreedHistoryPoint,
    FearGreedSnapshot,
} from '@/domain/indicators/fearGreed/types';

const POC_WINDOW_DEFAULT = 60;

function buildFactorTS(
    bars: Bar[],
    buySellVolume: BuySellVolumeResult[],
    pocWindow: number
): Array<FactorValues | null> {
    return bars.map((_, t) =>
        computeFactorsAtT(bars, buySellVolume, t, pocWindow)
    );
}

function isoDate(unixSec: number): string {
    return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

/**
 * Snapshot at the latest bar. Walk-forward distribution = factor TS up to t-1.
 * Returns null when the latest factor is uncomputable or sample is below the
 * NORMAL confidence threshold (insufficient data for a reliable percentile).
 */
export function computeFearGreedIndex(
    bars: Bar[],
    buySellVolume: BuySellVolumeResult[],
    options: ComputeFearGreedOptions = {}
): FearGreedSnapshot | null {
    const pocWindow = options.pocWindow ?? POC_WINDOW_DEFAULT;
    if (bars.length === 0) return null;

    const factorTS = buildFactorTS(bars, buySellVolume, pocWindow);
    const t = bars.length - 1;
    const current = factorTS[t];
    if (!current) return null;

    const sample = factorTS
        .slice(0, t)
        .filter((f): f is FactorValues => f !== null);

    return composeSnapshot(current, sample);
}

/**
 * Walk-forward history. For each t, distribution = valid factor TS in [0..t).
 * No look-ahead: subsequent bars never affect score at earlier indices.
 *
 * History entries with score=null indicate the warm-up period (sample below the
 * NORMAL confidence threshold). UI renders these as gaps in the time series.
 */
export function computeFearGreedHistory(
    bars: Bar[],
    buySellVolume: BuySellVolumeResult[],
    options: ComputeFearGreedOptions = {}
): FearGreedHistoryPoint[] {
    const pocWindow = options.pocWindow ?? POC_WINDOW_DEFAULT;
    const factorTS = buildFactorTS(bars, buySellVolume, pocWindow);
    const sample: FactorValues[] = [];
    const out: FearGreedHistoryPoint[] = new Array(bars.length);

    for (let t = 0; t < bars.length; t++) {
        const date = isoDate(bars[t].time);
        const current = factorTS[t];

        if (!current) {
            out[t] = { date, score: null, label: null };
            continue;
        }

        if (sample.length < FEAR_GREED_CONFIDENCE_THRESHOLDS.NORMAL) {
            sample.push(current);
            out[t] = { date, score: null, label: null };
            continue;
        }

        const snap = composeSnapshot(current, sample);
        if (!snap) {
            out[t] = { date, score: null, label: null };
        } else {
            out[t] = { date, score: snap.score, label: snap.label };
        }
        sample.push(current);
    }
    return out;
}
