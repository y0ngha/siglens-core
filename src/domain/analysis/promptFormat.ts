/**
 * Shared formatting utilities for AI prompt builders.
 *
 * These helpers are intentionally free of any LLM-specific logic — they only
 * convert domain values into compact, human-readable strings suitable for
 * injection into prompt templates.
 */

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
 * @param raw - Raw string from the LLM response.
 * @returns Extracted JSON string (not yet parsed).
 */
function stripFence(raw: string): string {
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
 * Strip optional ` ```json ` / ` ``` ` markdown code fences from an LLM response
 * and parse the inner content as JSON.
 *
 * LLMs occasionally wrap JSON responses in markdown code fences even when
 * instructed not to, or prepend/append prose around the JSON block. This helper
 * extracts the first JSON block before parsing so normalizers can accept both
 * raw JSON and fenced/prose-wrapped JSON strings.
 *
 * @internal
 * @param raw - Raw string from the LLM response. May be fenced, prose-wrapped, or plain JSON.
 * @returns Parsed JSON value as `unknown` — callers must validate the shape.
 * @throws {SyntaxError} When the string (after fence removal) is not valid JSON.
 */
export function extractJsonFromLlmResponse(raw: string): unknown {
    return JSON.parse(stripFence(raw));
}
