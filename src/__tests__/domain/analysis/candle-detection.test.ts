import { describe, it, expect } from 'vitest';
import type {
    CandlePatternEntry,
    MultiCandlePatternEntry,
    SingleCandlePatternEntry,
} from '@/domain/types';
import {
    CANDLE_PATTERN_DETECTION_BARS,
    candleEntryPriorMove,
    detectCandlePatternEntries,
    getDetectionBars,
    MULTI_CANDLE_PATTERN_BUFFER,
    selectLastCandlePatternEntries,
} from '@/domain/analysis/candle-detection';
import {
    makeBar,
    makeEngulfingPair,
    makeHammerBar,
    makeTrendLead,
    TREND_LEAD_BARS,
} from '@/__tests__/fixtures/candle';
import {
    CANDLE_PRIOR_TREND_BARS,
    CANDLE_PRIOR_TREND_MIN_ATR,
    candlePriorMove,
} from '@/domain/analysis/candle-context';
import { calculateATR } from '@/domain/indicators/atr';
import { chartFixture } from '@/__tests__/domain/patterns/fixtures/chartFixture';
import hangingManChart from '@/__tests__/fixtures/charts/candle-hanging-man-after-advance.json';
import type { Bar } from '@/domain/types';

describe('candle-detection', () => {
    describe('detectCandlePatternEntries', () => {
        // 리드가 망치 봉 시가보다 낮게 끝나야 망치 봉이 직전 리드 봉을 감싸는 장악형이 되지 않는다.
        const HAMMER_END_CLOSE = 90;

        describe('bars가 비어있을 때', () => {
            it('빈 배열을 반환한다', () => {
                const result: CandlePatternEntry[] = detectCandlePatternEntries(
                    []
                );
                expect(result).toEqual([]);
            });
        });

        describe('bars가 CANDLE_PATTERN_DETECTION_BARS보다 적을 때', () => {
            it('직전 움직임을 잴 봉이 없으면 맥락이 필요한 단봉은 감지하지 않는다', () => {
                const bars: Bar[] = [makeHammerBar(0)];
                expect(detectCandlePatternEntries(bars)).toEqual([]);
            });

            it('창보다 긴 bars라도 하락 리드 뒤라면 창 안의 hammer를 감지한다', () => {
                const bars: Bar[] = [
                    ...makeTrendLead('decline', HAMMER_END_CLOSE),
                    makeHammerBar(0),
                ];
                const result = detectCandlePatternEntries(bars);
                expect(result).toEqual([
                    {
                        barIndex: CANDLE_PATTERN_DETECTION_BARS - 1,
                        patternType: 'single',
                        singlePattern: 'hammer',
                        multiPattern: null,
                    },
                ]);
            });
        });

        describe('단봉 패턴만 존재할 때', () => {
            const lead = makeTrendLead('decline', HAMMER_END_CLOSE);
            const lastIndex = CANDLE_PATTERN_DETECTION_BARS - 1;

            it('하락 뒤의 긴 아래꼬리 봉은 몸통 색과 무관하게 hammer 엔트리다', () => {
                const bars: Bar[] = [...lead, makeHammerBar(0)];
                const hammerEntry = detectCandlePatternEntries(bars).find(
                    e => e.singlePattern === 'hammer'
                );
                expect(hammerEntry).toEqual({
                    barIndex: lastIndex,
                    patternType: 'single',
                    singlePattern: 'hammer',
                    multiPattern: null,
                });
            });

            it('상승 뒤의 같은 봉은 hanging_man 엔트리다', () => {
                const bars: Bar[] = [
                    ...makeTrendLead('advance', HAMMER_END_CLOSE),
                    makeHammerBar(0),
                ];
                expect(
                    detectCandlePatternEntries(bars).map(e => e.singlePattern)
                ).toEqual(['hanging_man']);
            });

            it('직전 움직임이 없으면 같은 봉은 엔트리가 아니다', () => {
                const bars: Bar[] = [
                    ...makeTrendLead('none', HAMMER_END_CLOSE),
                    makeHammerBar(0),
                ];
                expect(detectCandlePatternEntries(bars)).toEqual([]);
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
            it('단봉과 다봉이 섞여도 barIndex 오름차순으로 정렬된다', () => {
                const [bearish, bullish] = makeEngulfingPair(0);
                const bars: Bar[] = [
                    ...makeTrendLead('decline', bearish.open),
                    bearish,
                    bullish,
                    makeBar(0, { open: 118, high: 119, low: 100, close: 119 }),
                    makeHammerBar(0),
                ];
                const result: CandlePatternEntry[] =
                    detectCandlePatternEntries(bars);
                const indices: number[] = result.map(e => e.barIndex);
                expect(indices.length).toBeGreaterThanOrEqual(2);
                expect(indices).toEqual([...indices].sort((a, b) => a - b));
            });
        });

        describe('MULTI_CANDLE_PATTERN_BUFFER 상수', () => {
            it('5봉 패턴 감지를 위해 4의 값을 갖는다', () => {
                expect(MULTI_CANDLE_PATTERN_BUFFER).toBe(4);
            });
        });

        describe('창 시작 부근의 5봉 패턴', () => {
            const pattern: Bar[] = [
                makeBar(0, { open: 100, high: 111, low: 99, close: 110 }),
                makeBar(1, { open: 109, high: 110, low: 106, close: 107 }),
                makeBar(2, { open: 107, high: 108, low: 104, close: 105 }),
                makeBar(3, { open: 105, high: 106, low: 102, close: 103 }),
                makeBar(4, { open: 102.5, high: 116, low: 102, close: 115 }),
            ];
            const rest: Bar[] = Array.from(
                { length: CANDLE_PATTERN_DETECTION_BARS - 1 },
                (_, i) => makeBar(5 + i)
            );

            it('버퍼 봉 4개와 창 첫 봉으로 이루어진 rising_three_methods를 barIndex 0에서 감지하고 그 봉의 단봉 라벨(bearish_marubozu가 아닌 bullish_belt_hold 모양)은 억제한다', () => {
                const bars = [
                    ...makeTrendLead('advance', pattern[0].open),
                    ...pattern,
                    ...rest,
                ];

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

            it('패턴 첫 봉 앞에 움직임을 잴 봉이 15개 미만이면 감지하지 않는다', () => {
                const bars = [
                    ...makeTrendLead(
                        'advance',
                        pattern[0].open,
                        CANDLE_PRIOR_TREND_BARS
                    ),
                    ...pattern,
                    ...rest,
                ];

                expect(
                    detectCandlePatternEntries(bars).filter(
                        e => e.patternType === 'multi'
                    )
                ).toEqual([]);
            });
        });

        describe('짧은 몸통 뒤의 stomach 모양', () => {
            it('직전 봉이 장대봉이 아니면 stomach로 묶지 않고 두 봉의 단봉 라벨을 그대로 둔다', () => {
                // spinning top 두 개(제외 대상) 뒤에 bearish dragonfly doji와
                // midpoint 위에서 시작하는 bullish belt hold. 느슨한 stomach
                // 규칙은 이 쌍을 above_the_stomach로 묶어 두 단봉 라벨을 삼켰다.
                const tail: Bar[] = [
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
                // 도지의 큰 range가 ATR을 키우므로 가파른 리드(step 4)로 하락을 확실히 둔다
                const lead = makeTrendLead(
                    'decline',
                    tail[0].open,
                    TREND_LEAD_BARS,
                    4
                );
                const bars = [...lead, ...tail];
                const firstTail = bars.length - tail.length;
                const windowStart = bars.length - CANDLE_PATTERN_DETECTION_BARS;

                expect(detectCandlePatternEntries(bars)).toEqual([
                    {
                        barIndex: firstTail + 2 - windowStart,
                        patternType: 'single',
                        singlePattern: 'dragonfly_doji',
                        multiPattern: null,
                    },
                    {
                        barIndex: firstTail + 3 - windowStart,
                        patternType: 'single',
                        singlePattern: 'bullish_belt_hold',
                        multiPattern: null,
                    },
                ]);
            });
        });

        describe('4봉 패턴의 관여 봉', () => {
            const start = 0;
            // b4: 몸통이 range의 90%인 음봉 마루보주라 혼자서는 단봉 엔트리가 된다
            const strike: Bar[] = [
                makeBar(start, { open: 100, high: 106, low: 99, close: 105 }),
                makeBar(start + 1, {
                    open: 104,
                    high: 111,
                    low: 103,
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

            it('three-line strike의 4봉 모두를 단봉에서 제외한다', () => {
                const bars = [
                    ...makeTrendLead('advance', strike[0].open),
                    ...strike,
                ];
                const result = detectCandlePatternEntries(bars);
                const lastIndex = CANDLE_PATTERN_DETECTION_BARS - 1;

                expect(result).toEqual([
                    {
                        barIndex: lastIndex,
                        patternType: 'multi',
                        singlePattern: null,
                        multiPattern: 'bullish_three_line_strike',
                    },
                ]);
            });
        });

        describe('다봉 패턴 관련 모든 봉에서 단봉 패턴 제외', () => {
            it('다봉 패턴에 포함된 봉은 단봉 결과에서 제외된다', () => {
                // Place a bullish engulfing pair at the end to guarantee multi-candle detection
                const [bearish, bullish] = makeEngulfingPair(0);
                const bars: Bar[] = [
                    ...makeTrendLead('decline', bearish.open),
                    bearish,
                    bullish,
                ];

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

        describe('맥락 규칙에 실패한 다봉 패턴', () => {
            // 장악형 기하(음봉을 덮는 양봉)이면서 둘째 봉이 모양만으로 마루보주인 쌍
            const prev = makeBar(0, {
                open: 110,
                high: 115,
                low: 105,
                close: 106,
            });
            const marubozu = makeBar(1, {
                open: 104,
                high: 120,
                low: 104,
                close: 120,
            });

            it('하락 뒤에는 bullish_engulfing이 되고 마루보주 단봉은 억제된다', () => {
                const result = detectCandlePatternEntries([
                    ...makeTrendLead('decline', prev.open),
                    prev,
                    marubozu,
                ]);
                expect(result).toEqual([
                    {
                        barIndex: CANDLE_PATTERN_DETECTION_BARS - 1,
                        patternType: 'multi',
                        singlePattern: null,
                        multiPattern: 'bullish_engulfing',
                    },
                ]);
            });

            it('움직임이 없으면 다봉은 감지되지 않고 단봉 마루보주는 억제되지 않는다', () => {
                const result = detectCandlePatternEntries([
                    ...makeTrendLead('none', prev.open),
                    prev,
                    marubozu,
                ]);
                expect(result).toEqual([
                    {
                        barIndex: CANDLE_PATTERN_DETECTION_BARS - 1,
                        patternType: 'single',
                        singlePattern: 'bullish_marubozu',
                        multiPattern: null,
                    },
                ]);
            });
        });

        describe('options.atr', () => {
            const hammerBars: Bar[] = [
                ...makeTrendLead('decline', HAMMER_END_CLOSE),
                makeHammerBar(0),
            ];

            it('bars와 길이가 같으면 그 ATR을 쓴다 (전부 null이면 움직임을 잴 수 없어 감지하지 않는다)', () => {
                const atr = hammerBars.map(() => null);
                expect(detectCandlePatternEntries(hammerBars, { atr })).toEqual(
                    []
                );
            });

            it('길이가 다르면 무시하고 bars에서 ATR을 계산한다', () => {
                const atr = hammerBars.slice(1).map(() => null);
                expect(
                    detectCandlePatternEntries(hammerBars, { atr }).map(
                        e => e.singlePattern
                    )
                ).toEqual(['hammer']);
            });

            it('옵션이 없으면 계산한 ATR과 같은 결과다', () => {
                expect(
                    detectCandlePatternEntries(hammerBars, {
                        atr: calculateATR(hammerBars),
                    })
                ).toEqual(detectCandlePatternEntries(hammerBars));
            });
        });
    });

    describe('실제 차트: 상승 뒤 긴 아래꼬리 양봉', () => {
        // 익명화한 실제 일봉 60개(가격 배율·2001 기준 시간). 마지막 봉은 양봉이고 아래꼬리가 길어
        // 몸통 색으로 이름 붙이던 엔진은 hammer를 찍었지만, 직전에 크게 올랐으므로 교수형이다.
        const { bars } = chartFixture(hangingManChart);
        const lastBar = bars[bars.length - 1];
        const lastIndex = CANDLE_PATTERN_DETECTION_BARS - 1;

        it('마지막 봉은 양봉이고 아래꼬리가 몸통의 2배 이상이다', () => {
            const body = lastBar.close - lastBar.open;
            expect(body).toBeGreaterThan(0);
            expect(lastBar.open - lastBar.low).toBeGreaterThanOrEqual(2 * body);
        });

        it('마지막 봉을 hammer가 아니라 hanging_man으로 감지한다', () => {
            const entries = detectCandlePatternEntries(bars);
            expect(entries.find(e => e.barIndex === lastIndex)).toEqual({
                barIndex: lastIndex,
                patternType: 'single',
                singlePattern: 'hanging_man',
                multiPattern: null,
            });
            expect(entries.map(e => e.singlePattern)).not.toContain('hammer');
        });

        it('그 봉 앞의 움직임은 상승이고 근거 크기가 문턱 이상이다', () => {
            const entries = detectCandlePatternEntries(bars);
            const [move] = entries
                .filter(e => e.barIndex === lastIndex)
                .map(e => candleEntryPriorMove(bars, e));
            expect(move?.trend).toBe('advance');
            expect(move?.moveAtr).toBeGreaterThanOrEqual(
                CANDLE_PRIOR_TREND_MIN_ATR
            );
        });
    });

    describe('candleEntryPriorMove', () => {
        const hammerBars: Bar[] = [
            ...makeTrendLead('decline', 90),
            makeHammerBar(0),
        ];

        it('맥락으로 이름 붙은 단봉은 그 봉 앞의 움직임을 반환한다', () => {
            const [entry] = detectCandlePatternEntries(hammerBars);
            const move = candleEntryPriorMove(hammerBars, entry);
            expect(move?.trend).toBe('decline');
            expect(move?.moveAtr).toBeLessThanOrEqual(
                -CANDLE_PRIOR_TREND_MIN_ATR
            );
        });

        it('모양만으로 정해지는 단봉(마루보주)은 null이다', () => {
            const bars: Bar[] = [
                ...makeTrendLead('decline', 90),
                makeBar(0, { open: 100, high: 110, low: 100, close: 110 }),
            ];
            const [entry] = detectCandlePatternEntries(bars);
            expect(entry.singlePattern).toBe('bullish_marubozu');
            expect(candleEntryPriorMove(bars, entry)).toBeNull();
        });

        it('다봉은 첫 봉 앞의 움직임을 읽는다 (패턴 봉을 포함하지 않는다)', () => {
            const [bearish, bullish] = makeEngulfingPair(0);
            const bars: Bar[] = [
                ...makeTrendLead('decline', bearish.open),
                bearish,
                bullish,
            ];
            const [entry] = detectCandlePatternEntries(bars);
            const atr = calculateATR(bars);
            const first = bars.length - 2;
            expect(candleEntryPriorMove(bars, entry)).toEqual(
                candlePriorMove(bars, first, atr)
            );
        });

        it('ATR을 주면 bars와 길이가 같을 때 그 값을 쓴다', () => {
            const [entry] = detectCandlePatternEntries(hammerBars);
            const atr = hammerBars.map(() => null);
            expect(candleEntryPriorMove(hammerBars, entry, atr)).toEqual({
                trend: 'none',
                moveAtr: null,
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
