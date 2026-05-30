import { describe, it, expect } from 'vitest';
import {
    NEWS_CARD_RESPONSE_SCHEMA,
    NEWS_RESPONSE_SCHEMA,
    FUNDAMENTAL_RESPONSE_SCHEMA,
    OVERALL_RESPONSE_SCHEMA,
    OPTIONS_RESPONSE_SCHEMA,
} from '@/domain/analysis/responseSchemas';
import type {
    FundamentalAnalysisResponse,
    FundamentalCategoryAssessment,
    NewsAnalysisResponse,
    NewsCardAnalysis,
    OptionsAnalysisResponse,
    OptionsPerExpirationCommentary,
    OptionsSignal,
    OverallAnalysisResponse,
    OverallScenario,
    ResponseJsonSchema,
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

// Expected enum value sets, encoded inline from the union definitions.
const NEWS_SENTIMENT = ['bearish', 'bullish', 'neutral'];
const NEWS_CATEGORY = [
    'earnings',
    'guidance',
    'm_and_a',
    'macro',
    'other',
    'product',
    'regulation',
].toSorted();
const NEWS_IMPACT = ['high', 'low', 'medium', 'negligible'];
const FUNDAMENTAL_SENTIMENT = ['bearish', 'bullish', 'neutral'];
const FUNDAMENTAL_CATEGORY = [
    'futureDirection',
    'growth',
    'health',
    'profitability',
    'valuation',
].toSorted();
const OVERALL_SCENARIO_NAME = ['bearish', 'bullish', 'neutral'];
const OPTIONS_TONE = ['bearish', 'bullish', 'cautious', 'neutral'];
const OPTIONS_SIGNAL_KIND = ['bearish', 'bullish', 'neutral', 'volatility'];

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
            NEWS_SENTIMENT
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
            NEWS_SENTIMENT
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
        expect(nestedEnumValues(item, 'sentiment')).toEqual(
            FUNDAMENTAL_SENTIMENT
        );
    });

    it('top-level enum fields match their union value sets', () => {
        expect(
            enumValues(FUNDAMENTAL_RESPONSE_SCHEMA, 'overallSentiment')
        ).toEqual(FUNDAMENTAL_SENTIMENT);
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
        expect(nestedEnumValues(item, 'name')).toEqual(OVERALL_SCENARIO_NAME);
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
