import { detectTrend } from '@/domain/analysis/indicatorTrendTag';
import {
    CYCLE_LOOKBACK_BARS,
    MA_CYCLE_PERIODS,
} from '@/domain/analysis/cycleConstants';
import {
    lastValueOf,
    MACD_CYCLE_EMA_LONG,
    MACD_CYCLE_EMA_MID,
    MACD_CYCLE_EMA_SHORT,
    macdCycleStageOf,
    maCycleStageOf,
} from '@/domain/analysis/indicatorState';
import {
    formatNullableNumber,
    formatQuotedPrice,
    type PriceQuoting,
} from '@/domain/analysis/promptFormat';
import type {
    CycleCardKind,
    CycleHistory,
    CyclePrintContext,
    CycleLineSlope,
    CycleReading,
    CycleStage,
    IndicatorResult,
    RawStrategyResult,
    Skill,
    Trend,
} from '@/domain/types';

/**
 * @internal The trend a stage stands for, from the strategy skills' own tables: 1 and 6 are
 * the rising side, 3 and 4 the falling side, 2 and 5 transitions with no side.
 */
export const CYCLE_STAGE_TREND: Readonly<Record<CycleStage, Trend>> = {
    1: 'bullish',
    2: 'neutral',
    3: 'bearish',
    4: 'bearish',
    5: 'neutral',
    6: 'bullish',
};

/** The stage names the strategy skills' stage tables use. */
const CYCLE_STAGE_NAME: Readonly<Record<CycleStage, string>> = {
    1: 'Stable Uptrend',
    2: 'Decline Transition 1',
    3: 'Decline Transition 2',
    4: 'Stable Downtrend',
    5: 'Rise Transition 1',
    6: 'Rise Transition 2',
};

const CYCLE_TITLE: Readonly<Record<CycleCardKind, string>> = {
    ma_cycle: `MA cycle (${Object.values(MA_CYCLE_PERIODS)
        .map(period => `MA${period}`)
        .join('/')})`,
    macd_cycle: 'MACD cycle (EMA9/21/60)',
};

const STAGE_COUNT = 6;

interface StageRun {
    readonly stage: CycleStage;
    readonly bars: number;
    /** Index in the window of the run's first bar with a stage. */
    readonly first: number;
}

/**
 * @internal The stage history of a window of per-bar stages (oldest first, the current bar
 * last): bars with no stage (a transition) neither end a run nor count as a change; `previousStage`
 * is the stage of the run before the current one; `barsInStage` counts the bars with a stage in
 * the current run and is `null` when the run starts at the first bar of the window; `progression`
 * is `'forward'` when previous → current is the next step of 1→2→…→6→1, `'reverse'` the previous
 * step. `stages` is the whole series; the window is its last `lookback` bars.
 */
export function cycleHistory(
    stages: readonly (CycleStage | null)[],
    lookback: number
): CycleHistory {
    const window = stages.slice(-lookback);
    const runs = window.reduce<readonly StageRun[]>((acc, stage, i) => {
        if (stage === null) return acc;
        const last = acc.at(-1);
        return last !== undefined && last.stage === stage
            ? [...acc.slice(0, -1), { ...last, bars: last.bars + 1 }]
            : [...acc, { stage, bars: 1, first: i }];
    }, []);
    const current = runs.at(-1);
    const previous = runs.at(-2)?.stage ?? null;
    const step =
        current === undefined || previous === null
            ? 0
            : (((current.stage - previous) % STAGE_COUNT) + STAGE_COUNT) %
              STAGE_COUNT;
    return {
        previousStage: previous,
        barsInStage:
            current === undefined || current.first === 0 ? null : current.bars,
        progression: step === 1 ? 'forward' : step === 5 ? 'reverse' : null,
        stageChanges: Math.max(0, runs.length - 1),
    };
}

/** The per-bar stages of the last `CYCLE_LOOKBACK_BARS` bars of `barCount`, oldest first. */
const windowStages = (
    barCount: number,
    stageAt: (index: number) => CycleStage | null
): readonly (CycleStage | null)[] => {
    const size = Math.min(CYCLE_LOOKBACK_BARS, barCount);
    return Array.from({ length: size }, (_, k) => stageAt(barCount - size + k));
};

const slopeOf = (
    series: (number | null)[] | undefined,
    sampleCount: number
): CycleLineSlope => detectTrend(series ?? [], sampleCount);

const printedPrice = (value: number | null, quoting: PriceQuoting): number =>
    Number(formatQuotedPrice(value, quoting));

const printedDifference = (value: number, dp: number): number =>
    Number(formatNullableNumber(value, dp));

function maCycleReading(
    indicators: IndicatorResult,
    print: CyclePrintContext
): CycleReading | null {
    const { short, medium, long } = MA_CYCLE_PERIODS;
    const series = indicators.ma;
    const current = maCycleStageOf(
        lastValueOf(series[short]),
        lastValueOf(series[medium]),
        lastValueOf(series[long])
    );
    if (current === null) return null;
    const barCount = series[short]?.length ?? 0;
    const history = cycleHistory(
        windowStages(
            barCount,
            i =>
                maCycleStageOf(
                    series[short]?.[i] ?? null,
                    series[medium]?.[i] ?? null,
                    series[long]?.[i] ?? null
                )?.stage ?? null
        ),
        CYCLE_LOOKBACK_BARS
    );
    const price = (period: number): number =>
        printedPrice(lastValueOf(series[period]), print.quoting);
    return {
        kind: 'ma_cycle',
        stage: current.stage,
        ...history,
        values: {
            ma5: price(short),
            ma20: price(medium),
            ma60: price(long),
        },
        order: current.order,
        slopes: {
            ma5: slopeOf(series[short], print.trendSampleCount),
            ma20: slopeOf(series[medium], print.trendSampleCount),
            ma60: slopeOf(series[long], print.trendSampleCount),
        },
    };
}

function macdCycleReading(
    indicators: IndicatorResult,
    print: CyclePrintContext
): CycleReading | null {
    const series = indicators.ema;
    const [short, mid, long] = [
        lastValueOf(series[MACD_CYCLE_EMA_SHORT]),
        lastValueOf(series[MACD_CYCLE_EMA_MID]),
        lastValueOf(series[MACD_CYCLE_EMA_LONG]),
    ];
    if (short === null || mid === null || long === null) return null;
    const stage = macdCycleStageOf(short, mid, long);
    if (stage === null) return null;
    const barCount = series[MACD_CYCLE_EMA_SHORT]?.length ?? 0;
    const at = (period: number, i: number): number | null =>
        series[period]?.[i] ?? null;
    const history = cycleHistory(
        windowStages(barCount, i => {
            const [s, m, l] = [
                at(MACD_CYCLE_EMA_SHORT, i),
                at(MACD_CYCLE_EMA_MID, i),
                at(MACD_CYCLE_EMA_LONG, i),
            ];
            return s === null || m === null || l === null
                ? null
                : macdCycleStageOf(s, m, l);
        }),
        CYCLE_LOOKBACK_BARS
    );
    return {
        kind: 'macd_cycle',
        stage,
        ...history,
        values: {
            upper: printedDifference(short - mid, print.differenceDp),
            middle: printedDifference(short - long, print.differenceDp),
            lower: printedDifference(mid - long, print.differenceDp),
        },
        slopes: {
            ema9: slopeOf(series[MACD_CYCLE_EMA_SHORT], print.trendSampleCount),
            ema21: slopeOf(series[MACD_CYCLE_EMA_MID], print.trendSampleCount),
            ema60: slopeOf(series[MACD_CYCLE_EMA_LONG], print.trendSampleCount),
        },
    };
}

/**
 * @internal The cycle reading of `kind` on this chart, or `null` when the prompt's own line
 * reads `N/A` (a missing value, a tie, or — for the MACD cycle — a zero difference).
 */
export function readCycle(
    kind: CycleCardKind,
    indicators: IndicatorResult,
    print: CyclePrintContext
): CycleReading | null {
    return kind === 'ma_cycle'
        ? maCycleReading(indicators, print)
        : macdCycleReading(indicators, print);
}

const PROGRESSION_TEXT = {
    forward: 'forward (the next stage of the cycle)',
    reverse: 'reverse (the previous stage of the cycle)',
} as const;

/**
 * @internal The English canonical line of a cycle card (`StrategyResult.summary`): the facts
 * the reading holds, no verdict. Display text in the reader's language is rendered from
 * `StrategyResult.cycle`.
 */
export function describeCycleReading(reading: CycleReading): string {
    const lines = Object.entries(reading.values).map(
        ([key, value]) => `${key} ${value}`
    );
    const order =
        reading.order === undefined
            ? ''
            : ` Order high to low: ${reading.order.map(role => `MA${MA_CYCLE_PERIODS[role]}`).join(' > ')}.`;
    const previous =
        reading.previousStage === null
            ? 'No earlier stage in the window.'
            : `Previous stage ${reading.previousStage}${reading.progression === null ? '' : `, ${PROGRESSION_TEXT[reading.progression]}`}.`;
    const duration =
        reading.barsInStage === null
            ? `The stage has held since the start of the available window (at most ${CYCLE_LOOKBACK_BARS} bars).`
            : `${reading.barsInStage} bars in the stage.`;
    return `${CYCLE_TITLE[reading.kind]}: stage ${reading.stage} (${CYCLE_STAGE_NAME[reading.stage]}).${order} ${previous} ${duration} ${reading.stageChanges} stage changes in the last ${CYCLE_LOOKBACK_BARS} bars. Values: ${lines.join(', ')}.`;
}

/**
 * @internal One cycle card per injected strategy skill that carries a cycle `computed_card`
 * tag and whose stage line is not `N/A`, in the skills' order. `strategyName` is the skill's
 * name, `trend` follows the stage, `summary` is {@link describeCycleReading}, `candidateIds`
 * is empty.
 */
export function buildCycleCards(
    skills: readonly Skill[],
    indicators: IndicatorResult,
    print: CyclePrintContext
): readonly RawStrategyResult[] {
    return skills.flatMap(skill => {
        const kind = skill.computedCard;
        if (
            skill.type !== 'strategy' ||
            (kind !== 'ma_cycle' && kind !== 'macd_cycle')
        ) {
            return [];
        }
        const cycle = readCycle(kind, indicators, print);
        return cycle === null
            ? []
            : [
                  {
                      strategyName: skill.name,
                      trend: CYCLE_STAGE_TREND[cycle.stage],
                      summary: describeCycleReading(cycle),
                      candidateIds: [],
                      cycle,
                  },
              ];
    });
}
