import { describe, expect, it } from 'vitest';
import type {
    AnalysisResponse,
    OverlayCandidate,
    PatternSummary,
    PatternTargetGeometry,
    Skill,
} from '@/domain/types';
import { enrichAnalysisWithConfidence } from '@/domain/analysis/confidence';
import { postProcessAnalysisWithReconcile } from '@/domain/analysis/ai-levels';
import { STRATEGY_KIND_SOURCE_REF } from '@/domain/overlays/constants';
import {
    alignPatternGeometry,
    resolveChartOverlays,
} from '@/domain/overlays/resolveChartOverlays';

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

    it('caps trendlines after validation: invented, wrong-kind and duplicate ids do not push real ones out', () => {
        const r = resolveChartOverlays(
            [
                ...CANDIDATES,
                cand('tl:support:3:5', 'trendline', 'support'),
                cand('tl:support:4:6', 'trendline', 'support'),
            ],
            analysis({}),
            [
                'tl:made:up',
                'fib:short:5',
                'tl:support:1:3',
                'tl:support:1:3',
                'tl:resistance:2:4',
                'tl:support:3:5',
                'tl:support:4:6',
            ]
        );
        expect(r.chartOverlays.map(o => o.id)).toEqual([
            'tl:support:1:3',
            'tl:resistance:2:4',
            'tl:support:3:5',
        ]);
        expect(r.unknownIds).toEqual(['tl:made:up']);
        expect(r.misplacedIds).toEqual([
            { id: 'fib:short:5', sourceRef: 'trendlines' },
        ]);
    });

    it('assigns the elliott primary/alternate split over resolved ids only: a count already claimed by an earlier card does not take the primary slot', () => {
        const ew = (id: string, candidateIds: string[]) => ({
            id,
            strategyName: 'e',
            trend: 'neutral' as const,
            summary: '',
            confidenceWeight: 1,
            candidateIds,
        });
        const r = resolveChartOverlays(
            [...CANDIDATES, cand('ew:down:3:4', 'elliott')],
            analysis({
                strategyResults: [
                    ew('e_0', ['ew:up:1:6']),
                    ew('e_1', ['ew:up:1:6', 'ew:up:2:5', 'ew:down:3:4']),
                ],
            }),
            []
        );
        expect(
            r.chartOverlays.map(o => [o.id, o.sourceRef, o.variant])
        ).toEqual([
            ['ew:up:1:6', 'e_0', 'primary'],
            ['ew:up:2:5', 'e_1', 'primary'],
            ['ew:down:3:4', 'e_1', 'alternate'],
        ]);
    });

    it('a known id in the wrong slot is rejected as misplaced, not unknown: patternSummaries.candidateId must resolve to a pattern candidate', () => {
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
        expect(r.unknownIds).toEqual([]);
        expect(r.misplacedIds).toEqual([{ id: 'ew:up:1:6', sourceRef: 'p' }]);
    });

    it('a known id in the wrong slot is rejected as misplaced, not unknown: trendlineIds must resolve to a trendline candidate', () => {
        const r = resolveChartOverlays(CANDIDATES, analysis({}), [
            'fib:short:5',
        ]);
        expect(r.chartOverlays).toEqual([]);
        expect(r.unknownIds).toEqual([]);
        expect(r.misplacedIds).toEqual([
            { id: 'fib:short:5', sourceRef: 'trendlines' },
        ]);
    });

    it('a known id in the wrong slot is rejected as misplaced, not unknown: strategyResults.candidateIds must resolve to divergence/fibonacci/elliott', () => {
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
        expect(r.unknownIds).toEqual([]);
        expect(r.misplacedIds).toEqual([
            { id: 'pattern:double_bottom:1', sourceRef: 's' },
        ]);
    });

    it('a never-offered id stays unknown, and a misplaced one never reaches unknownIds', () => {
        const r = resolveChartOverlays(CANDIDATES, analysis({}), [
            'tl:made:up',
            'fib:short:5',
        ]);
        expect(r.unknownIds).toEqual(['tl:made:up']);
        expect(r.misplacedIds.map(m => m.id)).toEqual(['fib:short:5']);
    });

    it('a strategy card citing trendline ids that are also drawn from trendlineIds: drawn once, misplaced not unknown, output unchanged', () => {
        const withCitation = resolveChartOverlays(
            CANDIDATES,
            analysis({
                strategyResults: [
                    {
                        id: 'mtf_0',
                        strategyName: 'multi-timeframe',
                        trend: 'neutral',
                        summary: '',
                        confidenceWeight: 1,
                        candidateIds: ['tl:support:1:3', 'tl:resistance:2:4'],
                    },
                ],
            }),
            ['tl:support:1:3', 'tl:resistance:2:4']
        );
        const without = resolveChartOverlays(CANDIDATES, analysis({}), [
            'tl:support:1:3',
            'tl:resistance:2:4',
        ]);
        expect(withCitation.chartOverlays).toEqual(without.chartOverlays);
        expect(withCitation.trendlines).toEqual(without.trendlines);
        expect(withCitation.chartOverlays).toHaveLength(2);
        expect(withCitation.unknownIds).toEqual([]);
        expect(withCitation.misplacedIds).toEqual([
            { id: 'tl:support:1:3', sourceRef: 'mtf_0' },
            { id: 'tl:resistance:2:4', sourceRef: 'mtf_0' },
        ]);
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
        ])(
            '%s draws its declared kind under its own card and the other kinds under their kind',
            (name, kept) => {
                const kindOf = (id: string) =>
                    id.startsWith('fib')
                        ? 'fibonacci'
                        : id.startsWith('div')
                          ? 'divergence'
                          : 'elliott';
                const r = resolveChartOverlays(
                    MIXED,
                    strategy(name, ALL),
                    [],
                    SKILLS
                );
                expect(r.chartOverlays.map(o => [o.id, o.sourceRef])).toEqual([
                    [kept, `${name}_0`],
                    ...ALL.filter(id => id !== kept).map(id => [
                        id,
                        STRATEGY_KIND_SOURCE_REF[kindOf(id)],
                    ]),
                ]);
                expect(r.unknownIds).toEqual([]);
            }
        );

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
            expect(
                r.chartOverlays.map(o => [o.id, o.sourceRef, o.variant])
            ).toEqual([
                ['ew:up:1:6', '엘리어트 파동_0', 'primary'],
                ['ew:up:2:5', '엘리어트 파동_0', 'alternate'],
                ['fib:short:5', STRATEGY_KIND_SOURCE_REF.fibonacci, 'primary'],
            ]);
            expect(r.unknownIds).toEqual([]);
        });

        it.each([
            ['a known strategy without overlayKind', '브레이크아웃 전략'],
            ['a name matching no skill', 'Elliott Wave'],
            ['a non-strategy skill name', '상승쐐기'],
        ])(
            'draws a Fibonacci leg cited by %s under its kind, not under that card',
            (_, name) => {
                const r = resolveChartOverlays(
                    MIXED,
                    strategy(name, ['fib:short:5']),
                    [],
                    SKILLS
                );
                expect(r.chartOverlays.map(o => [o.id, o.sourceRef])).toEqual([
                    ['fib:short:5', STRATEGY_KIND_SOURCE_REF.fibonacci],
                ]);
                expect(r.unknownIds).toEqual([]);
            }
        );

        it('draws for a model-written strategy name once enrichment canonicalises it, and moves cross-kind ids to the card of their kind', () => {
            const strategyResults = [
                ['Elliott Wave', ['ew:up:1:6']],
                ['피보나치 되돌림', ['fib:short:5']],
                ['MACD 대순환 분석', ['ew:up:2:5']],
                ['엘리어트 파동', ['fib:short:5']],
            ].map(([strategyName, candidateIds]) => ({
                strategyName,
                trend: 'neutral',
                summary: '',
                candidateIds,
            }));
            const skills = [
                ...SKILLS,
                { name: 'MACD 대순환 분석', type: 'strategy' },
            ].map(s => ({ ...s, confidenceWeight: 1 })) as Skill[];
            const r = resolveChartOverlays(
                MIXED,
                enrichAnalysisWithConfidence({ strategyResults }, skills),
                [],
                skills
            );
            // MACD's Elliott count moves to the Elliott card (its alternate:
            // the Elliott card's own count keeps the primary); the Elliott
            // card's Fibonacci leg is already drawn by the Fibonacci card.
            expect(
                r.chartOverlays.map(o => [o.id, o.sourceRef, o.variant])
            ).toEqual([
                ['ew:up:1:6', '엘리어트 파동_0', 'primary'],
                ['fib:short:5', '피보나치 전략_0', 'primary'],
                ['ew:up:2:5', '엘리어트 파동_0', 'alternate'],
            ]);
            expect(r.unknownIds).toEqual([]);
        });

        describe('cross-kind ids move to the card of their own kind', () => {
            const cards = (...entries: [string, string[]][]) =>
                analysis({
                    strategyResults: entries.map(
                        ([strategyName, candidateIds]) => ({
                            id: `${strategyName}_0`,
                            strategyName,
                            trend: 'neutral',
                            summary: '',
                            confidenceWeight: 1,
                            candidateIds,
                        })
                    ),
                });
            const drawn = (a: ReturnType<typeof cards>) => {
                const r = resolveChartOverlays(MIXED, a, [], SKILLS);
                return {
                    overlays: r.chartOverlays.map(o => [
                        o.id,
                        o.sourceRef,
                        o.variant,
                    ]),
                    unknownIds: r.unknownIds,
                };
            };

            // Production (HOOD, 2026-10-01): the Fibonacci card cited [] and
            // only the Elliott card cited the leg — dropping it lost the ladder.
            it('draws a Fibonacci leg the Elliott card cited under an empty Fibonacci card', () => {
                expect(
                    drawn(
                        cards(
                            ['엘리어트 파동', ['fib:short:5']],
                            ['피보나치 전략', []]
                        )
                    )
                ).toEqual({
                    overlays: [['fib:short:5', '피보나치 전략_0', 'primary']],
                    unknownIds: [],
                });
            });

            it('moves a divergence to the divergence card, from a card with no overlay kind', () => {
                expect(
                    drawn(
                        cards(
                            ['브레이크아웃 전략', ['div:rsi:1']],
                            ['다이버전스 전략', []]
                        )
                    )
                ).toEqual({
                    overlays: [['div:rsi:1', '다이버전스 전략_0', 'primary']],
                    unknownIds: [],
                });
            });

            it("keeps the home card's own count as the Elliott primary even when another card is listed first", () => {
                expect(
                    drawn(
                        cards(
                            ['브레이크아웃 전략', ['ew:up:2:5']],
                            ['엘리어트 파동', ['ew:up:1:6']]
                        )
                    ).overlays
                ).toEqual([
                    ['ew:up:1:6', '엘리어트 파동_0', 'primary'],
                    ['ew:up:2:5', '엘리어트 파동_0', 'alternate'],
                ]);
            });

            it('draws the id under its kind when the analysis has no card of that kind', () => {
                expect(
                    drawn(cards(['엘리어트 파동', ['fib:short:5']]))
                ).toEqual({
                    overlays: [
                        [
                            'fib:short:5',
                            STRATEGY_KIND_SOURCE_REF.fibonacci,
                            'primary',
                        ],
                    ],
                    unknownIds: [],
                });
            });

            it("splits orphan Elliott counts under 'kind:elliott' into primary/alternate and caps them at two", () => {
                expect(
                    drawn(
                        cards(
                            ['브레이크아웃 전략', ['ew:up:1:6', 'ew:up:2:5']],
                            ['피보나치 전략', ['ew:up:3:4']]
                        )
                    )
                ).toEqual({
                    overlays: [
                        [
                            'ew:up:1:6',
                            STRATEGY_KIND_SOURCE_REF.elliott,
                            'primary',
                        ],
                        [
                            'ew:up:2:5',
                            STRATEGY_KIND_SOURCE_REF.elliott,
                            'alternate',
                        ],
                    ],
                    // The third count is over the cap — skipped, not unknown.
                    unknownIds: [],
                });
            });

            it('draws a cross-kind id a card cites twice once', () => {
                expect(
                    drawn(
                        cards(['엘리어트 파동', ['fib:short:5', 'fib:short:5']])
                    )
                ).toEqual({
                    overlays: [
                        [
                            'fib:short:5',
                            STRATEGY_KIND_SOURCE_REF.fibonacci,
                            'primary',
                        ],
                    ],
                    unknownIds: [],
                });
            });

            it('draws one kind item for a leg several cards cite without a card of its kind', () => {
                expect(
                    drawn(
                        cards(
                            ['엘리어트 파동', ['fib:short:5']],
                            ['브레이크아웃 전략', ['fib:short:5']]
                        )
                    ).overlays
                ).toEqual([
                    [
                        'fib:short:5',
                        STRATEGY_KIND_SOURCE_REF.fibonacci,
                        'primary',
                    ],
                ]);
            });

            it('does not move pattern or trendline ids cited by a strategy — they are misplaced, not unknown', () => {
                const r = resolveChartOverlays(
                    MIXED,
                    cards(
                        [
                            '엘리어트 파동',
                            ['pattern:double_bottom:1', 'tl:support:1:3'],
                        ],
                        ['피보나치 전략', []]
                    ),
                    [],
                    SKILLS
                );
                expect(r.chartOverlays).toEqual([]);
                expect(r.unknownIds).toEqual([]);
                expect(r.misplacedIds.map(m => m.id)).toEqual([
                    'pattern:double_bottom:1',
                    'tl:support:1:3',
                ]);
            });
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
            expect(r.unknownIds).toEqual([]);
            expect(r.misplacedIds.map(m => m.id)).toEqual([
                'pattern:double_bottom:1',
            ]);
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

    describe('alignPatternGeometry', () => {
        const SKILLS = [
            {
                name: '이중천장',
                pattern: 'double_top',
                category: 'reversal_bearish',
            },
            {
                name: '이중바닥',
                pattern: 'double_bottom',
                category: 'reversal_bullish',
            },
            {
                name: '대칭삼각형',
                pattern: 'symmetrical_triangle',
                category: 'neutral',
            },
        ] as Skill[];
        const PRINTED: PatternTargetGeometry = {
            breakoutLevel: 105,
            extremeLevel: 100,
            direction: 'up',
            invalidationLevel: 99.5,
        };
        const GEOMETRIES = new Map([['pattern:double_bottom:1', PRINTED]]);
        const card = (over: Partial<PatternSummary>): PatternSummary => ({
            id: 'double_bottom_0',
            patternName: 'double_bottom',
            skillName: '이중바닥',
            detected: true,
            trend: 'bullish',
            summary: '',
            confidenceWeight: 1,
            ...over,
        });
        const align = (
            patternSummaries: PatternSummary[],
            geometries: ReadonlyMap<
                string,
                PatternTargetGeometry | null
            > = GEOMETRIES
        ) => {
            const a = analysis({ patternSummaries });
            const { chartOverlays } = resolveChartOverlays(
                [
                    {
                        ...cand('pattern:double_bottom:1', 'pattern'),
                        skill: 'double-bottom',
                    },
                ],
                a,
                [],
                SKILLS
            );
            return alignPatternGeometry(a, chartOverlays, geometries)
                .patternSummaries;
        };

        it('replaces the model geometry of a resolved card with the printed geometry of the candidate it draws', () => {
            const [p] = align([
                card({
                    candidateId: 'pattern:double_bottom:1',
                    geometry: {
                        breakoutLevel: 95,
                        extremeLevel: 100,
                        direction: 'down',
                    },
                }),
            ]);
            expect(p?.geometry).toEqual(PRINTED);
        });

        it('keeps the model geometry of a resolved card whose candidate has no printed geometry', () => {
            const model: PatternTargetGeometry = {
                breakoutLevel: 105,
                extremeLevel: 98,
                direction: 'up',
            };
            const [p] = align(
                [
                    card({
                        candidateId: 'pattern:double_bottom:1',
                        geometry: model,
                    }),
                ],
                new Map()
            );
            expect(p?.geometry).toEqual(model);
        });

        it('gives a resolved card without geometry the printed geometry', () => {
            const [p] = align([
                card({ candidateId: 'pattern:double_bottom:1' }),
            ]);
            expect(p?.geometry).toEqual(PRINTED);
        });

        it('only the card that drew the candidate gets its geometry: a later card citing the same id draws nothing and keeps none', () => {
            const [first, second] = align([
                card({ candidateId: 'pattern:double_bottom:1' }),
                card({
                    id: 'double_bottom_1',
                    candidateId: 'pattern:double_bottom:1',
                    geometry: {
                        breakoutLevel: 110,
                        extremeLevel: 101,
                        direction: 'up',
                    },
                }),
            ]);
            expect(first?.geometry).toEqual(PRINTED);
            expect(second).not.toHaveProperty('geometry');
        });

        it('leaves an unresolved card without geometry as it is', () => {
            const unresolved = card({
                id: 'double_top_0',
                patternName: 'double_top',
                skillName: '이중천장',
            });
            expect(align([unresolved])).toEqual([unresolved]);
        });

        describe('a card that resolved to no pattern overlay (nothing drawn)', () => {
            // A model-read channel with its own geometry and the target
            // keyPrices it copied — IONQ 1Hour, where the app showed two
            // targets for a card with nothing on the chart.
            const shapeOnly = card({
                id: 'descending_channel_0',
                patternName: 'descending_channel',
                skillName: '하락 채널',
                trend: 'bearish',
                summary: '채널 하단 41.27',
                geometry: {
                    breakoutLevel: 41.27,
                    extremeLevel: 44.63,
                    direction: 'down',
                    invalidationLevel: 44.63,
                },
                keyPrices: [
                    { label: '상단 추세선', price: 44.63 },
                    { label: '측정 목표가', price: 37.91 },
                    { label: '보수 목표가(50%)', price: 39.59 },
                ],
            });

            it('drops its geometry and target-labelled keyPrices, keeping the card text and its other key prices', () => {
                const [p] = align([shapeOnly]);
                expect(p).not.toHaveProperty('geometry');
                expect(p?.keyPrices).toEqual([
                    { label: '상단 추세선', price: 44.63 },
                ]);
                expect(p?.detected).toBe(true);
                expect(p?.summary).toBe('채널 하단 41.27');
            });

            it('no target is derived for it in post-processing', () => {
                const a = analysis({ patternSummaries: [shapeOnly] });
                const processed = postProcessAnalysisWithReconcile(
                    alignPatternGeometry(a, [], GEOMETRIES),
                    41.35,
                    1
                );
                expect(
                    (processed.patternSummaries[0]?.keyPrices ?? []).map(
                        kp => kp.label
                    )
                ).toEqual(['상단 추세선']);
            });

            it('also drops a geometry whose direction matches the skill category', () => {
                const [p] = align([
                    card({
                        id: 'double_top_0',
                        patternName: 'double_top',
                        skillName: '이중천장',
                        geometry: {
                            breakoutLevel: 90,
                            extremeLevel: 100,
                            direction: 'down',
                        },
                    }),
                ]);
                expect(p).not.toHaveProperty('geometry');
            });
        });

        describe('a card resolved to an undirected pattern (null entry: no prior trend, no target)', () => {
            const UNDIRECTED = new Map([['pattern:double_bottom:1', null]]);
            const modelCard = card({
                candidateId: 'pattern:double_bottom:1',
                geometry: {
                    breakoutLevel: 105,
                    extremeLevel: 100,
                    direction: 'up',
                },
                keyPrices: [
                    { label: '측정 목표가', price: 110 },
                    { label: 'Measured target', price: 110 },
                    { label: '보수 목표가(50%)', price: 107.5 },
                    { label: '상단 경계', price: 105 },
                ],
            });

            it('drops the model geometry and every target-labelled keyPrice, keeping the rest', () => {
                const [p] = align([modelCard], UNDIRECTED);
                expect(p).not.toHaveProperty('geometry');
                expect(p?.keyPrices).toEqual([
                    { label: '상단 경계', price: 105 },
                ]);
            });

            it('leaves a card without keyPrices without keyPrices', () => {
                const { keyPrices: _kp, ...bare } = modelCard;
                const [p] = align([bare], UNDIRECTED);
                expect(p).not.toHaveProperty('keyPrices');
                expect(p).not.toHaveProperty('geometry');
            });

            it('no target survives post-processing (the app derives none either)', () => {
                const a = analysis({ patternSummaries: [modelCard] });
                const { chartOverlays } = resolveChartOverlays(
                    [
                        {
                            ...cand('pattern:double_bottom:1', 'pattern'),
                            skill: 'double-bottom',
                        },
                    ],
                    a,
                    [],
                    SKILLS
                );
                const processed = postProcessAnalysisWithReconcile(
                    alignPatternGeometry(a, chartOverlays, UNDIRECTED),
                    100,
                    1
                );
                const labels = (
                    processed.patternSummaries[0]?.keyPrices ?? []
                ).map(kp => kp.label);
                expect(labels).toEqual(['상단 경계']);
            });
        });

        it('leaves a detected:false card untouched', () => {
            const unresolved = card({
                detected: false,
                candidateId: 'pattern:double_bottom:1',
            });
            expect(align([unresolved])).toEqual([unresolved]);
        });
    });
});
