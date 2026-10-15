import {
    LARGE_HOLDER_13G_POINTS_CAP,
    LARGE_HOLDER_WINDOW_DAYS,
} from '@/domain/investorFlows/constants';
import {
    clampScore,
    daysBetween,
    isFiniteNumber,
    isVisibleAsOf,
    labelForScore,
    makeSignal,
    parseDay,
    signalPoints,
    sortSignals,
} from '@/domain/investorFlows/scoreHelpers';
import type {
    LargeHolderAxis,
    LargeHolderFiling,
    InvestorFlowsSignalDirection,
    InvestorFlowsSignalId,
    InvestorFlowsSignalStrength,
} from '@/domain/investorFlows/types';

type Schedule = '13D' | '13G';
type EventKind = 'new' | 'increase' | 'reduction' | 'exit' | 'amendment';

interface WindowedFiling {
    readonly current: ParsedFiling;
    /** The same filer's latest earlier filing of the same schedule. */
    readonly previous: ParsedFiling | undefined;
    readonly age: number;
}

interface ParsedFiling {
    readonly filing: LargeHolderFiling;
    readonly day: number;
    readonly schedule: Schedule;
    readonly amendment: boolean;
    readonly filerKey: string;
}

const SIGNAL_IDS: Readonly<
    Record<
        Schedule,
        Readonly<Record<Exclude<EventKind, 'amendment'>, InvestorFlowsSignalId>>
    >
> = {
    '13D': {
        new: 'activist_13d_new',
        increase: 'activist_13d_increase',
        reduction: 'activist_13d_reduction',
        exit: 'activist_13d_exit',
    },
    '13G': {
        new: 'passive_13g_new',
        increase: 'passive_13g_increase',
        reduction: 'passive_13g_reduction',
        exit: 'passive_13g_exit',
    },
};

/**
 * A 13D declares intent to influence the company, so a new or larger one is a
 * strong event and a smaller or exited one is a moderate negative. A 13G is a
 * passive position, so each of its events is weak.
 */
const EVENT_STRENGTH: Readonly<
    Record<
        Schedule,
        Readonly<
            Record<Exclude<EventKind, 'amendment'>, InvestorFlowsSignalStrength>
        >
    >
> = {
    '13D': {
        new: 'strong',
        increase: 'strong',
        reduction: 'moderate',
        exit: 'moderate',
    },
    '13G': { new: 'weak', increase: 'weak', reduction: 'weak', exit: 'weak' },
};

const EVENT_DIRECTION: Readonly<
    Record<Exclude<EventKind, 'amendment'>, InvestorFlowsSignalDirection>
> = {
    new: 'bullish',
    increase: 'bullish',
    reduction: 'bearish',
    exit: 'bearish',
};

function parseFiling(filing: LargeHolderFiling): ParsedFiling | null {
    const day = parseDay(filing.filingDate);
    if (day === null) return null;
    const schedule: Schedule | null = /13D/i.test(filing.form)
        ? '13D'
        : /13G/i.test(filing.form)
          ? '13G'
          : null;
    if (schedule === null) return null;
    return {
        filing,
        day,
        schedule,
        amendment: /\/A\s*$/i.test(filing.form.trim()),
        filerKey: filing.filer.trim().toLowerCase(),
    };
}

function classify(
    current: ParsedFiling,
    previous: ParsedFiling | undefined
): EventKind {
    const percent = current.filing.percentOfClass;
    if (isFiniteNumber(percent) && percent === 0) return 'exit';
    const previousPercent = previous?.filing.percentOfClass;
    if (
        previous !== undefined &&
        isFiniteNumber(percent) &&
        isFiniteNumber(previousPercent)
    ) {
        if (percent > previousPercent) return 'increase';
        if (percent < previousPercent) return 'reduction';
        return 'amendment';
    }
    return !current.amendment && previous === undefined ? 'new' : 'amendment';
}

/**
 * 5% beneficial-owner axis: Schedule 13D (activist intent) and 13G (passive)
 * filings in the trailing {@link LARGE_HOLDER_WINDOW_DAYS} days.
 *
 * Direction comes from comparing a filing's percent of class with the same
 * filer's previous filing of the same schedule. The axis is insufficient when
 * the snapshot has no usable filing at all (13G alone is filed for most large
 * companies at least yearly, so none in the provided history means no coverage).
 * Sufficient therefore means a directional input exists: at least one usable
 * filing in the snapshot dated on or before the reference date: filings dated
 * after it are dropped, so a snapshot of only future-dated filings is insufficient.
 */
export function evaluateLargeHolderAxis(
    filings: readonly LargeHolderFiling[] | null,
    asOfDay: number | null
): LargeHolderAxis {
    const parsed =
        filings
            ?.map(parseFiling)
            .filter(
                (p): p is ParsedFiling =>
                    p !== null && isVisibleAsOf(p.day, asOfDay)
            )
            .sort((a, b) => a.day - b.day) ?? [];
    if (asOfDay === null || parsed.length === 0) {
        return {
            id: 'largeHolders',
            score: null,
            label: 'insufficient',
            sufficiency: 'insufficient',
            signals: [],
            metrics: null,
        };
    }

    // One pass in date order, remembering each filer's latest filing per
    // schedule, so finding the "previous" stake is O(1) instead of a re-scan.
    // The loop mutates a Map on purpose: an immutable rebuild per filing would
    // turn this linear pass into O(n²) for no readability gain.
    const lastByFiler = new Map<string, ParsedFiling>();
    const inWindow: WindowedFiling[] = [];
    for (const current of parsed) {
        const key = `${current.schedule}|${current.filerKey}`;
        const age = daysBetween(current.day, asOfDay);
        if (age >= 0 && age <= LARGE_HOLDER_WINDOW_DAYS) {
            inWindow.push({ current, previous: lastByFiler.get(key), age });
        }
        lastByFiler.set(key, current);
    }

    const signals = inWindow.map(({ current, previous, age }) => {
        const kind = classify(current, previous);
        const evidence = {
            percentOfClass: current.filing.percentOfClass,
            prevPercentOfClass: previous?.filing.percentOfClass ?? null,
            shares: current.filing.shares,
            daysAgo: age,
        };
        return kind === 'amendment'
            ? makeSignal(
                  'largeHolders',
                  'large_holder_amendment',
                  'neutral',
                  'weak',
                  evidence,
                  current.filing.filer
              )
            : makeSignal(
                  'largeHolders',
                  SIGNAL_IDS[current.schedule][kind],
                  EVENT_DIRECTION[kind],
                  EVENT_STRENGTH[current.schedule][kind],
                  evidence,
                  current.filing.filer
              );
    });
    const filings13d = inWindow.filter(
        w => w.current.schedule === '13D'
    ).length;
    const filings13g = inWindow.length - filings13d;

    // 13G events are routine; cap what they can add so they never stack into a strong read.
    const points13d = signals
        .filter(s => s.id.startsWith('activist_13d'))
        .reduce((sum, s) => sum + signalPoints(s), 0);
    const points13g = signals
        .filter(s => s.id.startsWith('passive_13g'))
        .reduce((sum, s) => sum + signalPoints(s), 0);
    const cappedPoints13g = Math.max(
        -LARGE_HOLDER_13G_POINTS_CAP,
        Math.min(LARGE_HOLDER_13G_POINTS_CAP, points13g)
    );
    const score = clampScore(points13d + cappedPoints13g);
    return {
        id: 'largeHolders',
        score,
        label: labelForScore(score),
        sufficiency: 'sufficient',
        signals: sortSignals(signals),
        metrics: { filings13d, filings13g },
    };
}
