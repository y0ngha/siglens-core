import { describe, it, expect } from 'vitest';
import type {
    CandlePatternEntry,
    MultiCandlePatternEntry,
    SingleCandlePatternEntry,
} from '@/domain/types';
import {
    CANDLE_PATTERN_DETECTION_BARS,
    detectCandlePatternEntries,
    getDetectionBars,
    MULTI_CANDLE_PATTERN_BUFFER,
    selectLastCandlePatternEntries,
} from '@/domain/analysis/candle-detection';
import {
    makeBar,
    makeEngulfingPair,
    makeHammerBar,
} from '@/__tests__/fixtures/candle';
import type { Bar } from '@/domain/types';

describe('candle-detection', () => {
    describe('detectCandlePatternEntries', () => {
        describe('bars가 비어있을 때', () => {
            it('빈 배열을 반환한다', () => {
                const result: CandlePatternEntry[] = detectCandlePatternEntries(
                    []
                );
                expect(result).toEqual([]);
            });
        });

        describe('bars가 CANDLE_PATTERN_DETECTION_BARS보다 적을 때', () => {
            it('가용한 bars에서 패턴을 감지한다', () => {
                const bars: Bar[] = [makeHammerBar(0)];
                const result: CandlePatternEntry[] =
                    detectCandlePatternEntries(bars);
                expect(result.length).toBeGreaterThanOrEqual(1);
                expect(result[0].patternType).toBe('single');
                expect(result[0].singlePattern).toBe('hammer');
            });
        });

        describe('단봉 패턴만 존재할 때', () => {
            it('단봉 패턴 엔트리를 반환한다', () => {
                const normalBars: Bar[] = Array.from(
                    { length: CANDLE_PATTERN_DETECTION_BARS },
                    (_, i) => makeBar(i)
                );
                // Replace last bar with a hammer
                const bars: Bar[] = [
                    ...normalBars.slice(0, -1),
                    makeHammerBar(CANDLE_PATTERN_DETECTION_BARS - 1),
                ];
                const result: CandlePatternEntry[] =
                    detectCandlePatternEntries(bars);

                const hammerEntry = result.find(
                    e => e.singlePattern === 'hammer'
                );
                expect(hammerEntry).toBeDefined();
                expect(hammerEntry?.patternType).toBe('single');
                expect(hammerEntry?.multiPattern).toBeNull();
            });
        });

        describe('제외 대상 단봉 패턴일 때', () => {
            it('기본 형태 패턴은 결과에 포함되지 않는다', () => {
                // Normal bars produce 'bullish' or 'bearish' which are excluded
                const bars: Bar[] = Array.from(
                    { length: CANDLE_PATTERN_DETECTION_BARS },
                    (_, i) => makeBar(i)
                );
                const result: CandlePatternEntry[] =
                    detectCandlePatternEntries(bars);
                const excludedEntries = result.filter(
                    e =>
                        e.singlePattern === 'bullish' ||
                        e.singlePattern === 'bearish' ||
                        e.singlePattern === 'flat' ||
                        e.singlePattern === 'spinning_top'
                );
                expect(excludedEntries).toEqual([]);
            });
        });

        describe('barIndex 정렬', () => {
            it('barIndex 오름차순으로 정렬된다', () => {
                const bars: Bar[] = Array.from(
                    {
                        length:
                            CANDLE_PATTERN_DETECTION_BARS +
                            MULTI_CANDLE_PATTERN_BUFFER,
                    },
                    (_, i) => makeHammerBar(i)
                );
                const result: CandlePatternEntry[] =
                    detectCandlePatternEntries(bars);
                const indices: number[] = result.map(e => e.barIndex);
                const sortedIndices: number[] = [...indices].sort(
                    (a, b) => a - b
                );
                expect(indices).toEqual(sortedIndices);
            });
        });

        describe('MULTI_CANDLE_PATTERN_BUFFER 상수', () => {
            it('5봉 패턴 감지를 위해 4의 값을 갖는다', () => {
                expect(MULTI_CANDLE_PATTERN_BUFFER).toBe(4);
            });
        });

        describe('창 시작 부근의 5봉 패턴', () => {
            it('버퍼 봉 4개와 창 첫 봉으로 이루어진 rising_three_methods를 barIndex 0에서 감지하고 그 봉의 단봉 라벨(bullish_belt_hold)은 억제한다', () => {
                // extended index 0–3 = buffer, 4 = detection window start
                const pattern: Bar[] = [
                    makeBar(0, { open: 100, high: 111, low: 99, close: 110 }),
                    makeBar(1, { open: 109, high: 110, low: 106, close: 107 }),
                    makeBar(2, { open: 107, high: 108, low: 104, close: 105 }),
                    makeBar(3, { open: 105, high: 106, low: 102, close: 103 }),
                    makeBar(4, {
                        open: 102.5,
                        high: 116,
                        low: 102,
                        close: 115,
                    }),
                ];
                const rest: Bar[] = Array.from(
                    { length: CANDLE_PATTERN_DETECTION_BARS - 1 },
                    (_, i) => makeHammerBar(5 + i)
                );
                const bars = [...pattern, ...rest];
                expect(bars).toHaveLength(
                    CANDLE_PATTERN_DETECTION_BARS + MULTI_CANDLE_PATTERN_BUFFER
                );

                const result = detectCandlePatternEntries(bars);

                expect(result.find(e => e.barIndex === 0)).toEqual({
                    barIndex: 0,
                    patternType: 'multi',
                    singlePattern: null,
                    multiPattern: 'rising_three_methods',
                });
                expect(
                    result.filter(
                        e => e.barIndex === 0 && e.patternType === 'single'
                    )
                ).toEqual([]);
            });
        });

        describe('짧은 몸통 뒤의 stomach 모양', () => {
            it('직전 봉이 장대봉이 아니면 stomach로 묶지 않고 두 봉의 단봉 라벨을 그대로 둔다', () => {
                // spinning top 두 개(제외 대상) 뒤에 bearish dragonfly doji와
                // midpoint 위에서 시작하는 bullish belt hold. 느슨한 stomach
                // 규칙은 이 쌍을 above_the_stomach로 묶어 두 단봉 라벨을 삼켰다.
                const bars: Bar[] = [
                    makeBar(0, { open: 90, high: 92, low: 88, close: 90.5 }),
                    makeBar(1, { open: 94, high: 96, low: 92, close: 94.5 }),
                    makeBar(2, { open: 100.5, high: 101, low: 80, close: 100 }),
                    makeBar(3, {
                        open: 100.5,
                        high: 106,
                        low: 100.3,
                        close: 105.5,
                    }),
                ];

                expect(detectCandlePatternEntries(bars)).toEqual([
                    {
                        barIndex: 2,
                        patternType: 'single',
                        singlePattern: 'dragonfly_doji',
                        multiPattern: null,
                    },
                    {
                        barIndex: 3,
                        patternType: 'single',
                        singlePattern: 'bullish_belt_hold',
                        multiPattern: null,
                    },
                ]);
            });
        });

        describe('4봉 패턴의 관여 봉', () => {
            it('three-line strike의 b1(단봉으로는 bullish_belt_hold)까지 4봉 모두를 단봉에서 제외한다', () => {
                const normal: Bar[] = Array.from(
                    { length: CANDLE_PATTERN_DETECTION_BARS - 4 },
                    (_, i) => makeBar(i)
                );
                const start = normal.length;
                // b1: 아래꼬리 없는 긴 양봉 → 단봉 bullish_belt_hold
                // b2: b1 몸통 밖에서 시작 → three_white_soldiers 불성립
                const strike: Bar[] = [
                    makeBar(start, {
                        open: 100,
                        high: 106,
                        low: 100,
                        close: 105,
                    }),
                    makeBar(start + 1, {
                        open: 105.5,
                        high: 111,
                        low: 104,
                        close: 110,
                    }),
                    makeBar(start + 2, {
                        open: 109,
                        high: 116,
                        low: 108,
                        close: 115,
                    }),
                    makeBar(start + 3, {
                        open: 116,
                        high: 117,
                        low: 97,
                        close: 98,
                    }),
                ];
                const result = detectCandlePatternEntries([
                    ...normal,
                    ...strike,
                ]);
                const lastIndex = CANDLE_PATTERN_DETECTION_BARS - 1;

                expect(result.find(e => e.barIndex === lastIndex)).toEqual({
                    barIndex: lastIndex,
                    patternType: 'multi',
                    singlePattern: null,
                    multiPattern: 'bullish_three_line_strike',
                });
                expect(
                    result.filter(
                        e => e.patternType === 'single' && e.barIndex >= start
                    )
                ).toEqual([]);
            });
        });

        describe('다봉 패턴 관련 모든 봉에서 단봉 패턴 제외', () => {
            it('다봉 패턴에 포함된 봉은 단봉 결과에서 제외된다', () => {
                const totalLength =
                    CANDLE_PATTERN_DETECTION_BARS + MULTI_CANDLE_PATTERN_BUFFER;
                const normalBars: Bar[] = Array.from(
                    { length: totalLength - 2 },
                    (_, i) => makeBar(i)
                );
                // Place a bullish engulfing pair at the end to guarantee multi-candle detection
                const [bearish, bullish] = makeEngulfingPair(totalLength - 2);
                const bars: Bar[] = [...normalBars, bearish, bullish];

                const result: CandlePatternEntry[] =
                    detectCandlePatternEntries(bars);
                const multiEntries = result.filter(
                    e => e.patternType === 'multi'
                );

                // Unconditional assertion: engulfing pair guarantees at least one multi entry
                expect(multiEntries.length).toBeGreaterThanOrEqual(1);

                const singleBarIndices = new Set(
                    result
                        .filter(e => e.patternType === 'single')
                        .map(e => e.barIndex)
                );

                // No single entry should share a barIndex with any multi entry
                multiEntries.forEach(multi => {
                    expect(singleBarIndices.has(multi.barIndex)).toBe(false);
                });
            });
        });
    });

    describe('getDetectionBars', () => {
        describe('bars가 비어있을 때', () => {
            it('빈 배열을 반환한다', () => {
                expect(getDetectionBars([])).toEqual([]);
            });
        });

        describe('bars가 CANDLE_PATTERN_DETECTION_BARS보다 적을 때', () => {
            it('전체 bars를 반환한다', () => {
                const TEST_BAR_COUNT = 5;
                const bars = Array.from({ length: TEST_BAR_COUNT }, (_, i) =>
                    makeBar(i)
                );
                const result = getDetectionBars(bars);
                expect(result).toHaveLength(TEST_BAR_COUNT);
                expect(result).toEqual(bars);
            });
        });

        describe('bars가 CANDLE_PATTERN_DETECTION_BARS보다 많을 때', () => {
            it('마지막 CANDLE_PATTERN_DETECTION_BARS개의 bars를 반환한다', () => {
                const EXTRA_BARS = 10;
                const totalCount = CANDLE_PATTERN_DETECTION_BARS + EXTRA_BARS;
                const bars = Array.from({ length: totalCount }, (_, i) =>
                    makeBar(i)
                );
                const result = getDetectionBars(bars);
                expect(result).toHaveLength(CANDLE_PATTERN_DETECTION_BARS);
                expect(result[0].time).toBe(bars[EXTRA_BARS].time);
            });
        });
    });

    describe('selectLastCandlePatternEntries', () => {
        const makeSingleEntry = (
            barIndex: number,
            pattern: 'hammer' | 'doji' | 'shooting_star' = 'hammer'
        ): SingleCandlePatternEntry => ({
            barIndex,
            patternType: 'single',
            singlePattern: pattern,
            multiPattern: null,
        });

        const makeMultiEntry = (
            barIndex: number,
            pattern: 'bullish_engulfing' | 'morning_star' = 'bullish_engulfing'
        ): MultiCandlePatternEntry => ({
            barIndex,
            patternType: 'multi',
            singlePattern: null,
            multiPattern: pattern,
        });

        describe('entries가 비어있을 때', () => {
            it('빈 배열을 반환한다', () => {
                const result = selectLastCandlePatternEntries([]);
                expect(result).toEqual([]);
            });
        });

        describe('단봉 패턴만 존재할 때', () => {
            it('마지막 단봉 패턴만 반환한다', () => {
                const entries: CandlePatternEntry[] = [
                    makeSingleEntry(0, 'hammer'),
                    makeSingleEntry(3, 'doji'),
                    makeSingleEntry(7, 'shooting_star'),
                ];
                const result = selectLastCandlePatternEntries(entries);
                expect(result).toHaveLength(1);
                expect(result[0].barIndex).toBe(7);
                expect(result[0].singlePattern).toBe('shooting_star');
            });

            it('단봉 패턴이 하나일 때 해당 패턴을 반환한다', () => {
                const entries: CandlePatternEntry[] = [
                    makeSingleEntry(5, 'hammer'),
                ];
                const result = selectLastCandlePatternEntries(entries);
                expect(result).toHaveLength(1);
                expect(result[0]).toEqual(makeSingleEntry(5, 'hammer'));
            });
        });

        describe('다봉 패턴이 존재할 때', () => {
            it('마지막 다봉 패턴과 마지막 단봉 패턴을 함께 반환한다', () => {
                const entries: CandlePatternEntry[] = [
                    makeSingleEntry(2, 'hammer'),
                    makeMultiEntry(4, 'bullish_engulfing'),
                    makeMultiEntry(8, 'morning_star'),
                ];
                const result = selectLastCandlePatternEntries(entries);
                expect(result).toHaveLength(2);
                expect(result[0].patternType).toBe('single');
                expect(result[0].barIndex).toBe(2);
                expect(result[1].patternType).toBe('multi');
                expect(result[1].barIndex).toBe(8);
            });

            it('단봉 패턴이 없으면 마지막 다봉 패턴만 반환한다', () => {
                const entries: CandlePatternEntry[] = [
                    makeMultiEntry(4, 'bullish_engulfing'),
                    makeMultiEntry(8, 'morning_star'),
                ];
                const result = selectLastCandlePatternEntries(entries);
                expect(result).toHaveLength(1);
                expect(result[0].patternType).toBe('multi');
                expect(result[0].barIndex).toBe(8);
            });
        });

        describe('단봉과 다봉 패턴이 혼합되어 있을 때', () => {
            it('마지막 다봉 패턴과 마지막 단봉 패턴을 함께 반환한다', () => {
                const entries: CandlePatternEntry[] = [
                    makeSingleEntry(0, 'hammer'),
                    makeSingleEntry(5, 'doji'),
                    makeSingleEntry(8, 'hammer'),
                    makeSingleEntry(9, 'doji'),
                    makeMultiEntry(10, 'bullish_engulfing'),
                ];
                const result = selectLastCandlePatternEntries(entries);
                expect(result).toHaveLength(2);
                expect(result[0].patternType).toBe('single');
                expect(result[0].barIndex).toBe(9);
                expect(result[1].patternType).toBe('multi');
                expect(result[1].barIndex).toBe(10);
            });
        });
    });
});
