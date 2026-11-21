import { medianOfSorted, round2 } from '@/domain/agent/statsMath';
import { formatPlainNumber } from '@/domain/plainNumber';

/** One past earnings report and the stock's reaction; `movePct` is `null` when it could not be measured. */
export interface EarningsReactionInput {
    /** ISO `YYYY-MM-DD` calendar date of the report's reaction. */
    readonly date: string;
    readonly movePct: number | null;
}

/** The report with the largest move in one direction. */
export interface EarningsReactionExtreme {
    date: string;
    movePct: number;
}

/** Counts, extremes and a one-line summary of past earnings reactions, computed so the model never counts a list itself. */
export interface EarningsReactionTally {
    /** Entries with a finite `movePct`; every other field is derived from these only. */
    measured: number;
    /** Entries with `movePct > 0`. */
    up: number;
    /** Entries with `movePct < 0`. */
    down: number;
    /** Entries with `movePct === 0`. */
    flat: number;
    /** Largest positive move; on a tie the later date. `null` when nothing rose. */
    largestRise: EarningsReactionExtreme | null;
    /** Most negative move; on a tie the later date. `null` when nothing fell. */
    largestFall: EarningsReactionExtreme | null;
    /** Median of `|movePct|` over the measured entries, 2 decimals; `null` when `measured` is 0. */
    medianAbsMovePct: number | null;
    /** One deterministic English line; `null` when `measured` is 0. */
    summary: string | null;
}

interface MeasuredReaction {
    date: string;
    movePct: number;
}

function isMeasured(
    reaction: EarningsReactionInput
): reaction is MeasuredReaction {
    return (
        typeof reaction.movePct === 'number' &&
        Number.isFinite(reaction.movePct)
    );
}

/**
 * Keeps `candidate` when it is the larger by `rank`, or equal and later in date
 * (ISO dates compare as strings). `rank` is the move itself for rises and its
 * negation for falls, so one reducer serves both sides.
 */
function pickExtreme(
    current: MeasuredReaction | null,
    candidate: MeasuredReaction,
    rank: (movePct: number) => number
): MeasuredReaction {
    if (current === null) return candidate;
    const currentRank = rank(current.movePct);
    const candidateRank = rank(candidate.movePct);
    if (candidateRank !== currentRank) {
        return candidateRank > currentRank ? candidate : current;
    }
    return candidate.date > current.date ? candidate : current;
}

function toExtreme(
    reactions: readonly MeasuredReaction[],
    rank: (movePct: number) => number
): EarningsReactionExtreme | null {
    const picked = reactions.reduce<MeasuredReaction | null>(
        (best, reaction) => pickExtreme(best, reaction, rank),
        null
    );
    return picked === null
        ? null
        : { date: picked.date, movePct: picked.movePct };
}

function signedPct(movePct: number): string {
    const text = formatPlainNumber(movePct);
    return movePct > 0 ? `+${text}%` : `${text}%`;
}

function extremeClause(
    label: string,
    extreme: EarningsReactionExtreme | null
): string | null {
    return extreme === null
        ? null
        : `${label} ${signedPct(extreme.movePct)} (${extreme.date})`;
}

function buildSummary(
    tally: Omit<EarningsReactionTally, 'summary'>,
    median: number
): string {
    const counts = [
        `${tally.up} up`,
        `${tally.down} down`,
        ...(tally.flat > 0 ? [`${tally.flat} flat`] : []),
    ].join(', ');
    const noun = tally.measured === 1 ? 'report' : 'reports';
    const extremes = [
        extremeClause('largest rise', tally.largestRise),
        extremeClause('largest fall', tally.largestFall),
    ]
        .filter((clause): clause is string => clause !== null)
        .join(', ');
    return [
        `${tally.measured} ${noun} measured: ${counts}`,
        ...(extremes === '' ? [] : [extremes]),
        `median move size ${formatPlainNumber(median)}%`,
    ].join('; ');
}

/**
 * Tallies past earnings reactions: how many rose, fell or did not move, the largest
 * rise and fall, and the median size of a move.
 *
 * Only entries with a finite `movePct` count; `null`, `NaN` and `Infinity` are not
 * measured, so a missing reaction is never read as flat. Values print exactly as
 * given (the caller rounds), so the summary matches the list it describes. The
 * result does not depend on list order: extremes tie-break on the later ISO date.
 *
 * @param reactions - Past reports with their measured moves, any order.
 * @returns The tally; `measured` is 0 and `summary` is `null` when nothing was measured.
 */
export function tallyEarningsReactions(
    reactions: readonly EarningsReactionInput[]
): EarningsReactionTally {
    const measured = reactions.filter(isMeasured);
    const rises = measured.filter(reaction => reaction.movePct > 0);
    const falls = measured.filter(reaction => reaction.movePct < 0);
    const sortedAbs = measured
        .map(reaction => Math.abs(reaction.movePct))
        .sort((a, b) => a - b);
    const rawMedian = medianOfSorted(sortedAbs);
    const median = rawMedian === null ? null : round2(rawMedian);
    const base: Omit<EarningsReactionTally, 'summary'> = {
        measured: measured.length,
        up: rises.length,
        down: falls.length,
        flat: measured.length - rises.length - falls.length,
        largestRise: toExtreme(rises, movePct => movePct),
        largestFall: toExtreme(falls, movePct => -movePct),
        medianAbsMovePct: median,
    };
    return {
        ...base,
        summary: median === null ? null : buildSummary(base, median),
    };
}
