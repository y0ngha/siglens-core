import { median } from '@/domain/indicators/utils';
import {
    INSIDER_CLUSTER_WINDOW_DAYS,
    KR_INSIDER_CLUSTER_DOMINANCE_MULTIPLE,
    KR_INSIDER_CLUSTER_MEMBER_MIN_PCT_OUTSTANDING,
    KR_INSIDER_CLUSTER_MEMBER_MIN_RATIO_CHANGE_PCT,
    KR_INSIDER_CLUSTER_MIN_REPORTERS,
    KR_INSIDER_NET_CHANGE_MODERATE_PCT,
    KR_INSIDER_NET_CHANGE_WEAK_PCT,
    KR_INSIDER_ROUTINE_MASS_FILING_MAX_REPORTERS,
    KR_WINDOW_DAYS,
    RATIO_DECIMALS,
} from '@/domain/investorFlows/constants';
import { largestClusterSpan } from '@/domain/investorFlows/insiderAxis';
import {
    daysBetween,
    formatDay,
    isFiniteNumber,
    labelForScore,
    makeSignal,
    parseDay,
    roundValue,
    scoreFromSignals,
    sortSignals,
    strengthOf,
} from '@/domain/investorFlows/scoreHelpers';
import type {
    InsiderAxis,
    InvestorFlowsSignal,
    InvestorFlowsSignalDirection,
    KrDisclosureSnapshot,
    KrInsiderMetrics,
    KrInsiderReport,
} from '@/domain/investorFlows/types';

interface DatedInsiderReport {
    readonly report: KrInsiderReport;
    readonly day: number;
}

/** A dated report with the size of its own change (see {@link changeMagnitude}). */
interface SizedInsiderReport extends DatedInsiderReport {
    readonly magnitude: number | null;
}

/** A cluster signal with the summed change of its span's members, for netting. */
interface InsiderCluster {
    readonly signal: InvestorFlowsSignal;
    readonly magnitude: number;
}

function hasSharesOutstanding(
    sharesOutstanding: number | null
): sharesOutstanding is number {
    return isFiniteNumber(sharesOutstanding) && sharesOutstanding > 0;
}

/**
 * Size of one report's own change: % of shares outstanding when that is known,
 * else the report's |ratio change| in percentage points; `null` when neither
 * is usable. Every report in one evaluation uses the same measure.
 */
function changeMagnitude(
    report: KrInsiderReport,
    sharesOutstanding: number | null
): number | null {
    if (hasSharesOutstanding(sharesOutstanding)) {
        return (Math.abs(report.sharesChange) / sharesOutstanding) * 100;
    }
    return isFiniteNumber(report.ratioChangePct)
        ? Math.abs(report.ratioChangePct)
        : null;
}

/** Smallest {@link changeMagnitude} that lets a report count toward a cluster. */
function memberFloor(sharesOutstanding: number | null): number {
    return hasSharesOutstanding(sharesOutstanding)
        ? KR_INSIDER_CLUSTER_MEMBER_MIN_PCT_OUTSTANDING
        : KR_INSIDER_CLUSTER_MEMBER_MIN_RATIO_CHANGE_PCT;
}

function isMaterial(
    report: SizedInsiderReport,
    sharesOutstanding: number | null
): boolean {
    return (
        report.magnitude !== null &&
        report.magnitude >= memberFloor(sharesOutstanding)
    );
}

/** Busiest {@link INSIDER_CLUSTER_WINDOW_DAYS}-day span of day-sorted reports, by distinct reporter. */
function busiestSpan(sorted: readonly SizedInsiderReport[]): {
    readonly reporters: number;
    readonly members: readonly SizedInsiderReport[];
} {
    const span = largestClusterSpan(
        sorted.map(r => ({ day: r.day, key: reporterKey(r.report) }))
    );
    return {
        reporters: span.size,
        members: sorted.slice(span.start, span.end),
    };
}

function spanSubject(members: readonly SizedInsiderReport[]): string {
    return `${formatDay(members[0].day)} to ${formatDay(members[members.length - 1].day)}`;
}

function reporterKey(report: KrInsiderReport): string {
    return report.reporter.trim().toLowerCase();
}

/** Age of a receipt date in days when it falls inside the window; `null` otherwise. */
function windowDay(date: string, asOfDay: number): number | null {
    const day = parseDay(date);
    if (day === null) return null;
    const age = daysBetween(day, asOfDay);
    return age >= 0 && age <= KR_WINDOW_DAYS ? day : null;
}

/** Net change as % of shares outstanding, else the summed ratio change; `null` when neither is usable. */
function netChangePct(
    reports: readonly DatedInsiderReport[],
    netShares: number,
    sharesOutstanding: number | null
): number | null {
    if (hasSharesOutstanding(sharesOutstanding)) {
        return roundValue(
            (netShares / sharesOutstanding) * 100,
            RATIO_DECIMALS
        );
    }
    const ratios = reports.map(r => r.report.ratioChangePct);
    return ratios.every(isFiniteNumber)
        ? roundValue(
              ratios.reduce((a, b) => a + b, 0),
              RATIO_DECIMALS
          )
        : null;
}

function findCluster(
    material: readonly SizedInsiderReport[],
    direction: Exclude<InvestorFlowsSignalDirection, 'neutral'>
): InsiderCluster | null {
    const side = material.filter(r =>
        direction === 'bullish'
            ? r.report.sharesChange > 0
            : r.report.sharesChange < 0
    );
    // `material` is already day-sorted (the sweep needs it), and so is a filter of it.
    const { reporters, members } = busiestSpan(side);
    if (reporters < KR_INSIDER_CLUSTER_MIN_REPORTERS) return null;
    return {
        signal: makeSignal(
            'insider',
            'kr_insider_cluster',
            direction,
            'moderate',
            { reporters, windowDays: INSIDER_CLUSTER_WINDOW_DAYS },
            // The span's own dates, rendered like the US Form 144 cluster.
            spanSubject(members)
        ),
        magnitude: members.reduce((sum, r) => sum + (r.magnitude ?? 0), 0),
    };
}

/**
 * Opposite clusters in one window are netted: the side whose summed member
 * change is at least {@link KR_INSIDER_CLUSTER_DOMINANCE_MULTIPLE} times the
 * other's is kept, otherwise neither — a buying and a selling cluster side by
 * side say nothing about direction.
 */
function netClusters(
    bullish: InsiderCluster | null,
    bearish: InsiderCluster | null
): InvestorFlowsSignal[] {
    if (bullish === null || bearish === null) {
        return [bullish, bearish].flatMap(c => (c === null ? [] : [c.signal]));
    }
    if (
        bullish.magnitude >=
        KR_INSIDER_CLUSTER_DOMINANCE_MULTIPLE * bearish.magnitude
    ) {
        return [bullish.signal];
    }
    if (
        bearish.magnitude >=
        KR_INSIDER_CLUSTER_DOMINANCE_MULTIPLE * bullish.magnitude
    ) {
        return [bearish.signal];
    }
    return [];
}

/**
 * Neutral `kr_insider_routine_mass_filing` when the busiest 30-day span holds
 * more than {@link KR_INSIDER_ROUTINE_MASS_FILING_MAX_REPORTERS} distinct
 * reporters (either direction) and its median report change is below the
 * cluster member floor; `null` otherwise. The raw median is compared; it is
 * rounded only for display, so a rendered median can equal the floor.
 */
function routineMassFiling(
    sorted: readonly SizedInsiderReport[],
    sharesOutstanding: number | null
): InvestorFlowsSignal | null {
    const moved = sorted.filter(r => r.report.sharesChange !== 0);
    const { reporters, members } = busiestSpan(moved);
    if (reporters <= KR_INSIDER_ROUTINE_MASS_FILING_MAX_REPORTERS) return null;
    const middle = median(members.map(r => r.magnitude ?? 0)) ?? 0;
    if (middle >= memberFloor(sharesOutstanding)) return null;
    // Two keys on purpose: `unitOfFigure` reads the unit from the key
    // (`…PctOutstanding` → "% of shares outstanding", `…RatioChangePct` → "%p"),
    // so evidence stays numeric-only and each figure carries its own basis.
    const medianKey = hasSharesOutstanding(sharesOutstanding)
        ? 'medianChangePctOutstanding'
        : 'medianRatioChangePct';
    return makeSignal(
        'insider',
        'kr_insider_routine_mass_filing',
        'neutral',
        'weak',
        {
            reporters,
            reports: members.length,
            [medianKey]: roundValue(middle, RATIO_DECIMALS),
            windowDays: INSIDER_CLUSTER_WINDOW_DAYS,
        },
        spanSubject(members)
    );
}

/**
 * The receipt day with the most reports in the window and its count; the
 * earliest day wins a tie. `null` for an empty window. `reports` is sorted by
 * day, so the first day to reach the top count is the earliest.
 */
function largestSingleDayFiling(
    reports: readonly DatedInsiderReport[]
): { date: string; count: number } | null {
    const countByDay = reports.reduce<ReadonlyMap<number, number>>(
        (acc, r) => new Map([...acc, [r.day, (acc.get(r.day) ?? 0) + 1]]),
        new Map()
    );
    const best = [...countByDay].reduce<readonly [number, number] | null>(
        (top, entry) =>
            top === null ||
            entry[1] > top[1] ||
            (entry[1] === top[1] && entry[0] < top[0])
                ? entry
                : top,
        null
    );
    return best === null ? null : { date: formatDay(best[0]), count: best[1] };
}

/**
 * Korean insider axis from DART executive / major-shareholder ownership reports
 * (임원·주요주주 소유보고) and trading-plan reports (거래계획보고서) in the
 * trailing {@link KR_WINDOW_DAYS} days. Fills the `insider` slot.
 *
 * The US insider rules do not transfer: they threshold USD values and match
 * English job titles, so Korean data would never fire a signal and the axis
 * would read as a fake zero. Here thresholds are on shares and ratios:
 *
 * - `kr_insider_net_change`: net shares changed across the window's reports as
 *   % of shares outstanding (else the summed ratio change). Capped at moderate
 *   because the report carries no cause — open-market trades, gifts,
 *   inheritance and option exercise look alike — and netting is what keeps a
 *   gift between family members from reading as two moves.
 * - `kr_insider_cluster`: {@link KR_INSIDER_CLUSTER_MIN_REPORTERS} or more
 *   distinct reporters moving the same way within one cluster span (moderate).
 *   Only reports whose own change is material count — at least
 *   {@link KR_INSIDER_CLUSTER_MEMBER_MIN_PCT_OUTSTANDING}% of shares outstanding,
 *   or without it a ratio change of at least
 *   {@link KR_INSIDER_CLUSTER_MEMBER_MIN_RATIO_CHANGE_PCT}%p (a report with
 *   neither is excluded). A buying and a selling cluster are netted by summed
 *   member change ({@link KR_INSIDER_CLUSTER_DOMINANCE_MULTIPLE}x to keep one).
 * - `kr_insider_routine_mass_filing`: neutral context when no material cluster
 *   survives netting and more than
 *   {@link KR_INSIDER_ROUTINE_MASS_FILING_MAX_REPORTERS} reporters file inside
 *   one span with a median change below the member floor — a large cap's
 *   routine grant or reshuffle filings, not a coordinated move. Clusters are
 *   always computed from material reports first, so a genuine cluster inside
 *   routine noise still fires; the routine note is then left out (the cluster
 *   already says what the window shows, and the tiny reports never count).
 * - `kr_trading_plan`: neutral context — a pre-announced trade, direction unknown.
 *
 * - `kr_insider_no_material_change`: neutral context when usable reports are in
 *   the window, the net change is measurable and nothing above fired (and no
 *   routine mass filing note already says so).
 *
 * A report is usable when its date parses, it is dated on or before the
 * reference day and its share change is finite. Three states:
 *
 * - **Usable reports in the window with a measurable net change
 *   (`netChangePct` not `null`) but no directional signal** — reports that net
 *   to nothing, small changes, or a window of only routine mass filings:
 *   `sufficient`, score 0, `neutral`. The reports were filed and their sizes
 *   are known, so "no material change" is a measured fact. A routine-only
 *   window counts here on purpose: hundreds of tiny grant filings with valid
 *   numbers are exactly the absence of a material insider move.
 * - **No usable report in the window, but one exists outside it**:
 *   `insufficient`, with `krMetrics.reports === 0` and
 *   `krMetrics.latestReceiptDate` so a renderer can say "no reports in the
 *   window" instead of "no data". Trading plans alone never score.
 * - **No usable report at all, or a net change that cannot be measured**
 *   (no shares outstanding and a non-finite ratio change): `insufficient` —
 *   the inputs cannot prove "no change", so the axis never reads as a fake zero.
 */
export function evaluateKrInsiderAxis(
    kr: Pick<KrDisclosureSnapshot, 'insiders' | 'tradingPlans'>,
    sharesOutstanding: number | null,
    asOfDay: number | null
): InsiderAxis {
    const usable: DatedInsiderReport[] =
        asOfDay === null
            ? []
            : kr.insiders
                  .flatMap(report => {
                      const day = parseDay(report.receiptDate);
                      return day === null ||
                          daysBetween(day, asOfDay) < 0 ||
                          !isFiniteNumber(report.sharesChange)
                          ? []
                          : [{ report, day }];
                  })
                  .sort((a, b) => a.day - b.day);
    const reports =
        asOfDay === null
            ? []
            : usable.filter(r => daysBetween(r.day, asOfDay) <= KR_WINDOW_DAYS);
    const latestUsable = usable.at(-1);
    const plans =
        asOfDay === null
            ? 0
            : kr.tradingPlans.filter(
                  p => windowDay(p.receiptDate, asOfDay) !== null
              ).length;

    const netShares = reports.reduce(
        (sum, r) => sum + r.report.sharesChange,
        0
    );
    const pct = netChangePct(reports, netShares, sharesOutstanding);
    const reporters = new Set(reports.map(r => reporterKey(r.report))).size;
    const signals: InvestorFlowsSignal[] = [];
    const netStrength =
        pct === null
            ? null
            : strengthOf(Math.abs(pct), {
                  weak: KR_INSIDER_NET_CHANGE_WEAK_PCT,
                  moderate: KR_INSIDER_NET_CHANGE_MODERATE_PCT,
              });
    if (pct !== null && netStrength !== null) {
        signals.push(
            makeSignal(
                'insider',
                'kr_insider_net_change',
                pct > 0 ? 'bullish' : 'bearish',
                netStrength,
                {
                    netSharesChange: netShares,
                    netChangePct: pct,
                    reporters,
                    reports: reports.length,
                }
            )
        );
    }
    const sized: SizedInsiderReport[] = reports.map(r => ({
        ...r,
        magnitude: changeMagnitude(r.report, sharesOutstanding),
    }));
    const material = sized.filter(r => isMaterial(r, sharesOutstanding));
    const clusters = netClusters(
        findCluster(material, 'bullish'),
        findCluster(material, 'bearish')
    );
    signals.push(...clusters);
    const directional = signals.length > 0;
    // Only when no material cluster survives: otherwise the cluster speaks.
    const routine =
        clusters.length === 0
            ? routineMassFiling(sized, sharesOutstanding)
            : null;
    if (routine !== null) signals.push(routine);
    const measuredNoChange = !directional && reports.length > 0 && pct !== null;
    // The routine note already says the window moved nothing; one note is enough.
    if (measuredNoChange && routine === null) {
        signals.push(
            makeSignal(
                'insider',
                'kr_insider_no_material_change',
                'neutral',
                'weak',
                { reports: reports.length, reporters, netChangePct: pct }
            )
        );
    }
    if (plans > 0) {
        signals.push(
            makeSignal('insider', 'kr_trading_plan', 'neutral', 'weak', {
                plans,
                windowDays: KR_WINDOW_DAYS,
            })
        );
    }

    const krMetrics: KrInsiderMetrics | undefined =
        latestUsable === undefined && plans === 0
            ? undefined
            : {
                  reports: reports.length,
                  reporters,
                  netSharesChange: netShares,
                  netChangePct: pct,
                  tradingPlans: plans,
                  latestReceiptDate:
                      latestUsable === undefined
                          ? null
                          : formatDay(latestUsable.day),
                  largestSingleDayFiling: largestSingleDayFiling(reports),
              };
    const base = krMetrics === undefined ? {} : { krMetrics };
    if (measuredNoChange) {
        return {
            id: 'insider',
            score: 0,
            label: 'neutral',
            sufficiency: 'sufficient',
            signals: sortSignals(signals),
            metrics: null,
            ...base,
        };
    }
    if (!directional) {
        return {
            id: 'insider',
            score: null,
            label: 'insufficient',
            sufficiency: 'insufficient',
            signals: sortSignals(signals),
            metrics: null,
            ...base,
        };
    }
    const score = scoreFromSignals(signals);
    return {
        id: 'insider',
        score,
        label: labelForScore(score),
        sufficiency: 'sufficient',
        signals: sortSignals(signals),
        metrics: null,
        ...base,
    };
}
