import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
    buildAnalysisPrompt,
    INDICATOR_VALUES_SECTION_HEADER,
    PRO_INDICATOR_SECTION_HEADER,
    PRO_RELIABILITY_NOTE,
    PROMPT_CONFIG_BY_TIMEFRAME,
    REGIME_CONTEXT_SECTION_HEADER,
} from '@/domain/analysis/prompt';
import { calculateIndicators } from '@/domain/indicators/index';
import { CANDLE_PATTERN_DETECTION_BARS } from '@/domain/analysis/candle-detection';
import {
    ATR_DEFAULT_PERIOD,
    CCI_DEFAULT_PERIOD,
    CMF_DEFAULT_PERIOD,
    DONCHIAN_DEFAULT_PERIOD,
    EMA_DEFAULT_PERIODS,
    EMPTY_INDICATOR_RESULT,
    EMPTY_SMC_RESULT,
    HIGH_CONFIDENCE_WEIGHT,
    ICHIMOKU_BASE_PERIOD,
    ICHIMOKU_CONVERSION_PERIOD,
    ICHIMOKU_SPAN_B_PERIOD,
    KELTNER_ATR_PERIOD,
    KELTNER_EMA_PERIOD,
    KELTNER_MULTIPLIER,
    MA_DEFAULT_PERIODS,
    MFI_DEFAULT_PERIOD,
    RSI_DEFAULT_PERIOD,
    STOCH_RSI_D_PERIOD,
    STOCH_RSI_K_PERIOD,
    STOCH_RSI_RSI_PERIOD,
    STOCH_RSI_STOCH_PERIOD,
    STOCHASTIC_D_PERIOD,
    STOCHASTIC_K_PERIOD,
    STOCHASTIC_SMOOTHING,
    SUPERTREND_ATR_PERIOD,
    SUPERTREND_MULTIPLIER,
    WILLIAMS_R_DEFAULT_PERIOD,
} from '@/domain/indicators/constants';
import {
    HAMMER_BODY_OFFSET,
    HAMMER_HIGH_OFFSET,
    HAMMER_LOW_OFFSET,
    TEST_BAR_BASE_PRICE,
    TEST_BAR_BASE_TIME,
    TEST_BAR_INTERVAL,
} from '@/__tests__/fixtures/candle';
import type {
    Bar,
    FearGreedSnapshot,
    IndicatorResult,
    Skill,
    SkillUsageRole,
    SMCResult,
    SqueezeMomentumResult,
} from '@/domain/types';

const TEST_SYMBOL = 'AAPL';
const TEST_COMPANY_NAME = 'Apple Inc.';
const TEST_BAR_BASE_HIGH = 110;
const TEST_BAR_BASE_LOW = 90;
const TEST_BAR_BASE_VOLUME = 1000;
const TEST_CLOSE_PRICE = 150.0;
const TEST_PREV_CLOSE = 100.0;
const TEST_NEXT_CLOSE = 110.0;
const TEST_RSI_VALUE = 65.5;
const TEST_MACD_VALUE = 1.23;
const TEST_SIGNAL_VALUE = 0.98;
const TEST_HISTOGRAM_VALUE = 0.25;
const TEST_BOLLINGER_UPPER = 155.0;
const TEST_BOLLINGER_MIDDLE = 150.0;
const TEST_BOLLINGER_LOWER = 145.0;
const TEST_DI_PLUS = 25.0;
const TEST_DI_MINUS = 18.0;
const TEST_ADX_VALUE = 30.0;
const TEST_STOCHASTIC_K = 75.5;
const TEST_STOCHASTIC_D = 68.3;
const TEST_STOCH_RSI_K = 0.65;
const TEST_STOCH_RSI_D = 0.52;
const TEST_CCI_VALUE = 125.5;
const TEST_VP_POC = 150.0;
const TEST_VP_VAH = 160.0;
const TEST_VP_VAL = 140.0;
const TEST_ICHIMOKU_TENKAN = 152.5;
const TEST_ICHIMOKU_KIJUN = 148.0;
const TEST_ICHIMOKU_SENKOU_A = 155.0;
const TEST_ICHIMOKU_SENKOU_B = 145.0;
const TEST_ICHIMOKU_CHIKOU = 151.0;
const TEST_HIGH_CONFIDENCE = HIGH_CONFIDENCE_WEIGHT;
const TEST_ABOVE_HIGH_CONFIDENCE = 0.9;
const TEST_MEDIUM_CONFIDENCE = 0.7;
const TEST_ABOVE_MIN_CONFIDENCE = 0.6;
const TEST_BELOW_MIN_CONFIDENCE = 0.4;
// expected value: ((110 - 100) / 100) * 100 = 10.00%
const TEST_CHANGE_RATE_FORMATTED = `${(((TEST_NEXT_CLOSE - TEST_PREV_CLOSE) / TEST_PREV_CLOSE) * 100).toFixed(2)}%`;

const TEST_MA_5_VALUE = 152.3;
const TEST_MA_20_VALUE = 150.25;
const TEST_MA_60_VALUE = 148.1;
const TEST_MA_120_VALUE = 145.5;
const TEST_MA_200_VALUE = 142.8;
const TEST_ATR_VALUE = 2.45;
const TEST_OBV_VALUE = 1234567;
const TEST_PSAR_VALUE = 150.0;
const TEST_WILLIAMS_R_VALUE = -25.5;
const TEST_SUPERTREND_VALUE = 148.5;
const TEST_MFI_VALUE = 65.5;
const TEST_KELTNER_UPPER = 155.0;
const TEST_KELTNER_MIDDLE = 150.0;
const TEST_KELTNER_LOWER = 145.0;
const TEST_CMF_VALUE = 0.15;
const TEST_DONCHIAN_UPPER = 155.0;
const TEST_DONCHIAN_MIDDLE = 150.0;
const TEST_DONCHIAN_LOWER = 145.0;

const TEST_EMA_9_VALUE = 151.3;
const TEST_EMA_20_VALUE = 150.8;
const TEST_EMA_21_VALUE = 150.75;
const TEST_EMA_60_VALUE = 148.9;

const makeBar = (i: number, close?: number): Bar => ({
    time: TEST_BAR_BASE_TIME + i * TEST_BAR_INTERVAL,
    open: TEST_BAR_BASE_PRICE + i,
    high: TEST_BAR_BASE_HIGH + i,
    low: TEST_BAR_BASE_LOW + i,
    close: close ?? TEST_BAR_BASE_PRICE + i,
    volume: TEST_BAR_BASE_VOLUME,
});

const makeIndicators = (
    overrides?: Partial<IndicatorResult>
): IndicatorResult => ({
    ...EMPTY_INDICATOR_RESULT,
    ...overrides,
    smc: overrides?.smc ?? EMPTY_SMC_RESULT,
});

const countOccurrences = (haystack: string, needle: string): number =>
    haystack.split(needle).length - 1;

const makeEngulfingBars = (): [Bar, Bar] => [
    {
        time: TEST_BAR_BASE_TIME,
        open: 110,
        high: 115,
        low: 105,
        close: 106,
        volume: TEST_BAR_BASE_VOLUME,
    },
    {
        time: TEST_BAR_BASE_TIME + TEST_BAR_INTERVAL,
        open: 104,
        high: 120,
        low: 103,
        close: 118,
        volume: TEST_BAR_BASE_VOLUME,
    },
];

// Default fixture is always_on: selection is fail-closed, so every skill that
// should reach the prompt must carry an explicit gating block. Tests that
// exercise the fail-closed throw override `gating: undefined` explicitly.
const makeSkill = (overrides?: Partial<Skill>): Skill => ({
    name: 'Test Skill',
    description: 'Test description',
    indicators: [],
    confidenceWeight: TEST_HIGH_CONFIDENCE,
    content: '## Analysis Criteria\n- Test content',
    gating: { tier: 'always_on' },
    ...overrides,
});

describe('prompt', () => {
    describe('반환 타입', () => {
        it('문자열을 반환한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(typeof result).toBe('string');
        });
    });

    describe('종목명 섹션', () => {
        it('symbol이 프롬프트에 포함된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).toContain(TEST_SYMBOL);
        });
    });

    describe('현재 시장 상황 섹션 - bars가 비어있을 때', () => {
        it('현재가, 변화율, 거래량 모두 N/A를 표시한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).toContain(
                'Snapshot Price (price captured at analysis time; not a live quote): N/A'
            );
            expect(result).toContain('Price Change %: N/A');
            expect(result).toContain('Volume: N/A');
        });
    });

    describe('현재 시장 상황 섹션 - bars가 있을 때', () => {
        it('현재가(마지막 봉의 종가)를 포함한다', () => {
            const bars = [makeBar(0, TEST_CLOSE_PRICE)];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                []
            );
            expect(result).toContain(TEST_CLOSE_PRICE.toFixed(2));
        });

        it('봉이 2개 이상일 때 변화율을 포함한다', () => {
            const bars = [
                makeBar(0, TEST_PREV_CLOSE),
                makeBar(1, TEST_NEXT_CLOSE),
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                []
            );
            expect(result).toContain(TEST_CHANGE_RATE_FORMATTED);
        });

        it('봉이 1개일 때 변화율은 N/A다', () => {
            const bars = [makeBar(0, TEST_CLOSE_PRICE)];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                []
            );
            expect(result).toContain('Price Change %: N/A');
        });

        it('거래량을 포함한다', () => {
            const bars = [makeBar(0)];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                []
            );
            expect(result).toContain('Volume:');
        });

        it('labels the current market block as "Analysis Snapshot" with "Snapshot Price"', () => {
            const bars = [
                makeBar(0, TEST_PREV_CLOSE),
                makeBar(1, TEST_NEXT_CLOSE),
            ];
            const prompt = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                [],
                '1Day'
            );
            expect(prompt).toContain('## Analysis Snapshot');
            expect(prompt).toContain(
                '- Snapshot Price (price captured at analysis time; not a live quote):'
            );
            expect(prompt).not.toContain('## Current Market Status');
            expect(prompt).not.toContain('- Current Price:');
        });
    });

    describe('인디케이터 수치 섹션', () => {
        it('RSI 값이 없을 때 N/A를 표시한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ rsi: [] }),
                []
            );
            expect(result).toContain(`RSI(${RSI_DEFAULT_PERIOD}): N/A`);
        });

        it('초기 null 구간 이후 마지막 RSI 값을 포함한다', () => {
            const indicators = makeIndicators({
                rsi: [null, null, TEST_RSI_VALUE],
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            expect(result).toContain(TEST_RSI_VALUE.toFixed(2));
        });

        it('전부 null인 RSI 배열일 때 N/A를 표시한다', () => {
            const indicators = makeIndicators({ rsi: [null, null, null] });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            expect(result).toContain(`RSI(${RSI_DEFAULT_PERIOD}): N/A`);
        });

        it('MACD 배열이 비어있을 때 N/A를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ macd: [] }),
                []
            );
            expect(result).toContain('MACD: N/A');
        });

        it('마지막 MACD 요소의 모든 필드가 null일 때 N/A를 표시한다', () => {
            const indicators = makeIndicators({
                macd: [{ macd: null, signal: null, histogram: null }],
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            expect(result).toContain('MACD: N/A');
        });

        it('MACD 값을 포함한다', () => {
            const indicators = makeIndicators({
                macd: [
                    {
                        macd: TEST_MACD_VALUE,
                        signal: TEST_SIGNAL_VALUE,
                        histogram: TEST_HISTOGRAM_VALUE,
                    },
                ],
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            expect(result).toContain(TEST_MACD_VALUE.toFixed(2));
            expect(result).toContain(TEST_SIGNAL_VALUE.toFixed(2));
            expect(result).toContain(TEST_HISTOGRAM_VALUE.toFixed(2));
        });

        it('볼린저 밴드 배열이 비어있을 때 N/A를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ bollinger: [] }),
                []
            );
            expect(result).toContain('Bollinger Bands: Upper N/A');
        });

        it('마지막 볼린저 밴드 요소의 모든 필드가 null일 때 N/A를 표시한다', () => {
            const indicators = makeIndicators({
                bollinger: [{ upper: null, middle: null, lower: null }],
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            expect(result).toContain('Bollinger Bands: Upper N/A');
        });

        it('볼린저 밴드 값을 포함한다', () => {
            const indicators = makeIndicators({
                bollinger: [
                    {
                        upper: TEST_BOLLINGER_UPPER,
                        middle: TEST_BOLLINGER_MIDDLE,
                        lower: TEST_BOLLINGER_LOWER,
                    },
                ],
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            expect(result).toContain(TEST_BOLLINGER_UPPER.toFixed(2));
            expect(result).toContain(TEST_BOLLINGER_MIDDLE.toFixed(2));
            expect(result).toContain(TEST_BOLLINGER_LOWER.toFixed(2));
        });

        it('DMI 배열이 비어있을 때 N/A를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ dmi: [] }),
                []
            );
            expect(result).toContain('DMI: +DI N/A');
        });

        it('마지막 DMI 요소의 모든 필드가 null일 때 N/A를 표시한다', () => {
            const indicators = makeIndicators({
                dmi: [{ diPlus: null, diMinus: null, adx: null }],
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            expect(result).toContain('DMI: +DI N/A');
        });

        it('DMI 값을 포함한다', () => {
            const indicators = makeIndicators({
                dmi: [
                    {
                        diPlus: TEST_DI_PLUS,
                        diMinus: TEST_DI_MINUS,
                        adx: TEST_ADX_VALUE,
                    },
                ],
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            expect(result).toContain(TEST_DI_PLUS.toFixed(2));
            expect(result).toContain(TEST_DI_MINUS.toFixed(2));
            expect(result).toContain(TEST_ADX_VALUE.toFixed(2));
        });

        it('Stochastic 배열이 비어있을 때 N/A를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ stochastic: [] }),
                []
            );
            expect(result).toContain(
                `Stochastic(${STOCHASTIC_K_PERIOD},${STOCHASTIC_D_PERIOD},${STOCHASTIC_SMOOTHING}): %K N/A`
            );
        });

        it('마지막 Stochastic 요소의 모든 필드가 null일 때 N/A를 표시한다', () => {
            const indicators = makeIndicators({
                stochastic: [{ percentK: null, percentD: null }],
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            expect(result).toContain(
                `Stochastic(${STOCHASTIC_K_PERIOD},${STOCHASTIC_D_PERIOD},${STOCHASTIC_SMOOTHING}): %K N/A`
            );
        });

        it('Stochastic 값을 포함한다', () => {
            const indicators = makeIndicators({
                stochastic: [
                    {
                        percentK: TEST_STOCHASTIC_K,
                        percentD: TEST_STOCHASTIC_D,
                    },
                ],
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            expect(result).toContain(TEST_STOCHASTIC_K.toFixed(2));
            expect(result).toContain(TEST_STOCHASTIC_D.toFixed(2));
        });

        it('StochRSI 배열이 비어있을 때 N/A를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ stochRsi: [] }),
                []
            );
            expect(result).toContain(
                `StochRSI(${STOCH_RSI_RSI_PERIOD},${STOCH_RSI_STOCH_PERIOD},${STOCH_RSI_K_PERIOD},${STOCH_RSI_D_PERIOD}): K N/A`
            );
        });

        it('마지막 StochRSI 요소의 모든 필드가 null일 때 N/A를 표시한다', () => {
            const indicators = makeIndicators({
                stochRsi: [{ k: null, d: null }],
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            expect(result).toContain(
                `StochRSI(${STOCH_RSI_RSI_PERIOD},${STOCH_RSI_STOCH_PERIOD},${STOCH_RSI_K_PERIOD},${STOCH_RSI_D_PERIOD}): K N/A`
            );
        });

        it('StochRSI 값을 포함한다', () => {
            const indicators = makeIndicators({
                stochRsi: [
                    {
                        k: TEST_STOCH_RSI_K,
                        d: TEST_STOCH_RSI_D,
                    },
                ],
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            expect(result).toContain(TEST_STOCH_RSI_K.toFixed(2));
            expect(result).toContain(TEST_STOCH_RSI_D.toFixed(2));
        });
    });

    describe('지표 섹션 - CCI', () => {
        it('CCI 배열이 비어있을 때 N/A를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ cci: [] }),
                []
            );
            expect(result).toContain(`CCI(${CCI_DEFAULT_PERIOD}): N/A`);
        });

        it('CCI 배열이 모두 null일 때 N/A를 표시한다', () => {
            const indicators = makeIndicators({
                cci: [null, null, null],
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            expect(result).toContain(`CCI(${CCI_DEFAULT_PERIOD}): N/A`);
        });

        it('CCI 값을 포함한다', () => {
            const indicators = makeIndicators({
                cci: [null, TEST_CCI_VALUE],
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            expect(result).toContain(TEST_CCI_VALUE.toFixed(2));
        });
    });

    describe('지표 섹션 - Volume Profile', () => {
        it('volumeProfile이 null일 때 N/A를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ volumeProfile: null }),
                []
            );
            expect(result).toContain(
                'Volume Profile: POC N/A / VAH N/A / VAL N/A'
            );
        });

        it('volumeProfile 값이 있을 때 POC/VAH/VAL 값을 포함한다', () => {
            const indicators = makeIndicators({
                volumeProfile: {
                    poc: TEST_VP_POC,
                    vah: TEST_VP_VAH,
                    val: TEST_VP_VAL,
                    profile: [],
                },
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            expect(result).toContain(TEST_VP_POC.toFixed(2));
            expect(result).toContain(TEST_VP_VAH.toFixed(2));
            expect(result).toContain(TEST_VP_VAL.toFixed(2));
        });
    });

    describe('지표 섹션 - MA', () => {
        it('ma가 빈 객체일 때 모든 기간이 N/A로 표시된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ ma: {} }),
                []
            );
            MA_DEFAULT_PERIODS.forEach(p => {
                expect(result).toContain(`MA(${p}): N/A`);
            });
        });

        it('MA 배열이 전부 null일 때 N/A로 표시된다', () => {
            const indicators = makeIndicators({
                ma: {
                    5: [null, null],
                    20: [null, null],
                    60: [null, null],
                    120: [null, null],
                    200: [null, null],
                },
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            MA_DEFAULT_PERIODS.forEach(p => {
                expect(result).toContain(`MA(${p}): N/A`);
            });
        });

        it('각 기간별 MA 값이 프롬프트에 포함된다', () => {
            const indicators = makeIndicators({
                ma: {
                    5: [null, TEST_MA_5_VALUE],
                    20: [null, TEST_MA_20_VALUE],
                    60: [null, TEST_MA_60_VALUE],
                    120: [null, TEST_MA_120_VALUE],
                    200: [null, TEST_MA_200_VALUE],
                },
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            expect(result).toContain(`MA(5): ${TEST_MA_5_VALUE.toFixed(2)}`);
            expect(result).toContain(`MA(20): ${TEST_MA_20_VALUE.toFixed(2)}`);
            expect(result).toContain(`MA(60): ${TEST_MA_60_VALUE.toFixed(2)}`);
            expect(result).toContain(
                `MA(120): ${TEST_MA_120_VALUE.toFixed(2)}`
            );
            expect(result).toContain(
                `MA(200): ${TEST_MA_200_VALUE.toFixed(2)}`
            );
        });
    });

    describe('지표 섹션 - EMA', () => {
        it('ema가 빈 객체일 때 모든 기간이 N/A로 표시된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ ema: {} }),
                []
            );
            EMA_DEFAULT_PERIODS.forEach(p => {
                expect(result).toContain(`EMA(${p}): N/A`);
            });
        });

        it('EMA 배열이 전부 null일 때 N/A로 표시된다', () => {
            const indicators = makeIndicators({
                ema: {
                    9: [null, null],
                    20: [null, null],
                    21: [null, null],
                    60: [null, null],
                },
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            EMA_DEFAULT_PERIODS.forEach(p => {
                expect(result).toContain(`EMA(${p}): N/A`);
            });
        });

        it('각 기간별 EMA 값이 프롬프트에 포함된다', () => {
            const indicators = makeIndicators({
                ema: {
                    9: [null, TEST_EMA_9_VALUE],
                    20: [null, TEST_EMA_20_VALUE],
                    21: [null, TEST_EMA_21_VALUE],
                    60: [null, TEST_EMA_60_VALUE],
                },
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            expect(result).toContain(`EMA(9): ${TEST_EMA_9_VALUE.toFixed(2)}`);
            expect(result).toContain(
                `EMA(20): ${TEST_EMA_20_VALUE.toFixed(2)}`
            );
            expect(result).toContain(
                `EMA(21): ${TEST_EMA_21_VALUE.toFixed(2)}`
            );
            expect(result).toContain(
                `EMA(60): ${TEST_EMA_60_VALUE.toFixed(2)}`
            );
        });
    });

    describe('지표 섹션 - Ichimoku', () => {
        it('ichimoku 배열이 비어있을 때 N/A를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ ichimoku: [] }),
                []
            );
            expect(result).toContain(
                `Ichimoku(${ICHIMOKU_CONVERSION_PERIOD},${ICHIMOKU_BASE_PERIOD},${ICHIMOKU_SPAN_B_PERIOD}): Tenkan N/A`
            );
        });

        it('마지막 ichimoku 요소의 모든 필드가 null일 때 N/A를 표시한다', () => {
            const indicators = makeIndicators({
                ichimoku: [
                    {
                        tenkan: null,
                        kijun: null,
                        senkouA: null,
                        senkouB: null,
                        chikou: null,
                    },
                ],
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            expect(result).toContain(
                `Ichimoku(${ICHIMOKU_CONVERSION_PERIOD},${ICHIMOKU_BASE_PERIOD},${ICHIMOKU_SPAN_B_PERIOD}): Tenkan N/A`
            );
        });

        it('ichimoku 값을 포함한다', () => {
            const indicators = makeIndicators({
                ichimoku: [
                    {
                        tenkan: TEST_ICHIMOKU_TENKAN,
                        kijun: TEST_ICHIMOKU_KIJUN,
                        senkouA: TEST_ICHIMOKU_SENKOU_A,
                        senkouB: TEST_ICHIMOKU_SENKOU_B,
                        chikou: TEST_ICHIMOKU_CHIKOU,
                    },
                ],
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            expect(result).toContain(TEST_ICHIMOKU_TENKAN.toFixed(2));
            expect(result).toContain(TEST_ICHIMOKU_KIJUN.toFixed(2));
            expect(result).toContain(TEST_ICHIMOKU_SENKOU_A.toFixed(2));
            expect(result).toContain(TEST_ICHIMOKU_SENKOU_B.toFixed(2));
            expect(result).toContain(TEST_ICHIMOKU_CHIKOU.toFixed(2));
        });
    });

    describe('지표 섹션 - ATR', () => {
        it('atr 배열이 비어있을 때 N/A를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ atr: [] }),
                []
            );
            expect(result).toContain(`ATR(${ATR_DEFAULT_PERIOD}): N/A`);
        });

        it('atr 값을 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ atr: [null, TEST_ATR_VALUE] }),
                []
            );
            expect(result).toContain(
                `ATR(${ATR_DEFAULT_PERIOD}): ${TEST_ATR_VALUE.toFixed(2)}`
            );
        });
    });

    describe('지표 섹션 - OBV', () => {
        it('obv 배열이 비어있을 때 N/A를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ obv: [] }),
                []
            );
            expect(result).toContain('OBV: N/A');
        });

        it('obv 값을 comma 포매팅하여 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ obv: [TEST_OBV_VALUE] }),
                []
            );
            expect(result).toContain('OBV: 1,234,567');
        });
    });

    describe('지표 섹션 - Parabolic SAR', () => {
        it('parabolicSar 배열이 비어있을 때 N/A를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ parabolicSar: [] }),
                []
            );
            expect(result).toContain('Parabolic SAR: N/A (N/A)');
        });

        it('parabolicSar 값과 trend를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({
                    parabolicSar: [{ sar: TEST_PSAR_VALUE, trend: 'up' }],
                }),
                []
            );
            expect(result).toContain(
                `Parabolic SAR: ${TEST_PSAR_VALUE.toFixed(2)} (up)`
            );
        });
    });

    describe('지표 섹션 - Williams %R', () => {
        it('williamsR 배열이 비어있을 때 N/A를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ williamsR: [] }),
                []
            );
            expect(result).toContain(
                `Williams %R(${WILLIAMS_R_DEFAULT_PERIOD}): N/A`
            );
        });

        it('williamsR 값을 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ williamsR: [null, TEST_WILLIAMS_R_VALUE] }),
                []
            );
            expect(result).toContain(
                `Williams %R(${WILLIAMS_R_DEFAULT_PERIOD}): ${TEST_WILLIAMS_R_VALUE.toFixed(2)}`
            );
        });
    });

    describe('지표 섹션 - Supertrend', () => {
        it('supertrend 배열이 비어있을 때 N/A를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ supertrend: [] }),
                []
            );
            expect(result).toContain(
                `Supertrend(${SUPERTREND_ATR_PERIOD},${SUPERTREND_MULTIPLIER}): N/A (N/A)`
            );
        });

        it('supertrend 값과 trend를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({
                    supertrend: [
                        { supertrend: TEST_SUPERTREND_VALUE, trend: 'up' },
                    ],
                }),
                []
            );
            expect(result).toContain(
                `Supertrend(${SUPERTREND_ATR_PERIOD},${SUPERTREND_MULTIPLIER}): ${TEST_SUPERTREND_VALUE.toFixed(2)} (up)`
            );
        });
    });

    describe('지표 섹션 - MFI', () => {
        it('mfi 배열이 비어있을 때 N/A를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ mfi: [] }),
                []
            );
            expect(result).toContain(`MFI(${MFI_DEFAULT_PERIOD}): N/A`);
        });

        it('mfi 값을 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ mfi: [null, TEST_MFI_VALUE] }),
                []
            );
            expect(result).toContain(
                `MFI(${MFI_DEFAULT_PERIOD}): ${TEST_MFI_VALUE.toFixed(2)}`
            );
        });
    });

    describe('지표 섹션 - Keltner Channel', () => {
        it('keltnerChannel 배열이 비어있을 때 N/A를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ keltnerChannel: [] }),
                []
            );
            expect(result).toContain(
                `Keltner Channel(${KELTNER_EMA_PERIOD},${KELTNER_ATR_PERIOD},${KELTNER_MULTIPLIER}): Upper N/A`
            );
        });

        it('keltnerChannel 값을 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({
                    keltnerChannel: [
                        {
                            upper: TEST_KELTNER_UPPER,
                            middle: TEST_KELTNER_MIDDLE,
                            lower: TEST_KELTNER_LOWER,
                        },
                    ],
                }),
                []
            );
            expect(result).toContain(TEST_KELTNER_UPPER.toFixed(2));
            expect(result).toContain(TEST_KELTNER_MIDDLE.toFixed(2));
            expect(result).toContain(TEST_KELTNER_LOWER.toFixed(2));
        });
    });

    describe('지표 섹션 - CMF', () => {
        it('cmf 배열이 비어있을 때 N/A를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ cmf: [] }),
                []
            );
            expect(result).toContain(`CMF(${CMF_DEFAULT_PERIOD}): N/A`);
        });

        it('cmf 값을 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ cmf: [null, TEST_CMF_VALUE] }),
                []
            );
            expect(result).toContain(
                `CMF(${CMF_DEFAULT_PERIOD}): ${TEST_CMF_VALUE.toFixed(2)}`
            );
        });
    });

    describe('지표 섹션 - Donchian Channel', () => {
        it('donchianChannel 배열이 비어있을 때 N/A를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({ donchianChannel: [] }),
                []
            );
            expect(result).toContain(
                `Donchian Channel(${DONCHIAN_DEFAULT_PERIOD}): Upper N/A`
            );
        });

        it('donchianChannel 값을 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators({
                    donchianChannel: [
                        {
                            upper: TEST_DONCHIAN_UPPER,
                            middle: TEST_DONCHIAN_MIDDLE,
                            lower: TEST_DONCHIAN_LOWER,
                        },
                    ],
                }),
                []
            );
            expect(result).toContain(TEST_DONCHIAN_UPPER.toFixed(2));
            expect(result).toContain(TEST_DONCHIAN_MIDDLE.toFixed(2));
            expect(result).toContain(TEST_DONCHIAN_LOWER.toFixed(2));
        });
    });

    describe('Skills 섹션 - skills가 비어있을 때', () => {
        it('패턴 분석 섹션이 포함되지 않는다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).not.toContain('## Pattern Analysis\n');
        });

        it('활성화된 Skills 섹션이 포함되지 않는다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).not.toContain('## Active Skills\n');
        });
    });

    describe('Skills 섹션 - gating (fail-closed replaces fail-open)', () => {
        // selectSkills is fail-closed: an untagged chart skill throws instead
        // of being silently included (or dropped). Confidence remains a display
        // weight only — an always_on skill is included at any confidence.
        it('throws on an untagged chart skill (fail-closed)', () => {
            const skill = makeSkill({
                name: 'Untagged Legacy',
                gating: undefined,
            });
            expect(() =>
                buildAnalysisPrompt(
                    TEST_SYMBOL,
                    TEST_COMPANY_NAME,
                    [],
                    makeIndicators(),
                    [skill]
                )
            ).toThrow(/gating/);
        });

        it('always_on low-confidence skill is included (confidence is not a gate)', () => {
            const skill = makeSkill({
                name: 'Tagged Low',
                confidenceWeight: TEST_BELOW_MIN_CONFIDENCE,
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('Tagged Low');
        });

        it('always_on high-confidence skill is included', () => {
            const skill = makeSkill({
                name: 'Included Skill',
                confidenceWeight: TEST_ABOVE_MIN_CONFIDENCE,
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('Included Skill');
        });

        it('gated skill whose trigger is absent is excluded', () => {
            const skill = makeSkill({
                name: 'Excluded Skill',
                type: 'indicator_guide',
                gating: {
                    tier: 'gated',
                    signalKind: 'event',
                    triggers: ['rsi_oversold'],
                },
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).not.toContain('Excluded Skill');
        });

        it('only-gated-inactive skills → no skill sections rendered', () => {
            const skills = [
                makeSkill({
                    name: 'Inactive A',
                    type: 'pattern',
                    gating: {
                        tier: 'gated',
                        signalKind: 'event',
                        triggers: ['rsi_oversold'],
                    },
                }),
                makeSkill({
                    name: 'Inactive B',
                    type: undefined,
                    gating: {
                        tier: 'gated',
                        signalKind: 'event',
                        triggers: ['macd_bullish_cross'],
                    },
                }),
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                skills
            );
            expect(result).not.toContain('## Active Skills\n');
            expect(result).not.toContain('## Pattern Analysis\n');
        });
    });

    describe('Skills 섹션 - type이 pattern인 skill일 때', () => {
        it('패턴 분석 섹션에 포함된다', () => {
            const skill = makeSkill({
                type: 'pattern',
                name: 'Double Top',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('Pattern Analysis');
            expect(result).toContain('Double Top');
        });

        it('활성화된 Skills 섹션에는 포함되지 않는다', () => {
            const skill = makeSkill({
                type: 'pattern',
                name: 'Double Top',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).not.toContain('## Active Skills\n');
        });
    });

    describe('Skills 섹션 - type이 pattern이 아닌 skill일 때', () => {
        it('활성화된 Skills 섹션에 포함된다', () => {
            const skill = makeSkill({
                name: 'RSI Divergence',
                type: undefined,
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('## Active Skills\n');
            expect(result).toContain('RSI Divergence');
        });

        it('패턴 분석 섹션에는 포함되지 않는다', () => {
            const skill = makeSkill({
                name: 'RSI Divergence',
                type: undefined,
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).not.toContain('## Pattern Analysis\n');
        });

        it('summary 전용 규칙이 포함된다', () => {
            const skill = makeSkill({
                name: 'RSI Divergence',
                type: undefined,
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('### Regular Skills Usage');
            expect(result).toContain('summary only');
            expect(result).toContain('### Active Skills Writing Rules');
            expect(result).toContain(
                'Do not create separate structured entries or new fields for them.'
            );
        });
    });

    describe('Skills 섹션 - 신뢰도 레이블', () => {
        it('confidenceWeight가 0.8 이상이면 높은 신뢰도로 표시된다', () => {
            const skill = makeSkill({
                confidenceWeight: TEST_ABOVE_HIGH_CONFIDENCE,
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('[High Confidence]');
        });

        it('confidenceWeight가 정확히 0.8이면 높은 신뢰도로 표시된다', () => {
            const skill = makeSkill({
                confidenceWeight: TEST_HIGH_CONFIDENCE,
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('[High Confidence]');
        });

        it('confidenceWeight가 0.5 이상 0.8 미만이면 중간 신뢰도로 표시된다', () => {
            const skill = makeSkill({
                confidenceWeight: TEST_MEDIUM_CONFIDENCE,
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('[Medium Confidence]');
        });

        it('labels a low-confidence indicator guide with [Low Confidence] and its roles', () => {
            const skills = [
                {
                    name: 'MACD-V Signal Guide',
                    description: '',
                    type: 'indicator_guide' as const,
                    indicators: [],
                    confidenceWeight: 0.2,
                    content: 'macd-v body',
                    usageRoles: ['confirmation'] as SkillUsageRole[],
                    gating: { tier: 'always_on' as const },
                },
            ];
            const prompt = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                skills
            );
            expect(prompt).toContain(
                '### MACD-V Signal Guide [Low Confidence] [Roles: Confirmation]'
            );
            expect(prompt).toContain('macd-v body');
        });
    });

    describe('Skills 섹션 - skill 내용 포함', () => {
        it('skill의 name이 포함된다', () => {
            const skill = makeSkill({ name: 'Generic Theory Strategy' });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('Generic Theory Strategy');
        });

        it('skill의 content가 포함된다', () => {
            const skill = makeSkill({
                content: '## Special Analysis Criteria\n- Unique content',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('Special Analysis Criteria');
            expect(result).toContain('Unique content');
        });
    });

    describe('Skills 섹션 - 여러 skill이 있을 때', () => {
        it('패턴과 일반 skill이 각자 해당 섹션에 포함된다', () => {
            const patternSkill = makeSkill({
                type: 'pattern',
                name: 'Head and Shoulders',
            });
            const regularSkill = makeSkill({ name: 'RSI Divergence' });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [patternSkill, regularSkill]
            );
            expect(result).toContain('Pattern Analysis');
            expect(result).toContain('Head and Shoulders');
            expect(result).toContain('## Active Skills\n');
            expect(result).toContain('RSI Divergence');
        });

        it('여러 패턴 skill이 모두 패턴 분석 섹션에 포함된다', () => {
            const skills = [
                makeSkill({ type: 'pattern', name: 'Double Top' }),
                makeSkill({ type: 'pattern', name: 'Double Bottom' }),
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                skills
            );
            expect(result).toContain('Double Top');
            expect(result).toContain('Double Bottom');
        });

        it('always_on skill kept, gated-inactive skill dropped when mixed', () => {
            const skills = [
                makeSkill({
                    name: 'Included Skill',
                    confidenceWeight: TEST_HIGH_CONFIDENCE,
                }),
                makeSkill({
                    name: 'Excluded Skill',
                    type: 'indicator_guide',
                    gating: {
                        tier: 'gated',
                        signalKind: 'event',
                        triggers: ['rsi_oversold'],
                    },
                }),
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                skills
            );
            expect(result).toContain('Included Skill');
            expect(result).not.toContain('Excluded Skill');
        });
    });

    describe('최근 봉 데이터 섹션 - bars가 비어있을 때', () => {
        it('데이터 없음을 표시한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).toContain('Recent Bar Data');
            expect(result).toContain('No data available');
        });
    });

    describe('최근 봉 데이터 섹션 - bars가 있을 때', () => {
        it('OHLCV 형식 레이블이 포함된다', () => {
            const bars = [makeBar(0, TEST_CLOSE_PRICE)];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                []
            );
            expect(result).toContain('O:');
            expect(result).toContain('H:');
            expect(result).toContain('L:');
            expect(result).toContain('C:');
            expect(result).toContain('V:');
        });

        it('캔들패턴이 대괄호 형식으로 포함된다', () => {
            const bars = [makeBar(0)];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                []
            );
            expect(result).toMatch(/\[.+]/);
        });

        it('30개를 초과하는 봉이 있을 때 최근 30봉만 포함한다', () => {
            const bars = Array.from({ length: 31 }, (_, i) => makeBar(i));
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                []
            );
            expect(result).toContain('Last 30 bars');
        });

        it('봉이 30개 이하일 때 실제 봉 수를 표시한다', () => {
            const bars = Array.from({ length: 5 }, (_, i) => makeBar(i));
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                []
            );
            expect(result).toContain('Last 5 bars');
        });
    });

    describe('거래량 분석 섹션 - bars가 비어있을 때', () => {
        it('데이터 없음을 표시한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).toContain('Volume Analysis');
            expect(result).toContain('No data available');
        });
    });

    describe('거래량 분석 섹션 - bars가 있을 때', () => {
        it('현재 봉 매수/매도 거래량과 비율이 포함된다', () => {
            const bars = [makeBar(0)];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({
                    buySellVolume: [{ buyVolume: 600, sellVolume: 400 }],
                }),
                []
            );
            expect(result).toContain('Current bar:');
            expect(result).toContain('Buy ratio:');
        });

        it('누적 매수/매도 비율이 포함된다', () => {
            const bars = [makeBar(0)];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({
                    buySellVolume: [{ buyVolume: 600, sellVolume: 400 }],
                }),
                []
            );
            expect(result).toContain('cumulative');
        });
    });

    describe('분석 가이드라인 섹션', () => {
        it('지지/저항 판단 가이드라인이 포함된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).toContain('Support/Resistance Assessment');
        });

        it('가격 목표 산출 가이드라인이 포함된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).toContain('Price Target Calculation');
        });

        it('가이드라인 섹션은 분석 요청 섹션보다 앞에 위치한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            const guidelineIndex = result.indexOf('Analysis Guidelines');
            const requestIndex = result.indexOf('Analysis Request');
            expect(guidelineIndex).toBeLessThan(requestIndex);
        });

        it('instructs the LLM to use "분석 시점 가격" instead of "현재 가격" in Korean output', () => {
            const bars = [
                makeBar(0, TEST_PREV_CLOSE),
                makeBar(1, TEST_NEXT_CLOSE),
            ];
            const prompt = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                [],
                '1Day'
            );
            expect(prompt).toContain('### Price Reference Naming');
            expect(prompt).toContain('분석 시점 가격');
            expect(prompt).toContain('NEVER call it "현재 가격"');
        });
    });

    describe('분석 요청 섹션', () => {
        it('JSON 형식 응답을 요청한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).toContain('JSON');
        });

        it('trend 필드가 요청에 포함된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).toContain('trend');
        });

        it('signals 필드는 요청에 포함되지 않는다 (deprecated)', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            // signals 필드가 스키마 top-level에 키로 존재하지 않아야 함
            // (indicatorResults 내부의 nested signals는 허용)
            expect(result).not.toMatch(/^\s*"signals":/m);
        });

        it('indicatorResults 필드가 요청에 포함된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).toContain('indicatorResults');
        });

        it('keyLevels 필드가 요청에 포함된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).toContain('keyLevels');
        });

        it('patternSummaries 필드가 요청에 포함된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).toContain('patternSummaries');
        });

        it('strategyResults 필드가 요청에 포함된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).toContain('strategyResults');
        });

        it('riskLevel의 구조 스켈레톤은 제거되었다 (스키마가 enum을 강제)', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            // riskLevel은 schema가 enum을 강제하므로 프롬프트의 placeholder 스켈레톤은 중복.
            expect(result).not.toContain('riskLevel');
        });

        it('patternSummaries 구조 스켈레톤(keyPrices/patternLines/timeRange)은 제거되었다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            // patternSummaries는 ### patternSummaries Writing Rules가 별도로 다루므로
            // JSON 스켈레톤 예시는 중복 → 제거.
            expect(result).not.toContain('"keyPrices"');
            expect(result).not.toContain('"label": "넥라인"');
            expect(result).not.toContain('"patternLines"');
            expect(result).not.toContain('"label": "상단 추세선"');
            expect(result).not.toContain('"label": "하단 추세선"');
            expect(result).not.toContain('timeRange');
        });

        it('keyLevels 구조 스켈레톤(reason/poc 예시)은 제거되었다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            // keyLevels는 ### keyLevels Writing Rules가 별도로 다루므로 JSON 스켈레톤 제거.
            expect(result).not.toContain(
                '{ "support": [{ "price": 150.00, "reason": "..." }]'
            );
            expect(result).not.toContain('"poc": { "price": 155.00');
        });

        it('priceTargets 구조 스켈레톤(bullish/bearish 예시 객체)은 제거되었다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            // priceTargets 구조는 스키마가 강제 → JSON 스켈레톤 예시 제거.
            expect(result).not.toContain(
                '{ "bullish": { "targets": [{ "price": 165.00'
            );
            expect(result).not.toContain(
                '"bearish": { "targets": [{ "price": 145.00'
            );
        });

        it('indicatorResults 구조 스켈레톤(예시 배열)은 제거되었다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            // indicatorResults는 ### indicatorResults Writing Rules가 별도로 다룸.
            expect(result).not.toContain(
                '[{ "indicatorName": "RSI Signal Guide", "signals":'
            );
        });
    });

    describe('Field Content Guidance 섹션', () => {
        const buildEmpty = (): string =>
            buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );

        it('## Field Content Guidance 섹션이 포함된다', () => {
            expect(buildEmpty()).toContain('## Field Content Guidance');
        });

        it('summary의 의미적 가이던스가 그대로 유지된다', () => {
            const result = buildEmpty();
            expect(result).toContain('- summary:');
            expect(result).toContain(
                'A comprehensive, accessible Korean markdown summary'
            );
            expect(result).toContain(
                'What is happening with this stock and what does it mean for the investor?'
            );
        });

        it('strategyResults의 **label**: value 포맷 가이던스가 유지된다', () => {
            const result = buildEmpty();
            expect(result).toContain('- strategyResults:');
            expect(result).toContain('each **label**: value on its own line');
        });

        it('actionRecommendation의 하위 필드 가이던스가 유지된다', () => {
            const result = buildEmpty();
            expect(result).toContain('- actionRecommendation:');
            expect(result).toContain('positionAnalysis:');
            expect(result).toContain('riskReward:');
        });

        it('전체 JSON 스켈레톤 객체는 더 이상 렌더링되지 않는다', () => {
            const result = buildEmpty();
            // 이전의 "Schema (field types and example shapes ...)" 전체 스켈레톤 제거.
            expect(result).not.toContain('"trend": "neutral"');
            expect(result).not.toContain('"direction": "ascending", "start":');
        });
    });

    describe('candlePatterns 스키마', () => {
        it('candlePatterns 스키마 키가 프롬프트에 포함된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).toContain('candlePatterns');
        });

        it('가이드라인에 patternSummaries는 Skills 전용이라는 안내 문구가 포함된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).toContain(
                'Only include chart patterns defined in skills/*.md'
            );
        });
    });

    describe('trendlines 스키마', () => {
        it('trendlines JSON 스켈레톤 예시는 제거되었다 (스키마가 구조를 강제)', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            // trendlines 구조는 스키마가 강제하고 ## Trendline Candidates 섹션이 안내하므로
            // JSON 스켈레톤 예시는 중복 → 제거.
            expect(result).not.toContain('"direction": "ascending"');
        });

        it('가이드라인에 추세선 감지 지침이 포함된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).toContain('Trendline Detection');
        });
    });

    describe('분석 요청 섹션 - Skills 패턴 목록 지시', () => {
        it('패턴 skill이 있을 때 patternSummaries 작성 규칙 안내가 포함된다', () => {
            const skill = makeSkill({
                type: 'pattern',
                name: 'Head and Shoulders',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('patternSummaries Writing Rules');
        });

        it('패턴 skill이 있을 때 해당 패턴명이 분석 대상 목록에 포함된다', () => {
            const skill = makeSkill({
                type: 'pattern',
                name: 'Head and Shoulders',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('Skills pattern list to analyze');
            expect(result).toContain('- Head and Shoulders');
        });

        it('여러 패턴 skill이 있을 때 모든 패턴명이 목록에 포함된다', () => {
            const skills = [
                makeSkill({ type: 'pattern', name: 'Double Top' }),
                makeSkill({ type: 'pattern', name: 'Double Bottom' }),
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                skills
            );
            expect(result).toContain('- Double Top');
            expect(result).toContain('- Double Bottom');
        });

        it('패턴 skill이 없을 때 patternSummaries 작성 규칙 안내가 포함되지 않는다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).not.toContain('patternSummaries Writing Rules');
        });

        it('패턴 skill이 있을 때 캔들 패턴을 patternSummaries에 포함하지 말라는 지시가 포함된다', () => {
            const skill = makeSkill({
                type: 'pattern',
                name: 'Head and Shoulders',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain(
                'Do not include candle patterns (single/multi candle) in patternSummaries'
            );
        });

        it('패턴 skill이 있을 때 감지되지 않은 패턴도 detected: false로 포함하라는 지시가 있다', () => {
            const skill = makeSkill({
                type: 'pattern',
                name: 'Head and Shoulders',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('detected: false');
        });

        it('일반 skill만 있을 때 patternSummaries 작성 규칙 안내가 포함되지 않는다', () => {
            const skill = makeSkill({
                name: 'RSI Divergence',
                type: undefined,
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).not.toContain('patternSummaries Writing Rules');
        });

        it('gated-inactive 패턴 skill은 목록에 포함되지 않는다', () => {
            const skill = makeSkill({
                type: 'pattern',
                name: 'Excluded Pattern',
                gating: {
                    tier: 'gated',
                    signalKind: 'event',
                    triggers: ['rsi_oversold'],
                },
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).not.toContain('- Excluded Pattern');
        });
    });

    describe('skills 기본값', () => {
        it('skills 파라미터를 생략하면 빈 배열과 동일하게 동작한다', () => {
            const withEmpty = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            const withDefault = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators()
            );
            expect(withDefault).toBe(withEmpty);
        });
    });

    describe('한국어 응답 지시', () => {
        it('분석 요청 섹션에 한국어 응답 지시가 포함된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).toContain('Korean');
        });

        it('한국어 응답 지시는 Field Content Guidance 본문보다 앞에 위치한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            const koreanInstructionIndex = result.indexOf('Respond in Korean.');
            // '- summary:'는 실제 Field Content Guidance 본문에만 존재(Intent 블록의
            // 섹션 참조 텍스트가 아님)하므로 본문 위치의 안정적 마커로 사용한다.
            const guidanceBodyIndex = result.indexOf('- summary:');
            expect(koreanInstructionIndex).toBeGreaterThanOrEqual(0);
            expect(guidanceBodyIndex).toBeGreaterThan(koreanInstructionIndex);
        });
    });

    describe('캔들 패턴 레이블', () => {
        it('단봉 캔들 패턴 레이블이 대괄호 형식으로 bar row에 포함된다', () => {
            const bars = [makeBar(0)];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                []
            );
            expect(result).toMatch(/\[.+]/);
        });

        it('다봉 패턴 감지 시 패턴명이 포함된다', () => {
            // prevBar(음봉) → currBar(양봉, 장악형 조건 충족) → bullish_engulfing 반드시 감지됨
            const bars = makeEngulfingBars();
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                []
            );
            expect(result).toMatch(/Multi-candle pattern: .+/);
        });

        it('슬라이딩 윈도우로 감지된 다봉 패턴은 봉 위치와 함께 포함된다', () => {
            // prevBar(음봉) → currBar(양봉, 장악형 조건 충족) → bullish_engulfing 반드시 감지됨
            const bars = makeEngulfingBars();
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                []
            );
            expect(result).toMatch(/\[\d+ bars ago] Multi-candle pattern: .+/);
        });

        it('다봉 패턴 라인에 사전 계산된 trend가 포함된다', () => {
            // bullish_engulfing → getMultiPatternTrend → 'bullish'
            const bars = makeEngulfingBars();
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                []
            );
            expect(result).toMatch(
                /Multi-candle pattern: bullish_engulfing \[trend: bullish]/
            );
        });

        it('단봉 패턴은 봉 위치 정보와 함께 패턴 섹션에 포함된다', () => {
            const bars = [makeBar(0)];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                []
            );
            expect(result).toMatch(/\[\d+ bars ago] Single candle pattern: .+/);
        });

        it('단봉 패턴 라인에 사전 계산된 trend가 포함된다', () => {
            // hammer → getSinglePatternTrend → 'bullish'
            const hammerBar: Bar = {
                time: TEST_BAR_BASE_TIME,
                open: TEST_BAR_BASE_PRICE,
                high: TEST_BAR_BASE_PRICE + HAMMER_HIGH_OFFSET,
                low: TEST_BAR_BASE_PRICE + HAMMER_LOW_OFFSET,
                close: TEST_BAR_BASE_PRICE + HAMMER_BODY_OFFSET,
                volume: TEST_BAR_BASE_VOLUME,
            };
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [hammerBar],
                makeIndicators(),
                []
            );
            expect(result).toMatch(
                /Single candle pattern: hammer \[trend: bullish]/
            );
        });

        it('다봉 패턴이 있으면 해당 다봉 패턴과 관련 봉의 단봉 패턴만 포함된다', () => {
            // hammer bar (단봉) + engulfing pair (다봉)
            // 마지막 패턴(다봉)과 그 관련 봉의 단봉만 포함되어야 함
            const hammerBar: Bar = {
                time: TEST_BAR_BASE_TIME - TEST_BAR_INTERVAL,
                open: TEST_BAR_BASE_PRICE,
                high: TEST_BAR_BASE_PRICE + HAMMER_HIGH_OFFSET,
                low: TEST_BAR_BASE_PRICE + HAMMER_LOW_OFFSET,
                close: TEST_BAR_BASE_PRICE + HAMMER_BODY_OFFSET,
                volume: TEST_BAR_BASE_VOLUME,
            };
            const [engulfingPrev, engulfingCurr] = makeEngulfingBars();
            const bars = [hammerBar, engulfingPrev, engulfingCurr];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                []
            );
            // Multi-candle pattern should be included
            expect(result).toMatch(/Multi-candle pattern: .+/);
            // Hammer bar is NOT involved in the multi pattern, so it should be excluded
            const patternSection =
                result.split('Short-term Trend Signal')[1] ?? '';
            expect(patternSection).not.toContain('Hammer');
        });

        it('다봉 패턴만 존재할 때 해당 다봉 패턴만 포함된다', () => {
            // prevBar(음봉) → currBar(양봉, 장악형 조건 충족) → bullish_engulfing 감지
            // 다봉 패턴에 관련된 봉의 단봉 패턴은 detectCandlePatternEntries에서 이미 제외됨
            const bars = makeEngulfingBars();
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                []
            );
            expect(result).toMatch(/Multi-candle pattern/);
            expect(result).not.toMatch(/Single candle pattern/);
        });

        it('최근 15봉 이전에만 존재하는 다봉 패턴은 감지 결과에 포함되지 않는다', () => {
            // bars[3], bars[4]: bullish_engulfing (bearish then engulfing bullish)
            // bars[5] ~ bars[19]: 15 neutral bars with no detectable pattern
            const engulfingPrev: Bar = {
                time: TEST_BAR_BASE_TIME + 3 * TEST_BAR_INTERVAL,
                open: 105,
                high: 106,
                low: 99,
                close: 100,
                volume: TEST_BAR_BASE_VOLUME,
            };
            const engulfingCurr: Bar = {
                time: TEST_BAR_BASE_TIME + 4 * TEST_BAR_INTERVAL,
                open: 99,
                high: 108,
                low: 98,
                close: 107,
                volume: TEST_BAR_BASE_VOLUME,
            };
            const neutralBars: Bar[] = Array.from(
                { length: CANDLE_PATTERN_DETECTION_BARS },
                (_, i) => ({
                    time: TEST_BAR_BASE_TIME + (5 + i) * TEST_BAR_INTERVAL,
                    open: 103,
                    high: 104,
                    low: 102,
                    close: 103,
                    volume: TEST_BAR_BASE_VOLUME,
                })
            );
            const leadingBars: Bar[] = Array.from({ length: 3 }, (_, i) => ({
                time: TEST_BAR_BASE_TIME + i * TEST_BAR_INTERVAL,
                open: 103,
                high: 104,
                low: 102,
                close: 103,
                volume: TEST_BAR_BASE_VOLUME,
            }));
            const bars = [
                ...leadingBars,
                engulfingPrev,
                engulfingCurr,
                ...neutralBars,
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                []
            );
            expect(result).not.toContain('bullish_engulfing');
        });
    });

    describe('Skills 섹션 - type이 indicator_guide인 skill일 때', () => {
        it('Indicator Signal Guides 섹션에 포함된다', () => {
            const skill = makeSkill({
                type: 'indicator_guide',
                name: 'RSI Signal Guide',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('Indicator Signal Guides');
            expect(result).toContain('RSI Signal Guide');
        });

        it('패턴 분석 섹션에는 포함되지 않는다', () => {
            const skill = makeSkill({
                type: 'indicator_guide',
                name: 'RSI Signal Guide',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).not.toContain('## Pattern Analysis\n');
        });

        it('활성화된 Skills 섹션에는 포함되지 않는다', () => {
            const skill = makeSkill({
                type: 'indicator_guide',
                name: 'RSI Signal Guide',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).not.toContain('## Active Skills\n');
        });

        it('indicator_guide skill이 없을 때 Indicator Signal Guides 섹션이 포함되지 않는다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).not.toContain('## Indicator Signal Guides\n');
        });

        it('여러 indicator_guide skill이 모두 Indicator Signal Guides 섹션에 포함된다', () => {
            const skills = [
                makeSkill({
                    type: 'indicator_guide',
                    name: 'RSI Signal Guide',
                }),
                makeSkill({
                    type: 'indicator_guide',
                    name: 'MACD Signal Guide',
                }),
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                skills
            );
            expect(result).toContain('Indicator Signal Guides');
            expect(result).toContain('RSI Signal Guide');
            expect(result).toContain('MACD Signal Guide');
        });

        it('indicator_guide, pattern, regular skill이 각각 해당 섹션에 포함된다', () => {
            const indicatorGuideSkill = makeSkill({
                type: 'indicator_guide',
                name: 'RSI Signal Guide',
            });
            const patternSkill = makeSkill({
                type: 'pattern',
                name: 'Head and Shoulders',
            });
            const regularSkill = makeSkill({
                type: undefined,
                name: 'Generic Theory Strategy',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [indicatorGuideSkill, patternSkill, regularSkill]
            );
            expect(result).toContain('Indicator Signal Guides');
            expect(result).toContain('RSI Signal Guide');
            expect(result).toContain('Pattern Analysis');
            expect(result).toContain('Head and Shoulders');
            expect(result).toContain('## Active Skills\n');
            expect(result).toContain('Generic Theory Strategy');
        });

        it('gated-inactive indicator_guide skill은 포함되지 않는다', () => {
            const skill = makeSkill({
                type: 'indicator_guide',
                name: 'Low Confidence Guide',
                gating: {
                    tier: 'gated',
                    signalKind: 'event',
                    triggers: ['rsi_oversold'],
                },
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).not.toContain('Low Confidence Guide');
            expect(result).not.toContain('## Indicator Signal Guides\n');
        });
    });

    describe('분석 요청 섹션 - Indicator Guide Writing Rules', () => {
        it('indicator_guide skill이 있을 때 indicatorResults Writing Rules for Indicator Guides 섹션이 포함된다', () => {
            const skill = makeSkill({
                type: 'indicator_guide',
                name: 'RSI Signal Guide',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain(
                'indicatorResults Writing Rules for Indicator Guides'
            );
        });

        it('indicator_guide skill이 없을 때 indicatorResults Writing Rules for Indicator Guides 섹션이 포함되지 않는다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).not.toContain(
                'indicatorResults Writing Rules for Indicator Guides'
            );
        });

        it('indicator_guide skill 이름 목록이 분석 요청에 포함된다', () => {
            const skills = [
                makeSkill({
                    type: 'indicator_guide',
                    name: 'RSI Signal Guide',
                }),
                makeSkill({
                    type: 'indicator_guide',
                    name: 'MACD Signal Guide',
                }),
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                skills
            );
            expect(result).toContain(
                'Indicator guide list (use these exact names for indicatorName):'
            );
            expect(result).toContain('- RSI Signal Guide');
            expect(result).toContain('- MACD Signal Guide');
        });

        it('indicator_guide Writing Rules에 시그널 type을 "skill"로 사용하도록 지시한다', () => {
            const skill = makeSkill({
                type: 'indicator_guide',
                name: 'RSI Signal Guide',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain(
                'The type field of each signal entry MUST be "skill"'
            );
        });

        it('indicator_guide Writing Rules에 description 필드 작성 형식 지시가 포함된다', () => {
            const skill = makeSkill({
                type: 'indicator_guide',
                name: 'RSI Signal Guide',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain(
                'The description field MUST be written in Korean and MUST include the indicator name and specific numeric condition'
            );
        });

        it('indicator_guide Writing Rules는 pattern Writing Rules보다 앞에 위치한다', () => {
            const indicatorGuideSkill = makeSkill({
                type: 'indicator_guide',
                name: 'RSI Signal Guide',
            });
            const patternSkill = makeSkill({
                type: 'pattern',
                name: 'Head and Shoulders',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [indicatorGuideSkill, patternSkill]
            );
            const indicatorGuideIndex = result.indexOf(
                'indicatorResults Writing Rules for Indicator Guides'
            );
            const patternWritingRulesIndex = result.indexOf(
                'patternSummaries Writing Rules'
            );
            expect(indicatorGuideIndex).toBeLessThan(patternWritingRulesIndex);
        });

        it('gated-inactive indicator_guide skill은 Writing Rules 목록에 포함되지 않는다', () => {
            const skill = makeSkill({
                type: 'indicator_guide',
                name: 'Low Confidence Guide',
                gating: {
                    tier: 'gated',
                    signalKind: 'event',
                    triggers: ['rsi_oversold'],
                },
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).not.toContain(
                'indicatorResults Writing Rules for Indicator Guides'
            );
            expect(result).not.toContain('- Low Confidence Guide');
        });

        it('indicator_guide Writing Rules에 indicatorName 비어있음 금지를 명시한다', () => {
            const skill = makeSkill({
                type: 'indicator_guide',
                name: 'RSI Signal Guide',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('non-empty string');
            expect(result).toContain('never use an empty string');
        });

        it('indicator_guide Writing Rules에 다중 인디케이터 결합을 금지한다', () => {
            const skill = makeSkill({
                type: 'indicator_guide',
                name: 'RSI Signal Guide',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('EXACTLY ONE indicator guide');
            expect(result).toContain('Never combine multiple indicators');
        });

        it('indicator_guide Writing Rules에 신호가 없으면 entry를 생성하지 않도록 지시한다', () => {
            const skill = makeSkill({
                type: 'indicator_guide',
                name: 'RSI Signal Guide',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain(
                'simply omit that guide from indicatorResults'
            );
        });

        it('indicator_guide Writing Rules에 signal trend 할당 가이드라인이 포함된다', () => {
            const skill = makeSkill({
                type: 'indicator_guide',
                name: 'RSI Signal Guide',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('Signal trend assignment:');
            expect(result).toContain('bullish: the indicator signal suggests');
            expect(result).toContain('bearish: the indicator signal suggests');
            expect(result).toContain('neutral: the indicator is in');
        });

        it('indicatorResults/trendlines의 enum placeholder 스켈레톤은 제거되었다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            // 스키마가 trend/direction enum을 강제하므로 placeholder 예시는 중복 → 제거.
            expect(result).not.toContain('"trend": "neutral"');
            expect(result).not.toContain('"direction": "ascending"');
        });
    });

    describe('분석 가이드라인 - Name Field Matching', () => {
        let result: string;

        beforeEach(() => {
            result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
        });

        it('공통 Name Field Matching 섹션이 포함된다', () => {
            expect(result).toContain('### Name Field Matching');
        });

        it('name 필드가 비어있으면 안 된다는 규칙이 명시된다', () => {
            expect(result).toContain('MUST exactly match');
            expect(result).toContain('empty strings');
        });

        it('verbatim copy 지시가 포함된다', () => {
            expect(result).toContain('Copy verbatim');
            expect(result).toContain('never translate, abbreviate');
        });

        it('적용 대상 필드가 명시된다 (skillName, strategyName, indicatorName)', () => {
            expect(result).toContain('skillName');
            expect(result).toContain('strategyName');
            expect(result).toContain('indicatorName');
        });

        it('skill이 없으면 entry를 omit하라는 지시가 포함된다', () => {
            expect(result).toContain(
                'Omit the entry if no matching skill exists'
            );
        });
    });

    describe('분석 요청 섹션 - patternSummaries trend 규칙', () => {
        it('detected: false일 때도 trend 필수임을 명시한다', () => {
            const skill = makeSkill({
                type: 'pattern',
                name: 'Head and Shoulders',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain(
                'trend field is REQUIRED for every patternSummaries entry'
            );
            expect(result).toContain(
                'including entries where detected is false'
            );
        });

        it('not-detected 패턴의 고유 방향 예시가 포함된다', () => {
            const skill = makeSkill({
                type: 'pattern',
                name: 'Head and Shoulders',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('head-and-shoulders → bearish');
            expect(result).toContain('inverse head-and-shoulders → bullish');
        });

        it('NEVER omit trend 지시가 포함된다', () => {
            const skill = makeSkill({
                type: 'pattern',
                name: 'Head and Shoulders',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('NEVER omit the trend field');
        });
    });

    describe('요약 작성 가이드라인', () => {
        let result: string;

        beforeEach(() => {
            result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
        });

        it('접근 가능한 언어 지시가 포함된다', () => {
            expect(result).toContain('accessible');
        });

        it('전략 결론 포함 지시가 포함된다', () => {
            expect(result).toContain('INCLUDE strategy conclusions');
        });

        it('Summary Writing Checklist 섹션이 포함된다', () => {
            expect(result).toContain('Summary Writing Checklist');
        });

        it('체크리스트에 추세 방향 단계가 포함된다', () => {
            expect(result).toContain('1. STATE the overall trend');
        });

        it('체크리스트에 지표 요약 단계가 포함된다', () => {
            expect(result).toContain('2. SUMMARIZE key indicator');
        });

        it('체크리스트에 캔들/차트 패턴 단계가 포함된다', () => {
            expect(result).toContain(
                '3. REPORT detected chart/candle patterns'
            );
        });

        it('체크리스트에 지지/저항 단계가 포함된다', () => {
            expect(result).toContain('5. DESCRIBE key support/resistance');
        });

        it('체크리스트에 리스크 평가 단계가 포함된다', () => {
            expect(result).toContain('6. ASSESS risk');
        });

        it('체크리스트에 결론 단계가 포함된다', () => {
            expect(result).toContain('7. CONCLUDE');
        });

        it('summary 문단을 빈 줄로 구분하도록 지시한다', () => {
            expect(result).toContain('Use \\n\\n between topic paragraphs');
            expect(result).toContain('3 to 5 short paragraphs');
        });
    });

    describe('매매 추천 가이드라인', () => {
        let result: string;

        beforeEach(() => {
            result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
        });

        it('Action Recommendation Decision Tree 섹션이 포함된다', () => {
            expect(result).toContain('Action Recommendation Decision Tree');
        });

        it('결정 트리 Step 1: entryRecommendation 판단 로직이 포함된다', () => {
            expect(result).toContain('Step 1');
            expect(result).toContain('"enter"');
            expect(result).toContain('"wait"');
            expect(result).toContain('"avoid"');
        });

        it('결정 트리 Step 2: 가격 계산 규칙이 포함된다', () => {
            expect(result).toContain('Step 2');
            expect(result).toContain(
                'For "enter" and "wait": entryPrices, stopLoss, and takeProfitPrices are REQUIRED.'
            );
            expect(result).toContain(
                'For "avoid": entryPrices must be [], takeProfitPrices must be [], and stopLoss must be omitted.'
            );
        });

        it('결정 트리 Step 3: 텍스트 필드 작성 지시가 포함된다', () => {
            expect(result).toContain('Step 3');
            expect(result).toContain('positionAnalysis');
            expect(result).toContain(
                'For "avoid", state that no long entry range is valid under the current data'
            );
            expect(result).toContain('For "avoid", do not invent exit prices');
            expect(result).toContain(
                'For "avoid", state that risk/reward cannot be calculated'
            );
        });

        it('actionRecommendation 텍스트 필드를 문단과 목록으로 작성하도록 지시한다', () => {
            expect(result).toContain('Step 3 formatting');
            expect(result).toContain(
                'each actionRecommendation text field must be readable markdown Korean'
            );
            expect(result).toContain(
                'use bullet lists for multiple prices or conditions'
            );
        });

        it('actionRecommendation 필드 가이던스가 포함된다', () => {
            expect(result).toContain('- actionRecommendation:');
        });

        it('actionRecommendation 가이던스에 positionAnalysis 하위 필드가 포함된다', () => {
            expect(result).toContain('positionAnalysis:');
        });

        it('actionRecommendation 가이던스에 entry 하위 필드가 포함된다', () => {
            expect(result).toContain('entry:');
        });

        it('actionRecommendation 가이던스에 exit 하위 필드가 포함된다', () => {
            expect(result).toContain('exit:');
        });

        it('actionRecommendation 가이던스에 riskReward 하위 필드가 포함된다', () => {
            expect(result).toContain('riskReward:');
        });

        it('entryPrices/stopLoss/takeProfitPrices 구조 placeholder는 제거되었다', () => {
            // 이 구조 필드들은 스키마가 강제하고 ### Action Recommendation Decision Tree가
            // 의미를 안내하므로 JSON placeholder 예시는 중복 → 제거.
            expect(result).not.toContain('"entryPrices": [165.00, 167.00]');
            expect(result).not.toContain('"stopLoss": 160.00');
            expect(result).not.toContain(
                '"takeProfitPrices": [180.00, 195.00]'
            );
        });
    });

    describe('Skills 섹션 - type이 strategy인 skill일 때', () => {
        const strategySkill = makeSkill({
            type: 'strategy',
            name: '엘리어트 파동',
        });

        it('Strategy Analysis 섹션에 포함된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [strategySkill]
            );
            expect(result).toContain('Strategy Analysis');
            expect(result).toContain('엘리어트 파동');
        });

        it('Active Skills 섹션에는 포함되지 않는다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [strategySkill]
            );
            expect(result).not.toContain('## Active Skills\n');
        });

        it('Pattern Analysis 섹션에는 포함되지 않는다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [strategySkill]
            );
            expect(result).not.toContain('## Pattern Analysis\n');
        });

        it('strategy skill에 대한 strategyResults Writing Rules 지시사항이 생성된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [strategySkill]
            );
            expect(result).toContain(
                'strategyResults Writing Rules for Strategy Skills'
            );
            expect(result).toContain('- 엘리어트 파동');
        });

        it('strategyResults summary를 한 줄 나열이 아닌 마크다운 줄 단위로 작성하도록 지시한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [strategySkill]
            );
            expect(result).toContain(
                'Put each **label**: value item on its own line'
            );
            expect(result).toContain(
                'Never return strategyResults[].summary as one sentence'
            );
        });

        it('strategy skill이 없으면 strategyResults Writing Rules 지시사항이 포함되지 않는다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).not.toContain(
                'strategyResults Writing Rules for Strategy Skills'
            );
        });

        it('gated-inactive strategy skill은 포함되지 않는다', () => {
            const skill = makeSkill({
                type: 'strategy',
                name: '낮은신뢰도전략',
                gating: {
                    tier: 'gated',
                    signalKind: 'event',
                    triggers: ['rsi_oversold'],
                },
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).not.toContain('낮은신뢰도전략');
            expect(result).not.toContain('Strategy Analysis');
        });

        it('pattern, strategy, regular skill이 모두 있을 때 각 섹션에 올바르게 분류된다', () => {
            const patternSkill = makeSkill({
                type: 'pattern',
                name: 'Head and Shoulders',
            });
            const strategySkill = makeSkill({
                type: 'strategy',
                name: '엘리어트 파동',
            });
            const regularSkill = makeSkill({
                type: undefined,
                name: 'Generic Theory Strategy',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [patternSkill, strategySkill, regularSkill]
            );
            expect(result).toContain('Pattern Analysis');
            expect(result).toContain('Head and Shoulders');
            expect(result).toContain('Strategy Analysis');
            expect(result).toContain('엘리어트 파동');
            expect(result).toContain('## Active Skills\n');
            expect(result).toContain('Generic Theory Strategy');
        });

        it('strategyInstruction에 trend 필드 필수 + neutral fallback을 명시한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [strategySkill]
            );
            expect(result).toContain('NEVER omit this field');
            expect(result).toContain('use "neutral"');
        });

        it('strategyInstruction에 REQUIRED FIELDS 지시가 포함된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [strategySkill]
            );
            expect(result).toContain('REQUIRED FIELDS');
        });
    });

    describe('Skills 섹션 - type이 candlestick인 skill일 때', () => {
        it('Candlestick Pattern Guides 섹션에 포함된다', () => {
            const skill = makeSkill({
                type: 'candlestick',
                name: 'Engulfing Pattern Guide',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('Candlestick Pattern Guides');
            expect(result).toContain('Engulfing Pattern Guide');
        });

        it('패턴 분석 섹션에는 포함되지 않는다', () => {
            const skill = makeSkill({
                type: 'candlestick',
                name: 'Engulfing Pattern Guide',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).not.toContain('## Pattern Analysis\n');
        });

        it('candlePatterns 작성 규칙에 제공된 trend를 사용하라는 지시가 포함된다', () => {
            const skill = makeSkill({
                type: 'candlestick',
                name: 'Engulfing Pattern Guide',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain(
                'The trend field MUST use the value provided in the [trend: ...] label of ## Detected Candle Patterns. Do not re-judge or override it.'
            );
        });

        it('candlestick skill이 없어도 공통 가이드라인에 제공된 trend 사용 지시가 포함된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).toContain(
                'For each detected candle pattern, the candlePatterns[].trend field MUST copy the value from the [trend: ...] label in ## Detected Candle Patterns verbatim. Do not re-judge the trend yourself.'
            );
        });

        it('활성화된 Skills 섹션에는 포함되지 않는다', () => {
            const skill = makeSkill({
                type: 'candlestick',
                name: 'Engulfing Pattern Guide',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).not.toContain('## Active Skills\n');
        });

        it('candlestick skill이 없을 때 Candlestick Pattern Guides 섹션이 포함되지 않는다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).not.toContain('## Candlestick Pattern Guides\n');
        });

        it('여러 candlestick skill이 모두 Candlestick Pattern Guides 섹션에 포함된다', () => {
            const skills = [
                makeSkill({
                    type: 'candlestick',
                    name: 'Engulfing Pattern Guide',
                }),
                makeSkill({
                    type: 'candlestick',
                    name: 'Doji Pattern Guide',
                }),
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                skills
            );
            expect(result).toContain('Candlestick Pattern Guides');
            expect(result).toContain('Engulfing Pattern Guide');
            expect(result).toContain('Doji Pattern Guide');
        });

        it('candlestick, pattern, indicator_guide, strategy, regular skill이 각각 해당 섹션에 포함된다', () => {
            const candlestickSkill = makeSkill({
                type: 'candlestick',
                name: 'Engulfing Pattern Guide',
            });
            const patternSkill = makeSkill({
                type: 'pattern',
                name: 'Head and Shoulders',
            });
            const indicatorGuideSkill = makeSkill({
                type: 'indicator_guide',
                name: 'RSI Signal Guide',
            });
            const strategySkill = makeSkill({
                type: 'strategy',
                name: '엘리어트 파동',
            });
            const regularSkill = makeSkill({
                type: undefined,
                name: 'Generic Theory Strategy',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [
                    candlestickSkill,
                    patternSkill,
                    indicatorGuideSkill,
                    strategySkill,
                    regularSkill,
                ]
            );
            expect(result).toContain('Candlestick Pattern Guides');
            expect(result).toContain('Engulfing Pattern Guide');
            expect(result).toContain('Pattern Analysis');
            expect(result).toContain('Head and Shoulders');
            expect(result).toContain('Indicator Signal Guides');
            expect(result).toContain('RSI Signal Guide');
            expect(result).toContain('Strategy Analysis');
            expect(result).toContain('엘리어트 파동');
            expect(result).toContain('## Active Skills\n');
            expect(result).toContain('Generic Theory Strategy');
        });

        it('gated-inactive candlestick skill은 포함되지 않는다', () => {
            const skill = makeSkill({
                type: 'candlestick',
                name: 'Low Confidence Guide',
                gating: {
                    tier: 'gated',
                    signalKind: 'event',
                    triggers: ['bullish_engulfing'],
                },
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).not.toContain('Low Confidence Guide');
            expect(result).not.toContain('## Candlestick Pattern Guides\n');
        });
    });

    describe('분석 요청 섹션 - Candlestick Writing Rules', () => {
        it('candlestick skill이 있을 때 candlePatterns Writing Rules 섹션이 포함된다', () => {
            const skill = makeSkill({
                type: 'candlestick',
                name: 'Engulfing Pattern Guide',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain(
                'candlePatterns Writing Rules for Candlestick Skills'
            );
        });

        it('candlestick skill이 없을 때 candlePatterns Writing Rules 섹션이 포함되지 않는다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).not.toContain(
                'candlePatterns Writing Rules for Candlestick Skills'
            );
        });

        it('candlestick skill 이름 목록이 분석 요청에 포함된다', () => {
            const skills = [
                makeSkill({
                    type: 'candlestick',
                    name: 'Engulfing Pattern Guide',
                }),
                makeSkill({
                    type: 'candlestick',
                    name: 'Doji Pattern Guide',
                }),
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                skills
            );
            expect(result).toContain(
                'Candlestick pattern guide list to apply:'
            );
            expect(result).toContain('- Engulfing Pattern Guide');
            expect(result).toContain('- Doji Pattern Guide');
        });
    });

    describe('Skills 섹션 - type이 support_resistance인 skill일 때', () => {
        it('Support/Resistance Tool Guides 섹션에 포함된다', () => {
            const skill = makeSkill({
                type: 'support_resistance',
                name: '피봇 포인트',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain('Support/Resistance Tool Guides');
            expect(result).toContain('피봇 포인트');
        });

        it('활성화된 Skills 섹션에는 포함되지 않는다', () => {
            const skill = makeSkill({
                type: 'support_resistance',
                name: '피봇 포인트',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).not.toContain('## Active Skills\n');
        });

        it('support_resistance skill이 없을 때 Support/Resistance Tool Guides 섹션이 포함되지 않는다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).not.toContain('## Support/Resistance Tool Guides\n');
        });

        it('여러 support_resistance skill이 모두 Support/Resistance Tool Guides 섹션에 포함된다', () => {
            const skills = [
                makeSkill({
                    type: 'support_resistance',
                    name: '피봇 포인트',
                }),
                makeSkill({
                    type: 'support_resistance',
                    name: '피보나치 되돌림',
                }),
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                skills
            );
            expect(result).toContain('Support/Resistance Tool Guides');
            expect(result).toContain('피봇 포인트');
            expect(result).toContain('피보나치 되돌림');
        });

        it('gated-inactive support_resistance skill은 포함되지 않는다', () => {
            const skill = makeSkill({
                type: 'support_resistance',
                name: 'Low Confidence SR',
                gating: {
                    tier: 'gated',
                    signalKind: 'event',
                    triggers: ['rsi_oversold'],
                },
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).not.toContain('Low Confidence SR');
            expect(result).not.toContain('## Support/Resistance Tool Guides\n');
        });
    });

    describe('분석 요청 섹션 - Support/Resistance Writing Rules', () => {
        it('support_resistance skill이 있을 때 keyLevels Writing Rules 섹션이 포함된다', () => {
            const skill = makeSkill({
                type: 'support_resistance',
                name: '피봇 포인트',
            });
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [skill]
            );
            expect(result).toContain(
                'keyLevels Writing Rules for Support/Resistance Tools'
            );
        });

        it('support_resistance skill이 없을 때 keyLevels Writing Rules 섹션이 포함되지 않는다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).not.toContain(
                'keyLevels Writing Rules for Support/Resistance Tools'
            );
        });

        it('support_resistance skill 이름 목록이 분석 요청에 포함된다', () => {
            const skills = [
                makeSkill({
                    type: 'support_resistance',
                    name: '피봇 포인트',
                }),
                makeSkill({
                    type: 'support_resistance',
                    name: '피보나치 확장',
                }),
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                skills
            );
            expect(result).toContain('Support/Resistance tool list to apply:');
            expect(result).toContain('- 피봇 포인트');
            expect(result).toContain('- 피보나치 확장');
        });
    });

    describe('Critical Response Rules', () => {
        it('분석 요청에 Critical Response Rules 섹션이 포함된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(result).toContain('### Critical Response Rules');
        });

        it('스키마가 강제하는 타입/구조 재진술 규칙은 제거되었다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            // responseSchema(필수/타입/items)가 강제하므로 프롬프트에서 제거됨.
            expect(result).not.toContain('return an empty array []');
            expect(result).not.toContain(
                'Never include null or undefined inside arrays'
            );
            expect(result).not.toContain(
                'must be plain numbers (e.g., 150.25), not strings'
            );
        });

        it('의미적 안티-할루시네이션 규칙은 유지된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            // 타임스탬프 verbatim 복사(어떤 값을 쓸지) — 스키마가 강제하지 못함.
            expect(result).toContain(
                'copied verbatim from the [ts:<number>] markers in the bar data'
            );
            // 옵셔널 객체 필드를 채울지/생략할지 — 모델 판단 가이드.
            expect(result).toContain(
                'For optional object fields (poc in keyLevels, actionRecommendation), provide an object that follows the field rules or omit the field entirely. Never set the object itself to null.'
            );
        });
    });

    describe('중복 지시문 통합 (SSOT)', () => {
        let result: string;

        beforeAll(() => {
            result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
        });

        describe('읽기 좋은 텍스트 포맷 규칙', () => {
            it('Readable Text Formatting Rules SSOT 블록이 정확히 한 번만 등장한다', () => {
                expect(
                    countOccurrences(
                        result,
                        '### Readable Text Formatting Rules'
                    )
                ).toBe(1);
            });

            it('Analysis Request 섹션의 중복 readable-text 재진술이 제거되었다', () => {
                expect(result).not.toContain(
                    'Use markdown-friendly readable text'
                );
            });

            it('paragraph 분리(\\n\\n) 지시는 SSOT 블록에만 남아 있다', () => {
                expect(result).toContain(
                    'Use \\n\\n to separate paragraphs when the context changes'
                );
                expect(result).not.toContain(
                    'Use \\n\\n to separate context paragraphs in summary and other long-form text fields'
                );
            });
        });

        describe('enum 허용값', () => {
            it('Allowed Enum Values 섹션은 제거되었다 (responseSchema enum이 강제)', () => {
                // 스키마의 enum이 모든 허용값을 강제하므로 프롬프트의 값 목록은 중복.
                expect(result).not.toContain('### Allowed Enum Values');
            });

            it('enum 값 목록 및 enum 재진술 규칙은 프롬프트에 더 이상 등장하지 않는다', () => {
                expect(result).not.toContain(
                    'riskLevel: "low", "medium", "high"'
                );
                expect(result).not.toContain(
                    'indicatorResults[].signals[].strength: "strong", "moderate", "weak"'
                );
                expect(result).not.toContain(
                    'trendlines[].direction: "ascending", "descending"'
                );
                expect(result).not.toContain(
                    'Enum fields must contain exactly one allowed literal, never pipe-separated text (see Allowed Enum Values below).'
                );
            });
        });
    });

    describe('Analysis Intent 블록', () => {
        it('프롬프트에 Analysis Intent 블록이 포함된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );

            expect(result).toContain('## Analysis Intent');
        });

        it('Analysis Intent 블록이 데이터 분석 지시를 포함한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );

            expect(result).toContain('Analyze the symbol below');
        });

        it('Analysis Intent 블록이 Timeframe 뒤에 위치한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );

            const timeframeIndex = result.indexOf('Timeframe:');
            const intentIndex = result.indexOf('## Analysis Intent');

            expect(timeframeIndex).toBeGreaterThanOrEqual(0);
            expect(intentIndex).toBeGreaterThan(timeframeIndex);
        });

        it('Analysis Intent 블록이 Indicator Values 섹션보다 앞에 위치한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );

            const intentIndex = result.indexOf('## Analysis Intent');
            const indicatorIndex = result.indexOf('## Indicator Values');

            expect(intentIndex).toBeGreaterThanOrEqual(0);
            expect(indicatorIndex).toBeGreaterThan(intentIndex);
        });

        it('제공된 숫자를 사용하되 Market Reference를 권고 맥락으로 다루라는 안내가 포함된다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );

            expect(result).toContain(
                'treat the Market Reference as advisory context'
            );
        });
    });

    describe('결정성 보장 (Determinism)', () => {
        it('동일 입력으로 두 번 호출하면 동일한 문자열을 반환한다', () => {
            const bars = [makeBar(0), makeBar(1)];
            const indicators = makeIndicators();
            const skills = [makeSkill({ name: 'Skill A' })];

            const result1 = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                indicators,
                skills
            );
            const result2 = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                indicators,
                skills
            );

            expect(result1).toBe(result2);
        });

        it('skills 배열 순서가 달라도 동일한 문자열을 반환한다', () => {
            const bars = [makeBar(0)];
            const indicators = makeIndicators();
            const skillA = makeSkill({
                name: 'Zeta Skill',
                content: '## Zeta\n- content',
            });
            const skillB = makeSkill({
                name: 'Alpha Skill',
                content: '## Alpha\n- content',
            });

            const result1 = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                indicators,
                [skillA, skillB]
            );
            const result2 = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                indicators,
                [skillB, skillA]
            );

            expect(result1).toBe(result2);
        });

        it('skills가 name 기준 오름차순으로 정렬되어 포함된다', () => {
            const bars = [makeBar(0)];
            const indicators = makeIndicators();
            const skillA = makeSkill({
                name: 'Zebra Skill',
                content: '## Zebra\n- content',
            });
            const skillB = makeSkill({
                name: 'Apple Skill',
                content: '## Apple\n- content',
            });

            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                indicators,
                [skillA, skillB]
            );

            const zebraIndex = result.indexOf('Zebra Skill');
            const appleIndex = result.indexOf('Apple Skill');

            expect(appleIndex).toBeLessThan(zebraIndex);
        });
    });

    describe('SMC 섹션', () => {
        const bars = Array.from({ length: 100 }, (_, i) => makeBar(i));

        it('should show insufficient data message when SMC is empty', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators()
            );
            expect(result).toContain('Insufficient data for SMC analysis');
        });

        it('should format structure breaks with BOS/CHoCH labels', () => {
            const smc: SMCResult = {
                ...EMPTY_SMC_RESULT,
                structureBreaks: [
                    {
                        index: 95,
                        price: 155.0,
                        type: 'bullish',
                        breakType: 'bos',
                    },
                    {
                        index: 97,
                        price: 160.0,
                        type: 'bearish',
                        breakType: 'choch',
                    },
                ],
            };
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ smc })
            );
            expect(result).toContain('[BOS] bullish at 155.00');
            expect(result).toContain('[CHOCH] bearish at 160.00');
            expect(result).toContain('Market Structure');
        });

        it('should show only unmitigated order blocks', () => {
            const smc: SMCResult = {
                ...EMPTY_SMC_RESULT,
                orderBlocks: [
                    {
                        startIndex: 80,
                        high: 152.0,
                        low: 149.0,
                        type: 'bullish',
                        isMitigated: false,
                    },
                    {
                        startIndex: 85,
                        high: 162.0,
                        low: 158.0,
                        type: 'bearish',
                        isMitigated: true,
                    },
                    {
                        startIndex: 90,
                        high: 145.0,
                        low: 142.0,
                        type: 'bullish',
                        isMitigated: false,
                    },
                ],
            };
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ smc })
            );
            expect(result).toContain('bullish OB: 149.00 ~ 152.00');
            expect(result).toContain('bullish OB: 142.00 ~ 145.00');
            expect(result).not.toContain('bearish OB: 158.00 ~ 162.00');
        });

        it('should show "No active order blocks" when all are mitigated', () => {
            const smc: SMCResult = {
                ...EMPTY_SMC_RESULT,
                orderBlocks: [
                    {
                        startIndex: 80,
                        high: 152.0,
                        low: 149.0,
                        type: 'bullish',
                        isMitigated: true,
                    },
                ],
            };
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ smc })
            );
            expect(result).toContain('No active order blocks');
        });

        it('should show only unmitigated fair value gaps', () => {
            const smc: SMCResult = {
                ...EMPTY_SMC_RESULT,
                fairValueGaps: [
                    {
                        index: 88,
                        high: 153.5,
                        low: 151.0,
                        type: 'bullish',
                        isMitigated: false,
                    },
                    {
                        index: 92,
                        high: 160.0,
                        low: 158.5,
                        type: 'bearish',
                        isMitigated: true,
                    },
                ],
            };
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ smc })
            );
            expect(result).toContain('bullish FVG: 151.00 ~ 153.50');
            expect(result).not.toContain('bearish FVG: 158.50 ~ 160.00');
        });

        it('should show equal highs/lows as liquidity pools', () => {
            const smc: SMCResult = {
                ...EMPTY_SMC_RESULT,
                equalHighs: [
                    {
                        price: 165.0,
                        firstIndex: 70,
                        secondIndex: 85,
                    },
                ],
                equalLows: [
                    {
                        price: 140.0,
                        firstIndex: 60,
                        secondIndex: 78,
                    },
                ],
            };
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ smc })
            );
            expect(result).toContain(
                '- Equal Highs at 165.00 (sell-side liquidity) (14 bars ago, span 15 bars)'
            );
            expect(result).toContain(
                '- Equal Lows at 140.00 (buy-side liquidity) (21 bars ago, span 18 bars)'
            );
            expect(result).toContain('Liquidity Pools');
        });

        it('should show premium/discount/equilibrium zones with price position', () => {
            const smc: SMCResult = {
                ...EMPTY_SMC_RESULT,
                premiumZone: { high: 170.0, low: 160.0, type: 'premium' },
                equilibriumZone: {
                    high: 160.0,
                    low: 150.0,
                    type: 'equilibrium',
                },
                discountZone: { high: 150.0, low: 140.0, type: 'discount' },
            };
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ smc })
            );
            expect(result).toContain('Premium Zone: 160.00 ~ 170.00');
            expect(result).toContain('Equilibrium Zone: 150.00 ~ 160.00');
            expect(result).toContain('Discount Zone: 140.00 ~ 150.00');
            expect(result).toMatch(
                /Snapshot Price \(.+\) is in (premium|discount|equilibrium|neutral) zone/
            );
            expect(result).toContain('is in premium zone');
        });

        it('classifies the snapshot price as "discount" when at/below the discount high and no premium match', () => {
            // classifyPriceZone else-arm coverage: with premium null the first
            // branch is skipped, and price (last close ≈ 145) <= discountZone.high
            // (150) selects the 'discount' arm. The premium-zone test above only
            // exercises the 'premium' branch.
            const discountBars = Array.from({ length: 5 }, (_, i) =>
                makeBar(i, 145)
            );
            const smc: SMCResult = {
                ...EMPTY_SMC_RESULT,
                discountZone: { high: 150.0, low: 140.0, type: 'discount' },
            };
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                discountBars,
                makeIndicators({ smc })
            );
            expect(result).toContain('is in discount zone');
            expect(result).not.toContain('is in premium zone');
        });

        it('labels SMC price-zone line as "Snapshot Price" (not "Current price")', () => {
            const smc: SMCResult = {
                ...EMPTY_SMC_RESULT,
                premiumZone: { high: 170.0, low: 160.0, type: 'premium' },
                equilibriumZone: {
                    high: 160.0,
                    low: 150.0,
                    type: 'equilibrium',
                },
                discountZone: { high: 150.0, low: 140.0, type: 'discount' },
            };
            const prompt = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ smc }),
                [],
                '1Day'
            );
            expect(prompt).toMatch(
                /Snapshot Price \([\d.]+\) is in (premium|discount|equilibrium|neutral) zone/
            );
            expect(prompt).not.toMatch(/Current price \(/);
        });

        it('should show swing points with bars ago', () => {
            const smc: SMCResult = {
                ...EMPTY_SMC_RESULT,
                swingHighs: [{ index: 95, price: 168.0, type: 'high' }],
                swingLows: [{ index: 90, price: 142.0, type: 'low' }],
            };
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ smc })
            );
            expect(result).toContain('Swing High: 168.00 (4 bars ago)');
            expect(result).toContain('Swing Low: 142.00 (9 bars ago)');
        });

        it('should cap order blocks to SMC_MAX_ORDER_BLOCKS (5)', () => {
            const smc: SMCResult = {
                ...EMPTY_SMC_RESULT,
                orderBlocks: Array.from({ length: 10 }, (_, i) => ({
                    startIndex: 50 + i * 3,
                    high: 150 + i,
                    low: 148 + i,
                    type: 'bullish' as const,
                    isMitigated: false,
                })),
            };
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ smc })
            );
            const obMatches = result.match(/bullish OB:/g);
            expect(obMatches).toHaveLength(5);
        });

        it('should appear after Indicator Values section', () => {
            const smc: SMCResult = {
                ...EMPTY_SMC_RESULT,
                structureBreaks: [
                    {
                        index: 95,
                        price: 155.0,
                        type: 'bullish',
                        breakType: 'bos',
                    },
                ],
            };
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ smc })
            );
            const indicatorIdx = result.indexOf('## Indicator Values');
            // lastIndexOf: ANALYSIS_GUIDELINES의 'Price Reference Naming' 항목이
            // '## Smart Money Concepts (SMC)' 문자열을 참조하므로, 실제 SMC 섹션
            // 시작점을 찾으려면 마지막 등장 위치를 사용한다.
            const smcIdx = result.lastIndexOf('## Smart Money Concepts (SMC)');
            expect(indicatorIdx).toBeGreaterThan(-1);
            expect(smcIdx).toBeGreaterThan(indicatorIdx);
        });
    });

    describe('스퀴즈 모멘텀 강화', () => {
        const bars = Array.from({ length: 50 }, (_, i) => makeBar(i));

        const makeSqz = (
            overrides?: Partial<SqueezeMomentumResult>
        ): SqueezeMomentumResult => ({
            momentum: null,
            sqzOn: null,
            sqzOff: null,
            noSqz: null,
            increasing: null,
            ...overrides,
        });

        it('should show squeeze duration when sqzOn is consecutive', () => {
            const data: SqueezeMomentumResult[] = [
                makeSqz({ momentum: 1.0, sqzOff: true }),
                makeSqz({ momentum: 1.5, sqzOn: true }),
                makeSqz({ momentum: 2.0, sqzOn: true }),
                makeSqz({ momentum: 2.5, sqzOn: true }),
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ squeezeMomentum: data })
            );
            expect(result).toContain('duration: 3 bars');
        });

        it('should not show duration when last bar is not sqzOn', () => {
            const data: SqueezeMomentumResult[] = [
                makeSqz({ momentum: 1.0, sqzOn: true }),
                makeSqz({ momentum: 1.5, sqzOff: true }),
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ squeezeMomentum: data })
            );
            expect(result).not.toMatch(/duration: \d+ bars/);
        });

        it('should detect bullish zero-cross with bars ago', () => {
            const data: SqueezeMomentumResult[] = [
                makeSqz({ momentum: -2.0, sqzOn: true }),
                makeSqz({ momentum: -1.0, sqzOn: true }),
                makeSqz({ momentum: 0.5, sqzOn: true }),
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ squeezeMomentum: data })
            );
            expect(result).toContain('bullish zero-cross (0 bars ago)');
        });

        it('should detect bearish zero-cross with bars ago', () => {
            const data: SqueezeMomentumResult[] = [
                makeSqz({ momentum: 2.0, sqzOff: true }),
                makeSqz({ momentum: 1.0, sqzOff: true }),
                makeSqz({ momentum: -0.5, sqzOff: true }),
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ squeezeMomentum: data })
            );
            expect(result).toContain('bearish zero-cross (0 bars ago)');
        });

        it('should not show zero-cross when none in lookback', () => {
            const data: SqueezeMomentumResult[] = [
                makeSqz({ momentum: 1.0, sqzOff: true }),
                makeSqz({ momentum: 2.0, sqzOff: true }),
                makeSqz({ momentum: 3.0, sqzOff: true }),
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ squeezeMomentum: data })
            );
            expect(result).not.toContain('zero-cross');
        });

        it('should treat sqzOn null the same as false for duration', () => {
            const data: SqueezeMomentumResult[] = [
                makeSqz({ momentum: 1.0 }),
                makeSqz({ momentum: 1.5, sqzOn: true }),
                makeSqz({ momentum: 2.0, sqzOn: true }),
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ squeezeMomentum: data })
            );
            expect(result).toContain('duration: 2 bars');
        });

        it('should handle empty squeezeMomentum array', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ squeezeMomentum: [] })
            );
            expect(result).toContain('Squeeze Momentum');
            expect(result).toContain('N/A');
        });

        it('should show momentum trend label', () => {
            const data: SqueezeMomentumResult[] = Array.from(
                { length: 10 },
                (_, i) =>
                    makeSqz({
                        momentum: 1 + i * 0.5,
                        sqzOff: true,
                        increasing: true,
                    })
            );
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ squeezeMomentum: data })
            );
            expect(result).toMatch(/Squeeze Momentum.*\[rising]/);
        });

        it('labels the squeeze state "squeeze OFF" when sqzOff is set (not ON)', () => {
            // sqzStateLabel: sqzOn false + sqzOff true → the first else-arm
            // ('squeeze OFF'). Without this case only the 'squeeze ON' arm is
            // exercised by the duration tests above.
            const data: SqueezeMomentumResult[] = [
                makeSqz({ momentum: 1.0, sqzOff: true }),
                makeSqz({ momentum: 1.5, sqzOff: true }),
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ squeezeMomentum: data })
            );
            expect(result).toContain('squeeze OFF');
            expect(result).not.toContain('squeeze ON');
            expect(result).not.toContain('no squeeze');
        });

        it('labels the squeeze state "no squeeze" when neither sqzOn nor sqzOff is set', () => {
            // sqzStateLabel: both flags falsy → the final fallthrough arm
            // ('no squeeze'). momentum must be non-null so the line is not the
            // N/A early-return.
            const data: SqueezeMomentumResult[] = [
                makeSqz({ momentum: 1.0 }),
                makeSqz({ momentum: 1.5 }),
            ];
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ squeezeMomentum: data })
            );
            expect(result).toContain('no squeeze');
            expect(result).not.toContain('squeeze ON');
            expect(result).not.toContain('squeeze OFF');
        });
    });

    describe('Confluence Assessment 가이드라인', () => {
        const bars = Array.from({ length: 5 }, (_, i) => makeBar(i));

        it('should include Confluence Assessment guidelines', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators()
            );
            expect(result).toContain('### Confluence Assessment');
            expect(result).toContain('2+ independent signals');
        });
    });

    describe('타임프레임별 프롬프트 파라미터', () => {
        // 모든 타임프레임의 recentBarsCount 상한을 초과하도록 충분히 많은 봉을 만든다.
        const maxRecentBars = Math.max(
            ...Object.values(PROMPT_CONFIG_BY_TIMEFRAME).map(
                c => c.recentBarsCount
            )
        );
        const bars = Array.from({ length: maxRecentBars + 10 }, (_, i) =>
            makeBar(i)
        );

        it('5Min 타임프레임에서는 해당 타임프레임의 recentBarsCount만큼 표시한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                [],
                '5Min'
            );
            expect(result).toContain(
                `## Recent Bar Data (Last ${PROMPT_CONFIG_BY_TIMEFRAME['5Min'].recentBarsCount} bars)`
            );
        });

        it('1Day 타임프레임에서는 해당 타임프레임의 recentBarsCount만큼 표시한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                [],
                '1Day'
            );
            expect(result).toContain(
                `## Recent Bar Data (Last ${PROMPT_CONFIG_BY_TIMEFRAME['1Day'].recentBarsCount} bars)`
            );
        });

        it('1Hour 타임프레임에서는 해당 타임프레임의 recentBarsCount만큼 표시한다', () => {
            const result = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators(),
                [],
                '1Hour'
            );
            expect(result).toContain(
                `## Recent Bar Data (Last ${PROMPT_CONFIG_BY_TIMEFRAME['1Hour'].recentBarsCount} bars)`
            );
        });

        it('buy/sell volume 누적 구간도 타임프레임별 recentBarsCount를 따른다', () => {
            const buySellVolume = Array.from({ length: bars.length }, () => ({
                buyVolume: 1000,
                sellVolume: 500,
            }));
            const result5Min = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ buySellVolume }),
                [],
                '5Min'
            );
            const result1Day = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                makeIndicators({ buySellVolume }),
                [],
                '1Day'
            );
            expect(result5Min).toContain(
                `Last ${PROMPT_CONFIG_BY_TIMEFRAME['5Min'].recentBarsCount}-bar cumulative`
            );
            expect(result1Day).toContain(
                `Last ${PROMPT_CONFIG_BY_TIMEFRAME['1Day'].recentBarsCount}-bar cumulative`
            );
        });
    });

    describe('buildAnalysisPrompt — fearGreed integration', () => {
        it('omits fear-greed section when not provided', () => {
            const prompt = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                []
            );
            expect(prompt).not.toContain('Fear & Greed Index');
        });

        it('includes fear-greed section when snapshot is provided', () => {
            const fg: FearGreedSnapshot = {
                score: 18,
                label: 'EXTREME_FEAR',
                groups: [
                    { name: 'Flow', score: 30, factors: [] },
                    { name: 'Trend', score: 6, factors: [] },
                ],
                confidence: 'normal',
                sampleSize: 412,
                warning: null,
            };
            const prompt = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [],
                '1Day',
                fg
            );
            expect(prompt).toContain('Fear & Greed Index');
            expect(prompt).toContain('18');
            expect(prompt).toContain('EXTREME_FEAR');
            expect(prompt).toContain('Flow Group: 30');
            expect(prompt).toContain('Trend Group: 6');
        });

        it('appends chronic-weakness warning text when warning is CHRONIC_WEAKNESS', () => {
            const fg: FearGreedSnapshot = {
                score: 75,
                label: 'EXTREME_GREED',
                groups: [
                    { name: 'Flow', score: 80, factors: [] },
                    { name: 'Trend', score: 70, factors: [] },
                ],
                confidence: 'normal',
                sampleSize: 412,
                warning: 'CHRONIC_WEAKNESS',
            };
            const prompt = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [],
                '1Day',
                fg
            );
            expect(prompt).toContain(
                'This stock is in a long-term bearish cycle. The score represents its relative position within its own distribution.'
            );
        });

        it('appends chronic-strength warning text when warning is CHRONIC_STRENGTH', () => {
            const fg: FearGreedSnapshot = {
                score: 35,
                label: 'FEAR',
                groups: [
                    { name: 'Flow', score: 40, factors: [] },
                    { name: 'Trend', score: 30, factors: [] },
                ],
                confidence: 'normal',
                sampleSize: 412,
                warning: 'CHRONIC_STRENGTH',
            };
            const prompt = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                makeIndicators(),
                [],
                '1Day',
                fg
            );
            expect(prompt).toContain(
                'This stock is in a long-term bullish cycle. The score represents its relative position within its own distribution.'
            );
        });
    });

    describe('Market Reference section', () => {
        const MR_PRICE = 100;
        const makeMarketReferenceBars = (): Bar[] =>
            Array.from({ length: 30 }, (_, i) => makeBar(i, MR_PRICE + i));

        it('renders the advisory market-reference section with honest framing', () => {
            const prompt = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                makeMarketReferenceBars(),
                makeIndicators(),
                [],
                '1Day'
            );
            expect(prompt).toContain(
                '## Market Reference (deterministic · advisory)'
            );
            expect(prompt).toContain('NOT validated forward predictors');
            expect(prompt).not.toContain(
                '## Support/Resistance Candidates (precomputed)'
            );
            expect(prompt).not.toContain(
                '## Pivot & Fibonacci Levels (precomputed)'
            );
            expect(prompt).not.toContain(
                '## Trendline Candidates (precomputed)'
            );
        });

        it('no longer claims more-tested levels are higher conviction', () => {
            const prompt = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                makeMarketReferenceBars(),
                makeIndicators(),
                [],
                '1Day'
            );
            expect(prompt).not.toContain('higher-conviction');
        });

        it('labels each horizon with a timeframe-relative calendar span', () => {
            const daily = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                makeMarketReferenceBars(),
                makeIndicators(),
                [],
                '1Day'
            );
            const intraday = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                makeMarketReferenceBars(),
                makeIndicators(),
                [],
                '5Min'
            );
            // Same "Long-term" horizon reads as months on a daily chart but only
            // a few sessions on a 5-minute chart, so the model calibrates vocabulary.
            expect(daily).toContain('Long-term — ~9-12 months');
            expect(intraday).toContain('Long-term — ~2-3 trading days');
            expect(daily).not.toContain('Long-term — ~2-3 trading days');
        });

        // Guards the hand-authored HORIZON_SPAN_BY_TIMEFRAME strings for every
        // timeframe×horizon, so a typo in a span label fails a test rather than
        // shipping silently.
        it.each([
            ['1Day', ['~1 month', '~1 quarter', '~9-12 months']],
            ['4Hour', ['~2-3 weeks', '~2 months', '~5 months']],
            ['1Hour', ['~4 trading days', '~2 weeks', '~6 weeks']],
            ['30Min', ['~2 trading days', '~1 week', '~3 weeks']],
            ['15Min', ['~1 trading day', '~3 trading days', '~1-2 weeks']],
            [
                '5Min',
                ['~2 trading hours', '~1 trading day', '~2-3 trading days'],
            ],
        ] as const)('renders all horizon spans for %s', (tf, spans) => {
            const prompt = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                makeMarketReferenceBars(),
                makeIndicators(),
                [],
                tf
            );
            for (const span of spans) expect(prompt).toContain(span);
        });
    });

    describe('프로 지표 섹션 (regime lens + confluence panel)', () => {
        // Longest pro-indicator warm-up (Hurst window 100, Connors RSI
        // percent-rank 100) needs ~260 bars to guarantee non-null tails.
        const PRO_ENOUGH_BARS = 260;
        const REGIME_HEADER = REGIME_CONTEXT_SECTION_HEADER;
        const INDICATOR_HEADER = INDICATOR_VALUES_SECTION_HEADER;
        const PRO_HEADER = PRO_INDICATOR_SECTION_HEADER;

        // Deterministic, non-degenerate uptrend + bounded oscillation so every
        // rolling window has real variance (no flat sub-windows nulling out
        // Hurst / regression r²). Mirrors index.test.ts buildBars.
        const buildRealisticBars = (count: number): Bar[] =>
            Array.from({ length: count }, (_, i) => {
                const close = 100 + i * 0.5 + Math.sin(i / 5) * 4;
                return {
                    time: TEST_BAR_BASE_TIME + i * TEST_BAR_INTERVAL,
                    open: close - 1,
                    high: close + 2 + (i % 3),
                    low: close - 2 - (i % 4),
                    close,
                    volume: TEST_BAR_BASE_VOLUME + (i % 7) * 50,
                };
            });

        const buildRealisticPrompt = (): string => {
            const bars = buildRealisticBars(PRO_ENOUGH_BARS);
            const indicators = calculateIndicators(bars);
            return buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                bars,
                indicators,
                []
            );
        };

        it('두 신규 섹션 헤더가 모두 존재한다', () => {
            const prompt = buildRealisticPrompt();
            expect(prompt).toContain(REGIME_HEADER);
            expect(prompt).toContain(PRO_HEADER);
        });

        it('regime lens는 지표 값 앞에, confluence 패널은 뒤에 배치된다', () => {
            const prompt = buildRealisticPrompt();
            const regimeIdx = prompt.indexOf(REGIME_HEADER);
            const indicatorIdx = prompt.indexOf(INDICATOR_HEADER);
            const proIdx = prompt.indexOf(PRO_HEADER);
            expect(regimeIdx).toBeGreaterThanOrEqual(0);
            expect(indicatorIdx).toBeGreaterThanOrEqual(0);
            expect(proIdx).toBeGreaterThanOrEqual(0);
            expect(regimeIdx).toBeLessThan(indicatorIdx);
            expect(indicatorIdx).toBeLessThan(proIdx);
        });

        it('Bollinger %B 라인이 measured-edge signal 주석을 포함한다', () => {
            const prompt = buildRealisticPrompt();
            const proSection = prompt.slice(prompt.indexOf(PRO_HEADER));
            const pctbLine = proSection
                .split('\n')
                .find(l => l.startsWith('- Bollinger %B:'));
            expect(pctbLine).toBeDefined();
            expect(pctbLine).toContain(PRO_RELIABILITY_NOTE.bollingerPctB);
        });

        it('advisory 지표 라인이 advisory 주석을 포함한다', () => {
            const prompt = buildRealisticPrompt();
            const macdvLine = prompt
                .split('\n')
                .find(l => l.startsWith('- MACD-V:'));
            expect(macdvLine).toBeDefined();
            expect(macdvLine).toContain(PRO_RELIABILITY_NOTE.advisory);
        });

        it('Elder Impulse 라인이 색상과 permission gate 주석을 반영한다', () => {
            const prompt = buildRealisticPrompt();
            const impulseLine = prompt
                .split('\n')
                .find(l => l.startsWith('- Elder Impulse:'));
            expect(impulseLine).toBeDefined();
            expect(impulseLine).toContain(PRO_RELIABILITY_NOTE.impulse);
            // The fixture is a sustained uptrend → latest color is decisive.
            expect(impulseLine).toMatch(/green|red|blue/);
        });

        it('regime lens가 weighting guidance를 포함한다', () => {
            const prompt = buildRealisticPrompt();
            const regimeSection = prompt.slice(
                prompt.indexOf(REGIME_HEADER),
                prompt.indexOf(INDICATOR_HEADER)
            );
            expect(regimeSection).toContain(PRO_RELIABILITY_NOTE.regime);
            expect(regimeSection).toContain(PRO_RELIABILITY_NOTE.volatility);
        });

        it('Hurst와 Variance Ratio가 결정적으로 충돌하면 random verdict를 렌더한다', () => {
            // Hurst 0.65 → trending (0.65 - 0.5 = 0.15 ≥ prompt margin 0.05),
            // Variance Ratio 0.75 → mean-reverting (1 - 0.75 = 0.25 ≥ margin 0.1).
            // Decisive disagreement collapses to the 'random' (low-conviction) verdict.
            const indicators = makeIndicators({
                hurst: [0.65],
                varianceRatio: [0.75],
            });
            const prompt = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            const regimeSection = prompt.slice(
                prompt.indexOf(REGIME_HEADER),
                prompt.indexOf(INDICATOR_HEADER)
            );
            const regimeLine = regimeSection
                .split('\n')
                .find(l => l.startsWith('- Regime:'));
            expect(regimeLine).toBeDefined();
            expect(regimeLine).toContain(
                'near-random (low directional conviction; demand stronger confluence)'
            );
        });

        it('Hurst와 Variance Ratio가 모두 mean-reverting이면 mean-reverting verdict를 렌더한다', () => {
            // Hurst 0.35 → mean-reverting (0.5 - 0.35 = 0.15 ≥ prompt margin 0.05),
            // Variance Ratio 0.75 → mean-reverting (1 - 0.75 = 0.25 ≥ margin 0.1).
            // Both voters agree → 'mean-reverting' verdict.
            const indicators = makeIndicators({
                hurst: [0.35],
                varianceRatio: [0.75],
            });
            const prompt = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            const regimeSection = prompt.slice(
                prompt.indexOf(REGIME_HEADER),
                prompt.indexOf(INDICATOR_HEADER)
            );
            const regimeLine = regimeSection
                .split('\n')
                .find(l => l.startsWith('- Regime:'));
            expect(regimeLine).toBeDefined();
            expect(regimeLine).toContain(
                'mean-reverting (favour fade/reversion; be wary of breakouts)'
            );
        });

        it('Hurst/VR는 null이고 slope만 있으면 near-random이 아닌 insufficient data를 렌더한다', () => {
            // Only Hurst + VR vote on the verdict; slope merely annotates it. With
            // both voters null, slope alone must not force a near-random verdict.
            const indicators = makeIndicators({
                hurst: [null],
                varianceRatio: [null],
                regression: [{ slope: 1.5, r2: 0.8 }],
            });
            const prompt = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            const regimeSection = prompt.slice(
                prompt.indexOf(REGIME_HEADER),
                prompt.indexOf(INDICATOR_HEADER)
            );
            const regimeLine = regimeSection
                .split('\n')
                .find(l => l.startsWith('- Regime:'));
            expect(regimeLine).toBeDefined();
            expect(regimeLine).toContain('insufficient data');
            expect(regimeLine).not.toContain('near-random');
        });

        it('한쪽 voter만 유효하면(Hurst trending, VR null) 그 voter의 verdict를 따른다', () => {
            // combineRegimeVerdict ignores null votes; with only Hurst voting
            // 'trending' (0.65 − 0.5 = 0.15 ≥ 0.05) and VR null, the agreed side
            // is 'trending' — a single decisive voter is not collapsed to random.
            const indicators = makeIndicators({
                hurst: [0.65],
                varianceRatio: [null],
            });
            const prompt = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            const regimeSection = prompt.slice(
                prompt.indexOf(REGIME_HEADER),
                prompt.indexOf(INDICATOR_HEADER)
            );
            const regimeLine = regimeSection
                .split('\n')
                .find(l => l.startsWith('- Regime:'));
            expect(regimeLine).toBeDefined();
            expect(regimeLine).toContain(
                'trending (favour trend-following; do not fade)'
            );
        });

        it('Elder Impulse가 null을 건너뛰고 직전 유색 봉과 비교해 flip note를 렌더한다', () => {
            // ['green', null, 'red'] → latest 'red' flipped from the previous
            // *coloured* bar 'green' (the interspersed null is skipped), matching
            // the gating layer's "previous coloured bar" semantics.
            const indicators = makeIndicators({
                elderImpulse: ['green', null, 'red'],
            });
            const prompt = buildAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                [],
                indicators,
                []
            );
            const impulseLine = prompt
                .split('\n')
                .find(l => l.startsWith('- Elder Impulse:'));
            expect(impulseLine).toBeDefined();
            expect(impulseLine).toContain('(flipped from green)');
        });

        it('빈 bars에서도 throw 없이 insufficient data / N/A를 렌더한다', () => {
            let prompt = '';
            expect(() => {
                prompt = buildAnalysisPrompt(
                    TEST_SYMBOL,
                    TEST_COMPANY_NAME,
                    [],
                    makeIndicators(),
                    []
                );
            }).not.toThrow();
            expect(prompt).toContain(REGIME_HEADER);
            expect(prompt).toContain(PRO_HEADER);
            const regimeSection = prompt.slice(
                prompt.indexOf(REGIME_HEADER),
                prompt.indexOf(INDICATOR_HEADER)
            );
            expect(regimeSection).toContain('insufficient data');
            // Pro-indicator lines fall back to N/A while preserving the notes.
            const proSection = prompt.slice(prompt.indexOf(PRO_HEADER));
            expect(proSection).toContain('Bollinger %B: N/A');
            expect(proSection).toContain(PRO_RELIABILITY_NOTE.bollingerPctB);
        });

        it('짧은 bars(warm-up 미만)에서도 throw하지 않는다', () => {
            const shortBars = buildRealisticBars(10);
            const indicators = calculateIndicators(shortBars);
            expect(() => {
                buildAnalysisPrompt(
                    TEST_SYMBOL,
                    TEST_COMPANY_NAME,
                    shortBars,
                    indicators,
                    []
                );
            }).not.toThrow();
        });
    });
});
