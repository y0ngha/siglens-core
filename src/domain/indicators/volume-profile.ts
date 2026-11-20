import type {
    Bar,
    VolumeProfileResult,
    VolumeProfileRow,
} from '@/domain/types';
import {
    VP_DEFAULT_ROW_SIZE,
    VP_MIN_BARS,
    VP_VALUE_AREA_PERCENTAGE,
} from './constants';

const NO_ADJACENT_BUCKET = -1;

interface ValueAreaState {
    vahIndex: number;
    valIndex: number;
    accumulatedVolume: number;
}

function expandValueArea(
    initialState: ValueAreaState,
    bucketVolumes: number[],
    rowSize: number,
    targetVolume: number
): ValueAreaState {
    let state = initialState;

    while (state.accumulatedVolume < targetVolume) {
        const nextAbove =
            state.vahIndex + 1 < rowSize
                ? bucketVolumes[state.vahIndex + 1]
                : NO_ADJACENT_BUCKET;
        const nextBelow =
            0 <= state.valIndex - 1
                ? bucketVolumes[state.valIndex - 1]
                : NO_ADJACENT_BUCKET;

        if (
            nextAbove === NO_ADJACENT_BUCKET &&
            nextBelow === NO_ADJACENT_BUCKET
        )
            break;

        if (nextAbove >= nextBelow) {
            const newVahIndex = state.vahIndex + 1;
            state = {
                vahIndex: newVahIndex,
                valIndex: state.valIndex,
                accumulatedVolume:
                    state.accumulatedVolume + bucketVolumes[newVahIndex],
            };
        } else {
            const newValIndex = state.valIndex - 1;
            state = {
                vahIndex: state.vahIndex,
                valIndex: newValIndex,
                accumulatedVolume:
                    state.accumulatedVolume + bucketVolumes[newValIndex],
            };
        }
    }

    return state;
}

/**
 * @internal Row count for a profile over `barCount` bars when the window is
 * shorter than {@link VP_MIN_BARS}: the default row count scaled by the window's
 * share of that minimum. 24 rows over 20 bars would leave most rows empty, so a
 * short window gets proportionally fewer. Never fewer than 2 rows (a profile
 * needs a range to split); windows at or above the minimum keep the default.
 */
export function volumeProfileRowsFor(barCount: number): number {
    if (barCount >= VP_MIN_BARS) return VP_DEFAULT_ROW_SIZE;
    return Math.max(
        2,
        Math.round((VP_DEFAULT_ROW_SIZE * barCount) / VP_MIN_BARS)
    );
}

/**
 * @internal Volume Profile — per-price-row volume distribution with POC and value area.
 *
 * @param bars - Bars the profile is built over.
 * @param rowSize - Number of price rows.
 * @param minBars - Fewest bars a profile may be built from. Defaults to
 *   {@link VP_MIN_BARS}; a caller whose whole window is shorter (the short horizon)
 *   passes that window's size, with a matching `rowSize` from
 *   {@link volumeProfileRowsFor}.
 */
export function calculateVolumeProfile(
    bars: Bar[],
    rowSize: number = VP_DEFAULT_ROW_SIZE,
    minBars: number = VP_MIN_BARS
): VolumeProfileResult | null {
    if (bars.length < minBars) return null;

    const highMax = bars.reduce(
        (max: number, bar: Bar) => Math.max(max, bar.high),
        -Infinity
    );
    const lowMin = bars.reduce(
        (min: number, bar: Bar) => Math.min(min, bar.low),
        Infinity
    );
    const priceRange = highMax - lowMin;

    if (priceRange === 0) return null;

    const bucketSize = priceRange / rowSize;

    const bucketVolumes = new Array<number>(rowSize).fill(0);
    for (const bar of bars) {
        const barRange = bar.high - bar.low;
        for (let i = 0; i < rowSize; i++) {
            const bucketLow = lowMin + i * bucketSize;
            const bucketHigh = bucketLow + bucketSize;
            if (barRange === 0) {
                const isLastBucket = i === rowSize - 1;
                const inBucket =
                    (bucketLow <= bar.low && bar.low < bucketHigh) ||
                    (isLastBucket && bar.low === bucketHigh);
                if (inBucket) bucketVolumes[i] += bar.volume;
            } else {
                const overlap =
                    Math.min(bar.high, bucketHigh) -
                    Math.max(bar.low, bucketLow);
                if (overlap > 0) {
                    bucketVolumes[i] += bar.volume * (overlap / barRange);
                }
            }
        }
    }

    const pocIndex = bucketVolumes.reduce(
        (maxIdx: number, vol: number, idx: number) =>
            vol > bucketVolumes[maxIdx] ? idx : maxIdx,
        0
    );

    const totalVolume = bucketVolumes.reduce(
        (sum: number, vol: number) => sum + vol,
        0
    );
    const targetVolume = totalVolume * VP_VALUE_AREA_PERCENTAGE;

    const { vahIndex, valIndex } = expandValueArea(
        {
            vahIndex: pocIndex,
            valIndex: pocIndex,
            accumulatedVolume: bucketVolumes[pocIndex],
        },
        bucketVolumes,
        rowSize,
        targetVolume
    );

    const bucketCenter = (i: number): number =>
        lowMin + i * bucketSize + bucketSize / 2;

    const profile: VolumeProfileRow[] = bucketVolumes.map(
        (volume: number, i: number) => ({
            price: bucketCenter(i),
            volume,
        })
    );

    return {
        poc: bucketCenter(pocIndex),
        vah: bucketCenter(vahIndex),
        val: bucketCenter(valIndex),
        profile,
    };
}
