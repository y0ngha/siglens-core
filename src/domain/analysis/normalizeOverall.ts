import type {
    OverallAnalysisResponse,
    RawOverallAnalysisResponse,
    RawOverallScenario,
    OverallScenario,
    OverallScenarioName,
} from '@/domain/types';
import {
    asArray,
    asEnum,
    asObject,
    asString,
    compact,
} from './normalizePrimitives';
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
 * @internal Optional normalization context for
 * {@link normalizeOverallAnalysisResponse}. The `optionsOiStale` value is
 * captured by `runOverallAnalysis` (caller-
 * supplied) and passed back here so the normalizer can attach
 * `optionsOiStale: true` to the response — letting the UI render a "stale OI"
 * badge without the LLM having to remember the flag.
 *
 * Co-located with the consuming function and not re-exported from the package
 * public surface.
 */
export interface NormalizeOverallContext {
    /** When `true`, sets `optionsOiStale: true` on the normalized response. */
    optionsOiStale?: boolean;
}

/**
 * @internal Normalizes the overall-analysis LLM response.
 *
 * Normalize a raw LLM response string into a typed {@link OverallAnalysisResponse}.
 *
 * Strips optional markdown code fences (` ```json ` / ` ``` `), parses JSON, and
 * defensively normalizes every field. Missing strings become `''`, missing
 * arrays become `[]`, malformed scenario entries are dropped, and invalid
 * scenario names fall back to `"neutral"`. Every axis bullet array except
 * `technicalBulletsKo` legitimately may be empty, because the prompt itself
 * instructs the model to leave it empty when that axis reports no data —
 * `fundamentalBulletsKo` (crypto has no corporate fundamentals),
 * `newsBulletsKo` (no news items in the analysis window),
 * `optionsBulletsKo` (axis skipped or no listed options) and
 * `financialsBulletsKo` (no scorecard). For those four the empty-array default
 * is intentional rather than a "missing field" fallback.
 *
 * The optional `context.optionsOiStale` flag, when `true`, is echoed back as
 * the `optionsOiStale: true` field on the response. When `false` (or
 * unspecified), the field is omitted so consumers see `undefined` rather
 * than `false` — kept consistent with the optional-field contract on the
 * `OverallAnalysisResponse` type.
 *
 * @param raw     - Raw string/object from the LLM worker or cache.
 * @param context - Optional normalization context (see {@link NormalizeOverallContext}).
 * @returns A fully-typed {@link OverallAnalysisResponse}.
 * @throws {SyntaxError} When the string is not valid JSON after fence removal.
 */
export function normalizeOverallAnalysisResponse(
    raw: unknown,
    context: NormalizeOverallContext = {}
): OverallAnalysisResponse {
    const parsed = parseLlmPayload(raw);
    const o = (asObject(parsed) ?? {}) as RawOverallAnalysisResponse;

    return {
        headlineKo: asString(o.headlineKo),
        technicalBulletsKo: normalizeStringArray(o.technicalBulletsKo),
        fundamentalBulletsKo: normalizeStringArray(o.fundamentalBulletsKo),
        newsBulletsKo: normalizeStringArray(o.newsBulletsKo),
        optionsBulletsKo: normalizeStringArray(o.optionsBulletsKo),
        financialsBulletsKo: normalizeStringArray(o.financialsBulletsKo),
        // Only when the model returned the field: it is requested solely for
        // investor-flows-integrated runs, and an absent field must stay absent.
        ...(Array.isArray(o.investorFlowsBulletsKo)
            ? {
                  investorFlowsBulletsKo: normalizeStringArray(
                      o.investorFlowsBulletsKo
                  ),
              }
            : {}),
        integratedConclusionKo: asString(o.integratedConclusionKo),
        scenarios: compact(asArray(o.scenarios).map(normalizeScenario)),
        riskFactorsKo: normalizeStringArray(o.riskFactorsKo),
        ...(context.optionsOiStale ? { optionsOiStale: true } : {}),
        // Never LLM-authored — echoed straight through when a cached entry
        // already carries it (set once by `runOverallAnalysis` on the
        // producing call). Omitted rather than `''`
        // for an older cache entry written before this field existed, so
        // "unknown" stays distinguishable from "just now".
        ...(typeof o.analyzedAt === 'string' && o.analyzedAt !== ''
            ? { analyzedAt: o.analyzedAt }
            : {}),
    };
}
