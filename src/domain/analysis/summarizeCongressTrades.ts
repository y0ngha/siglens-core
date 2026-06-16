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
    const acc = trades.reduce(
        (a, t) => {
            if (t.side === 'buy') a.buyCount++;
            else if (t.side === 'sell') a.sellCount++;
            else a.unknownCount++;
            if (t.chamber === 'senate') a.senateCount++;
            else a.houseCount++;
            a.members.add(t.office);
            return a;
        },
        {
            buyCount: 0,
            sellCount: 0,
            unknownCount: 0,
            senateCount: 0,
            houseCount: 0,
            members: new Set<string>(),
        }
    );
    return {
        buyCount: acc.buyCount,
        sellCount: acc.sellCount,
        unknownCount: acc.unknownCount,
        direction: directionOf(acc.buyCount, acc.sellCount, trades.length),
        uniqueMembers: acc.members.size,
        senateCount: acc.senateCount,
        houseCount: acc.houseCount,
    };
}
