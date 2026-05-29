/**
 * LLM-response JSON parser with `jsonrepair` salvage.
 *
 * Lives in `infrastructure/` because `jsonrepair` is an external runtime
 * dependency — `domain/` is forbidden to import third-party libraries
 * (see ARCHITECTURE.md). The pure-domain counterpart
 * `extractJsonFromLlmResponse` (`domain/analysis/promptFormat`) is kept
 * minimal so it stays a side-effect-free building block; this file layers
 * salvage and richer diagnostics on top.
 */

import { jsonrepair } from 'jsonrepair';
import { stripLlmJsonFence } from '@/domain/analysis/promptFormat';

/**
 * Capture a small window around a JSON.parse error position for diagnostic logs.
 * Adds leading/trailing ellipses when the window is clipped from a longer text.
 * @internal
 */
export function snippetAroundPosition(text: string, position: number): string {
    const start = Math.max(0, position - 60);
    const end = Math.min(text.length, position + 60);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < text.length ? '…' : '';
    return `${prefix}${text.slice(start, end)}${suffix}`;
}

/**
 * Extract a numeric `position` from a SyntaxError message, or `null` if absent.
 * @internal
 */
export function parseSyntaxErrorPosition(message: string): number | null {
    const match = /position\s+(\d+)/.exec(message);
    if (!match) return null;
    const n = Number.parseInt(match[1], 10);
    return Number.isFinite(n) ? n : null;
}

/**
 * `jsonrepair` is willing to wrap any text in quotes to produce valid JSON,
 * which would silently accept "not json at all" as a string. Restrict salvage
 * to candidates that already look like a JSON container so total garbage
 * still surfaces as a SyntaxError.
 *
 * Both `{` (object) and `[` (array) are accepted; downstream normalizers
 * are responsible for shape validation. The intent is to reject scalar
 * garbage, not to enforce object-only payloads here.
 */
function looksJsonShaped(text: string): boolean {
    const head = text.trimStart()[0];
    return head === '{' || head === '[';
}

/**
 * @internal Parse an LLM response as JSON, with markdown-fence stripping AND
 * `jsonrepair`-based salvage on parse failure.
 *
 * Salvage strategy: on initial `JSON.parse` failure (truncated output,
 * unescaped quotes, missing commas, trailing commas, single quotes, etc.),
 * retry once via `jsonrepair`. Salvage is gated on `looksJsonShaped` so
 * non-JSON garbage isn't silently coerced into a quoted string.
 *
 * On final failure, throw a `SyntaxError` augmented with the original
 * message, payload length, and a snippet around the parse position so
 * worker-side error logs surface diagnosable context instead of a bare
 * `Expected ',' or '}' ... at position N`. The original error is preserved
 * as `.cause`.
 *
 * @param raw - Raw string from the LLM. May be fenced, prose-wrapped, or plain JSON.
 * @returns Parsed JSON value as `unknown` — callers must validate the shape.
 * @throws {SyntaxError} When neither the raw nor the repaired form parses.
 */
export function extractJsonWithRepair(raw: string): unknown {
    const candidate = stripLlmJsonFence(raw);
    try {
        return JSON.parse(candidate);
    } catch (initialError) {
        if (looksJsonShaped(candidate)) {
            try {
                return JSON.parse(jsonrepair(candidate));
            } catch {
                // Fall through to augmented throw below.
            }
        }
        const message =
            initialError instanceof Error
                ? initialError.message
                : String(initialError);
        const position = parseSyntaxErrorPosition(message);
        const snippet =
            position !== null
                ? ` near: ${snippetAroundPosition(candidate, position)}`
                : '';
        const augmented = new SyntaxError(
            `${message} (payload length ${candidate.length})${snippet}`
        );
        augmented.cause = initialError;
        throw augmented;
    }
}
