import type {
    CongressTrade,
    CongressTradeStats,
    CongressTrendDirection,
} from '@/domain/types';

function directionOf(
    buyCount: number,
    sellCount: number,
    total: number
): CongressTrendDirection {
    if (total === 0) return 'no_trades';
    if (buyCount > sellCount) return 'net_buying';
    if (sellCount > buyCount) return 'net_selling';
    return 'balanced';
}

/**
 * Summarize congress trades into count-based statistics.
 *
 * Net direction is determined by buy/sell COUNTS only — amount ranges are
 * coarse statutory bands and cannot be summed into a notional value.
 *
 * @param trades - Normalized congress trades (an empty array is valid — 0 trades is a normal state, not an error).
 * @returns Count-based statistics and net direction — see {@link CongressTradeStats}.
 */
export function summarizeCongressTrades(
    trades: readonly CongressTrade[]
): CongressTradeStats {
    let buyCount = 0;
    let sellCount = 0;
    let unknownCount = 0;
    let senateCount = 0;
    let houseCount = 0;
    const members = new Set<string>();
    for (const t of trades) {
        if (t.side === 'buy') buyCount++;
        else if (t.side === 'sell') sellCount++;
        else unknownCount++;
        if (t.chamber === 'senate') senateCount++;
        else houseCount++;
        members.add(t.office);
    }
    return {
        buyCount,
        sellCount,
        unknownCount,
        direction: directionOf(buyCount, sellCount, trades.length),
        uniqueMembers: members.size,
        senateCount,
        houseCount,
    };
}
