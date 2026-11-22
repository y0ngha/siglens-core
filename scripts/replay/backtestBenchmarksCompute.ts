/**
 * The pure part of the backtest benchmark instrument (WP-26 core-1): exposure-matched hold,
 * mark-to-market drawdown, per-trade excess over the same-length drift, the random-entry
 * placebo and the bracket placebo of one backtest run. No I/O, no clock; everything random
 * is a pure function of a seed constant and a key.
 *
 * Pre-registered definitions (a change bumps `BENCHMARK_CONSTANTS.version`):
 *
 * - Period: the run period; the bars of a ticker inside it are its daily closes. Exposure of
 *   a ticker = sum of `holdingDays` / trading days of the period. Trades of one ticker must
 *   not overlap (one account per ticker).
 * - Length of a trade: the index span `exitIdx - entryIdx` of its dates on the period's bars,
 *   which must equal the stored `holdingDays` (a mismatch exits 2). The same length is the
 *   exposure days, the drift horizon and the placebo hold. A 0-day trade (entered and left on
 *   one bar) has 0 exposure days, a drift of 0 and a 0-day placebo hold; there is no `max(1, .)`.
 * - Hold portfolio: every ticker bought on the first day and held, equal weight, no
 *   rebalancing, valued on daily closes. Exposure-matched hold: each ticker holds for its own
 *   exposure `e` and cash (0% return) for the rest, `(1 - e) + e * close / firstClose`, then
 *   the same equal-weight mean.
 * - Strategy account of one ticker, daily: closed trades compound at their stored `returnPct`
 *   on the exit day (the stats view's definition); the mark-to-market curve values the open
 *   trade at the day's close for the legs still open and at the exit price for the legs that
 *   already exited. Drawdowns start the peak at 1 (the capital before the first day).
 * - Same-length drift of a trade: the mean over every start day `j` of the period of
 *   `close[j + h] / close[j] - 1`, `h` the length above. Excess = trade return - drift.
 *   Interval: week-cluster bootstrap on the ISO week of the entry date, percentile 95%.
 * - Random entry: per ticker the multiset of holding lengths `h`, shuffled (Fisher-Yates),
 *   placed non-overlapping at uniformly random gaps (stars and bars), close to close; the
 *   portfolio is built the way the strategy's is (equal-weight mean of the sleeves).
 * - Bracket: the trades whose first half ended at `tp1` or `sl1`. The race is the
 *   simulator's own (README step 7): a gap fills at the open, the stop is tested before the
 *   target on every bar so a bar touching both counts as the stop, at most `holdLimitBars`
 *   bars. The placebo takes `bracketPicksPerTrade` random decision days of the same ticker,
 *   enters at that close and applies the trade's own relative `tp1` and `sl1` distances.
 *   Placebo races that do not resolve within the limit are left out of the share.
 *   The comparable pair is the re-race of the real trades' FIXED initial levels from their
 *   real entry against the placebo (same race rule, same fixed levels). The stored first-half
 *   exits are kept as `storedTargetFirstShare` only: they include the AI's plan updates during
 *   holding reviews, which only the initial plan can be replayed without. A re-race that
 *   disagrees with the stored first half exits 2 only when the trade had no holding review (the
 *   plan could not have moved); with reviews it is counted in `diagnostics.bracket.reRace`
 *   (the run's counts are in `scripts/replay/README.md`). A market entry (not `wait_limit`)
 *   must have `entryPrice` equal to its entry bar's close, and the real race starts on the next
 *   bar; a limit fill tests its entry bar by range while a placebo enters at the close, so the
 *   pair differs by that one bar.
 */
import type {
    BacktestBenchmarks,
    BacktestDistribution,
    BacktestTrade,
    Bar,
} from '@/domain/types';
import {
    aggregateByWeek,
    intervalOf,
    isoDate,
    isoWeekKey,
    sampleWithoutReplacement,
    streamForKey,
} from './engineEvalStats';
import {
    mulberry32,
    resampleMultiplicities,
    resampledMean,
} from '@/domain/outcomes/weekClusterBootstrap';
import { mean } from './stats';
import { quantile } from '@/domain/outcomes/weekClusterBootstrap';

/** Pre-registered constants. A change to any of them bumps `version`. */
export const BENCHMARK_CONSTANTS = {
    version: 1,
    bootstrapResamples: 10_000,
    bootstrapSeed: 0x26c1a001,
    randomEntryDraws: 2_000,
    randomEntrySeed: 0x26c1b002,
    bracketSeed: 0x26c1c003,
    bracketPicksPerTrade: 3,
    holdLimitBars: 60,
    /** The strategy return from stored trade returns and from the legs may differ by this much (pp). */
    legReturnTolerancePp: 0.01,
    /** One trade's stored return and its legs' implied return may differ by 0.01 pp plus the 0.005 pp rounding of a stored 2-decimal return. */
    tradeLegTolerancePp: 0.015,
    /** A market entry's stored price equals its entry bar's close up to the half-cent rounding of a stored price. */
    entryPriceTolerance: 0.005 + 1e-9,
    /** Baseline figures are stored rounded to two decimals; the bars must reproduce them to this. */
    baselineToleranceUnits: 0.005 + 1e-9,
} as const;

/** A refusal the CLI reports with exit code 2 (TE-16): the result is not computable or not comparable. */
export class FailClosedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FailClosedError';
    }
}

/** The fields of a stored trade the instrument reads. */
export type BenchmarkTrade = Pick<
    BacktestTrade,
    | 'ticker'
    | 'entryType'
    | 'decisionDate'
    | 'entryDate'
    | 'entryPrice'
    | 'exitDate'
    | 'holdingDays'
    | 'returnPct'
    | 'legs'
    | 'initialPlan'
    | 'holdingReviews'
>;

export interface BenchmarkBaseline {
    readonly ticker: string;
    readonly buyHoldPct: number;
    readonly buyHoldMaxDrawdownPct: number;
    readonly tradingDays: number;
}

export interface BenchmarkInput {
    readonly run: {
        readonly periodStart: string;
        readonly periodEnd: string;
        readonly tickers: readonly string[];
    };
    readonly baselines: readonly BenchmarkBaseline[];
    readonly trades: readonly BenchmarkTrade[];
    /** Full stored daily bars per ticker, oldest first. */
    readonly bars: Readonly<Record<string, readonly Bar[]>>;
    readonly identity: {
        readonly tradesSha256: string;
        readonly barsFingerprint: string;
        readonly coreSha: string;
    };
}

// ─── Small numeric helpers ────────────────────────────────────────────────────

const round4 = (value: number): number => Number(value.toFixed(4));
const percentOf = (ratio: number): number => (ratio - 1) * 100;
const refuse = (message: string): never => {
    throw new FailClosedError(message);
};

/** Worst fall from a running peak in percent (<= 0); the peak starts at 1, the capital before day one. */
export function maxDrawdownPct(curve: readonly number[]): number {
    const worst = curve.reduce(
        (acc, value) => {
            const peak = Math.max(acc.peak, value);
            return { peak, worst: Math.min(acc.worst, value / peak - 1) };
        },
        { peak: 1, worst: 0 }
    );
    return worst.worst * 100;
}

/** Day-by-day mean of equally long curves (equal-weight sleeves, no rebalancing). */
export function meanCurve(curves: readonly (readonly number[])[]): number[] {
    return curves[0].map((_, day) => mean(curves.map(c => c[day])) ?? 0);
}

/** Running product of daily factors. */
function cumulativeProduct(factors: readonly number[]): number[] {
    const out: number[] = [];
    factors.reduce((running, factor) => {
        const next = running * factor;
        out.push(next);
        return next;
    }, 1);
    return out;
}

const timeOfDate = (date: string): number =>
    Date.parse(`${date}T00:00:00Z`) / 1000;

// ─── Sleeves ──────────────────────────────────────────────────────────────────

/** A trade located on its ticker's period axis (indices into the window). */
export interface PlacedTrade {
    readonly trade: BenchmarkTrade;
    readonly entryIdx: number;
    readonly exitIdx: number;
    readonly legExitIdx: readonly [number, number];
    /** `exitIdx - entryIdx` (equal to the stored `holdingDays`): exposure days, drift horizon and placebo hold. */
    readonly length: number;
}

/** One ticker's period: bars, the window of the run period inside them, its trades. */
export interface Sleeve {
    readonly ticker: string;
    readonly bars: readonly Bar[];
    /** Index of the first and last bar of the period inside `bars`. */
    readonly lo: number;
    readonly hi: number;
    readonly dates: readonly string[];
    readonly closes: readonly number[];
    readonly trades: readonly PlacedTrade[];
}

export function buildSleeve(
    ticker: string,
    bars: readonly Bar[],
    period: { readonly periodStart: string; readonly periodEnd: string },
    trades: readonly BenchmarkTrade[]
): Sleeve {
    const dated = bars.map(bar => isoDate(bar.time));
    const lo = dated.findIndex(d => d >= period.periodStart);
    const hi = dated.findLastIndex(d => d <= period.periodEnd);
    if (lo < 0 || hi < lo + 1) {
        refuse(
            `${ticker}: fewer than two bars inside ${period.periodStart}..${period.periodEnd}`
        );
    }
    const dates = dated.slice(lo, hi + 1);
    const index = new Map(dates.map((date, i) => [date, i]));
    const at = (date: string, what: string): number =>
        index.get(date) ??
        refuse(`${ticker}: ${what} ${date} is not a bar of the period`);
    const placed = trades
        .filter(t => t.ticker === ticker)
        .map((trade): PlacedTrade => {
            const where = `${ticker} ${trade.entryDate}`;
            if (trade.legs.some(leg => leg.reason === 'open')) {
                refuse(
                    `${where}: a leg is still open; the benchmark needs closed trades`
                );
            }
            const entryIdx = at(trade.entryDate, 'entry date');
            const exitIdx = at(trade.exitDate, 'exit date');
            const legExitIdx: [number, number] = [
                at(trade.legs[0].exitDate, 'leg exit date'),
                at(trade.legs[1].exitDate, 'leg exit date'),
            ];
            if (exitIdx < entryIdx) refuse(`${where}: exits before it enters`);
            if (exitIdx - entryIdx !== trade.holdingDays) {
                refuse(
                    `${where}: holdingDays ${trade.holdingDays} but its dates span ${exitIdx - entryIdx} bars`
                );
            }
            const sizes = trade.legs[0].size + trade.legs[1].size;
            if (Math.abs(sizes - 1) > 1e-9) {
                refuse(`${where}: the leg sizes sum to ${sizes}, not 1`);
            }
            const implied =
                trade.legs.reduce(
                    (sum, leg) =>
                        sum + leg.size * (leg.exitPrice / trade.entryPrice - 1),
                    0
                ) * 100;
            if (
                !(
                    Math.abs(implied - trade.returnPct) <=
                    BENCHMARK_CONSTANTS.tradeLegTolerancePp
                )
            ) {
                refuse(
                    `${where}: the stored return ${trade.returnPct}% but its legs imply ${implied.toFixed(4)}%`
                );
            }
            const entryClose = bars[lo + entryIdx].close;
            if (
                trade.entryType !== 'wait_limit' &&
                !(
                    Math.abs(trade.entryPrice - entryClose) <=
                    BENCHMARK_CONSTANTS.entryPriceTolerance
                )
            ) {
                refuse(
                    `${where}: a ${trade.entryType} entry at ${trade.entryPrice} is not the entry bar's close ${entryClose}`
                );
            }
            return {
                trade,
                entryIdx,
                exitIdx,
                legExitIdx,
                length: exitIdx - entryIdx,
            };
        })
        .toSorted((a, b) => a.entryIdx - b.entryIdx);
    placed.slice(1).forEach((current, i) => {
        if (current.entryIdx < placed[i].exitIdx) {
            refuse(
                `${ticker}: trades ${placed[i].trade.entryDate} and ${current.trade.entryDate} overlap`
            );
        }
    });
    return {
        ticker,
        bars,
        lo,
        hi,
        dates,
        closes: bars.slice(lo, hi + 1).map(bar => bar.close),
        trades: placed,
    };
}

export const exposureOf = (sleeve: Sleeve): number =>
    sleeve.trades.reduce((sum, p) => sum + p.trade.holdingDays, 0) /
    sleeve.closes.length;

export const holdCurve = (closes: readonly number[]): number[] =>
    closes.map(close => close / closes[0]);

/** `(1 - e)` in cash and `e` in the ticker, daily valued. */
export const exposureMatchedCurve = (
    closes: readonly number[],
    exposure: number
): number[] => holdCurve(closes).map(v => 1 - exposure + exposure * v);

// ─── The strategy's account ───────────────────────────────────────────────────

export interface StrategyAccount {
    /** Closed trades compounded at their stored `returnPct`, daily. */
    readonly closed: readonly number[];
    /** The same account with the open trade valued at the day's close. */
    readonly markToMarket: readonly number[];
    /** Final value of the account when trades compound at the return their legs imply. */
    readonly finalFromLegs: number;
}

const legReturnFactor = (p: PlacedTrade): number =>
    1 +
    p.trade.legs.reduce(
        (sum, leg) => sum + leg.size * (leg.exitPrice / p.trade.entryPrice - 1),
        0
    );

export function strategyAccount(sleeve: Sleeve): StrategyAccount {
    const days = sleeve.closes.length;
    const exitFactors = Array.from({ length: days }, () => 1);
    sleeve.trades.forEach(p => {
        exitFactors[p.exitIdx] *= 1 + p.trade.returnPct / 100;
    });
    const closed = cumulativeProduct(exitFactors);
    const openAt = new Array<PlacedTrade | null>(days).fill(null);
    sleeve.trades.forEach(p => {
        Array.from({ length: p.exitIdx - p.entryIdx }, (_, k) => k).forEach(
            k => {
                openAt[p.entryIdx + k] = p;
            }
        );
    });
    const markToMarket = closed.map((value, day) => {
        const open = openAt[day];
        if (open === null) return value;
        const legs = open.trade.legs.reduce(
            (sum, leg, i) =>
                sum +
                (leg.size *
                    (open.legExitIdx[i] <= day
                        ? leg.exitPrice
                        : sleeve.closes[day])) /
                    open.trade.entryPrice,
            0
        );
        return value * legs;
    });
    return {
        closed,
        markToMarket,
        finalFromLegs: sleeve.trades.reduce(
            (acc, p) => acc * legReturnFactor(p),
            1
        ),
    };
}

// ─── Per-trade excess over the same-length drift ──────────────────────────────

/** Mean of `close[j + h] / close[j] - 1` over every start day `j` with room for `h` days, in percent. */
export function sameLengthDriftPct(
    closes: readonly number[],
    length: number
): number {
    const starts = closes.length - length;
    if (starts <= 0) {
        return refuse(
            `a ${length}-day hold does not fit the ${closes.length}-day period`
        );
    }
    const total = closes
        .slice(0, starts)
        .reduce((sum, close, j) => sum + (closes[j + length] / close - 1), 0);
    return (total / starts) * 100;
}

export interface ClusterInterval {
    readonly mean: number;
    readonly low: number;
    readonly high: number;
}

/** Mean of `values` with a week-cluster percentile bootstrap interval (95%). */
export function weekClusterInterval(
    values: readonly { readonly week: string; readonly value: number }[],
    resamples: number,
    seed: number
): ClusterInterval {
    const weeks = [...new Set(values.map(v => v.week))].toSorted();
    const aggregate = aggregateByWeek(values, weeks);
    const interval = intervalOf(
        resampleMultiplicities(weeks.length, resamples, mulberry32(seed)).map(
            multiplicity => resampledMean(aggregate, multiplicity)
        )
    );
    const point = mean(values.map(v => v.value));
    if (point === null || interval.low === null || interval.high === null) {
        return refuse('the per-trade interval is not computable');
    }
    return { mean: point, low: interval.low, high: interval.high };
}

// ─── Random-entry placebo ─────────────────────────────────────────────────────

/** `length` days held from close `start` to close `start + length`. */
export interface HoldWindow {
    readonly start: number;
    readonly length: number;
}

/**
 * Places holds of the given lengths in a `days`-bar period without overlap: a Fisher-Yates
 * order of the lengths and uniformly random gaps (n bars among `free + n` slots, sorted),
 * where `free` is the period's spare close-to-close days. Windows are returned in time order.
 */
export function placeHolds(
    lengths: readonly number[],
    days: number,
    rand: () => number
): HoldWindow[] {
    const total = lengths.reduce((sum, v) => sum + v, 0);
    const free = days - 1 - total;
    if (free < 0) {
        return refuse(
            `holding lengths totalling ${total} days do not fit a ${days}-bar period without overlap`
        );
    }
    const order = [...lengths];
    Array.from({ length: Math.max(0, order.length - 1) }, (_, k) => {
        const i = order.length - 1 - k;
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    });
    const bars = sampleWithoutReplacement(
        Array.from({ length: free + order.length }, (_, k) => k),
        order.length,
        rand
    ).toSorted((a, b) => a - b);
    return order.map((length, i) => ({
        start: bars[i] - i + order.slice(0, i).reduce((sum, v) => sum + v, 0),
        length,
    }));
}

/** Daily account of holding exactly the windows (close to close) and cash otherwise. */
export function placedCurve(
    closes: readonly number[],
    windows: readonly HoldWindow[]
): number[] {
    const factors = closes.map(() => 1);
    windows.forEach(({ start, length }) => {
        Array.from({ length }, (_, k) => start + 1 + k).forEach(day => {
            factors[day] = closes[day] / closes[day - 1];
        });
    });
    return cumulativeProduct(factors);
}

export interface RandomEntryResult {
    readonly returns: readonly number[];
    readonly drawdowns: readonly number[];
}

/** One draw's portfolio: every sleeve places its own lengths with the stream of its key. */
export function randomEntryDraw(
    sleeves: readonly Sleeve[],
    draw: number,
    seed: number
): { windows: readonly (readonly HoldWindow[])[]; curve: number[] } {
    const windows = sleeves.map(sleeve =>
        placeHolds(
            sleeve.trades.map(p => p.length),
            sleeve.closes.length,
            streamForKey(seed, `${sleeve.ticker}|${draw}`)
        )
    );
    const curve = meanCurve(
        sleeves.map((sleeve, i) => placedCurve(sleeve.closes, windows[i]))
    );
    return { windows, curve };
}

export function randomEntry(
    sleeves: readonly Sleeve[],
    draws: number,
    seed: number
): RandomEntryResult {
    const curves = Array.from(
        { length: draws },
        (_, draw) => randomEntryDraw(sleeves, draw, seed).curve
    );
    return {
        returns: curves.map(curve => percentOf(curve[curve.length - 1])),
        drawdowns: curves.map(maxDrawdownPct),
    };
}

/** Share of draws strictly above `threshold` (a tie is not above). */
export function shareAbove(
    values: readonly number[],
    threshold: number
): number {
    return values.filter(v => v > threshold).length / values.length;
}

/**
 * Share of draws whose drawdown (negative percent) is strictly shallower than the strategy's
 * mark-to-market drawdown; an equal drawdown is not smaller.
 */
export function shareShallower(
    drawdowns: readonly number[],
    strategyMarkToMarketDrawdown: number
): number {
    return (
        drawdowns.filter(d => d > strategyMarkToMarketDrawdown).length /
        drawdowns.length
    );
}

export function distributionOf(
    values: readonly number[]
): BacktestDistribution {
    const p5 = quantile(values, 0.05);
    const median = quantile(values, 0.5);
    const p95 = quantile(values, 0.95);
    if (p5 === null || median === null || p95 === null) {
        return refuse('a distribution has no draws');
    }
    return { p5, median, p95 };
}

// ─── Bracket placebo ──────────────────────────────────────────────────────────

export type RaceOutcome = 'target' | 'stop' | 'open';

/**
 * The simulator's race from bar `entryIdx` (entered at its close or inside it). With
 * `firstBarFromOpen` the entry bar is skipped and every bar after it can gap at the open;
 * without it (a limit fill inside the entry bar) the entry bar is tested on its range only.
 * On every bar the stop is tested before the target, so a bar touching both is the stop.
 */
export function raceBracket(
    bars: readonly Bar[],
    entryIdx: number,
    target: number,
    stop: number,
    firstBarFromOpen: boolean,
    limitBars: number
): RaceOutcome {
    const first = firstBarFromOpen ? entryIdx + 1 : entryIdx;
    const last = Math.min(entryIdx + limitBars, bars.length - 1);
    const outcomes = Array.from(
        { length: Math.max(0, last - first + 1) },
        (_, k): RaceOutcome => {
            const idx = first + k;
            const bar = bars[idx];
            const gaps = firstBarFromOpen || idx > entryIdx;
            if ((gaps && bar.open <= stop) || bar.low <= stop) return 'stop';
            if ((gaps && bar.open >= target) || bar.high >= target)
                return 'target';
            return 'open';
        }
    );
    return outcomes.find(o => o !== 'open') ?? 'open';
}

export const isBracketTrade = (trade: BenchmarkTrade): boolean =>
    trade.legs[0].reason === 'tp1' || trade.legs[0].reason === 'sl1';

export interface BracketResult {
    readonly n: number;
    /** Stored first halves that ended at `tp1`. */
    readonly targetFirst: number;
    /** Outcomes of the initial-plan re-race of the real trades. */
    readonly initialPlan: {
        readonly target: number;
        readonly stop: number;
        readonly open: number;
    };
    readonly placebo: {
        readonly target: number;
        readonly stop: number;
        readonly open: number;
    };
    readonly reRace: {
        readonly agree: number;
        readonly disagreeWithReviews: number;
    };
}

/** Placebo races of one trade on the given decision days of its ticker (close entry, same distances). */
export function placeboRaces(
    sleeve: Sleeve,
    trade: BenchmarkTrade,
    days: readonly number[]
): RaceOutcome[] {
    const up = trade.initialPlan.tp1 / trade.entryPrice;
    const down = trade.initialPlan.sl1 / trade.entryPrice;
    if (!(up > 1 && down > 0 && down < 1)) {
        refuse(
            `${trade.ticker} ${trade.entryDate}: tp1 ${trade.initialPlan.tp1} and sl1 ${trade.initialPlan.sl1} do not bracket the entry ${trade.entryPrice}`
        );
    }
    return days.map(day => {
        const price = sleeve.bars[day].close;
        return raceBracket(
            sleeve.bars,
            day,
            price * up,
            price * down,
            true,
            BENCHMARK_CONSTANTS.holdLimitBars
        );
    });
}

/** Random decision days of a sleeve: with replacement, each with a bar after it. */
export function pickDecisionDays(
    sleeve: Sleeve,
    count: number,
    rand: () => number
): number[] {
    const span = sleeve.hi - sleeve.lo;
    return Array.from(
        { length: count },
        () => sleeve.lo + Math.floor(rand() * span)
    );
}

export function bracketBenchmark(sleeves: readonly Sleeve[]): BracketResult {
    const counts = { target: 0, stop: 0, open: 0 };
    const reRace = { agree: 0, disagreeWithReviews: 0 };
    const initial = { target: 0, stop: 0, open: 0 };
    const targetFirst = sleeves.reduce((sum, sleeve) => {
        const bracket = sleeve.trades.filter(p => isBracketTrade(p.trade));
        bracket.forEach(p => {
            const { trade } = p;
            const ordinal = sleeve.trades.indexOf(p);
            const stored = trade.legs[0].reason === 'tp1' ? 'target' : 'stop';
            const real = raceBracket(
                sleeve.bars,
                sleeve.lo + p.entryIdx,
                trade.initialPlan.tp1,
                trade.initialPlan.sl1,
                trade.entryType !== 'wait_limit',
                BENCHMARK_CONSTANTS.holdLimitBars
            );
            initial[real] += 1;
            if (real === stored) {
                reRace.agree += 1;
            } else if (trade.holdingReviews > 0) {
                // A holding review can move the stop and the target, and the stored first
                // half ended at the moved level; only the initial plan is stored.
                reRace.disagreeWithReviews += 1;
            } else {
                refuse(
                    `${trade.ticker} ${trade.entryDate}: the first half ended at ${trade.legs[0].reason} but the race of the initial plan gives ${real}, and no holding review could have moved it`
                );
            }
            const rand = streamForKey(
                BENCHMARK_CONSTANTS.bracketSeed,
                `${trade.ticker}|${ordinal}|${trade.decisionDate}|${trade.entryDate}`
            );
            placeboRaces(
                sleeve,
                trade,
                pickDecisionDays(
                    sleeve,
                    BENCHMARK_CONSTANTS.bracketPicksPerTrade,
                    rand
                )
            ).forEach(outcome => {
                counts[outcome] += 1;
            });
        });
        return (
            sum + bracket.filter(p => p.trade.legs[0].reason === 'tp1').length
        );
    }, 0);
    const n = sleeves.reduce(
        (sum, s) => sum + s.trades.filter(p => isBracketTrade(p.trade)).length,
        0
    );
    return {
        n,
        targetFirst,
        initialPlan: initial,
        placebo: counts,
        reRace: {
            agree: reRace.agree,
            disagreeWithReviews: reRace.disagreeWithReviews,
        },
    };
}

// ─── The run ──────────────────────────────────────────────────────────────────

export interface PerTradeRow {
    readonly ticker: string;
    readonly decisionDate: string;
    readonly entryDate: string;
    readonly returnPct: number;
    readonly sameLengthDriftPct: number;
    readonly excessPct: number;
}

export interface PerTickerRow {
    readonly ticker: string;
    readonly tradingDays: number;
    readonly trades: number;
    readonly exposurePct: number;
    readonly buyHoldPct: number;
    readonly buyHoldMaxDrawdownPct: number;
    readonly exposureMatchedHoldPct: number;
    readonly markToMarketMaxDrawdownPct: number;
    readonly closedReturnPct: number;
    readonly closedMaxDrawdownPct: number;
}

export interface BenchmarkDiagnostics {
    readonly constants: typeof BENCHMARK_CONSTANTS;
    readonly period: {
        readonly from: string;
        readonly to: string;
        readonly tradingDays: number;
    };
    readonly strategy: {
        readonly closedReturnPct: number;
        readonly closedMaxDrawdownPct: number;
        readonly returnFromLegsPct: number;
        readonly legReturnDifferencePp: number;
    };
    readonly bracket: BracketResult;
    readonly randomEntry: {
        readonly returnPctMeanOfDraws: number;
        readonly drawsAboveStrategyReturn: number;
        readonly drawsWithSmallerDrawdown: number;
    };
}

export interface BenchmarkResult {
    readonly benchmarks: BacktestBenchmarks;
    readonly perTrade: readonly PerTradeRow[];
    readonly perTicker: readonly PerTickerRow[];
    readonly diagnostics: BenchmarkDiagnostics;
}

/** Every number of the output tree must be finite: a NaN or Infinity is a refusal, never a figure. */
export function assertFinite(value: unknown, path = 'result'): void {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) refuse(`${path} is not finite`);
    } else if (Array.isArray(value)) {
        value.forEach((item, i) => assertFinite(item, `${path}[${i}]`));
    } else if (value !== null && typeof value === 'object') {
        Object.entries(value).forEach(([key, item]) =>
            assertFinite(item, `${path}.${key}`)
        );
    }
}

function checkInput(input: BenchmarkInput): void {
    const { run, baselines, trades } = input;
    if (trades.length === 0) refuse('the run has no trades');
    if (
        run.tickers.length !== baselines.length ||
        run.tickers.some((ticker, i) => baselines[i].ticker !== ticker)
    ) {
        refuse(
            `run.tickers (${run.tickers.join(',')}) and baselines (${baselines.map(b => b.ticker).join(',')}) differ`
        );
    }
    const unknown = trades.filter(t => !run.tickers.includes(t.ticker));
    if (unknown.length > 0) {
        refuse(
            `trades of tickers outside the run: ${[...new Set(unknown.map(t => t.ticker))].join(',')}`
        );
    }
    const missing = run.tickers.filter(t => input.bars[t] === undefined);
    if (missing.length > 0) refuse(`no bars for ${missing.join(',')}`);
}

export function computeBenchmarks(input: BenchmarkInput): BenchmarkResult {
    checkInput(input);
    const { run, baselines, trades, identity } = input;
    const k = BENCHMARK_CONSTANTS;
    const sleeves = run.tickers.map(ticker =>
        buildSleeve(ticker, input.bars[ticker], run, trades)
    );
    const days = sleeves[0].closes.length;
    if (sleeves.some(s => s.closes.length !== days)) {
        refuse('the tickers have different numbers of bars in the period');
    }

    // Paired with the stored baselines: the bars must reproduce them.
    const holds = sleeves.map(s => holdCurve(s.closes));
    sleeves.forEach((sleeve, i) => {
        const base = baselines[i];
        const hold = percentOf(holds[i][days - 1]);
        const drawdown = maxDrawdownPct(holds[i]);
        if (
            base.tradingDays !== days ||
            Math.abs(hold - base.buyHoldPct) > k.baselineToleranceUnits ||
            Math.abs(drawdown - base.buyHoldMaxDrawdownPct) >
                k.baselineToleranceUnits
        ) {
            refuse(
                `${sleeve.ticker}: the bars give hold ${hold.toFixed(4)}% / drawdown ${drawdown.toFixed(4)}% / ${days} days, the baseline says ${base.buyHoldPct}% / ${base.buyHoldMaxDrawdownPct}% / ${base.tradingDays} days`
            );
        }
    });

    const holdPortfolio = meanCurve(holds);
    const exposures = sleeves.map(exposureOf);
    const matchedCurves = sleeves.map((s, i) =>
        exposureMatchedCurve(s.closes, exposures[i])
    );
    const matched = meanCurve(matchedCurves);

    const accounts = sleeves.map(strategyAccount);
    const closedPortfolio = meanCurve(accounts.map(a => a.closed));
    const mtmPortfolio = meanCurve(accounts.map(a => a.markToMarket));
    const closedReturn = percentOf(closedPortfolio[days - 1]);
    const legsReturn = percentOf(
        mean(accounts.map(a => a.finalFromLegs)) ?? Number.NaN
    );
    const legDifference = Math.abs(legsReturn - closedReturn);
    if (!(legDifference <= k.legReturnTolerancePp)) {
        refuse(
            `the stored trade returns compound to ${closedReturn.toFixed(4)}% but their legs imply ${legsReturn.toFixed(4)}% (limit ${k.legReturnTolerancePp} pp)`
        );
    }
    const strategyMtmDrawdown = maxDrawdownPct(mtmPortfolio);

    // Per-trade excess over the same-length drift.
    const driftMemo = new Map<string, number>();
    const driftOf = (sleeve: Sleeve, length: number): number => {
        const key = `${sleeve.ticker}|${length}`;
        const cached = driftMemo.get(key);
        if (cached !== undefined) return cached;
        const value = sameLengthDriftPct(sleeve.closes, length);
        driftMemo.set(key, value);
        return value;
    };
    const perTrade = trades.map((trade): PerTradeRow => {
        const sleeve = sleeves[run.tickers.indexOf(trade.ticker)];
        const drift = driftOf(sleeve, trade.holdingDays);
        return {
            ticker: trade.ticker,
            decisionDate: trade.decisionDate,
            entryDate: trade.entryDate,
            returnPct: trade.returnPct,
            sameLengthDriftPct: drift,
            excessPct: trade.returnPct - drift,
        };
    });
    const excess = weekClusterInterval(
        trades.map((trade, i) => ({
            week: isoWeekKey(timeOfDate(trade.entryDate)),
            value: perTrade[i].excessPct,
        })),
        k.bootstrapResamples,
        k.bootstrapSeed
    );

    const random = randomEntry(sleeves, k.randomEntryDraws, k.randomEntrySeed);
    const aboveShare = shareAbove(random.returns, closedReturn);
    const shallowerShare = shareShallower(
        random.drawdowns,
        strategyMtmDrawdown
    );

    const bracket = bracketBenchmark(sleeves);
    const resolved = bracket.placebo.target + bracket.placebo.stop;
    const initialResolved =
        bracket.initialPlan.target + bracket.initialPlan.stop;
    if (bracket.n === 0 || resolved === 0 || initialResolved === 0) {
        refuse(
            'there is no bracket trade, no resolved initial-plan race or no resolved placebo race'
        );
    }

    const perTicker = sleeves.map((sleeve, i): PerTickerRow => ({
        ticker: sleeve.ticker,
        tradingDays: days,
        trades: sleeve.trades.length,
        exposurePct: exposures[i] * 100,
        buyHoldPct: percentOf(holds[i][days - 1]),
        buyHoldMaxDrawdownPct: maxDrawdownPct(holds[i]),
        exposureMatchedHoldPct: percentOf(matchedCurves[i][days - 1]),
        markToMarketMaxDrawdownPct: maxDrawdownPct(accounts[i].markToMarket),
        closedReturnPct: percentOf(accounts[i].closed[days - 1]),
        closedMaxDrawdownPct: maxDrawdownPct(accounts[i].closed),
    }));

    const benchmarks: BacktestBenchmarks = {
        version: k.version,
        tradesSha256: identity.tradesSha256,
        barsFingerprint: identity.barsFingerprint,
        coreSha: identity.coreSha,
        holdPortfolio: {
            returnPct: percentOf(holdPortfolio[days - 1]),
            maxDrawdownPct: maxDrawdownPct(holdPortfolio),
        },
        exposureMatchedHold: {
            exposurePct: (mean(exposures) ?? Number.NaN) * 100,
            returnPct: percentOf(matched[days - 1]),
            maxDrawdownPct: maxDrawdownPct(matched),
        },
        strategyMarkToMarketMaxDrawdownPct: strategyMtmDrawdown,
        perTradeExcess: {
            basis: 'same_length_drift',
            n: trades.length,
            meanPct: excess.mean,
            ci95: { low: excess.low, high: excess.high },
            clusters: 'week',
        },
        randomEntry: {
            draws: k.randomEntryDraws,
            seed: k.randomEntrySeed,
            returnPct: distributionOf(random.returns),
            maxDrawdownPct: distributionOf(random.drawdowns),
            shareAboveStrategyReturn: aboveShare,
            shareWithSmallerDrawdown: shallowerShare,
        },
        bracket: {
            n: bracket.n,
            initialPlan: {
                resolvedRaces: initialResolved,
                targetFirstShare: bracket.initialPlan.target / initialResolved,
            },
            placebo: {
                resolvedRaces: resolved,
                targetFirstShare: bracket.placebo.target / resolved,
            },
            storedTargetFirstShare: bracket.targetFirst / bracket.n,
        },
    };
    const diagnostics: BenchmarkDiagnostics = {
        constants: k,
        period: {
            from: sleeves[0].dates[0],
            to: sleeves[0].dates[days - 1],
            tradingDays: days,
        },
        strategy: {
            closedReturnPct: closedReturn,
            closedMaxDrawdownPct: maxDrawdownPct(closedPortfolio),
            returnFromLegsPct: legsReturn,
            legReturnDifferencePp: legDifference,
        },
        bracket,
        randomEntry: {
            returnPctMeanOfDraws: mean(random.returns) ?? Number.NaN,
            drawsAboveStrategyReturn: Math.round(
                aboveShare * k.randomEntryDraws
            ),
            drawsWithSmallerDrawdown: Math.round(
                shallowerShare * k.randomEntryDraws
            ),
        },
    };
    const result = { benchmarks, perTrade, perTicker, diagnostics };
    assertFinite(result);
    return result;
}

/** Rounds every figure for the stored file (4 decimals), leaving strings and integers alone. */
export function roundForOutput<T>(value: T): T {
    if (typeof value === 'number') {
        return (Number.isInteger(value) ? value : round4(value)) as T;
    }
    if (Array.isArray(value)) return value.map(roundForOutput) as T;
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                roundForOutput(item),
            ])
        ) as T;
    }
    return value;
}
