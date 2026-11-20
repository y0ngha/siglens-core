/**
 * Number extraction from the assembled dynamic analysis prompt.
 *
 * The deterministic checks (price provenance, replay labelling) need to know which
 * numbers the model was actually shown. These helpers read the prompt text back, so
 * they are coupled to its rendered format on purpose: the test that builds a real
 * prompt and compares it against `computeMarketReference` is the guard that fails when
 * the format changes.
 */

/**
 * @internal
 * One numeric token of a prompt: its value and the fractional digits it was written with.
 */
export interface PromptNumber {
    readonly value: number;
    readonly decimals: number;
}

/**
 * @internal
 * One `- <price> (<label>; …)` line of the `## Market Reference` section.
 */
export interface PromptReferenceLevel {
    readonly price: number;
    readonly decimals: number;
    readonly label: string;
}

const NUMBER_TOKEN_SOURCE =
    /(?<![\w.])\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.])\d+(?:\.\d+)?/.source;

/**
 * @internal
 * A fresh global matcher of the numeric tokens of a prompt: thousands-grouped or plain
 * decimal numbers. The look-behind keeps identifiers such as `MA200` and fragments such
 * as the `.5` of `1.5` from yielding a second token. A new instance per call, because a
 * shared `/g` regex carries `lastIndex` between users.
 */
export function promptNumberPattern(): RegExp {
    return new RegExp(NUMBER_TOKEN_SOURCE, 'g');
}

const MARKET_REFERENCE_HEADING = '## Market Reference';

/** `- 197.51 (VWAP; 0.54% away; …)` — the price, then the label up to the distance clause. */
const REFERENCE_LEVEL_LINE =
    /^- (\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?) \((.+?); [^;()]*% away.*\)$/;

const DEFAULT_PRICE_DECIMALS = 2;

/** Tokens unique by `(value, decimals)`, first occurrence order. */
function uniqueNumbers(
    tokens: readonly PromptNumber[]
): readonly PromptNumber[] {
    return [
        ...new Map(
            tokens.map(token => [`${token.value}|${token.decimals}`, token])
        ).values(),
    ];
}

function decimalsOf(token: string): number {
    const dot = token.indexOf('.');
    return dot === -1 ? 0 : token.length - dot - 1;
}

function parseToken(token: string): number {
    return Number(token.replaceAll(',', ''));
}

/**
 * @internal
 *
 * Every numeric token of `text` with thousands separators removed, unique by
 * `(value, decimals)` — `197.5` and `197.50` are different tokens because the printed
 * precision is what the provenance rule compares.
 */
export function extractPromptNumbers(text: string): readonly PromptNumber[] {
    const tokens = [...text.matchAll(promptNumberPattern())].map(([token]) => ({
        value: parseToken(token),
        decimals: decimalsOf(token),
    }));
    return uniqueNumbers(tokens);
}

/** The lines of the `## Market Reference` section, up to the next `## ` heading. */
function marketReferenceLines(dynamic: string): readonly string[] {
    const lines = dynamic.split('\n');
    const start = lines.findIndex(line =>
        line.startsWith(MARKET_REFERENCE_HEADING)
    );
    if (start === -1) return [];
    const rest = lines.slice(start + 1);
    const end = rest.findIndex(line => line.startsWith('## '));
    return end === -1 ? rest : rest.slice(0, end);
}

/**
 * @internal
 *
 * The `- <price> (<label>; …)` level lines under `## Market Reference`, in prompt order
 * (all three horizon blocks; a level printed in several blocks is returned once per
 * block). Lines that do not match the level format, such as `Fib table:`, are skipped.
 */
export function parsePromptReferenceLevels(
    dynamic: string
): readonly PromptReferenceLevel[] {
    return marketReferenceLines(dynamic).flatMap(line => {
        const match = REFERENCE_LEVEL_LINE.exec(line);
        if (match === null) return [];
        const [, priceToken, label] = match;
        return [
            {
                price: parseToken(priceToken),
                decimals: decimalsOf(priceToken),
                label,
            },
        ];
    });
}

/**
 * @internal
 *
 * The modal fractional-digit count of the Market Reference prices, or `2` when the
 * section prints none. Every price of one prompt renders at one precision (see
 * `priceQuoting`), so ties do not occur in practice; one resolves to the larger count.
 */
export function inferPromptPriceDecimals(dynamic: string): number {
    const counts = parsePromptReferenceLevels(dynamic).reduce(
        (acc, level) =>
            acc.set(level.decimals, (acc.get(level.decimals) ?? 0) + 1),
        new Map<number, number>()
    );
    const [modal] = [...counts.entries()].sort(
        ([decimalsA, countA], [decimalsB, countB]) =>
            countB - countA || decimalsB - decimalsA
    );
    return modal === undefined ? DEFAULT_PRICE_DECIMALS : modal[0];
}

/**
 * Headings of the prompt sections that are skill text and instructions rather than computed
 * data. They are full of illustrative numbers (example prices, periods, thresholds), and a
 * price the model wrote must not count as printed because it matches one of those. A
 * section a later prompt version adds is treated as data until it is listed here: a new
 * data section failing open (its prices ground) is a smaller error than flagging every
 * price a new section prints.
 */
const GUIDANCE_SECTION_HEADINGS: readonly string[] = [
    'Indicator Signal Guides',
    'Pattern Analysis',
    'Candlestick Pattern Guides',
    'Strategy Analysis',
    'Prior Analyses',
    'Analysis Request',
    'Field Content Guidance',
];

/** `## ` (exactly two hashes) opens a top-level section; `### ` stays inside it. */
const TOP_LEVEL_HEADING = /^## (?!#)/;

/**
 * The prompt text outside the guidance sections: the header lines before the first `## `
 * heading and every section not in {@link GUIDANCE_SECTION_HEADINGS}. A prompt with no
 * `## ` heading at all is returned whole.
 *
 * @internal
 */
export function computedPromptText(dynamic: string): string {
    const lines = dynamic.split('\n');
    const isGuidance = (line: string): boolean =>
        GUIDANCE_SECTION_HEADINGS.some(name => line.startsWith(`## ${name}`));
    const kept = lines.reduce<{
        readonly out: readonly string[];
        readonly skip: boolean;
    }>(
        (acc, line) => {
            const skip = TOP_LEVEL_HEADING.test(line)
                ? isGuidance(line)
                : acc.skip;
            return { out: skip ? acc.out : [...acc.out, line], skip };
        },
        { out: [], skip: false }
    );
    return kept.out.join('\n');
}

/** ISO dates (`2026-11-20`, `2026-11`), clock times (`09:30`, `09:30:15`) and slash dates. */
const DATE_OR_TIME =
    /\d{4}-\d{1,2}(?:-\d{1,2})?|\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?|\d{1,4}\/\d{1,2}(?:\/\d{1,4})?/g;

/** A token the text writes as a percentage (`54.00%`, `54 %`). */
const FOLLOWED_BY_PERCENT = /^\s?%/;

/** A minus sign (not the hyphen of a range or a word) directly in front of the token. */
function isNegated(text: string, index: number): boolean {
    const sign = text[index - 1];
    if (sign !== '-' && sign !== '\u2212') return false;
    const before = text[index - 2];
    return before === undefined || !/[\w.)]/.test(before);
}

/**
 * @internal
 *
 * The numbers of the prompt a model price can legitimately be copied from: numeric tokens
 * of the computed sections ({@link computedPromptText}) that are not part of a date or a
 * time, are not written as a percentage and are not negative. Unique by
 * `(value, decimals)`, like {@link extractPromptNumbers}.
 *
 * Without these exclusions a KRW price (0 decimals, so every integer token counts) is
 * "printed" by any year, period or count in the prompt, and `45.30` by `-45.30`.
 */
export function extractGroundingNumbers(
    dynamic: string
): readonly PromptNumber[] {
    const text = computedPromptText(dynamic).replace(DATE_OR_TIME, match =>
        ' '.repeat(match.length)
    );
    const tokens = [...text.matchAll(promptNumberPattern())]
        .filter(
            match =>
                !FOLLOWED_BY_PERCENT.test(
                    text.slice(match.index + match[0].length)
                ) && !isNegated(text, match.index)
        )
        .map(([token]) => ({
            value: parseToken(token),
            decimals: decimalsOf(token),
        }));
    return uniqueNumbers(tokens);
}
