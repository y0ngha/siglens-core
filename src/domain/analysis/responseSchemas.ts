import type { ResponseJsonSchema } from '@/domain/types';

/**
 * Canonical JSON Schemas for the structured-output analysis responses.
 *
 * Each schema follows OpenAI strict `json_schema` conventions — every key of
 * `properties` also appears in `required` and `additionalProperties` is `false`.
 * A TS `string | null` field is modelled as `type: ['string', 'null']`, and an
 * optional `field?: T` is modelled as nullable for the same reason.
 *
 * @see ResponseJsonSchema
 */

/**
 * Shared `string` enum schema for the three sentiment-direction unions
 * (`NewsSentiment`, `FundamentalSentiment`, `OverallScenarioName`), which
 * currently share the same `'bullish' | 'neutral' | 'bearish'` values. Reused at
 * all five sentiment sites; sharing one object reference is safe because JSON
 * serialization handles shared refs.
 */
const SENTIMENT_SCHEMA = {
    type: 'string',
    enum: ['bullish', 'neutral', 'bearish'],
} as const;

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
        sentiment: SENTIMENT_SCHEMA,
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
        overallSentiment: SENTIMENT_SCHEMA,
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
                    sentiment: SENTIMENT_SCHEMA,
                    rationaleKo: { type: 'string' },
                },
                required: ['category', 'sentiment', 'rationaleKo'],
                additionalProperties: false,
            },
        },
        riskFactorsKo: { type: 'array', items: { type: 'string' } },
        overallSentiment: SENTIMENT_SCHEMA,
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
 * Structured-output schema for the financials (multi-year statement) analysis response
 * (analysisType `financials`). `axisAssessments` is an array of nested objects covering
 * four statement axes: growth, quality, solvency, and cash generation.
 */
export const FINANCIALS_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        overallConclusionKo: { type: 'string' },
        axisAssessments: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    axis: {
                        type: 'string',
                        enum: ['growth', 'quality', 'solvency', 'cash'],
                    },
                    sentiment: SENTIMENT_SCHEMA,
                    rationaleKo: { type: 'string' },
                },
                required: ['axis', 'sentiment', 'rationaleKo'],
                additionalProperties: false,
            },
        },
        riskFactorsKo: { type: 'array', items: { type: 'string' } },
        overallSentiment: SENTIMENT_SCHEMA,
    },
    required: [
        'overallConclusionKo',
        'axisAssessments',
        'riskFactorsKo',
        'overallSentiment',
    ],
    additionalProperties: false,
} as const satisfies ResponseJsonSchema;

/**
 * @internal
 * Structured-output schema for the congressional-trade trend analysis response
 * (analysisType `congress`). A flat object: a Korean summary paragraph, an array
 * of notable-member/trade descriptions, a Korean risk note (disclosure-lag
 * caveats), and an overall directional sentiment.
 */
export const CONGRESS_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        summaryKo: { type: 'string' },
        notableMembersKo: { type: 'array', items: { type: 'string' } },
        riskNoteKo: { type: 'string' },
        overallSentiment: SENTIMENT_SCHEMA,
    },
    required: [
        'summaryKo',
        'notableMembersKo',
        'riskNoteKo',
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
        financialsBulletsKo: { type: 'array', items: { type: 'string' } },
        integratedConclusionKo: { type: 'string' },
        scenarios: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: SENTIMENT_SCHEMA,
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
        'financialsBulletsKo',
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

// --- CHART / technical analysis response schema ---

/**
 * Shared `string` enum schema for the {@link Trend} union
 * (`'bullish' | 'bearish' | 'neutral'`). Reused at every directional-bias site
 * inside the technical response (top-level `trend`, signals, patterns,
 * strategies, candle patterns); sharing one object reference is safe because
 * JSON serialization handles shared refs.
 */
const TREND_SCHEMA = {
    type: 'string',
    enum: ['bullish', 'bearish', 'neutral'],
} as const;

/**
 * Shared schema for {@link TrendlinePoint} (`{ time, price }`), reused by both
 * `trendlines` endpoints and each pattern's `patternLines` endpoints.
 */
const TRENDLINE_POINT_SCHEMA = {
    type: 'object',
    properties: {
        time: { type: 'number' },
        price: { type: 'number' },
    },
    required: ['time', 'price'],
    additionalProperties: false,
} as const;

/**
 * Shared schema for {@link KeyPrice} (`{ label, price }`), used inside each
 * pattern's `keyPrices` array.
 */
const KEY_PRICE_SCHEMA = {
    type: 'object',
    properties: {
        label: { type: 'string' },
        price: { type: 'number' },
    },
    required: ['label', 'price'],
    additionalProperties: false,
} as const;

/**
 * Shared schema for {@link KeyLevel} (`{ price, reason }`), used by the support /
 * resistance arrays and the nullable `poc` field of `keyLevels`.
 */
const KEY_LEVEL_SCHEMA = {
    type: 'object',
    properties: {
        price: { type: 'number' },
        reason: { type: 'string' },
    },
    required: ['price', 'reason'],
    additionalProperties: false,
} as const;

/**
 * Shared schema for {@link PriceScenario} (`{ targets, condition }`), used by the
 * nullable `bullish` / `bearish` sides of `priceTargets`. Each target is a
 * {@link PriceTarget} (`{ price, basis }`).
 */
const PRICE_SCENARIO_SCHEMA = {
    type: ['object', 'null'],
    properties: {
        targets: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    price: { type: 'number' },
                    basis: { type: 'string' },
                },
                required: ['price', 'basis'],
                additionalProperties: false,
            },
        },
        condition: { type: 'string' },
    },
    required: ['targets', 'condition'],
    additionalProperties: false,
} as const;

/**
 * @internal
 * Structured-output schema for {@link AnalysisResponse} — the CHART/technical
 * analysis response (analysisType `technical`).
 *
 * Authored nest-as-is (the response shape is not flattened): every nested
 * object / array-of-object is fully specified recursively with its own
 * `required` / `additionalProperties: false`.
 *
 * Optional TS fields are modelled as nullable so they satisfy strict mode (every
 * `properties` key must appear in `required`), following the same convention as
 * `optionsOiStale` in {@link OVERALL_RESPONSE_SCHEMA}:
 *   - `actionRecommendation?` → nullable object (`type: ['object', 'null']`);
 *   - `signals[].strength?` → nullable string enum;
 *   - pattern `keyPrices?` / `patternLines?` / `timeRange?` / `renderConfig?`,
 *     and every optional `actionRecommendation` field → nullable.
 *
 * `analyzedAt` is intentionally omitted: it is server-set during polling
 * (`pollAnalysis` sets `analyzedAt = now.toISOString()` and spreads it over the
 * reconciled result), so any LLM-supplied value is discarded. Asking the model
 * to produce it would only waste output tokens.
 */
export const TECHNICAL_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        summary: { type: 'string' },
        trend: TREND_SCHEMA,
        indicatorResults: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    indicatorName: { type: 'string' },
                    signals: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                type: { type: 'string', enum: ['skill'] },
                                description: { type: 'string' },
                                strength: {
                                    type: ['string', 'null'],
                                    enum: ['strong', 'moderate', 'weak', null],
                                },
                                trend: TREND_SCHEMA,
                            },
                            required: [
                                'type',
                                'description',
                                'strength',
                                'trend',
                            ],
                            additionalProperties: false,
                        },
                    },
                },
                required: ['indicatorName', 'signals'],
                additionalProperties: false,
            },
        },
        riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
        keyLevels: {
            type: 'object',
            properties: {
                support: { type: 'array', items: KEY_LEVEL_SCHEMA },
                resistance: { type: 'array', items: KEY_LEVEL_SCHEMA },
                poc: { ...KEY_LEVEL_SCHEMA, type: ['object', 'null'] },
            },
            required: ['support', 'resistance', 'poc'],
            additionalProperties: false,
        },
        priceTargets: {
            type: 'object',
            properties: {
                bullish: PRICE_SCENARIO_SCHEMA,
                bearish: PRICE_SCENARIO_SCHEMA,
            },
            required: ['bullish', 'bearish'],
            additionalProperties: false,
        },
        patternSummaries: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    patternName: { type: 'string' },
                    skillName: { type: 'string' },
                    detected: { type: 'boolean' },
                    trend: TREND_SCHEMA,
                    summary: { type: 'string' },
                    keyPrices: {
                        type: ['array', 'null'],
                        items: KEY_PRICE_SCHEMA,
                    },
                    patternLines: {
                        type: ['array', 'null'],
                        items: {
                            type: 'object',
                            properties: {
                                label: { type: 'string' },
                                start: TRENDLINE_POINT_SCHEMA,
                                end: TRENDLINE_POINT_SCHEMA,
                            },
                            required: ['label', 'start', 'end'],
                            additionalProperties: false,
                        },
                    },
                    timeRange: {
                        type: ['object', 'null'],
                        properties: {
                            start: { type: 'number' },
                            end: { type: 'number' },
                        },
                        required: ['start', 'end'],
                        additionalProperties: false,
                    },
                    confidenceWeight: { type: 'number' },
                    renderConfig: {
                        type: ['object', 'null'],
                        properties: {
                            show: { type: 'boolean' },
                            type: {
                                type: 'string',
                                enum: ['line', 'marker', 'region'],
                            },
                            color: { type: 'string' },
                            label: { type: 'string' },
                        },
                        required: ['show', 'type', 'color', 'label'],
                        additionalProperties: false,
                    },
                },
                required: [
                    'id',
                    'patternName',
                    'skillName',
                    'detected',
                    'trend',
                    'summary',
                    'keyPrices',
                    'patternLines',
                    'timeRange',
                    'confidenceWeight',
                    'renderConfig',
                ],
                additionalProperties: false,
            },
        },
        strategyResults: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    strategyName: { type: 'string' },
                    trend: TREND_SCHEMA,
                    summary: { type: 'string' },
                    confidenceWeight: { type: 'number' },
                },
                required: [
                    'id',
                    'strategyName',
                    'trend',
                    'summary',
                    'confidenceWeight',
                ],
                additionalProperties: false,
            },
        },
        candlePatterns: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    patternName: { type: 'string' },
                    detected: { type: 'boolean' },
                    trend: TREND_SCHEMA,
                    summary: { type: 'string' },
                },
                required: ['id', 'patternName', 'detected', 'trend', 'summary'],
                additionalProperties: false,
            },
        },
        trendlines: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    direction: {
                        type: 'string',
                        enum: ['ascending', 'descending'],
                    },
                    start: TRENDLINE_POINT_SCHEMA,
                    end: TRENDLINE_POINT_SCHEMA,
                },
                required: ['direction', 'start', 'end'],
                additionalProperties: false,
            },
        },
        actionRecommendation: {
            type: ['object', 'null'],
            properties: {
                positionAnalysis: { type: 'string' },
                entry: { type: 'string' },
                exit: { type: 'string' },
                riskReward: { type: 'string' },
                entryRecommendation: {
                    type: ['string', 'null'],
                    enum: ['enter', 'wait', 'avoid', null],
                },
                entryPrices: {
                    type: ['array', 'null'],
                    items: { type: 'number' },
                },
                stopLoss: { type: ['number', 'null'] },
                takeProfitPrices: {
                    type: ['array', 'null'],
                    items: { type: 'number' },
                },
                reconciledLevels: {
                    type: ['object', 'null'],
                    properties: {
                        stopLoss: { type: ['number', 'null'] },
                        takeProfitPrices: {
                            type: ['array', 'null'],
                            items: { type: 'number' },
                        },
                        exit: { type: 'string' },
                        riskReward: { type: 'string' },
                        reason: { type: 'string' },
                    },
                    required: [
                        'stopLoss',
                        'takeProfitPrices',
                        'exit',
                        'riskReward',
                        'reason',
                    ],
                    additionalProperties: false,
                },
            },
            required: [
                'positionAnalysis',
                'entry',
                'exit',
                'riskReward',
                'entryRecommendation',
                'entryPrices',
                'stopLoss',
                'takeProfitPrices',
                'reconciledLevels',
            ],
            additionalProperties: false,
        },
    },
    required: [
        'summary',
        'trend',
        'indicatorResults',
        'riskLevel',
        'keyLevels',
        'priceTargets',
        'patternSummaries',
        'strategyResults',
        'candlePatterns',
        'trendlines',
        'actionRecommendation',
    ],
    additionalProperties: false,
} as const satisfies ResponseJsonSchema;
