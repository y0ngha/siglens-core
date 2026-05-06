import type {
    OverallAnalysisResponse,
    RawOverallAnalysisResponse,
    RawOverallScenario,
    OverallScenario,
    OverallScenarioName,
} from '@/domain/types';
import { asArray, asEnum, asObject, asString, compact } from './normalizePrimitives';
import { extractJsonFromLlmResponse } from './promptFormat';

/** Valid values for the {@link OverallScenarioName} enum. */
const VALID_OVERALL_SCENARIO_NAMES: readonly OverallScenarioName[] = [
    'bullish',
    'neutral',
    'bearish',
];

function parseLlmPayload(raw: unknown): unknown {
    return typeof raw === 'string' ? extractJsonFromLlmResponse(raw) : raw;
}

function normalizeStringArray(raw: unknown): string[] {
    return asArray(raw)
        .map(item => asString(item))
        .filter(item => item.length > 0);
}

function normalizeOverallScenarioName(value: unknown): OverallScenarioName {
    return asEnum(value, VALID_OVERALL_SCENARIO_NAMES, 'neutral');
}

/**
 * Normalize a single scenario entry from the raw payload.
 *
 * @param item - Raw item from the `scenarios` array.
 */
function normalizeScenario(item: unknown): OverallScenario | null {
    const o = asObject(item) as RawOverallScenario | null;
    if (!o) return null;

    return {
        name: normalizeOverallScenarioName(o.name),
        triggerConditionKo: asString(o.triggerConditionKo),
        priceRangeKo: asString(o.priceRangeKo),
    };
}

/**
 * Normalize a raw LLM response string into a typed {@link OverallAnalysisResponse}.
 *
 * Strips optional markdown code fences (` ```json ` / ` ``` `), parses JSON, and
 * defensively normalizes every field. Missing strings become `''`, missing
 * arrays become `[]`, malformed scenario entries are dropped, and invalid
 * scenario names fall back to `"neutral"`.
 *
 * @param raw - Raw string/object from the LLM worker or cache.
 * @returns A fully-typed {@link OverallAnalysisResponse}.
 * @throws {SyntaxError} When the string is not valid JSON after fence removal.
 */
export function normalizeOverallAnalysisResponse(
    raw: unknown
): OverallAnalysisResponse {
    const parsed = parseLlmPayload(raw);
    const o = (asObject(parsed) ?? {}) as RawOverallAnalysisResponse;

    return {
        headlineKo: asString(o.headlineKo),
        technicalBulletsKo: normalizeStringArray(o.technicalBulletsKo),
        fundamentalBulletsKo: normalizeStringArray(o.fundamentalBulletsKo),
        newsBulletsKo: normalizeStringArray(o.newsBulletsKo),
        threeAxisConclusionKo: asString(o.threeAxisConclusionKo),
        scenarios: compact(asArray(o.scenarios).map(normalizeScenario)),
        riskFactorsKo: normalizeStringArray(o.riskFactorsKo),
    };
}
