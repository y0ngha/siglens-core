/**
 * Shared formatting utilities for AI prompt builders.
 *
 * These helpers are intentionally free of any LLM-specific logic — they only
 * convert domain values into compact, human-readable strings suitable for
 * injection into prompt templates.
 */

import type { Timeframe } from '@/domain/types';

/**
 * Human-readable timeframe labels used in prompt headers.
 *
 * Lives here rather than in `prompt.ts` so that both the technical prompt
 * builder and `priorAnalysisSection.ts` can read the same map without the two
 * modules importing each other — a cycle that would otherwise form, since the
 * prompt builder also imports the prior-analysis renderer. `promptFormat.ts`
 * has no imports of its own, so it is the natural neutral home.
 */
export const TIMEFRAME_LABEL: Record<Timeframe, string> = {
    '5Min': '5-Minute',
    '15Min': '15-Minute',
    '30Min': '30-Minute',
    '1Hour': '1-Hour',
    '4Hour': '4-Hour',
    '1Day': 'Daily',
};

/**
 * Format a nullable number for prompt injection.
 *
 * Returns the number rounded to `dp` decimal places, or the literal string
 * `'N/A'` when the value is `null` or `undefined`. The default of 2 decimal
 * places matches typical financial data display conventions.
 *
 * @param n  - The number to format, or `null` / `undefined`.
 * @param dp - Decimal places to use (default: `2`).
 * @returns Formatted string, e.g. `"3.14"` or `"N/A"`.
 */
export function formatNullableNumber(
    n: number | null | undefined,
    dp = 2
): string {
    return n == null ? 'N/A' : n.toFixed(dp);
}

/**
 * Strip optional markdown code fences from an LLM response string.
 *
 * LLMs sometimes wrap JSON in prose and fences, e.g.:
 * `Here's the JSON: \`\`\`json {...} \`\`\` Hope this helps`.
 *
 * Two-step extraction:
 * 1. If a ` ```json ` / ` ``` ` fence is present anywhere, extract its content.
 * 2. Otherwise, slice the first `{`…last `}` brace pair.
 * 3. Fall back to the trimmed raw string.
 *
 * Exported so infrastructure-layer salvage wrappers (which need to feed the
 * stripped candidate into a repair library) can reuse the exact same
 * stripping behaviour rather than diverging.
 *
 * @param raw - Raw string from the LLM response.
 * @returns Extracted JSON string (not yet parsed).
 */
export function stripLlmJsonFence(raw: string): string {
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) return fenceMatch[1].trim();

    const braceStart = raw.indexOf('{');
    const braceEnd = raw.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
        return raw.slice(braceStart, braceEnd + 1);
    }

    return raw.trim();
}

/**
 * @internal
 *
 * Strip optional ` ```json ` / ` ``` ` markdown code fences from an LLM response
 * and parse the inner content as JSON.
 *
 * LLMs occasionally wrap JSON responses in markdown code fences even when
 * instructed not to, or prepend/append prose around the JSON block. This helper
 * extracts the first JSON block before parsing so normalizers can accept both
 * raw JSON and fenced/prose-wrapped JSON strings.
 *
 * Pure-domain implementation — no salvage. Consumers needing tolerance for
 * truncated / unquoted-key / trailing-comma payloads should use the
 * infrastructure-layer `extractJsonWithRepair` wrapper, which retries via
 * `jsonrepair` on failure.
 *
 * @param raw - Raw string from the LLM response. May be fenced, prose-wrapped, or plain JSON.
 * @returns Parsed JSON value as `unknown` — callers must validate the shape.
 * @throws {SyntaxError} When the string (after fence removal) is not valid JSON.
 */
export function extractJsonFromLlmResponse(raw: string): unknown {
    return JSON.parse(stripLlmJsonFence(raw));
}

/**
 * @internal
 *
 * Coerce a raw LLM payload to a parsed value.
 *
 * When the payload is a string (the common case — LLM workers return raw JSON
 * strings, sometimes wrapped in markdown fences) it is extracted and parsed via
 * {@link extractJsonFromLlmResponse}. Non-string values (e.g. a cache hit that
 * already deserialized the JSON object) are returned as-is.
 *
 * Shared by every domain normalizer that accepts either a raw string or a
 * pre-parsed object so the coercion logic lives in one place.
 *
 * @param raw - Raw value from the LLM worker or cache.
 * @returns Parsed JSON value, or the original value unchanged.
 * @throws {SyntaxError} When `raw` is a string that is not valid JSON after fence removal.
 */
export function parseLlmPayload(raw: unknown): unknown {
    return typeof raw === 'string' ? extractJsonFromLlmResponse(raw) : raw;
}
