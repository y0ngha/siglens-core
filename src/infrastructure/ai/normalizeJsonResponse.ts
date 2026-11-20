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

/**
 * The response schema's top-level key lists, read from the schema object the
 * caller already passes to the provider — there is no second hand-maintained list.
 * A schema without a top-level `required` / `properties` array yields empty lists,
 * which turns the checks off (non-object roots, unknown schema shapes).
 */
export interface ResponseSchemaKeys {
    readonly required: readonly string[];
    readonly properties: readonly string[];
}

function stringKeys(value: unknown): readonly string[] {
    return Array.isArray(value)
        ? value.filter((k): k is string => typeof k === 'string')
        : [];
}

export function responseSchemaKeys(schema: unknown): ResponseSchemaKeys {
    if (typeof schema !== 'object' || schema === null) {
        return { required: [], properties: [] };
    }
    // `in` narrowing, not a cast: the schema is `unknown` (callers pass provider-specific
    // objects), so each key list is read only when the property exists and then
    // validated element by element.
    const required = 'required' in schema ? schema.required : undefined;
    const properties = 'properties' in schema ? schema.properties : undefined;
    return {
        required: stringKeys(required),
        properties:
            typeof properties === 'object' && properties !== null
                ? Object.keys(properties)
                : [],
    };
}

/**
 * A response that parsed (possibly after salvage) but cannot be trusted as the
 * whole answer: a schema-required key is missing, or the salvage dropped trailing
 * content that carries schema keys the kept object lacks.
 *
 * Extends `SyntaxError` on purpose. `callAnalysisAi` regenerates once on a
 * `SyntaxError`, so an incomplete answer takes exactly the parse-failure path and
 * never reaches the cache.
 */
export class IncompleteJsonResponseError extends SyntaxError {
    constructor(message: string) {
        super(message);
        this.name = 'IncompleteJsonResponseError';
    }
}

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/**
 * Whether `text` holds `key` in key position: the quoted name followed by optional
 * whitespace and `:`. A schema key name appearing as a string VALUE (or an array
 * item) in the discarded tail is not a lost key.
 *
 * Remaining limitation: this is a text pattern, not a tokenizer. An escaped `\"key\":`
 * inside a string value does not match (the backslash breaks the quote pair), but a tail
 * that begins in the middle of a string can still show `"key":` in what only looks like key
 * position. The cost of that false positive is one regeneration, so a stricter scan is not
 * worth it.
 */
function hasKey(text: string, key: string): boolean {
    const quoted = JSON.stringify(key).replace(REGEX_SPECIALS, '\\$&');
    return new RegExp(`${quoted}\\s*:`).test(text);
}

type ParseResult =
    | { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly error: unknown };

/** Runs a parse step and reports its outcome instead of throwing. */
function attempt(parse: () => unknown): ParseResult {
    try {
        return { ok: true, value: parse() };
    } catch (error) {
        return { ok: false, error };
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertComplete(
    parsed: unknown,
    schema: ResponseSchemaKeys,
    discardedTail: string
): void {
    if (!isPlainObject(parsed)) return;
    const missing = schema.required.filter(key => !(key in parsed));
    if (missing.length > 0) {
        throw new IncompleteJsonResponseError(
            `AI response is missing required keys: ${missing.join(', ')}`
        );
    }
    // A stray `}` closes the object early and the salvage keeps only the head.
    // Optional keys are not covered by the required check, so a schema key that
    // appears only in the discarded tail marks the kept object as truncated. A
    // plain second copy of the answer (the failure this salvage exists for) has
    // no key the kept object lacks and stays valid.
    const lost = schema.properties.filter(
        key => !(key in parsed) && hasKey(discardedTail, key)
    );
    if (lost.length > 0) {
        throw new IncompleteJsonResponseError(
            `AI response lost keys after a stray closing brace: ${lost.join(', ')}`
        );
    }
}

/**
 * Turns a raw model reply into canonical JSON text.
 *
 * With `responseSchema`, the parsed object is also checked against the schema's
 * top-level `required` keys (and against salvage having discarded schema keys);
 * a failing reply throws {@link IncompleteJsonResponseError}.
 */
export function normalizeJsonResponse(
    raw: string,
    responseSchema?: unknown
): string {
    const schema = responseSchemaKeys(responseSchema);
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

    const direct = attempt(() => JSON.parse(jsonText));
    if (direct.ok) {
        assertComplete(direct.value, schema, '');
        return JSON.stringify(direct.value);
    }

    const firstObject = firstCompleteObjectWithTrailingContent(jsonText);
    if (firstObject !== null) {
        const head = attempt(() => JSON.parse(firstObject));
        if (head.ok) {
            assertComplete(
                head.value,
                schema,
                jsonText.slice(firstObject.length)
            );
            return JSON.stringify(head.value);
        }
        // fall through to jsonrepair
    }

    const repaired = attempt(() => JSON.parse(jsonrepair(jsonText)));
    if (!repaired.ok) {
        throw direct.error; // rethrow the original SyntaxError for backward compatibility
    }
    assertComplete(repaired.value, schema, '');
    return JSON.stringify(repaired.value);
}
