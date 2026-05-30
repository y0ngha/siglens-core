import type { ResponseJsonSchema } from '@/domain/types';

/**
 * Canonical JSON Schemas for the structured-output analysis responses dispatched
 * to the worker on the `/analyze` body as `responseSchema`.
 *
 * Each schema is authored to be accepted directly by OpenAI strict `json_schema`
 * mode and is translated by the worker into the provider-specific shape (Gemini
 * `responseSchema`, OpenAI `json_schema` strict). Strict mode requires every
 * property to be listed in `required` and `additionalProperties: false`, so a TS
 * `string | null` field is modelled as `type: ['string', 'null']` and an
 * optional `field?: T` is modelled as nullable for the same reason.
 *
 * The CHART/technical analysis response is intentionally excluded — its shape is
 * deeply nested and deferred to a later change.
 *
 * @see ResponseJsonSchema
 */

/**
 * @internal
 * Structured-output schema for {@link NewsCardAnalysis} (analysisType `newsCard`).
 *
 * `bodyKo` is TS `string | null`, modelled as nullable.
 */
export const NEWS_CARD_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        titleKo: { type: 'string' },
        bodyKo: { type: ['string', 'null'] },
        summaryKo: { type: 'string' },
        sentiment: { type: 'string', enum: ['bullish', 'neutral', 'bearish'] },
        category: {
            type: 'string',
            enum: [
                'earnings',
                'm_and_a',
                'guidance',
                'regulation',
                'macro',
                'product',
                'other',
            ],
        },
        priceImpact: {
            type: 'string',
            enum: ['high', 'medium', 'low', 'negligible'],
        },
    },
    required: [
        'titleKo',
        'bodyKo',
        'summaryKo',
        'sentiment',
        'category',
        'priceImpact',
    ],
    additionalProperties: false,
} as const satisfies ResponseJsonSchema;

/**
 * @internal
 * Structured-output schema for {@link NewsAnalysisResponse} (analysisType `news`).
 */
export const NEWS_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        currentDriverKo: { type: 'string' },
        keyEventsKo: { type: 'array', items: { type: 'string' } },
        upcomingEventsKo: { type: 'array', items: { type: 'string' } },
        overallSentiment: {
            type: 'string',
            enum: ['bullish', 'neutral', 'bearish'],
        },
    },
    required: [
        'currentDriverKo',
        'keyEventsKo',
        'upcomingEventsKo',
        'overallSentiment',
    ],
    additionalProperties: false,
} as const satisfies ResponseJsonSchema;

/**
 * @internal
 * Structured-output schema for {@link FundamentalAnalysisResponse}
 * (analysisType `fundamental`). `categoryAssessments` is an array of nested
 * objects, each fully specified with its own `required` / `additionalProperties`.
 */
export const FUNDAMENTAL_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        overallConclusionKo: { type: 'string' },
        categoryAssessments: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    category: {
                        type: 'string',
                        enum: [
                            'valuation',
                            'profitability',
                            'growth',
                            'health',
                            'futureDirection',
                        ],
                    },
                    sentiment: {
                        type: 'string',
                        enum: ['bullish', 'neutral', 'bearish'],
                    },
                    rationaleKo: { type: 'string' },
                },
                required: ['category', 'sentiment', 'rationaleKo'],
                additionalProperties: false,
            },
        },
        riskFactorsKo: { type: 'array', items: { type: 'string' } },
        overallSentiment: {
            type: 'string',
            enum: ['bullish', 'neutral', 'bearish'],
        },
    },
    required: [
        'overallConclusionKo',
        'categoryAssessments',
        'riskFactorsKo',
        'overallSentiment',
    ],
    additionalProperties: false,
} as const satisfies ResponseJsonSchema;

/**
 * @internal
 * Structured-output schema for {@link OverallAnalysisResponse}
 * (analysisType `overall`). `scenarios` is an array of nested objects.
 *
 * `optionsOiStale` is an optional TS field (`optionsOiStale?: boolean`); under
 * strict mode it must still be present, so it is modelled as nullable boolean.
 */
export const OVERALL_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        headlineKo: { type: 'string' },
        technicalBulletsKo: { type: 'array', items: { type: 'string' } },
        fundamentalBulletsKo: { type: 'array', items: { type: 'string' } },
        newsBulletsKo: { type: 'array', items: { type: 'string' } },
        optionsBulletsKo: { type: 'array', items: { type: 'string' } },
        integratedConclusionKo: { type: 'string' },
        scenarios: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        enum: ['bullish', 'neutral', 'bearish'],
                    },
                    triggerConditionKo: { type: 'string' },
                    priceRangeKo: { type: 'string' },
                },
                required: ['name', 'triggerConditionKo', 'priceRangeKo'],
                additionalProperties: false,
            },
        },
        riskFactorsKo: { type: 'array', items: { type: 'string' } },
        optionsOiStale: { type: ['boolean', 'null'] },
    },
    required: [
        'headlineKo',
        'technicalBulletsKo',
        'fundamentalBulletsKo',
        'newsBulletsKo',
        'optionsBulletsKo',
        'integratedConclusionKo',
        'scenarios',
        'riskFactorsKo',
        'optionsOiStale',
    ],
    additionalProperties: false,
} as const satisfies ResponseJsonSchema;

/**
 * @internal
 * Structured-output schema for {@link OptionsAnalysisResponse}
 * (analysisType `options`). `perExpiration` and `signals` are arrays of nested
 * objects.
 *
 * `analyzedAt` is intentionally omitted: it is server-set during normalization
 * (`normalizeOptionsAnalysisResponse`), so any LLM-supplied value is discarded.
 * Asking the model to produce it would only waste output tokens.
 */
export const OPTIONS_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        summary: { type: 'string' },
        perExpiration: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    expirationDate: { type: 'string' },
                    commentary: { type: 'string' },
                    tone: {
                        type: 'string',
                        enum: ['bullish', 'bearish', 'neutral', 'cautious'],
                    },
                },
                required: ['expirationDate', 'commentary', 'tone'],
                additionalProperties: false,
            },
        },
        signals: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    kind: {
                        type: 'string',
                        enum: ['bullish', 'bearish', 'neutral', 'volatility'],
                    },
                    message: { type: 'string' },
                },
                required: ['kind', 'message'],
                additionalProperties: false,
            },
        },
    },
    required: ['summary', 'perExpiration', 'signals'],
    additionalProperties: false,
} as const satisfies ResponseJsonSchema;
