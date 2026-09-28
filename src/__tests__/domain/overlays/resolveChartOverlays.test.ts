import { describe, expect, it } from 'vitest';
import type { AnalysisResponse, OverlayCandidate } from '@/domain/types';
import { resolveChartOverlays } from '@/domain/overlays/resolveChartOverlays';

const cand = (
    id: string,
    kind: OverlayCandidate['kind'],
    role = 'x'
): OverlayCandidate => ({
    id,
    kind,
    skill: 's',
    promptLine: 'p',
    segments: [
        {
            from: { time: 1, price: 10 },
            to: { time: 5, price: 12 },
            role,
            style: 'solid',
            pane: 'price',
        },
    ],
    levels: [],
    labels: [],
});
const CANDIDATES = [
    cand('pattern:double_bottom:1', 'pattern'),
    cand('tl:support:1:3', 'trendline', 'support'),
    cand('tl:resistance:2:4', 'trendline', 'resistance'),
    cand('ew:up:1:6', 'elliott'),
    cand('ew:up:2:5', 'elliott'),
    cand('fib:short:5', 'fibonacci'),
];
const analysis = (over: Partial<AnalysisResponse>): AnalysisResponse =>
    ({
        summary: '',
        trend: 'neutral',
        indicatorResults: [],
        riskLevel: 'low',
        keyLevels: { support: [], resistance: [] },
        priceTargets: { bullish: null, bearish: null },
        patternSummaries: [],
        strategyResults: [],
        candlePatterns: [],
        trendlines: [],
        ...over,
    }) as AnalysisResponse;

describe('resolveChartOverlays', () => {
    it('keeps only referenced candidates, tagging their source', () => {
        const r = resolveChartOverlays(
            CANDIDATES,
            analysis({
                patternSummaries: [
                    {
                        id: 'double_bottom_0',
                        patternName: 'double_bottom',
                        skillName: '이중바닥',
                        detected: true,
                        trend: 'bullish',
                        summary: '',
                        confidenceWeight: 1,
                        candidateId: 'pattern:double_bottom:1',
                    },
                ],
                strategyResults: [
                    {
                        id: 'ew_0',
                        strategyName: '엘리어트 파동',
                        trend: 'bullish',
                        summary: '',
                        confidenceWeight: 1,
                        candidateIds: ['ew:up:1:6', 'ew:up:2:5'],
                    },
                ],
            }),
            ['tl:support:1:3']
        );
        expect(
            r.chartOverlays.map(o => [o.id, o.sourceRef, o.variant])
        ).toEqual([
            ['pattern:double_bottom:1', 'double_bottom_0', 'primary'],
            ['ew:up:1:6', 'ew_0', 'primary'],
            ['ew:up:2:5', 'ew_0', 'alternate'],
            ['tl:support:1:3', 'trendlines', 'primary'],
        ]);
        expect(r.chartOverlays[0]).not.toHaveProperty('promptLine');
    });

    it('ignores detected:false patterns and drops invented ids', () => {
        const r = resolveChartOverlays(
            CANDIDATES,
            analysis({
                patternSummaries: [
                    {
                        id: 'p',
                        patternName: 'x',
                        skillName: 'x',
                        detected: false,
                        trend: 'neutral',
                        summary: '',
                        confidenceWeight: 1,
                        candidateId: 'pattern:double_bottom:1',
                    },
                ],
            }),
            ['tl:made:up']
        );
        expect(r.chartOverlays).toEqual([]);
        expect(r.unknownIds).toEqual(['tl:made:up']);
    });

    it('first reference wins; trendlines are derived from resolved trendline overlays (max 3)', () => {
        const r = resolveChartOverlays(CANDIDATES, analysis({}), [
            'tl:support:1:3',
            'tl:resistance:2:4',
            'tl:support:1:3',
        ]);
        expect(r.chartOverlays).toHaveLength(2);
        expect(r.trendlines).toEqual([
            {
                direction: 'ascending',
                start: { time: 1, price: 10 },
                end: { time: 5, price: 12 },
            },
            {
                direction: 'descending',
                start: { time: 1, price: 10 },
                end: { time: 5, price: 12 },
            },
        ]);
    });

    it('only the first two elliott ids of one strategy are used', () => {
        const r = resolveChartOverlays(
            [...CANDIDATES, cand('ew:down:3:4', 'elliott')],
            analysis({
                strategyResults: [
                    {
                        id: 'ew_0',
                        strategyName: 'e',
                        trend: 'neutral',
                        summary: '',
                        confidenceWeight: 1,
                        candidateIds: ['ew:up:1:6', 'ew:up:2:5', 'ew:down:3:4'],
                    },
                ],
            }),
            []
        );
        expect(r.chartOverlays.map(o => o.id)).toEqual([
            'ew:up:1:6',
            'ew:up:2:5',
        ]);
    });

    it('a known id in the wrong slot is treated like an unknown id: patternSummaries.candidateId must resolve to a pattern candidate', () => {
        const r = resolveChartOverlays(
            CANDIDATES,
            analysis({
                patternSummaries: [
                    {
                        id: 'p',
                        patternName: 'x',
                        skillName: 'x',
                        detected: true,
                        trend: 'bullish',
                        summary: '',
                        confidenceWeight: 1,
                        candidateId: 'ew:up:1:6',
                    },
                ],
            }),
            []
        );
        expect(r.chartOverlays).toEqual([]);
        expect(r.unknownIds).toEqual(['ew:up:1:6']);
    });

    it('a known id in the wrong slot is treated like an unknown id: trendlineIds must resolve to a trendline candidate', () => {
        const r = resolveChartOverlays(CANDIDATES, analysis({}), [
            'fib:short:5',
        ]);
        expect(r.chartOverlays).toEqual([]);
        expect(r.unknownIds).toEqual(['fib:short:5']);
    });

    it('a known id in the wrong slot is treated like an unknown id: strategyResults.candidateIds must resolve to divergence/fibonacci/elliott', () => {
        const r = resolveChartOverlays(
            CANDIDATES,
            analysis({
                strategyResults: [
                    {
                        id: 's',
                        strategyName: 'x',
                        trend: 'neutral',
                        summary: '',
                        confidenceWeight: 1,
                        candidateIds: ['pattern:double_bottom:1'],
                    },
                ],
            }),
            []
        );
        expect(r.chartOverlays).toEqual([]);
        expect(r.unknownIds).toEqual(['pattern:double_bottom:1']);
    });
});
