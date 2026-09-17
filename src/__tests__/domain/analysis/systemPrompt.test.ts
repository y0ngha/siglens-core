import { describe, it, expect } from 'vitest';
import {
    AI_SYSTEM_PROMPT,
    OVERALL_SYSTEM_PROMPT,
    NEWS_SYSTEM_PROMPT,
    NEWS_CARD_SYSTEM_PROMPT,
    FUNDAMENTAL_SYSTEM_PROMPT,
    FINANCIALS_SYSTEM_PROMPT,
    CONGRESS_SYSTEM_PROMPT,
    OPTIONS_SYSTEM_PROMPT,
} from '@/domain/analysis/systemPrompt';

/**
 * Each per-analysis prompt is composed of a distinct persona first line followed
 * by the shared base (ANALYSIS_SYSTEM_BASE — module-private). The persona
 * constants are module-internal (not re-exported from the package barrel) but
 * the test imports them directly from the module file.
 */
const PROMPTS: Array<{
    name: string;
    value: string;
    personaFirstLine: string;
}> = [
    {
        name: 'AI_SYSTEM_PROMPT',
        value: AI_SYSTEM_PROMPT,
        personaFirstLine:
            'You are a senior technical analyst specializing in equity chart analysis.',
    },
    {
        name: 'OVERALL_SYSTEM_PROMPT',
        value: OVERALL_SYSTEM_PROMPT,
        personaFirstLine: 'You are a senior investment analyst.',
    },
    {
        name: 'NEWS_SYSTEM_PROMPT',
        value: NEWS_SYSTEM_PROMPT,
        personaFirstLine: 'You are a financial news analyst.',
    },
    {
        name: 'NEWS_CARD_SYSTEM_PROMPT',
        value: NEWS_CARD_SYSTEM_PROMPT,
        personaFirstLine: 'You are a financial news summarizer.',
    },
    {
        name: 'FUNDAMENTAL_SYSTEM_PROMPT',
        value: FUNDAMENTAL_SYSTEM_PROMPT,
        personaFirstLine: 'You are a fundamental and valuation analyst.',
    },
    {
        name: 'FINANCIALS_SYSTEM_PROMPT',
        value: FINANCIALS_SYSTEM_PROMPT,
        personaFirstLine:
            'You are a financial-statement analyst specializing in multi-year trends.',
    },
    {
        name: 'CONGRESS_SYSTEM_PROMPT',
        value: CONGRESS_SYSTEM_PROMPT,
        personaFirstLine:
            'You are a financial analyst specializing in US congressional stock-trading disclosures.',
    },
    {
        name: 'OPTIONS_SYSTEM_PROMPT',
        value: OPTIONS_SYSTEM_PROMPT,
        personaFirstLine: 'You are an options strategist.',
    },
];

describe('analysis system prompts', () => {
    it.each(PROMPTS)('$name is a defined non-empty string', ({ value }) => {
        expect(value).not.toBeUndefined();
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
    });

    it.each(PROMPTS)(
        '$name starts with its distinct persona first line',
        ({ value, personaFirstLine }) => {
            expect(value.startsWith(personaFirstLine)).toBe(true);
        }
    );

    it.each(PROMPTS)(
        '$name contains the shared CORE PRINCIPLES base',
        ({ value }) => {
            expect(value).toContain('CORE PRINCIPLES');
            expect(value).toContain('Deterministic');
        }
    );

    it.each(PROMPTS)(
        '$name contains the shared JSON-only output contract',
        ({ value }) => {
            expect(value).toContain(
                'Respond with a SINGLE valid JSON object and nothing else.'
            );
            expect(value).toContain('Korean');
        }
    );

    /**
     * 2026-09-17 운영 크롤: 전 종목 차트·종합 산문이 "지금 사기에는 위치가 불리합니다",
     * "나눠서 사는 편이 낫습니다", "확인한 뒤에 움직이는 것이 합리적입니다"처럼 독자에게
     * 행동을 지시했다. siglens `/about`은 "매수·매도를 권유하지 않습니다"라고 밝히고 있어
     * 문구와 산출물이 어긋났다(YMYL 신뢰 문제). 규칙은 **모든** 분석 타입에 걸린다.
     */
    it.each(PROMPTS)(
        '$name forbids prescriptive advice and requires conditional framing',
        ({ value }) => {
            expect(value).toContain('Descriptive, not prescriptive');
            expect(value).toContain('NEVER tell the reader what to do');
            // 금지 예시가 실제 산출물에서 관측된 문형이어야 한다.
            expect(value).toContain('사는 편이 낫습니다');
            // 구조화 필드(enum)는 그대로 둔다 — 서술만 조건형으로 바꾼다.
            expect(value).toContain('entryRecommendation');
        }
    );

    it('each prompt places its persona before the shared base', () => {
        for (const { value } of PROMPTS) {
            const personaIndex = value.indexOf('You are');
            expect(personaIndex).toBeGreaterThanOrEqual(0);
            expect(personaIndex).toBeLessThan(value.indexOf('CORE PRINCIPLES'));
        }
    });
});
