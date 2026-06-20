import { asObject, asString } from '@/domain/analysis/normalizePrimitives';
import { extractJsonFromLlmResponse } from '@/domain/analysis/promptFormat';

function parseLlmPayload(raw: unknown): unknown {
    return typeof raw === 'string' ? extractJsonFromLlmResponse(raw) : raw;
}

/**
 * @internal Normalize a raw LLM response into a Korean indicator name string.
 *
 * Strips optional markdown code fences, parses JSON, and extracts the
 * `nameKo` field defensively. Returns an empty string when the payload is
 * null, garbage, empty, or does not contain a valid string in `nameKo`.
 * Callers should treat an empty return value as a signal to fall back to
 * the original English name.
 *
 * The poll path writes the result as `{ nameKo }` to cache so that cache-hit
 * reads pass through this same normalizer without special-casing bare strings.
 *
 * Always returns a string — never throws on non-string garbage input.
 *
 * @param raw - Raw string/object from the LLM worker or cache.
 * @returns Trimmed Korean name string, or `''` on any failure.
 */
export function normalizeIndicatorTranslation(raw: unknown): string {
    try {
        const parsed = parseLlmPayload(raw);
        const o = asObject(parsed) ?? {};
        return asString(o.nameKo).trim();
    } catch {
        return '';
    }
}
