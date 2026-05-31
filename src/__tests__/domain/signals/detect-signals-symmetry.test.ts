import { describe, it, expect } from 'vitest';
import { detectSignals } from '@/domain/signals';
import { EMPTY_INDICATOR_RESULT } from '@/domain/indicators/constants';
import type {
    Bar,
    DMIResult,
    IchimokuResult,
    IndicatorResult,
    KeltnerChannelResult,
    ParabolicSARResult,
    SqueezeMomentumResult,
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
 * last bars. The fixture is engineered so that all nine bearish confirmed
 * detectors return a signal:
 * - `supertrend_bearish_flip` — Supertrend up→down flip at idx 7.
 * - `parabolic_sar_bearish_flip` — Parabolic SAR up→down flip at idx 7.
 * - `keltner_lower_breakout` — close breaches the lower Keltner band at idx 9.
 * - `ichimoku_cloud_breakdown` — close breaks below the kumo lower edge at idx 9.
 * - `cci_bearish_cross` — CCI +100 cross-down at idx 7.
 * - `dmi_bearish_cross` — −DI crosses above +DI with ADX ≥ 20 at idx 7.
 * - `cmf_bearish_flip` — CMF zero-line cross-down at idx 7.
 * - `mfi_overbought_reversal` — MFI 80 cross-down at idx 8.
 * - `squeeze_momentum_bearish` — squeeze momentum zero-line cross-down at idx 7.
 * Used to prove the bearish catalog is wired into detectSignals.
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

    // Parabolic SAR up→down flip at idx 7 (within the 3-bar lookback of lastIdx=9).
    const parabolicSar: ParabolicSARResult[] = [
        ...Array(7).fill({ sar: 90, trend: 'up' as const }),
        { sar: 105, trend: 'down' as const },
        { sar: 107, trend: 'down' as const },
        { sar: 109, trend: 'down' as const },
    ];

    // −DI crosses above +DI at idx 7 with ADX ≥ DMI_ADX_TREND_THRESHOLD (20).
    const dmi: DMIResult[] = [
        ...Array(7).fill({ diPlus: 25, diMinus: 15, adx: 22 }),
        { diPlus: 20, diMinus: 28, adx: 25 },
        { diPlus: 18, diMinus: 30, adx: 28 },
        { diPlus: 16, diMinus: 32, adx: 30 },
    ];

    // Squeeze momentum zero-line cross-down at idx 7.
    const squeezeMomentum: SqueezeMomentumResult[] = [
        ...Array(7).fill(sqz(0.5)),
        sqz(-0.3),
        sqz(-0.5),
        sqz(-0.7),
    ];

    // Ichimoku breakdown at lastIdx (9): prev close 95 ≥ kumoLower 90, then
    // cur close 85 < kumoLower 90. Earlier bars carry a null cloud (warm-up).
    const ichimoku: IchimokuResult[] = closes.map((_, i) =>
        i >= 8
            ? {
                  tenkan: null,
                  kijun: null,
                  senkouA: 90,
                  senkouB: 92,
                  chikou: null,
              }
            : {
                  tenkan: null,
                  kijun: null,
                  senkouA: null,
                  senkouB: null,
                  chikou: null,
              }
    );

    const cci = [...Array(7).fill(120), 80, 70, 60]; // +100 cross-down at idx 7
    const cmf = [...Array(7).fill(0.1), -0.05, -0.1, -0.15]; // 0 cross-down at 7
    const mfi = [...Array(8).fill(85), 75, 70]; // 80 cross-down at idx 8

    const indicators: IndicatorResult = {
        ...EMPTY_INDICATOR_RESULT,
        keltnerChannel: keltner,
        supertrend,
        parabolicSar,
        dmi,
        squeezeMomentum,
        ichimoku,
        cci,
        cmf,
        mfi,
    };
    return { bars, indicators };
}

function sqz(momentum: number | null): SqueezeMomentumResult {
    return {
        momentum,
        sqzOn: null,
        sqzOff: null,
        noSqz: null,
        increasing: null,
    };
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
        expect(types.has('ichimoku_cloud_breakdown')).toBe(true);
        expect(types.has('dmi_bearish_cross')).toBe(true);
        expect(types.has('parabolic_sar_bearish_flip')).toBe(true);
        expect(types.has('squeeze_momentum_bearish')).toBe(true);
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
