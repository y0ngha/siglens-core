import { describe, expect, it } from 'vitest';
import { postProcessRawAnalysis } from '@/application/market/postProcessRawAnalysis';
import {
    checkPriceProvenance,
    createPriceGrounding,
} from '@/domain/analysis/priceProvenance';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { priceQuoting } from '@/domain/analysis/promptFormat';
import {
    inferPromptPriceDecimals,
    parsePromptReferenceLevels,
} from '@/domain/analysis/promptNumbers';
import { calculateIndicators } from '@/domain/indicators';
import type {
    ActionRecommendation,
    AnalysisResponse,
    Bar,
    PatternResult,
} from '@/domain/types';

const PROMPT = [
    'Symbol: TEST',
    '- 197.51 (VWAP; 0.54% away)',
    '- 199.84 (Camarilla R3; 1.72% away)',
    '- 201.36 (Fib 38.2%; 2.50% away)',
    '- 190.00 (Round 190; 3.28% away)',
    'Fib table: 23.6% 203.22',
    'MA200 195.5 and 3 bars',
].join('\n');

function recommendation(
    overrides: Partial<ActionRecommendation> = {}
): ActionRecommendation {
    return {
        positionAnalysis: '',
        entry: '',
        exit: '',
        riskReward: '',
        ...overrides,
    };
}

function pattern(overrides: Partial<PatternResult> = {}): PatternResult {
    return {
        id: 'p1',
        patternName: 'double_top',
        skillName: 'double_top',
        detected: true,
        trend: 'bearish',
        summary: '',
        confidenceWeight: 1,
        ...overrides,
    };
}

function analysis(overrides: Partial<AnalysisResponse> = {}): AnalysisResponse {
    return {
        summary: '',
        trend: 'neutral',
        indicatorResults: [],
        riskLevel: 'medium',
        keyLevels: { support: [], resistance: [] },
        priceTargets: { bullish: null, bearish: null },
        patternSummaries: [],
        strategyResults: [],
        candlePatterns: [],
        trendlines: [],
        ...overrides,
    };
}

function check(result: AnalysisResponse, priceDecimals = 2) {
    return checkPriceProvenance({
        promptDynamic: PROMPT,
        result,
        priceDecimals,
    });
}

describe('checkPriceProvenance — plan prices', () => {
    it('grounds a plan whose every price is printed with the prompt precision', () => {
        const report = check(
            analysis({
                actionRecommendation: recommendation({
                    entryPrices: [197.51, 199.84],
                    stopLoss: 190,
                    takeProfitPrices: [201.36, 203.22],
                }),
            })
        );
        expect(report.plan).toEqual([]);
        expect(report.checked).toEqual({ plan: 5, other: 0, keyPrices: 0 });
    });

    it('reports a price the prompt never printed, with its field', () => {
        const report = check(
            analysis({
                actionRecommendation: recommendation({
                    entryPrices: [197.51],
                    stopLoss: 188.3,
                    takeProfitPrices: [201.36, 210.5],
                }),
            })
        );
        expect(report.plan).toEqual([
            { field: 'stopLoss', value: 188.3 },
            { field: 'takeProfitPrices', value: 210.5 },
        ]);
    });

    it('does not excuse a round number the prompt only printed as an integer', () => {
        const report = check(
            analysis({
                actionRecommendation: recommendation({
                    // "Round 190" prints the integer 190, but only "190.00" carries the
                    // quoted precision; 195 appears nowhere with two decimals.
                    entryPrices: [195, 190],
                }),
            })
        );
        expect(report.plan).toEqual([{ field: 'entryPrices', value: 195 }]);
    });

    it('does not ground a price by a token written with a different precision', () => {
        const report = check(
            analysis({
                actionRecommendation: recommendation({ stopLoss: 195.5 }),
            })
        );
        expect(report.plan).toEqual([{ field: 'stopLoss', value: 195.5 }]);
    });

    it('accepts a price within half a printed unit of a token and rejects one a full unit away', () => {
        const within = check(
            analysis({
                actionRecommendation: recommendation({ stopLoss: 197.515 }),
            })
        );
        const outside = check(
            analysis({
                actionRecommendation: recommendation({ stopLoss: 197.52 }),
            })
        );
        expect(within.plan).toEqual([]);
        expect(outside.plan).toEqual([{ field: 'stopLoss', value: 197.52 }]);
    });

    it('skips non-finite and non-positive values (the invariants own them)', () => {
        const report = check(
            analysis({
                actionRecommendation: recommendation({
                    entryPrices: [Number.NaN, 0, -5],
                    stopLoss: Number.POSITIVE_INFINITY,
                    takeProfitPrices: [-1],
                }),
            })
        );
        expect(report).toEqual({
            checked: { plan: 0, other: 0, keyPrices: 0 },
            plan: [],
            other: [],
            keyPrices: [],
        });
    });

    it('checks nothing without a recommendation', () => {
        expect(check(analysis()).checked.plan).toBe(0);
    });

    it('never checks code-derived values: reconciledLevels, planCheck and pattern-target key prices', () => {
        const report = check(
            analysis({
                actionRecommendation: recommendation({
                    reconciledLevels: {
                        stopLoss: 111.11,
                        takeProfitPrices: [222.22],
                        exit: '',
                        riskReward: '',
                        reason: '',
                    },
                    planCheck: {
                        currentPrice: 333.33,
                        entryZoneTop: 333.33,
                        exceedsEntryZone: false,
                        belowStopLoss: false,
                        riskRewardAtEntry: null,
                        riskRewardAtCurrent: null,
                    },
                }),
                patternSummaries: [
                    pattern({
                        keyPrices: [
                            { label: '측정 목표가', price: 444.44 },
                            { label: '보수 목표가(50%)', price: 555.55 },
                        ],
                    }),
                ],
            })
        );
        expect(report).toEqual({
            checked: { plan: 0, other: 0, keyPrices: 0 },
            plan: [],
            other: [],
            keyPrices: [],
        });
    });
});

describe('checkPriceProvenance — other structured prices', () => {
    it('checks key levels, the point of control, scenario targets and pattern geometry', () => {
        const report = check(
            analysis({
                keyLevels: {
                    support: [
                        { price: 197.51, reason: '' },
                        { price: 11.11, reason: '' },
                    ],
                    resistance: [{ price: 22.22, reason: '' }],
                    poc: { price: 33.33, reason: '' },
                },
                priceTargets: {
                    bullish: {
                        condition: '',
                        targets: [
                            { price: 201.36, basis: '' },
                            { price: 44.44, basis: '' },
                        ],
                    },
                    bearish: null,
                },
                patternSummaries: [
                    pattern({
                        geometry: {
                            breakoutLevel: 199.84,
                            extremeLevel: 55.55,
                            direction: 'down',
                            invalidationLevel: 66.66,
                        },
                    }),
                ],
            })
        );
        expect(report.plan).toEqual([]);
        expect(report.checked).toEqual({ plan: 0, other: 9, keyPrices: 0 });
        expect(report.other).toEqual([
            { field: 'keyLevels.support', value: 11.11 },
            { field: 'keyLevels.resistance', value: 22.22 },
            { field: 'keyLevels.poc', value: 33.33 },
            { field: 'priceTargets', value: 44.44 },
            { field: 'patternGeometry', value: 55.55 },
            { field: 'patternGeometry', value: 66.66 },
        ]);
    });

    it('reads targets of both scenarios and a geometry without an invalidation level', () => {
        const report = check(
            analysis({
                priceTargets: {
                    bullish: null,
                    bearish: {
                        condition: '',
                        targets: [{ price: 77.77, basis: '' }],
                    },
                },
                patternSummaries: [
                    pattern({
                        geometry: {
                            breakoutLevel: 199.84,
                            extremeLevel: 201.36,
                            direction: 'up',
                        },
                    }),
                ],
            })
        );
        expect(report.checked.other).toBe(3);
        expect(report.other).toEqual([{ field: 'priceTargets', value: 77.77 }]);
    });
});

describe('checkPriceProvenance — price precision', () => {
    const wholeUnitPrompt =
        '- 71500 (MA20; 1.00% away)\n- 70200 (MA60; 1.00% away)';

    it('with 0 decimals grounds on integer tokens only', () => {
        const report = checkPriceProvenance({
            promptDynamic: `${wholeUnitPrompt}\nratio 1.5`,
            result: analysis({
                actionRecommendation: recommendation({
                    entryPrices: [71500],
                    stopLoss: 70200,
                    takeProfitPrices: [75000],
                }),
            }),
            priceDecimals: 0,
        });
        expect(report.plan).toEqual([
            { field: 'takeProfitPrices', value: 75000 },
        ]);
    });

    it('with 4 decimals needs a token written with four', () => {
        const report = checkPriceProvenance({
            promptDynamic: '- 0.0123 (VWAP; 1.00% away)\nvolume 0.012',
            result: analysis({
                actionRecommendation: recommendation({
                    entryPrices: [0.0123],
                    stopLoss: 0.012,
                }),
            }),
            priceDecimals: 4,
        });
        expect(report.plan).toEqual([{ field: 'stopLoss', value: 0.012 }]);
    });
});

describe('checkPriceProvenance — key prices (a class of their own)', () => {
    it('reports an ungrounded model key price under keyPrices, never under plan or other', () => {
        const report = check(
            analysis({
                patternSummaries: [
                    pattern({
                        keyPrices: [
                            { label: '넥라인', price: 197.51 },
                            { label: '목표', price: 123.45 },
                        ],
                    }),
                ],
            })
        );
        expect(report.checked).toEqual({ plan: 0, other: 0, keyPrices: 2 });
        expect(report.keyPrices).toEqual([
            { field: 'keyPrices', value: 123.45 },
        ]);
        expect(report.plan).toEqual([]);
        expect(report.other).toEqual([]);
    });
});

describe('createPriceGrounding — tokens that are not prices', () => {
    const grounded = (prompt: string, value: number, decimals = 2) =>
        createPriceGrounding(prompt, decimals)(value);

    it('is not grounded by a percentage', () => {
        expect(grounded('- 197.51 (VWAP; 54.00% away)', 54)).toBe(false);
        expect(grounded('- 197.51 (VWAP; 54.00 % away)', 54)).toBe(false);
        expect(grounded('- 54.00 (VWAP; 1.00% away)', 54)).toBe(true);
    });

    it('is not grounded by the magnitude of a negative number', () => {
        expect(grounded('MACD -45.30 and 12.00', 45.3)).toBe(false);
        expect(grounded('MACD -45.30 and 12.00', 12)).toBe(true);
        expect(grounded('range 100.00-105.00', 105)).toBe(true);
    });

    it('is not grounded by a number inside a date or a time', () => {
        expect(grounded('Date: 2026-11-20 09:30:15', 11.2, 1)).toBe(false);
        expect(grounded('as of 11/20/2026', 20, 0)).toBe(false);
        expect(grounded('opens 09:30', 9, 0)).toBe(false);
        expect(grounded('opens 09:30', 30, 0)).toBe(false);
    });

    it('does not let a year ground a price near it (whole-unit prices)', () => {
        const prompt = [
            'Date: 2025-02-19',
            '## Market Reference (deterministic · advisory)',
            '- 71500 (VWAP; 1.00% away)',
        ].join('\n');
        const report = checkPriceProvenance({
            promptDynamic: prompt,
            result: analysis({
                actionRecommendation: recommendation({
                    entryPrices: [2025, 71500],
                }),
            }),
            priceDecimals: 0,
        });
        expect(report.plan).toEqual([{ field: 'entryPrices', value: 2025 }]);
    });

    it('is not grounded by a number that only a skill guide or the instructions print', () => {
        const prompt = [
            '## Market Reference (deterministic · advisory)',
            '- 197.51 (VWAP; 1.00% away)',
            '## Indicator Signal Guides',
            '### RSI example: buy at 150.25 with a stop at 148.10',
            '## Pattern Analysis',
            'neckline 160.40',
            '## Prior Analyses (AAPL · Daily · reference only)',
            '- entry 170.55',
            '## Analysis Request',
            'target 180.65',
        ].join('\n');
        const isGrounded = createPriceGrounding(prompt, 2);
        expect(isGrounded(197.51)).toBe(true);
        expect([150.25, 148.1, 160.4, 170.55, 180.65].map(isGrounded)).toEqual([
            false,
            false,
            false,
            false,
            false,
        ]);
    });

    it('keeps a section it does not know as data, and a prompt without headings whole', () => {
        expect(
            grounded('## Market Events (computed)\n- level 150.25', 150.25)
        ).toBe(true);
        expect(grounded('level 150.25', 150.25)).toBe(true);
    });

    it('treats the heading of a sub-section as part of its section', () => {
        const prompt = '## Pattern Analysis\n### Geometry\nlevel 160.40';
        expect(grounded(prompt, 160.4)).toBe(false);
    });
});

describe('checkPriceProvenance — KRW prompt built by buildAnalysisPrompt', () => {
    const TICK = 100;
    const bars: Bar[] = Array.from({ length: 260 }, (_, i) => {
        const close =
            Math.round((60_000 + 40 * i + 3_000 * Math.sin(i / 7)) / TICK) *
            TICK;
        return {
            time: 1_700_000_000 + i * 86_400,
            open: close - TICK,
            high: close + 2 * TICK,
            low: close - 2 * TICK,
            close,
            volume: 1_000_000 + 1_000 * i,
        };
    });
    const lastClose = bars[bars.length - 1].close;
    const indicators = calculateIndicators(bars);
    const { dynamic } = buildAnalysisPrompt(
        '005930.KS',
        '삼성전자',
        bars,
        indicators,
        [],
        '1Day',
        undefined,
        'equity',
        undefined,
        'ko',
        undefined,
        undefined,
        'KRW',
        'share'
    );
    const priceDecimals = priceQuoting(lastClose, 'KRW').dp;
    const printedLevel = parsePromptReferenceLevels(dynamic)[0].price;
    /** Whether `value` shows up in the prompt text at all, however it is written. */
    const appearsInPrompt = (value: number): boolean =>
        dynamic.includes(String(value)) ||
        dynamic.includes(value.toLocaleString('en-US'));

    const plan = (entryPrices: number[]) =>
        checkPriceProvenance({
            promptDynamic: dynamic,
            result: analysis({
                actionRecommendation: recommendation({ entryPrices }),
            }),
            priceDecimals,
        }).plan;

    it('prints whole-won prices on the tick, so the precision is 0', () => {
        expect(priceDecimals).toBe(0);
        expect(inferPromptPriceDecimals(dynamic)).toBe(0);
        expect(printedLevel % TICK).toBe(0);
    });

    it('grounds a printed level', () => {
        expect(plan([printedLevel])).toEqual([]);
    });

    it('reports a fabricated off-tick price', () => {
        const fabricated = lastClose + 37;
        expect(appearsInPrompt(fabricated)).toBe(false);
        expect(plan([fabricated])).toEqual([
            { field: 'entryPrices', value: fabricated },
        ]);
    });

    it('reports a fabricated on-tick price that the prompt does not print', () => {
        const fabricated = [7_700, 7_900, 8_100, 8_300]
            .map(offset => lastClose + offset)
            .find(candidate => !appearsInPrompt(candidate));
        expect(fabricated).toBeDefined();
        expect(plan([fabricated as number])).toEqual([
            { field: 'entryPrices', value: fabricated },
        ]);
    });

    it('is not fooled by tick rounding: a price off by 37 won passes after snapping, not before', () => {
        const rawResult = {
            summary: 's',
            trend: 'bullish',
            indicatorResults: [],
            riskLevel: 'low',
            keyLevels: { support: [], resistance: [] },
            priceTargets: { bullish: null, bearish: null },
            patternSummaries: [],
            strategyResults: [],
            candlePatterns: [],
            trendlines: [],
            actionRecommendation: {
                positionAnalysis: 'p',
                entry: '',
                exit: '',
                riskReward: '',
                entryRecommendation: 'enter',
                entryPrices: [printedLevel + 37],
            },
        };
        const { reconciled, modelOutput } = postProcessRawAnalysis({
            rawResult,
            skills: [],
            overlayCandidates: [],
            patternGeometries: new Map(),
            lastClose,
            atr: undefined,
            stopCandidates: [],
            currency: 'KRW',
            krxTickTable: 'share',
        });
        const check = (result: AnalysisResponse) =>
            checkPriceProvenance({
                promptDynamic: dynamic,
                result,
                priceDecimals,
            }).plan;

        expect(reconciled.actionRecommendation?.entryPrices).toEqual([
            printedLevel,
        ]);
        expect(check(reconciled)).toEqual([]);
        expect(check(modelOutput)).toEqual([
            { field: 'entryPrices', value: printedLevel + 37 },
        ]);
    });
});
