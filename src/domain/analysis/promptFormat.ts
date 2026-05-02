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
