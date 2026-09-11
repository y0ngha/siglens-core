import { jsonrepair } from 'jsonrepair';

const JSON_CODE_FENCE_START = '```json';
const JSON_CODE_FENCE_END = '```';

/**
 * The first top-level `{…}` value in `text` **when something non-blank follows
 * it**, or `null`.
 *
 * DeepSeek's Responses API occasionally streams a complete JSON object and then
 * keeps going — a second copy of the object, or a restart — so `JSON.parse` fails
 * with "Unexpected non-whitespace character after JSON". 41 prewarm units failed
 * that way in the first night after the Responses-API switch, against 0 the night
 * before. The first object is complete and valid; everything after it is noise.
 *
 * This runs **before** `jsonrepair`, not after: jsonrepair turns concatenated
 * objects into an array (`{…}{…}` → `[{…},{…}]`), which parses fine and then
 * fails downstream as the wrong shape. A truncated object never returns to depth
 * 0, so it yields `null` here and still reaches jsonrepair as before. The scan is
 * string- and escape-aware so braces inside string values do not count.
 *
 * Only text that **starts** with the object qualifies. The failure this handles
 * always puts the answer first; with leading prose, a stray `{}` inside that prose
 * would otherwise be taken as "the first object" and the real answer discarded.
 * Prose-led text keeps the pre-existing jsonrepair path.
 */
function firstCompleteObjectWithTrailingContent(text: string): string | null {
    if (!text.startsWith('{')) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) {
            const rest = text.slice(i + 1);
            return rest.trim() === '' ? null : text.slice(0, i + 1);
        }
    }
    return null;
}

export function normalizeJsonResponse(raw: string): string {
    const trimmed = raw.trim();
    const jsonText =
        trimmed.startsWith(JSON_CODE_FENCE_START) &&
        trimmed.endsWith(JSON_CODE_FENCE_END)
            ? trimmed
                  .slice(
                      JSON_CODE_FENCE_START.length,
                      trimmed.length - JSON_CODE_FENCE_END.length
                  )
                  .trim()
            : trimmed;

    try {
        return JSON.stringify(JSON.parse(jsonText));
    } catch (err) {
        const firstObject = firstCompleteObjectWithTrailingContent(jsonText);
        if (firstObject !== null) {
            try {
                return JSON.stringify(JSON.parse(firstObject));
            } catch {
                // fall through to jsonrepair
            }
        }
        try {
            return JSON.stringify(JSON.parse(jsonrepair(jsonText)));
        } catch {
            throw err; // rethrow the original SyntaxError for backward compatibility
        }
    }
}
