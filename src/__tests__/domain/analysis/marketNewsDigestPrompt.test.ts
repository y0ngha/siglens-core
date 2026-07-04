import { describe, it, expect } from 'vitest';
import { buildMarketNewsDigestPrompt } from '@/domain/analysis/marketNewsDigestPrompt';
import type { EnrichedNewsItem, Skill } from '@/domain/types';

const ITEM: EnrichedNewsItem = {
    id: 'c1',
    symbol: '__NEWS_CRYPTO__',
    source: 'CoinWire',
    url: 'https://example.com/btc',
    publishedAt: '2026-06-15T12:00:00Z',
    titleEn: 'Bitcoin ETF inflows hit record',
    bodyEn: 'Spot BTC ETFs saw $1.2B net inflows this week.',
    card: {
        titleKo: '비트코인 ETF 유입 사상 최대',
        bodyKo: '현물 BTC ETF에 주간 12억 달러가 순유입되었습니다.',
        summaryKo: '현물 비트코인 ETF로 자금이 대규모 유입된 점이 핵심입니다.',
        sentiment: 'bullish',
        category: 'macro',
        priceImpact: 'high',
    },
};

describe('buildMarketNewsDigestPrompt 함수는', () => {
    it('카테고리 라벨과 기사 제목을 프롬프트에 포함한다', () => {
        const prompt = buildMarketNewsDigestPrompt('미국 암호화폐', [ITEM], []);
        expect(prompt).toContain('미국 암호화폐');
        expect(prompt).toContain('Bitcoin ETF inflows hit record');
    });
    it('회사 중심 문구("named symbol") 대신 카테고리 흐름을 요청한다', () => {
        const prompt = buildMarketNewsDigestPrompt('미국 암호화폐', [ITEM], []);
        expect(prompt).not.toContain('named symbol');
        expect(prompt).toContain('news flow');
    });
    it('기사가 없으면 빈 상태 지침을 포함한다', () => {
        const prompt = buildMarketNewsDigestPrompt('미국 외환', [], []);
        expect(prompt).toContain('No recent news articles');
    });
    it('bodyKo가 null이면 Body 행을 프롬프트에 포함하지 않는다', () => {
        const noBodyItem: EnrichedNewsItem = {
            ...ITEM,
            card: { ...ITEM.card, bodyKo: null },
        };
        const prompt = buildMarketNewsDigestPrompt(
            '미국 암호화폐',
            [noBodyItem],
            []
        );
        expect(prompt).not.toContain('Body (KO):');
    });
    it('news 카테고리 스킬만 주입한다', () => {
        const newsSkill: Skill = {
            name: 'macro-lens',
            description: '',
            category: 'news',
            indicators: [],
            confidenceWeight: 0.5,
            content: 'MACRO_SKILL_BODY',
            gating: { tier: 'always_on' },
        };
        const chartSkill: Skill = {
            name: 'rsi',
            description: '',
            category: 'fundamental',
            indicators: [],
            confidenceWeight: 0.5,
            content: 'CHART_SKILL_BODY',
            gating: { tier: 'always_on' },
        };
        const prompt = buildMarketNewsDigestPrompt(
            '미국 일반',
            [ITEM],
            [newsSkill, chartSkill]
        );
        expect(prompt).toContain('MACRO_SKILL_BODY');
        expect(prompt).not.toContain('CHART_SKILL_BODY');
    });
});
