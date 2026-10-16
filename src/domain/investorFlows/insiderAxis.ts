import {
    INSIDER_BUY_MODERATE_USD,
    INSIDER_BUY_STRONG_USD,
    INSIDER_BUY_WEAK_USD,
    INSIDER_CLUSTER_MIN_INSIDERS,
    INSIDER_CLUSTER_STRONG_INSIDERS,
    INSIDER_CLUSTER_WINDOW_DAYS,
    INSIDER_LARGE_SELL_FRACTION,
    INSIDER_LARGE_SELL_STRONG_INSIDERS,
    INSIDER_PROPOSED_SALE_CLUSTER_MIN_FILERS,
    INSIDER_PROPOSED_SALE_MODERATE_PCT_OUTSTANDING,
    INSIDER_PROPOSED_SALE_MODERATE_USD,
    INSIDER_PROPOSED_SALE_PLAN_MAJORITY,
    INSIDER_PROPOSED_SALE_WEAK_PCT_OUTSTANDING,
    INSIDER_PROPOSED_SALE_WEAK_USD,
    INSIDER_ROLE_WEIGHTS,
    INSIDER_SELL_MIN_USD,
    INSIDER_WINDOW_DAYS,
    RATIO_DECIMALS,
} from '@/domain/investorFlows/constants';
import {
    daysBetween,
    formatDay,
    isFiniteNumber,
    isVisibleAsOf,
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
    InsiderMetrics,
    InsiderSnapshot,
    InsiderTransaction,
    InvestorFlowsSignal,
    InvestorFlowsSignalStrength,
    ProposedSale,
} from '@/domain/investorFlows/types';

type InsiderRoleClass = keyof typeof INSIDER_ROLE_WEIGHTS;

const OFFICER_OR_DIRECTOR_PATTERN =
    /\b(officer|director|chairman|chief|president|ceo|cfo|coo|cto|vp|svp|evp|vice president)\b/i;
const TEN_PERCENT_OWNER_PATTERN = /(\b10\s*(percent|%)|\bten percent)/i;

interface DatedTransaction {
    readonly tx: InsiderTransaction;
    readonly day: number;
}

/**
 * Classify the free-text relationship. Officer/director is checked first: an
 * insider who is both a director and a 10% owner trades with director-level
 * information.
 */
export function classifyInsiderRole(role: string): InsiderRoleClass {
    if (OFFICER_OR_DIRECTOR_PATTERN.test(role)) return 'officerOrDirector';
    if (TEN_PERCENT_OWNER_PATTERN.test(role)) return 'tenPercentOwner';
    return 'other';
}

/** Reported value, else shares x price; `null` when neither is usable. */
function transactionValue(tx: InsiderTransaction): number | null {
    if (isFiniteNumber(tx.value) && tx.value > 0) return tx.value;
    if (
        isFiniteNumber(tx.price) &&
        tx.price > 0 &&
        isFiniteNumber(tx.shares) &&
        tx.shares > 0
    ) {
        return tx.shares * tx.price;
    }
    return null;
}

function personKey(tx: InsiderTransaction): string {
    return tx.name.trim().toLowerCase();
}

function sumValue(
    items: readonly DatedTransaction[],
    weighted: boolean
): number {
    return items.reduce((sum, { tx }) => {
        const value = transactionValue(tx);
        if (value === null) return sum;
        return (
            sum +
            (weighted
                ? value * INSIDER_ROLE_WEIGHTS[classifyInsiderRole(tx.role)]
                : value)
        );
    }, 0);
}

/** A dated event attributed to one person, for the cluster sweep. */
export interface ClusterEvent {
    readonly day: number;
    readonly key: string;
}

/**
 * Largest number of distinct people whose events fall within one
 * {@link INSIDER_CLUSTER_WINDOW_DAYS} span. `events` must be sorted by day
 * ascending; a two-pointer sweep keeps it linear. The mutable `start`/`best`
 * cursors are deliberate: a reduce over every window start would be O(n²), and
 * this runs once per symbol per snapshot. Shared by the Form 4 buy cluster, the
 * Form 144 cluster and the Korean insider cluster so the span rule is one rule.
 */
export function largestCluster(events: readonly ClusterEvent[]): number {
    return largestClusterSpan(events).size;
}

/** The largest cluster and the events of its span: `events.slice(start, end)`. */
export interface ClusterSpan {
    /** Distinct people in the span. */
    readonly size: number;
    /** Index of the span's first event. */
    readonly start: number;
    /** Index after the span's last event. */
    readonly end: number;
}

/**
 * {@link largestCluster} with the span it was found in: the
 * {@link INSIDER_CLUSTER_WINDOW_DAYS}-day span from the first event of the
 * earliest window reaching the largest count, extended to every event within
 * that span (no later event inside it can add a person beyond the maximum).
 * Lets a cluster signal quote the value of its own window, not of the whole
 * insider window. Same sorting requirement and sweep as {@link largestCluster}.
 */
export function largestClusterSpan(
    events: readonly ClusterEvent[]
): ClusterSpan {
    const counts = new Map<string, number>();
    let start = 0;
    let best = 0;
    let bestStart = 0;
    for (const event of events) {
        counts.set(event.key, (counts.get(event.key) ?? 0) + 1);
        while (
            daysBetween(events[start].day, event.day) >
            INSIDER_CLUSTER_WINDOW_DAYS
        ) {
            const startKey = events[start].key;
            const remaining = (counts.get(startKey) ?? 1) - 1;
            if (remaining === 0) counts.delete(startKey);
            else counts.set(startKey, remaining);
            start += 1;
        }
        if (counts.size > best) {
            best = counts.size;
            bestStart = start;
        }
    }
    const spanStartDay = events.at(bestStart)?.day;
    const end =
        spanStartDay === undefined
            ? 0
            : bestStart +
              events
                  .slice(bestStart)
                  .filter(
                      e =>
                          daysBetween(spanStartDay, e.day) <=
                          INSIDER_CLUSTER_WINDOW_DAYS
                  ).length;
    return { size: best, start: bestStart, end };
}

function largestBuyCluster(buys: readonly DatedTransaction[]): number {
    return largestCluster(
        buys.map(({ tx, day }) => ({ day, key: personKey(tx) }))
    );
}

interface DatedProposedSale {
    readonly sale: ProposedSale;
    readonly day: number;
    readonly valueUsd: number;
    readonly shares: number;
    readonly planned: boolean;
    /** Filer identity (see {@link proposedSaleFilerKeys}). */
    readonly key: string;
}

/** One step weaker, never below weak: the 10b5-1 damping. */
function stepDown(
    strength: InvestorFlowsSignalStrength
): InvestorFlowsSignalStrength {
    return strength === 'strong' ? 'moderate' : 'weak';
}

interface ProposedSaleSummary {
    readonly valueUsd: number;
    readonly plannedValueUsd: number;
    readonly shares: number;
    /** Shares as % of shares outstanding; `null` without shares outstanding. */
    readonly pctOutstanding: number | null;
    /** Value of the notices that carry no usable share count, USD (sized by the USD fallback). */
    readonly unsizedValueUsd: number;
    readonly filers: number;
}

/**
 * Filer name for identity matching: case, punctuation and spacing differ
 * between one person's filings (`O'Brien Deirdre`, `OBRIEN DEIRDRE`).
 */
export function normalizeFilerName(filer: string): string {
    return filer
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** A CIK without padding (`0001234567` and `1234567` are one filer); `null` when blank. */
function normalizeCik(cik: string | null | undefined): string | null {
    if (typeof cik !== 'string') return null;
    const digits = cik.trim().replace(/^0+(?=.)/, '');
    return digits === '' ? null : digits;
}

/**
 * One identity key per notice. A notice with a CIK is keyed by it. One without
 * borrows a CIK only when its normalized name is unambiguous — every notice
 * under that name that has a CIK has the same one; when two distinct CIKs share
 * the name (two people), it keys by the name instead of picking one, so the
 * result does not depend on input order. Otherwise it keys by the name. The
 * same person files under differently spelled names (`MARK ROBINSON`,
 * `Mark Haymond Robinson`), and only the CIK joins those.
 */
export function proposedSaleFilerKeys(
    sales: readonly ProposedSale[]
): string[] {
    const ciksByName = sales.reduce((map, sale) => {
        const cik = normalizeCik(sale.filerCik);
        if (cik === null) return map;
        const name = normalizeFilerName(sale.filer);
        return map.set(name, new Set([...(map.get(name) ?? []), cik]));
    }, new Map<string, ReadonlySet<string>>());
    return sales.map(sale => {
        const name = normalizeFilerName(sale.filer);
        const own = normalizeCik(sale.filerCik);
        if (own !== null) return `cik:${own}`;
        const candidates = [...(ciksByName.get(name) ?? [])];
        return candidates.length === 1
            ? `cik:${candidates[0]}`
            : `name:${name}`;
    });
}

function summarizeProposedSales(
    sales: readonly DatedProposedSale[],
    sharesOutstanding: number | null
): ProposedSaleSummary {
    const shares = roundValue(sales.reduce((sum, s) => sum + s.shares, 0));
    return {
        valueUsd: roundValue(sales.reduce((sum, s) => sum + s.valueUsd, 0)),
        plannedValueUsd: roundValue(
            sales.filter(s => s.planned).reduce((sum, s) => sum + s.valueUsd, 0)
        ),
        shares,
        unsizedValueUsd: roundValue(
            sales
                .filter(s => s.shares === 0)
                .reduce((sum, s) => sum + s.valueUsd, 0)
        ),
        pctOutstanding:
            isFiniteNumber(sharesOutstanding) && sharesOutstanding > 0
                ? roundValue((shares / sharesOutstanding) * 100, RATIO_DECIMALS)
                : null,
        filers: new Set(sales.map(s => s.key)).size,
    };
}

function damped(
    strength: InvestorFlowsSignalStrength,
    summary: ProposedSaleSummary
): InvestorFlowsSignalStrength {
    return summary.valueUsd > 0 &&
        summary.plannedValueUsd / summary.valueUsd >=
            INSIDER_PROPOSED_SALE_PLAN_MAJORITY
        ? stepDown(strength)
        : strength;
}

function positiveOrZero(value: number): number {
    return isFiniteNumber(value) && value > 0 ? value : 0;
}

/** Form 144 notices filed inside the insider window, sorted by filing day. */
function windowedProposedSales(
    sales: readonly ProposedSale[],
    asOfDay: number
): DatedProposedSale[] {
    const inWindow = sales.flatMap(sale => {
        const day = parseDay(sale.filingDate);
        if (day === null) return [];
        const age = daysBetween(day, asOfDay);
        return age < 0 || age > INSIDER_WINDOW_DAYS ? [] : [{ sale, day }];
    });
    const keys = proposedSaleFilerKeys(inWindow.map(({ sale }) => sale));
    return inWindow
        .map(({ sale, day }, i) => ({
            sale,
            day,
            valueUsd: positiveOrZero(sale.valueUsd),
            shares: positiveOrZero(sale.shares),
            planned: sale.planAdoptionDate !== null,
            key: keys[i],
        }))
        .sort((a, b) => a.day - b.day);
}

const STRENGTH_RANK: Readonly<Record<InvestorFlowsSignalStrength, number>> = {
    weak: 1,
    moderate: 2,
    strong: 3,
};

function strongerOf(
    a: InvestorFlowsSignalStrength | null,
    b: InvestorFlowsSignalStrength | null
): InvestorFlowsSignalStrength | null {
    if (a === null) return b;
    if (b === null) return a;
    return STRENGTH_RANK[b] > STRENGTH_RANK[a] ? b : a;
}

function usdStrength(valueUsd: number): InvestorFlowsSignalStrength | null {
    return strengthOf(valueUsd, {
        weak: INSIDER_PROPOSED_SALE_WEAK_USD,
        moderate: INSIDER_PROPOSED_SALE_MODERATE_USD,
    });
}

/**
 * Strength of the aggregate notice size (see the constants for why).
 *
 * - No shares outstanding: USD value of every notice.
 * - Otherwise: % of shares outstanding over the notices that carry a share
 *   count, and — when some notices carry none — the USD fallback over those
 *   notices alone; the stronger of the two wins. A window mixing sized and
 *   unsized notices would otherwise understate the percent (the unsized ones
 *   add 0 shares) or drop the sized ones' scale.
 */
function proposedSaleStrength(
    summary: ProposedSaleSummary
): InvestorFlowsSignalStrength | null {
    if (summary.pctOutstanding === null) return usdStrength(summary.valueUsd);
    const pctStrength = strengthOf(summary.pctOutstanding, {
        weak: INSIDER_PROPOSED_SALE_WEAK_PCT_OUTSTANDING,
        moderate: INSIDER_PROPOSED_SALE_MODERATE_PCT_OUTSTANDING,
    });
    return strongerOf(pctStrength, usdStrength(summary.unsizedValueUsd));
}

/** Bearish Form 144 signals: aggregate notice size and a multi-filer cluster (figures of its own span), each damped when most of its value is under 10b5-1 plans. */
function proposedSaleSignals(
    sales: readonly DatedProposedSale[],
    summary: ProposedSaleSummary,
    sharesOutstanding: number | null
): InvestorFlowsSignal[] {
    const { valueUsd, plannedValueUsd, shares, pctOutstanding, filers } =
        summary;
    const signals: InvestorFlowsSignal[] = [];
    const valueStrength = proposedSaleStrength(summary);
    if (valueStrength !== null) {
        signals.push(
            makeSignal(
                'insider',
                'insider_proposed_sale',
                'bearish',
                damped(valueStrength, summary),
                {
                    valueUsd,
                    plannedValueUsd,
                    shares,
                    pctOfSharesOutstanding: pctOutstanding,
                    filers,
                    notices: sales.length,
                }
            )
        );
    }
    const span = largestClusterSpan(
        sales.map(s => ({ day: s.day, key: s.key }))
    );
    if (span.size >= INSIDER_PROPOSED_SALE_CLUSTER_MIN_FILERS) {
        // Figures of the cluster's own span, not of the whole insider window:
        // `windowDays` next to a 90-day total misreads as a 30-day total.
        const members = sales.slice(span.start, span.end);
        const clusterSummary = summarizeProposedSales(
            members,
            sharesOutstanding
        );
        signals.push(
            makeSignal(
                'insider',
                'insider_proposed_sale_cluster',
                'bearish',
                damped('moderate', clusterSummary),
                {
                    filers: span.size,
                    windowDays: INSIDER_CLUSTER_WINDOW_DAYS,
                    clusterNotices: members.length,
                    clusterValueUsd: clusterSummary.valueUsd,
                    clusterPlannedValueUsd: clusterSummary.plannedValueUsd,
                    clusterShares: clusterSummary.shares,
                },
                `${formatDay(members[0].day)} to ${formatDay(members[members.length - 1].day)}`
            )
        );
    }
    return signals;
}

/** Whether any Form 144 notice is dated on or before the reference day (coverage). */
function hasVisibleProposedSale(
    sales: readonly ProposedSale[],
    asOfDay: number | null
): boolean {
    return sales.some(sale => {
        const day = parseDay(sale.filingDate);
        return day !== null && isVisibleAsOf(day, asOfDay);
    });
}

/** Sold shares as a fraction of the position before the sale; `null` when holdings are unknown. */
function soldFraction(tx: InsiderTransaction): number | null {
    if (!isFiniteNumber(tx.sharesOwnedAfter) || tx.sharesOwnedAfter < 0) {
        return null;
    }
    if (!isFiniteNumber(tx.shares) || tx.shares <= 0) return null;
    return roundValue(tx.shares / (tx.sharesOwnedAfter + tx.shares));
}

function distinctPeople(items: readonly DatedTransaction[]): number {
    return new Set(items.map(({ tx }) => personKey(tx))).size;
}

/**
 * Insider (Form 4 + Form 144) axis over the trailing {@link INSIDER_WINDOW_DAYS} days.
 *
 * Open-market buys are the signal; sells are discounted to weak evidence
 * (scheduled and tax-driven selling is routine) unless they are large relative
 * to the seller's holdings. The axis is insufficient when the snapshot holds no
 * usable transaction at all — a quiet window with older history is real data.
 * Sufficient therefore means a directional input exists: at least one dated
 * transaction or Form 144 notice in the snapshot dated on or before the
 * reference date; rows dated after it are dropped, so a snapshot of only
 * future-dated rows is insufficient.
 *
 * Form 144 notices (filing date in the window) add two bearish signals:
 * `insider_proposed_sale` on their aggregate size — shares as % of
 * `sharesOutstanding` (weak from {@link INSIDER_PROPOSED_SALE_WEAK_PCT_OUTSTANDING}),
 * or USD value (weak from {@link INSIDER_PROPOSED_SALE_WEAK_USD}) when
 * shares outstanding is unknown or for the notices without a share count (the
 * stronger reading wins); capped at moderate — a notice is intent, and
 * the sale shows up again as a Form 4 — and `insider_proposed_sale_cluster`
 * when {@link INSIDER_PROPOSED_SALE_CLUSTER_MIN_FILERS} or more distinct filers
 * (by CIK, else normalized name; see {@link proposedSaleFilerKeys}) file
 * within one cluster span. When at least
 * {@link INSIDER_PROPOSED_SALE_PLAN_MAJORITY} of the notice value is under a
 * Rule 10b5-1 plan, both drop one strength step (never below weak).
 */
export function evaluateInsiderAxis(
    snapshot: InsiderSnapshot,
    asOfDay: number | null,
    proposedSales: readonly ProposedSale[] = [],
    sharesOutstanding: number | null = null
): InsiderAxis {
    // Sorted by day once: the cluster sweep relies on it.
    const dated: DatedTransaction[] = snapshot.transactions
        .flatMap(tx => {
            const day = parseDay(tx.date);
            return day === null || !isVisibleAsOf(day, asOfDay)
                ? []
                : [{ tx, day }];
        })
        .sort((a, b) => a.day - b.day);
    if (
        asOfDay === null ||
        (dated.length === 0 && !hasVisibleProposedSale(proposedSales, asOfDay))
    ) {
        return {
            id: 'insider',
            score: null,
            label: 'insufficient',
            sufficiency: 'insufficient',
            signals: [],
            metrics: null,
        };
    }

    const inWindow = dated.filter(({ day }) => {
        const age = daysBetween(day, asOfDay);
        return age >= 0 && age <= INSIDER_WINDOW_DAYS;
    });
    const buys = inWindow.filter(({ tx }) => tx.type === 'buy');
    const sells = inWindow.filter(({ tx }) => tx.type === 'sell');
    const largeSells = sells.filter(({ tx }) => {
        const fraction = soldFraction(tx);
        const value = transactionValue(tx);
        return (
            fraction !== null &&
            fraction >= INSIDER_LARGE_SELL_FRACTION &&
            value !== null
        );
    });
    const routineSells = sells.filter(d => !largeSells.includes(d));

    const buyValue = roundValue(sumValue(buys, false));
    const weightedBuyValue = roundValue(sumValue(buys, true));
    const sellValue = roundValue(sumValue(sells, false));
    const largeSellValue = roundValue(sumValue(largeSells, false));
    const routineSellValue = roundValue(sumValue(routineSells, false));
    const cluster = largestBuyCluster(buys);
    const clusterBuy = cluster >= INSIDER_CLUSTER_MIN_INSIDERS;
    const sales144 = windowedProposedSales(proposedSales, asOfDay);
    const sales144Summary = summarizeProposedSales(sales144, sharesOutstanding);

    const signals: InvestorFlowsSignal[] = [];

    const buyStrength = strengthOf(weightedBuyValue, {
        weak: INSIDER_BUY_WEAK_USD,
        moderate: INSIDER_BUY_MODERATE_USD,
        strong: INSIDER_BUY_STRONG_USD,
    });
    if (buyStrength !== null) {
        signals.push(
            makeSignal(
                'insider',
                'insider_open_market_buying',
                'bullish',
                buyStrength,
                {
                    buyValueUsd: buyValue,
                    weightedBuyValueUsd: weightedBuyValue,
                    buyers: distinctPeople(buys),
                    buyCount: buys.length,
                }
            )
        );
    }
    if (clusterBuy) {
        signals.push(
            makeSignal(
                'insider',
                'insider_cluster_buy',
                'bullish',
                cluster >= INSIDER_CLUSTER_STRONG_INSIDERS
                    ? 'strong'
                    : 'moderate',
                {
                    insiders: cluster,
                    windowDays: INSIDER_CLUSTER_WINDOW_DAYS,
                    buyValueUsd: buyValue,
                }
            )
        );
    }
    if (largeSells.length > 0 && largeSellValue >= INSIDER_SELL_MIN_USD) {
        const sellers = distinctPeople(largeSells);
        signals.push(
            makeSignal(
                'insider',
                'insider_large_selling',
                'bearish',
                sellers >= INSIDER_LARGE_SELL_STRONG_INSIDERS
                    ? 'strong'
                    : 'moderate',
                {
                    largeSellValueUsd: largeSellValue,
                    largeSellers: sellers,
                    largeSellCount: largeSells.length,
                    minSoldFraction: INSIDER_LARGE_SELL_FRACTION,
                }
            )
        );
    }
    if (routineSellValue >= INSIDER_SELL_MIN_USD) {
        signals.push(
            makeSignal(
                'insider',
                'insider_routine_selling',
                'bearish',
                'weak',
                {
                    sellValueUsd: routineSellValue,
                    sellers: distinctPeople(routineSells),
                    sellCount: routineSells.length,
                }
            )
        );
    }
    signals.push(
        ...proposedSaleSignals(sales144, sales144Summary, sharesOutstanding)
    );
    if (inWindow.length === 0 && sales144.length === 0) {
        signals.push(
            makeSignal('insider', 'insider_quiet', 'neutral', 'weak', {
                transactionsInWindow: 0,
                windowDays: INSIDER_WINDOW_DAYS,
            })
        );
    }

    const metrics: InsiderMetrics = {
        buyCount: buys.length,
        buyerCount: distinctPeople(buys),
        buyValueUsd: buyValue,
        sellCount: sells.length,
        sellerCount: distinctPeople(sells),
        sellValueUsd: sellValue,
        netValueUsd: roundValue(buyValue - sellValue),
        weightedBuyValueUsd: weightedBuyValue,
        largestBuyCluster: cluster,
        clusterBuy,
        largeSellCount: largeSells.length,
        proposedSaleCount: sales144.length,
        proposedSaleFilerCount: sales144Summary.filers,
        proposedSaleValueUsd: sales144Summary.valueUsd,
        proposedSaleShares: sales144Summary.shares,
        proposedSalePctOutstanding: sales144Summary.pctOutstanding,
        proposedSalePlannedValueUsd: sales144Summary.plannedValueUsd,
    };
    const score = scoreFromSignals(signals);
    return {
        id: 'insider',
        score,
        label: labelForScore(score),
        sufficiency: 'sufficient',
        signals: sortSignals(signals),
        metrics,
    };
}

/** Number of usable transactions inside the insider window (for freshness metadata). */
export function countInsiderTransactionsInWindow(
    snapshot: InsiderSnapshot,
    asOfDay: number | null
): number {
    if (asOfDay === null) return 0;
    return snapshot.transactions.filter(tx => {
        const day = parseDay(tx.date);
        if (day === null) return false;
        const age = daysBetween(day, asOfDay);
        return age >= 0 && age <= INSIDER_WINDOW_DAYS;
    }).length;
}
