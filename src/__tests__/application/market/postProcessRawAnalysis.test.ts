import { describe, expect, it } from 'vitest';
import { postProcessRawAnalysis } from '@/application/market/postProcessRawAnalysis';
import { postProcessAnalysisWithReconcile } from '@/domain/analysis/ai-levels';
import { enrichAnalysisWithConfidence } from '@/domain/analysis/confidence';
import { checkPlanInvariants } from '@/domain/analysis/planInvariants';
import { roundAnalysisPrices } from '@/domain/analysis/roundAnalysisPrices';
import { alignPatternGeometry, resolveChartOverlays } from '@/domain/overlays';
import { normalizeIdList } from '@/domain/analysis/normalize';
import type {
    AnalysisResponse,
    OverlayCandidate,
    PatternTargetGeometry,
    Skill,
} from '@/domain/types';
import {
    EDGE_PLANS,
    GRID_LAST_CLOSE,
    PLAN_GRID,
    gridName,
    postProcessEdgePlan,
    postProcessGridCase,
    rawRecommendation,
} from '../../helpers/planGrid';

const violatedIds = (c: (typeof PLAN_GRID)[number]) =>
    checkPlanInvariants(
        postProcessGridCase(c).actionRecommendation,
        GRID_LAST_CLOSE
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
                GRID_LAST_CLOSE
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
                c.verdict !== 'avoid' &&
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

    it('attaches no reconciled levels to an avoid verdict', () => {
        const avoidCases = PLAN_GRID.filter(c => c.verdict === 'avoid');
        const touched = avoidCases.filter(
            c =>
                postProcessGridCase(c).actionRecommendation
                    ?.reconciledLevels !== undefined
        );
        expect(avoidCases.length).toBeGreaterThan(0);
        expect(touched).toEqual([]);
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
                currency: 'KRW',
                locale,
                krxTickTable: 'share',
            });
            expect(reconciled).toEqual(
                inlineChain(rawResult, { lastClose: 71_700, atr, locale })
            );
        }
    );

    it('returns the model output before tick rounding and reconciliation', () => {
        const { reconciled, modelOutput } = postProcessRawAnalysis({
            rawResult: rawAnalysis(),
            skills: [],
            overlayCandidates: [],
            patternGeometries: new Map(),
            lastClose: 71_700,
            atr: 900,
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
        }).reconciled;
        const explicit = postProcessRawAnalysis({
            rawResult: rawAnalysis(),
            skills: [],
            overlayCandidates: [],
            patternGeometries: new Map(),
            lastClose: 71_700,
            atr: 900,
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
});
