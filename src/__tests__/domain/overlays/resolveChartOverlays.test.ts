import { describe, expect, it } from 'vitest';
import type {
    AnalysisResponse,
    OverlayCandidate,
    PatternSummary,
    Skill,
} from '@/domain/types';
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

    describe('per-strategy overlay kind', () => {
        const SKILLS = [
            { name: '엘리어트 파동', type: 'strategy', overlayKind: 'elliott' },
            {
                name: '피보나치 전략',
                type: 'strategy',
                overlayKind: 'fibonacci',
            },
            {
                name: '다이버전스 전략',
                type: 'strategy',
                overlayKind: 'divergence',
            },
            { name: '브레이크아웃 전략', type: 'strategy' },
            { name: '상승쐐기', type: 'pattern', pattern: 'ascending_wedge' },
        ] as Skill[];
        const MIXED = [
            ...CANDIDATES,
            cand('div:rsi:1', 'divergence'),
            cand('ew:up:3:4', 'elliott'),
        ];
        const strategy = (strategyName: string, candidateIds: string[]) =>
            analysis({
                strategyResults: [
                    {
                        id: `${strategyName}_0`,
                        strategyName,
                        trend: 'neutral',
                        summary: '',
                        confidenceWeight: 1,
                        candidateIds,
                    },
                ],
            });
        const ALL = ['fib:short:5', 'div:rsi:1', 'ew:up:1:6'];

        it.each([
            ['엘리어트 파동', 'ew:up:1:6'],
            ['피보나치 전략', 'fib:short:5'],
            ['다이버전스 전략', 'div:rsi:1'],
        ])('%s draws only its declared kind', (name, kept) => {
            const r = resolveChartOverlays(
                MIXED,
                strategy(name, ALL),
                [],
                SKILLS
            );
            expect(r.chartOverlays.map(o => o.id)).toEqual([kept]);
            expect(r.unknownIds).toEqual(ALL.filter(id => id !== kept));
        });

        it('keeps the Elliott primary/alternate split and its cap of two', () => {
            const r = resolveChartOverlays(
                MIXED,
                strategy('엘리어트 파동', [
                    'fib:short:5',
                    'ew:up:1:6',
                    'ew:up:2:5',
                    'ew:up:3:4',
                ]),
                [],
                SKILLS
            );
            expect(r.chartOverlays.map(o => [o.id, o.variant])).toEqual([
                ['ew:up:1:6', 'primary'],
                ['ew:up:2:5', 'alternate'],
            ]);
            expect(r.unknownIds).toEqual(['fib:short:5']);
        });

        it.each([
            ['a known strategy without overlayKind', '브레이크아웃 전략'],
            ['a name matching no skill', 'Elliott Wave'],
            ['a non-strategy skill name', '상승쐐기'],
        ])('draws nothing for %s', (_, name) => {
            const r = resolveChartOverlays(
                MIXED,
                strategy(name, ['fib:short:5']),
                [],
                SKILLS
            );
            expect(r.chartOverlays).toEqual([]);
            expect(r.unknownIds).toEqual(['fib:short:5']);
        });

        it('keeps every strategy kind when no strategy skills are passed', () => {
            const r = resolveChartOverlays(
                MIXED,
                strategy('엘리어트 파동', ALL),
                []
            );
            expect(r.chartOverlays.map(o => o.id)).toEqual(ALL);
            expect(r.unknownIds).toEqual([]);
        });

        it('a card rejected for the wrong kind does not use up the id for the right card', () => {
            const r = resolveChartOverlays(
                MIXED,
                analysis({
                    strategyResults: [
                        {
                            id: '브레이크아웃 전략_0',
                            strategyName: '브레이크아웃 전략',
                            trend: 'neutral',
                            summary: '',
                            confidenceWeight: 1,
                            candidateIds: ['fib:short:5'],
                        },
                        {
                            id: '피보나치 전략_0',
                            strategyName: '피보나치 전략',
                            trend: 'neutral',
                            summary: '',
                            confidenceWeight: 1,
                            candidateIds: ['fib:short:5'],
                        },
                    ],
                }),
                [],
                SKILLS
            );
            expect(r.chartOverlays.map(o => [o.id, o.sourceRef])).toEqual([
                ['fib:short:5', '피보나치 전략_0'],
            ]);
        });
    });

    describe('when a detected pattern has no candidateId', () => {
        const wedge = (id: string): OverlayCandidate => ({
            ...cand(id, 'pattern'),
            skill: 'ascending-wedge',
        });
        // The pattern-less skill must be skipped by the name → pattern map.
        const SKILLS = [
            { name: 'RSI', pattern: undefined },
            { name: '상승쐐기', pattern: 'ascending_wedge' },
        ] as Skill[];
        const summary = (over: Partial<PatternSummary>): PatternSummary => ({
            id: 'ascending_wedge_0',
            patternName: 'ascending_wedge',
            skillName: '상승쐐기',
            detected: true,
            trend: 'bearish',
            summary: '',
            confidenceWeight: 1,
            ...over,
        });

        it('falls back to the only screener candidate of the same skill', () => {
            const r = resolveChartOverlays(
                [wedge('pattern:ascending_wedge:9'), ...CANDIDATES],
                analysis({ patternSummaries: [summary({})] }),
                [],
                SKILLS
            );
            expect(r.chartOverlays.map(o => [o.id, o.sourceRef])).toEqual([
                ['pattern:ascending_wedge:9', 'ascending_wedge_0'],
            ]);
            expect(r.unknownIds).toEqual([]);
        });

        it('falls back through patternName when skillName matches no skill', () => {
            const r = resolveChartOverlays(
                [wedge('pattern:ascending_wedge:9')],
                analysis({
                    patternSummaries: [summary({ skillName: 'Rising Wedge' })],
                }),
                [],
                SKILLS
            );
            expect(r.chartOverlays.map(o => o.id)).toEqual([
                'pattern:ascending_wedge:9',
            ]);
        });

        it('ignores a skill without a pattern', () => {
            const r = resolveChartOverlays(
                [wedge('pattern:ascending_wedge:9')],
                analysis({
                    patternSummaries: [
                        summary({ skillName: 'RSI', patternName: 'RSI' }),
                    ],
                }),
                [],
                SKILLS
            );
            expect(r.chartOverlays).toEqual([]);
        });

        it('draws nothing when two candidates of that skill make the choice ambiguous', () => {
            const r = resolveChartOverlays(
                [
                    wedge('pattern:ascending_wedge:9'),
                    wedge('pattern:ascending_wedge:12'),
                ],
                analysis({ patternSummaries: [summary({})] }),
                [],
                SKILLS
            );
            expect(r.chartOverlays).toEqual([]);
        });

        it('draws nothing for a detected:false pattern or an unknown skill', () => {
            const r = resolveChartOverlays(
                [wedge('pattern:ascending_wedge:9')],
                analysis({
                    patternSummaries: [
                        summary({ detected: false }),
                        summary({
                            id: 'diamond_0',
                            patternName: 'diamond',
                            skillName: 'Diamond',
                        }),
                    ],
                }),
                [],
                SKILLS
            );
            expect(r.chartOverlays).toEqual([]);
        });

        it('drops an explicit candidateId of a different pattern than the card', () => {
            const r = resolveChartOverlays(
                [wedge('pattern:ascending_wedge:9'), ...CANDIDATES],
                analysis({
                    patternSummaries: [
                        summary({ candidateId: 'pattern:double_bottom:1' }),
                    ],
                }),
                [],
                SKILLS
            );
            expect(r.chartOverlays).toEqual([]);
            expect(r.unknownIds).toEqual(['pattern:double_bottom:1']);
        });

        it('keeps an explicit candidateId of the same pattern as the card', () => {
            const r = resolveChartOverlays(
                [wedge('pattern:ascending_wedge:9'), ...CANDIDATES],
                analysis({
                    patternSummaries: [
                        summary({ candidateId: 'pattern:ascending_wedge:9' }),
                    ],
                }),
                [],
                SKILLS
            );
            expect(r.chartOverlays.map(o => o.id)).toEqual([
                'pattern:ascending_wedge:9',
            ]);
        });

        it('skips the identity check for a card whose skill is unknown', () => {
            const r = resolveChartOverlays(
                CANDIDATES,
                analysis({
                    patternSummaries: [
                        summary({
                            skillName: '모름',
                            patternName: '모름',
                            candidateId: 'pattern:double_bottom:1',
                        }),
                    ],
                }),
                [],
                SKILLS
            );
            expect(r.chartOverlays.map(o => o.id)).toEqual([
                'pattern:double_bottom:1',
            ]);
        });

        it('keeps the fallback off when no skills are passed', () => {
            const r = resolveChartOverlays(
                [wedge('pattern:ascending_wedge:9')],
                analysis({ patternSummaries: [summary({})] }),
                []
            );
            expect(r.chartOverlays).toEqual([]);
        });
    });
});
