import { describe, expect, it } from 'vitest';
import { summarizeCongressTrades } from '@/domain/analysis/summarizeCongressTrades';
import type { CongressTrade } from '@/domain/types';

function trade(p: Partial<CongressTrade>): CongressTrade {
    return {
        chamber: 'senate',
        firstName: 'A',
        lastName: 'B',
        office: 'A B',
        district: 'WV',
        owner: 'self',
        side: 'buy',
        rawType: 'Purchase',
        amount: { min: 1001, max: 15000, label: '$1,001 - $15,000' },
        assetType: 'Stock',
        assetDescription: 'X',
        transactionDate: '2026-01-01',
        disclosureDate: '2026-02-01',
        link: '',
        capitalGainsOver200USD: false,
        ...p,
    };
}

describe('summarizeCongressTrades', () => {
    it('빈 입력은 no_trades', () => {
        expect(summarizeCongressTrades([])).toEqual({
            buyCount: 0,
            sellCount: 0,
            unknownCount: 0,
            direction: 'no_trades',
            uniqueMembers: 0,
            senateCount: 0,
            houseCount: 0,
        });
    });
    it('매수 우세는 net_buying', () => {
        const s = summarizeCongressTrades([
            trade({ side: 'buy' }),
            trade({ side: 'buy' }),
            trade({ side: 'sell' }),
        ]);
        expect(s.buyCount).toBe(2);
        expect(s.sellCount).toBe(1);
        expect(s.direction).toBe('net_buying');
    });
    it('매도 우세는 net_selling', () => {
        expect(
            summarizeCongressTrades([
                trade({ side: 'sell' }),
                trade({ side: 'buy' }),
                trade({ side: 'sell' }),
            ]).direction
        ).toBe('net_selling');
    });
    it('동수는 balanced', () => {
        expect(
            summarizeCongressTrades([
                trade({ side: 'buy' }),
                trade({ side: 'sell' }),
            ]).direction
        ).toBe('balanced');
    });
    it('unknown은 방향 판정에서 제외하되 카운트', () => {
        const s = summarizeCongressTrades([
            trade({ side: 'unknown' }),
            trade({ side: 'unknown' }),
        ]);
        expect(s.unknownCount).toBe(2);
        expect(s.direction).toBe('balanced');
    });
    it('의원 고유 수는 office 기준 dedup', () => {
        const s = summarizeCongressTrades([
            trade({ office: 'A' }),
            trade({ office: 'A' }),
            trade({ office: 'B' }),
        ]);
        expect(s.uniqueMembers).toBe(2);
    });
    it('chamber별 건수를 센다', () => {
        const s = summarizeCongressTrades([
            trade({ chamber: 'senate' }),
            trade({ chamber: 'house' }),
            trade({ chamber: 'house' }),
        ]);
        expect(s.senateCount).toBe(1);
        expect(s.houseCount).toBe(2);
    });
});
