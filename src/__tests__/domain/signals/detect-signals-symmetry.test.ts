import { describe, it, expect } from 'vitest';
import { detectSignals } from '@/domain/signals';
import { EMPTY_INDICATOR_RESULT } from '@/domain/indicators/constants';
import type {
    Bar,
    IndicatorResult,
    KeltnerChannelResult,
    SupertrendResult,
} from '@/domain/types';

function buildBars(n: number): Bar[] {
    return Array.from({ length: n }, (_, i) => ({
        time: 1700000000 + i * 86400,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1000,
    }));
}

/**
 * Builds an indicator suite whose every bearish-mirror trigger fires on the
 * last bars: a Supertrend up→down flip, a Keltner lower breakout, CCI / CMF
 * threshold-cross-downs, an MFI overbought reversal, and a squeeze momentum
 * cross-down. Used to prove the bearish catalog is wired into detectSignals.
 */
function buildBearishIndicators(): {
    bars: Bar[];
    indicators: IndicatorResult;
} {
    // Keltner lower breakout needs close[prev] ≥ lower[prev] then close < lower.
    const closes = [95, 95, 95, 95, 95, 95, 95, 95, 95, 85];
    const bars: Bar[] = closes.map((c, i) => ({
        time: 1700000000 + i * 86400,
        open: c,
        high: c,
        low: c,
        close: c,
        volume: 1000,
    }));
    const keltner: KeltnerChannelResult[] = closes.map(() => ({
        upper: 100,
        middle: 95,
        lower: 90,
    }));

    const supertrend: SupertrendResult[] = [
        ...Array(7).fill({ supertrend: 100, trend: 'up' as const }),
        { supertrend: 100, trend: 'down' as const },
        { supertrend: 100, trend: 'down' as const },
        { supertrend: 100, trend: 'down' as const },
    ];

    const cci = [...Array(7).fill(120), 80, 70, 60]; // +100 cross-down at idx 7
    const cmf = [...Array(7).fill(0.1), -0.05, -0.1, -0.15]; // 0 cross-down at 7
    const mfi = [...Array(8).fill(85), 75, 70]; // 80 cross-down at idx 8

    const indicators: IndicatorResult = {
        ...EMPTY_INDICATOR_RESULT,
        keltnerChannel: keltner,
        supertrend,
        cci,
        cmf,
        mfi,
    };
    return { bars, indicators };
}

describe('detectSignals 양방향 대칭성', () => {
    it('명확한 하락 시퀀스에서 bearish 신호들이 발화한다', () => {
        const { bars, indicators } = buildBearishIndicators();
        const signals = detectSignals(bars, indicators);
        const types = new Set(signals.map(s => s.type));

        // bearish mirror catalog is wired into detectSignals.
        const hasBearishMirror = [...types].some(
            t =>
                t.endsWith('_bearish_cross') ||
                t.endsWith('_bearish_flip') ||
                t === 'keltner_lower_breakout' ||
                t === 'mfi_overbought_reversal' ||
                t === 'squeeze_momentum_bearish' ||
                t === 'ichimoku_cloud_breakdown'
        );
        expect(hasBearishMirror).toBe(true);

        // Every fired signal carries the bearish direction.
        expect(
            signals
                .filter(
                    s =>
                        s.type.includes('bearish') ||
                        s.type === 'keltner_lower_breakout' ||
                        s.type === 'mfi_overbought_reversal' ||
                        s.type === 'ichimoku_cloud_breakdown'
                )
                .every(s => s.direction === 'bearish')
        ).toBe(true);
    });

    it('각 bearish detector가 detectSignals를 통해 개별적으로 노출된다', () => {
        const { bars, indicators } = buildBearishIndicators();
        const types = new Set(detectSignals(bars, indicators).map(s => s.type));

        expect(types.has('keltner_lower_breakout')).toBe(true);
        expect(types.has('supertrend_bearish_flip')).toBe(true);
        expect(types.has('cci_bearish_cross')).toBe(true);
        expect(types.has('cmf_bearish_flip')).toBe(true);
        expect(types.has('mfi_overbought_reversal')).toBe(true);
    });

    it('중립 시퀀스에서는 bearish 신호가 발화하지 않는다', () => {
        const bars = buildBars(20);
        const indicators: IndicatorResult = {
            ...EMPTY_INDICATOR_RESULT,
            rsi: Array(20).fill(50),
        };
        const signals = detectSignals(bars, indicators);
        const hasBearish = signals.some(s => s.direction === 'bearish');
        expect(hasBearish).toBe(false);
    });
});
