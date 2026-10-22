import { describe, it, expect } from 'vitest';
import {
    detectCciBearishCross,
    detectCmfBearishFlip,
    detectDmiBearishCross,
    detectIchimokuCloudBreakdown,
    detectKeltnerLowerBreakout,
    detectMfiOverboughtReversal,
    detectMfiOversoldBounce,
    detectParabolicSarBearishFlip,
    detectSqueezeMomentumBearish,
    detectSupertrendBearishFlip,
} from '@/domain/signals/confirmed';
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
import { buildBars, sqz } from './testUtils';

function buildBarsWithCloses(closes: number[]): Bar[] {
    return closes.map((c, i) => ({
        time: 1700000000 + i * 86400,
        open: c,
        high: c,
        low: c,
        close: c,
        volume: 1000,
    }));
}

function withSupertrend(values: SupertrendResult[]): IndicatorResult {
    return { ...EMPTY_INDICATOR_RESULT, supertrend: values };
}

function withIchimoku(values: IchimokuResult[]): IndicatorResult {
    return { ...EMPTY_INDICATOR_RESULT, ichimoku: values };
}

function withCci(values: (number | null)[]): IndicatorResult {
    return { ...EMPTY_INDICATOR_RESULT, cci: values };
}

function withDmi(values: DMIResult[]): IndicatorResult {
    return { ...EMPTY_INDICATOR_RESULT, dmi: values };
}

function withCmf(values: (number | null)[]): IndicatorResult {
    return { ...EMPTY_INDICATOR_RESULT, cmf: values };
}

function withMfi(values: (number | null)[]): IndicatorResult {
    return { ...EMPTY_INDICATOR_RESULT, mfi: values };
}

function withSar(values: ParabolicSARResult[]): IndicatorResult {
    return { ...EMPTY_INDICATOR_RESULT, parabolicSar: values };
}

function withKeltner(values: KeltnerChannelResult[]): IndicatorResult {
    return { ...EMPTY_INDICATOR_RESULT, keltnerChannel: values };
}

function withSqueezeMomentum(values: SqueezeMomentumResult[]): IndicatorResult {
    return { ...EMPTY_INDICATOR_RESULT, squeezeMomentum: values };
}

// ─── detectKeltnerLowerBreakout (mirror of detectKeltnerUpperBreakout) ─────────

describe('detectKeltnerLowerBreakout', () => {
    describe('직전 close ≥ lower, 최신 close < lower일 때', () => {
        it('Signal을 반환한다', () => {
            const bars = buildBarsWithCloses([92, 85]);
            const keltner: KeltnerChannelResult[] = [
                { upper: 100, middle: 95, lower: 90 },
                { upper: 98, middle: 93, lower: 88 },
            ];
            const result = detectKeltnerLowerBreakout(
                bars,
                withKeltner(keltner)
            );
            expect(result?.type).toBe('keltner_lower_breakout');
            expect(result?.direction).toBe('bearish');
            expect(result?.phase).toBe('confirmed');
            expect(result?.detectedAt).toBe(1);
        });
    });

    describe('직전 이미 lower 아래였다면', () => {
        it('null을 반환한다', () => {
            const bars = buildBarsWithCloses([85, 80]);
            const keltner: KeltnerChannelResult[] = [
                { upper: 100, middle: 95, lower: 90 },
                { upper: 98, middle: 93, lower: 88 },
            ];
            expect(
                detectKeltnerLowerBreakout(bars, withKeltner(keltner))
            ).toBeNull();
        });
    });

    describe('최신 close가 여전히 lower 이상일 때', () => {
        it('null을 반환한다', () => {
            const bars = buildBarsWithCloses([92, 91]);
            const keltner: KeltnerChannelResult[] = [
                { upper: 100, middle: 95, lower: 90 },
                { upper: 98, middle: 93, lower: 88 },
            ];
            expect(
                detectKeltnerLowerBreakout(bars, withKeltner(keltner))
            ).toBeNull();
        });
    });

    describe('lower가 null일 때', () => {
        it('null을 반환한다', () => {
            const bars = buildBarsWithCloses([92, 85]);
            const keltner: KeltnerChannelResult[] = [
                { upper: null, middle: null, lower: null },
                { upper: null, middle: null, lower: null },
            ];
            expect(
                detectKeltnerLowerBreakout(bars, withKeltner(keltner))
            ).toBeNull();
        });
    });

    describe('bars 길이가 2 미만일 때', () => {
        it('null을 반환한다', () => {
            expect(
                detectKeltnerLowerBreakout(
                    buildBarsWithCloses([100]),
                    EMPTY_INDICATOR_RESULT
                )
            ).toBeNull();
        });
    });

    describe('bars는 충분하나 keltnerChannel이 2 미만일 때', () => {
        it('null을 반환한다 (keltner.length < 2 가드, OR 두 번째 분기)', () => {
            const bars = buildBarsWithCloses([92, 90, 85]);
            const keltner: KeltnerChannelResult[] = [
                { upper: 100, middle: 95, lower: 90 },
            ];
            expect(
                detectKeltnerLowerBreakout(bars, withKeltner(keltner))
            ).toBeNull();
        });
    });

    describe('keltnerChannel 길이는 충분하나 lastIdx 위치 원소가 없을 때', () => {
        it('null을 반환한다 (!curKc undefined 분기)', () => {
            const bars = buildBarsWithCloses([92, 90, 85]); // lastIdx=2
            const keltner: KeltnerChannelResult[] = [
                { upper: 100, middle: 95, lower: 90 },
                { upper: 98, middle: 93, lower: 88 },
            ]; // length=2 → 길이 가드 통과, keltner[2]는 undefined
            expect(
                detectKeltnerLowerBreakout(bars, withKeltner(keltner))
            ).toBeNull();
        });
    });
});

// ─── detectSupertrendBearishFlip (mirror of detectSupertrendBullishFlip) ───────

describe('detectSupertrendBearishFlip', () => {
    describe('최근 3 bar 내 up→down 전환이 있을 때', () => {
        it('Signal을 전환 bar 인덱스로 반환한다', () => {
            const bars = buildBars(10);
            const st: SupertrendResult[] = [
                ...Array(7).fill({ supertrend: 100, trend: 'up' as const }),
                { supertrend: 100, trend: 'down' as const },
                { supertrend: 100, trend: 'down' as const },
                { supertrend: 100, trend: 'down' as const },
            ];
            const result = detectSupertrendBearishFlip(
                bars,
                withSupertrend(st)
            );
            expect(result?.type).toBe('supertrend_bearish_flip');
            expect(result?.direction).toBe('bearish');
            expect(result?.phase).toBe('confirmed');
            expect(result?.detectedAt).toBe(7);
        });
    });

    describe('최근 3 bar 내 전환이 없을 때', () => {
        it('null을 반환한다', () => {
            const bars = buildBars(10);
            const st: SupertrendResult[] = [
                ...Array(3).fill({ supertrend: 100, trend: 'up' as const }),
                ...Array(7).fill({ supertrend: 100, trend: 'down' as const }),
            ];
            expect(
                detectSupertrendBearishFlip(bars, withSupertrend(st))
            ).toBeNull();
        });
    });

    describe('supertrend 데이터가 없을 때', () => {
        it('null을 반환한다', () => {
            expect(
                detectSupertrendBearishFlip(
                    buildBars(5),
                    EMPTY_INDICATOR_RESULT
                )
            ).toBeNull();
        });
    });
});

// ─── detectParabolicSarBearishFlip (mirror of detectParabolicSarFlip) ──────────

describe('detectParabolicSarBearishFlip', () => {
    describe('최근 3 bar 내 up→down 전환일 때', () => {
        it('Signal을 반환한다', () => {
            const bars = buildBars(10);
            const sar: ParabolicSARResult[] = [
                ...Array(7).fill({ sar: 90, trend: 'up' as const }),
                { sar: 105, trend: 'down' as const },
                { sar: 107, trend: 'down' as const },
                { sar: 109, trend: 'down' as const },
            ];
            const result = detectParabolicSarBearishFlip(bars, withSar(sar));
            expect(result?.type).toBe('parabolic_sar_bearish_flip');
            expect(result?.direction).toBe('bearish');
            expect(result?.phase).toBe('confirmed');
            expect(result?.detectedAt).toBe(7);
        });
    });

    describe('lookback 초과 범위 전환일 때', () => {
        it('null을 반환한다', () => {
            const bars = buildBars(10);
            const sar: ParabolicSARResult[] = [
                ...Array(3).fill({ sar: 90, trend: 'up' as const }),
                ...Array(7).fill({ sar: 105, trend: 'down' as const }),
            ];
            expect(
                detectParabolicSarBearishFlip(bars, withSar(sar))
            ).toBeNull();
        });
    });

    describe('SAR 데이터가 없을 때', () => {
        it('null을 반환한다', () => {
            expect(
                detectParabolicSarBearishFlip(
                    buildBars(5),
                    EMPTY_INDICATOR_RESULT
                )
            ).toBeNull();
        });
    });
});

// ─── detectIchimokuCloudBreakdown (mirror of detectIchimokuCloudBreakout) ──────

describe('detectIchimokuCloudBreakdown', () => {
    const nullCloud: IchimokuResult = {
        tenkan: null,
        kijun: null,
        senkouA: null,
        senkouB: null,
        chikou: null,
    };

    describe('직전은 구름 위/안, 최신 bar가 처음 하향 이탈할 때', () => {
        it('Signal을 반환한다', () => {
            const bars = buildBarsWithCloses([105, 104, 103, 95]);
            const ichimoku: IchimokuResult[] = [
                nullCloud,
                nullCloud,
                { ...nullCloud, senkouA: 100, senkouB: 101 }, // prev kumoLower=100, prev.close=103 ≥ 100 ✓
                { ...nullCloud, senkouA: 98, senkouB: 100 }, // cur kumoLower=98, cur.close=95 < 98 ✓
            ];
            const result = detectIchimokuCloudBreakdown(
                bars,
                withIchimoku(ichimoku)
            );
            expect(result?.type).toBe('ichimoku_cloud_breakdown');
            expect(result?.direction).toBe('bearish');
            expect(result?.phase).toBe('confirmed');
            expect(result?.detectedAt).toBe(3);
        });
    });

    describe('직전 bar가 이미 구름 아래에 있을 때', () => {
        it('null을 반환한다 (오탐지 방지)', () => {
            const bars = buildBarsWithCloses([105, 104, 95, 90]);
            const ichimoku: IchimokuResult[] = [
                nullCloud,
                nullCloud,
                { ...nullCloud, senkouA: 100, senkouB: 101 }, // prev kumoLower=100, prev.close=95 < 100 (already below)
                { ...nullCloud, senkouA: 98, senkouB: 100 },
            ];
            expect(
                detectIchimokuCloudBreakdown(bars, withIchimoku(ichimoku))
            ).toBeNull();
        });
    });

    describe('최신 close가 여전히 구름 안/위일 때', () => {
        it('null을 반환한다', () => {
            const bars = buildBarsWithCloses([105, 104, 103, 102]);
            const ichimoku: IchimokuResult[] = [
                nullCloud,
                nullCloud,
                { ...nullCloud, senkouA: 100, senkouB: 101 },
                { ...nullCloud, senkouA: 98, senkouB: 100 }, // cur kumoLower=98, cur.close=102 ≥ 98
            ];
            expect(
                detectIchimokuCloudBreakdown(bars, withIchimoku(ichimoku))
            ).toBeNull();
        });
    });

    describe('구름 데이터가 null일 때', () => {
        it('null을 반환한다', () => {
            const bars = buildBarsWithCloses([95, 90]);
            const ichimoku: IchimokuResult[] = [nullCloud, nullCloud];
            expect(
                detectIchimokuCloudBreakdown(bars, withIchimoku(ichimoku))
            ).toBeNull();
        });
    });

    describe('bars 길이가 2 미만일 때', () => {
        it('null을 반환한다', () => {
            expect(
                detectIchimokuCloudBreakdown(
                    buildBarsWithCloses([100]),
                    EMPTY_INDICATOR_RESULT
                )
            ).toBeNull();
        });
    });

    describe('bars는 충분하나 ichimoku가 2 미만일 때', () => {
        it('null을 반환한다 (ichimoku.length < 2 가드, OR 두 번째 분기)', () => {
            const bars = buildBarsWithCloses([105, 104, 95]);
            const ichimoku: IchimokuResult[] = [
                { ...nullCloud, senkouA: 100, senkouB: 101 },
            ];
            expect(
                detectIchimokuCloudBreakdown(bars, withIchimoku(ichimoku))
            ).toBeNull();
        });
    });

    describe('ichimoku 길이는 충분하나 lastIdx 위치 원소가 없을 때', () => {
        it('null을 반환한다 (!curIchi undefined 분기)', () => {
            const bars = buildBarsWithCloses([105, 104, 95]); // lastIdx=2
            const ichimoku: IchimokuResult[] = [
                { ...nullCloud, senkouA: 100, senkouB: 101 },
                { ...nullCloud, senkouA: 98, senkouB: 100 },
            ]; // length=2 → 길이 가드 통과, ichimoku[2]는 undefined
            expect(
                detectIchimokuCloudBreakdown(bars, withIchimoku(ichimoku))
            ).toBeNull();
        });
    });
});

// ─── detectCciBearishCross (mirror of detectCciBullishCross) ───────────────────

describe('detectCciBearishCross', () => {
    describe('최근 3 bar 내 +100 하향 돌파가 있을 때', () => {
        it('Signal을 전환 bar로 반환한다', () => {
            const bars = buildBars(10);
            const cci = [
                ...Array(7).fill(120),
                80, // +100 하향 돌파 (index 7)
                70,
                60,
            ];
            const result = detectCciBearishCross(bars, withCci(cci));
            expect(result?.type).toBe('cci_bearish_cross');
            expect(result?.direction).toBe('bearish');
            expect(result?.phase).toBe('confirmed');
            expect(result?.detectedAt).toBe(7);
        });
    });

    describe('최근 3 bar 내 0 하향 돌파가 있을 때', () => {
        it('Signal을 반환한다', () => {
            const bars = buildBars(10);
            const cci = [
                ...Array(7).fill(20),
                -20, // 0 하향 돌파 (index 7)
                -30,
                -40,
            ];
            const result = detectCciBearishCross(bars, withCci(cci));
            expect(result?.type).toBe('cci_bearish_cross');
            expect(result?.detectedAt).toBe(7);
        });
    });

    describe('최근 3 bar 내 하향 돌파가 없을 때', () => {
        it('null을 반환한다', () => {
            const bars = buildBars(10);
            const cci = [...Array(3).fill(120), ...Array(7).fill(80)];
            expect(detectCciBearishCross(bars, withCci(cci))).toBeNull();
        });
    });

    describe('CCI 데이터가 1개뿐일 때', () => {
        it('null을 반환한다 (length < 2 가드)', () => {
            expect(
                detectCciBearishCross(buildBars(5), withCci([50]))
            ).toBeNull();
        });
    });

    describe('CCI 데이터가 없을 때', () => {
        it('null을 반환한다', () => {
            expect(
                detectCciBearishCross(buildBars(5), EMPTY_INDICATOR_RESULT)
            ).toBeNull();
        });
    });
});

// ─── detectDmiBearishCross (mirror of detectDmiBullishCross) ───────────────────

describe('detectDmiBearishCross', () => {
    describe('-DI가 +DI 상향 돌파 + ADX ≥ 20일 때', () => {
        it('Signal을 반환한다', () => {
            const bars = buildBars(10);
            const dmi: DMIResult[] = [
                ...Array(7).fill({ diPlus: 25, diMinus: 15, adx: 22 }),
                { diPlus: 20, diMinus: 28, adx: 25 },
                { diPlus: 18, diMinus: 30, adx: 28 },
                { diPlus: 16, diMinus: 32, adx: 30 },
            ];
            const result = detectDmiBearishCross(bars, withDmi(dmi));
            expect(result?.type).toBe('dmi_bearish_cross');
            expect(result?.direction).toBe('bearish');
            expect(result?.phase).toBe('confirmed');
            expect(result?.detectedAt).toBe(7);
        });
    });

    describe('-DI가 +DI 상향 돌파했으나 ADX < 20일 때', () => {
        it('null을 반환한다', () => {
            const bars = buildBars(10);
            const dmi: DMIResult[] = [
                ...Array(7).fill({ diPlus: 25, diMinus: 15, adx: 15 }),
                { diPlus: 20, diMinus: 28, adx: 18 },
                { diPlus: 18, diMinus: 30, adx: 18 },
                { diPlus: 16, diMinus: 32, adx: 18 },
            ];
            expect(detectDmiBearishCross(bars, withDmi(dmi))).toBeNull();
        });
    });

    describe('cross가 없을 때', () => {
        it('null을 반환한다', () => {
            const bars = buildBars(10);
            const dmi: DMIResult[] = Array(10).fill({
                diPlus: 25,
                diMinus: 15,
                adx: 30,
            });
            expect(detectDmiBearishCross(bars, withDmi(dmi))).toBeNull();
        });
    });

    describe('DMI 데이터가 없을 때', () => {
        it('null을 반환한다', () => {
            expect(
                detectDmiBearishCross(buildBars(5), EMPTY_INDICATOR_RESULT)
            ).toBeNull();
        });
    });
});

// ─── detectCmfBearishFlip (mirror of detectCmfBullishFlip) ─────────────────────

describe('detectCmfBearishFlip', () => {
    describe('최근 3 bar 내 CMF가 0 하향 돌파할 때', () => {
        it('Signal을 반환한다', () => {
            const bars = buildBars(10);
            const cmf = [
                ...Array(7).fill(0.1),
                -0.05, // 0 하향 돌파 (index 7)
                -0.1,
                -0.15,
            ];
            const result = detectCmfBearishFlip(bars, withCmf(cmf));
            expect(result?.type).toBe('cmf_bearish_flip');
            expect(result?.direction).toBe('bearish');
            expect(result?.phase).toBe('confirmed');
            expect(result?.detectedAt).toBe(7);
        });
    });

    describe('최근 3 bar 내 하향 돌파가 없을 때', () => {
        it('null을 반환한다', () => {
            const bars = buildBars(10);
            const cmf = [...Array(3).fill(0.1), ...Array(7).fill(-0.1)];
            expect(detectCmfBearishFlip(bars, withCmf(cmf))).toBeNull();
        });
    });

    describe('CMF 데이터가 1개뿐일 때', () => {
        it('null을 반환한다 (length < 2 가드)', () => {
            expect(
                detectCmfBearishFlip(buildBars(5), withCmf([-0.2]))
            ).toBeNull();
        });
    });

    describe('CMF 데이터가 없을 때', () => {
        it('null을 반환한다', () => {
            expect(
                detectCmfBearishFlip(buildBars(5), EMPTY_INDICATOR_RESULT)
            ).toBeNull();
        });
    });
});

// ─── detectSqueezeMomentumBearish (mirror of detectSqueezeMomentumBullish) ─────

describe('detectSqueezeMomentumBearish', () => {
    describe('최근 3 bar 내 momentum 0 하향 돌파일 때', () => {
        it('Signal을 반환한다', () => {
            const bars = buildBars(10);
            const values = [
                ...Array(7).fill(sqz(0.5)),
                sqz(-0.3),
                sqz(-0.5),
                sqz(-0.7),
            ];
            const result = detectSqueezeMomentumBearish(
                bars,
                withSqueezeMomentum(values)
            );
            expect(result?.type).toBe('squeeze_momentum_bearish');
            expect(result?.direction).toBe('bearish');
            expect(result?.phase).toBe('confirmed');
            expect(result?.detectedAt).toBe(7);
        });
    });

    describe('lookback 초과 범위일 때', () => {
        it('null을 반환한다', () => {
            const bars = buildBars(10);
            const values = [
                ...Array(3).fill(sqz(0.5)),
                ...Array(7).fill(sqz(-0.3)),
            ];
            expect(
                detectSqueezeMomentumBearish(bars, withSqueezeMomentum(values))
            ).toBeNull();
        });
    });

    describe('momentum이 null일 때', () => {
        it('null을 반환한다', () => {
            const bars = buildBars(5);
            const values = Array(5).fill(sqz(null));
            expect(
                detectSqueezeMomentumBearish(bars, withSqueezeMomentum(values))
            ).toBeNull();
        });
    });

    describe('Squeeze Momentum 데이터가 없을 때', () => {
        it('null을 반환한다', () => {
            expect(
                detectSqueezeMomentumBearish(
                    buildBars(5),
                    EMPTY_INDICATOR_RESULT
                )
            ).toBeNull();
        });
    });
});

// ─── detectMfiOverboughtReversal (new — threshold-cross down at MFI 80) ────────

describe('detectMfiOverboughtReversal', () => {
    describe('최근 3 bar 내 MFI가 80 하향 돌파할 때', () => {
        it('Signal을 반환한다', () => {
            const bars = buildBars(10);
            const mfi = [...Array(8).fill(85), 75, 70]; // 80 하향 돌파 (index 8)
            const result = detectMfiOverboughtReversal(bars, withMfi(mfi));
            expect(result?.type).toBe('mfi_overbought_reversal');
            expect(result?.direction).toBe('bearish');
            expect(result?.phase).toBe('confirmed');
            expect(result?.detectedAt).toBe(8);
        });
    });

    describe('최근 3 bar 내 하향 돌파가 없을 때', () => {
        it('null을 반환한다', () => {
            const bars = buildBars(10);
            const mfi = [...Array(3).fill(85), ...Array(7).fill(75)];
            expect(detectMfiOverboughtReversal(bars, withMfi(mfi))).toBeNull();
        });
    });

    describe('MFI 데이터가 1개뿐일 때', () => {
        it('null을 반환한다 (length < 2 가드 — 형제 디텍터와 일관)', () => {
            // C4b: detectMfiOverboughtReversal now carries the same
            // `indicators.mfi.length < 2` early-return that CCI/CMF/squeeze
            // siblings have. A single sample cannot form a cross.
            const bars = buildBars(5);
            expect(detectMfiOverboughtReversal(bars, withMfi([85]))).toBeNull();
        });
    });

    describe('MFI 데이터가 없을 때', () => {
        it('null을 반환한다', () => {
            expect(
                detectMfiOverboughtReversal(
                    buildBars(5),
                    EMPTY_INDICATOR_RESULT
                )
            ).toBeNull();
        });
    });
});

// ─── detectMfiOversoldBounce — lookback-cross rewrite ───────────────────────

describe('detectMfiOversoldBounce (lookback cross)', () => {
    it('직전 bar가 아니라 lookback 내 cross에서도 발화한다', () => {
        // oversold 상향 통과가 2봉 전(index 7)에 발생, 그 이후엔 cross 없음.
        const bars = buildBars(10);
        const mfi = [...Array(7).fill(15), 25, 28, 30]; // 20 상향 돌파 at index 7
        const result = detectMfiOversoldBounce(bars, withMfi(mfi));
        expect(result?.type).toBe('mfi_oversold_bounce');
        expect(result?.direction).toBe('bullish');
        expect(result?.detectedAt).toBe(7);
    });

    it('직전 bar에서 막 상향 돌파해도 발화한다 (기존 거동 회귀 없음)', () => {
        const bars = buildBars(10);
        const mfi = [...Array(9).fill(15), 22];
        const result = detectMfiOversoldBounce(bars, withMfi(mfi));
        expect(result?.type).toBe('mfi_oversold_bounce');
        expect(result?.detectedAt).toBe(9);
    });

    it('lookback 밖의 cross는 무시한다', () => {
        const bars = buildBars(10);
        // cross at index 3, lookback=3 covers the last 3 indices only.
        const mfi = [...Array(3).fill(15), ...Array(7).fill(25)];
        expect(detectMfiOversoldBounce(bars, withMfi(mfi))).toBeNull();
    });

    it('cross가 전혀 없으면 null을 반환한다', () => {
        const bars = buildBars(10);
        const mfi = Array(10).fill(15);
        expect(detectMfiOversoldBounce(bars, withMfi(mfi))).toBeNull();
    });

    it('MFI 데이터가 없을 때 null을 반환한다', () => {
        expect(
            detectMfiOversoldBounce(buildBars(5), EMPTY_INDICATOR_RESULT)
        ).toBeNull();
    });
});
