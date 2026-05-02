import type {
    OverallAnalysisResponse,
    OverallScenario,
    OverallScenarioName,
} from '@/domain/types';
import { extractJsonFromLlmResponse } from './promptFormat';

/** Valid values for the {@link OverallScenarioName} enum. */
const VALID_OVERALL_SCENARIO_NAMES: readonly OverallScenarioName[] = [
    'bullish',
    'neutral',
    'bearish',
];

/**
 * Validate and coerce a raw value to an {@link OverallScenarioName}.
 *
 * @param value - Candidate value from parsed JSON.
 * @param field - Field name used in the thrown error message.
 * @throws {Error} When `value` is not a valid {@link OverallScenarioName}.
 */
function requireOverallScenarioName(
    value: unknown,
    field: string
): OverallScenarioName {
    if (!VALID_OVERALL_SCENARIO_NAMES.includes(value as OverallScenarioName)) {
        throw new Error(
            `Invalid OverallScenarioName for field "${field}": ${String(value)}. ` +
                `Expected one of: ${VALID_OVERALL_SCENARIO_NAMES.join(', ')}`
        );
    }
    // .includes() guard above guarantees value is a valid OverallScenarioName at runtime
    return value as OverallScenarioName;
}

/**
 * Validate and parse a single scenario entry from the raw payload.
 *
 * @param item - Raw item from the `scenarios` array.
 * @param index - Array index used in error messages.
 * @throws {Error} When any required sub-field is missing or invalid.
 */
function parseScenario(item: unknown, index: number): OverallScenario {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(
            `scenarios[${index}] must be an object, got: ${typeof item}`
        );
    }
    const o = item as Record<string, unknown>;

    const name = requireOverallScenarioName(o.name, `scenarios[${index}].name`);

    if (typeof o.triggerConditionKo !== 'string') {
        throw new Error(
            `scenarios[${index}].triggerConditionKo must be a string`
        );
    }
    if (typeof o.priceRangeKo !== 'string') {
        throw new Error(`scenarios[${index}].priceRangeKo must be a string`);
    }

    return {
        name,
        triggerConditionKo: o.triggerConditionKo,
        priceRangeKo: o.priceRangeKo,
    };
}

/**
 * Normalize a raw LLM response string into a typed {@link OverallAnalysisResponse}.
 *
 * Strips optional markdown code fences (` ```json ` / ` ``` `), parses JSON, and
 * validates all required fields and enum values. Throws a descriptive error when
 * the payload is missing required fields or contains invalid scenario name values.
 *
 * @param raw - Raw string from the LLM worker response.
 * @returns A fully-typed {@link OverallAnalysisResponse}.
 * @throws {SyntaxError} When the string is not valid JSON after fence removal.
 * @throws {Error} When required fields are missing or enum values are invalid.
 */
export function normalizeOverallAnalysisResponse(
    raw: string
): OverallAnalysisResponse {
    const parsed = extractJsonFromLlmResponse(raw);

    if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
    ) {
        throw new Error(
            'OverallAnalysisResponse: payload must be a JSON object'
        );
    }
    const o = parsed as Record<string, unknown>;

    if (typeof o.headlineKo !== 'string') {
        throw new Error(
            'OverallAnalysisResponse: missing required field "headlineKo"'
        );
    }
    if (!Array.isArray(o.technicalBulletsKo)) {
        throw new Error(
            'OverallAnalysisResponse: missing required field "technicalBulletsKo"'
        );
    }
    if (!Array.isArray(o.fundamentalBulletsKo)) {
        throw new Error(
            'OverallAnalysisResponse: missing required field "fundamentalBulletsKo"'
        );
    }
    if (!Array.isArray(o.newsBulletsKo)) {
        throw new Error(
            'OverallAnalysisResponse: missing required field "newsBulletsKo"'
        );
    }
    if (typeof o.threeAxisConclusionKo !== 'string') {
        throw new Error(
            'OverallAnalysisResponse: missing required field "threeAxisConclusionKo"'
        );
    }
    if (!Array.isArray(o.scenarios)) {
        throw new Error(
            'OverallAnalysisResponse: missing required field "scenarios"'
        );
    }
    if (!Array.isArray(o.riskFactorsKo)) {
        throw new Error(
            'OverallAnalysisResponse: missing required field "riskFactorsKo"'
        );
    }

    const scenarios = (o.scenarios as unknown[]).map((item, i) =>
        parseScenario(item, i)
    );

    return {
        headlineKo: o.headlineKo,
        technicalBulletsKo: (o.technicalBulletsKo as unknown[]).map(String),
        fundamentalBulletsKo: (o.fundamentalBulletsKo as unknown[]).map(String),
        newsBulletsKo: (o.newsBulletsKo as unknown[]).map(String),
        threeAxisConclusionKo: o.threeAxisConclusionKo,
        scenarios,
        riskFactorsKo: (o.riskFactorsKo as unknown[]).map(String),
    };
}
