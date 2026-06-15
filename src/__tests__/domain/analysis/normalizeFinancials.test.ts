import { describe, it, expect } from 'vitest';
import { normalizeFinancialsAnalysisResponse } from '@/domain/analysis/normalizeFinancials';

describe('normalizeFinancialsAnalysisResponse', () => {
    it('parses a valid object payload', () => {
        const r = normalizeFinancialsAnalysisResponse({
            overallConclusionKo: '현금흐름 견조',
            axisAssessments: [
                {
                    axis: 'growth',
                    sentiment: 'bullish',
                    rationaleKo: '매출 가속',
                },
            ],
            riskFactorsKo: ['부채 증가'],
            overallSentiment: 'bullish',
        });
        expect(r.overallConclusionKo).toBe('현금흐름 견조');
        expect(r.axisAssessments).toEqual([
            { axis: 'growth', sentiment: 'bullish', rationaleKo: '매출 가속' },
        ]);
        expect(r.overallSentiment).toBe('bullish');
    });
    it('strips ```json fences before parsing', () => {
        const r = normalizeFinancialsAnalysisResponse(
            '```json\n{"overallConclusionKo":"x","overallSentiment":"neutral"}\n```'
        );
        expect(r.overallConclusionKo).toBe('x');
    });
    it('defaults missing fields', () => {
        const r = normalizeFinancialsAnalysisResponse({});
        expect(r).toEqual({
            overallConclusionKo: '',
            axisAssessments: [],
            riskFactorsKo: [],
            overallSentiment: 'neutral',
        });
    });
    it('drops malformed axis entries and falls back invalid enums', () => {
        const r = normalizeFinancialsAnalysisResponse({
            axisAssessments: [
                null,
                'x',
                { axis: 'WRONG', sentiment: 'WRONG', rationaleKo: 5 },
            ],
        });
        expect(r.axisAssessments).toEqual([
            { axis: 'growth', sentiment: 'neutral', rationaleKo: '' },
        ]);
    });
    it('filters empty strings from riskFactorsKo but preserves whitespace', () => {
        const r = normalizeFinancialsAnalysisResponse({
            riskFactorsKo: ['a', '', '  '],
        });
        expect(r.riskFactorsKo).toEqual(['a', '  ']);
    });
    it('throws SyntaxError on invalid JSON string', () => {
        expect(() => normalizeFinancialsAnalysisResponse('{not json')).toThrow(
            SyntaxError
        );
    });
    it('defaults all fields for non-object input', () => {
        expect(normalizeFinancialsAnalysisResponse(42).overallSentiment).toBe(
            'neutral'
        );
    });
});
