import { describe, expect, it } from 'vitest';
import { postProcessRawAnalysis } from '@/application/market/postProcessRawAnalysis';
import { postProcessAnalysisWithReconcile } from '@/domain/analysis/ai-levels';
import {
    enrichAnalysisWithConfidence,
    isFallbackAnalysis,
} from '@/domain/analysis/confidence';
import {
    CANDLE_BASE_RATES,
    PATTERN_BASE_RATES,
} from '@/domain/analysis/measuredBaseRates';
import { checkPlanInvariants } from '@/domain/analysis/planInvariants';
import { ENTRY_RECOMMENDATION_BY_POSITION } from '@/domain/analysis/planState';
import { roundAnalysisPrices } from '@/domain/analysis/roundAnalysisPrices';
import { alignPatternGeometry, resolveChartOverlays } from '@/domain/overlays';
import { normalizeIdList } from '@/domain/analysis/normalize';
import type {
    AnalysisResponse,
    IndicatorGuideResult,
    OverlayCandidate,
    PatternTargetGeometry,
    RawStrategyResult,
    Skill,
} from '@/domain/types';
import {
    EDGE_PLANS,
    GRID_LAST_CLOSE,
    PLAN_GRID,
    gridAtr,
    gridName,
    postProcessEdgePlan,
    postProcessGridCase,
    rawRecommendation,
} from '../../helpers/planGrid';

const violatedIds = (c: (typeof PLAN_GRID)[number]) =>
    checkPlanInvariants(
        postProcessGridCase(c).actionRecommendation,
        GRID_LAST_CLOSE,
        gridAtr(c)
    ).map(violation => violation.id);

describe('plan invariants over the synthetic grid (post-processed)', () => {
    it('enumerates every axis combination', () => {
        expect(PLAN_GRID).toHaveLength(4 * 6 * 4 * 3 * 2);
    });

    it('breaks no invariant for any case', () => {
        const violating = PLAN_GRID.flatMap(c => {
            const ids = violatedIds(c);
            return ids.length === 0
                ? []
                : [`${gridName(c)}: ${ids.join(', ')}`];
        });
        expect(violating).toEqual([]);
    });

    it('breaks no invariant on any boundary plan', () => {
        const violating = EDGE_PLANS.flatMap(plan => {
            const ids = checkPlanInvariants(
                postProcessEdgePlan(plan).actionRecommendation,
                GRID_LAST_CLOSE,
                plan.atr ?? null
            ).map(violation => violation.id);
            return ids.length === 0 ? [] : [`${plan.name}: ${ids.join(', ')}`];
        });
        expect(EDGE_PLANS.length).toBeGreaterThan(0);
        expect(violating).toEqual([]);
    });

    it('returns descending and duplicated targets ascending and unique, through reconciledLevels', () => {
        const normalized = PLAN_GRID.filter(
            c =>
                (c.targets === 'descending' || c.targets === 'duplicate') &&
                c.entries !== 'empty' &&
                c.verdict !== 'avoid'
        );
        const wrong = normalized.filter(c => {
            const targets =
                postProcessGridCase(c).actionRecommendation?.reconciledLevels
                    ?.takeProfitPrices;
            return (
                targets === undefined ||
                targets.some((tp, i) => i > 0 && !(tp > targets[i - 1]))
            );
        });
        expect(normalized.length).toBeGreaterThan(0);
        expect(wrong.map(gridName)).toEqual([]);
    });

    it('rejects an unusable stop without an ATR and marks it, in exactly those cases (also without an entry zone: the close is the reference)', () => {
        const expectedMarked = PLAN_GRID.filter(
            c =>
                c.atr === 'undefined' &&
                (c.stop === 'inside' || c.stop === 'above')
        );
        const marked = PLAN_GRID.filter(
            c =>
                postProcessGridCase(c).actionRecommendation?.reconciledLevels
                    ?.stopLossRejected === true
        );
        expect(expectedMarked.length).toBeGreaterThan(0);
        expect(marked.map(gridName)).toEqual(expectedMarked.map(gridName));
    });

    it("reconciles an avoid verdict like any other: the stop floor applies to the model's own avoid plans", () => {
        const avoidCases = PLAN_GRID.filter(
            c =>
                c.verdict === 'avoid' &&
                c.atr === 'usable' &&
                c.entries === 'range' &&
                c.stop === 'above'
        );
        const unfloored = avoidCases.filter(
            c =>
                postProcessGridCase(c).actionRecommendation?.reconciledLevels
                    ?.stopBasis === undefined
        );
        expect(avoidCases.length).toBeGreaterThan(0);
        expect(unfloored).toEqual([]);
    });

    it('overwrites entryRecommendation from planState in every case that has a state', () => {
        const rows = PLAN_GRID.map(c => ({
            c,
            rec: postProcessGridCase(c).actionRecommendation,
        }));
        const withState = rows.filter(row => row.rec?.planState !== undefined);
        const mismatched = withState.filter(
            row =>
                row.rec?.entryRecommendation !==
                ENTRY_RECOMMENDATION_BY_POSITION[
                    row.rec?.planState?.position ?? 'no_setup'
                ]
        );
        // The model's verdict axis is irrelevant to the result: every case has a state.
        expect(withState).toHaveLength(PLAN_GRID.length);
        expect(mismatched.map(row => gridName(row.c))).toEqual([]);
    });

    it('keeps the model fields as written (core corrects through reconciledLevels only)', () => {
        const mutated = PLAN_GRID.filter(c => {
            const written = rawRecommendation(c);
            const after = postProcessGridCase(c).actionRecommendation;
            return (
                after?.stopLoss !== written.stopLoss ||
                JSON.stringify(after?.takeProfitPrices) !==
                    JSON.stringify(written.takeProfitPrices) ||
                JSON.stringify(after?.entryPrices) !==
                    JSON.stringify(written.entryPrices)
            );
        });
        expect(mutated).toEqual([]);
    });
});

describe('postProcessRawAnalysis', () => {
    const rawAnalysis = (extra: Record<string, unknown> = {}) => ({
        summary: 'synthetic',
        trend: 'bullish',
        indicatorResults: [],
        riskLevel: 'medium',
        keyLevels: {
            support: [{ price: 12_345, reason: '' }],
            resistance: [],
        },
        priceTargets: { bullish: null, bearish: null },
        patternSummaries: [],
        strategyResults: [],
        candlePatterns: [],
        trendlines: [],
        actionRecommendation: {
            positionAnalysis: '현재가 위치',
            entry: '',
            exit: '',
            riskReward: '',
            entryRecommendation: 'enter',
            entryPrices: [71_520, 71_980],
            stopLoss: 80_000,
            takeProfitPrices: [72_333, 73_999],
        },
        ...extra,
    });

    /** The chain as `runAnalysis` ran it inline before the extraction. */
    function inlineChain(
        rawResult: unknown,
        options: {
            lastClose: number;
            atr: number | undefined;
            locale: 'ko' | 'en';
        }
    ): AnalysisResponse {
        const enriched = enrichAnalysisWithConfidence(rawResult, []);
        const resolved = resolveChartOverlays(
            [],
            enriched,
            normalizeIdList(
                (rawResult as { trendlineIds?: unknown }).trendlineIds
            ),
            []
        );
        return roundAnalysisPrices(
            postProcessAnalysisWithReconcile(
                roundAnalysisPrices(
                    alignPatternGeometry(
                        enriched,
                        resolved.chartOverlays,
                        new Map()
                    ),
                    'KRW',
                    'share'
                ),
                options.lastClose,
                options.atr,
                [],
                'KRW',
                options.locale,
                'share'
            ),
            'KRW',
            'share'
        );
    }

    it.each([
        { locale: 'ko', atr: 900 },
        { locale: 'en', atr: undefined },
    ] as const)(
        'is the inline chain: KRW tick rounding on both sides ($locale, atr $atr)',
        ({ locale, atr }) => {
            const rawResult = rawAnalysis();
            const { reconciled } = postProcessRawAnalysis({
                rawResult,
                skills: [],
                overlayCandidates: [],
                patternGeometries: new Map(),
                lastClose: 71_700,
                atr,
                stopCandidates: [],
                computedIndicatorResults: [],
                computedStrategyResults: [],
                currency: 'KRW',
                locale,
                krxTickTable: 'share',
            });
            expect(reconciled).toEqual(
                inlineChain(rawResult, { lastClose: 71_700, atr, locale })
            );
        }
    );

    describe('allowedPatternSkills', () => {
        const cup: Skill = {
            name: 'Cup Guide',
            description: 'd',
            indicators: [],
            confidenceWeight: 0.8,
            content: '## Body',
            type: 'pattern',
        };
        const card = (skillName: string) => ({
            patternName: skillName,
            skillName,
            detected: false,
            trend: 'neutral',
            summary: 's',
        });
        const run = (allowedPatternSkills?: readonly string[]) =>
            postProcessRawAnalysis({
                rawResult: rawAnalysis({
                    patternSummaries: [card('Cup Guide'), card('Made Up')],
                }),
                skills: [cup],
                overlayCandidates: [],
                patternGeometries: new Map(),
                lastClose: 71_700,
                atr: 900,
                stopCandidates: [],
                computedIndicatorResults: [],
                computedStrategyResults: [],
                allowedPatternSkills,
            }).reconciled.patternSummaries.map(p => p.skillName);

        it('drops the entry of a pattern the prompt did not list', () => {
            expect(run(['Cup Guide'])).toEqual(['Cup Guide']);
        });

        it('keeps every entry when the list is omitted', () => {
            expect(run()).toEqual(['Cup Guide', 'Made Up']);
        });
    });

    describe('timeframe: the measured base rate of the cards (WP-18 C4)', () => {
        const wedge: Skill = {
            name: 'Double Bottom Guide',
            description: 'd',
            indicators: [],
            confidenceWeight: 0.8,
            content: '## Body',
            type: 'pattern',
            pattern: 'double_bottom',
        };
        const run = (timeframe?: '1Day' | '1Hour') =>
            postProcessRawAnalysis({
                rawResult: rawAnalysis({
                    patternSummaries: [
                        {
                            patternName: 'Double Bottom',
                            skillName: 'Double Bottom Guide',
                            detected: true,
                            trend: 'bullish',
                            summary: 's',
                        },
                    ],
                    candlePatterns: [
                        {
                            patternName: 'hammer',
                            detected: true,
                            trend: 'bullish',
                            summary: 's',
                        },
                    ],
                }),
                skills: [wedge],
                overlayCandidates: [],
                patternGeometries: new Map(),
                lastClose: 71_700,
                atr: 900,
                stopCandidates: [],
                computedIndicatorResults: [],
                computedStrategyResults: [],
                timeframe,
            }).reconciled;

        it('carries each card its table row on a daily chart, through rounding and reconciliation', () => {
            const reconciled = run('1Day');
            expect(reconciled.patternSummaries[0].baseRate).toBe(
                PATTERN_BASE_RATES.double_bottom
            );
            expect(reconciled.candlePatterns[0].baseRate).toBe(
                CANDLE_BASE_RATES.hammer
            );
        });

        it('carries null on an intraday chart', () => {
            const reconciled = run('1Hour');
            expect(reconciled.patternSummaries[0].baseRate).toBeNull();
            expect(reconciled.candlePatterns[0].baseRate).toBeNull();
        });

        it('leaves the field off when the caller gives no timeframe', () => {
            const reconciled = run();
            expect('baseRate' in reconciled.patternSummaries[0]).toBe(false);
        });
    });

    it('returns the model output before tick rounding and reconciliation', () => {
        const { reconciled, modelOutput } = postProcessRawAnalysis({
            rawResult: rawAnalysis(),
            skills: [],
            overlayCandidates: [],
            patternGeometries: new Map(),
            lastClose: 71_700,
            atr: 900,
            stopCandidates: [],
            computedIndicatorResults: [],
            computedStrategyResults: [],
            currency: 'KRW',
            krxTickTable: 'share',
        });
        // 71,520 and 71,980 are off the 100-won tick; the stop 80,000 is invalid.
        expect(modelOutput.actionRecommendation?.entryPrices).toEqual([
            71_520, 71_980,
        ]);
        expect(
            modelOutput.actionRecommendation?.reconciledLevels
        ).toBeUndefined();
        expect(reconciled.actionRecommendation?.entryPrices).toEqual([
            71_500, 72_000,
        ]);
        expect(reconciled.actionRecommendation?.reconciledLevels).toBeDefined();
    });

    it('returns the overlay resolution next to the analysis', () => {
        const { resolvedOverlays } = postProcessRawAnalysis({
            rawResult: rawAnalysis({ trendlineIds: ['no-such-candidate'] }),
            skills: [],
            overlayCandidates: [],
            patternGeometries: new Map(),
            lastClose: 71_700,
            atr: undefined,
            stopCandidates: [],
            computedIndicatorResults: [],
            computedStrategyResults: [],
        });
        expect(resolvedOverlays.unknownIds).toEqual(['no-such-candidate']);
        expect(resolvedOverlays.chartOverlays).toEqual([]);
    });

    it('defaults to a USD listing and the Korean locale', () => {
        const withDefaults = postProcessRawAnalysis({
            rawResult: rawAnalysis(),
            skills: [],
            overlayCandidates: [],
            patternGeometries: new Map(),
            lastClose: 71_700,
            atr: 900,
            stopCandidates: [],
            computedIndicatorResults: [],
            computedStrategyResults: [],
        }).reconciled;
        const explicit = postProcessRawAnalysis({
            rawResult: rawAnalysis(),
            skills: [],
            overlayCandidates: [],
            patternGeometries: new Map(),
            lastClose: 71_700,
            atr: 900,
            stopCandidates: [],
            computedIndicatorResults: [],
            computedStrategyResults: [],
            currency: 'USD',
            locale: 'ko',
        }).reconciled;
        expect(withDefaults).toEqual(explicit);
    });

    describe('pattern targets on a KRW listing', () => {
        const SKILLS = [
            {
                name: '이중바닥',
                pattern: 'double_bottom',
                category: 'reversal_bullish',
            },
        ] as Skill[];
        const CANDIDATE_ID = 'pattern:double_bottom:1';
        const candidate: OverlayCandidate = {
            id: CANDIDATE_ID,
            kind: 'pattern',
            skill: 'double-bottom',
            promptLine: 'p',
            segments: [
                {
                    from: { time: 1, price: 70_011 },
                    to: { time: 5, price: 71_523 },
                    role: 'x',
                    style: 'solid',
                    pane: 'price',
                },
            ],
            levels: [],
            labels: [],
        };
        // 71,523 + (71,523 - 70,011) = 73,035: between two 100-won ticks.
        const printed: PatternTargetGeometry = {
            breakoutLevel: 71_523,
            extremeLevel: 70_011,
            direction: 'up',
        };
        const run = () =>
            postProcessRawAnalysis({
                rawResult: rawAnalysis({
                    patternSummaries: [
                        {
                            patternName: 'double_bottom',
                            skillName: '이중바닥',
                            detected: true,
                            trend: 'bullish',
                            summary: 'x',
                            candidateId: CANDIDATE_ID,
                        },
                    ],
                }),
                skills: SKILLS,
                overlayCandidates: [candidate],
                patternGeometries: new Map([[CANDIDATE_ID, printed]]),
                lastClose: 71_700,
                atr: 900,
                stopCandidates: [],
                computedIndicatorResults: [],
                computedStrategyResults: [],
                currency: 'KRW',
                krxTickTable: 'share',
            });

        it('draws the card and appends the measured target from the printed geometry', () => {
            const { reconciled, resolvedOverlays } = run();
            expect(resolvedOverlays.chartOverlays).toHaveLength(1);
            expect(reconciled.patternSummaries[0]?.geometry).toEqual(printed);
        });

        it('rounds that target to the KRX tick, on the pass after post-processing', () => {
            const prices = (
                run().reconciled.patternSummaries[0]?.keyPrices ?? []
            )
                .filter(keyPrice => keyPrice.label === '측정 목표가')
                .map(keyPrice => keyPrice.price);
            expect(prices).toEqual([73_000]);
        });
    });

    describe('cards computed in code', () => {
        const cycleSkill: Skill = {
            name: 'MA Cycle Strategy',
            description: 'd',
            indicators: [],
            confidenceWeight: 0.55,
            content: '## Body',
            type: 'strategy',
            computedCard: 'ma_cycle',
        };
        const fibSkill: Skill = {
            ...cycleSkill,
            name: 'Fibonacci Strategy',
            confidenceWeight: 0.7,
            computedCard: undefined,
        };
        const indicatorCard: IndicatorGuideResult = {
            indicatorName: 'MA Signal Guide',
            signals: [
                {
                    type: 'skill',
                    description: 'MA Signal Guide: mixed.',
                    trend: 'neutral',
                    reading: {
                        kind: 'ma',
                        basis: 'always_on',
                        state: 'mixed',
                        values: {
                            close: 1,
                            ma5: 1,
                            ma20: 1,
                            ma60: 1,
                            ma120: 1,
                            ma200: 1,
                        },
                        signals: [],
                    },
                },
            ],
        };
        const cycleCard: RawStrategyResult = {
            strategyName: 'MA Cycle Strategy',
            trend: 'bearish',
            summary: 'MA cycle: stage 4',
            candidateIds: [],
        };
        const run = (rawResult: unknown) =>
            postProcessRawAnalysis({
                rawResult,
                skills: [cycleSkill, fibSkill],
                overlayCandidates: [],
                patternGeometries: new Map(),
                lastClose: 71_700,
                atr: 900,
                stopCandidates: [],
                computedIndicatorResults: [indicatorCard],
                computedStrategyResults: [cycleCard],
            });
        const modelWrites = rawAnalysis({
            indicatorResults: [
                {
                    indicatorName: 'MA Signal Guide',
                    signals: [
                        {
                            type: 'skill',
                            description: '모델이 쓴 카드',
                            trend: 'bullish',
                        },
                    ],
                },
            ],
            strategyResults: [
                {
                    strategyName: 'MA Cycle Strategy',
                    trend: 'bullish',
                    summary: '모델이 쓴 사이클',
                },
                {
                    strategyName: 'Fibonacci Strategy',
                    trend: 'neutral',
                    summary: '피보나치',
                },
            ],
        });

        it('replaces the model indicatorResults with the computed cards', () => {
            expect(run(modelWrites).reconciled.indicatorResults).toEqual([
                indicatorCard,
            ]);
        });

        it('drops the model entry of a computed-card strategy and appends the computed card after the model strategies', () => {
            const { reconciled } = run(modelWrites);
            expect(reconciled.strategyResults.map(s => s.strategyName)).toEqual(
                ['Fibonacci Strategy', 'MA Cycle Strategy']
            );
            expect(reconciled.strategyResults[1]).toMatchObject({
                summary: 'MA cycle: stage 4',
                trend: 'bearish',
                confidenceWeight: 0.55,
            });
        });

        it('keeps the cards out of the model output the price provenance check reads', () => {
            const { modelOutput } = run(modelWrites);
            expect(modelOutput.indicatorResults).toEqual([]);
            expect(
                modelOutput.strategyResults.map(s => s.strategyName)
            ).toEqual(['Fibonacci Strategy']);
        });

        it('attaches nothing to the empty fallback reply, so it is still recognised as one', () => {
            const { reconciled, modelOutput } = run({});
            expect(reconciled.indicatorResults).toEqual([]);
            expect(reconciled.strategyResults).toEqual([]);
            expect(isFallbackAnalysis(reconciled)).toBe(true);
            expect(isFallbackAnalysis(modelOutput)).toBe(true);
        });

        it('attaches the cards to a reply that has a summary and nothing else', () => {
            const { reconciled } = run({ summary: '요약만 있는 답' });
            expect(isFallbackAnalysis(reconciled)).toBe(false);
            expect(reconciled.indicatorResults).toEqual([indicatorCard]);
        });
    });
});
