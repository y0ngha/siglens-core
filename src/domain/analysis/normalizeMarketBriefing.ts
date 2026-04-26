import type {
    MarketBriefingResponse,
    MarketBriefingSectorAnalysis,
    MarketBriefingVolatilityAnalysis,
} from '@/domain/types';
import { asArray, asNumber, asObject, asString } from './normalizePrimitives';

function normalizeSectorAnalysis(v: unknown): MarketBriefingSectorAnalysis {
    const o = asObject(v);
    if (!o) {
        return {
            leadingSectors: [],
            laggingSectors: [],
            performanceDescription: '',
        };
    }
    return {
        leadingSectors: asArray(o.leadingSectors)
            .map(s => asString(s))
            .filter((s): s is string => s.length > 0),
        laggingSectors: asArray(o.laggingSectors)
            .map(s => asString(s))
            .filter((s): s is string => s.length > 0),
        performanceDescription: asString(o.performanceDescription),
    };
}

function normalizeVolatilityAnalysis(
    v: unknown
): MarketBriefingVolatilityAnalysis {
    const o = asObject(v);
    if (!o) return { vixLevel: undefined, description: '' };
    return {
        vixLevel: asNumber(o.vixLevel),
        description: asString(o.description),
    };
}

/**
 * Convert an arbitrary worker payload into a fully-validated
 * {@link MarketBriefingResponse}.
 *
 * Defensively coerces every field via the `as*` primitive helpers — non-string
 * values become `''`, missing arrays become `[]`, missing objects become
 * empty defaults. Returns a well-formed object even when `raw` is `null`,
 * `undefined`, or a malformed shape, so callers never need to null-check
 * individual fields.
 *
 * @param raw - The unvalidated worker response. Expected to be a JSON
 *   object matching the {@link buildMarketBriefingPrompt} schema, but any
 *   value is accepted.
 * @returns A safe-to-render {@link MarketBriefingResponse}.
 *
 * @see buildMarketBriefingPrompt
 */
export function normalizeMarketBriefing(raw: unknown): MarketBriefingResponse {
    const o = asObject(raw);
    if (!o) {
        return {
            summary: '',
            dominantThemes: [],
            sectorAnalysis: {
                leadingSectors: [],
                laggingSectors: [],
                performanceDescription: '',
            },
            volatilityAnalysis: { vixLevel: undefined, description: '' },
            riskSentiment: '',
        };
    }
    return {
        summary: asString(o.summary),
        dominantThemes: asArray(o.dominantThemes)
            .map(s => asString(s))
            .filter((s): s is string => s.length > 0),
        sectorAnalysis: normalizeSectorAnalysis(o.sectorAnalysis),
        volatilityAnalysis: normalizeVolatilityAnalysis(o.volatilityAnalysis),
        riskSentiment: asString(o.riskSentiment),
    };
}
