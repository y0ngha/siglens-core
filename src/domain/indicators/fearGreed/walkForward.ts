import { ISO_DATE_PREFIX_LENGTH } from '@/domain/constants/format';
import { MS_PER_SECOND } from '@/domain/constants/time';
import type { Bar, BuySellVolumeResult } from '@/domain/types';
import {
    computeFactorsAtT,
    computeMa200DisplayDistancePct,
    POC_WINDOW_DEFAULT,
} from '@/domain/indicators/fearGreed/factors';
import { composeSnapshot } from '@/domain/indicators/fearGreed/composition';
import type {
    ComputeFearGreedOptions,
    FactorValues,
    FearGreedHistoryPoint,
    FearGreedSnapshot,
} from '@/domain/indicators/fearGreed/types';

function buildFactorTS(
    bars: Bar[],
    buySellVolume: BuySellVolumeResult[],
    pocWindow: number
): Array<FactorValues | null> {
    return Array.from({ length: bars.length }, (_, t) =>
        computeFactorsAtT(bars, buySellVolume, t, pocWindow)
    );
}

function isoDate(unixSec: number): string {
    return new Date(unixSec * MS_PER_SECOND)
        .toISOString()
        .slice(0, ISO_DATE_PREFIX_LENGTH);
}

/**
 * Snapshot at the latest bar. Walk-forward distribution = factor TS at indices [0..t),
 * where t = bars.length - 1.
 *
 * Returns null when:
 * - bars is empty
 * - the latest factor is uncomputable (e.g. window guards in computeFactorsAtT not met)
 * - composeSnapshot rejects (sample size < LIMITED → confidence 'insufficient')
 *
 * For larger but still-thin samples (LIMITED ≤ sample < NORMAL), the snapshot is
 * returned with confidence='limited' so callers can show a reduced-confidence badge.
 *
 * @param bars - Daily OHLCV bars in chronological order. Must include enough history
 *   for factor windows (≥ MA200/52w window) plus a walk-forward sample.
 * @param buySellVolume - Per-bar buy/sell volume classification, indexed parallel to bars.
 *   Empty entries (`{buyVolume: 0, sellVolume: 0}`) yield buy/sell imbalance = 0.
 * @param options - Optional configuration. `pocWindow` overrides the default 60-bar
 *   Volume Profile window for the POC distance factor.
 * @returns {FearGreedSnapshot | null} FearGreedSnapshot with score, label, group breakdown,
 *   confidence, and warning, or null when the data is insufficient.
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

    const snapshot = composeSnapshot(current, sample);
    if (!snapshot) return null;
    // Display-only; see FearGreedSnapshot.ma200DistancePct. Added after
    // composition so it can never influence the score.
    return {
        ...snapshot,
        ma200DistancePct: computeMa200DisplayDistancePct(bars),
    };
}

/**
 * Walk-forward score history. For each bar t, the distribution = valid factor TS in [0..t).
 * No look-ahead: bars added beyond index i never change `history[i]`.
 *
 * History entries with `score: null` indicate either (a) the factor at t was uncomputable
 * (warm-up before factor windows fully populate) or (b) `composeSnapshot` rejected the
 * sample as insufficient (sample.length below the LIMITED threshold). UI renders these
 * as gaps in the time series. Sample sizes between LIMITED and NORMAL produce a value
 * (consistent with the snapshot API), letting the UI surface a reduced-confidence
 * series during the early walk-forward window.
 *
 * @param bars - Daily OHLCV bars in chronological order.
 * @param buySellVolume - Per-bar buy/sell volume classification, indexed parallel to bars.
 * @param options - Optional configuration. `pocWindow` overrides the default 60.
 * @returns {FearGreedHistoryPoint[]} Array of FearGreedHistoryPoint, length = bars.length.
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
