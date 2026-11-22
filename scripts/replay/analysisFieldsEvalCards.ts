/**
 * The card checks of the `gating` mode and the card-trend baseline of the `output` mode
 * (WP-16 §9.1, D5 to D9): what a computed indicator card or cycle card must equal, recomputed
 * from the printed prompt lines and from OHLC. Every rule here is the instrument's own copy
 * (thresholds in `analysisFieldsEvalTypes.ts`); a card is only ever the thing compared with.
 *
 * Before the cards exist (main), a rendered prompt carries none and the card gates cannot be
 * computed; the readers below are written against the shapes WP-16 §3.5 and §4 fix, read
 * structurally from `unknown`, so a card that is malformed fails a check instead of being
 * coerced.
 */
import { emaSeries } from './analysisFieldsEvalCompute';
import { lineStarting, numbersOnLine } from './analysisFieldsEvalPrompt';
import {
    FIELDS_EVAL_CONSTANTS as C,
    type TrendLabel,
} from './analysisFieldsEvalTypes';

export const ALWAYS_ON_KINDS = [
    'ma',
    'ema',
    'adx',
    'atr',
    'obv',
    'volume_profile',
] as const;
export type AlwaysOnKind = (typeof ALWAYS_ON_KINDS)[number];

export const CYCLE_KINDS = ['ma_cycle', 'macd_cycle'] as const;
export type CycleKind = (typeof CYCLE_KINDS)[number];

const isAlwaysOnKind = (kind: string): kind is AlwaysOnKind =>
    ALWAYS_ON_KINDS.some(k => k === kind);
export const isCycleKind = (kind: string): kind is CycleKind =>
    CYCLE_KINDS.some(k => k === kind);

/**
 * Skill names of the kinds D7 measured before the catalog carried `computed_card` tags
 * (core-0 baseline on main); a tagged catalog takes the kind of a skill from its tag.
 */
export const CARD_TREND_SKILLS: Readonly<Record<string, AlwaysOnKind>> = {
    'MA Signal Guide': 'ma',
    'EMA Signal Guide': 'ema',
    'ADX Signal Guide': 'adx',
    'OBV Signal Guide': 'obv',
};

export const CYCLE_STRATEGY_SKILLS: Readonly<Record<string, CycleKind>> = {
    '이동평균선 대순환 분석': 'ma_cycle',
    'MACD 대순환 분석': 'macd_cycle',
};

const STAGE_TREND: Readonly<Record<number, TrendLabel>> = {
    1: 'bullish',
    2: 'neutral',
    3: 'bearish',
    4: 'bearish',
    5: 'neutral',
    6: 'bullish',
};

// ─── Printed lines ────────────────────────────────────────────────────────────

const num = (text: string): number => Number(text.replaceAll(',', ''));

export interface PrintedReading {
    /** The state the printed values give, with the instrument's own thresholds. */
    state: string;
    /** Numbers printed on the source lines (a card's non-null values must be among them). */
    numbers: readonly number[];
    /** The trend a card of this kind takes (WP-16 §3.4). */
    trend: TrendLabel;
}

const sideOf = (word: string): TrendLabel =>
    word === 'bullish' ? 'bullish' : word === 'bearish' ? 'bearish' : 'neutral';

function stackOf(
    prompt: string,
    name: 'MA' | 'EMA',
    close: number | null
): PrintedReading | null {
    const stack = lineStarting(prompt, `- ${name} stack: `)?.match(
        /^- (?:MA|EMA) stack: (bullish|bearish|mixed)/
    );
    if (stack === null || stack === undefined) return null;
    const values = lineStarting(prompt, `- ${name}: `);
    return {
        state: stack[1] === 'mixed' ? 'mixed' : `${stack[1]}_stack`,
        numbers: [
            ...(values === null ? [] : numbersOnLine(values)),
            ...(close === null ? [] : [close]),
        ],
        trend: sideOf(stack[1]),
    };
}

/**
 * A kind's reading from its own printed lines, or `null` when they are absent or `N/A` (or
 * the kind has no reader: see `hasReader`).
 */
export function printedKind(
    prompt: string,
    kind: string,
    close: number | null
): PrintedReading | null {
    if (kind === 'ma') return stackOf(prompt, 'MA', close);
    if (kind === 'ema') return stackOf(prompt, 'EMA', close);
    if (kind === 'adx') {
        const dmi = prompt.match(
            /^- DMI: \+DI ([\d.]+) \/ -DI ([\d.]+) \/ ADX ([\d.]+)/m
        );
        if (dmi === null) return null;
        const [plus, minus, adx] = [num(dmi[1]), num(dmi[2]), num(dmi[3])];
        const state =
            adx >= C.cards.adxTrending
                ? 'trending'
                : adx < C.cards.adxWeak
                  ? 'weak'
                  : 'between';
        return {
            state,
            numbers: [plus, minus, adx],
            trend:
                state === 'weak'
                    ? 'neutral'
                    : plus > minus
                      ? 'bullish'
                      : plus < minus
                        ? 'bearish'
                        : 'neutral',
        };
    }
    if (kind === 'atr' || kind === 'obv') {
        const found = prompt.match(
            kind === 'atr'
                ? /^- ATR\(14\): (-?[\d.,]+) \[(rising|falling|flat)\]/m
                : /^- OBV: (-?[\d.,]+) \[(rising|falling|flat)\]/m
        );
        if (found === null) return null;
        const pct = prompt.match(/^- ATR % of price: ([\d.]+)%/m);
        return {
            state: found[2],
            numbers: [
                num(found[1]),
                ...(kind === 'atr' && pct !== null ? [num(pct[1])] : []),
            ],
            trend:
                kind === 'atr'
                    ? 'neutral'
                    : found[2] === 'rising'
                      ? 'bullish'
                      : found[2] === 'falling'
                        ? 'bearish'
                        : 'neutral',
        };
    }
    if (kind === 'stochastic' || kind === 'stoch_rsi') {
        const found =
            kind === 'stochastic'
                ? prompt.match(
                      /^- Stochastic\([\d,]+\): %K (-?[\d.]+) \/ %D (-?[\d.]+)/m
                  )
                : prompt.match(
                      /^- StochRSI\([\d,]+\): K (-?[\d.]+) \/ D (-?[\d.]+)/m
                  );
        if (found === null) return null;
        const [k, d] = [num(found[1]), num(found[2])];
        const [hi, lo] =
            kind === 'stochastic'
                ? [C.cards.stochasticOverbought, C.cards.stochasticOversold]
                : [C.cards.stochRsiOverbought, C.cards.stochRsiOversold];
        return levelReading(k, hi, lo, [k, d]);
    }
    if (kind === 'williams_r') {
        const found = prompt.match(/^- Williams %R\(\d+\): (-?[\d.]+)/m);
        if (found === null) return null;
        const value = num(found[1]);
        return levelReading(
            value,
            C.cards.williamsROverbought,
            C.cards.williamsROversold,
            [value]
        );
    }
    if (kind === 'buy_sell_volume') {
        const found = prompt.match(/\(Buy ratio: ([\d.]+)%\)/);
        if (found === null) return null;
        const ratio = num(found[1]) / 100;
        const state =
            ratio >= C.cards.buySellBullish
                ? 'buy_dominant'
                : ratio <= C.cards.buySellBearish
                  ? 'sell_dominant'
                  : 'balanced';
        return {
            state,
            numbers: [num(found[1])],
            trend:
                state === 'buy_dominant'
                    ? 'bullish'
                    : state === 'sell_dominant'
                      ? 'bearish'
                      : 'neutral',
        };
    }
    if (kind !== 'volume_profile') return null;
    const profile = prompt.match(
        /^- Volume Profile \(all (\d+) bars\): POC (-?[\d.,]+) \/ VAH (-?[\d.,]+) \/ VAL (-?[\d.,]+)/m
    );
    if (profile === null || close === null) return null;
    const [poc, vah, val] = [num(profile[2]), num(profile[3]), num(profile[4])];
    const state =
        close > vah
            ? 'above_value_area'
            : close < val
              ? 'below_value_area'
              : 'inside_value_area';
    return {
        state,
        numbers: [num(profile[1]), poc, vah, val, close],
        trend:
            state === 'above_value_area'
                ? 'bullish'
                : state === 'below_value_area'
                  ? 'bearish'
                  : 'neutral',
    };
}

/** An oscillator at or beyond a bound is overbought (bearish) or oversold (bullish). */
function levelReading(
    value: number,
    hi: number,
    lo: number,
    numbers: readonly number[]
): PrintedReading {
    const state =
        value >= hi ? 'overbought' : value <= lo ? 'oversold' : 'between';
    return {
        state,
        numbers,
        trend:
            state === 'overbought'
                ? 'bearish'
                : state === 'oversold'
                  ? 'bullish'
                  : 'neutral',
    };
}

/** The indicator-card kinds whose state, values and trend the instrument reads from their own printed lines. */
export const READER_KINDS: readonly string[] = [
    ...ALWAYS_ON_KINDS,
    'stochastic',
    'stoch_rsi',
    'williams_r',
    'buy_sell_volume',
];

export const hasReader = (kind: string): boolean => READER_KINDS.includes(kind);

/** A kind D7 can give a trend for: an indicator reader, or a cycle stage table. */
export const hasTrendRule = (kind: string): boolean =>
    hasReader(kind) || isCycleKind(kind);

/**
 * D7 baseline: the trend a card of this skill takes from the printed lines, with the model's
 * own calibration of cardtrend (ADX below 20 is neutral, whatever the DI side).
 */
export function ruleTrendOfKind(
    kind: string,
    prompt: string,
    close: number | null
): TrendLabel | null {
    if (isCycleKind(kind)) {
        const stage = printedCycle(prompt, kind).stage;
        return stage === null ? null : STAGE_TREND[stage];
    }
    return printedKind(prompt, kind, close)?.trend ?? null;
}

export interface PrintedCycle {
    /** `null` when the line is absent, `N/A` or a transition. */
    stage: number | null;
    numbers: readonly number[];
}

/** The `- MA cycle` / `- MACD cycle` line of `## Indicator State`. */
export function printedCycle(prompt: string, kind: CycleKind): PrintedCycle {
    const line =
        lineStarting(
            prompt,
            kind === 'ma_cycle' ? '- MA cycle (' : '- MACD cycle ('
        ) ?? '';
    const stage = line.match(/; stage (\d)\s*$/);
    return {
        stage: stage === null ? null : Number(stage[1]),
        numbers:
            kind === 'macd_cycle'
                ? [
                      ...line.matchAll(
                          /\((?:EMA\d+−EMA\d+)\) ([+-]?\d[\d,]*(?:\.\d+)?)/g
                      ),
                  ].map(m => num(m[1]))
                : [],
    };
}

// ─── Cycle recomputation ──────────────────────────────────────────────────────

const smaAt = (
    closes: readonly number[],
    i: number,
    period: number
): number | null =>
    i + 1 < period
        ? null
        : closes.slice(i + 1 - period, i + 1).reduce((s, v) => s + v, 0) /
          period;

const MA_STAGE_BY_ORDER: Readonly<Record<string, number>> = {
    '0>1>2': 1,
    '1>0>2': 2,
    '1>2>0': 3,
    '2>1>0': 4,
    '2>0>1': 5,
    '0>2>1': 6,
};

/** Stage of the three MA values (short, medium, long), `null` on a missing value or a tie. */
export function maStage(values: readonly (number | null)[]): number | null {
    if (values.some(v => v === null)) return null;
    const ranked = values
        .map((value, role) => ({ value: value ?? 0, role }))
        .toSorted((a, b) => b.value - a.value);
    if (
        ranked[0].value === ranked[1].value ||
        ranked[1].value === ranked[2].value
    ) {
        return null;
    }
    return MA_STAGE_BY_ORDER[ranked.map(r => r.role).join('>')] ?? null;
}

const MACD_STAGE_BY_SIGNS: Readonly<Record<string, number>> = {
    '+++': 1,
    '-++': 2,
    '--+': 3,
    '---': 4,
    '+--': 5,
    '++-': 6,
};

/** Stage of the EMA(9, 21, 60) values, `null` on a missing value or a zero difference. */
export function macdStage(values: readonly (number | null)[]): number | null {
    if (values.some(v => v === null)) return null;
    const [short, mid, long] = values.map(v => v ?? 0);
    const sign = (n: number): string => (n > 0 ? '+' : n < 0 ? '-' : '0');
    return (
        MACD_STAGE_BY_SIGNS[
            `${sign(short - mid)}${sign(short - long)}${sign(mid - long)}`
        ] ?? null
    );
}

/** The stage at every bar of `closes` (the bars a prompt saw). */
export function cycleStageSeries(
    kind: CycleKind,
    closes: readonly number[]
): readonly (number | null)[] {
    if (kind === 'ma_cycle') {
        return closes.map((_, i) =>
            maStage(C.cards.maCyclePeriods.map(p => smaAt(closes, i, p)))
        );
    }
    const series = C.cards.macdCycleEmaPeriods.map(p => emaSeries(closes, p));
    return closes.map((_, i) => macdStage(series.map(s => s[i])));
}

export interface CycleHistory {
    stage: number | null;
    previousStage: number | null;
    barsInStage: number | null;
    progression: 'forward' | 'reverse' | null;
    stageChanges: number;
}

/**
 * The stage history the cycle reading carries (WP-16 §4, the orchestrator's decision):
 * the window is the last `lookback` bars by bar count, the current bar included. Bars with no
 * stage (a transition) are ignored everywhere: they neither end a run nor count as a change.
 * `stageChanges` is the number of changes between consecutive stages, `previousStage` the
 * stage of the run before the current one, and `barsInStage` the bars with a stage in the
 * current run, `null` when the run reaches the first bar of the window (or of the series).
 * The stage values themselves come from the whole series: the moving averages need the bars
 * before the window.
 */
export function cycleHistory(
    stages: readonly (number | null)[],
    lookback: number
): CycleHistory {
    const window = stages.slice(-lookback);
    const runs = window.reduce<
        { stage: number; bars: number; first: number }[]
    >((acc, stage, i) => {
        if (stage === null) return acc;
        const last = acc[acc.length - 1];
        return last !== undefined && last.stage === stage
            ? [...acc.slice(0, -1), { ...last, bars: last.bars + 1 }]
            : [...acc, { stage, bars: 1, first: i }];
    }, []);
    const current = window.length === 0 ? null : window[window.length - 1];
    const run = current === null ? undefined : runs[runs.length - 1];
    const previous =
        current === null ? null : (runs[runs.length - 2]?.stage ?? null);
    const step =
        current === null || previous === null
            ? 0
            : (((current - previous) % 6) + 6) % 6;
    return {
        stage: current,
        previousStage: previous,
        barsInStage: run === undefined || run.first === 0 ? null : run.bars,
        progression: step === 1 ? 'forward' : step === 5 ? 'reverse' : null,
        stageChanges: Math.max(0, runs.length - 1),
    };
}

// ─── Observed cards ───────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

const asRec = (value: unknown): Rec | null =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value))
        : null;

const asStr = (value: unknown): string | null =>
    typeof value === 'string' ? value : null;

const asNumOrNull = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

export interface ObservedIndicatorCard {
    name: string | null;
    kind: string | null;
    state: string | null;
    trend: string | null;
    /** `null` when the card has no reading (an old row shape or a malformed card). */
    values: Readonly<Record<string, number | null>> | null;
}

/**
 * Structural read of the cards (core-0 shim). The cards do not exist on main, so the shapes of
 * WP-16 §3.5 are read from `unknown`; core-2 adds typed `@internal` fields
 * (`indicatorCards`, `cycleCards`, `Skill.computedCard`) and replaces this read and the
 * `Reflect.get` calls of the renderer with a typed switch, pinned by a test.
 */
export function readIndicatorCards(raw: unknown): ObservedIndicatorCard[] {
    return (Array.isArray(raw) ? raw : []).map(entry => {
        const card = asRec(entry);
        const signal = asRec(
            Array.isArray(card?.signals) ? card.signals[0] : null
        );
        const reading = asRec(signal?.reading);
        const values = asRec(reading?.values);
        return {
            name: asStr(card?.indicatorName),
            kind: asStr(reading?.kind),
            state: asStr(reading?.state),
            trend: asStr(signal?.trend),
            values:
                values === null
                    ? null
                    : Object.fromEntries(
                          Object.entries(values).map(([k, v]) => [
                              k,
                              asNumOrNull(v),
                          ])
                      ),
        };
    });
}

export interface ObservedCycleCard {
    name: string | null;
    kind: string | null;
    trend: string | null;
    stage: number | null;
    previousStage: number | null;
    barsInStage: number | null;
    progression: string | null;
    stageChanges: number | null;
    hasCycle: boolean;
}

export function readCycleCards(raw: unknown): ObservedCycleCard[] {
    return (Array.isArray(raw) ? raw : []).map(entry => {
        const card = asRec(entry);
        const cycle = asRec(card?.cycle);
        return {
            name: asStr(card?.strategyName),
            kind: asStr(cycle?.kind),
            trend: asStr(card?.trend),
            stage: asNumOrNull(cycle?.stage),
            previousStage: asNumOrNull(cycle?.previousStage),
            barsInStage: asNumOrNull(cycle?.barsInStage),
            progression: asStr(cycle?.progression),
            stageChanges: asNumOrNull(cycle?.stageChanges),
            hasCycle: cycle !== null,
        };
    });
}

// ─── Checks ───────────────────────────────────────────────────────────────────

/** A tagged skill of the catalog as the checks need it. */
export interface TaggedGuide {
    name: string;
    computedCard: string;
}

export interface IndicatorCardCheck {
    /** One card per injected tagged guide, none for an always-on `N/A` line, none otherwise. */
    cardSet: { expected: number; observed: number; violations: number };
    /** Cards whose values are printed on their kind's own lines and whose state matches. */
    values: {
        cards: number;
        valueMismatches: number;
        stateMismatches: number;
        /** Cards of a kind the instrument has no reader for: neither values nor state are checked. */
        unreadable: number;
    };
    naAlwaysOn: number;
}

/** D5 and D6 on one prompt: `injected` are the tagged guides whose digest the prompt carries. */
export function checkIndicatorCards(input: {
    prompt: string;
    close: number | null;
    injected: readonly TaggedGuide[];
    cards: readonly ObservedIndicatorCard[];
}): IndicatorCardCheck {
    const readOf = (kind: string): PrintedReading | null | undefined =>
        hasReader(kind)
            ? printedKind(input.prompt, kind, input.close)
            : undefined;
    const printed = new Map(
        input.injected.map(guide => [guide.name, readOf(guide.computedCard)])
    );
    // An always-on guide whose source line is N/A (or absent) gets no card.
    const naAlwaysOn = input.injected.filter(
        g => isAlwaysOnKind(g.computedCard) && printed.get(g.name) === null
    );
    const expected = input.injected.filter(g => !naAlwaysOn.includes(g));
    const names = input.cards.map(card => card.name);
    const duplicates = names.length - new Set(names).size;
    const missing = expected.filter(g => !names.includes(g.name)).length;
    const extra = input.cards.filter(
        card => !expected.some(g => g.name === card.name)
    ).length;
    const checked = input.cards.map(card => {
        const guide = expected.find(g => g.name === card.name);
        const reference =
            guide === undefined ? undefined : printed.get(guide.name);
        const readable = reference !== undefined;
        const numbers = new Set(reference?.numbers ?? []);
        return {
            readable,
            valueMismatch:
                card.values === null ||
                (guide !== undefined && card.kind !== guide.computedCard) ||
                (readable &&
                    (reference === null ||
                        Object.values(card.values).some(
                            v => v !== null && !numbers.has(v)
                        ))),
            stateMismatch:
                readable &&
                (reference === null || card.state !== reference.state),
        };
    });
    return {
        cardSet: {
            expected: expected.length,
            observed: input.cards.length,
            violations: duplicates + missing + extra,
        },
        values: {
            cards: input.cards.length,
            valueMismatches: checked.filter(c => c.valueMismatch).length,
            stateMismatches: checked.filter(c => c.stateMismatch).length,
            unreadable: checked.filter(c => !c.readable).length,
        },
        naAlwaysOn: naAlwaysOn.length,
    };
}

export interface CycleCardCheck {
    cards: number;
    /** A card where the printed stage is absent or N/A. */
    withoutPrintedStage: number;
    stageMismatches: number;
    historyMismatches: number;
    trendMismatches: number;
}

/** D8 on one prompt. `closes` are the closes of the bars the prompt saw, oldest first. */
export function checkCycleCards(input: {
    prompt: string;
    closes: readonly number[];
    cards: readonly ObservedCycleCard[];
}): CycleCardCheck {
    const rows = input.cards.map(card => {
        const kind =
            card.kind !== null && isCycleKind(card.kind) ? card.kind : null;
        const printed = kind === null ? null : printedCycle(input.prompt, kind);
        const history =
            kind === null
                ? null
                : cycleHistory(
                      cycleStageSeries(kind, input.closes),
                      C.cards.cycleLookbackBars
                  );
        const stage = printed?.stage ?? null;
        return {
            without: kind === null || stage === null,
            stage: card.stage !== stage,
            history:
                history === null ||
                history.previousStage !== card.previousStage ||
                history.barsInStage !== card.barsInStage ||
                history.progression !== card.progression ||
                history.stageChanges !== card.stageChanges,
            trend: stage === null || card.trend !== STAGE_TREND[stage],
        };
    });
    return {
        cards: rows.length,
        withoutPrintedStage: rows.filter(r => r.without).length,
        stageMismatches: rows.filter(r => !r.without && r.stage).length,
        historyMismatches: rows.filter(r => !r.without && r.history).length,
        trendMismatches: rows.filter(r => !r.without && r.trend).length,
    };
}
