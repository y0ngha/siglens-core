/** ISO date fragment (YYYY-MM-DD), excluded from number extraction. */
const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;
/** Clock time fragment (H:MM or HH:MM:SS), excluded from number extraction. */
const TIME_RE = /\b\d{1,3}:\d{2}(?::\d{2})?\b/g;
/** Markdown-style ordered list marker ("1. " / "12) "), excluded. */
const LIST_MARKER_RE = /^[ \t]*(\d+)[.)][ \t]/gm;
/**
 * A signed, comma-grouped, optionally decimal, optionally percent number.
 * The leading sign is only consumed when NOT immediately preceded by a digit
 * or letter, so a range/subtraction separator ("5-10%", "5~10%") is not
 * mistaken for a unary minus on the second number — a genuine negative
 * ("총합은 -3입니다") is still preceded by whitespace/punctuation and matches.
 */
const NUMBER_RE = /(?<![\d\p{L}])[+-]?\d[\d,]*(?:\.\d+)?%?/gu;
/** Same leading-sign rule as {@link NUMBER_RE}, plus an optional exponent — used only as a fallback over non-JSON tool-result text (see {@link collectToolNumbers}). */
const TOOL_NUMBER_RE =
    /(?<![\d\p{L}])[+-]?\d[\d,]*(?:\.\d+)?(?:[eE][+-]?\d+)?/gu;
/** Korean magnitude units immediately adjacent to a number, e.g. "1.2억원". */
const KOREAN_UNIT_MULTIPLIER: Readonly<Record<string, number>> = {
    만: 1e4,
    억: 1e8,
    조: 1e12,
};

const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

type Span = readonly [start: number, end: number];

function overlaps(a: Span, b: Span): boolean {
    return a[0] < b[1] && a[1] > b[0];
}

/** Character ranges in `text` that look like dates, times or list markers. */
function ignorableSpans(text: string): Span[] {
    const spans: Span[] = [];
    for (const re of [DATE_RE, TIME_RE]) {
        re.lastIndex = 0;
        for (let m = re.exec(text); m !== null; m = re.exec(text)) {
            spans.push([m.index, m.index + m[0].length]);
        }
    }
    LIST_MARKER_RE.lastIndex = 0;
    for (
        let m = LIST_MARKER_RE.exec(text);
        m !== null;
        m = LIST_MARKER_RE.exec(text)
    ) {
        const digitsStart = m.index + m[0].indexOf(m[1]);
        spans.push([digitsStart, digitsStart + m[1].length]);
    }
    return spans;
}

/** A plain integer (no separators) is not a meaningful claim below 3 digits. */
function isIgnorableInteger(digits: string): boolean {
    if (digits.length < 3) return true;
    if (digits.length === 4) {
        const year = Number(digits);
        return year >= YEAR_MIN && year <= YEAR_MAX;
    }
    return false;
}

function isIgnorableToken(token: string): boolean {
    const unsigned = token.replace(/^[+-]/, '');
    const isPlainInteger = !/[.,%]/.test(unsigned);
    return isPlainInteger && isIgnorableInteger(unsigned);
}

interface ParsedNumber {
    value: number;
    /** Decimal digits shown in the token; used to round tool numbers to the same precision. */
    decimals: number;
}

function parseToken(token: string): ParsedNumber {
    const withoutPercent = token.endsWith('%') ? token.slice(0, -1) : token;
    const normalized = withoutPercent.replace(/,/g, '');
    const dotIndex = normalized.indexOf('.');
    return {
        value: Number(normalized),
        decimals: dotIndex === -1 ? 0 : normalized.length - dotIndex - 1,
    };
}

/** Extracts numbers from free text via regex — the fallback path for non-JSON tool output. */
function collectRegexNumbers(text: string, out: number[]): void {
    TOOL_NUMBER_RE.lastIndex = 0;
    for (
        let m = TOOL_NUMBER_RE.exec(text);
        m !== null;
        m = TOOL_NUMBER_RE.exec(text)
    ) {
        out.push(Number(m[0].replace(/,/g, '')));
    }
}

/**
 * Walks a parsed JSON value collecting every number leaf verbatim (so
 * exponents/negatives/comma-grouping ambiguity never touch a regex) and
 * every string leaf through the regex fallback, since a string can itself
 * carry a human-formatted number (e.g. a summary sentence).
 */
function collectJsonNumbers(value: unknown, out: number[]): void {
    if (typeof value === 'number') {
        if (Number.isFinite(value)) out.push(value);
        return;
    }
    if (typeof value === 'string') {
        collectRegexNumbers(value, out);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectJsonNumbers(item, out);
        return;
    }
    if (value !== null && typeof value === 'object') {
        for (const item of Object.values(value)) collectJsonNumbers(item, out);
    }
}

/**
 * Every numeric value appearing anywhere in `results`. Tool results are
 * almost always JSON, so each is parsed and walked (numbers taken as-is,
 * strings scanned by regex); a result that fails to parse falls back to
 * scanning its raw text by regex.
 */
function collectToolNumbers(results: readonly string[]): number[] {
    const numbers: number[] = [];
    for (const result of results) {
        try {
            collectJsonNumbers(JSON.parse(result), numbers);
        } catch {
            collectRegexNumbers(result, numbers);
        }
    }
    return numbers;
}

/**
 * A token is grounded when some tool number equals it exactly, or rounds to
 * it at the token's own decimal precision — `toFixed` covers both cases in
 * one comparison (an exact value fixed to its own precision is unchanged).
 */
function isGrounded(
    parsed: ParsedNumber,
    toolNumbers: readonly number[]
): boolean {
    const target = parsed.value.toFixed(parsed.decimals);
    return toolNumbers.some(n => n.toFixed(parsed.decimals) === target);
}

/** Same comparison as {@link isGrounded}, but the tool number is first converted into the answer's magnitude unit (e.g. 억 = ÷1e8) before rounding. */
function isGroundedWithUnit(
    parsed: ParsedNumber,
    multiplier: number,
    toolNumbers: readonly number[]
): boolean {
    const target = parsed.value.toFixed(parsed.decimals);
    return toolNumbers.some(
        n => (n / multiplier).toFixed(parsed.decimals) === target
    );
}

/**
 * Finds numeric claims in an agent's answer that do not trace back to any
 * tool result — a lightweight grounding check for a "never quote a number
 * from memory" policy. Pure and side-effect free: it does not log, block or
 * alter anything by itself. `RunAgentTurnResult` already carries both inputs
 * a consumer needs — call this with `assistant.content` as `answer` and
 * `intermediate.filter(m => m.role === 'tool').map(m => m.content)` as
 * `toolResults`, then log (or otherwise act on) the return value; core has
 * no call site of its own.
 *
 * Known ceilings, deliberately not solved here:
 * - Derived numbers the model computes from grounded inputs (e.g. a spread
 *   or percentage change it calculates itself) are reported as ungrounded
 *   even though every input was real.
 * - Grounding is value-only: a number that is genuinely present but attached
 *   to the wrong symbol/field in a multi-tool-call turn still counts as
 *   grounded.
 * - Only single-unit Korean magnitude shorthand is converted (e.g. "1.2억").
 *   A compound form ("3조 5천억") is not decomposed; its leftover digits
 *   ("5") are handled as plain digits, typically too short to be flagged
 *   either way — the claim is effectively skipped rather than mis-graded.
 *
 * @param answer - The assistant's final answer text.
 * @param toolResults - Raw tool result strings from the same turn (as
 * appended to the transcript), searched for matching numeric values.
 * @returns Ungrounded numeric token strings, distinct, in order of first
 * appearance in `answer`.
 */
export function findUngroundedNumbers(
    answer: string,
    toolResults: readonly string[]
): string[] {
    const skip = ignorableSpans(answer);
    const toolNumbers = collectToolNumbers(toolResults);
    const seen = new Set<string>();
    const ungrounded: string[] = [];

    NUMBER_RE.lastIndex = 0;
    for (
        let m = NUMBER_RE.exec(answer);
        m !== null;
        m = NUMBER_RE.exec(answer)
    ) {
        const token = m[0];
        const start = m.index;
        let end = start + token.length;

        let unitMultiplier: number | undefined;
        let displayToken = token;
        if (!token.endsWith('%')) {
            const nextChar = answer[end];
            const multiplier =
                nextChar !== undefined
                    ? KOREAN_UNIT_MULTIPLIER[nextChar]
                    : undefined;
            if (multiplier !== undefined) {
                unitMultiplier = multiplier;
                displayToken = token + nextChar;
                end += 1;
            }
        }

        const span: Span = [start, end];
        if (skip.some(s => overlaps(s, span))) continue;
        if (unitMultiplier === undefined && isIgnorableToken(token)) continue;
        if (seen.has(displayToken)) continue;
        seen.add(displayToken);

        const parsed = parseToken(token);
        const grounded =
            unitMultiplier === undefined
                ? isGrounded(parsed, toolNumbers)
                : isGroundedWithUnit(parsed, unitMultiplier, toolNumbers);
        if (!grounded) ungrounded.push(displayToken);
    }
    return ungrounded;
}
