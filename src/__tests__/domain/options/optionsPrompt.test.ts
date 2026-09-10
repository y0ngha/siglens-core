import type { AnalysisLocale } from '@/domain/analysis/outputLocale';
import { describe, it, expect } from 'vitest';
import { buildOptionsAnalysisPrompt as buildOptionsAnalysisPromptRaw } from '@/domain/options/optionsPrompt';
import type { OptionsSnapshot } from '@/domain/options/types';

// `buildOptionsAnalysisPrompt` now returns `{ stable, dynamic }` (spec §3.4
// assembly split) — this file's call sites predate the split and assert
// against the single legacy combined string (`stable + '\n\n' + dynamic`,
// exactly the string dispatch still sends as the `prompt` fallback field).
const buildOptionsAnalysisPrompt = (
    ...args: Parameters<typeof buildOptionsAnalysisPromptRaw>
): string => {
    const { stable, dynamic } = buildOptionsAnalysisPromptRaw(...args);
    return `${stable}\n\n${dynamic}`;
};

describe('buildOptionsAnalysisPrompt', () => {
    const snapshot: OptionsSnapshot = {
        symbol: 'AAPL',
        underlyingPrice: 198,
        capturedAt: '2026-05-14T16:00:00Z',
        chains: [
            {
                expirationDate: '2026-05-22',
                daysToExpiration: 8,
                calls: [],
                puts: [],
            },
            {
                expirationDate: '2026-06-19',
                daysToExpiration: 36,
                calls: [],
                puts: [],
            },
        ],
    };

    const allExpirationsPrompt = buildOptionsAnalysisPrompt({
        expirationDate: 'all',
        companyName: 'Apple Inc.',
        snapshot,
    });

    it('filters to specific expiration when given', () => {
        const prompt = buildOptionsAnalysisPrompt({
            expirationDate: '2026-05-22',
            companyName: 'Apple Inc.',
            snapshot,
        });
        expect(prompt).toContain('2026-05-22');
        expect(prompt).not.toContain('2026-06-19');
    });

    it('uses all chains when expirationDate is "all"', () => {
        expect(allExpirationsPrompt).toContain('2026-05-22');
        expect(allExpirationsPrompt).toContain('2026-06-19');
    });

    it('includes company name and current price', () => {
        expect(allExpirationsPrompt).toContain('Apple Inc.');
        expect(allExpirationsPrompt).toContain('AAPL');
        expect(allExpirationsPrompt).toContain('$198');
    });

    it('includes interpretation guidance for topVolumeStrikes and topOiBidAskSummary', () => {
        expect(allExpirationsPrompt).toContain('topVolumeStrikes');
        expect(allExpirationsPrompt).toContain('topOiBidAskSummary');
    });

    it('uses English instructions without markdown JSON fences', () => {
        expect(allExpirationsPrompt).toContain(
            'You are an options market analyst'
        );
        expect(allExpirationsPrompt).toContain('Current price:');
        expect(allExpirationsPrompt).toContain('== Output Schema ==');
        expect(allExpirationsPrompt).toContain('== Interpretation Guide ==');
        expect(allExpirationsPrompt).toContain(
            'Respond with valid JSON only. No markdown fences.'
        );
        expect(allExpirationsPrompt).not.toContain('```json');
    });

    it('keeps the output schema field names', () => {
        expect(allExpirationsPrompt).toContain('"summary"');
        expect(allExpirationsPrompt).toContain('"perExpiration"');
        expect(allExpirationsPrompt).toContain('"signals"');
        expect(allExpirationsPrompt).toContain('"expirationDate"');
        expect(allExpirationsPrompt).toContain('"commentary"');
        expect(allExpirationsPrompt).toContain('"tone"');
        expect(allExpirationsPrompt).toContain('"kind"');
        expect(allExpirationsPrompt).toContain('"message"');
    });

    it('keeps the Korean output directives and tone/kind enums', () => {
        expect(allExpirationsPrompt).toContain(
            'bullish | bearish | neutral | cautious'
        );
        expect(allExpirationsPrompt).toContain(
            'bullish | bearish | neutral | volatility'
        );
        // Model output must remain Korean.
        expect(allExpirationsPrompt).toContain(
            '전체 옵션 시장에 대한 한 문단 요약'
        );
    });

    describe('buildOptionsAnalysisPrompt — 출력 로케일', () => {
        const build = (locale?: AnalysisLocale) =>
            buildOptionsAnalysisPrompt({
                expirationDate: 'all',
                companyName: 'Apple Inc.',
                snapshot,
                ...(locale === undefined ? {} : { locale }),
            });

        it('로케일을 생략하면 ko와 바이트가 같다', () => {
            expect(build()).toBe(build('ko'));
        });

        /**
         * 역할 문장과 톤 지시가 프롬프트 본문에 "한국어로 쓰라"고 박혀 있었다 —
         * 말미 리마인더로는 뒤집힌다고 볼 수 없는 과업 수준 지시다(리뷰 4라운드).
         */
        it.each(['en', 'ja', 'zh'] as const)(
            '%s: 한국어로 쓰라는 지시가 남지 않는다',
            locale => {
                const prompt = build(locale);
                expect(prompt).not.toContain('write your analysis in Korean');
                expect(prompt).not.toContain('accurate Korean tone');
                // 스키마 예시의 `(한국어)` 표기도 남으면 안 된다(리뷰 7라운드).
                expect(prompt).not.toContain('한국어');
            }
        );

        it('en: 영어로 쓰라고 지시한다', () => {
            expect(build('en')).toContain('write your analysis in English');
        });
    });
});

describe('buildOptionsAnalysisPrompt numeric rounding', () => {
    const contract = (strike: number, impliedVolatility: number) => ({
        contractSymbol: `AAPL${strike}`,
        strike,
        lastPrice: 1.23456,
        bid: 1.2,
        ask: 1.26789,
        volume: 10,
        openInterest: 100,
        impliedVolatility,
        inTheMoney: false,
    });
    const snapshot: OptionsSnapshot = {
        symbol: 'AAPL',
        underlyingPrice: 198.123456,
        capturedAt: '2026-05-14T16:00:00Z',
        chains: [
            {
                expirationDate: '2026-05-22',
                daysToExpiration: 8,
                calls: [contract(197.5, 0.283456789)],
                puts: [contract(197.5, 0.291234567)],
            },
        ],
    };
    const prompt = buildOptionsAnalysisPrompt({
        expirationDate: 'all',
        companyName: 'Apple Inc.',
        snapshot,
    });

    it('rounds the underlying price to cents', () => {
        expect(prompt).toContain('Current price: $198.12');
    });

    it('rounds fractional metrics to four decimals and leaves integers alone', () => {
        expect(prompt).not.toMatch(/\d\.\d{5,}/);
        expect(prompt).toContain('"atmImpliedVolatility": 0.2835');
        expect(prompt).toContain('"strike": 197.5');
        expect(prompt).toContain('"putCallRatio": 1,');
    });
});
