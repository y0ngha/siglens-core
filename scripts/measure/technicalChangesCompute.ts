/**
 * The pure parts of the technical-changes measurement (WP-28 core-1): per symbol-session
 * counts of each change kind with `fromIndex = last - 1`, the share of trend changes that
 * revert within three sessions, and the share of sessions on which a random 10-symbol list
 * would produce at least one line.
 *
 * The rules below are pre-registered before the first run; a result changes a decision only
 * through them (CONVENTIONS.md#TE-16 style: constants are named, the verdict is computed,
 * nothing is tuned after reading the numbers).
 */
import { technicalChangesBetween } from '@/domain/analysis/technicalChanges';
import type {
    Bar,
    ConfirmedSignalType,
    SignalDirection,
    Trend,
} from '@/domain/types';

/**
 * The eight signal types of siglens `src/entities/signal-history/lib/signalHubs.ts`
 * (`SIGNAL_HUBS`), which the morning mail's signal lines use. Core has no notion of a hub, so
 * the list is data of the instrument: frozen for the WP-28 pre-registered measurement;
 * re-measure if `SIGNAL_HUBS` changes.
 */
export const HUB_SIGNAL_TYPES: readonly ConfirmedSignalType[] = [
    'golden_cross',
    'death_cross',
    'new_52w_high',
    'new_52w_low',
    'rsi_oversold',
    'rsi_overbought',
    'macd_bullish_cross',
    'macd_bearish_cross',
];

/** First measured bar index of a symbol: the same "from bar 300" the WP-15 trend measurement used. */
export const START_INDEX = 300;
/**
 * Bars handed to a session's computation: the trailing window (the last bar plus 419 before),
 * enough for the 365-calendar-day 52-week signals and the 400-day signal timeline window.
 */
export const WINDOW_BARS = 420;
/** A trend change is "reverted" when the label is back to the old one within this many sessions. */
export const REVERT_SESSIONS = 3;
/** Pre-registered: above this share of reverted trend changes the suppression key is per symbol. */
export const REVERT_SHARE_THRESHOLD = 0.3;
/** The mail lists up to this many symbols a subscriber watches in the measured scenario. */
export const LIST_SIZE = 10;
/** Pre-registered: above this share of sessions with a line, report to the orchestrator. */
export const ALMOST_DAILY_THRESHOLD = 0.8;

export interface SessionRecord {
    readonly time: number;
    /** `false` when the session could not be measured at all (`technicalChangesBetween` gave `ok: false`). */
    readonly measured: boolean;
    /** The computed trend was readable at both ends; `false` means "no trend item" proves nothing. */
    readonly trendMeasured: boolean;
    /** Sessions of the window whose new-signal question could not be answered (`0`: all judged). */
    readonly unevaluatedSignalDays: number;
    readonly trend: { readonly from: Trend; readonly to: Trend } | null;
    readonly signals: readonly {
        readonly type: ConfirmedSignalType;
        readonly direction: SignalDirection;
    }[];
}

export interface SymbolSessions {
    readonly symbol: string;
    readonly sessions: readonly SessionRecord[];
}

/**
 * One symbol's sessions from `START_INDEX` on (every `stride`-th, 1 for all): the trend change
 * and the hub signals that began on that session's bar, no reference analysis.
 */
export function measureSymbol(
    symbol: string,
    bars: readonly Bar[],
    stride = 1
): SymbolSessions {
    const indexes = Array.from(
        { length: Math.max(0, bars.length - START_INDEX) },
        (_, k) => START_INDEX + k
    ).filter((_, k) => k % stride === 0);
    const sessions = indexes.map((index): SessionRecord => {
        const window = bars.slice(
            Math.max(0, index + 1 - WINDOW_BARS),
            index + 1
        );
        const result = technicalChangesBetween(window, {
            fromIndex: window.length - 2,
            signalTypes: HUB_SIGNAL_TYPES,
        });
        const time = bars[index].time;
        if (!result.ok) {
            return {
                time,
                measured: false,
                trendMeasured: false,
                unevaluatedSignalDays: 0,
                trend: null,
                signals: [],
            };
        }
        const trend = result.changes.find(c => c.kind === 'trend_changed');
        return {
            time,
            measured: true,
            trendMeasured: result.trendMeasured,
            unevaluatedSignalDays: result.unevaluatedSignalDays,
            trend:
                trend?.kind === 'trend_changed'
                    ? { from: trend.from, to: trend.to }
                    : null,
            signals: result.changes.flatMap(c =>
                c.kind === 'signal_started'
                    ? [{ type: c.type, direction: c.direction }]
                    : []
            ),
        };
    });
    return { symbol, sessions };
}

/**
 * Share of trend changes whose label is back to the old one within `REVERT_SESSIONS`
 * sessions. A change counts only with that many consecutive sessions after it whose trend was
 * measured (stride 1); a label is never carried across a session whose trend was not
 * measured, so such a change is left out of the denominator instead of guessed.
 * The label of a later session is the `to` of its own change, else the label before it.
 */
export function revertedShare(all: readonly SymbolSessions[]): {
    readonly changes: number;
    readonly reverted: number;
    readonly share: number | null;
} {
    const tally = all.flatMap(({ sessions }) =>
        sessions.flatMap((session, i) => {
            if (session.trend === null) return [];
            const after = sessions.slice(i + 1, i + 1 + REVERT_SESSIONS);
            if (
                after.length < REVERT_SESSIONS ||
                after.some(s => !s.measured || !s.trendMeasured)
            ) {
                return [];
            }
            const labels = after.reduce<Trend[]>(
                (seen, next) => [
                    ...seen,
                    next.trend?.to ?? seen[seen.length - 1],
                ],
                [session.trend.to]
            );
            return [labels.slice(1).includes(session.trend.from)];
        })
    );
    const reverted = tally.filter(Boolean).length;
    return {
        changes: tally.length,
        reverted,
        share: tally.length === 0 ? null : reverted / tally.length,
    };
}

/** `1 - C(n - m, k) / C(n, k)`: the chance a random k-subset of n symbols holds one of the m with a line. */
export function atLeastOneInSample(n: number, m: number, k: number): number {
    if (n <= 0 || m <= 0) return 0;
    const size = Math.min(k, n);
    if (n - m < size) return 1;
    const missProbability = Array.from({ length: size }, (_, j) => j).reduce(
        (p, j) => (p * (n - m - j)) / (n - j),
        1
    );
    return 1 - missProbability;
}

export interface LineShares {
    /** Dates on which at least `LIST_SIZE` symbols had a known answer for "any line". */
    readonly dates: number;
    /** Mean over dates of the chance a random list produces at least one line, any kind. */
    readonly anyLine: number | null;
    readonly trendOnly: number | null;
    readonly signalOnly: number | null;
}

const mean = (values: readonly number[]): number | null =>
    values.length === 0
        ? null
        : values.reduce((sum, v) => sum + v, 0) / values.length;

interface DateCell {
    /** Per question: sessions whose answer is known, and how many of them had a line. */
    readonly trend: { readonly known: number; readonly lines: number };
    readonly signal: { readonly known: number; readonly lines: number };
    readonly any: { readonly known: number; readonly lines: number };
}

const EMPTY_CELL: DateCell = {
    trend: { known: 0, lines: 0 },
    signal: { known: 0, lines: 0 },
    any: { known: 0, lines: 0 },
};

const bump = (
    tally: DateCell['trend'],
    known: boolean,
    line: boolean
): DateCell['trend'] => ({
    known: tally.known + (known ? 1 : 0),
    lines: tally.lines + (known && line ? 1 : 0),
});

/**
 * Expected share of sessions with at least one line for a random `LIST_SIZE`-symbol list.
 * Each question has its own denominator: a session whose trend was not measured is not
 * counted as "no trend line", one with unevaluated signal days is not counted as "no signal
 * line", and for "any line" such a session counts only when it has a line anyway.
 */
export function lineShares(all: readonly SymbolSessions[]): LineShares {
    const byDate = new Map<number, DateCell>();
    for (const { sessions } of all) {
        for (const session of sessions) {
            if (!session.measured) continue;
            const cell = byDate.get(session.time) ?? EMPTY_CELL;
            const hasTrend = session.trend !== null;
            const hasSignal = session.signals.length > 0;
            const trendKnown = session.trendMeasured;
            const signalKnown = session.unevaluatedSignalDays === 0;
            byDate.set(session.time, {
                trend: bump(cell.trend, trendKnown, hasTrend),
                signal: bump(cell.signal, signalKnown, hasSignal),
                any: bump(
                    cell.any,
                    (trendKnown && signalKnown) || hasTrend || hasSignal,
                    hasTrend || hasSignal
                ),
            });
        }
    }
    const cells = [...byDate.values()];
    const share = (pick: (c: DateCell) => DateCell['trend']) => {
        const usable = cells.filter(c => pick(c).known >= LIST_SIZE);
        return mean(
            usable.map(c =>
                atLeastOneInSample(pick(c).known, pick(c).lines, LIST_SIZE)
            )
        );
    };
    return {
        dates: cells.filter(c => c.any.known >= LIST_SIZE).length,
        anyLine: share(c => c.any),
        trendOnly: share(c => c.trend),
        signalOnly: share(c => c.signal),
    };
}

export interface Measurement {
    readonly symbols: number;
    readonly sessions: number;
    readonly unmeasured: number;
    /** Measured sessions left out of a denominator, reported apart from the shares. */
    readonly excluded: {
        /** Trend not readable at an end: out of the trend denominators and the revert share. */
        readonly trendUnmeasured: number;
        /** Sessions with unevaluated signal days: out of the signal denominators. */
        readonly signalUnevaluated: number;
    };
    readonly counts: {
        readonly trendChanged: number;
        readonly signalStarted: number;
        readonly signalStartedByType: Readonly<Record<string, number>>;
        /** Levels and plan items need a reference analysis; this run has none. */
        readonly levelCrossed: 0;
        readonly planPositionChanged: 0;
    };
    readonly trendRevert: ReturnType<typeof revertedShare>;
    readonly lineShares: LineShares;
    /** The pre-registered decisions the numbers above lead to. */
    readonly decisions: {
        readonly trendSuppressionKey: 'per_symbol' | 'per_target_label';
        readonly reportAlmostDaily: boolean;
    };
}

export function summarize(all: readonly SymbolSessions[]): Measurement {
    const sessions = all.flatMap(s => s.sessions);
    const measured = sessions.filter(s => s.measured);
    const signals = measured.flatMap(s => s.signals);
    const byType = signals.reduce<Record<string, number>>(
        (acc, s) => ({ ...acc, [s.type]: (acc[s.type] ?? 0) + 1 }),
        {}
    );
    const revert = revertedShare(all);
    const shares = lineShares(all);
    return {
        symbols: all.length,
        sessions: measured.length,
        unmeasured: sessions.length - measured.length,
        excluded: {
            trendUnmeasured: measured.filter(s => !s.trendMeasured).length,
            signalUnevaluated: measured.filter(s => s.unevaluatedSignalDays > 0)
                .length,
        },
        counts: {
            trendChanged: measured.filter(s => s.trend !== null).length,
            signalStarted: signals.length,
            signalStartedByType: byType,
            levelCrossed: 0,
            planPositionChanged: 0,
        },
        trendRevert: revert,
        lineShares: shares,
        decisions: {
            trendSuppressionKey:
                revert.share !== null && revert.share > REVERT_SHARE_THRESHOLD
                    ? 'per_symbol'
                    : 'per_target_label',
            reportAlmostDaily:
                shares.anyLine !== null &&
                shares.anyLine > ALMOST_DAILY_THRESHOLD,
        },
    };
}
