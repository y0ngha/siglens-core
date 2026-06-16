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
 * 거래 표를 결정론적 건수 통계로 요약한다(건수 기반 우세 — amount 구간은 합산 불가).
 */
export function summarizeCongressTrades(
    trades: readonly CongressTrade[]
): CongressTradeStats {
    let buyCount = 0,
        sellCount = 0,
        unknownCount = 0,
        senateCount = 0,
        houseCount = 0;
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
