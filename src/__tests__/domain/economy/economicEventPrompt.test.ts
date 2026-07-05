import { describe, it, expect } from 'vitest';
import { buildEconomicEventAnalysisPrompt as buildEconomicEventAnalysisPromptRaw } from '@/domain/economy/economicEventPrompt';
import type { EconomicEventAnalysisInput } from '@/domain/economy/types';

// `buildEconomicEventAnalysisPrompt` now returns `{ stable, dynamic }` (spec
// §3.4 assembly split) — this file's call sites predate the split and assert
// against the single legacy combined string (`stable + '\n\n' + dynamic`,
// exactly the string dispatch still sends as the `prompt` fallback field).
const buildEconomicEventAnalysisPrompt = (
    ...args: Parameters<typeof buildEconomicEventAnalysisPromptRaw>
): string => {
    const { stable, dynamic } = buildEconomicEventAnalysisPromptRaw(...args);
    return `${stable}\n\n${dynamic}`;
};

const BASE_INPUT: EconomicEventAnalysisInput = {
    event: 'CPI MoM',
    impact: 'High',
    actual: 0.2,
    estimate: 0.3,
    previous: 0.4,
    unit: '%',
};

describe('buildEconomicEventAnalysisPrompt', () => {
    it('이벤트 이름을 프롬프트에 포함', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('CPI MoM');
    });

    it('actual/estimate/previous 수치를 포함', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('0.20');
        expect(p).toContain('0.30');
        expect(p).toContain('0.40');
    });

    it('unit을 포함', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('%');
    });

    it('impact 수준을 포함', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('High');
    });

    it('## Data Boundary 섹션 포함', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('## Data Boundary');
    });

    it('## Output Schema 섹션 포함', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('## Output Schema');
    });

    it('sentiment 허용값 포함(bullish/neutral/bearish)', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('"bullish"');
        expect(p).toContain('"neutral"');
        expect(p).toContain('"bearish"');
    });

    it('summaryKo / interpretationKo 스키마 필드 포함', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('"summaryKo"');
        expect(p).toContain('"interpretationKo"');
    });

    it('## Allowed Values 섹션 포함', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('## Allowed Values');
    });

    it('actual=null 이면 N/A로 표기', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            actual: null,
        });
        expect(p).toContain('Actual: N/A');
    });

    it('estimate=null 이면 N/A로 표기', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            estimate: null,
        });
        expect(p).toContain('Estimate: N/A');
    });

    it('previous=null 이면 N/A로 표기', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            previous: null,
        });
        expect(p).toContain('Previous: N/A');
    });

    it('unit 빈 문자열이어도 throw 없이 문자열 반환', () => {
        const p = buildEconomicEventAnalysisPrompt({ ...BASE_INPUT, unit: '' });
        expect(typeof p).toBe('string');
        expect(p.length).toBeGreaterThan(0);
    });

    it('모든 값이 null이어도 throw 없이 문자열 반환', () => {
        const p = buildEconomicEventAnalysisPrompt({
            event: 'Fed Rate Decision',
            impact: 'High',
            actual: null,
            estimate: null,
            previous: null,
            unit: '%',
        });
        expect(typeof p).toBe('string');
        expect(p).toContain('Fed Rate Decision');
    });

    it('Low impact 이벤트도 포함', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            impact: 'Low',
        });
        expect(p).toContain('Low');
    });

    it('JSON only 지시 포함', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('valid JSON only');
    });
});
