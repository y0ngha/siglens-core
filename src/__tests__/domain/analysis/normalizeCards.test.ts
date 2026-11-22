import { describe, expect, it } from 'vitest';
import {
    attachComputedCards,
    enrichAnalysisWithConfidence,
    isFallbackAnalysis,
    normalizeCachedAnalysisResponse,
} from '@/domain/analysis/confidence';
import {
    normalizeCycleReading,
    normalizeIndicatorReading,
} from '@/domain/analysis/normalizeCards';
import {
    INDICATOR_CARD_BASIS,
    INDICATOR_CARD_KINDS,
    INDICATOR_CARD_STATE_VALUES,
    INDICATOR_CARD_VALUE_KEYS,
} from '@/domain/analysis/computedCardKinds';
import type {
    AnalysisResponse,
    CycleReading,
    IndicatorGuideResult,
    IndicatorReading,
    RawStrategyResult,
    Skill,
} from '@/domain/types';

const RSI_READING: IndicatorReading = {
    kind: 'rsi',
    basis: 'event',
    state: 'rsi_oversold',
    values: { rsi: 24.56 },
    signals: [{ type: 'rsi_oversold', phase: 'confirmed', barsAgo: 0 }],
};

const MA_READING: IndicatorReading = {
    kind: 'ma',
    basis: 'always_on',
    state: 'mixed',
    values: {
        close: 100,
        ma5: 99,
        ma20: 101,
        ma60: null,
        ma120: 98,
        ma200: 97,
    },
    signals: [],
};

const IMPULSE_READING: IndicatorReading = {
    kind: 'elder_impulse',
    basis: 'state',
    state: 'red',
    values: {},
    signals: [],
    flippedFrom: 'green',
};

const CYCLE: CycleReading = {
    kind: 'ma_cycle',
    stage: 4,
    previousStage: 3,
    barsInStage: 12,
    progression: 'forward',
    stageChanges: 3,
    values: { ma5: 10, ma20: 20, ma60: 30 },
    order: ['long', 'medium', 'short'],
    slopes: { ma5: 'falling', ma20: 'flat', ma60: null },
};

describe('normalizeIndicatorReading', () => {
    it.each([
        ['rsi', RSI_READING],
        ['ma', MA_READING],
        ['elder_impulse', IMPULSE_READING],
    ])('keeps a reading the builder writes (%s) as it is', (_, r) => {
        expect(
            normalizeIndicatorReading(JSON.parse(JSON.stringify(r)))
        ).toEqual(r);
    });

    it('drops what is not a reading, never coercing', () => {
        const bad = (patch: Record<string, unknown>) =>
            normalizeIndicatorReading({ ...RSI_READING, ...patch });
        expect(normalizeIndicatorReading(null)).toBeUndefined();
        expect(normalizeIndicatorReading('rsi')).toBeUndefined();
        expect(bad({ kind: 'nope' })).toBeUndefined();
        expect(bad({ basis: 'state' })).toBeUndefined();
        expect(bad({ state: 3 })).toBeUndefined();
        expect(bad({ values: { rsi: '24' } })).toBeUndefined();
        expect(bad({ values: { rsi: Number.NaN } })).toBeUndefined();
        expect(bad({ values: {} })).toBeUndefined();
        expect(bad({ values: null })).toBeUndefined();
        expect(bad({ signals: [] })).toBeUndefined();
        expect(bad({ state: 'macd_bullish_cross' })).toBeUndefined();
        expect(
            bad({
                signals: [{ type: 'rsi_oversold', phase: 'later', barsAgo: 0 }],
            })
        ).toBeUndefined();
        expect(
            bad({
                signals: [
                    { type: 'rsi_oversold', phase: 'confirmed', barsAgo: -1 },
                ],
            })
        ).toBeUndefined();
        expect(
            bad({
                signals: [
                    { type: 'rsi_oversold', phase: 'confirmed', barsAgo: 1.5 },
                ],
            })
        ).toBeUndefined();
        expect(
            normalizeIndicatorReading({ ...MA_READING, state: 'rising' })
        ).toBeUndefined();
        expect(
            normalizeIndicatorReading({
                ...MA_READING,
                signals: [{ type: 'x', phase: 'confirmed', barsAgo: 0 }],
            })
        ).toBeUndefined();
        expect(
            normalizeIndicatorReading({
                ...IMPULSE_READING,
                flippedFrom: 'purple',
            })
        ).toBeUndefined();
        expect(
            normalizeIndicatorReading({
                ...IMPULSE_READING,
                flippedFrom: undefined,
            })
        ).toBeUndefined();
        expect(
            normalizeIndicatorReading({ ...IMPULSE_READING, flippedFrom: null })
        ).toMatchObject({ flippedFrom: null });
    });

    it('keeps only the value keys the kind owns', () => {
        const read = normalizeIndicatorReading({
            ...RSI_READING,
            values: { rsi: 24.56, extra: 1 },
        });
        expect(read?.values).toEqual({ rsi: 24.56 });
    });

    it.each(INDICATOR_CARD_KINDS)(
        'round-trips a reading of the kind %s with its own state and keys',
        kind => {
            const states = INDICATOR_CARD_STATE_VALUES[kind];
            const state = states === null ? 'rsi_oversold' : states[0];
            const reading = {
                kind,
                basis: INDICATOR_CARD_BASIS[kind],
                state,
                values: Object.fromEntries(
                    INDICATOR_CARD_VALUE_KEYS[kind].map((key, i) => [
                        key,
                        i + 1,
                    ])
                ),
                signals:
                    states === null
                        ? [{ type: state, phase: 'confirmed', barsAgo: 2 }]
                        : [],
                ...(kind === 'elder_impulse' ? { flippedFrom: null } : {}),
            };
            expect(normalizeIndicatorReading(reading)).toEqual(reading);
        }
    );
});

describe('normalizeCycleReading', () => {
    it('keeps a reading the builder writes', () => {
        expect(
            normalizeCycleReading(JSON.parse(JSON.stringify(CYCLE)))
        ).toEqual(CYCLE);
        const macd: CycleReading = {
            kind: 'macd_cycle',
            stage: 1,
            previousStage: null,
            barsInStage: null,
            progression: null,
            stageChanges: 0,
            values: { upper: 1, middle: 2, lower: 3 },
            slopes: { ema9: 'rising', ema21: 'rising', ema60: 'rising' },
        };
        expect(normalizeCycleReading(macd)).toEqual(macd);
    });

    it('drops what is not one', () => {
        const bad = (patch: Record<string, unknown>) =>
            normalizeCycleReading({ ...CYCLE, ...patch });
        expect(normalizeCycleReading(undefined)).toBeUndefined();
        expect(bad({ kind: 'rsi' })).toBeUndefined();
        expect(bad({ stage: 7 })).toBeUndefined();
        expect(bad({ stage: 0 })).toBeUndefined();
        expect(bad({ previousStage: 9 })).toBeUndefined();
        expect(bad({ progression: 'sideways' })).toBeUndefined();
        expect(bad({ progression: undefined })).toBeUndefined();
        expect(bad({ barsInStage: -2 })).toBeUndefined();
        expect(bad({ barsInStage: 'x' })).toBeUndefined();
        expect(bad({ stageChanges: 1.2 })).toBeUndefined();
        expect(bad({ values: { ma5: 'x' } })).toBeUndefined();
        expect(bad({ values: null })).toBeUndefined();
        expect(bad({ slopes: { ma5: 'sideways' } })).toBeUndefined();
        expect(bad({ slopes: null })).toBeUndefined();
        expect(bad({ order: ['long', 'x', 'short'] })).toBeUndefined();
    });
});

// ── Through the analysis ────────────────────────────────────────────────────

const CYCLE_SKILL: Skill = {
    name: 'MA Cycle Strategy',
    description: 'd',
    type: 'strategy',
    indicators: [],
    confidenceWeight: 0.55,
    content: 'c',
    computedCard: 'ma_cycle',
};

const FIB_SKILL: Skill = {
    ...CYCLE_SKILL,
    name: 'Fibonacci Strategy',
    confidenceWeight: 0.7,
    computedCard: undefined,
};

const CARD: IndicatorGuideResult = {
    indicatorName: 'RSI Signal Guide',
    signals: [
        {
            type: 'skill',
            description: 'RSI Signal Guide: rsi_oversold.',
            trend: 'bullish',
            strength: 'strong',
            reading: RSI_READING,
        },
    ],
};

const CYCLE_CARD: RawStrategyResult = {
    strategyName: 'MA Cycle Strategy',
    trend: 'bearish',
    summary: 'MA cycle (MA5/MA20/MA60): stage 4',
    candidateIds: [],
    cycle: CYCLE,
};

const rawReply = (extra: Record<string, unknown> = {}) => ({
    summary: '분석 요약',
    trend: 'neutral',
    indicatorResults: [
        {
            indicatorName: 'RSI Signal Guide',
            signals: [
                {
                    type: 'skill',
                    description: 'the model wrote this',
                    trend: 'bearish',
                    strength: 'weak',
                    reading: RSI_READING,
                },
            ],
        },
    ],
    riskLevel: 'low',
    keyLevels: { support: [], resistance: [] },
    priceTargets: { bullish: null, bearish: null },
    patternSummaries: [],
    strategyResults: [
        {
            strategyName: 'MA Cycle Strategy',
            trend: 'bullish',
            summary: 'the model wrote the cycle card',
            cycle: CYCLE,
        },
        {
            strategyName: 'Fibonacci Strategy',
            trend: 'neutral',
            summary: 'fib',
        },
    ],
    candlePatterns: [],
    ...extra,
});

describe('enrichAnalysisWithConfidence with the cards computed in code', () => {
    const skills = [CYCLE_SKILL, FIB_SKILL];

    it('keeps the model entries as before when asked for nothing, but never takes a reading or a cycle from the model', () => {
        const out = enrichAnalysisWithConfidence(rawReply(), skills);
        expect(out.indicatorResults[0].signals[0].reading).toBeUndefined();
        expect(out.indicatorResults[0].signals[0].description).toBe(
            'the model wrote this'
        );
        expect(out.strategyResults.map(s => s.strategyName)).toEqual([
            'MA Cycle Strategy',
            'Fibonacci Strategy',
        ]);
        expect(out.strategyResults.every(s => s.cycle === undefined)).toBe(
            true
        );
    });

    it('with withoutModelCards drops the model indicatorResults and the entry of every computed-card skill', () => {
        const out = enrichAnalysisWithConfidence(
            rawReply(),
            skills,
            undefined,
            {
                withoutModelCards: true,
            }
        );
        expect(out.indicatorResults).toEqual([]);
        expect(out.strategyResults.map(s => s.strategyName)).toEqual([
            'Fibonacci Strategy',
        ]);
        expect(out.strategyResults[0].id).toBe('Fibonacci Strategy_0');
    });
});

describe('attachComputedCards', () => {
    const skills = [CYCLE_SKILL, FIB_SKILL];
    const model = enrichAnalysisWithConfidence(rawReply(), skills, undefined, {
        withoutModelCards: true,
    });

    it('sets indicatorResults and appends the cycle cards after the model strategies, with the skill weight and an id', () => {
        const out = attachComputedCards(
            model,
            { indicatorResults: [CARD], strategyResults: [CYCLE_CARD] },
            skills
        );
        expect(out.indicatorResults).toEqual([CARD]);
        expect(out.strategyResults.map(s => s.strategyName)).toEqual([
            'Fibonacci Strategy',
            'MA Cycle Strategy',
        ]);
        expect(out.strategyResults[1]).toMatchObject({
            id: 'MA Cycle Strategy_0',
            confidenceWeight: 0.55,
            cycle: CYCLE,
        });
        expect(out.summary).toBe(model.summary);
    });

    it('numbers a card after earlier cards of the same name, across patterns and strategies', () => {
        const withEarlier: AnalysisResponse = {
            ...model,
            strategyResults: [
                ...model.strategyResults,
                {
                    id: 'MA Cycle Strategy_0',
                    strategyName: 'MA Cycle Strategy',
                    trend: 'neutral',
                    summary: 's',
                    confidenceWeight: 0.1,
                },
            ],
        };
        const out = attachComputedCards(
            withEarlier,
            { indicatorResults: [], strategyResults: [CYCLE_CARD] },
            skills
        );
        expect(out.strategyResults.at(-1)?.id).toBe('MA Cycle Strategy_1');
    });

    it('uses the unmatched weight for a card whose skill is not in the list', () => {
        const out = attachComputedCards(
            model,
            { indicatorResults: [], strategyResults: [CYCLE_CARD] },
            []
        );
        expect(out.strategyResults.at(-1)?.confidenceWeight).toBeLessThan(0.55);
    });

    it('is not what decides the empty fallback: an analysis with cards is no longer one', () => {
        const fallback = enrichAnalysisWithConfidence({}, skills, undefined, {
            withoutModelCards: true,
        });
        expect(isFallbackAnalysis(fallback)).toBe(true);
        expect(
            isFallbackAnalysis(
                attachComputedCards(
                    fallback,
                    { indicatorResults: [CARD], strategyResults: [CYCLE_CARD] },
                    skills
                )
            )
        ).toBe(false);
    });
});

describe('normalizeCachedAnalysisResponse keeps the computed cards', () => {
    const stored = (): Record<string, unknown> => ({
        summary: 's',
        trend: 'neutral',
        indicatorResults: [CARD],
        riskLevel: 'low',
        keyLevels: { support: [], resistance: [] },
        priceTargets: { bullish: null, bearish: null },
        patternSummaries: [],
        strategyResults: [
            {
                id: 'MA Cycle Strategy_0',
                ...CYCLE_CARD,
                confidenceWeight: 0.55,
            },
        ],
        candlePatterns: [],
        trendlines: [],
    });

    it('keeps the reading of a signal and the cycle of a strategy card', () => {
        const out = normalizeCachedAnalysisResponse(
            JSON.parse(JSON.stringify(stored()))
        );
        expect(out.indicatorResults[0].signals[0].reading).toEqual(RSI_READING);
        expect(out.indicatorResults[0].signals[0].strength).toBe('strong');
        expect(out.strategyResults[0].cycle).toEqual(CYCLE);
    });

    it('drops an invalid reading and keeps the entry and its other fields', () => {
        const entry = stored();
        entry.indicatorResults = [
            {
                ...CARD,
                signals: [
                    {
                        ...CARD.signals[0],
                        reading: { ...RSI_READING, kind: 'zzz' },
                    },
                ],
            },
        ];
        entry.strategyResults = [
            {
                id: 'x_0',
                ...CYCLE_CARD,
                confidenceWeight: 0.5,
                cycle: { ...CYCLE, stage: 9 },
            },
        ];
        const out = normalizeCachedAnalysisResponse(entry);
        expect(out.indicatorResults).toHaveLength(1);
        expect(out.indicatorResults[0].signals[0].description).toBe(
            'RSI Signal Guide: rsi_oversold.'
        );
        expect(out.indicatorResults[0].signals[0].reading).toBeUndefined();
        expect(out.strategyResults[0].summary).toBe(CYCLE_CARD.summary);
        expect(out.strategyResults[0].cycle).toBeUndefined();
    });

    it('reads an entry cached before the fields existed as before', () => {
        const old = stored();
        old.indicatorResults = [
            {
                indicatorName: 'RSI Signal Guide',
                signals: [
                    { type: 'skill', description: '과매도', trend: 'bullish' },
                ],
            },
        ];
        const out = normalizeCachedAnalysisResponse(old);
        expect(out.indicatorResults[0].signals[0]).toEqual({
            type: 'skill',
            description: '과매도',
            trend: 'bullish',
            strength: undefined,
        });
    });
});
