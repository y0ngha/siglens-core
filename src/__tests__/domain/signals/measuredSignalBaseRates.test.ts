import { describe, expect, it } from 'vitest';
import { BASE_RATE_MIN_N } from '@/domain/analysis/measuredBaseRates';
import {
    MEASURED_SIGNAL_BASE_RATES,
    measuredSignalBaseRateFor,
} from '@/domain/signals/measuredSignalBaseRates';
import type { ConfirmedSignalType } from '@/domain/types';

const ALL_SIGNAL_TYPES: Record<ConfirmedSignalType, true> = {
    rsi_oversold: true,
    rsi_overbought: true,
    golden_cross: true,
    death_cross: true,
    short_ma_bullish_cross: true,
    short_ma_bearish_cross: true,
    macd_bullish_cross: true,
    macd_bearish_cross: true,
    bollinger_lower_bounce: true,
    bollinger_upper_breakout: true,
    bollinger_percentb_oversold: true,
    bollinger_percentb_overbought: true,
    supertrend_bullish_flip: true,
    parabolic_sar_flip: true,
    ichimoku_cloud_breakout: true,
    cci_bullish_cross: true,
    dmi_bullish_cross: true,
    cmf_bullish_flip: true,
    mfi_oversold_bounce: true,
    keltner_upper_breakout: true,
    squeeze_momentum_bullish: true,
    keltner_lower_breakout: true,
    supertrend_bearish_flip: true,
    ichimoku_cloud_breakdown: true,
    cci_bearish_cross: true,
    dmi_bearish_cross: true,
    cmf_bearish_flip: true,
    mfi_overbought_reversal: true,
    parabolic_sar_bearish_flip: true,
    squeeze_momentum_bearish: true,
    new_52w_high: true,
    new_52w_low: true,
    gap_up: true,
    gap_down: true,
};

describe('MEASURED_SIGNAL_BASE_RATES (the committed table)', () => {
    const entries = Object.values(MEASURED_SIGNAL_BASE_RATES);

    it('has an entry per confirmed type, each keyed by its own type and side', () => {
        expect(Object.keys(MEASURED_SIGNAL_BASE_RATES).toSorted()).toEqual([
            ...Object.keys(ALL_SIGNAL_TYPES).toSorted(),
        ]);
        expect(
            entries.every(e => MEASURED_SIGNAL_BASE_RATES[e.signalType] === e)
        ).toBe(true);
    });

    it('has all four horizons, in order, in every entry', () => {
        expect(
            entries.every(
                e => JSON.stringify(e.horizons.map(h => h.h)) === '[1,5,10,20]'
            )
        ).toBe(true);
    });

    it('states shares only at or above the floor, and every stated figure is finite', () => {
        const cells = entries.flatMap(e => e.horizons);
        cells.forEach(cell => {
            if (cell.verdict === 'insufficient_sample') {
                expect(cell.n).toBeLessThan(BASE_RATE_MIN_N);
                expect(cell.eventShare).toBeNull();
                expect(cell.placeboShare).toBeNull();
                expect(cell.difference).toBeNull();
                return;
            }
            expect(cell.n).toBeGreaterThanOrEqual(BASE_RATE_MIN_N);
            const stated = [
                cell.eventShare,
                cell.placeboShare,
                cell.difference?.mean,
                cell.difference?.low,
                cell.difference?.high,
            ];
            expect(
                stated.every(v => typeof v === 'number' && Number.isFinite(v))
            ).toBe(true);
            expect(cell.eventShare).toBeGreaterThanOrEqual(0);
            expect(cell.eventShare).toBeLessThanOrEqual(1);
            expect(cell.placeboShare).toBeGreaterThanOrEqual(0);
            expect(cell.placeboShare).toBeLessThanOrEqual(1);
            expect(cell.difference?.low ?? Number.NaN).toBeLessThanOrEqual(
                cell.difference?.high ?? Number.NaN
            );
        });
    });

    it('only calls an edge where the interval clears zero', () => {
        entries
            .flatMap(e => e.horizons)
            .filter(c => c.verdict === 'beats_placebo')
            .forEach(c => {
                expect(c.difference?.low ?? 0).toBeGreaterThan(0);
                expect(c.difference?.mean ?? 0).toBeGreaterThan(0);
            });
    });

    it('carries one pooled scope that names the markets, the symbols and the period', () => {
        const [first] = entries;
        expect(first.scope.composition).toBe('pooled');
        expect(first.scope.timeframe).toBe('1Day');
        expect(first.scope.symbols).toBe(
            first.scope.markets.reduce((sum, m) => sum + m.symbols, 0)
        );
        expect(first.scope.from < first.scope.to).toBe(true);
        expect(
            entries.every(
                e => JSON.stringify(e.scope) === JSON.stringify(first.scope)
            )
        ).toBe(true);
    });

    it('is returned by the lookup on daily bars only', () => {
        expect(measuredSignalBaseRateFor('golden_cross', '1Day')).toBe(
            MEASURED_SIGNAL_BASE_RATES.golden_cross
        );
        expect(measuredSignalBaseRateFor('golden_cross', '1Hour')).toBeNull();
        expect(measuredSignalBaseRateFor('not_a_signal', '1Day')).toBeNull();
    });
});
