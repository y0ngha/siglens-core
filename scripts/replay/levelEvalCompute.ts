/**
 * The numbers of the price-level evaluation (WP-18 core-0): the printed levels of a day with
 * features read from bars up to that day only, their "held" outcome, a date-transplant
 * placebo, held-rate tables with week-clustered intervals, the score fit with a time split,
 * the structural-ratio anchors and the non-positive-level count. Pure functions over bars
 * and rows; `levelEval.ts` loads the set and writes the result.
 *
 * Rules every statistic follows (WP-18 §1, §8.1):
 *  - a feature is read from `bars[0..t]`; the outcome from the bars after `t`. `levelFeaturesAt`
 *    takes the whole series and cuts it at `t` itself, so a unit test can poison the future;
 *  - a level's held rate is compared with the same distance on other dates of the same symbol
 *    (the date transplant: same side, same volatility regime and drift, no "level here"), never
 *    with a rate read off a level;
 *  - an interval clusters by ISO week of the study day; an empty pool gives `null`, never `0`.
 */
import { createHash } from 'node:crypto';
import { calculateATR } from '@/domain/indicators/atr';
import { calculateIndicators } from '@/domain/indicators';
import {
    AT_PRICE_BAR_RANGE_FRACTION,
    meanBarRangePercent,
} from '@/domain/analysis/referenceLevels';
import { computeMarketReference } from '@/domain/analysis/marketReference';
import { printedLevelsOnSide } from '@/domain/analysis/printedReferenceLevels';
import { priceQuoting } from '@/domain/analysis/promptFormat';
import { labelLevelOutcome } from '@/domain/outcomes/labelLevelOutcome';
import { buildFibonacciCandidates } from '@/domain/overlays/fibonacciCandidates';
import type { OutcomeWindow } from '@/domain/outcomes/types';
import type { Bar, HorizonKey, ReferenceLevel } from '@/domain/types';
import { deltaStat, toBlocks, type Resamplings } from './engineEvalCompute';
import { isoWeekKey } from './engineEvalStats';
import type { EvalMarket, Observation } from './engineEvalTypes';
import {
    ANCHOR_FAMILY,
    KIND_FAMILY,
    LEVEL_EVAL_CONSTANTS as C,
    isResolved,
    type DayFeatures,
    type DayRow,
    type HeldOutcome,
    type LevelFeatures,
    type LevelRow,
    type LevelSideName,
    type NonPositiveCounts,
    type RrAnchors,
} from './levelEvalTypes';
import { profileOf } from './markets';
import { mean, median, quantile } from './stats';

const HORIZONS: readonly HorizonKey[] = ['short', 'medium', 'long'];
const SIDES: readonly LevelSideName[] = ['support', 'resistance'];
const SECONDS_PER_DAY = 86_400;

// ─── The outcome definition (the instrument's own copy) ───────────────────────

/**
 * The outcome of a level at `price` against a window, with the barrier a parameter. At the
 * labeller's own barrier it is `labelLevelOutcome(...).outcome` (a non-positive price is
 * simply never reached, as there); the instrument calls the
 * labeller for the real levels and counts disagreements, and uses this for the placebo
 * draws (a few million evaluations) and the barrier sweep.
 */
export function evaluateLevel(
    side: LevelSideName,
    price: number,
    window: OutcomeWindow,
    barrierAtr: number = C.barrierAtr
): HeldOutcome {
    const { atr, referencePrice, forward } = window;
    if (atr === null || !(atr > 0)) return 'skipped';
    if (side === 'support' ? price >= referencePrice : price <= referencePrice)
        return 'skipped';
    if (Math.abs(price - referencePrice) / atr < C.minDistanceAtr)
        return 'skipped';
    const sign = side === 'support' ? 1 : -1;
    const band = C.touchBandAtr * atr;
    const barrier = barrierAtr * atr;
    const touch = forward.findIndex(([, , high, low]) =>
        side === 'support' ? low <= price + band : high >= price - band
    );
    if (touch < 0) return 'untouched';
    const follow = forward.slice(touch, touch + C.followBars);
    const hit = follow.find(
        ([, open, , , close]) =>
            sign * (open - (price - sign * barrier)) < 0 ||
            sign * (close - (price - sign * barrier)) < 0 ||
            sign * (close - (price + sign * barrier)) > 0
    );
    if (hit === undefined) {
        return touch + C.followBars <= forward.length
            ? 'inconclusive'
            : 'touched_late';
    }
    const [, open, , , close] = hit;
    return sign * (open - (price - sign * barrier)) < 0 ||
        sign * (close - (price - sign * barrier)) < 0
        ? 'broken'
        : 'respected';
}

/** `price` of the same distance in ATR on the same side of another day's reference price. */
export function transplantPrice(
    side: LevelSideName,
    dAtr: number,
    window: OutcomeWindow
): number {
    const atr = window.atr ?? 0;
    return side === 'support'
        ? window.referencePrice - dAtr * atr
        : window.referencePrice + dAtr * atr;
}

// ─── Seeded picks ─────────────────────────────────────────────────────────────

/** The 256-bit hash a level's placebo picks and robustness sample are keyed on. */
export function levelHash(
    symbol: string,
    t: number,
    side: LevelSideName,
    rank: number
): bigint {
    return BigInt(
        `0x${createHash('sha256').update(`${symbol}|${t}|${side}|${rank}`).digest('hex')}`
    );
}

/**
 * The days a level's transplant draws from: the other study days of the symbol more than
 * `transplantExcludeBars` (the real level's forward window plus its follow bars) and at most
 * `transplantRadiusBars` bars away, sorted: a nearer day shares the real level's outcome
 * window, so its placebo would not be independent. Fewer than `transplantCount` gives none.
 */
export function partnerDays(
    t: number,
    studyDays: readonly number[]
): readonly number[] {
    const own = studyDays.filter(
        other =>
            Math.abs(other - t) > C.transplantExcludeBars &&
            Math.abs(other - t) <= C.transplantRadiusBars
    );
    return own.length < C.transplantCount ? [] : own.toSorted((a, b) => a - b);
}

/** The partner days one level draws: pick `k` is the hash shifted right by `16 k` bits, modulo the partner count (picks may repeat). */
export function transplantPicks(
    hash: bigint,
    partners: readonly number[]
): readonly number[] {
    if (partners.length === 0) return [];
    const length = BigInt(partners.length);
    return Array.from(
        { length: C.transplantCount },
        (_, k) => partners[Number((hash >> BigInt(16 * k)) % length)]
    );
}

// ─── Features of a day ────────────────────────────────────────────────────────

interface History {
    episodes: number;
    reactions: number;
    lastTouchAgo: number | null;
    volRatio: number | null;
}

/**
 * Touch episodes, reactions, recency and volume density of one level over `hist` (the last
 * `lookbackBars` bars up to and including the study day; the study day itself is not a
 * touch). A loop on purpose: one pass per level over ~120 bars, ~760K levels.
 */
function historyOfLevel(
    hist: readonly Bar[],
    level: number,
    side: LevelSideName,
    atr: number,
    meanDensity: number | null
): History {
    const band = C.touchBandAtr * atr;
    const sign = side === 'support' ? 1 : -1;
    const state = { episodes: 0, reactions: 0, lastEpisode: -999, last: -1 };
    for (let i = 0; i < hist.length - 1; i++) {
        const bar = hist[i];
        if (bar.low > level + band || bar.high < level - band) continue;
        if (i - state.lastEpisode >= C.episodeGapBars) {
            state.episodes += 1;
            const after = hist.slice(i + 1, i + 1 + C.reactionBars);
            if (
                after.some(b => sign * (b.close - level) >= C.reactionAtr * atr)
            ) {
                state.reactions += 1;
            }
        }
        state.lastEpisode = i;
        state.last = i;
    }
    const density = hist.reduce(
        (sum, b) =>
            b.high > b.low && b.low <= level && b.high >= level
                ? sum + (b.volume || 0) / (b.high - b.low)
                : sum,
        0
    );
    return {
        episodes: state.episodes,
        reactions: state.reactions,
        lastTouchAgo: state.last < 0 ? null : hist.length - 1 - state.last,
        volRatio: meanDensity === null ? null : density / meanDensity,
    };
}

function meanVolumeDensity(hist: readonly Bar[]): number | null {
    const low = Math.min(...hist.map(b => b.low));
    const high = Math.max(...hist.map(b => b.high));
    const volume = hist.reduce((sum, b) => sum + (b.volume || 0), 0);
    return high > low && volume > 0 ? volume / (high - low) : null;
}

const familyOf = (kind: string): string => KIND_FAMILY[kind] ?? kind;

/**
 * The structural R:R the prompt's `### Risk:Reward From Current Price` block anchored on
 * (the instrument's own copy of its anchor choice): the tightest horizon with a level beyond
 * the bar-noise band on both sides, the nearest of each.
 */
export function structuralAnchors(
    reference: Record<
        HorizonKey,
        { levels: Record<LevelSideName, readonly ReferenceLevel[]> }
    >,
    floorPercent: number,
    close: number,
    atr: number
): RrAnchors | null {
    const clear = (l: ReferenceLevel): boolean =>
        l.atPrice !== true && Math.abs(l.distancePercent) >= floorPercent;
    const horizon = HORIZONS.find(
        h =>
            reference[h].levels.support.some(clear) &&
            reference[h].levels.resistance.some(clear)
    );
    if (horizon === undefined) return null;
    const up = reference[horizon].levels.resistance.find(clear);
    const down = reference[horizon].levels.support.find(clear);
    if (up === undefined || down === undefined) return null;
    const reward = up.distancePercent;
    const risk = Math.abs(down.distancePercent);
    return {
        horizon,
        upKind: up.kind,
        downKind: down.kind,
        ratio:
            reward > 0 && down.distancePercent <= 0 && risk > 0
                ? reward / risk
                : null,
        upAtr: (up.price - close) / atr,
        downAtr: (close - down.price) / atr,
    };
}

const nonPositive = (price: number): boolean => !(price > 0);

/**
 * The reference of study day `t` and the features of every printed level, all from
 * `bars[0..t]`: the future bars are never read (a unit test poisons them). `null` when the
 * close or the ATR is unusable.
 */
export function levelFeaturesAt(
    bars: readonly Bar[],
    t: number,
    meta: { symbol: string; market: EvalMarket }
): DayFeatures | null {
    const cut = bars.slice(Math.max(0, t - (C.windowBars - 1)), t + 1);
    const last = cut[cut.length - 1];
    const close = last.close;
    if (!(close > 0)) return null;
    const atr = calculateATR(cut, 14).at(-1) ?? null;
    if (atr === null || !(atr > 0)) return null;
    const profile = profileOf(meta.market);
    const reference = computeMarketReference(
        cut,
        calculateIndicators(cut),
        '1Day',
        {
            assetClass: 'equity',
            currency: profile.currency,
            // The bar is a finished session: three days later every market has closed it.
            clock: {
                session: profile.session,
                now: new Date((last.time + 3 * SECONDS_PER_DAY) * 1000),
            },
        }
    );
    const quoting = priceQuoting(
        close,
        profile.currency,
        'equity',
        profile.krxTickTable
    );
    const printed = {
        support: printedLevelsOnSide(reference, 'support', quoting),
        resistance: printedLevelsOnSide(reference, 'resistance', quoting),
    };
    const pool = [...printed.support, ...printed.resistance];
    const hist = cut.slice(-C.lookbackBars);
    const meanDensity = meanVolumeDensity(hist);
    const levels = SIDES.flatMap(side =>
        printed[side].map((level, rank): LevelFeatures => {
            const near = pool.filter(
                p => Math.abs(p.price - level.price) <= C.clusterAtr * atr
            );
            return {
                side,
                rank,
                kind: level.kind,
                family: familyOf(level.kind),
                price: level.price,
                dAtr: Math.abs(level.price - close) / atr,
                kinds: new Set(near.map(p => familyOf(p.kind))).size,
                nearN: near.length,
                ...historyOfLevel(hist, level.price, side, atr, meanDensity),
            };
        })
    );
    const horizonLevels = HORIZONS.flatMap(h =>
        SIDES.flatMap(side => reference[h].levels[side].map(l => ({ h, l })))
    ).filter(({ l }) => nonPositive(l.price));
    const fibOverlay = buildFibonacciCandidates(reference, cut, {
        timeframe: '1Day',
        quoting,
    }).flatMap(c => c.levels.filter(l => nonPositive(l.price)));
    const counts: NonPositiveCounts = {
        horizons: horizonLevels.length,
        printed: pool.filter(l => nonPositive(l.price)).length,
        fibOverlay: fibOverlay.length,
        labels: horizonLevels.map(
            ({ h, l }) => `${h}:${l.label}:${l.price.toFixed(4)}`
        ),
    };
    return {
        symbol: meta.symbol,
        market: meta.market,
        t,
        time: last.time,
        close,
        atr,
        rr: structuralAnchors(
            reference,
            meanBarRangePercent(cut) * AT_PRICE_BAR_RANGE_FRACTION,
            close,
            atr
        ),
        nonPositive: counts,
        levels,
    };
}

// ─── Labelling ────────────────────────────────────────────────────────────────

/** The labels of a day's levels and how many the instrument's own evaluator disagrees on. */
export interface LabelledDay {
    rows: readonly LevelRow[];
    /** Real levels the labeller and the instrument's evaluator label differently. */
    disagreements: number;
}

/**
 * Labels the levels of a day with `labelLevelOutcome` (outcome and the two shift placebos)
 * and draws their date-transplant placebo from the symbol's other days' windows.
 */
export function labelDay(
    day: DayFeatures,
    window: OutcomeWindow,
    windows: ReadonlyMap<number, OutcomeWindow>,
    partners: readonly number[]
): LabelledDay {
    const week = isoWeekKey(day.time);
    const labelled = day.levels.map(level => {
        const label = labelLevelOutcome(
            { side: level.side, price: level.price },
            window
        );
        const own = evaluateLevel(level.side, level.price, window);
        const picks = transplantPicks(
            levelHash(day.symbol, day.t, level.side, level.rank),
            partners
        );
        const row: LevelRow = {
            ...level,
            symbol: day.symbol,
            market: day.market,
            t: day.t,
            time: day.time,
            week,
            outcome: label.outcome,
            shift: [label.placebo[0].outcome, label.placebo[1].outcome],
            transplant:
                label.outcome === 'skipped'
                    ? []
                    : picks.map(pick => {
                          const other = windows.get(pick);
                          return other === undefined
                              ? 'skipped'
                              : evaluateLevel(
                                    level.side,
                                    transplantPrice(
                                        level.side,
                                        level.dAtr,
                                        other
                                    ),
                                    other
                                );
                      }),
        };
        return { row, agrees: own === label.outcome };
    });
    return {
        rows: labelled.map(l => l.row),
        disagreements: labelled.filter(l => !l.agrees).length,
    };
}

/** Closes after study day `t`: the 10 and 20 session returns, in percent. */
export function forwardReturns(
    bars: readonly Bar[],
    t: number
): { ret10: number | null; ret20: number | null } {
    const close = bars[t].close;
    const at = (h: number): number | null =>
        t + h < bars.length ? (bars[t + h].close / close - 1) * 100 : null;
    return { ret10: at(10), ret20: at(20) };
}

/** The day without its levels (they are in the level rows) plus its forward returns. */
export function toDayRow(day: DayFeatures, bars: readonly Bar[]): DayRow {
    const { levels: _levels, ...rest } = day;
    return { ...rest, ...forwardReturns(bars, day.t) };
}

// ─── Held-rate tables ─────────────────────────────────────────────────────────

export interface Share {
    n: number;
    /** `respected / n` over resolved touches; `null` for `n = 0`. */
    share: number | null;
}

export interface GroupStat {
    /** Levels in the group (not skipped by the labeller). */
    levels: number;
    /** Resolved touches (`respected` or `broken`): the denominator of `held`. */
    held: Share;
    /** The date-transplant placebo's resolved outcomes of the same levels. */
    transplant: Share;
    /** `held − transplant` with its week-clustered 95% interval. */
    difference: {
        mean: number | null;
        low: number | null;
        high: number | null;
    };
    /** The labeller's own shift placebos (farther, closer), resolved only. */
    shiftFar: Share;
    shiftClose: Share;
}

const respectedShare = (outcomes: readonly HeldOutcome[]): Share => {
    const resolved = outcomes.filter(isResolved);
    return {
        n: resolved.length,
        share:
            resolved.length === 0
                ? null
                : resolved.filter(o => o === 'respected').length /
                  resolved.length,
    };
};

const heldObservations = (rows: readonly LevelRow[]): Observation[] =>
    rows
        .filter(r => isResolved(r.outcome))
        .map(r => ({ week: r.week, value: r.outcome === 'respected' ? 1 : 0 }));

const transplantObservations = (rows: readonly LevelRow[]): Observation[] =>
    rows.flatMap(r =>
        r.transplant
            .filter(isResolved)
            .map(o => ({ week: r.week, value: o === 'respected' ? 1 : 0 }))
    );

/**
 * `mean(after) - mean(before)` with the wider of the ISO-week and the 13-week-block
 * intervals (one rule with the chart-pattern rows, WP-17 G3): market-wide moves and
 * overlapping outcome windows make neighbouring weeks alike.
 */
export function widerDelta(
    before: readonly Observation[],
    after: readonly Observation[],
    resamplings: Resamplings
): ReturnType<typeof deltaStat> {
    const week = deltaStat(before, after, resamplings.weeks);
    const block = deltaStat(
        toBlocks(before),
        toBlocks(after),
        resamplings.blocks
    );
    return {
        ...week,
        low:
            week.low === null || block.low === null
                ? null
                : Math.min(week.low, block.low),
        high:
            week.high === null || block.high === null
                ? null
                : Math.max(week.high, block.high),
    };
}

/** The held rate of a group of levels against its transplant placebo. */
export function groupStat(
    rows: readonly LevelRow[],
    resampling: Resamplings
): GroupStat {
    const live = rows.filter(r => r.outcome !== 'skipped');
    const delta = widerDelta(
        transplantObservations(live),
        heldObservations(live),
        resampling
    );
    return {
        levels: live.length,
        held: respectedShare(live.map(r => r.outcome)),
        transplant: respectedShare(live.flatMap(r => r.transplant)),
        difference: { mean: delta.delta, low: delta.low, high: delta.high },
        shiftFar: respectedShare(live.map(r => r.shift[0])),
        shiftClose: respectedShare(live.map(r => r.shift[1])),
    };
}

/** One stat per distinct key, keys sorted. */
export function groupTable(
    rows: readonly LevelRow[],
    keyOf: (row: LevelRow) => string,
    resampling: Resamplings
): Record<string, GroupStat> {
    const keys = [...new Set(rows.map(keyOf))].toSorted();
    return Object.fromEntries(
        keys.map(key => [
            key,
            groupStat(
                rows.filter(r => keyOf(r) === key),
                resampling
            ),
        ])
    );
}

/** Quantile edges (`parts - 1` of them) of the finite values. */
export function quantileEdges(
    values: readonly number[],
    parts: number
): number[] {
    return Array.from({ length: parts - 1 }, (_, i) =>
        quantile(values, (i + 1) / parts)
    ).flatMap(edge => (edge === null ? [] : [edge]));
}

/** The index of the band a value falls in: the number of edges strictly below it. */
export const bandOf = (value: number, edges: readonly number[]): number =>
    edges.filter(edge => edge < value).length;

const halfInch = (x: number): number => Math.floor(x * 2) / 2;

const recencyOf = (row: LevelRow): string =>
    row.lastTouchAgo === null
        ? 'none'
        : row.lastTouchAgo <= 5
          ? '<=5'
          : row.lastTouchAgo <= 20
            ? '<=20'
            : row.lastTouchAgo <= 60
              ? '<=60'
              : '>60';

/** Every table of the brief's §1: by family, confluence, touches, reactions, side, distance, volume, recency, market, half. */
export function heldTables(
    rows: readonly LevelRow[],
    resampling: Resamplings
): Record<string, Record<string, GroupStat>> {
    const resolved = rows.filter(r => isResolved(r.outcome));
    const volumeEdges = quantileEdges(
        resolved.flatMap(r => (r.volRatio === null ? [] : [r.volRatio])),
        5
    );
    const keyed = (
        keyOf: (row: LevelRow) => string
    ): Record<string, GroupStat> => groupTable(rows, keyOf, resampling);
    return {
        family: keyed(r => r.family),
        kinds: keyed(r => String(Math.min(r.kinds, C.kindsCap))),
        episodes: keyed(r => String(Math.min(r.episodes, C.episodesCap))),
        reactions: keyed(r => String(Math.min(r.reactions, C.reactionsCap))),
        side: keyed(r => r.side),
        distanceAtr: keyed(r =>
            Math.min(halfInch(r.dAtr), C.distanceCapAtr).toFixed(1)
        ),
        volumeQuintile: keyed(r =>
            r.volRatio === null
                ? 'none'
                : String(bandOf(r.volRatio, volumeEdges))
        ),
        recency: keyed(recencyOf),
        market: keyed(r => r.market),
        half: keyed(r => (r.time >= C.splitTime ? '2022+' : 'pre-2022')),
    };
}

/** Share of levels (not skipped) whose price a bar touched within the window, by distance. */
export function touchRateByDistance(
    rows: readonly LevelRow[]
): Record<string, Share> {
    const live = rows.filter(r => r.outcome !== 'skipped');
    const keys = [...new Set(live.map(r => halfInch(r.dAtr)))]
        .filter(d => d <= C.distanceCapAtr)
        .toSorted((a, b) => a - b);
    return Object.fromEntries(
        keys.map(key => {
            const own = live.filter(r => halfInch(r.dAtr) === key);
            const touched = own.filter(r => r.outcome !== 'untouched').length;
            return [
                key.toFixed(1),
                { n: own.length, share: touched / own.length },
            ];
        })
    );
}

// ─── The score fit ────────────────────────────────────────────────────────────

/** Names of the features of the fitted model, in column order. */
export function featureNames(families: readonly string[]): string[] {
    return [
        'const',
        'kinds-1',
        'log1p(episodes)',
        'log1p(reactions)',
        'log(volRatio)',
        'recency',
        'support',
        'dAtr',
        ...families.slice(1).map(f => `fam=${f}`),
    ];
}

/** The feature vector of a level (the design's: confluence, touches, volume, recency, side, distance, family). */
export function featureVector(
    row: LevelRow,
    families: readonly string[]
): number[] {
    return [
        1,
        Math.min(row.kinds, C.kindsCap) - 1,
        Math.log1p(row.episodes),
        Math.log1p(row.reactions),
        Math.log(Math.max(row.volRatio || 1e-3, 1e-3)),
        row.lastTouchAgo === null ? 0 : 1 / (1 + row.lastTouchAgo / 10),
        row.side === 'support' ? 1 : 0,
        Math.min(row.dAtr, 4),
        ...families.slice(1).map(f => (row.family === f ? 1 : 0)),
    ];
}

/** Solves `A x = b` by Gaussian elimination with partial pivoting (small dense systems). */
export function solveLinear(
    a: readonly (readonly number[])[],
    b: readonly number[]
): number[] {
    const n = b.length;
    const m = a.map((row, i) => [...row, b[i]]);
    Array.from({ length: n }).forEach((_, col) => {
        const pivot = Array.from(
            { length: n - col },
            (__, k) => col + k
        ).reduce(
            (best, r) =>
                Math.abs(m[r][col]) > Math.abs(m[best][col]) ? r : best,
            col
        );
        [m[col], m[pivot]] = [m[pivot], m[col]];
        Array.from({ length: n }).forEach((__, r) => {
            if (r === col) return;
            const factor = m[r][col] / m[col][col];
            m[r] = m[r].map((v, c) => v - factor * m[col][c]);
        });
    });
    return m.map((row, i) => row[n] / row[i]);
}

/**
 * L2-regularised logistic regression by Newton steps (the intercept is not penalised).
 * Loops on purpose: `rows × features²` per step over ~300K training levels.
 */
export function fitLogistic(
    x: readonly (readonly number[])[],
    y: readonly number[],
    l2: number = C.l2,
    maxIterations: number = C.maxIterations
): number[] {
    const p = x[0]?.length ?? 0;
    const w = Array.from({ length: p }, () => 0);
    for (let iteration = 0; iteration < maxIterations; iteration++) {
        const grad = Array.from({ length: p }, (_, j) =>
            j === 0 ? 0 : l2 * w[j]
        );
        const hess = Array.from({ length: p }, (_, j) =>
            Array.from({ length: p }, (__, k) => (j === k && j > 0 ? l2 : 0))
        );
        for (let i = 0; i < x.length; i++) {
            const row = x[i];
            const z = row.reduce((s, v, j) => s + v * w[j], 0);
            const prob = 1 / (1 + Math.exp(-z));
            const weight = prob * (1 - prob);
            for (let j = 0; j < p; j++) {
                grad[j] += row[j] * (prob - y[i]);
                for (let k = j; k < p; k++)
                    hess[j][k] += row[j] * row[k] * weight;
            }
        }
        for (let j = 0; j < p; j++)
            for (let k = 0; k < j; k++) hess[j][k] = hess[k][j];
        const step = solveLinear(hess, grad);
        step.forEach((s, j) => {
            w[j] -= s;
        });
        if (Math.max(...step.map(Math.abs)) < 1e-9) break;
    }
    return w;
}

export const sigmoidScore = (
    row: LevelRow,
    weights: readonly number[],
    families: readonly string[]
): number =>
    1 /
    (1 +
        Math.exp(
            -featureVector(row, families).reduce(
                (s, v, j) => s + v * weights[j],
                0
            )
        ));

/** Area under the ROC curve by rank sum (ties share their mean rank); `null` without both classes. */
export function auc(
    scores: readonly number[],
    positive: readonly boolean[]
): number | null {
    const order = scores
        .map((score, i) => ({ score, i }))
        .toSorted((a, b) => a.score - b.score);
    const ranks = Array.from({ length: scores.length }, () => 0);
    const state = { start: 0 };
    while (state.start < order.length) {
        const end = order.findIndex(
            (o, k) => k >= state.start && o.score !== order[state.start].score
        );
        const stop = end < 0 ? order.length : end;
        const rank = (state.start + 1 + stop) / 2;
        order.slice(state.start, stop).forEach(o => {
            ranks[o.i] = rank;
        });
        state.start = stop;
    }
    const n1 = positive.filter(Boolean).length;
    const n0 = positive.length - n1;
    if (n1 === 0 || n0 === 0) return null;
    const rankSum = ranks.reduce((s, r, i) => (positive[i] ? s + r : s), 0);
    return (rankSum - (n1 * (n1 + 1)) / 2) / (n1 * n0);
}

export interface BandStat extends GroupStat {
    band: number;
}

export interface ScoreSummary {
    trainRows: number;
    testRows: number;
    weights: Record<string, number>;
    edges: number[];
    aucTrain: number | null;
    aucTest: number | null;
    bandsTrain: BandStat[];
    bandsTest: BandStat[];
    /** Top band − bottom band held rate on the test period, week-clustered. */
    topMinusBottom: IntervalStat | null;
    /** Top band − its own transplant placebo on the test period: the L-gate's statistic. */
    topMinusTransplant: IntervalStat | null;
    topMinusTransplantByMarket: Record<string, number | null>;
    topMinusTransplantByHalf: Record<string, number | null>;
    /** The hand-weighted rule "3+ kinds or 2+ reactions", no fit. */
    simpleRuleTest: {
        within: GroupStat;
        outside: GroupStat;
    };
}

export interface IntervalStat {
    n: number;
    mean: number | null;
    low: number | null;
    high: number | null;
}

const asInterval = (delta: ReturnType<typeof deltaStat>): IntervalStat => ({
    n: delta.nAfter,
    mean: delta.delta,
    low: delta.low,
    high: delta.high,
});

/** `held(group) − transplant(group)` as a point estimate, for the sub-population checks. */
function pointDifference(rows: readonly LevelRow[]): number | null {
    const held = respectedShare(rows.map(r => r.outcome)).share;
    const placebo = respectedShare(rows.flatMap(r => r.transplant)).share;
    return held === null || placebo === null ? null : held - placebo;
}

/**
 * Fits the score on days before the split (minus the embargo), bands it by the training
 * quintiles and reports the test period. `null` when either period has no resolved level.
 */
export function scoreSummary(
    rows: readonly LevelRow[],
    resampling: Resamplings
): ScoreSummary | null {
    const live = rows.filter(r => r.outcome !== 'skipped');
    const resolved = live.filter(r => isResolved(r.outcome));
    const train = resolved.filter(r => r.time < C.splitTime - C.embargoSeconds);
    const test = resolved.filter(r => r.time >= C.splitTime);
    if (train.length === 0 || test.length === 0) return null;
    const families = [...new Set(resolved.map(r => r.family))].toSorted();
    const weights = fitLogistic(
        train.map(r => featureVector(r, families)),
        train.map(r => (r.outcome === 'respected' ? 1 : 0))
    );
    const score = (r: LevelRow): number => sigmoidScore(r, weights, families);
    const edges = quantileEdges(train.map(score), C.scoreBands);
    const bandTable = (pool: readonly LevelRow[]): BandStat[] =>
        Array.from({ length: C.scoreBands }, (_, band) => ({
            band,
            ...groupStat(
                pool.filter(r => bandOf(score(r), edges) === band),
                resampling
            ),
        }));
    const liveTrain = live.filter(r => r.time < C.splitTime - C.embargoSeconds);
    const liveTest = live.filter(r => r.time >= C.splitTime);
    const top = liveTest.filter(
        r => bandOf(score(r), edges) === C.scoreBands - 1
    );
    const bottom = liveTest.filter(r => bandOf(score(r), edges) === 0);
    const topMinusTransplant =
        top.length === 0
            ? null
            : asInterval(
                  widerDelta(
                      transplantObservations(top),
                      heldObservations(top),
                      resampling
                  )
              );
    const topMinusBottom =
        top.length === 0 || bottom.length === 0
            ? null
            : asInterval(
                  widerDelta(
                      heldObservations(bottom),
                      heldObservations(top),
                      resampling
                  )
              );
    const simple = (r: LevelRow): boolean => r.kinds >= 3 || r.reactions >= 2;
    return {
        trainRows: train.length,
        testRows: test.length,
        weights: Object.fromEntries(
            featureNames(families).map((name, i) => [name, weights[i]])
        ),
        edges,
        aucTrain: auc(
            train.map(score),
            train.map(r => r.outcome === 'respected')
        ),
        aucTest: auc(
            test.map(score),
            test.map(r => r.outcome === 'respected')
        ),
        bandsTrain: bandTable(liveTrain),
        bandsTest: bandTable(liveTest),
        topMinusBottom,
        topMinusTransplant,
        topMinusTransplantByMarket: Object.fromEntries(
            (['us', 'kr'] as const).map(m => [
                m,
                pointDifference(top.filter(r => r.market === m)),
            ])
        ),
        topMinusTransplantByHalf: {
            first: pointDifference(
                top.filter(r => r.time < C.testHalfSplitTime)
            ),
            second: pointDifference(
                top.filter(r => r.time >= C.testHalfSplitTime)
            ),
        },
        simpleRuleTest: {
            within: groupStat(liveTest.filter(simple), resampling),
            outside: groupStat(
                liveTest.filter(r => !simple(r)),
                resampling
            ),
        },
    };
}

// ─── Robustness (barrier sweep) ───────────────────────────────────────────────

/** `[respected real, resolved real, respected placebo, resolved placebo]`. */
export type RobustTally = [number, number, number, number];

export interface RobustRow {
    barrierAtr: number;
    group: string;
    held: Share;
    transplant: Share;
    difference: number | null;
}

/** The groups a level belongs to in the robustness table (the design's). */
export function robustGroups(row: LevelRow): string[] {
    return [
        'all',
        `side=${row.side}`,
        row.kinds >= 3 ? 'kinds>=3' : 'kinds<3',
        row.reactions >= 2 ? 'reactions>=2' : 'reactions<2',
        `fam=${row.family}`,
        row.episodes === 0 ? 'ep0' : 'ep>=1',
        row.time >= C.splitTime ? 'year>=2022' : 'year<2022',
        `mkt=${row.market}`,
    ];
}

/**
 * Adds one level's contribution to the tallies at every swept barrier: the real outcome at
 * the window of its own day and the placebo outcomes at its transplant days' windows.
 */
export function addRobust(
    tallies: Map<string, RobustTally>,
    row: LevelRow,
    window: OutcomeWindow,
    picks: readonly OutcomeWindow[]
): void {
    C.robustBarriersAtr.forEach(barrier => {
        const real = evaluateLevel(row.side, row.price, window, barrier);
        const placebo = picks.map(other =>
            evaluateLevel(
                row.side,
                transplantPrice(row.side, row.dAtr, other),
                other,
                barrier
            )
        );
        robustGroups(row).forEach(group => {
            const key = `${barrier}|${group}`;
            const tally = tallies.get(key) ?? [0, 0, 0, 0];
            if (isResolved(real)) {
                tally[0] += real === 'respected' ? 1 : 0;
                tally[1] += 1;
            }
            placebo.filter(isResolved).forEach(o => {
                tally[2] += o === 'respected' ? 1 : 0;
                tally[3] += 1;
            });
            tallies.set(key, tally);
        });
    });
}

export function robustRows(
    tallies: ReadonlyMap<string, RobustTally>
): RobustRow[] {
    return [...tallies.entries()]
        .toSorted(([a], [b]) => a.localeCompare(b, 'en'))
        .flatMap(([key, [hit, n, placeboHit, placeboN]]) => {
            if (n < C.robustMinN || placeboN === 0) return [];
            const [barrier, ...group] = key.split('|');
            return [
                {
                    barrierAtr: Number(barrier),
                    group: group.join('|'),
                    held: { n, share: hit / n },
                    transplant: { n: placeboN, share: placeboHit / placeboN },
                    difference: hit / n - placeboHit / placeboN,
                },
            ];
        });
}

// ─── Structural ratio and N42 ─────────────────────────────────────────────────

function ranks(values: readonly number[]): number[] {
    const order = values
        .map((value, i) => ({ value, i }))
        .toSorted((a, b) => a.value - b.value);
    const out = Array.from({ length: values.length }, () => 0);
    const state = { start: 0 };
    while (state.start < order.length) {
        const end = order.findIndex(
            (o, k) => k >= state.start && o.value !== order[state.start].value
        );
        const stop = end < 0 ? order.length : end;
        order.slice(state.start, stop).forEach(o => {
            out[o.i] = (state.start + 1 + stop) / 2;
        });
        state.start = stop;
    }
    return out;
}

/** Spearman rank correlation; `null` below three pairs or without variance. */
export function spearman(
    a: readonly number[],
    b: readonly number[]
): number | null {
    if (a.length < 3 || a.length !== b.length) return null;
    const [ra, rb] = [ranks(a), ranks(b)];
    const [ma, mb] = [mean(ra) ?? 0, mean(rb) ?? 0];
    const cov = ra.reduce((s, v, i) => s + (v - ma) * (rb[i] - mb), 0);
    const va = ra.reduce((s, v) => s + (v - ma) ** 2, 0);
    const vb = rb.reduce((s, v) => s + (v - mb) ** 2, 0);
    return va === 0 || vb === 0 ? null : cov / Math.sqrt(va * vb);
}

const countBy = <T>(items: readonly T[], keyOf: (item: T) => string) =>
    items.reduce<Record<string, number>>(
        (acc, item) => ({ ...acc, [keyOf(item)]: (acc[keyOf(item)] ?? 0) + 1 }),
        {}
    );

export interface StructuralSummary {
    days: number;
    measurable: number;
    anchorShare: Record<string, number>;
    ratioMedian: number | null;
    ratioBelowOne: number | null;
    anchorDistanceAtrMedian: { up: number | null; down: number | null };
    horizons: Record<string, number>;
    forward10ByBand: Record<
        string,
        { n: number; mean: number | null; upShare: number | null }
    >;
    spearmanRet10: number | null;
}

/** The structural R:R block's anchors and whether its ratio says anything about the next 10 sessions. */
export function structuralSummary(days: readonly DayRow[]): StructuralSummary {
    const withRatio = days.flatMap(d =>
        d.rr !== null && d.rr.ratio !== null
            ? [{ day: d, rr: d.rr, ratio: d.rr.ratio }]
            : []
    );
    const anchors = withRatio.flatMap(({ rr }) => [
        ANCHOR_FAMILY[rr.upKind] ?? rr.upKind,
        ANCHOR_FAMILY[rr.downKind] ?? rr.downKind,
    ]);
    const counts = countBy(anchors, a => a);
    const bands: readonly (readonly [string, (r: number) => boolean])[] = [
        ['<0.67', r => r < 0.67],
        ['0.67-1.5', r => r >= 0.67 && r < 1.5],
        ['>=1.5', r => r >= 1.5],
    ];
    const withReturn = withRatio.flatMap(x =>
        x.day.ret10 === null ? [] : [{ ...x, ret10: x.day.ret10 }]
    );
    return {
        days: days.length,
        measurable: withRatio.length,
        anchorShare: Object.fromEntries(
            Object.entries(counts)
                .toSorted(([, a], [, b]) => b - a)
                .map(([k, v]) => [k, v / anchors.length])
        ),
        ratioMedian: median(withRatio.map(x => x.ratio)),
        ratioBelowOne:
            withRatio.length === 0
                ? null
                : withRatio.filter(x => x.ratio < 1).length / withRatio.length,
        anchorDistanceAtrMedian: {
            up: median(withRatio.map(x => x.rr.upAtr)),
            down: median(withRatio.map(x => x.rr.downAtr)),
        },
        horizons: countBy(withRatio, x => x.rr.horizon),
        forward10ByBand: Object.fromEntries(
            bands.map(([name, inBand]) => {
                const own = withReturn.filter(x => inBand(x.ratio));
                return [
                    name,
                    {
                        n: own.length,
                        mean: mean(own.map(x => x.ret10)),
                        upShare:
                            own.length === 0
                                ? null
                                : own.filter(x => x.ret10 > 0).length /
                                  own.length,
                    },
                ];
            })
        ),
        spearmanRet10: spearman(
            withReturn.map(x => x.ratio),
            withReturn.map(x => x.ret10)
        ),
    };
}

export interface NonPositiveSummary {
    days: number;
    /** Days with a non-positive level in a horizon (the N42 count). */
    daysWithHorizonLevel: number;
    daysWithPrintedLevel: number;
    daysWithFibOverlayLevel: number;
    /** Non-positive levels summed over every surface and day: the G42 figure. */
    total: number;
    share: number | null;
    symbols: string[];
    labels: Record<string, number>;
    examples: { symbol: string; time: number; labels: readonly string[] }[];
}

export function nonPositiveSummary(
    days: readonly DayRow[]
): NonPositiveSummary {
    const hit = days.filter(d => d.nonPositive.horizons > 0);
    return {
        days: days.length,
        daysWithHorizonLevel: hit.length,
        daysWithPrintedLevel: days.filter(d => d.nonPositive.printed > 0)
            .length,
        daysWithFibOverlayLevel: days.filter(d => d.nonPositive.fibOverlay > 0)
            .length,
        total: days.reduce(
            (s, d) =>
                s +
                d.nonPositive.horizons +
                d.nonPositive.printed +
                d.nonPositive.fibOverlay,
            0
        ),
        share: days.length === 0 ? null : hit.length / days.length,
        symbols: [...new Set(hit.map(d => d.symbol))].toSorted(),
        labels: countBy(
            hit.flatMap(d => d.nonPositive.labels),
            l => l.split(':')[1] ?? l
        ),
        examples: hit.slice(0, 4).map(d => ({
            symbol: d.symbol,
            time: d.time,
            labels: d.nonPositive.labels.slice(0, 2),
        })),
    };
}
