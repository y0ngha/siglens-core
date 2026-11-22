import type { BarChangeStatsIndicators } from '@/domain/agent/barStats';
import { calculateMA } from '@/domain/indicators/ma';
import type { Bar } from '@/domain/types';

/**
 * Seeded corpus of random-walk daily bar series for the bar-statistics
 * parity gate. The same seed list is used by the consumer repo's oracle
 * comparison, so both repos test the same inputs: change the generator only
 * together with the committed digest in `barStats.test.ts`.
 */

export const BAR_STATS_CORPUS_SIZE = 2000;
export const BAR_STATS_CORPUS_MAX_LENGTH = 1300;

const UTC_MIDNIGHT_2020_01_01 = Date.UTC(2020, 0, 1) / 1000;
const SECONDS_PER_DAY = 86_400;

/** mulberry32: a small deterministic PRNG, so a seed always yields the same series. */
function mulberry32(seed: number): () => number {
    const state = { value: seed >>> 0 };
    return () => {
        state.value = (state.value + 0x6d2b79f5) >>> 0;
        const t1 = Math.imul(
            state.value ^ (state.value >>> 15),
            1 | state.value
        );
        const t2 = (t1 + Math.imul(t1 ^ (t1 >>> 7), 61 | t1)) ^ t1;
        return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
    };
}

export interface BarStatsCase {
    seed: number;
    bars: Bar[];
    indicators: BarChangeStatsIndicators;
    /** `YYYY-MM-DD` report dates: on bar days, between them, before the series, after it, with duplicates. */
    reportedDates: string[];
    /** Whether the last bar stands for a still-forming session / period. */
    lastBarForming: boolean;
}

const isoDate = (seconds: number): string =>
    new Date(seconds * 1000).toISOString().slice(0, 10);

/** Series length: mostly spread over 0..1300, with the short edge lengths over-represented. */
function lengthFor(seed: number, rng: () => number): number {
    const edge = [0, 1, 2, 3, 20, 21, 22, 60, 200, 251, 252, 253, 452, 453];
    return seed % 4 === 0
        ? edge[Math.floor(rng() * edge.length)]!
        : Math.floor(rng() * (BAR_STATS_CORPUS_MAX_LENGTH + 1));
}

export function makeBarStatsCase(seed: number): BarStatsCase {
    const rng = mulberry32(seed);
    const length = lengthFor(seed, rng);
    const startPrice = 20 + rng() * 480;
    const flatRunProbability = rng() * 0.15;
    const gapProbability = rng() * 0.3;

    // Closes: a random walk with equal-close runs injected.
    const walk = { price: startPrice };
    const closes = Array.from({ length }, () => {
        walk.price =
            rng() < flatRunProbability
                ? walk.price
                : walk.price * (1 + (rng() - 0.5) * 0.06);
        return walk.price;
    });

    // Calendar: daily bars at UTC midnight, with skipped days (weekends, holidays).
    const clock = { time: UTC_MIDNIGHT_2020_01_01 - SECONDS_PER_DAY };
    const times = Array.from({ length }, () => {
        const step = rng() < gapProbability ? 2 + Math.floor(rng() * 3) : 1;
        clock.time += step * SECONDS_PER_DAY;
        return clock.time;
    });

    const bars: Bar[] = closes.map((close, i) => {
        const spread = rng() * 0.03;
        return {
            time: times[i]!,
            open: close * (1 + (rng() - 0.5) * 0.01),
            // Occasionally the high/low sits exactly on the close, to create ties.
            high: close * (1 + (rng() < 0.1 ? 0 : spread)),
            low: close * (1 - (rng() < 0.1 ? 0 : spread)),
            close,
            volume: Math.floor(1e5 + rng() * 1e7),
        };
    });

    // Defects: a few bars get a non-finite or non-positive value.
    const defects: readonly ((bar: Bar) => Bar)[] = [
        bar => ({ ...bar, close: Number.NaN }),
        bar => ({ ...bar, close: Number.POSITIVE_INFINITY }),
        bar => ({ ...bar, high: Number.NaN }),
        bar => ({ ...bar, low: Number.NEGATIVE_INFINITY }),
        bar => ({ ...bar, volume: Number.NaN }),
        bar => ({ ...bar, close: 0 }),
        bar => ({ ...bar, close: -1 }),
    ];
    const defectCount = seed % 3 === 0 ? 1 + Math.floor(rng() * 3) : 0;
    const defectBars = Array.from({ length: defectCount }).reduce<Bar[]>(
        acc => {
            // Bias toward the tail so the last-bar and streak paths see defects.
            const index =
                bars.length === 0
                    ? -1
                    : rng() < 0.5
                      ? bars.length -
                        1 -
                        Math.floor(rng() * Math.min(5, bars.length))
                      : Math.floor(rng() * bars.length);
            const defect = defects[Math.floor(rng() * defects.length)]!;
            return index < 0
                ? acc
                : acc.map((b, i) => (i === index ? defect(b) : b));
        },
        bars
    );

    const reportedDates = Array.from({
        length: Math.floor(rng() * 14),
    }).flatMap(() => {
        const first = times[0] ?? UTC_MIDNIGHT_2020_01_01;
        const lastTime = times.at(-1) ?? first;
        const pick = rng();
        const day =
            pick < 0.4 && times.length > 0
                ? times[Math.floor(rng() * times.length)]!
                : first +
                  Math.floor(
                      (rng() * (lastTime - first + 40 * SECONDS_PER_DAY)) /
                          SECONDS_PER_DAY
                  ) *
                      SECONDS_PER_DAY -
                  10 * SECONDS_PER_DAY;
        return rng() < 0.15 ? [isoDate(day), isoDate(day)] : [isoDate(day)];
    });

    const atr = defectBars.map(b => b.high - b.low);
    const indicators: BarChangeStatsIndicators = {
        atr,
        ma: {
            20: calculateMA(defectBars, 20),
            200: calculateMA(defectBars, 200),
        },
        ema: { 12: calculateMA(defectBars, 12) },
    };

    return {
        seed,
        bars: defectBars,
        indicators,
        reportedDates,
        lastBarForming: rng() < 0.5,
    };
}

export function makeBarStatsCorpus(): BarStatsCase[] {
    return Array.from({ length: BAR_STATS_CORPUS_SIZE }, (_, i) =>
        makeBarStatsCase(i + 1)
    );
}
