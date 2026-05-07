import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bar, BuySellVolumeResult } from '@/domain/types';
import {
    computeFactorsAtT,
    FEAR_GREED_MIN_FACTOR_WINDOW,
} from '@/domain/indicators/fearGreed/factors';
import { calculateVolumeProfile } from '@/domain/indicators/volume-profile';

// Use vi.hoisted so the original-implementation holder is initialised before
// the vi.mock factory runs (vi.mock is hoisted to the top of the file). Direct
// `let` at module scope hits TDZ because the factory executes before the let
// declaration is reached.
const mockState = vi.hoisted(() => ({
    original: null as
        | (typeof import('@/domain/indicators/volume-profile'))['calculateVolumeProfile']
        | null,
}));

// Mock the volume-profile module so individual tests can override return values
// for the !vp / vp.poc===0 / ma200===0 branches; default behaviour delegates to
// the real implementation so the rest of the suite remains realistic.
vi.mock('@/domain/indicators/volume-profile', async () => {
    const actual = await vi.importActual<
        typeof import('@/domain/indicators/volume-profile')
    >('@/domain/indicators/volume-profile');
    mockState.original = actual.calculateVolumeProfile;
    return {
        ...actual,
        calculateVolumeProfile: vi.fn(actual.calculateVolumeProfile),
    };
});

function fakeBar(time: number, close: number, volume: number): Bar {
    return {
        time,
        open: close,
        high: close * 1.01,
        low: close * 0.99,
        close,
        volume,
    };
}

/**
 * 250+ bars with mild variance so the spec's strict guards (volume std != 0,
 * POC has ≥ 30 bars, MA200/RANGE have ≥ 30 bars) are all satisfied. Without
 * variance the rolling-volume std becomes 0 and the function correctly returns null.
 */
function genBars(
    count: number,
    options: {
        priceTrend?: number; // per-bar increment, default 0.1
        baseVolume?: number; // base volume, default 1_000_000
        volumeJitter?: number; // ± volume variance, default 50_000
        priceJitter?: number; // ± price wiggle, default 0.5
    } = {}
): Bar[] {
    const {
        priceTrend = 0.1,
        baseVolume = 1_000_000,
        volumeJitter = 50_000,
        priceJitter = 0.5,
    } = options;
    return Array.from({ length: count }, (_, i) => {
        const close = 100 + i * priceTrend + ((i % 7) - 3) * priceJitter * 0.1;
        const volume = baseVolume + ((i % 11) - 5) * volumeJitter * 0.2;
        return fakeBar(i + 1, close, volume);
    });
}

describe('computeFactorsAtT', () => {
    beforeEach(() => {
        // Reset to delegating to the real implementation between tests so the
        // mocked module behaves identically to the real one unless a test
        // overrides it via mockReturnValueOnce.
        if (mockState.original === null) {
            throw new Error(
                'volume-profile mock factory did not capture the original implementation'
            );
        }
        vi.mocked(calculateVolumeProfile).mockImplementation(
            mockState.original
        );
    });

    afterEach(() => {
        vi.mocked(calculateVolumeProfile).mockReset();
    });

    it('returns null when t < 1', () => {
        const bars = [fakeBar(1, 100, 1_000_000)];
        const bsv: BuySellVolumeResult[] = [{ buyVolume: 0, sellVolume: 0 }];
        expect(computeFactorsAtT(bars, bsv, 0)).toBeNull();
    });

    it('returns null when pre-t window is too small for MA200/RANGE guards', () => {
        const bars = genBars(FEAR_GREED_MIN_FACTOR_WINDOW - 10);
        const bsv: BuySellVolumeResult[] = bars.map(() => ({
            buyVolume: 0,
            sellVolume: 0,
        }));
        expect(computeFactorsAtT(bars, bsv, bars.length - 1)).toBeNull();
    });

    it('returns null when t < MIN_ROLLING_GUARD (volSamples window too small)', () => {
        const bars = genBars(10);
        const bsv: BuySellVolumeResult[] = bars.map(() => ({
            buyVolume: 0,
            sellVolume: 0,
        }));
        expect(computeFactorsAtT(bars, bsv, 3)).toBeNull();
    });

    it('returns null when pocWindow is below MIN_ROLLING_GUARD (pocBars guard)', () => {
        const bars = genBars(250);
        const bsv: BuySellVolumeResult[] = bars.map(() => ({
            buyVolume: 0,
            sellVolume: 0,
        }));
        expect(computeFactorsAtT(bars, bsv, 10, 2)).toBeNull();
    });

    it('returns null when volume std is zero (all volumes identical in window)', () => {
        const bars = genBars(250, { volumeJitter: 0 });
        const bsv: BuySellVolumeResult[] = bars.map(() => ({
            buyVolume: 0,
            sellVolume: 0,
        }));
        expect(computeFactorsAtT(bars, bsv, bars.length - 1)).toBeNull();
    });

    it('returns null when calculateVolumeProfile returns null', () => {
        vi.mocked(calculateVolumeProfile).mockReturnValueOnce(null);
        const bars = genBars(250);
        const bsv: BuySellVolumeResult[] = bars.map(() => ({
            buyVolume: 0,
            sellVolume: 0,
        }));
        expect(computeFactorsAtT(bars, bsv, bars.length - 1)).toBeNull();
    });

    it('returns null when calculateVolumeProfile yields poc === 0', () => {
        vi.mocked(calculateVolumeProfile).mockReturnValueOnce({
            poc: 0,
            vah: 1,
            val: 0,
            profile: [],
        });
        const bars = genBars(250);
        const bsv: BuySellVolumeResult[] = bars.map(() => ({
            buyVolume: 0,
            sellVolume: 0,
        }));
        expect(computeFactorsAtT(bars, bsv, bars.length - 1)).toBeNull();
    });

    it('returns null when MA200 average is zero', () => {
        // Prior 200 closes all 0 forces ma200 === 0. The volume-profile call
        // would normally return null on a zero-price window (priceRange === 0);
        // mocking it to a valid POC isolates the ma200 === 0 guard so we test
        // that branch in isolation rather than tripping !vp first.
        vi.mocked(calculateVolumeProfile).mockReturnValueOnce({
            poc: 50,
            vah: 60,
            val: 40,
            profile: [],
        });
        const baseBars: Bar[] = Array.from({ length: 250 }, (_, i) => ({
            time: i + 1,
            open: 0,
            high: 0,
            low: 0,
            close: 0,
            volume: 1_000_000 + ((i % 11) - 5) * 10_000,
        }));
        baseBars[249] = {
            ...baseBars[249],
            open: 50,
            close: 100,
            high: 100,
            low: 0,
        };
        const bsv: BuySellVolumeResult[] = baseBars.map(() => ({
            buyVolume: 0,
            sellVolume: 0,
        }));
        expect(computeFactorsAtT(baseBars, bsv, 249)).toBeNull();
    });

    it('returns rangePosition 0.5 when 252w window has identical high and low', () => {
        // All bars use high=low=100; volumes still vary so the volume-z guard
        // passes. Last bar's close moved a hair so dailyReturn != 0 yet the
        // 52-week range remains a single point. The volume-profile call would
        // also return null on a zero-priceRange window; mock it to a valid POC
        // so the rangePosition guard is what's exercised.
        vi.mocked(calculateVolumeProfile).mockReturnValueOnce({
            poc: 100,
            vah: 100,
            val: 100,
            profile: [],
        });
        const bars: Bar[] = Array.from({ length: 250 }, (_, i) => ({
            time: i + 1,
            open: 100,
            high: 100,
            low: 100,
            close: 100,
            volume: 1_000_000 + ((i % 11) - 5) * 10_000,
        }));
        bars[249] = {
            ...bars[249],
            close: 100.1,
            volume: 5_000_000,
        };
        const bsv: BuySellVolumeResult[] = bars.map(() => ({
            buyVolume: 0,
            sellVolume: 0,
        }));
        const result = computeFactorsAtT(bars, bsv, 249);
        expect(result?.rangePosition).toBe(0.5);
    });

    it('returns positive volumeZ when volume spike on up day', () => {
        const baseBars = genBars(250); // 250 bars with variance — passes all guards
        const last = baseBars[baseBars.length - 1];
        const spikeBar: Bar = {
            ...last,
            close: last.close + 5,
            high: (last.close + 5) * 1.01,
            low: (last.close + 5) * 0.99,
            volume: 5_000_000,
        };
        const bars = [...baseBars.slice(0, -1), spikeBar];
        const bsv: BuySellVolumeResult[] = bars.map(() => ({
            buyVolume: 600_000,
            sellVolume: 400_000,
        }));
        const result = computeFactorsAtT(bars, bsv, bars.length - 1);
        expect(result).not.toBeNull();
        expect(result!.volumeZ).toBeGreaterThan(0);
        expect(result!.buySellImb).toBeCloseTo(0.2, 2);
    });

    it('returns rangePosition 1.0 when current close == 252-window high (current included)', () => {
        const baseBars = genBars(250);
        const last = baseBars[baseBars.length - 1];
        const newHighBar: Bar = {
            time: last.time,
            open: last.close,
            high: 200, // well above all prior highs
            low: last.close * 0.99,
            close: 200,
            volume: 1_000_000,
        };
        const bars = [...baseBars.slice(0, -1), newHighBar];
        const bsv: BuySellVolumeResult[] = bars.map(() => ({
            buyVolume: 0,
            sellVolume: 0,
        }));
        const result = computeFactorsAtT(bars, bsv, bars.length - 1);
        expect(result).not.toBeNull();
        expect(result!.rangePosition).toBeCloseTo(1.0, 5);
    });

    it('handles empty buySellVolume entry → buySellImb = 0', () => {
        const bars = genBars(250);
        const bsv: BuySellVolumeResult[] = bars.map(() => ({
            buyVolume: 0,
            sellVolume: 0,
        }));
        const result = computeFactorsAtT(bars, bsv, bars.length - 1);
        expect(result).not.toBeNull();
        expect(result!.buySellImb).toBe(0);
    });

    it('returns buySellImb 0 when bsv at index t is undefined', () => {
        const bars = genBars(250);
        const bsv: BuySellVolumeResult[] = bars.map(() => ({
            buyVolume: 100,
            sellVolume: 100,
        }));
        // Force a hole at the latest index to exercise the bsv-undefined guard.
        bsv[bars.length - 1] = undefined as unknown as BuySellVolumeResult;
        const result = computeFactorsAtT(bars, bsv, bars.length - 1);
        expect(result).not.toBeNull();
        expect(result!.buySellImb).toBe(0);
    });
});
