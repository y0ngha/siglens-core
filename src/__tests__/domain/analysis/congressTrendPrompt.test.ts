import { describe, expect, it } from 'vitest';
import { buildCongressTrendPrompt as buildCongressTrendPromptRaw } from '@/domain/analysis/congressTrendPrompt';
import type { CongressTrade, CongressTradeStats, Skill } from '@/domain/types';

// `buildCongressTrendPrompt` now returns `{ stable, dynamic }` (spec §3.4
// assembly split) — this file's call sites predate the split and assert
// against the single legacy combined string (`stable + '\n\n' + dynamic`,
// exactly the string dispatch still sends as the `prompt` fallback field).
const buildCongressTrendPrompt = (
    ...args: Parameters<typeof buildCongressTrendPromptRaw>
): string => {
    const { stable, dynamic } = buildCongressTrendPromptRaw(...args);
    return `${stable}\n\n${dynamic}`;
};

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
    it('trades가 빈 배열이면 프롬프트에 No-trades 플레이스홀더를 포함한다', () => {
        const p = buildCongressTrendPrompt('AAPL', [], stats, []);
        expect(p).toContain('No trades available');
    });
    it('congress 카테고리 스킬만 주입하고 비-congress는 제외한다', () => {
        const skills = [
            {
                name: 'CongressInsiderGuide',
                description: '',
                indicators: [],
                confidenceWeight: 1,
                content: 'CONGRESS_SKILL_CONTENT',
                category: 'congress',
            },
            {
                name: 'TechSkill',
                description: '',
                indicators: [],
                confidenceWeight: 1,
                content: 'TECH_SKILL_CONTENT',
                category: 'reversal_bullish',
            },
        ] as unknown as Skill[];
        const p = buildCongressTrendPrompt('AAPL', trades, stats, skills);
        expect(p).toContain('CongressInsiderGuide');
        expect(p).toContain('CONGRESS_SKILL_CONTENT');
        expect(p).not.toContain('TECH_SKILL_CONTENT');
    });
});
