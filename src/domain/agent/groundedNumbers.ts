/** ISO date fragment (YYYY-MM-DD), excluded from number extraction. */
const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;
/** Clock time fragment (H:MM or HH:MM:SS), excluded from number extraction. */
const TIME_RE = /\b\d{1,3}:\d{2}(?::\d{2})?\b/g;
/** Markdown-style ordered list marker ("1. " / "12) "), excluded. */
const LIST_MARKER_RE = /^[ \t]*(\d+)[.)][ \t]/gm;
/**
 * Index/benchmark names paired with the numbers that are actually part of
 * their name (not a value claim) — "S&P 500" names an index, "나스닥 100"
 * names an index. Deliberately NOT "any number after the name": a real
 * value claim routinely follows the same name ("나스닥 26,655.16에 마감",
 * "코스피 2,650선") and must still be checked. Kept as one documented map so
 * a new benchmark/constituent-count is a one-line addition.
 */
const INDEX_NAME_NUMBERS: Readonly<Record<string, readonly number[]>> = {
    'S&P': [100, 400, 500, 600],
    NASDAQ: [100],
    Nasdaq: [100],
    나스닥: [100],
    Russell: [1000, 2000, 3000],
    KOSPI: [50, 100, 200],
    코스피: [50, 100, 200],
    KOSDAQ: [150],
    코스닥: [150],
    Dow: [30],
    다우: [30],
    FTSE: [100, 250],
    Nikkei: [225],
    니케이: [225],
    Stoxx: [50, 600],
    DAX: [40],
    CAC: [40],
};
/** Escapes regex metacharacters in a literal string for embedding inside a `RegExp` source (e.g. the "&" in "S&P" or a "." in a future prefix). */
function escapeRegExp(literal: string): string {
    return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * One alternative per index name, each requiring the number that directly
 * (optionally with one space) follows the name to be exactly one of that
 * name's own numbers — not followed by another digit or a decimal point, so
 * "코스피 200" (the name) is distinct from "코스피 200.5"/"코스피 2005" (a
 * value that merely starts the same way). No capturing group is needed:
 * the trailing digit run of the whole match is always the number span
 * (see its use in {@link ignorableSpans}).
 * Known accepted ceiling: a genuine value claim that happens to exactly
 * equal the name's number right after the name (e.g. "코스피 200선 돌파"
 * meaning the index crossed exactly 200) is still skipped — indistinguishable
 * from the name itself with a regex, and the result only feeds a
 * non-blocking log.
 */
const INDEX_NAME_NUMBER_RE = new RegExp(
    Object.entries(INDEX_NAME_NUMBERS)
        .map(
            ([prefix, numbers]) =>
                `${escapeRegExp(prefix)}[ \\t]?(?:${numbers.join('|')})(?!\\d|\\.)`
        )
        .join('|'),
    'gu'
);
/**
 * A period-length indicator label, not a claim: "200일선", "50-day",
 * "20일 이동평균". The optional decimal part matches the full digit run
 * `NUMBER_RE` itself would extract (e.g. "12.5-day"), so the ignorable span
 * covers the whole token instead of only its integer part.
 */
const DAY_PERIOD_SUFFIX_RE = /\d+(?:\.\d+)?(?=일선|-day|일 이동평균)/g;
/**
 * "MA200" / "EMA50" need no dedicated pattern: {@link NUMBER_RE}'s own
 * `(?<![\d\p{L}])` lookbehind already refuses to start a number match right
 * after a letter, so the digits in "MA200"/"EMA50" (immediately preceded by
 * "A") are never extracted as a claim in the first place.
 */
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
    INDEX_NAME_NUMBER_RE.lastIndex = 0;
    for (
        let m = INDEX_NAME_NUMBER_RE.exec(text);
        m !== null;
        m = INDEX_NAME_NUMBER_RE.exec(text)
    ) {
        // No capture group (see the regex's own doc) — the number is always
        // the trailing digit run of the whole match.
        const digits = /\d+$/.exec(m[0])![0];
        const digitsStart = m.index + m[0].length - digits.length;
        spans.push([digitsStart, digitsStart + digits.length]);
    }
    DAY_PERIOD_SUFFIX_RE.lastIndex = 0;
    for (
        let m = DAY_PERIOD_SUFFIX_RE.exec(text);
        m !== null;
        m = DAY_PERIOD_SUFFIX_RE.exec(text)
    ) {
        spans.push([m.index, m.index + m[0].length]);
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

/** A tool ratio expressed as a fraction (0.3317) is the same fact as the model stating it as a percent (33.17%) — dividing by this "unit" converts fraction → percent, reusing {@link isGroundedWithUnit}'s n/multiplier math. */
const PERCENT_FRACTION_UNIT = 0.01;

/**
 * Upper bound (absolute value) for a tool number to plausibly be a fraction
 * meant for ×100 percent conversion. A financial ratio like a margin or ROE
 * fits comfortably under this (ROE of 1000% would still be 10.0); an actual
 * count, price or PE ratio does not.
 */
const PERCENT_FRACTION_MAX_ABS = 10;

/**
 * Whether `n` plausibly represents a fraction the model could restate as a
 * percent by multiplying by 100. Excludes integers outright — a whole number
 * like `count: 3` is never a fraction, so it must not back a fabricated
 * "300%" — and excludes anything whose magnitude is implausible for a ratio
 * (e.g. a PE ratio of 37.93 must not back "3793%").
 */
function isPlausiblePercentFraction(n: number): boolean {
    return !Number.isInteger(n) && Math.abs(n) <= PERCENT_FRACTION_MAX_ABS;
}

/**
 * A "%" token grounds against a tool number directly, or against a tool
 * fraction × 100 (e.g. operatingMargin: 0.3317 backs "33.17%") — restricted
 * to tool numbers that plausibly are such a fraction (see
 * {@link isPlausiblePercentFraction}) so an unrelated integer count or a
 * large ratio (PE, price) cannot ground an arbitrary percent claim.
 */
function isGroundedPercent(
    parsed: ParsedNumber,
    toolNumbers: readonly number[]
): boolean {
    return (
        isGrounded(parsed, toolNumbers) ||
        isGroundedWithUnit(
            parsed,
            PERCENT_FRACTION_UNIT,
            toolNumbers.filter(isPlausiblePercentFraction)
        )
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
 * - A "%" claim also grounds against a tool fraction × 100, but only when
 *   that fraction is non-integer and its absolute value is ≤ 10 (see
 *   {@link isPlausiblePercentFraction}) — a plain integer count or a large
 *   ratio (PE, price) is never treated as a percent-fraction source, so it
 *   cannot ground an arbitrary/fabricated percent claim. The gate cannot tell
 *   a margin/ROE fraction from any other small decimal ratio, though: a tool
 *   P/B or current ratio of 2.5 still grounds a fabricated "250%". Accepted
 *   because the result only feeds a non-blocking log.
 * - The integer exclusion above is a blunt instrument: a ratio that happens
 *   to be a whole number (ROE exactly `1.0` meaning 100%) is excluded from
 *   the ×100 path along with genuine non-ratio integers, so "ROE 100%" can
 *   be reported ungrounded even though the underlying fact is real. Accepted
 *   for the same reason — a false "ungrounded" here is far cheaper than the
 *   `count: 3` → "300%" false negative the exclusion prevents.
 * - `toolResults` is trusted verbatim. If the caller's tool executor
 *   truncates a result string mid-number before it reaches here (cutting
 *   "26333.0391" down to "26333.0"), `JSON.parse` fails, the regex fallback
 *   extracts the truncated (wrong) number, and a genuinely-grounded value can
 *   be reported as ungrounded. This function cannot detect or repair
 *   truncation — the fix is for the caller to truncate at a JSON-safe
 *   boundary (or not truncate) before appending a tool message to the
 *   transcript passed in as `toolResults`.
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
            unitMultiplier !== undefined
                ? isGroundedWithUnit(parsed, unitMultiplier, toolNumbers)
                : token.endsWith('%')
                  ? isGroundedPercent(parsed, toolNumbers)
                  : isGrounded(parsed, toolNumbers);
        if (!grounded) ungrounded.push(displayToken);
    }
    return ungrounded;
}
