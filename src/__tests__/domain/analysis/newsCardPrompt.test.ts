import { describe, it, expect } from 'vitest';
import { buildNewsCardAnalysisPrompt as buildNewsCardAnalysisPromptRaw } from '@/domain/analysis/newsCardPrompt';
import type { NewsItem } from '@/domain/types';

// `buildNewsCardAnalysisPrompt` now returns `{ stable, dynamic }` (spec §3.4
// assembly split) — this file's call sites predate the split and assert
// against the single legacy combined string (`stable + '\n\n' + dynamic`,
// exactly the string dispatch still sends as the `prompt` fallback field).
const buildNewsCardAnalysisPrompt = (
    ...args: Parameters<typeof buildNewsCardAnalysisPromptRaw>
): string => {
    const { stable, dynamic } = buildNewsCardAnalysisPromptRaw(...args);
    return `${stable}\n\n${dynamic}`;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const FULL_NEWS_ITEM: NewsItem = {
    id: 'news-001',
    symbol: 'NVDA',
    source: 'Bloomberg',
    url: 'https://bloomberg.com/nvda-ai-chips',
    publishedAt: '2025-04-28T14:30:00Z',
    titleEn:
        'Nvidia unveils next-gen AI chip platform targeting data center workloads',
    bodyEn: 'Nvidia Corporation announced its next generation of AI-focused GPU chips on Monday, targeting enterprise data center customers. The new platform promises a 3x performance improvement over the previous generation.',
};

const NULL_BODY_NEWS_ITEM: NewsItem = {
    id: 'news-002',
    symbol: 'TSLA',
    source: 'Reuters',
    url: 'https://reuters.com/tsla-delivery',
    publishedAt: '2025-04-27T10:00:00Z',
    titleEn: 'Tesla misses Q1 delivery estimates for third consecutive quarter',
    bodyEn: null,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('buildNewsCardAnalysisPrompt', () => {
    it('produces a prompt with full structure including JSON schema and all required output fields', () => {
        const prompt = buildNewsCardAnalysisPrompt(FULL_NEWS_ITEM);

        // Source metadata
        expect(prompt).toContain('NVDA');
        expect(prompt).toContain('Bloomberg');
        expect(prompt).toContain('2025-04-28T14:30:00Z');
        expect(prompt).toContain(
            'Nvidia unveils next-gen AI chip platform targeting data center workloads'
        );
        expect(prompt).toContain('Nvidia Corporation announced');

        // Output schema fields
        expect(prompt).toContain('titleKo');
        expect(prompt).toContain('bodyKo');
        expect(prompt).toContain('summaryKo');
        expect(prompt).toContain(
            'what happened, why it matters for the named symbol, and what investors should watch'
        );
        expect(prompt).toContain('must add substance beyond the title');
        expect(prompt).toContain('reported figures, growth rates, guidance');
        expect(prompt).toContain(
            'never omit material information merely to satisfy brevity'
        );
        expect(prompt).not.toContain('80-140');
        // Few-shot good/bad pair for summaryKo
        expect(prompt).toContain('Few-shot for summaryKo');
        expect(prompt).toContain('BAD (restates/translates the title');
        expect(prompt).toContain("GOOD (resolves the body's actual point");
        expect(prompt).toContain('Preserve important numbers');
        expect(prompt).toContain('sentiment');
        expect(prompt).toContain('category');

        // Sentiment and category options must be specified
        expect(prompt).toContain('bullish');
        expect(prompt).toContain('bearish');
        expect(prompt).toContain('neutral');
        expect(prompt).toContain('earnings');
        expect(prompt).toContain('regulation');

        // Instruction to return JSON only
        expect(prompt).toContain('JSON');
        expect(prompt).toContain('Data Boundary');
        expect(prompt).toContain('untrusted source data');
        expect(prompt).toContain('Do not fabricate missing article body text');
        expect(prompt).toContain('## Allowed Values');
        expect(prompt).toContain('sentiment: "bullish", "neutral", "bearish"');
        expect(prompt).toContain(
            'category: "earnings", "m_and_a", "guidance", "regulation", "macro", "product", "other"'
        );
        expect(prompt).toContain(
            'priceImpact: "high", "medium", "low", "negligible"'
        );
    });

    it('handles a news item with null body by omitting body section gracefully', () => {
        const prompt = buildNewsCardAnalysisPrompt(NULL_BODY_NEWS_ITEM);

        // Symbol and title still present
        expect(prompt).toContain('TSLA');
        expect(prompt).toContain('Tesla misses Q1 delivery estimates');

        // Output schema still requests bodyKo (nullable)
        expect(prompt).toContain('bodyKo');

        // Should not throw or include "null" as a raw literal in article body
        expect(prompt).not.toContain('\nbodyEn: null');
        expect(prompt).not.toContain('Body: null');
        expect(prompt).toContain(
            'prefer sentiment: "neutral" and priceImpact: "negligible" rather than guessing'
        );
        expect(prompt).toContain(
            'based only on the headline and avoid guessing missing details'
        );
    });
});

describe('sourceLanguage', () => {
    const KOREAN_NEWS_ITEM: NewsItem = {
        id: 'news-kr-001',
        symbol: '005930.KS',
        source: '네이버뉴스',
        url: 'https://news.example.com/article/1',
        publishedAt: '2026-08-17T01:30:00Z',
        titleEn: '삼성전자, 3분기 영업이익 시장 기대 상회',
        bodyEn: '삼성전자가 반도체 부문 회복에 힘입어 시장 예상을 웃도는 실적을 냈다.',
        sourceLanguage: 'ko',
    };

    it('drops the translation instruction for Korean-language articles', () => {
        // 한국어를 한국어로 "번역"시키면 토큰을 낭비하고, 모델이 이미 정확한 제목을
        // 조용히 고쳐 쓸 여지를 준다.
        const prompt = buildNewsCardAnalysisPrompt(KOREAN_NEWS_ITEM);

        expect(prompt).toContain('You are a financial news classifier.');
        expect(prompt).not.toContain('translator');
        expect(prompt).not.toContain('natural Korean translation');
    });

    it('tells the model to copy Korean title and body verbatim', () => {
        const prompt = buildNewsCardAnalysisPrompt(KOREAN_NEWS_ITEM);

        expect(prompt).toContain('ALREADY in Korean — copy it verbatim');
        expect(prompt).toContain('Do not reword, shorten, or re-punctuate it.');
    });

    it('still asks for summary and classification — the analytical work remains', () => {
        const prompt = buildNewsCardAnalysisPrompt(KOREAN_NEWS_ITEM);

        expect(prompt).toContain('summaryKo');
        expect(prompt).toContain('sentiment');
        expect(prompt).toContain('category');
        expect(prompt).toContain('priceImpact');
    });

    it('keeps the English translation path when sourceLanguage is absent', () => {
        // `sourceLanguage`가 없는 기존 피드는 전부 영문이었다 — 동작이 바뀌면 안 된다.
        const prompt = buildNewsCardAnalysisPrompt(FULL_NEWS_ITEM);

        expect(prompt).toContain(
            'You are a financial news translator and classifier.'
        );
        expect(prompt).toContain(
            'natural Korean translation of the source title.'
        );
    });

    it("treats an explicit 'en' exactly like the absent case", () => {
        const explicit = buildNewsCardAnalysisPrompt({
            ...FULL_NEWS_ITEM,
            sourceLanguage: 'en',
        });
        const implicit = buildNewsCardAnalysisPrompt(FULL_NEWS_ITEM);

        expect(explicit).toBe(implicit);
    });
});

describe('bodyTruncated', () => {
    const TRUNCATED_ITEM: NewsItem = {
        ...FULL_NEWS_ITEM,
        bodyEn: 'Nvidia Corporation announced its next generation of AI-focused GPU chips on Monday, targeting enterprise data center',
        bodyTruncated: true,
    };

    it('labels the body as an excerpt so the model knows text is missing', () => {
        // 피드는 리드 문단만 주는 일이 잦고, 절단은 문장 중간에서 일어난다
        // (실측: FMP news/stock 10건 중 8건, 네이버는 사실상 전부).
        const prompt = buildNewsCardAnalysisPrompt(TRUNCATED_ITEM);

        expect(prompt).toContain('EXCERPT — cut off mid-article');
    });

    it('forbids inventing what the excerpt does not state', () => {
        // 프롬프트가 "보고된 수치·가이던스를 보존하라"고 요구하는데 잘려서 없는 정보라면,
        // 모델이 스스로 채워 넣는 쪽으로 유인된다.
        const prompt = buildNewsCardAnalysisPrompt(TRUNCATED_ITEM);

        expect(prompt).toContain(
            'Do not infer or invent figures, guidance, outcomes, or conclusions'
        );
        expect(prompt).toContain(
            'say so plainly in summaryKo rather than guessing'
        );
    });

    it('adds nothing when the body is complete', () => {
        const prompt = buildNewsCardAnalysisPrompt(FULL_NEWS_ITEM);

        expect(prompt).not.toContain('EXCERPT');
        expect(prompt).not.toContain('cut off mid-article');
    });

    it('leaves no dangling blank line when the rule is absent', () => {
        // 빈 문자열 보간이 규칙 목록 한가운데에 빈 줄을 남기면 프롬프트 구조가 흐트러진다.
        const prompt = buildNewsCardAnalysisPrompt(FULL_NEWS_ITEM);

        expect(prompt).not.toMatch(/\n[ \t]*\n[ \t]*\n/);
    });

    it('keeps the untruncated prompt byte-identical to the absent case', () => {
        // `bodyTruncated`가 없던 기존 피드의 프롬프트가 조금도 바뀌면 안 된다.
        const explicit = buildNewsCardAnalysisPrompt({
            ...FULL_NEWS_ITEM,
            bodyTruncated: false,
        });
        const implicit = buildNewsCardAnalysisPrompt(FULL_NEWS_ITEM);

        expect(explicit).toBe(implicit);
    });

    it('still applies when the article is Korean', () => {
        // 네이버는 한국어이면서 동시에 잘려 있다 — 두 분기가 함께 걸려야 한다.
        const prompt = buildNewsCardAnalysisPrompt({
            ...FULL_NEWS_ITEM,
            titleEn: '삼성전자, 3분기 영업이익 시장 기대 상회',
            bodyEn: '삼성전자가 반도체 부문 회복에 힘입어',
            sourceLanguage: 'ko',
            bodyTruncated: true,
        });

        expect(prompt).toContain('EXCERPT — cut off mid-article');
        expect(prompt).toContain('ALREADY in Korean — copy it verbatim');
    });
});

describe('buildNewsCardAnalysisPrompt — 출력 로케일', () => {
    /**
     * 이 빌더는 과업 자체가 "번역"이라 **본문 지시가 언어를 못 박는다**.
     * 프롬프트 말미 리마인더는 필드 설명을 덮으려고 만든 것이라 여기까지
     * 뒤집는다고 볼 수 없다 — 소스에서 직접 갈라야 한다(PR #184 리뷰 4라운드).
     */
    it('로케일을 생략하면 ko와 바이트가 같다', () => {
        expect(buildNewsCardAnalysisPrompt(FULL_NEWS_ITEM)).toBe(
            buildNewsCardAnalysisPrompt(FULL_NEWS_ITEM, 'ko')
        );
    });

    /** 한국어 기사를 영어로 낼 때 — 번역 방향이 뒤집힌다. */
    it('en 출력이면 한국어 번역 지시가 남지 않는다', () => {
        const prompt = buildNewsCardAnalysisPrompt(
            { ...FULL_NEWS_ITEM, sourceLanguage: 'ko' },
            'en'
        );
        expect(prompt).not.toContain('Korean translation');
        expect(prompt).toContain('natural English translation');
    });

    /** 원문 언어와 출력 언어가 같으면 번역이 아니라 그대로 쓰는 경로다. */
    it('영문 원문 + en 출력이면 verbatim 경로로 간다', () => {
        const prompt = buildNewsCardAnalysisPrompt(
            { ...FULL_NEWS_ITEM, sourceLanguage: 'en' },
            'en'
        );
        expect(prompt).toContain('ALREADY in English');
        expect(prompt).toContain('financial news classifier');
    });

    /** few-shot 예문이 한국어라 다른 언어에서는 본보기가 어긋난다. */
    it('한국어 few-shot은 ko에서만 실린다', () => {
        expect(buildNewsCardAnalysisPrompt(FULL_NEWS_ITEM, 'ko')).toContain(
            '엔비디아가'
        );
        for (const locale of ['en', 'ja', 'zh'] as const) {
            expect(
                buildNewsCardAnalysisPrompt(FULL_NEWS_ITEM, locale)
            ).not.toContain('엔비디아가');
        }
    });
});
