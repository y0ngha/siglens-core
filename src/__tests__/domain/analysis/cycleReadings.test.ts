import { describe, expect, it } from 'vitest';
import {
    buildCycleCards,
    CYCLE_STAGE_TREND,
    cycleHistory,
    describeCycleReading,
    readCycle,
} from '@/domain/analysis/cycleReadings';
import {
    CYCLE_LOOKBACK_BARS,
    buildIndicatorStateSection,
    macdCycleStageOf,
    maCycleStageOf,
} from '@/domain/analysis/indicatorState';
import { priceQuoting } from '@/domain/analysis/promptFormat';
import { EMPTY_INDICATOR_RESULT } from '@/domain/indicators/constants';
import type {
    CycleReading,
    CycleStage,
    IndicatorResult,
    Skill,
} from '@/domain/types';

const PRINT = {
    quoting: priceQuoting(100, 'USD', 'equity', 'share'),
    differenceDp: 2,
    trendSampleCount: 7,
} as const;

// ── Stage history ───────────────────────────────────────────────────────────

const N = null;
const history = (stages: readonly (CycleStage | null)[], lookback = 120) =>
    cycleHistory(stages, lookback);

describe('cycleHistory', () => {
    it('counts the bars of the current run and the stage before it', () => {
        expect(history([1, 1, 2, 2, 2])).toEqual({
            previousStage: 1,
            barsInStage: 3,
            progression: 'forward',
            stageChanges: 1,
        });
    });

    it('is null for the duration when the run reaches the first bar of the series', () => {
        expect(history([2, 2, 2])).toEqual({
            previousStage: null,
            barsInStage: null,
            progression: null,
            stageChanges: 0,
        });
    });

    it('is null for the duration when the run reaches the first bar of the window, a stage older than the lookback', () => {
        const stages = Array.from({ length: 200 }, () => 4 as CycleStage);
        expect(history(stages, 120)).toMatchObject({
            barsInStage: null,
            previousStage: null,
        });
        // The run starts on the first bar inside the window: its length is known.
        const started = [...Array(80).fill(3), ...Array(120).fill(4)];
        expect(history(started, 120)).toMatchObject({ barsInStage: null });
        const oneInside = [...Array(80).fill(3), 5, ...Array(119).fill(4)];
        expect(history(oneInside, 120)).toMatchObject({
            barsInStage: 119,
            previousStage: 5,
        });
    });

    it('cuts the window by bar count, the current bar included, whatever the stage values before it', () => {
        const stages = [...Array(10).fill(1), ...Array(120).fill(2)];
        expect(history(stages, 120).stageChanges).toBe(0);
        const longer = [...Array(10).fill(1), ...Array(119).fill(2)];
        expect(history(longer, 120).stageChanges).toBe(1);
    });

    it('ignores bars with no stage: they neither end a run nor count as a change', () => {
        expect(history([1, 1, N, N, 1, 2, N, 2])).toEqual({
            previousStage: 1,
            barsInStage: 2,
            progression: 'forward',
            stageChanges: 1,
        });
        expect(history([1, N, 1, N, N, 1, 2, 2, 2])).toMatchObject({
            previousStage: 1,
            barsInStage: 3,
            stageChanges: 1,
        });
    });

    it('counts every change between consecutive stages', () => {
        expect(history([1, 2, 1, 2, 3, 3])).toMatchObject({
            stageChanges: 4,
            previousStage: 2,
            barsInStage: 2,
        });
        expect(history([N, N, N])).toEqual({
            previousStage: null,
            barsInStage: null,
            progression: null,
            stageChanges: 0,
        });
        expect(history([])).toMatchObject({ stageChanges: 0 });
    });

    it.each([
        [1, 2, 'forward'],
        [2, 3, 'forward'],
        [6, 1, 'forward'],
        [2, 1, 'reverse'],
        [1, 6, 'reverse'],
        [4, 3, 'reverse'],
        [1, 3, null],
        [1, 4, null],
        [5, 1, null],
    ] as const)('progression %s -> %s is %s', (from, to, progression) => {
        expect(history([from, from, to, to]).progression).toBe(progression);
    });

    it('takes the lookback from the constant the line is built from', () => {
        expect(CYCLE_LOOKBACK_BARS).toBe(120);
    });
});

// ── Stage tables ────────────────────────────────────────────────────────────

describe('stage tables', () => {
    it('ma: the order of the three lines fixes the stage, a tie or a gap has none', () => {
        expect(maCycleStageOf(3, 2, 1)).toMatchObject({
            stage: 1,
            order: ['short', 'medium', 'long'],
        });
        expect(maCycleStageOf(2, 3, 1)?.stage).toBe(2);
        expect(maCycleStageOf(1, 3, 2)?.stage).toBe(3);
        expect(maCycleStageOf(1, 2, 3)?.stage).toBe(4);
        expect(maCycleStageOf(2, 1, 3)?.stage).toBe(5);
        expect(maCycleStageOf(3, 1, 2)?.stage).toBe(6);
        expect(maCycleStageOf(2, 2, 1)).toBeNull();
        expect(maCycleStageOf(3, 2, 2)).toBeNull();
        expect(maCycleStageOf(3, null, 1)).toBeNull();
    });

    it('macd: the signs of the three differences fix the stage, zero matches none', () => {
        expect(macdCycleStageOf(3, 2, 1)).toBe(1);
        expect(macdCycleStageOf(2, 3, 1)).toBe(2);
        expect(macdCycleStageOf(1, 3, 2)).toBe(3);
        expect(macdCycleStageOf(1, 2, 3)).toBe(4);
        expect(macdCycleStageOf(2, 1, 3)).toBe(5);
        expect(macdCycleStageOf(3, 1, 2)).toBe(6);
        expect(macdCycleStageOf(2, 2, 1)).toBeNull();
    });

    it('trend follows the stage tables of the strategy skills', () => {
        expect(CYCLE_STAGE_TREND).toEqual({
            1: 'bullish',
            2: 'neutral',
            3: 'bearish',
            4: 'bearish',
            5: 'neutral',
            6: 'bullish',
        });
    });
});

// ── Readings ────────────────────────────────────────────────────────────────

const series = (values: readonly number[]): (number | null)[] => [...values];

/** Per-bar MA values whose order walks through `stages` (a stage is a fixed ordering of three values). */
const MA_BY_STAGE: Readonly<Record<CycleStage, [number, number, number]>> = {
    1: [30, 20, 10],
    2: [20, 30, 10],
    3: [10, 30, 20],
    4: [10, 20, 30],
    5: [20, 10, 30],
    6: [30, 10, 20],
};

const maIndicators = (stages: readonly CycleStage[]): IndicatorResult => ({
    ...EMPTY_INDICATOR_RESULT,
    ma: {
        5: series(stages.map(s => MA_BY_STAGE[s][0])),
        20: series(stages.map(s => MA_BY_STAGE[s][1])),
        60: series(stages.map(s => MA_BY_STAGE[s][2])),
    },
});

const EMA_BY_STAGE: Readonly<Record<CycleStage, [number, number, number]>> =
    MA_BY_STAGE;

const emaIndicators = (stages: readonly CycleStage[]): IndicatorResult => ({
    ...EMPTY_INDICATOR_RESULT,
    ema: {
        9: series(stages.map(s => EMA_BY_STAGE[s][0] + 0.123)),
        21: series(stages.map(s => EMA_BY_STAGE[s][1])),
        60: series(stages.map(s => EMA_BY_STAGE[s][2])),
    },
});

describe('readCycle', () => {
    it('ma_cycle: the stage of the last bar, its history, the printed values, the order and the line slopes', () => {
        const stages: CycleStage[] = [1, 1, 1, 2, 2, 3, 3, 3, 3];
        const reading = readCycle('ma_cycle', maIndicators(stages), PRINT);
        expect(reading).toEqual({
            kind: 'ma_cycle',
            stage: 3,
            previousStage: 2,
            barsInStage: 4,
            progression: 'forward',
            stageChanges: 2,
            values: { ma5: 10, ma20: 30, ma60: 20 },
            order: ['medium', 'long', 'short'],
            slopes: { ma5: 'falling', ma20: 'rising', ma60: 'rising' },
        });
    });

    it('ma_cycle: the stage equals the one the prompt line prints', () => {
        const stages: CycleStage[] = [4, 4, 5, 5, 6];
        const indicators = maIndicators(stages);
        const line = buildIndicatorStateSection({
            price: 100,
            ma: indicators.ma,
            ema: {},
            maPeriods: [5, 20, 60],
            emaPeriods: [],
            macd: undefined,
            macdHistogramTrend: null,
            dmi: undefined,
            stochastic: undefined,
            ichimoku: undefined,
            bollinger: undefined,
            supertrend: undefined,
            parabolicSar: undefined,
            atr: undefined,
            quoting: PRINT.quoting,
            diffDp: 2,
            lastVolume: undefined,
            priorVolumes: [],
            rsi: undefined,
            lastBar: undefined,
            prevBar: undefined,
        })
            .split('\n')
            .find(l => l.startsWith('- MA cycle'));
        expect(line).toContain(
            `stage ${readCycle('ma_cycle', indicators, PRINT)?.stage}`
        );
    });

    it('ma_cycle: a tie or a missing line has no reading', () => {
        const tie = maIndicators([1]);
        expect(
            readCycle(
                'ma_cycle',
                { ...tie, ma: { ...tie.ma, 20: [30] } },
                PRINT
            )
        ).toBeNull();
        expect(readCycle('ma_cycle', EMPTY_INDICATOR_RESULT, PRINT)).toBeNull();
        expect(
            readCycle(
                'ma_cycle',
                { ...tie, ma: { 5: [1], 20: [N as never], 60: [3] } },
                PRINT
            )
        ).toBeNull();
    });

    it('macd_cycle: the stage, the three differences at the difference precision, and the history', () => {
        const stages: CycleStage[] = [6, 6, 1, 1, 1, 1];
        const reading = readCycle('macd_cycle', emaIndicators(stages), PRINT);
        expect(reading).toEqual({
            kind: 'macd_cycle',
            stage: 1,
            previousStage: 6,
            barsInStage: 4,
            progression: 'forward',
            stageChanges: 1,
            // (EMA9 − EMA21), (EMA9 − EMA60), (EMA21 − EMA60) = 10.123, 20.123, 10
            values: { upper: 10.12, middle: 20.12, lower: 10 },
            slopes: { ema9: 'flat', ema21: 'rising', ema60: 'falling' },
        });
    });

    it('macd_cycle: no reading when a line is missing or a difference is zero', () => {
        expect(
            readCycle('macd_cycle', EMPTY_INDICATOR_RESULT, PRINT)
        ).toBeNull();
        const zero = {
            ...EMPTY_INDICATOR_RESULT,
            ema: { 9: [10], 21: [10], 60: [5] },
        };
        expect(readCycle('macd_cycle', zero, PRINT)).toBeNull();
    });

    it('reads the last 120 bars of a longer series (the window is by bar count)', () => {
        const stages = [
            ...Array<CycleStage>(130).fill(1),
            ...Array<CycleStage>(10).fill(2),
        ];
        const reading = readCycle('ma_cycle', maIndicators(stages), PRINT);
        expect(reading).toMatchObject({
            stage: 2,
            previousStage: 1,
            barsInStage: 10,
            stageChanges: 1,
        });
    });
});

// ── Cards ───────────────────────────────────────────────────────────────────

const strategy = (
    name: string,
    kind: Skill['computedCard'],
    type: Skill['type'] = 'strategy'
): Skill => ({
    name,
    description: 'd',
    type,
    indicators: [],
    confidenceWeight: 0.55,
    content: 'c',
    gating: { tier: 'gated', signalKind: 'event', triggers: ['golden_cross'] },
    computedCard: kind,
});

describe('buildCycleCards', () => {
    it('builds one card per tagged cycle strategy, named after the skill, with the stage trend and an English summary', () => {
        const cards = buildCycleCards(
            [
                strategy('이동평균선 대순환 분석', 'ma_cycle'),
                strategy('MACD 대순환 분석', 'macd_cycle'),
                strategy('Other strategy', undefined),
                strategy('Indicator', 'ma_cycle', 'indicator_guide'),
                strategy('Wrong kind', 'rsi'),
            ],
            { ...maIndicators([4, 4]), ema: emaIndicators([1, 1]).ema },
            PRINT
        );
        expect(cards.map(c => c.strategyName)).toEqual([
            '이동평균선 대순환 분석',
            'MACD 대순환 분석',
        ]);
        expect(cards.map(c => c.trend)).toEqual(['bearish', 'bullish']);
        expect(cards.map(c => c.cycle?.stage)).toEqual([4, 1]);
        expect(cards.every(c => c.candidateIds?.length === 0)).toBe(true);
        expect(cards[0].summary).toBe(
            describeCycleReading(cards[0].cycle as CycleReading)
        );
    });

    it('builds nothing for a cycle whose line reads N/A', () => {
        expect(
            buildCycleCards(
                [strategy('이동평균선 대순환 분석', 'ma_cycle')],
                EMPTY_INDICATOR_RESULT,
                PRINT
            )
        ).toEqual([]);
    });

    it('describes the facts of a reading and attaches no verdict', () => {
        const text = describeCycleReading({
            kind: 'ma_cycle',
            stage: 3,
            previousStage: 2,
            barsInStage: 4,
            progression: 'forward',
            stageChanges: 2,
            values: { ma5: 10, ma20: 30, ma60: 20 },
            order: ['medium', 'long', 'short'],
            slopes: { ma5: 'falling', ma20: 'rising', ma60: 'flat' },
        });
        expect(text).toBe(
            'MA cycle (MA5/MA20/MA60): stage 3 (Decline Transition 2). Order high to low: MA20 > MA60 > MA5. Previous stage 2, forward (the next stage of the cycle). 4 bars in the stage. 2 stage changes in the last 120 bars. Values: ma5 10, ma20 30, ma60 20.'
        );
        expect(
            describeCycleReading({
                kind: 'macd_cycle',
                stage: 4,
                previousStage: null,
                barsInStage: null,
                progression: null,
                stageChanges: 0,
                values: { upper: -1.5, middle: -4, lower: -2.5 },
                slopes: { ema9: null, ema21: null, ema60: null },
            })
        ).toBe(
            'MACD cycle (EMA9/21/60): stage 4 (Stable Downtrend). No earlier stage in the window. The stage has held since the start of the available window (at most 120 bars). 0 stage changes in the last 120 bars. Values: upper -1.5, middle -4, lower -2.5.'
        );
    });
});
