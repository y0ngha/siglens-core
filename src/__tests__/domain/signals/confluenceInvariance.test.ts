import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { calculateIndicators } from '@/domain/indicators';
import { detectSignals } from '@/domain/signals';
import { evaluateConfluence } from '@/domain/signals/confluence';
import type { ConfluenceSnapshot } from '@/domain/signals/confluence';
import type { Bar } from '@/domain/types';

/**
 * C11e pin: redefining `golden_cross`/`death_cross` as SMA50/SMA200 must leave the
 * confluence tally byte-identical to the SMA20/SMA50 era. The 20/50 votes now ride
 * `short_ma_*` (same `ma` family) and the 50/200 types are excluded from the tally, so
 * a snapshot differs only by those type NAMES. The series are built so SMA50/SMA200
 * crosses occur inside the sampled windows too; if the exclusion of those types were
 * removed, the snapshots (and so the digests) would change. The expected digests below were computed
 * on the pre-C11e code (where the names were still `golden_cross`/`death_cross`) over
 * the same deterministic series; the new names are mapped back before hashing.
 */

const SERIES_SEEDS = [
    { seed: 11, period: 70 },
    { seed: 23, period: 95 },
    { seed: 37, period: 120 },
    { seed: 41, period: 150 },
    { seed: 59, period: 85 },
    { seed: 73, period: 110 },
] as const;

/** Minimum windows (over all series) that must carry a 50/200 cross. */
const LONG_CROSS_FLOOR = 20;

const SERIES_LENGTH = 640;
const FIRST_END = 121;
const LAST_END = 520;
const END_STRIDE = 2;

/** Deterministic PRNG so the series (and so the digests) never drift. */
function mulberry32(seed: number): () => number {
    const state = { a: seed };
    return () => {
        state.a = (state.a + 0x6d2b79f5) >>> 0;
        const t0 = Math.imul(state.a ^ (state.a >>> 15), 1 | state.a);
        const t1 = (t0 + Math.imul(t0 ^ (t0 >>> 7), 61 | t0)) ^ t0;
        return ((t1 ^ (t1 >>> 14)) >>> 0) / 4294967296;
    };
}

/** A cyclical random walk: the drift flips sign every half `period`, so MAs cross often. */
function buildSeries(seed: number, period: number): Bar[] {
    const rand = mulberry32(seed);
    return Array.from({ length: SERIES_LENGTH }, (_, i) => i).reduce<{
        bars: Bar[];
        close: number;
    }>(
        (acc, i) => {
            const drift = 0.004 * Math.sin((2 * Math.PI * i) / period);
            const noise = (rand() + rand() + rand() - 1.5) * 0.012;
            const close = acc.close * Math.exp(drift + noise);
            const bar: Bar = {
                time: 1700000000 + i * 86400,
                open: acc.close,
                high: Math.max(acc.close, close) * 1.004,
                low: Math.min(acc.close, close) * 0.996,
                close,
                volume: Math.round(1000 + rand() * 500),
            };
            return { bars: [...acc.bars, bar], close };
        },
        { bars: [], close: 100 }
    ).bars;
}

const LEGACY_NAME: Readonly<Record<string, string>> = {
    short_ma_bullish_cross: 'golden_cross',
    short_ma_bearish_cross: 'death_cross',
};

const MA_CROSS_NAMES: ReadonlySet<string> = new Set([
    'golden_cross',
    'death_cross',
]);

function legacyNames(types: readonly string[]): string[] {
    return types.map(t => LEGACY_NAME[t] ?? t).sort();
}

function legacyView(snapshot: ConfluenceSnapshot): unknown {
    return {
        ...snapshot,
        bullish: legacyNames(snapshot.bullish),
        bearish: legacyNames(snapshot.bearish),
        freshBullish: legacyNames(snapshot.freshBullish),
        freshBearish: legacyNames(snapshot.freshBearish),
    };
}

interface SeriesDigest {
    readonly digest: string;
    readonly snapshots: number;
    readonly withMaCross: number;
    /** Windows where `detectSignals` reports the 50/200 `golden_cross`/`death_cross`. */
    readonly withLongCross: number;
    readonly triggers: number;
}

function computeDigest(seed: number, period: number): SeriesDigest {
    const bars = buildSeries(seed, period);
    const ends = Array.from(
        { length: Math.floor((LAST_END - FIRST_END) / END_STRIDE) + 1 },
        (_, k) => FIRST_END + k * END_STRIDE
    );
    const views = ends.map(end => {
        const snapshot = evaluateConfluence(bars.slice(0, end), {
            timeframe: '1Day',
        });
        if (snapshot === null) throw new Error(`no snapshot at ${end}`);
        return snapshot;
    });
    const longCross = ends.filter(end => {
        const window = bars.slice(0, end);
        return detectSignals(window, calculateIndicators(window)).some(
            sig => sig.type === 'golden_cross' || sig.type === 'death_cross'
        );
    });
    const legacy = views.map(legacyView);
    const hash = createHash('sha256');
    hash.update(JSON.stringify(legacy));
    return {
        digest: hash.digest('hex'),
        snapshots: views.length,
        withMaCross: views.filter(s =>
            legacyNames([...s.bullish, ...s.bearish]).some(t =>
                MA_CROSS_NAMES.has(t)
            )
        ).length,
        withLongCross: longCross.length,
        triggers: views.filter(s => s.entryTrigger || s.exitTrigger).length,
    };
}

const DIGEST_CACHE = new Map<number, SeriesDigest>();

/** Each series costs ~2 indicator suites per window; compute it once per file. */
function digestOf(seed: number, period: number): SeriesDigest {
    const cached = DIGEST_CACHE.get(seed);
    if (cached !== undefined) return cached;
    const fresh = computeDigest(seed, period);
    DIGEST_CACHE.set(seed, fresh);
    return fresh;
}

const EXPECTED_DIGESTS: Readonly<Record<number, string>> = {
    11: 'cc230c78291b1f0f3b957db81c1c918da7ec970f1aef21947efbada0d3db9a83',
    23: '98d0de8188830800ec4da958bcea3716b4d32aa9f33fe44a4fb79d37c55cf394',
    37: 'd0edddb942d2e8dcdcf169750c495dcf3b1607d5142c05d86b1ca0098b6bf646',
    41: 'f2c1b8e1b71212248ddc0940ab759b7b599684786a985e7a229ec0ae10229498',
    59: '0c32a4d572c2401773bec974265ba328e880f4ee79de3ce98f45dfb898ef7326',
    73: '5299252194a972106d25112b76206524f20b720ea4e82f12111be41e7865715c',
};

describe('evaluateConfluence after the C11e golden-cross redefinition', () => {
    it.each(SERIES_SEEDS)(
        'seed $seed: snapshots equal the 20/50-era output (names mapped back)',
        ({ seed, period }) => {
            const result = digestOf(seed, period);
            expect(result.digest).toBe(EXPECTED_DIGESTS[seed]);
        },
        60_000
    );

    it('the fixtures are not vacuous: 20/50 votes and triggers occur', () => {
        const all = SERIES_SEEDS.map(({ seed, period }) =>
            digestOf(seed, period)
        );
        expect(
            all.reduce((sum, r) => sum + r.withMaCross, 0)
        ).toBeGreaterThanOrEqual(20);
        expect(all.reduce((sum, r) => sum + r.triggers, 0)).toBeGreaterThan(0);
    }, 120_000);

    it('the fixtures contain 50/200 crosses, so dropping their exclusion changes a digest', () => {
        const all = SERIES_SEEDS.map(({ seed, period }) =>
            digestOf(seed, period)
        );
        expect(
            all.reduce((sum, r) => sum + r.withLongCross, 0)
        ).toBeGreaterThanOrEqual(LONG_CROSS_FLOOR);
    }, 120_000);
});
