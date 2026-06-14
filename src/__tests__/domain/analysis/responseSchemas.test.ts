import { describe, it, expect } from 'vitest';
import {
    NEWS_CARD_RESPONSE_SCHEMA,
    NEWS_RESPONSE_SCHEMA,
    FUNDAMENTAL_RESPONSE_SCHEMA,
    OVERALL_RESPONSE_SCHEMA,
    OPTIONS_RESPONSE_SCHEMA,
    TECHNICAL_RESPONSE_SCHEMA,
} from '@/domain/analysis/responseSchemas';
import type {
    ActionRecommendation,
    AnalysisResponse,
    AnalysisSignal,
    AnalysisSignalType,
    CandlePatternSummary,
    ChartDisplayType,
    EntryRecommendation,
    FundamentalAnalysisResponse,
    FundamentalCategory,
    FundamentalCategoryAssessment,
    FundamentalSentiment,
    IndicatorGuideResult,
    KeyLevel,
    KeyLevels,
    KeyPrice,
    NewsAnalysisResponse,
    NewsCardAnalysis,
    NewsCategory,
    NewsImpact,
    NewsSentiment,
    OptionsAnalysisResponse,
    OptionsPerExpirationCommentary,
    OptionsSignal,
    OptionsSignalKind,
    OptionsTone,
    OverallAnalysisResponse,
    OverallScenario,
    OverallScenarioName,
    PatternLine,
    PatternResult,
    PriceScenario,
    PriceTarget,
    PriceTargets,
    ReconciledActionLevels,
    RiskLevel,
    ResponseJsonSchema,
    SignalStrength,
    StrategyResult,
    Trend,
    Trendline,
    TrendlineDirection,
    TrendlinePoint,
} from '@/domain/types';

/**
 * Drift guard helpers.
 *
 * The fixtures below are typed as the actual response interfaces, so TS forces
 * each fixture to carry exactly the interface's required keys. If an interface
 * gains or loses a field, the fixture stops compiling — and the key-set
 * assertions below then break until the schema is updated to match.
 */
const sortedKeys = (obj: object): string[] => Object.keys(obj).toSorted();

const sortedRequired = (schema: ResponseJsonSchema): string[] =>
    schema.required.toSorted();

const propertyKeys = (schema: ResponseJsonSchema): string[] =>
    Object.keys(schema.properties).toSorted();

type NestedSchema = {
    type: 'array';
    items: ResponseJsonSchema;
};

const nestedItems = (
    schema: ResponseJsonSchema,
    key: string
): ResponseJsonSchema => {
    const prop = schema.properties[key] as NestedSchema;
    return prop.items;
};

/**
 * Returns a property's sub-schema as a navigable {@link ResponseJsonSchema}.
 * Used to recurse into nested object-typed properties (e.g. `keyLevels`,
 * `priceTargets`, `actionRecommendation`) whose `type` may be a plain
 * `'object'` or the nullable `['object', 'null']` union.
 */
const objectProp = (
    schema: ResponseJsonSchema,
    key: string
): ResponseJsonSchema => schema.properties[key] as ResponseJsonSchema;

/** Reads the (possibly-union) `type` of a property as a sorted string array. */
const propType = (schema: ResponseJsonSchema, key: string): string[] => {
    const prop = schema.properties[key] as { type: string | readonly string[] };
    return (
        Array.isArray(prop.type) ? [...prop.type] : [prop.type as string]
    ).toSorted();
};

const enumValues = (schema: ResponseJsonSchema, key: string): string[] => {
    const prop = schema.properties[key] as { enum: readonly string[] };
    return prop.enum.toSorted();
};

const nestedEnumValues = (
    itemSchema: ResponseJsonSchema,
    key: string
): string[] => {
    const prop = itemSchema.properties[key] as { enum: readonly string[] };
    return prop.enum.toSorted();
};

/**
 * Reads a nullable enum (`type: ['string', 'null']`) and splits its members into
 * the non-null values (sorted) plus whether `null` is present. A nullable enum
 * must include `null` so the value can actually be null — otherwise the enum
 * contradicts its nullable type. The non-null values are compared against the
 * union's exhaustiveness set.
 */
const nullableEnumValues = (
    itemSchema: ResponseJsonSchema,
    key: string
): { values: string[]; includesNull: boolean } => {
    const prop = itemSchema.properties[key] as {
        enum: readonly (string | null)[];
    };
    return {
        values: prop.enum.filter((v): v is string => v !== null).toSorted(),
        includesNull: prop.enum.includes(null),
    };
};

// Expected enum value sets, encoded inline from the union definitions.

// bullish/neutral/bearish is shared by all three sentiment unions today. Keying a
// Record by each union forces a compile error here if any union gains/loses a
// member, so one shared expected-set stays correct (and the schema must follow).
const SENTIMENT_VALUES = Object.keys({
    bullish: true,
    neutral: true,
    bearish: true,
} satisfies Record<NewsSentiment, true> &
    Record<FundamentalSentiment, true> &
    Record<OverallScenarioName, true>).toSorted();

const NEWS_CATEGORY = Object.keys({
    earnings: true,
    m_and_a: true,
    guidance: true,
    regulation: true,
    macro: true,
    product: true,
    other: true,
} satisfies Record<NewsCategory, true>).toSorted();
const NEWS_IMPACT = Object.keys({
    high: true,
    medium: true,
    low: true,
    negligible: true,
} satisfies Record<NewsImpact, true>).toSorted();
const FUNDAMENTAL_CATEGORY = Object.keys({
    valuation: true,
    profitability: true,
    growth: true,
    health: true,
    futureDirection: true,
} satisfies Record<FundamentalCategory, true>).toSorted();
const OPTIONS_TONE = Object.keys({
    bullish: true,
    bearish: true,
    neutral: true,
    cautious: true,
} satisfies Record<OptionsTone, true>).toSorted();
const OPTIONS_SIGNAL_KIND = Object.keys({
    bullish: true,
    bearish: true,
    neutral: true,
    volatility: true,
} satisfies Record<OptionsSignalKind, true>).toSorted();

// --- Technical-response expected enum value sets ---
const TREND_VALUES = Object.keys({
    bullish: true,
    bearish: true,
    neutral: true,
} satisfies Record<Trend, true>).toSorted();
const RISK_LEVEL_VALUES = Object.keys({
    low: true,
    medium: true,
    high: true,
} satisfies Record<RiskLevel, true>).toSorted();
const SIGNAL_TYPE_VALUES = Object.keys({
    skill: true,
} satisfies Record<AnalysisSignalType, true>).toSorted();
const SIGNAL_STRENGTH_VALUES = Object.keys({
    strong: true,
    moderate: true,
    weak: true,
} satisfies Record<SignalStrength, true>).toSorted();
const CHART_DISPLAY_TYPE_VALUES = Object.keys({
    line: true,
    marker: true,
    region: true,
} satisfies Record<ChartDisplayType, true>).toSorted();
const TRENDLINE_DIRECTION_VALUES = Object.keys({
    ascending: true,
    descending: true,
} satisfies Record<TrendlineDirection, true>).toSorted();
const ENTRY_RECOMMENDATION_VALUES = Object.keys({
    enter: true,
    wait: true,
    avoid: true,
} satisfies Record<EntryRecommendation, true>).toSorted();

describe('responseSchemas — strict-mode invariants', () => {
    const all = [
        {
            name: 'NEWS_CARD_RESPONSE_SCHEMA',
            schema: NEWS_CARD_RESPONSE_SCHEMA,
        },
        { name: 'NEWS_RESPONSE_SCHEMA', schema: NEWS_RESPONSE_SCHEMA },
        {
            name: 'FUNDAMENTAL_RESPONSE_SCHEMA',
            schema: FUNDAMENTAL_RESPONSE_SCHEMA,
        },
        { name: 'OVERALL_RESPONSE_SCHEMA', schema: OVERALL_RESPONSE_SCHEMA },
        { name: 'OPTIONS_RESPONSE_SCHEMA', schema: OPTIONS_RESPONSE_SCHEMA },
        {
            name: 'TECHNICAL_RESPONSE_SCHEMA',
            schema: TECHNICAL_RESPONSE_SCHEMA,
        },
    ] satisfies { name: string; schema: ResponseJsonSchema }[];

    it.each(all)(
        '$name: lists every property in required and forbids additionalProperties',
        ({ schema }) => {
            expect(schema.type).toBe('object');
            expect(schema.additionalProperties).toBe(false);
            // Strict mode: required must enumerate exactly the property keys.
            expect(sortedRequired(schema)).toEqual(propertyKeys(schema));
        }
    );
});

describe('NEWS_CARD_RESPONSE_SCHEMA drift guard', () => {
    const sample: Required<NewsCardAnalysis> = {
        titleKo: '제목',
        bodyKo: null,
        summaryKo: '요약',
        sentiment: 'bullish',
        category: 'earnings',
        priceImpact: 'high',
    };

    it('schema key-set matches the response interface', () => {
        expect(sortedRequired(NEWS_CARD_RESPONSE_SCHEMA)).toEqual(
            sortedKeys(sample)
        );
        expect(propertyKeys(NEWS_CARD_RESPONSE_SCHEMA)).toEqual(
            sortedKeys(sample)
        );
    });

    it('enum fields match their union value sets', () => {
        expect(enumValues(NEWS_CARD_RESPONSE_SCHEMA, 'sentiment')).toEqual(
            SENTIMENT_VALUES
        );
        expect(enumValues(NEWS_CARD_RESPONSE_SCHEMA, 'category')).toEqual(
            NEWS_CATEGORY
        );
        expect(enumValues(NEWS_CARD_RESPONSE_SCHEMA, 'priceImpact')).toEqual(
            NEWS_IMPACT
        );
    });

    it('models the nullable bodyKo field as a string|null union', () => {
        const prop = NEWS_CARD_RESPONSE_SCHEMA.properties.bodyKo as {
            type: readonly string[];
        };
        expect(prop.type.toSorted()).toEqual(['null', 'string']);
    });
});

describe('NEWS_RESPONSE_SCHEMA drift guard', () => {
    const sample: Required<NewsAnalysisResponse> = {
        currentDriverKo: '드라이버',
        keyEventsKo: ['이벤트'],
        upcomingEventsKo: ['예정'],
        overallSentiment: 'neutral',
    };

    it('schema key-set matches the response interface', () => {
        expect(sortedRequired(NEWS_RESPONSE_SCHEMA)).toEqual(
            sortedKeys(sample)
        );
        expect(propertyKeys(NEWS_RESPONSE_SCHEMA)).toEqual(sortedKeys(sample));
    });

    it('enum fields match their union value sets', () => {
        expect(enumValues(NEWS_RESPONSE_SCHEMA, 'overallSentiment')).toEqual(
            SENTIMENT_VALUES
        );
    });
});

describe('FUNDAMENTAL_RESPONSE_SCHEMA drift guard', () => {
    const nestedSample: FundamentalCategoryAssessment = {
        category: 'valuation',
        sentiment: 'bullish',
        rationaleKo: '근거',
    };
    const sample: Required<FundamentalAnalysisResponse> = {
        overallConclusionKo: '결론',
        categoryAssessments: [nestedSample],
        riskFactorsKo: ['리스크'],
        overallSentiment: 'bearish',
    };

    it('schema key-set matches the response interface', () => {
        expect(sortedRequired(FUNDAMENTAL_RESPONSE_SCHEMA)).toEqual(
            sortedKeys(sample)
        );
        expect(propertyKeys(FUNDAMENTAL_RESPONSE_SCHEMA)).toEqual(
            sortedKeys(sample)
        );
    });

    it('nested categoryAssessments schema matches the nested interface', () => {
        const item = nestedItems(
            FUNDAMENTAL_RESPONSE_SCHEMA,
            'categoryAssessments'
        );
        expect(sortedRequired(item)).toEqual(sortedKeys(nestedSample));
        expect(propertyKeys(item)).toEqual(sortedKeys(nestedSample));
        expect(item.additionalProperties).toBe(false);
        expect(nestedEnumValues(item, 'category')).toEqual(
            FUNDAMENTAL_CATEGORY
        );
        expect(nestedEnumValues(item, 'sentiment')).toEqual(SENTIMENT_VALUES);
    });

    it('top-level enum fields match their union value sets', () => {
        expect(
            enumValues(FUNDAMENTAL_RESPONSE_SCHEMA, 'overallSentiment')
        ).toEqual(SENTIMENT_VALUES);
    });
});

describe('OVERALL_RESPONSE_SCHEMA drift guard', () => {
    const nestedSample: OverallScenario = {
        name: 'bullish',
        triggerConditionKo: '조건',
        priceRangeKo: '범위',
    };
    // Required<> forces optionsOiStale (an OPTIONAL field) into the fixture, so
    // its key is part of the key-set comparison and cannot silently drift away
    // from the nullable schema property under strict mode.
    const sample: Required<OverallAnalysisResponse> = {
        headlineKo: '헤드라인',
        technicalBulletsKo: ['기술'],
        fundamentalBulletsKo: ['펀더'],
        newsBulletsKo: ['뉴스'],
        optionsBulletsKo: ['옵션'],
        financialsBulletsKo: [],
        integratedConclusionKo: '종합',
        scenarios: [nestedSample],
        riskFactorsKo: ['리스크'],
        optionsOiStale: false,
    };

    it('schema key-set matches the response interface', () => {
        expect(sortedRequired(OVERALL_RESPONSE_SCHEMA)).toEqual(
            sortedKeys(sample)
        );
        expect(propertyKeys(OVERALL_RESPONSE_SCHEMA)).toEqual(
            sortedKeys(sample)
        );
    });

    it('models the optional optionsOiStale field as a boolean|null union', () => {
        const prop = OVERALL_RESPONSE_SCHEMA.properties.optionsOiStale as {
            type: readonly string[];
        };
        expect(prop.type.toSorted()).toEqual(['boolean', 'null']);
    });

    it('nested scenarios schema matches the nested interface', () => {
        const item = nestedItems(OVERALL_RESPONSE_SCHEMA, 'scenarios');
        expect(sortedRequired(item)).toEqual(sortedKeys(nestedSample));
        expect(propertyKeys(item)).toEqual(sortedKeys(nestedSample));
        expect(item.additionalProperties).toBe(false);
        expect(nestedEnumValues(item, 'name')).toEqual(SENTIMENT_VALUES);
    });
});

describe('OPTIONS_RESPONSE_SCHEMA drift guard', () => {
    const perExpSample: OptionsPerExpirationCommentary = {
        expirationDate: '2026-06-19',
        commentary: '코멘트',
        tone: 'bullish',
    };
    const signalSample: OptionsSignal = {
        kind: 'volatility',
        message: '신호',
    };
    const sample: Required<OptionsAnalysisResponse> = {
        summary: '요약',
        perExpiration: [perExpSample],
        signals: [signalSample],
        analyzedAt: '2026-05-30T00:00:00Z',
    };

    // `analyzedAt` is server-set during normalization and intentionally absent
    // from the schema (the LLM is never asked to produce it), so the expected
    // LLM-output key-set is the response's keys minus `analyzedAt`. Adding any
    // NEW non-server field to OptionsAnalysisResponse still fails this test
    // until the schema adds it.
    const expectedLlmKeys = Object.keys(sample)
        .filter(key => key !== 'analyzedAt')
        .toSorted();

    it('schema key-set matches the response interface (minus server-set analyzedAt)', () => {
        expect(sortedRequired(OPTIONS_RESPONSE_SCHEMA)).toEqual(
            expectedLlmKeys
        );
        expect(propertyKeys(OPTIONS_RESPONSE_SCHEMA)).toEqual(expectedLlmKeys);
    });

    it('nested perExpiration schema matches the nested interface', () => {
        const item = nestedItems(OPTIONS_RESPONSE_SCHEMA, 'perExpiration');
        expect(sortedRequired(item)).toEqual(sortedKeys(perExpSample));
        expect(propertyKeys(item)).toEqual(sortedKeys(perExpSample));
        expect(item.additionalProperties).toBe(false);
        expect(nestedEnumValues(item, 'tone')).toEqual(OPTIONS_TONE);
    });

    it('nested signals schema matches the nested interface', () => {
        const item = nestedItems(OPTIONS_RESPONSE_SCHEMA, 'signals');
        expect(sortedRequired(item)).toEqual(sortedKeys(signalSample));
        expect(propertyKeys(item)).toEqual(sortedKeys(signalSample));
        expect(item.additionalProperties).toBe(false);
        expect(nestedEnumValues(item, 'kind')).toEqual(OPTIONS_SIGNAL_KIND);
    });
});

describe('TECHNICAL_RESPONSE_SCHEMA drift guard', () => {
    // Each nested fixture is typed as its full interface and supplies every
    // OPTIONAL field too, so the schema must model those keys (nullable under
    // strict mode) or the key-set comparisons below fail.
    const signalSample: Required<AnalysisSignal> = {
        type: 'skill',
        description: '설명',
        strength: 'strong',
        trend: 'bullish',
    };
    const indicatorSample: IndicatorGuideResult = {
        indicatorName: 'RSI',
        signals: [signalSample],
    };
    const keyLevelSample: KeyLevel = { price: 100, reason: '근거' };
    const keyLevelsSample: Required<KeyLevels> = {
        support: [keyLevelSample],
        resistance: [keyLevelSample],
        poc: keyLevelSample,
    };
    const priceTargetSample: PriceTarget = { price: 110, basis: '측정' };
    const priceScenarioSample: PriceScenario = {
        targets: [priceTargetSample],
        condition: '돌파',
    };
    const priceTargetsSample: PriceTargets = {
        bullish: priceScenarioSample,
        bearish: priceScenarioSample,
    };
    const keyPriceSample: KeyPrice = { label: '넥라인', price: 150 };
    const patternLineSample: PatternLine = {
        label: '상단',
        start: { time: 1, price: 10 },
        end: { time: 2, price: 20 },
    };
    const patternSample: Required<PatternResult> = {
        id: 'p1',
        patternName: 'head_and_shoulders',
        skillName: 'hns',
        detected: true,
        trend: 'bearish',
        summary: '요약',
        keyPrices: [keyPriceSample],
        patternLines: [patternLineSample],
        timeRange: { start: 1, end: 2 },
        confidenceWeight: 0.8,
        renderConfig: {
            show: true,
            type: 'line',
            color: '#fff',
            label: '라벨',
        },
    };
    const strategySample: StrategyResult = {
        id: 's1',
        strategyName: 'trend-follow',
        trend: 'bullish',
        summary: '요약',
        confidenceWeight: 0.5,
    };
    const candleSample: CandlePatternSummary = {
        id: 'c1',
        patternName: 'hammer',
        detected: true,
        trend: 'bullish',
        summary: '요약',
    };
    const trendlinePointSample: TrendlinePoint = { time: 1, price: 10 };
    const trendlineSample: Trendline = {
        direction: 'ascending',
        start: trendlinePointSample,
        end: { time: 2, price: 20 },
    };
    const reconciledSample: Required<ReconciledActionLevels> = {
        stopLoss: 95,
        takeProfitPrices: [120],
        exit: '청산',
        riskReward: '1:2',
        reason: '보정',
    };
    const actionSample: Required<ActionRecommendation> = {
        positionAnalysis: '포지션',
        entry: '진입',
        exit: '청산',
        riskReward: '1:2',
        entryRecommendation: 'enter',
        entryPrices: [100],
        stopLoss: 95,
        takeProfitPrices: [120],
        reconciledLevels: reconciledSample,
    };
    const sample: Required<AnalysisResponse> = {
        summary: '요약',
        trend: 'bullish',
        indicatorResults: [indicatorSample],
        riskLevel: 'medium',
        keyLevels: keyLevelsSample,
        priceTargets: priceTargetsSample,
        patternSummaries: [patternSample],
        strategyResults: [strategySample],
        candlePatterns: [candleSample],
        trendlines: [trendlineSample],
        actionRecommendation: actionSample,
        analyzedAt: '2026-05-30T00:00:00Z',
    };

    // `analyzedAt` is server-set during polling (pollAnalysis overwrites it with
    // now.toISOString()) and intentionally absent from the schema, so the
    // expected LLM-output key-set is the response's keys minus `analyzedAt`.
    const expectedLlmKeys = Object.keys(sample)
        .filter(key => key !== 'analyzedAt')
        .toSorted();

    it('top-level key-set matches the response interface (minus server-set analyzedAt)', () => {
        expect(sortedRequired(TECHNICAL_RESPONSE_SCHEMA)).toEqual(
            expectedLlmKeys
        );
        expect(propertyKeys(TECHNICAL_RESPONSE_SCHEMA)).toEqual(
            expectedLlmKeys
        );
    });

    it('top-level enum fields match their union value sets', () => {
        expect(enumValues(TECHNICAL_RESPONSE_SCHEMA, 'trend')).toEqual(
            TREND_VALUES
        );
        expect(enumValues(TECHNICAL_RESPONSE_SCHEMA, 'riskLevel')).toEqual(
            RISK_LEVEL_VALUES
        );
    });

    it('nested indicatorResults + signals schemas match their interfaces', () => {
        const indicator = nestedItems(
            TECHNICAL_RESPONSE_SCHEMA,
            'indicatorResults'
        );
        expect(sortedRequired(indicator)).toEqual(sortedKeys(indicatorSample));
        expect(propertyKeys(indicator)).toEqual(sortedKeys(indicatorSample));
        expect(indicator.additionalProperties).toBe(false);

        const signal = nestedItems(indicator, 'signals');
        expect(sortedRequired(signal)).toEqual(sortedKeys(signalSample));
        expect(propertyKeys(signal)).toEqual(sortedKeys(signalSample));
        expect(signal.additionalProperties).toBe(false);
        expect(nestedEnumValues(signal, 'type')).toEqual(SIGNAL_TYPE_VALUES);
        // optional strength → nullable string enum: enum must include null so it
        // matches the nullable type, with the non-null values equal to the union.
        const strengthEnum = nullableEnumValues(signal, 'strength');
        expect(strengthEnum.includesNull).toBe(true);
        expect(strengthEnum.values).toEqual(SIGNAL_STRENGTH_VALUES);
        expect(nestedEnumValues(signal, 'trend')).toEqual(TREND_VALUES);
        expect(propType(signal, 'strength')).toEqual(['null', 'string']);
    });

    it('nested keyLevels schema matches the interface (poc nullable)', () => {
        const keyLevels = objectProp(TECHNICAL_RESPONSE_SCHEMA, 'keyLevels');
        expect(sortedRequired(keyLevels)).toEqual(sortedKeys(keyLevelsSample));
        expect(propertyKeys(keyLevels)).toEqual(sortedKeys(keyLevelsSample));
        expect(keyLevels.additionalProperties).toBe(false);
        // optional poc → nullable object
        expect(propType(keyLevels, 'poc')).toEqual(['null', 'object']);

        const support = nestedItems(keyLevels, 'support');
        expect(sortedRequired(support)).toEqual(sortedKeys(keyLevelSample));
        expect(propertyKeys(support)).toEqual(sortedKeys(keyLevelSample));
        expect(support.additionalProperties).toBe(false);
    });

    it('nested priceTargets + scenario schemas match the interfaces (sides nullable)', () => {
        const priceTargets = objectProp(
            TECHNICAL_RESPONSE_SCHEMA,
            'priceTargets'
        );
        expect(sortedRequired(priceTargets)).toEqual(
            sortedKeys(priceTargetsSample)
        );
        expect(propertyKeys(priceTargets)).toEqual(
            sortedKeys(priceTargetsSample)
        );
        expect(priceTargets.additionalProperties).toBe(false);

        const bullish = objectProp(priceTargets, 'bullish');
        // nullable scenario
        expect(propType(priceTargets, 'bullish')).toEqual(['null', 'object']);
        expect(sortedRequired(bullish)).toEqual(
            sortedKeys(priceScenarioSample)
        );
        expect(propertyKeys(bullish)).toEqual(sortedKeys(priceScenarioSample));
        expect(bullish.additionalProperties).toBe(false);

        const target = nestedItems(bullish, 'targets');
        expect(sortedRequired(target)).toEqual(sortedKeys(priceTargetSample));
        expect(propertyKeys(target)).toEqual(sortedKeys(priceTargetSample));
        expect(target.additionalProperties).toBe(false);
    });

    it('nested patternSummaries schema matches the interface (optionals nullable)', () => {
        const pattern = nestedItems(
            TECHNICAL_RESPONSE_SCHEMA,
            'patternSummaries'
        );
        expect(sortedRequired(pattern)).toEqual(sortedKeys(patternSample));
        expect(propertyKeys(pattern)).toEqual(sortedKeys(patternSample));
        expect(pattern.additionalProperties).toBe(false);
        expect(nestedEnumValues(pattern, 'trend')).toEqual(TREND_VALUES);
        // optional fields → nullable
        expect(propType(pattern, 'keyPrices')).toEqual(['array', 'null']);
        expect(propType(pattern, 'patternLines')).toEqual(['array', 'null']);
        expect(propType(pattern, 'timeRange')).toEqual(['null', 'object']);
        expect(propType(pattern, 'renderConfig')).toEqual(['null', 'object']);

        const keyPrice = nestedItems(pattern, 'keyPrices');
        expect(sortedRequired(keyPrice)).toEqual(sortedKeys(keyPriceSample));
        expect(propertyKeys(keyPrice)).toEqual(sortedKeys(keyPriceSample));
        expect(keyPrice.additionalProperties).toBe(false);

        const patternLine = nestedItems(pattern, 'patternLines');
        expect(sortedRequired(patternLine)).toEqual(
            sortedKeys(patternLineSample)
        );
        expect(propertyKeys(patternLine)).toEqual(
            sortedKeys(patternLineSample)
        );
        expect(patternLine.additionalProperties).toBe(false);

        const timeRange = objectProp(pattern, 'timeRange');
        expect(sortedRequired(timeRange)).toEqual(['end', 'start']);
        expect(propertyKeys(timeRange)).toEqual(['end', 'start']);
        expect(timeRange.additionalProperties).toBe(false);

        const renderConfig = objectProp(pattern, 'renderConfig');
        expect(sortedRequired(renderConfig)).toEqual(
            sortedKeys(patternSample.renderConfig)
        );
        expect(propertyKeys(renderConfig)).toEqual(
            sortedKeys(patternSample.renderConfig)
        );
        expect(renderConfig.additionalProperties).toBe(false);
        expect(nestedEnumValues(renderConfig, 'type')).toEqual(
            CHART_DISPLAY_TYPE_VALUES
        );
    });

    it('nested strategyResults schema matches the interface', () => {
        const strategy = nestedItems(
            TECHNICAL_RESPONSE_SCHEMA,
            'strategyResults'
        );
        expect(sortedRequired(strategy)).toEqual(sortedKeys(strategySample));
        expect(propertyKeys(strategy)).toEqual(sortedKeys(strategySample));
        expect(strategy.additionalProperties).toBe(false);
        expect(nestedEnumValues(strategy, 'trend')).toEqual(TREND_VALUES);
    });

    it('nested candlePatterns schema matches the interface', () => {
        const candle = nestedItems(TECHNICAL_RESPONSE_SCHEMA, 'candlePatterns');
        expect(sortedRequired(candle)).toEqual(sortedKeys(candleSample));
        expect(propertyKeys(candle)).toEqual(sortedKeys(candleSample));
        expect(candle.additionalProperties).toBe(false);
        expect(nestedEnumValues(candle, 'trend')).toEqual(TREND_VALUES);
    });

    it('nested trendlines schema matches the interface', () => {
        const trendline = nestedItems(TECHNICAL_RESPONSE_SCHEMA, 'trendlines');
        expect(sortedRequired(trendline)).toEqual(sortedKeys(trendlineSample));
        expect(propertyKeys(trendline)).toEqual(sortedKeys(trendlineSample));
        expect(trendline.additionalProperties).toBe(false);
        expect(nestedEnumValues(trendline, 'direction')).toEqual(
            TRENDLINE_DIRECTION_VALUES
        );

        const start = objectProp(trendline, 'start');
        expect(sortedRequired(start)).toEqual(sortedKeys(trendlinePointSample));
        expect(propertyKeys(start)).toEqual(sortedKeys(trendlinePointSample));
        expect(start.additionalProperties).toBe(false);
    });

    it('nested actionRecommendation schema matches the interface (nullable object, optionals nullable)', () => {
        // optional top-level field → nullable object
        expect(
            propType(TECHNICAL_RESPONSE_SCHEMA, 'actionRecommendation')
        ).toEqual(['null', 'object']);
        const action = objectProp(
            TECHNICAL_RESPONSE_SCHEMA,
            'actionRecommendation'
        );
        expect(sortedRequired(action)).toEqual(sortedKeys(actionSample));
        expect(propertyKeys(action)).toEqual(sortedKeys(actionSample));
        expect(action.additionalProperties).toBe(false);
        // optional entryRecommendation → nullable string enum: enum must include
        // null so it matches the nullable type, with the non-null values equal to
        // the union.
        const entryRecEnum = nullableEnumValues(action, 'entryRecommendation');
        expect(entryRecEnum.includesNull).toBe(true);
        expect(entryRecEnum.values).toEqual(ENTRY_RECOMMENDATION_VALUES);
        // optional fields → nullable
        expect(propType(action, 'entryRecommendation')).toEqual([
            'null',
            'string',
        ]);
        expect(propType(action, 'entryPrices')).toEqual(['array', 'null']);
        expect(propType(action, 'stopLoss')).toEqual(['null', 'number']);
        expect(propType(action, 'takeProfitPrices')).toEqual(['array', 'null']);
        expect(propType(action, 'reconciledLevels')).toEqual([
            'null',
            'object',
        ]);

        const reconciled = objectProp(action, 'reconciledLevels');
        expect(sortedRequired(reconciled)).toEqual(
            sortedKeys(reconciledSample)
        );
        expect(propertyKeys(reconciled)).toEqual(sortedKeys(reconciledSample));
        expect(reconciled.additionalProperties).toBe(false);
        expect(propType(reconciled, 'stopLoss')).toEqual(['null', 'number']);
        expect(propType(reconciled, 'takeProfitPrices')).toEqual([
            'array',
            'null',
        ]);
    });

    it('every nested object schema lists all properties in required and forbids additionalProperties', () => {
        // Recurse the whole schema tree: every object node must satisfy the
        // strict-mode invariant (required === property keys, additionalProperties
        // false). Falsifiable: drop a key from any `required` and this fails.
        const visit = (node: unknown): void => {
            if (node === null || typeof node !== 'object') return;
            const record = node as Record<string, unknown>;
            const type = record.type;
            const isObject =
                type === 'object' ||
                (Array.isArray(type) && type.includes('object'));
            if (isObject && 'properties' in record) {
                const props = record.properties as Record<string, unknown>;
                const required = record.required as readonly string[];
                expect([...required].toSorted()).toEqual(
                    Object.keys(props).toSorted()
                );
                expect(record.additionalProperties).toBe(false);
                Object.values(props).forEach(visit);
            }
            if ('items' in record) visit(record.items);
        };
        visit(TECHNICAL_RESPONSE_SCHEMA);
    });
});
