import { describe, expect, it } from 'vitest';
import { normalizeInvestorFlowsAnalysisResponse } from '@/domain/analysis/normalizeInvestorFlows';

const FULL = {
    summaryKo: '기관 매수가 이어졌습니다.',
    axisInterpretations: [
        { axis: 'short', interpretationKo: '공매도 해석' },
        { axis: 'institutional', interpretationKo: '기관 해석' },
        { axis: 'largeHolders', interpretationKo: '대량보유 해석' },
        { axis: 'insider', interpretationKo: '내부자 해석' },
    ],
    keySignalsKo: ['신호 1', '신호 2'],
    risksKo: ['리스크'],
    dataNotesKo: ['13F는 분기 공시입니다.'],
};

describe('normalizeInvestorFlowsAnalysisResponse', () => {
    it('passes a well-formed object through', () => {
        const r = normalizeInvestorFlowsAnalysisResponse(FULL);
        expect(r.summaryKo).toBe(FULL.summaryKo);
        expect(r.keySignalsKo).toEqual(FULL.keySignalsKo);
        expect(r.risksKo).toEqual(FULL.risksKo);
        expect(r.dataNotesKo).toEqual(FULL.dataNotesKo);
    });

    it('returns axis interpretations in canonical axis order whatever order the model used', () => {
        const r = normalizeInvestorFlowsAnalysisResponse(FULL);
        expect(r.axisInterpretations.map(i => i.axis)).toEqual([
            'institutional',
            'insider',
            'largeHolders',
            'short',
        ]);
        expect(r.axisInterpretations[0].interpretationKo).toBe('기관 해석');
    });

    it('parses a markdown-fenced JSON string', () => {
        const r = normalizeInvestorFlowsAnalysisResponse(
            '```json\n{"summaryKo":"x","risksKo":["y"]}\n```'
        );
        expect(r.summaryKo).toBe('x');
        expect(r.risksKo).toEqual(['y']);
    });

    it('defaults missing fields to empty strings and arrays', () => {
        expect(normalizeInvestorFlowsAnalysisResponse({})).toEqual({
            summaryKo: '',
            axisInterpretations: [],
            keySignalsKo: [],
            risksKo: [],
            dataNotesKo: [],
        });
    });

    it('drops unknown axes, empty texts and non-object entries', () => {
        const r = normalizeInvestorFlowsAnalysisResponse({
            axisInterpretations: [
                { axis: 'options', interpretationKo: 'x' },
                { axis: 'insider', interpretationKo: '' },
                { axis: 'insider' },
                'insider',
                null,
                { axis: 'short', interpretationKo: '유효' },
            ],
        });
        expect(r.axisInterpretations).toEqual([
            { axis: 'short', interpretationKo: '유효' },
        ]);
    });

    it('keeps the first entry when an axis repeats', () => {
        const r = normalizeInvestorFlowsAnalysisResponse({
            axisInterpretations: [
                { axis: 'insider', interpretationKo: '첫째' },
                { axis: 'insider', interpretationKo: '둘째' },
            ],
        });
        expect(r.axisInterpretations).toEqual([
            { axis: 'insider', interpretationKo: '첫째' },
        ]);
    });

    it('drops non-string and empty items from string arrays', () => {
        const r = normalizeInvestorFlowsAnalysisResponse({
            keySignalsKo: ['a', 3, null, '', 'b'],
            risksKo: 'not an array',
        });
        expect(r.keySignalsKo).toEqual(['a', 'b']);
        expect(r.risksKo).toEqual([]);
    });

    it.each([null, undefined, 42, [], 'null'])(
        'tolerates a non-object payload (%j)',
        payload => {
            expect(
                normalizeInvestorFlowsAnalysisResponse(payload).summaryKo
            ).toBe('');
        }
    );

    it('throws SyntaxError on a string that is not JSON', () => {
        expect(() =>
            normalizeInvestorFlowsAnalysisResponse('not json at all')
        ).toThrow(SyntaxError);
    });
});
