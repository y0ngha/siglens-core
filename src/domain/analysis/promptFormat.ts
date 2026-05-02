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
export function formatNullableNumber(n: number | null | undefined, dp = 2): string {
    return n == null ? 'N/A' : n.toFixed(dp);
}

/** Regex that matches optional ` ```json ` or ` ``` ` opening fence and trailing ` ``` `. */
const MARKDOWN_FENCE_PATTERN = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/;

/**
 * Strip optional ` ```json ` / ` ``` ` markdown code fences from an LLM response
 * and parse the inner content as JSON.
 *
 * LLMs occasionally wrap JSON responses in markdown code fences even when
 * instructed not to. This helper removes the fence before parsing so
 * normalizers can accept both raw JSON and fenced JSON strings.
 *
 * @internal
 * @param raw - Raw string from the LLM response. May be fenced or plain JSON.
 * @returns Parsed JSON value as `unknown` — callers must validate the shape.
 * @throws {SyntaxError} When the string (after fence removal) is not valid JSON.
 */
export function extractJsonFromLlmResponse(raw: string): unknown {
    const match = MARKDOWN_FENCE_PATTERN.exec(raw.trim());
    const jsonString = match !== null ? match[1] : raw;
    return JSON.parse(jsonString);
}
