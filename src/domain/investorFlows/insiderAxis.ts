import {
    INSIDER_BUY_MODERATE_USD,
    INSIDER_BUY_STRONG_USD,
    INSIDER_BUY_WEAK_USD,
    INSIDER_CLUSTER_MIN_INSIDERS,
    INSIDER_CLUSTER_STRONG_INSIDERS,
    INSIDER_CLUSTER_WINDOW_DAYS,
    INSIDER_LARGE_SELL_FRACTION,
    INSIDER_LARGE_SELL_STRONG_INSIDERS,
    INSIDER_ROLE_WEIGHTS,
    INSIDER_SELL_MIN_USD,
    INSIDER_WINDOW_DAYS,
} from '@/domain/investorFlows/constants';
import {
    daysBetween,
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

/**
 * Largest number of distinct insiders whose buys fall within one cluster span.
 * `buys` must be sorted by day ascending; a two-pointer sweep keeps it linear.
 * The mutable `start`/`best` cursors are deliberate: a reduce over every
 * window start would be O(n²), and this runs once per symbol per snapshot.
 */
function largestBuyCluster(buys: readonly DatedTransaction[]): number {
    const counts = new Map<string, number>();
    let start = 0;
    let best = 0;
    for (const buy of buys) {
        const key = personKey(buy.tx);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        while (
            daysBetween(buys[start].day, buy.day) > INSIDER_CLUSTER_WINDOW_DAYS
        ) {
            const startKey = personKey(buys[start].tx);
            const remaining = (counts.get(startKey) ?? 1) - 1;
            if (remaining === 0) counts.delete(startKey);
            else counts.set(startKey, remaining);
            start += 1;
        }
        best = Math.max(best, counts.size);
    }
    return best;
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
 * Insider (Form 4) axis over the trailing {@link INSIDER_WINDOW_DAYS} days.
 *
 * Open-market buys are the signal; sells are discounted to weak evidence
 * (scheduled and tax-driven selling is routine) unless they are large relative
 * to the seller's holdings. The axis is insufficient when the snapshot holds no
 * usable transaction at all — a quiet window with older history is real data.
 * Sufficient therefore means a directional input exists: at least one dated
 * transaction in the snapshot dated on or before the reference date;
 * transactions dated after it are dropped, so a snapshot of only future-dated
 * transactions is insufficient.
 */
export function evaluateInsiderAxis(
    snapshot: InsiderSnapshot,
    asOfDay: number | null
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
    if (asOfDay === null || dated.length === 0) {
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
    if (inWindow.length === 0) {
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
