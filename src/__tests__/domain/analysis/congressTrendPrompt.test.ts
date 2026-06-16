import { describe, expect, it } from 'vitest';
import { buildCongressTrendPrompt } from '@/domain/analysis/congressTrendPrompt';
import type { CongressTrade, CongressTradeStats } from '@/domain/types';

const stats: CongressTradeStats = {
    buyCount: 3,
    sellCount: 1,
    unknownCount: 0,
    direction: 'net_buying',
    uniqueMembers: 2,
    senateCount: 2,
    houseCount: 2,
};
const trades: CongressTrade[] = [
    {
        chamber: 'senate',
        firstName: 'Shelley',
        lastName: 'Capito',
        office: 'Shelley Capito',
        district: 'WV',
        owner: 'spouse',
        side: 'buy',
        rawType: 'Purchase',
        amount: { min: 1001, max: 15000, label: '$1,001 - $15,000' },
        assetType: 'Stock',
        assetDescription: 'Apple Inc',
        transactionDate: '2026-04-17',
        disclosureDate: '2026-05-07',
        link: '',
        capitalGainsOver200USD: false,
    },
];

describe('buildCongressTrendPrompt', () => {
    it('심볼과 건수 통계를 프롬프트에 주입한다', () => {
        const p = buildCongressTrendPrompt('AAPL', trades, stats, []);
        expect(p).toContain('AAPL');
        expect(p).toContain('3');
        expect(p).toContain('net_buying');
    });
    it('공시 지연(약 45일) 주의를 프롬프트에 포함한다', () => {
        const p = buildCongressTrendPrompt('AAPL', trades, stats, []);
        expect(p.toLowerCase()).toContain('disclos');
    });
    it('JSON 응답 필드(summaryKo 등)를 지시한다', () => {
        const p = buildCongressTrendPrompt('AAPL', trades, stats, []);
        expect(p).toContain('summaryKo');
        expect(p).toContain('overallSentiment');
    });
});
