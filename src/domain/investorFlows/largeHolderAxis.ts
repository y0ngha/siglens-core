import {
    LARGE_HOLDER_13D_POINTS_CAP,
    LARGE_HOLDER_13G_POINTS_CAP,
    LARGE_HOLDER_WINDOW_DAYS,
} from '@/domain/investorFlows/constants';
import {
    clampScore,
    daysBetween,
    groupByKey,
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
    InvestorFlowsSignal,
    InvestorFlowsSignalDirection,
    InvestorFlowsSignalId,
    InvestorFlowsSignalStrength,
} from '@/domain/investorFlows/types';

type Schedule = '13D' | '13G';
type EventKind =
    'new' | 'increase' | 'reduction' | 'exit' | 'amendment' | 'diluted';
/** Events that carry a direction (the rest are neutral context). */
type DirectionalEvent = Exclude<EventKind, 'amendment' | 'diluted'>;

/** One filer's filings of one schedule inside the window, netted into one event. */
interface FilerWindow {
    /** The filer's earliest filing in the window. */
    readonly first: ParsedFiling;
    /** The filer's latest filing in the window. */
    readonly latest: ParsedFiling;
    /** The same filer's latest filing of the schedule before {@link FilerWindow.first}. */
    readonly baseline: ParsedFiling | undefined;
    /** Filings in the window. */
    readonly filings: number;
}

interface ParsedFiling {
    readonly filing: LargeHolderFiling;
    readonly day: number;
    readonly schedule: Schedule;
    readonly amendment: boolean;
    readonly filerKey: string;
    /**
     * Identity of the filing itself: its URL when that names one SEC filing
     * (an accession number, see {@link ACCESSION_PATTERN}), shared by every
     * co-filer of a joint filing; otherwise unique to this row.
     */
    readonly filingKey: string;
}

const SIGNAL_IDS: Readonly<
    Record<Schedule, Readonly<Record<DirectionalEvent, InvestorFlowsSignalId>>>
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
        Readonly<Record<DirectionalEvent, InvestorFlowsSignalStrength>>
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
    Record<DirectionalEvent, InvestorFlowsSignalDirection>
> = {
    new: 'bullish',
    increase: 'bullish',
    reduction: 'bearish',
    exit: 'bearish',
};

/**
 * An SEC accession number, dashed (`0001104659-24-012345`) or as the 18-digit
 * EDGAR path segment. Only a URL carrying one names a single filing; a blank,
 * generic or index URL may be shared by unrelated rows.
 */
const ACCESSION_PATTERN = /\d{10}-?\d{2}-?\d{6}/;

/**
 * Largest percent-of-class gap still read as the same reported position
 * (rounding): between co-filers of one filing, and between a filer's two
 * filings when deciding a share-count rescale (see {@link classify}).
 */
const JOINT_PERCENT_TOLERANCE = 0.01;

/** Whether two reported percents are both known and equal within {@link JOINT_PERCENT_TOLERANCE}. */
function samePercent(
    a: number | null | undefined,
    b: number | null | undefined
): boolean {
    return (
        isFiniteNumber(a) &&
        isFiniteNumber(b) &&
        Math.abs(a - b) <= JOINT_PERCENT_TOLERANCE
    );
}

/** A filing figure for the evidence: `null` unless finite, so a prompt never prints `NaN` (DOM-1). */
function finiteOrNull(value: number | null | undefined): number | null {
    return isFiniteNumber(value) ? value : null;
}

/**
 * @param index - The row's position in the input, which keys a row whose URL
 * names no single filing, so no two such rows ever merge (not even one filer's
 * two same-day rows) and each counts as its own filing.
 */
function parseFiling(
    filing: LargeHolderFiling,
    index: number
): ParsedFiling | null {
    const day = parseDay(filing.filingDate);
    if (day === null) return null;
    const schedule: Schedule | null = /13D/i.test(filing.form)
        ? '13D'
        : /13G/i.test(filing.form)
          ? '13G'
          : null;
    if (schedule === null) return null;
    const filerKey = filing.filer.trim().toLowerCase();
    const url = filing.url.trim();
    return {
        filing,
        day,
        schedule,
        amendment: /\/A\s*$/i.test(filing.form.trim()),
        filerKey,
        // Without a filing-specific URL a row cannot be matched to co-filers: keep it apart.
        filingKey: ACCESSION_PATTERN.test(url) ? url : `row|${index}`,
    };
}

/**
 * Event of a filer's window: its latest filing against the position before
 * the window. A new original filing with no earlier one is `new`; stacked
 * amendments net to one change instead of one event each.
 *
 * Direction comes from **shares held** when both filings report them: the
 * percent of class also moves when shares outstanding change, so GME's Ryan
 * Cohen adding 42,082,626 → 46,227,436 shares while his percent fell 9.3% →
 * 9.1% (the company issued shares) is an increase, not a reduction. Shares
 * unchanged with a lower percent is `diluted` — neutral context, no bearish
 * points. Without shares on both filings the percent decides.
 *
 * A share count that moved while the percent stayed the same (within
 * {@link JOINT_PERCENT_TOLERANCE}) is a **rescale**, not a trade: a 2-for-1
 * split doubles the shares and a 1-for-10 reverse split divides them by ten,
 * while the holder's slice of the company is unchanged. It is a neutral
 * `amendment`. The same tolerance as for co-filers is used because 13D/G
 * percents are filed rounded (usually to 0.1), so any real change in the
 * holder's stake shows as a different percent; a purchase too small to move
 * the rounded percent is immaterial and reads as an amendment too.
 */
function classify(
    current: ParsedFiling,
    previous: ParsedFiling | undefined,
    openedWithOriginal: boolean
): EventKind {
    const percent = current.filing.percentOfClass;
    const shares = current.filing.shares;
    if (
        (isFiniteNumber(percent) && percent === 0) ||
        (isFiniteNumber(shares) && shares === 0)
    ) {
        return 'exit';
    }
    const previousPercent = previous?.filing.percentOfClass;
    const previousShares = previous?.filing.shares;
    if (
        previous !== undefined &&
        isFiniteNumber(shares) &&
        isFiniteNumber(previousShares)
    ) {
        if (
            shares !== previousShares &&
            samePercent(percent, previousPercent)
        ) {
            return 'amendment';
        }
        if (shares > previousShares) return 'increase';
        if (shares < previousShares) return 'reduction';
        return isFiniteNumber(percent) &&
            isFiniteNumber(previousPercent) &&
            percent < previousPercent
            ? 'diluted'
            : 'amendment';
    }
    if (
        previous !== undefined &&
        isFiniteNumber(percent) &&
        isFiniteNumber(previousPercent)
    ) {
        if (percent > previousPercent) return 'increase';
        if (percent < previousPercent) return 'reduction';
        return 'amendment';
    }
    return openedWithOriginal && previous === undefined ? 'new' : 'amendment';
}

/**
 * Day-sorted rows without repeats: a filer's second filing of one schedule on
 * the same day reporting the same percent and shares (GME: two 13D/As on
 * 2026-09-29, both 8.8% and 44,683,306 shares) restates the first, so it is
 * one filing, not two.
 */
function dropRepeatedRows(rows: readonly ParsedFiling[]): ParsedFiling[] {
    const seen = new Set<string>();
    return rows.filter(r => {
        const key = `${r.schedule}|${r.filerKey}|${r.day}|${r.filing.percentOfClass}|${r.filing.shares}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** Whether two co-filers of one filing report the same position (within rounding). */
function samePosition(a: LargeHolderFiling, b: LargeHolderFiling): boolean {
    const percentMatch =
        isFiniteNumber(a.percentOfClass) && isFiniteNumber(b.percentOfClass)
            ? Math.abs(a.percentOfClass - b.percentOfClass) <=
              JOINT_PERCENT_TOLERANCE
            : a.percentOfClass === b.percentOfClass;
    return percentMatch && a.shares === b.shares;
}

/**
 * Split one filing's co-filer windows into events: windows whose latest rows
 * report the same position are one joint event; a co-filer reporting a
 * different position is its own event. Input sorted by filer.
 */
function jointEvents(windows: readonly FilerWindow[]): FilerWindow[][] {
    return windows.reduce<FilerWindow[][]>((events, w) => {
        const match = events.find(e =>
            samePosition(e[0].latest.filing, w.latest.filing)
        );
        return match === undefined
            ? [...events, [w]]
            : events.map(e => (e === match ? [...e, w] : e));
    }, []);
}

/** Summed points of the signals whose id starts with `prefix`, clamped to ±`cap`. */
function cappedPoints(
    signals: readonly InvestorFlowsSignal[],
    prefix: string,
    cap: number
): number {
    const points = signals
        .filter(s => s.id.startsWith(prefix))
        .reduce((sum, s) => sum + signalPoints(s), 0);
    return Math.max(-cap, Math.min(cap, points));
}

/** Distinct filings (a joint filing once) of `schedule` among `filings`. */
function countFilings(
    filings: readonly ParsedFiling[],
    schedule: Schedule
): number {
    return new Set(
        filings.filter(f => f.schedule === schedule).map(f => f.filingKey)
    ).size;
}

/**
 * 5% beneficial-owner axis: Schedule 13D (activist intent) and 13G (passive)
 * filings in the trailing {@link LARGE_HOLDER_WINDOW_DAYS} days.
 *
 * Direction comes from comparing a filer's latest filing in the window with
 * its last filing of the same schedule before the window, so a filer's
 * stacked amendments (seven 13D/As in a quarter) are one event with their net
 * change, not seven. A joint filing lists each co-filer separately under one
 * URL; it is one event (and one filing in the metrics), with every co-filer
 * named in the subject. The assumption is guarded on both sides: rows merge
 * only when the URL names one filing (it carries an accession number — a
 * blank, generic or index URL never merges, and each such row is its own
 * filing) and the co-filers report the same position (percent of class within
 * rounding, equal shares); a co-filer on the same filing with a different
 * position is its own event. 13D and 13G points are each capped
 * ({@link LARGE_HOLDER_13D_POINTS_CAP}, {@link LARGE_HOLDER_13G_POINTS_CAP}). The axis is insufficient when
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
    const sortedRows =
        filings
            ?.map((filing, index) => parseFiling(filing, index))
            .filter(
                (p): p is ParsedFiling =>
                    p !== null && isVisibleAsOf(p.day, asOfDay)
            )
            .sort((a, b) => a.day - b.day) ?? [];
    const parsed = dropRepeatedRows(sortedRows);
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
    // The loop mutates Maps on purpose: an immutable rebuild per filing would
    // turn this linear pass into O(n²) for no readability gain.
    const lastByFiler = new Map<string, ParsedFiling>();
    const windows = new Map<string, FilerWindow>();
    const inWindow: ParsedFiling[] = [];
    for (const current of parsed) {
        const key = `${current.schedule}|${current.filerKey}`;
        const age = daysBetween(current.day, asOfDay);
        if (age >= 0 && age <= LARGE_HOLDER_WINDOW_DAYS) {
            inWindow.push(current);
            const open = windows.get(key);
            windows.set(
                key,
                open === undefined
                    ? {
                          first: current,
                          latest: current,
                          baseline: lastByFiler.get(key),
                          filings: 1,
                      }
                    : { ...open, latest: current, filings: open.filings + 1 }
            );
        }
        lastByFiler.set(key, current);
    }

    // Co-filers of one joint filing each appear once in the feed; the filing
    // is one event. The first co-filer by name represents it, and the subject
    // names them all.
    const byFiling = groupByKey(
        [...windows.values()],
        w => `${w.latest.schedule}|${w.latest.filingKey}`
    );
    const events = [...byFiling.values()].flatMap(group =>
        // `group` is a fresh local array, and `toSorted` is not in the ES2022 client entry.
        jointEvents(
            group.sort((a, b) =>
                a.latest.filerKey.localeCompare(b.latest.filerKey)
            )
        )
    );
    const signals = events.map(sorted => {
        const { first, latest, baseline, filings } = sorted[0];
        const kind = classify(latest, baseline, !first.amendment);
        // Three dated positions: the latest filing, the first one in the
        // window, and the last one before the window — the baseline the
        // direction is computed against (not the filing just before the latest).
        const evidence = {
            percentOfClass: finiteOrNull(latest.filing.percentOfClass),
            shares: finiteOrNull(latest.filing.shares),
            daysAgo: daysBetween(latest.day, asOfDay),
            windowStartPercentOfClass: finiteOrNull(
                first.filing.percentOfClass
            ),
            windowStartShares: finiteOrNull(first.filing.shares),
            windowStartDaysAgo: daysBetween(first.day, asOfDay),
            preWindowPercentOfClass: finiteOrNull(
                baseline?.filing.percentOfClass
            ),
            preWindowShares: finiteOrNull(baseline?.filing.shares),
            preWindowDaysAgo:
                baseline === undefined
                    ? null
                    : daysBetween(baseline.day, asOfDay),
            filings,
        };
        const subject = sorted.map(w => w.latest.filing.filer).join(' / ');
        if (kind === 'amendment' || kind === 'diluted') {
            return makeSignal(
                'largeHolders',
                kind === 'diluted'
                    ? 'large_holder_ratio_diluted'
                    : 'large_holder_amendment',
                'neutral',
                'weak',
                evidence,
                subject
            );
        }
        return makeSignal(
            'largeHolders',
            SIGNAL_IDS[latest.schedule][kind],
            EVENT_DIRECTION[kind],
            EVENT_STRENGTH[latest.schedule][kind],
            evidence,
            subject
        );
    });
    const filings13d = countFilings(inWindow, '13D');
    const filings13g = countFilings(inWindow, '13G');
    const events13d = events.filter(e => e[0].latest.schedule === '13D').length;
    const events13g = events.length - events13d;

    // Each schedule's events are capped so they never stack into ±100: 13G is
    // routine, and several 13D events in one window are one campaign.
    const score = clampScore(
        cappedPoints(signals, 'activist_13d', LARGE_HOLDER_13D_POINTS_CAP) +
            cappedPoints(signals, 'passive_13g', LARGE_HOLDER_13G_POINTS_CAP)
    );
    return {
        id: 'largeHolders',
        score,
        label: labelForScore(score),
        sufficiency: 'sufficient',
        signals: sortSignals(signals),
        metrics: { events13d, filings13d, events13g, filings13g },
    };
}
