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
    const buyCount = trades.filter(t => t.side === 'buy').length;
    const sellCount = trades.filter(t => t.side === 'sell').length;
    const unknownCount = trades.filter(t => t.side === 'unknown').length;
    const senateCount = trades.filter(t => t.chamber === 'senate').length;
    const houseCount = trades.filter(t => t.chamber === 'house').length;
    const uniqueMembers = new Set(trades.map(t => t.office)).size;
    return {
        buyCount,
        sellCount,
        unknownCount,
        direction: directionOf(buyCount, sellCount, trades.length),
        uniqueMembers,
        senateCount,
        houseCount,
    };
}
