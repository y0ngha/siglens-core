/**
 * Pure parts of the analysis-fields evaluation shared by every mode, and the whole `trend`
 * mode: the indicator series, the three trend rules recomputed from OHLC, the statistics of
 * a label series and the comparison with stored labels. No I/O, no clock, no core call.
 *
 * Everything here is deliberately the instrument's own implementation (EMA, Wilder ATR,
 * the rules): a bug in the function under test must not be able to hide behind a reference
 * that calls it.
 */
import { mean, standardError } from './stats';
import { quantile } from '@/domain/outcomes/weekClusterBootstrap';
import {
    EPS,
    FIELDS_EVAL_CONSTANTS as C,
    TREND_LABELS,
    type AgreementStats,
    type GateResult,
    type Interval,
    type OppositeWords,
    type RuleName,
    type RuleVsStored,
    type SeriesStats,
    type Share,
    type StoredLabelStats,
    type StoredTrendRow,
    type SymbolBars,
    type TrendLabel,
    type TrendPlumbing,
    type TrendSummary,
} from './analysisFieldsEvalTypes';

// ─── Small shared helpers ─────────────────────────────────────────────────────

/** A record over the three rules, built key by key so its type needs no cast. */
export function byRule<V>(make: (rule: RuleName) => V): Record<RuleName, V> {
    return { R4: make('R4'), R1: make('R1'), R3: make('R3') };
}

export function share(count: number, n: number): Share {
    return { count, n, share: n === 0 ? null : count / n };
}

/** `YYYY-MM-DD` (UTC) of a bar stamped in seconds. */
export function dayOf(timeSeconds: number): string {
    return new Date(timeSeconds * 1000).toISOString().slice(0, 10);
}

/** Rounds half away from zero to `decimals` places. */
export function roundHalfAwayFromZero(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}

/**
 * Mean and normal-approximation 95% interval of a list of (paired) values. `low` and
 * `high` are `null` below two values: an interval that cannot be computed is not a pass.
 */
export function intervalOf(values: readonly number[]): Interval {
    const m = mean(values);
    const se = standardError(values);
    return {
        n: values.length,
        mean: m,
        low: m === null || se === null ? null : m - C.ciZ * se,
        high: m === null || se === null ? null : m + C.ciZ * se,
    };
}

/** Items by key, in first-seen order (`Map.groupBy` is ES2024; the compile target is ES2023). */
export function groupBy<T>(
    items: readonly T[],
    keyOf: (item: T) => string
): Map<string, T[]> {
    // CP-5: a local accumulator filled in one pass.
    const groups = new Map<string, T[]>();
    items.forEach(item => {
        const key = keyOf(item);
        const group = groups.get(key);
        if (group === undefined) groups.set(key, [item]);
        else group.push(item);
    });
    return groups;
}

export function median(values: readonly number[]): number | null {
    return quantile(values, 0.5);
}

export interface Quantiles {
    n: number;
    p10: number | null;
    p25: number | null;
    p50: number | null;
    p75: number | null;
    p90: number | null;
    mean: number | null;
}

export function quantilesOf(values: readonly number[]): Quantiles {
    return {
        n: values.length,
        p10: quantile(values, 0.1),
        p25: quantile(values, 0.25),
        p50: quantile(values, 0.5),
        p75: quantile(values, 0.75),
        p90: quantile(values, 0.9),
        mean: mean(values),
    };
}

/** Counts of each distinct key. */
export function countBy<T>(
    items: readonly T[],
    keyOf: (item: T) => string
): Record<string, number> {
    return items.reduce<Record<string, number>>((counts, item) => {
        const key = keyOf(item);
        return { ...counts, [key]: (counts[key] ?? 0) + 1 };
    }, {});
}

// ─── Indicator series ─────────────────────────────────────────────────────────

/** EMA seeded with the simple average of the first `period` values; `null` before it. */
export function emaSeries(
    values: readonly number[],
    period: number
): (number | null)[] {
    const out: (number | null)[] = values.map(() => null);
    if (values.length < period) return out;
    const k = 2 / (period + 1);
    out[period - 1] =
        values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
    // CP-5: each EMA value depends on the previous one.
    for (let i = period; i < values.length; i++) {
        out[i] = values[i] * k + (out[i - 1] ?? 0) * (1 - k);
    }
    return out;
}

/**
 * Wilder ATR: the first value (at index `period`) is the mean of the first `period` true
 * ranges, then `(prev * (period - 1) + tr) / period`.
 */
export function wilderAtrSeries(
    bars: readonly { high: number; low: number; close: number }[],
    period: number
): (number | null)[] {
    if (bars.length <= period) return bars.map(() => null);
    const tr = bars.map((bar, i) =>
        i === 0
            ? 0
            : Math.max(
                  bar.high - bar.low,
                  Math.abs(bar.high - bars[i - 1].close),
                  Math.abs(bar.low - bars[i - 1].close)
              )
    );
    const out: (number | null)[] = bars.map(() => null);
    out[period] =
        tr.slice(1, period + 1).reduce((sum, v) => sum + v, 0) / period;
    // CP-5: Wilder smoothing depends on the previous ATR.
    for (let i = period + 1; i < bars.length; i++) {
        const prev = out[i - 1] ?? 0;
        out[i] = (prev * (period - 1) + tr[i]) / period;
    }
    return out;
}

/** Prefix sums so a simple average over any window is O(1). */
function prefixSums(values: readonly number[]): readonly number[] {
    // CP-5: each prefix sum extends the previous one.
    const sums = [0];
    values.forEach((v, i) => {
        sums.push(sums[i] + v);
    });
    return sums;
}

function smaAt(
    sums: readonly number[],
    i: number,
    period: number
): number | null {
    return i + 1 < period
        ? null
        : (sums[i + 1] - sums[i + 1 - period]) / period;
}

// ─── The rules ────────────────────────────────────────────────────────────────

const SECONDS_PER_DAY = 86_400;

const isUsable = (value: number | null): value is number =>
    value !== null && Number.isFinite(value);

/** The slope of the shipped rule in ATR, rounded as the rule rounds it; `null` when not measurable. */
export function slopeAtrAt(
    closes: readonly number[],
    ema: readonly (number | null)[],
    atr: readonly (number | null)[],
    i: number
): number | null {
    const now = ema[i];
    const before =
        i - C.trendSlopeLookback >= 0 ? ema[i - C.trendSlopeLookback] : null;
    const range = atr[i];
    const close = closes[i];
    if (!isUsable(now) || !isUsable(before)) return null;
    if (!isUsable(range) || range <= 0) return null;
    if (!Number.isFinite(close) || close <= 0) return null;
    return roundHalfAwayFromZero((now - before) / range, C.slopeDecimals);
}

/** R4, the shipped rule (WP-15 §2.1): inclusive on the slope, strict on the close. */
export function classifyR4(
    closes: readonly number[],
    ema: readonly (number | null)[],
    atr: readonly (number | null)[],
    i: number
): TrendLabel | null {
    const slope = slopeAtrAt(closes, ema, atr, i);
    const now = ema[i];
    if (slope === null || now === null) return null;
    if (slope >= C.trendSlopeMinAtr && closes[i] > now) return 'bullish';
    if (slope <= -C.trendSlopeMinAtr && closes[i] < now) return 'bearish';
    return 'neutral';
}

/** R3: the existing percent rule (`classifyTrend`), as a reference. */
export function classifyR3(
    closes: readonly number[],
    ema: readonly (number | null)[],
    i: number
): TrendLabel | null {
    const now = ema[i];
    const before =
        i - C.trendSlopeLookback >= 0 ? ema[i - C.trendSlopeLookback] : null;
    if (!isUsable(now) || !isUsable(before) || before === 0) return null;
    const slope = (now - before) / before;
    if (slope >= C.percentRuleSlopeMin && closes[i] > now) return 'bullish';
    if (slope <= -C.percentRuleSlopeMin && closes[i] < now) return 'bearish';
    return 'neutral';
}

/** R1: the audit's 3-line rule, as a reference. */
export function classifyR1(
    closes: readonly number[],
    sums: readonly number[],
    i: number
): TrendLabel | null {
    const slow = smaAt(sums, i, C.auditRuleSmaSlow);
    const slowBefore =
        i - C.auditRuleSlopeBars >= 0
            ? smaAt(sums, i - C.auditRuleSlopeBars, C.auditRuleSmaSlow)
            : null;
    const fast = smaAt(sums, i, C.auditRuleSmaFast);
    if (slow === null || slowBefore === null || fast === null) return null;
    if (closes[i] > slow && fast > slow && slow > slowBefore) return 'bullish';
    if (closes[i] < slow && fast < slow && slow < slowBefore) return 'bearish';
    return 'neutral';
}

export type RuleSeries = Record<RuleName, readonly (TrendLabel | null)[]>;

/** The three rules at every bar of `bars`. */
export function ruleSeries(
    bars: readonly { high: number; low: number; close: number }[]
): {
    labels: RuleSeries;
    closes: readonly number[];
    slope: readonly (number | null)[];
} {
    const closes = bars.map(bar => bar.close);
    const ema = emaSeries(closes, C.trendEmaPeriod);
    const atr = wilderAtrSeries(bars, C.atrPeriod);
    const sums = prefixSums(closes);
    const indices = closes.map((_, i) => i);
    return {
        closes,
        slope: indices.map(i => slopeAtrAt(closes, ema, atr, i)),
        labels: {
            R4: indices.map(i => classifyR4(closes, ema, atr, i)),
            R1: indices.map(i => classifyR1(closes, sums, i)),
            R3: indices.map(i => classifyR3(closes, ema, i)),
        },
    };
}

// ─── Statistics of a label series ─────────────────────────────────────────────

interface SeriesCounts {
    n: number;
    distribution: Record<TrendLabel, number>;
    changePairs: number;
    changed: number;
    hard: number;
    priorN: number;
    priorMatch: number;
}

const EMPTY_COUNTS: SeriesCounts = {
    n: 0,
    distribution: { bullish: 0, bearish: 0, neutral: 0 },
    changePairs: 0,
    changed: 0,
    hard: 0,
    priorN: 0,
    priorMatch: 0,
};

const isHardFlip = (a: TrendLabel, b: TrendLabel): boolean =>
    (a === 'bullish' && b === 'bearish') ||
    (a === 'bearish' && b === 'bullish');

/** Counts of one label series over bars `from` to the end. */
function countSeries(
    labels: readonly (TrendLabel | null)[],
    closes: readonly number[],
    from: number
): SeriesCounts {
    const counts = {
        ...EMPTY_COUNTS,
        distribution: { ...EMPTY_COUNTS.distribution },
    };
    // CP-5: one pass; each day compares with the previous label and updates several counters.
    for (let i = from; i < labels.length; i++) {
        const label = labels[i];
        if (label === null) continue;
        counts.n += 1;
        counts.distribution[label] += 1;
        const prev = i > from ? labels[i - 1] : null;
        if (prev !== null) {
            counts.changePairs += 1;
            if (prev !== label) counts.changed += 1;
            if (isHardFlip(prev, label)) counts.hard += 1;
        }
        if (label !== 'neutral' && i >= C.priorSignBars) {
            counts.priorN += 1;
            if (
                closes[i] > closes[i - C.priorSignBars] ===
                (label === 'bullish')
            ) {
                counts.priorMatch += 1;
            }
        }
    }
    return counts;
}

function addCounts(a: SeriesCounts, b: SeriesCounts): SeriesCounts {
    return {
        n: a.n + b.n,
        distribution: {
            bullish: a.distribution.bullish + b.distribution.bullish,
            bearish: a.distribution.bearish + b.distribution.bearish,
            neutral: a.distribution.neutral + b.distribution.neutral,
        },
        changePairs: a.changePairs + b.changePairs,
        changed: a.changed + b.changed,
        hard: a.hard + b.hard,
        priorN: a.priorN + b.priorN,
        priorMatch: a.priorMatch + b.priorMatch,
    };
}

function distributionOf(
    counts: Record<TrendLabel, number>,
    n: number
): Record<TrendLabel, Share> {
    return {
        bullish: share(counts.bullish, n),
        bearish: share(counts.bearish, n),
        neutral: share(counts.neutral, n),
    };
}

function statsOf(counts: SeriesCounts): SeriesStats {
    return {
        n: counts.n,
        distribution: distributionOf(counts.distribution, counts.n),
        dayToDayChange: share(counts.changed, counts.changePairs),
        hardFlip: share(counts.hard, counts.changePairs),
        priorSignMatch: share(counts.priorMatch, counts.priorN),
    };
}

/**
 * Every day from `C.allDaysFromBar` on, every symbol pooled: label distribution,
 * day-to-day change, hard flips and the prior-N-day sign match, per rule.
 */
export function allDaysStats(
    symbols: readonly SymbolBars[]
): Record<RuleName, SeriesStats> {
    const perSymbol = symbols.map(s => ruleSeries(s.bars));
    return byRule(rule =>
        statsOf(
            perSymbol.reduce(
                (sum, series) =>
                    addCounts(
                        sum,
                        countSeries(
                            series.labels[rule],
                            series.closes,
                            C.allDaysFromBar
                        )
                    ),
                EMPTY_COUNTS
            )
        )
    );
}

// ─── Stored labels against the rules ──────────────────────────────────────────

export interface LocatedRow<R extends StoredTrendRow = StoredTrendRow> {
    row: R;
    /** Index of the labelled bar in the symbol's bars. */
    index: number;
}

/** Locates every row on its symbol's bars by date; rows without a bar are returned apart. */
export function locateRows<R extends StoredTrendRow>(
    symbols: readonly SymbolBars[],
    rows: readonly R[]
): { located: readonly LocatedRow<R>[]; missing: readonly R[] } {
    const indexBy = new Map(
        symbols.map(s => [
            s.symbol,
            new Map(s.bars.map((bar, i) => [dayOf(bar.time), i])),
        ])
    );
    const resolved = rows.map(row => ({
        row,
        index: indexBy.get(row.symbol)?.get(row.date),
    }));
    return {
        located: resolved.flatMap(({ row, index }) =>
            index === undefined ? [] : [{ row, index }]
        ),
        missing: resolved.flatMap(({ row, index }) =>
            index === undefined ? [row] : []
        ),
    };
}

export interface RowRules {
    labels: Record<RuleName, TrendLabel>;
    slopeAtr: number | null;
}

/**
 * The rules at one labelled bar, computed on the bars a replay prompt saw: the bars from
 * `lookbackDays` calendar days back up to the labelled one (the stored provider ignores the
 * bar-count limit and cuts by date, which gives 485 to 506 daily bars); `null` when any rule cannot be measured
 * there or the bar is too early to compare against.
 */
export function rulesAtRow(
    bars: SymbolBars['bars'],
    index: number,
    lookbackDays: number
): RowRules | null {
    if (index < C.minBarsForStoredLabel) return null;
    const first = bars[index].time - (lookbackDays - 1) * SECONDS_PER_DAY;
    const start = bars.findIndex(bar => bar.time >= first);
    const cut = bars.slice(start, index + 1);
    const series = ruleSeries(cut);
    const last = cut.length - 1;
    const [r4, r1, r3] = [
        series.labels.R4[last],
        series.labels.R1[last],
        series.labels.R3[last],
    ];
    return r4 === null || r1 === null || r3 === null
        ? null
        : { labels: { R4: r4, R1: r1, R3: r3 }, slopeAtr: series.slope[last] };
}

function agreementOf(
    pairs: readonly { stored: TrendLabel; rule: TrendLabel }[]
): AgreementStats {
    return {
        n: pairs.length,
        agree: share(
            pairs.filter(p => p.stored === p.rule).length,
            pairs.length
        ),
        opposite: share(
            pairs.filter(p => isHardFlip(p.stored, p.rule)).length,
            pairs.length
        ),
        confusion: countBy(pairs, p => `${p.stored}>${p.rule}`),
    };
}

function groupAgreement(
    items: readonly { key: string; stored: TrendLabel; rule: TrendLabel }[]
): Record<string, AgreementStats> {
    const keys = [...new Set(items.map(item => item.key))].toSorted();
    return Object.fromEntries(
        keys.map(key => [key, agreementOf(items.filter(i => i.key === key))])
    );
}

interface MeasuredRow {
    row: StoredTrendRow;
    index: number;
    rules: RowRules;
}

/**
 * Consecutive labelled bars of one symbol that are at most `maxPairGapBars` bars apart (a
 * date labelled twice keeps the last label). A run's cases are years apart, so it has none:
 * day-to-day change is a measure of labels made nearly every session, such as a daily-AI
 * `decisions.csv` (which skips some sessions).
 */
function consecutivePairs(
    measured: readonly MeasuredRow[]
): readonly { before: MeasuredRow; after: MeasuredRow }[] {
    const bySymbol = groupBy(measured, m => m.row.symbol);
    return [...bySymbol.values()].flatMap(items => {
        const byIndex = new Map(items.map(m => [m.index, m]));
        const indices = [...byIndex.keys()].toSorted((a, b) => a - b);
        return indices.slice(1).flatMap((index, k) => {
            const before = byIndex.get(indices[k]);
            const after = byIndex.get(index);
            return before === undefined ||
                after === undefined ||
                index - indices[k] > C.maxPairGapBars
                ? []
                : [{ before, after }];
        });
    });
}

/** One rule's day-to-day change and hard flips on the consecutive labelled bars. */
function ruleChangeOnStoredDates(
    measured: readonly MeasuredRow[],
    rule: RuleName
): { change: Share; hard: Share } {
    const pairs = consecutivePairs(measured);
    return {
        change: share(
            pairs.filter(
                p => p.before.rules.labels[rule] !== p.after.rules.labels[rule]
            ).length,
            pairs.length
        ),
        hard: share(
            pairs.filter(p =>
                isHardFlip(
                    p.before.rules.labels[rule],
                    p.after.rules.labels[rule]
                )
            ).length,
            pairs.length
        ),
    };
}

/** The stored label's own day-to-day change on the consecutive labelled bars. */
function storedChange(measured: readonly MeasuredRow[]): {
    change: Share;
    hard: Share;
} {
    const pairs = consecutivePairs(measured);
    return {
        change: share(
            pairs.filter(p => p.before.row.stored !== p.after.row.stored)
                .length,
            pairs.length
        ),
        hard: share(
            pairs.filter(p =>
                isHardFlip(p.before.row.stored, p.after.row.stored)
            ).length,
            pairs.length
        ),
    };
}

/** Stored labels against every rule; rows the rules cannot be measured at are counted apart. */
export function storedLabelStats(
    symbols: readonly SymbolBars[],
    located: readonly LocatedRow[],
    lookbackDays: number
): StoredLabelStats {
    const barsOf = new Map(symbols.map(s => [s.symbol, s.bars]));
    const all = located.map(({ row, index }) => ({
        row,
        index,
        rules: rulesAtRow(barsOf.get(row.symbol) ?? [], index, lookbackDays),
    }));
    const measured = all.flatMap(({ row, index, rules }) =>
        rules === null ? [] : [{ row, index, rules }]
    );
    const stored = storedChange(measured);
    const storedCounts = countBy(measured, m => m.row.stored);
    return {
        n: measured.length,
        unmeasured: all.length - measured.length,
        distribution: distributionOf(
            {
                bullish: storedCounts.bullish ?? 0,
                bearish: storedCounts.bearish ?? 0,
                neutral: storedCounts.neutral ?? 0,
            },
            measured.length
        ),
        dayToDayChange: stored.change,
        hardFlip: stored.hard,
        rules: byRule(rule => {
            const pairs = measured.map(m => ({
                stored: m.row.stored,
                rule: m.rules.labels[rule],
            }));
            const regimed = measured.flatMap(m =>
                m.row.regime === null
                    ? []
                    : [
                          {
                              key: m.row.regime,
                              stored: m.row.stored,
                              rule: m.rules.labels[rule],
                          },
                      ]
            );
            const rowStats: RuleVsStored = {
                ...agreementOf(pairs),
                byRegime: groupAgreement(regimed),
                byMarket: groupAgreement(
                    measured.map(m => ({
                        key: m.row.market,
                        stored: m.row.stored,
                        rule: m.rules.labels[rule],
                    }))
                ),
                ...(() => {
                    const onDates = ruleChangeOnStoredDates(measured, rule);
                    return {
                        ruleDayToDayChange: onDates.change,
                        ruleHardFlip: onDates.hard,
                    };
                })(),
            };
            return rowStats;
        }),
    };
}

/** Maximum mismatches listed in the summary (the count is always complete). */
const MAX_LISTED_MISMATCHES = 20;

/** The stored `trend` (and `trendBasis`) of a run against the recomputed shipped rule. */
export function trendPlumbing(
    symbols: readonly SymbolBars[],
    located: readonly LocatedRow<StoredTrendRow & { caseId: string }>[],
    lookbackDays: number,
    total: number
): TrendPlumbing {
    const barsOf = new Map(symbols.map(s => [s.symbol, s.bars]));
    const measured = located.flatMap(({ row, index }) => {
        const rules = rulesAtRow(
            barsOf.get(row.symbol) ?? [],
            index,
            lookbackDays
        );
        return rules === null ? [] : [{ row, caseId: row.caseId, rules }];
    });
    const mismatched = measured.filter(m => m.row.stored !== m.rules.labels.R4);
    const withBasis = measured.filter(m => m.row.trendBasisSlope !== null);
    return {
        total,
        n: measured.length,
        equal: measured.length - mismatched.length,
        mismatches: mismatched.slice(0, MAX_LISTED_MISMATCHES).map(m => ({
            caseId: m.caseId,
            stored: m.row.stored,
            rule: m.rules.labels.R4,
        })),
        basis: {
            present: withBasis.length,
            slopeMatches: withBasis.filter(
                m =>
                    m.rules.slopeAtr !== null &&
                    m.row.trendBasisSlope !== null &&
                    Math.abs(m.rules.slopeAtr - m.row.trendBasisSlope) <=
                        0.005 + 1e-9
            ).length,
        },
    };
}

// ─── Summary words (T5) ───────────────────────────────────────────────────────

const UP_WORDS = /상승 추세|강세|상승세/;
const DOWN_WORDS = /하락 추세|약세|하락세/;

/** First paragraph of a summary (paragraphs are separated by a blank line). */
export function firstParagraph(summary: string): string {
    return summary.trim().split(/\n\s*\n/)[0];
}

/** `true` when the paragraph uses only the direction opposite to `label`'s words. */
export function usesOnlyOppositeWords(
    paragraph: string,
    label: TrendLabel
): boolean {
    const up = UP_WORDS.test(paragraph);
    const down = DOWN_WORDS.test(paragraph);
    if (label === 'bullish') return down && !up;
    if (label === 'bearish') return up && !down;
    return false;
}

export function oppositeWordsOf(
    rows: readonly StoredTrendRow[]
): OppositeWords | null {
    const withSummary = rows.flatMap(row =>
        row.summary === null ? [] : [{ row, summary: row.summary }]
    );
    if (withSummary.length === 0) return null;
    return {
        n: withSummary.length,
        opposite: share(
            withSummary.filter(({ row, summary }) =>
                usesOnlyOppositeWords(firstParagraph(summary), row.stored)
            ).length,
            withSummary.length
        ),
    };
}

// ─── The trend summary and its gates ──────────────────────────────────────────

export interface TrendInput {
    symbols: readonly SymbolBars[];
    /** Stored labels already located; `null` when the run has none (bars only). */
    located: readonly LocatedRow<StoredTrendRow & { caseId: string }>[] | null;
    /** Rows of a run (for the plumbing check and the summary words), else `false`. */
    fromRun: boolean;
    /** First-repeat results of the run (the denominator of the plumbing check). */
    resultsTotal?: number;
    lookbackDays: number;
}

export function summarizeTrend(input: TrendInput): TrendSummary {
    const allDays = allDaysStats(input.symbols);
    if (allDays.R4.n === 0) {
        throw new Error(
            `no bar from index ${C.allDaysFromBar} to measure: the evaluation needs symbols with more bars`
        );
    }
    const located = input.located;
    const stored =
        located === null
            ? null
            : storedLabelStats(input.symbols, located, input.lookbackDays);
    if (stored !== null && stored.n === 0) {
        throw new Error(
            'no stored label could be compared with the rule (every row is too early or unmeasurable)'
        );
    }
    return {
        allDays: { fromBar: C.allDaysFromBar, rules: allDays },
        stored,
        plumbing:
            located !== null && input.fromRun
                ? trendPlumbing(
                      input.symbols,
                      located,
                      input.lookbackDays,
                      input.resultsTotal ?? located.length
                  )
                : null,
        oppositeWords:
            located !== null && input.fromRun
                ? oppositeWordsOf(located.map(l => l.row))
                : null,
    };
}

const gate = (
    id: string,
    description: string,
    pass: boolean | null,
    value: number | string | null,
    threshold: string
): GateResult => ({ id, description, pass, value, threshold });

const percent = (value: number | null): string =>
    value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`;

/** T1 to T5 (WP-15 §7.3). A gate the input cannot decide is `pass: null`. */
export function trendGates(
    summary: TrendSummary,
    options: { labelsFile: boolean } = { labelsFile: false }
): readonly GateResult[] {
    const g = C.gates;
    const r4 = summary.allDays.rules.R4;
    const change = r4.dayToDayChange.share;
    const hard = r4.hardFlip.share;
    const onStored = summary.stored?.rules.R4.ruleDayToDayChange.share ?? null;
    const storedRule = summary.stored?.rules.R4;
    const onStoredHard = storedRule?.ruleHardFlip.share ?? null;
    // A labels file is meant to be daily labels: no consecutive pair means the stored-date
    // half of T2 could not be measured. A run's cases are sparse by design and have none.
    const storedUnmeasured =
        options.labelsFile && (storedRule?.ruleDayToDayChange.n ?? 0) === 0;
    const t2Values = [change, onStored].filter((v): v is number => v !== null);
    const t2Hard = [hard, onStoredHard].filter((v): v is number => v !== null);
    const opposite = summary.stored?.rules.R4.opposite.share ?? null;
    const shares = TREND_LABELS.map(l => r4.distribution[l].share);
    const plumbing = summary.plumbing;
    return [
        gate(
            'T1',
            'recomputed rule equals the stored label on every result, and the stored trendBasis slope matches',
            plumbing === null
                ? null
                : plumbing.total > 0 &&
                      plumbing.equal === plumbing.total &&
                      plumbing.basis.slopeMatches === plumbing.basis.present,
            plumbing === null
                ? null
                : `${plumbing.equal}/${plumbing.total} results (excluded ${plumbing.total - plumbing.n}), trendBasis ${plumbing.basis.slopeMatches}/${plumbing.basis.present}`,
            '100% of results, every trendBasis slope'
        ),
        gate(
            'T2',
            'rule day-to-day change and hard flips (all days, and on the stored dates)',
            change === null || hard === null || storedUnmeasured
                ? null
                : t2Values.every(v => v <= g.trendMaxDayChange + EPS) &&
                      t2Hard.every(v => v <= g.trendMaxHardFlip + EPS),
            `change ${percent(change)}${onStored === null ? '' : `, on stored dates ${percent(onStored)}`}, hard ${percent(hard)}${onStoredHard === null ? '' : `, on stored dates ${percent(onStoredHard)}`}${storedUnmeasured ? ' (no consecutive stored labels)' : ''}`,
            `change <= ${g.trendMaxDayChange * 100}%, hard flips <= ${g.trendMaxHardFlip * 100}%`
        ),
        gate(
            'T3',
            'rule opposite to the stored label',
            opposite === null ? null : opposite <= g.trendMaxOpposite + EPS,
            percent(opposite),
            `<= ${g.trendMaxOpposite * 100}%`
        ),
        gate(
            'T4',
            'each label share of all days',
            shares.some(s => s === null)
                ? null
                : shares.every(
                      s =>
                          s !== null &&
                          s >= g.trendMinLabelShare - EPS &&
                          s <= g.trendMaxLabelShare + EPS
                  ),
            TREND_LABELS.map(
                l => `${l} ${percent(r4.distribution[l].share)}`
            ).join(', '),
            `each between ${g.trendMinLabelShare * 100}% and ${g.trendMaxLabelShare * 100}%`
        ),
        gate(
            'T5',
            'summaries whose first paragraph uses only the opposite direction words (live)',
            summary.oppositeWords === null
                ? null
                : (summary.oppositeWords.opposite.share ?? 1) <=
                      g.trendMaxOppositeWords + EPS,
            summary.oppositeWords === null
                ? null
                : `${summary.oppositeWords.opposite.count}/${summary.oppositeWords.n}`,
            `<= ${g.trendMaxOppositeWords * 100}%`
        ),
    ];
}

/** A gate list fails when any gate is `pass: false`. */
export function anyGateFailed(gates: readonly GateResult[]): boolean {
    return gates.some(g => g.pass === false);
}
