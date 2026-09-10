/**
 * Shared formatting utilities for AI prompt builders.
 *
 * These helpers are intentionally free of any LLM-specific logic — they only
 * convert domain values into compact, human-readable strings suitable for
 * injection into prompt templates.
 */

import type { CurrencyCode, Timeframe } from '@/domain/types';

/**
 * Human-readable timeframe labels used in prompt headers.
 *
 * Lives here rather than in `prompt.ts` so that both the technical prompt
 * builder and `priorAnalysisSection.ts` can read the same map without the two
 * modules importing each other — a cycle that would otherwise form, since the
 * prompt builder also imports the prior-analysis renderer. `promptFormat.ts`
 * imports only the `Timeframe` type, so it is the natural neutral home.
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
 * Character length of `YYYY-MM-DD HH:mm` — the prompt's bar-timestamp format.
 *
 * Named rather than inlined because {@link formatBarDateTime} slices an ISO
 * string down to it, and a bare `16` there reads as an arbitrary cut.
 */
const DATETIME_DISPLAY_LENGTH = 16;

/**
 * @internal
 * Bar timestamps rendered into prompts as `YYYY-MM-DD HH:mm` (UTC).
 *
 * Lives here for the same reason as {@link TIMEFRAME_LABEL}: `prompt.ts` and
 * `priorAnalysisSection.ts` must render bar times **identically** or the model
 * cannot line a past call up with the bar it was made on, and the two modules
 * cannot import each other.
 *
 * Why minute precision matters on intraday timeframes: date-only text makes
 * every call made in one session collapse to a single string, so the only
 * remaining ordering signal is the `N bars ago` count — and that count cannot
 * be converted back into elapsed time by the reader, because bar-indexed
 * distance skips overnight and weekend gaps. `20 bars ago` on a 15-minute
 * chart reads as five hours but can span a whole night.
 */
export function formatBarDateTime(timeMs: number): string {
    return new Date(timeMs)
        .toISOString()
        .replace('T', ' ')
        .slice(0, DATETIME_DISPLAY_LENGTH);
}

/**
 * Format a nullable number for prompt injection.
 *
 * Returns the number rounded to `dp` decimal places, or the literal string
 * `'N/A'` when the value is `null`, `undefined`, or non-finite. The default of
 * 2 decimal places matches typical financial data display conventions.
 *
 * Non-finite values are absent values: `NaN.toFixed(2)` is the literal `'NaN'`,
 * and a provider feed that divides by a zero volume or a zero close would
 * otherwise put that token straight into a paid prompt, where the model reads
 * it as data. A value that rounds to zero also drops its sign — `-0.00` tells
 * the model a direction the number does not carry.
 *
 * @param n  - The number to format, or `null` / `undefined`.
 * @param dp - Decimal places to use (default: `2`).
 * @returns Formatted string, e.g. `"3.14"` or `"N/A"`.
 */
export function formatNullableNumber(
    n: number | null | undefined,
    dp = 2
): string {
    if (n == null || !Number.isFinite(n)) return 'N/A';
    const text = n.toFixed(dp);
    return Number(text) === 0 ? text.replace('-', '') : text;
}

/**
 * @internal
 * A signed percent (`+1.23%` / `-0.45%`), or `'N/A'` for a non-finite value.
 *
 * Replaces the `n >= 0 ? '+' : ''` + `toFixed` pattern, which printed `NaN%` (and no
 * sign) for a missing change and `+-0.00%`-style noise near zero.
 */
export function formatSignedPercent(n: number | null | undefined): string {
    const text = formatNullableNumber(n);
    if (text === 'N/A') return text;
    return text.startsWith('-') ? `${text}%` : `+${text}%`;
}

/** Significant digits kept when stripping binary float noise from a plain figure. */
const PLAIN_NUMBER_SIGNIFICANT_DIGITS = 10;

/**
 * @internal
 * A figure as the source published it, minus binary float noise — or `'N/A'`.
 *
 * Macro releases were interpolated with `String(value)`, which passes
 * `0.30000000000000004` and `NaN` straight into the prompt. Clean values render
 * byte-identically (`0.3`, `4.415`, `29723.864`), so no precision is imposed.
 */
export function formatPlainNumber(n: number | null | undefined): string {
    if (n == null || !Number.isFinite(n)) return 'N/A';
    return String(Number(n.toPrecision(PLAIN_NUMBER_SIGNIFICANT_DIGITS)));
}

/** Canonical KRX symbol: six digits plus the KOSPI (`.KS`) or KOSDAQ (`.KQ`) suffix. */
const KRX_SYMBOL_PATTERN = /^\d{6}\.(KS|KQ)$/i;

/**
 * @internal
 * Whether the symbol is a KRX (KOSPI/KOSDAQ) listing.
 *
 * Consumers pass canonical symbols with the exchange suffix embedded
 * (`005930.KS`), so the suffix alone identifies the market. Prompts need this
 * for two things the asset class cannot express: the listing is not a U.S.
 * equity, and its prices are quoted in whole won.
 */
export function isKrxListedSymbol(symbol: string): boolean {
    return KRX_SYMBOL_PATTERN.test(symbol);
}

/** @internal Quote currency implied by the symbol's listing (KRX → KRW, else USD). */
export function listingCurrency(symbol: string): CurrencyCode {
    return isKrxListedSymbol(symbol) ? 'KRW' : 'USD';
}

/**
 * @internal
 * Framing sentence for an equity listing — U.S. by default, Korean for KRX.
 *
 * The U.S. sentence is kept byte-identical to the one every builder already
 * emitted. The KRX sentence exists because Korean listings travel with
 * `assetClass: 'equity'`, and the U.S. framing made models cite U.S.-only
 * benchmarks (sector ETFs, VIX) on Korean charts.
 */
export function equityListingContext(symbol: string): string {
    return isKrxListedSymbol(symbol)
        ? 'This is a Korean equity listed on the KRX (KOSPI/KOSDAQ). Prices are quoted in KRW (whole won, no decimal ticks) and the regular session runs 09:00–15:30 KST. Do not describe it as a U.S. stock or cite U.S.-only benchmarks, indices, or sector ETFs.'
        : 'This is a publicly traded U.S. equity.';
}

/** Decimal places for prices of one unit or more (USD cent precision). */
const DEFAULT_PRICE_DECIMAL_PLACES = 2;
/** Significant digits kept for sub-unit prices (e.g. `0.08359`). */
const SUB_UNIT_PRICE_SIGNIFICANT_DIGITS = 4;
/** Ceiling on decimals so a corrupt near-zero price cannot request absurd precision. */
const MAX_PRICE_DECIMAL_PLACES = 10;

/**
 * @internal
 * Decimal places to render prices at, from a reference price's magnitude.
 *
 * A fixed two decimals erased every sub-dollar asset: SHIBUSD rendered every
 * bar as `O:0.00 H:0.00 L:0.00 C:0.00`, and DOGEUSD collapsed its moving
 * averages, ATR, and MACD to `0.08`/`0.00`. Sub-unit prices therefore keep four
 * significant digits. KRW is quoted in whole won, so it takes none — `269500.00`
 * claims precision the market does not have.
 *
 * Pick it **once per prompt** from the latest close and apply it to every
 * price-scale value, so a MACD line and its signal never render at different
 * precisions.
 */
export function priceDecimalPlaces(
    referencePrice: number | null | undefined,
    currency: CurrencyCode = 'USD'
): number {
    if (currency === 'KRW') return 0;
    if (
        referencePrice == null ||
        !Number.isFinite(referencePrice) ||
        referencePrice <= 0 ||
        referencePrice >= 1
    ) {
        return DEFAULT_PRICE_DECIMAL_PLACES;
    }
    const magnitude = Math.floor(Math.log10(referencePrice));
    return Math.min(
        MAX_PRICE_DECIMAL_PLACES,
        SUB_UNIT_PRICE_SIGNIFICANT_DIGITS - 1 - magnitude
    );
}

/**
 * @internal
 * One price at the precision its own magnitude calls for — for builders that
 * receive isolated levels (overall, chat) rather than a bar series.
 */
export function formatPrice(
    price: number | null | undefined,
    currency: CurrencyCode = 'USD'
): string {
    return formatNullableNumber(price, priceDecimalPlaces(price, currency));
}

const TRILLION = 1e12;
const BILLION = 1e9;
const MILLION = 1e6;
const SCALED_AMOUNT_DECIMAL_PLACES = 1;

/**
 * @internal
 * A large money amount scaled to T/B/M with its currency, or `'N/A'`.
 *
 * The prompts used to print `(n / 1e9).toFixed(0)B USD` unconditionally. A KRX
 * market cap arrives in won, which rendered as roughly `1600000B USD`, and a
 * sub-$500M U.S. small cap rendered as `0B`.
 */
export function formatLargeAmount(
    n: number | null | undefined,
    currency: CurrencyCode
): string {
    if (n == null || !Number.isFinite(n)) return 'N/A';
    const abs = Math.abs(n);
    if (abs >= TRILLION) {
        return `${formatNullableNumber(n / TRILLION, SCALED_AMOUNT_DECIMAL_PLACES)}T ${currency}`;
    }
    if (abs >= BILLION) {
        return `${formatNullableNumber(n / BILLION, SCALED_AMOUNT_DECIMAL_PLACES)}B ${currency}`;
    }
    if (abs >= MILLION) {
        return `${formatNullableNumber(n / MILLION, SCALED_AMOUNT_DECIMAL_PLACES)}M ${currency}`;
    }
    return `${formatNullableNumber(n, 0)} ${currency}`;
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
