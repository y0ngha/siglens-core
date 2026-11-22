/**
 * The numbers of the measured signal base-rate table (WP-32 G14-core): for every confirmed
 * signal type, how often the close `h` bars after the signal's first confirmed bar sits on
 * the signal's side of that bar, next to the same share on matched placebo dates of the same
 * symbol, at all four outcome horizons. Pure functions over bars; `signalBaseRateTable.ts`
 * loads the frozen set, refuses what it cannot trust and writes the table.
 *
 * Pre-registered definitions (a change of any of them regenerates the table):
 *  - Episode: `confirmedSignalTimeline` over the symbol's daily bars. A type's episode starts
 *    on a bar where it is confirmed and the previous evaluated bar is known (`signals` not
 *    `null`) and did not confirm it. This mirrors `signal_events`, which records one row per
 *    first-seen session. A bar that could not be evaluated never starts an episode.
 *  - Anchor: the close of the first confirmed bar, at least `minPriorBars` bars into the data.
 *  - Outcome at `h` in `OUTCOME_HORIZON_BARS` (1, 5, 10, 20 bars): hit iff
 *    `direction * (close[t+h] - close[t]) > 0`, `direction` being the detector's own side.
 *    An episode whose `t + h` lies beyond the data has no outcome at `h` and leaves that
 *    horizon's `n` (not the other horizons).
 *  - Placebo: up to `placeboCount` dates of the same symbol within `placeboRadius` bars,
 *    more than `OUTCOME_HORIZON_BARS`' longest horizon away from the episode (forward
 *    windows never overlap) and with the same prior-move bucket as the anchor; the share of
 *    them whose own outcome at `h` is a hit, under the same direction. An episode with fewer
 *    than `minPlacebo` such dates is dropped and counted.
 *  - Verdict per horizon (the WP-18 rule, `verdictOf`): `insufficient_sample` below
 *    `BASE_RATE_MIN_N` episodes with an outcome at that horizon; `beats_placebo` iff the
 *    Holm-adjusted test (across the types at or above the floor, per horizon) rejects zero,
 *    the difference and the low bound of its interval are positive, and the sign holds in
 *    both time halves and in the US and Korean markets separately; `no_edge` otherwise.
 *  - No return figure is stored anywhere: only shares of directional moves.
 */
import { calculateATR } from '@/domain/indicators/atr';
import { OUTCOME_HORIZON_BARS } from '@/domain/outcomes/constants';
import type {
    Bar,
    ConfirmedSignalType,
    SignalDirection,
    SignalType,
} from '@/domain/types';
import type { ConfirmedSignalDay } from '@/domain/signals/timeline';
import { priorBucket, eligiblePlaceboDates } from './engineEvalCandles';
import {
    BASE_RATE_ALPHA,
    BASE_RATE_MIN_N,
    verdictOf,
    type BaseRateVerdict,
    type VerdictInputs,
} from './baseRateTableCompute';
import {
    edgeStat,
    makeResamplings,
    toBlocks,
    widerInterval,
    type EdgeStat,
} from './engineEvalCompute';
import {
    halfOf,
    holmAdjust,
    isoDate,
    isoWeekKey,
    sampleWithoutReplacement,
    streamForKey,
} from './engineEvalStats';
import {
    EVAL_CONSTANTS,
    type EvalHalf,
    type EvalMarket,
    type Observation,
} from './engineEvalTypes';
import { mean } from './stats';

const { minPriorBars, placeboCount, minPlacebo, seed } = EVAL_CONSTANTS;

/** The horizons the table carries: all four, in this order, for every type. */
export const SIGNAL_HORIZONS = [1, 5, 10, 20] as const;
export type SignalHorizon = (typeof SIGNAL_HORIZONS)[number];

/** The longest horizon: the placebo's exclusion zone around an event. */
const MAX_HORIZON = SIGNAL_HORIZONS[SIGNAL_HORIZONS.length - 1];

/**
 * The confirmed signal types the table covers, each with its direction. Exhaustive over
 * `ConfirmedSignalType`: a new detector type fails the type check here, and a type whose
 * detector reports another direction than the one declared here fails the run. Every
 * confirmed type is directional; a non-directional type would have to be left out of this
 * record by a decision recorded here, not silently.
 */
export const SIGNAL_TYPE_DIRECTIONS = {
    rsi_oversold: 'bullish',
    rsi_overbought: 'bearish',
    golden_cross: 'bullish',
    death_cross: 'bearish',
    short_ma_bullish_cross: 'bullish',
    short_ma_bearish_cross: 'bearish',
    macd_bullish_cross: 'bullish',
    macd_bearish_cross: 'bearish',
    bollinger_lower_bounce: 'bullish',
    bollinger_upper_breakout: 'bearish',
    bollinger_percentb_oversold: 'bullish',
    bollinger_percentb_overbought: 'bearish',
    supertrend_bullish_flip: 'bullish',
    parabolic_sar_flip: 'bullish',
    ichimoku_cloud_breakout: 'bullish',
    cci_bullish_cross: 'bullish',
    dmi_bullish_cross: 'bullish',
    cmf_bullish_flip: 'bullish',
    mfi_oversold_bounce: 'bullish',
    keltner_upper_breakout: 'bullish',
    squeeze_momentum_bullish: 'bullish',
    keltner_lower_breakout: 'bearish',
    supertrend_bearish_flip: 'bearish',
    ichimoku_cloud_breakdown: 'bearish',
    cci_bearish_cross: 'bearish',
    dmi_bearish_cross: 'bearish',
    cmf_bearish_flip: 'bearish',
    mfi_overbought_reversal: 'bearish',
    parabolic_sar_bearish_flip: 'bearish',
    squeeze_momentum_bearish: 'bearish',
    new_52w_high: 'bullish',
    new_52w_low: 'bearish',
    gap_up: 'bullish',
    gap_down: 'bearish',
} as const satisfies Record<ConfirmedSignalType, SignalDirection>;

export const SIGNAL_TYPES: readonly ConfirmedSignalType[] = (
    Object.keys(SIGNAL_TYPE_DIRECTIONS) as ConfirmedSignalType[]
).toSorted();

export const isMeasuredType = (type: string): type is ConfirmedSignalType =>
    Object.hasOwn(SIGNAL_TYPE_DIRECTIONS, type);

/** `OUTCOME_HORIZON_BARS` is core's; the table is only valid for the horizons it was written for. */
export function assertHorizonsUnchanged(): void {
    if (
        JSON.stringify(OUTCOME_HORIZON_BARS) !== JSON.stringify(SIGNAL_HORIZONS)
    ) {
        throw new Error(
            `OUTCOME_HORIZON_BARS is ${JSON.stringify(OUTCOME_HORIZON_BARS)}, the signal table was written for ${JSON.stringify(SIGNAL_HORIZONS)}: decide and regenerate`
        );
    }
}

// ─── Episodes ─────────────────────────────────────────────────────────────────

/** A type's first confirmed bar in a run of confirmed bars, as an index into the evaluated days. */
export interface EpisodeStart {
    type: SignalType;
    direction: SignalDirection;
    /** Index into the `days` the episodes were read from. */
    day: number;
}

/**
 * Episode starts of a timeline. The first day only supplies the "previous bar" of the next
 * one; a day or a previous day that was not evaluated (`signals: null`) starts nothing.
 */
export function episodeStarts(
    days: readonly ConfirmedSignalDay[]
): EpisodeStart[] {
    return days.flatMap((day, i) => {
        const previous = i === 0 ? null : days[i - 1].signals;
        const today = day.signals;
        if (previous === null || today === null) return [];
        const seen = new Set(previous.map(s => s.type));
        const fresh = new Map(
            today
                .filter(s => !seen.has(s.type))
                .map(s => [s.type, s.direction] as const)
        );
        return [...fresh].map(([type, direction]) => ({
            type,
            direction,
            day: i,
        }));
    });
}

/** The outcome of one episode at one horizon: the event's hit and its placebo's hit share. */
export interface HorizonOutcome {
    hit: 0 | 1;
    placeboShare: number;
}

export interface SignalEpisode {
    symbol: string;
    market: EvalMarket;
    type: ConfirmedSignalType;
    direction: SignalDirection;
    /** Index of the anchor bar in the symbol's bars. */
    index: number;
    date: string;
    week: string;
    half: EvalHalf;
    /** One entry per `SIGNAL_HORIZONS`; `null` when `index + h` lies beyond the data. */
    outcomes: readonly (HorizonOutcome | null)[];
}

export interface SymbolEpisodes {
    episodes: SignalEpisode[];
    /** Episodes with fewer than `minPlacebo` placebo dates, per type. */
    dropped: Partial<Record<ConfirmedSignalType, number>>;
    /** Evaluated days that could not be read (`signals: null`). */
    unevaluatedDays: number;
}

const sign = (direction: SignalDirection): 1 | -1 =>
    direction === 'bullish' ? 1 : -1;

const hitAt = (
    bars: readonly Bar[],
    t: number,
    h: number,
    direction: 1 | -1
): 0 | 1 => (direction * (bars[t + h].close - bars[t].close) > 0 ? 1 : 0);

/**
 * Episodes of one symbol, read from the timeline of its bars (`confirmedSignalTimeline`
 * with `days = bars.length - (minPriorBars - 1)`, passed in by the caller so this stays
 * pure). `days[i]` is the bar at index `firstIndex + i`.
 */
export function episodesForSymbol(
    symbol: string,
    market: EvalMarket,
    bars: readonly Bar[],
    days: readonly ConfirmedSignalDay[]
): SymbolEpisodes {
    const firstIndex = bars.length - days.length;
    const atr = calculateATR([...bars]);
    const starts = episodeStarts(days);
    const built = starts.map(start => {
        const type = start.type;
        if (!isMeasuredType(type)) {
            throw new Error(
                `signal type ${type} is not in SIGNAL_TYPE_DIRECTIONS: decide whether it is measured`
            );
        }
        const declared = SIGNAL_TYPE_DIRECTIONS[type];
        if (declared !== start.direction) {
            throw new Error(
                `signal type ${type} was detected as ${start.direction} but is declared ${declared}`
            );
        }
        const t = firstIndex + start.day;
        const direction = sign(start.direction);
        const bucket = priorBucket(bars, atr, t);
        const dates = sampleWithoutReplacement(
            eligiblePlaceboDates(
                atr,
                bars.length,
                t,
                MAX_HORIZON,
                candidate => priorBucket(bars, atr, candidate) === bucket
            ),
            placeboCount,
            streamForKey(seed, `signal|${symbol}|${type}|${t}`)
        );
        return { start, type, t, direction, dates };
    });
    const placed = built.filter(
        b => b.t >= minPriorBars && b.dates.length >= minPlacebo
    );
    const droppedEpisodes = built.filter(
        b => b.t >= minPriorBars && b.dates.length < minPlacebo
    );
    const episodes = placed.map(({ start, type, t, direction, dates }) => {
        const time = bars[t].time;
        return {
            symbol,
            market,
            type,
            direction: start.direction,
            index: t,
            date: isoDate(time),
            week: isoWeekKey(time),
            half: halfOf(time),
            outcomes: SIGNAL_HORIZONS.map((h): HorizonOutcome | null =>
                t + h > bars.length - 1
                    ? null
                    : {
                          hit: hitAt(bars, t, h, direction),
                          placeboShare:
                              mean(
                                  dates.map(d => hitAt(bars, d, h, direction))
                              ) ?? Number.NaN,
                      }
            ),
        };
    });
    return {
        episodes,
        dropped: droppedEpisodes.reduce<
            Partial<Record<ConfirmedSignalType, number>>
        >(
            (acc, b) => ({
                ...acc,
                [b.type]: (acc[b.type] ?? 0) + 1,
            }),
            {}
        ),
        unevaluatedDays: days.filter(d => d.signals === null).length,
    };
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

export interface SignalScope {
    timeframe: '1Day';
    /** Symbols measured per market; the episodes of all of them are pooled, never split. */
    markets: readonly { market: EvalMarket; symbols: number }[];
    composition: 'pooled';
    symbols: number;
    /** First and last anchor date over all measured episodes of all types. */
    from: string;
    to: string;
}

export interface HorizonStats {
    eventShare: number;
    placeboShare: number;
    difference: { mean: number; low: number; high: number };
}

export interface HorizonCell {
    h: SignalHorizon;
    /** Episodes with an outcome at this horizon (and enough placebo dates). */
    n: number;
    verdict: BaseRateVerdict;
    /** `null` exactly when the verdict is `insufficient_sample`: below the floor nothing is stated. */
    stats: HorizonStats | null;
}

export interface SignalRow {
    signalType: ConfirmedSignalType;
    direction: SignalDirection;
    horizons: readonly HorizonCell[];
    scope: SignalScope;
}

export interface HorizonDetail {
    type: ConfirmedSignalType;
    h: SignalHorizon;
    inputs: VerdictInputs;
    holmP: number | null;
}

export interface SignalTable {
    rows: readonly SignalRow[];
    details: readonly HorizonDetail[];
    /** Episodes per type before outcomes are cut by horizon. */
    episodeCounts: Readonly<Record<string, number>>;
}

interface Measure {
    n: number;
    eventShare: number | null;
    placeboShare: number | null;
    week: EdgeStat;
    low: number | null;
    high: number | null;
    p: number | null;
    splits: VerdictInputs['splits'];
}

interface Observed {
    episode: SignalEpisode;
    outcome: HorizonOutcome;
}

const observe = (own: readonly Observed[]): Observation[] =>
    own.map(({ episode, outcome }) => ({
        week: episode.week,
        value: outcome.hit - outcome.placeboShare,
    }));

const meanOrNull = (own: readonly Observed[]): number | null =>
    mean(observe(own).map(o => o.value));

function measureOf(
    own: readonly Observed[],
    resamplings: ReturnType<typeof makeResamplings>
): Measure {
    const observations = observe(own);
    const week = edgeStat(observations, resamplings.weeks);
    const block = edgeStat(toBlocks(observations), resamplings.blocks);
    const wider = widerInterval(week, block);
    const at = (pick: (o: Observed) => boolean): number | null =>
        meanOrNull(own.filter(pick));
    return {
        n: own.length,
        eventShare: mean(own.map(o => o.outcome.hit)),
        placeboShare: mean(own.map(o => o.outcome.placeboShare)),
        week,
        low: wider.low,
        high: wider.high,
        p:
            week.p === null || block.p === null
                ? null
                : Math.max(week.p, block.p),
        splits: {
            early: at(o => o.episode.half === 'early'),
            late: at(o => o.episode.half === 'late'),
            us: at(o => o.episode.market === 'us'),
            kr: at(o => o.episode.market === 'kr'),
        },
    };
}

const finite = (value: number | null, what: string): number => {
    if (value === null || !Number.isFinite(value)) {
        throw new Error(`signal base-rate row: ${what} is not computable`);
    }
    return value;
};

function statsOf(m: Measure, label: string): HorizonStats {
    return {
        eventShare: finite(m.eventShare, `${label} event share`),
        placeboShare: finite(m.placeboShare, `${label} placebo share`),
        difference: {
            mean: finite(m.week.mean, `${label} difference`),
            low: finite(m.low, `${label} interval low`),
            high: finite(m.high, `${label} interval high`),
        },
    };
}

/**
 * The table of a set: one row per type of `SIGNAL_TYPE_DIRECTIONS`, always with all four
 * horizons. Throws (the generator exits 2) when a type has no episode at all or a horizon at
 * or above the floor has a figure that cannot be computed.
 */
export function signalTable(
    episodes: readonly SignalEpisode[],
    weeks: readonly string[],
    markets: SignalScope['markets']
): SignalTable {
    const resamplings = makeResamplings(weeks);
    const dates = episodes.map(e => e.date).toSorted();
    const scope: SignalScope = {
        timeframe: '1Day',
        markets,
        composition: 'pooled',
        symbols: markets.reduce((sum, m) => sum + m.symbols, 0),
        from: dates[0] ?? '',
        to: dates[dates.length - 1] ?? '',
    };
    const empty = SIGNAL_TYPES.filter(
        type => !episodes.some(e => e.type === type)
    );
    if (empty.length > 0) {
        throw new Error(
            `no episode at all for ${empty.join(', ')}: a type with zero episodes is not measurable on this set`
        );
    }
    const perType = SIGNAL_TYPES.map(type => ({
        type,
        own: episodes.filter(e => e.type === type),
    }));
    // measures[h][type]
    const measures = SIGNAL_HORIZONS.map((_, hi) =>
        perType.map(({ type, own }) => ({
            type,
            measure: measureOf(
                own.flatMap(episode => {
                    const outcome = episode.outcomes[hi];
                    return outcome === null ? [] : [{ episode, outcome }];
                }),
                resamplings
            ),
        }))
    );
    const holm = measures.map(perHorizon => {
        const eligible = perHorizon.filter(m => m.measure.n >= BASE_RATE_MIN_N);
        const adjusted = holmAdjust(eligible.map(m => m.measure.p));
        return new Map(eligible.map((m, i) => [m.type, adjusted[i]]));
    });
    const built = perType.map(({ type }, ti) => {
        const parts = SIGNAL_HORIZONS.map((h, hi) => {
            const m = measures[hi][ti].measure;
            const holmP = holm[hi].get(type) ?? null;
            const inputs: VerdictInputs = {
                n: m.n,
                significant:
                    m.n < BASE_RATE_MIN_N || holmP === null
                        ? null
                        : holmP < BASE_RATE_ALPHA,
                mean: m.week.mean,
                low: m.low,
                splits: m.splits,
            };
            const detail: HorizonDetail = { type, h, inputs, holmP };
            const verdict = verdictOf(inputs);
            const cell: HorizonCell =
                verdict === 'insufficient_sample'
                    ? { h, n: m.n, verdict, stats: null }
                    : {
                          h,
                          n: m.n,
                          verdict,
                          stats: statsOf(m, `${type} h${h}`),
                      };
            return { cell, detail };
        });
        const row: SignalRow = {
            signalType: type,
            direction: SIGNAL_TYPE_DIRECTIONS[type],
            horizons: parts.map(p => p.cell),
            scope,
        };
        return { row, details: parts.map(p => p.detail) };
    });
    const rows = built.map(b => b.row);
    const details = built.flatMap(b => b.details);
    return {
        rows,
        details,
        episodeCounts: Object.fromEntries(
            perType.map(({ type, own }) => [type, own.length])
        ),
    };
}
