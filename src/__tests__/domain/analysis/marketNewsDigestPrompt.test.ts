import { describe, it, expect } from 'vitest';
import { buildMarketNewsDigestPrompt as buildMarketNewsDigestPromptRaw } from '@/domain/analysis/marketNewsDigestPrompt';
import { DRIVER_READER_FACING_RULE } from '@/domain/analysis/newsPrompt';
import type { EnrichedNewsItem, Skill } from '@/domain/types';

// `buildMarketNewsDigestPrompt` now returns `{ stable, dynamic }` (assembly
// split) — this file's call sites predate the split and assert
// against the single legacy combined string (`stable + '\n\n' + dynamic`,
// exactly the string dispatch still sends as the `prompt` fallback field).
const buildMarketNewsDigestPrompt = (
    ...args: Parameters<typeof buildMarketNewsDigestPromptRaw>
): string => {
    const { stable, dynamic } = buildMarketNewsDigestPromptRaw(...args);
    return `${stable}\n\n${dynamic}`;
};

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

describe('buildMarketNewsDigestPrompt — 출력 로케일', () => {
    /**
     * 이 축은 프롬프트 **본문**에 필드 언어 지시를 하드코딩하고 있었다.
     * 말미 리마인더는 필드 설명을 덮으려고 만든 것이라 과업 규칙으로 적힌
     * 지시까지 뒤집는다고 볼 수 없다 — 소스에서 갈라야 한다.
     */
    it('로케일을 생략하면 ko와 바이트가 같다', () => {
        expect(buildMarketNewsDigestPrompt('미국 암호화폐', [ITEM], [])).toBe(
            buildMarketNewsDigestPrompt('미국 암호화폐', [ITEM], [], 'ko')
        );
    });

    it.each(['en', 'ja', 'zh'] as const)(
        '%s: 한국어로 쓰라는 지시가 본문에 남지 않는다',
        locale => {
            const prompt = buildMarketNewsDigestPrompt(
                '미국 암호화폐',
                [ITEM],
                [],
                locale
            );
            expect(prompt).not.toContain('must be written in Korean');
            expect(prompt).not.toContain('in Korean (존댓말)');

            // 스키마 예시는 모델이 그대로 흉내 내는 자리라 지시문보다 힘이 셀
            // 수 있다 — `(한국어)` 표기가 남으면 리마인더가 무력해진다.
            expect(prompt).not.toContain('한국어');
        }
    );

    it('ko: 예전 지시문이 그대로다', () => {
        expect(
            buildMarketNewsDigestPrompt('미국 암호화폐', [ITEM], [], 'ko')
        ).toContain('Korean (존댓말)');
    });
});

describe('buildMarketNewsDigestPrompt — sentiment tally + age', () => {
    const NOW = new Date('2026-06-15T18:00:00Z');

    it("renders the sentiment tally header and each item's age suffix", () => {
        const { dynamic } = buildMarketNewsDigestPromptRaw(
            '미국 암호화폐',
            [ITEM],
            [],
            'ko',
            NOW
        );
        expect(dynamic).toContain(
            'Sentiment tally: 1 bullish / 0 bearish / 0 neutral (high impact: 1 bullish / 0 bearish)'
        );
        // ITEM published 2026-06-15T12:00:00Z, NOW 18:00:00Z -> 6h ago
        expect(dynamic).toContain('Published: 2026-06-15T12:00:00Z (6h ago)');
    });

    it('omits the age suffix when `now` is omitted — the domain never reads the wall clock', () => {
        const recent: EnrichedNewsItem = {
            ...ITEM,
            publishedAt: '2026-09-18T12:00:00.000Z',
        };
        const { dynamic } = buildMarketNewsDigestPromptRaw(
            '미국 암호화폐',
            [recent],
            []
        );
        expect(dynamic).toContain('Published: 2026-09-18T12:00:00.000Z\n');
        expect(dynamic).not.toMatch(/\(\d+[hd] ago\)/);
    });
});

describe('buildMarketNewsDigestPrompt — 독자용 문구 규칙', () => {
    const dynamicFor = (locale?: 'ko' | 'en' | 'ja' | 'zh'): string =>
        buildMarketNewsDigestPromptRaw('미국 암호화폐', [ITEM], [], locale)
            .dynamic;

    it.each([undefined, 'en', 'ja', 'zh'] as const)(
        '%s: 스키마 블록에 "제공된" 같은 입력 지칭 표현이 없다',
        locale => {
            const dynamic = dynamicFor(locale);
            const schema = dynamic.slice(
                dynamic.indexOf('## Output Schema'),
                dynamic.indexOf('## Allowed Values')
            );
            expect(schema).toContain('currentDriverKo');
            expect(schema).not.toContain('제공된');
        }
    );

    it('출처 제한 지시와 독자용 문구 규칙이 Rules 블록에 있다', () => {
        const dynamic = dynamicFor();
        const rules = dynamic.slice(dynamic.indexOf('\nRules:'));
        expect(rules).toContain(
            'Base currentDriverKo only on the articles above'
        );
        expect(rules).toContain(DRIVER_READER_FACING_RULE);
    });

    it('Data Boundary가 가격·거래량 데이터가 없다고 밝히도록 모델을 유도하지 않는다', () => {
        const dynamic = dynamicFor();
        expect(dynamic).not.toMatch(/No price\/volume data/);
        expect(dynamic).toContain('Do not attribute price moves to the news.');
    });
});
