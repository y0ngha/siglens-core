import { describe, expect, it } from 'vitest';
import { computeMarketReference } from '@/domain/analysis/marketReference';
import type { Bar, IndicatorResult } from '@/domain/types';

function makeBars(n: number): Bar[] {
    return Array.from({ length: n }, (_, i) => ({
        time: i,
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100 + i,
        volume: 1000,
    }));
}
const emptyInd = (): IndicatorResult =>
    ({
        macd: [],
        bollinger: [],
        dmi: [],
        stochastic: [],
        stochRsi: [],
        rsi: [],
        cci: [],
        vwap: [],
        ma: {},
        ema: {},
        volumeProfile: null,
        ichimoku: [],
        atr: [],
        obv: [],
        parabolicSar: [],
        williamsR: [],
        supertrend: [],
        mfi: [],
        keltnerChannel: [],
        cmf: [],
        donchianChannel: [],
        buySellVolume: [],
        smc: { swingHighs: [], swingLows: [], structureBreaks: [] },
        squeezeMomentum: [],
    }) as unknown as IndicatorResult;

describe('computeMarketReference', () => {
    it('returns three horizons with windows capped at bars.length', () => {
        const ref = computeMarketReference(makeBars(30), emptyInd(), '1Day');
        expect(ref.short.window.bars).toBe(20);
        expect(ref.medium.window.bars).toBe(30); // capped (only 30 bars < 60)
        expect(ref.long.window.bars).toBe(30);
    });
    it('produces a regime descriptor for every horizon', () => {
        const ref = computeMarketReference(makeBars(250), emptyInd(), '1Day');
        for (const h of [ref.short, ref.medium, ref.long]) {
            expect(['trending', 'ranging']).toContain(h.structure.regime);
        }
    });
});
