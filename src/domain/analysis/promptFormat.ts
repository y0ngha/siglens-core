/**
 * Shared formatting utilities for AI prompt builders.
 *
 * These helpers are intentionally free of any LLM-specific logic — they only
 * convert domain values into compact, human-readable strings suitable for
 * injection into prompt templates.
 */

import type { AssetClass, CurrencyCode, Timeframe } from '@/domain/types';
import { MS_PER_DAY, MS_PER_SECOND } from '@/domain/constants/time';
import { roundToKrxTick, type KrxTickTable } from '@/domain/analysis/krxTick';

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
 * `YYYY-MM-DD` from a bar's Unix-seconds `time` on a daily chart,
 * `YYYY-MM-DD HH:MM UTC` on an intraday one — a date-only stamp collapses
 * every key point of an hourly pattern onto the same calendar day (real-data
 * defect: an hourly double bottom printed both troughs and the neckline all
 * dated the same day, with no way to tell them apart).
 */
export function formatBarDate(
    unixSeconds: number,
    timeframe: Timeframe
): string {
    const date = new Date(unixSeconds * MS_PER_SECOND);
    if (timeframe === '1Day') return date.toISOString().slice(0, 10);
    return `${formatBarDateTime(date.getTime())} UTC`;
}

/**
 * @internal Whole calendar days between two `Date`s' UTC dates — today is
 * `0`, tomorrow `1`, yesterday `-1` — regardless of either `Date`'s
 * time-of-day (spec 2026-09-18). A raw `Math.round(ms diff / MS_PER_DAY)`
 * drifted: at `now = …T20:00Z`, a target dated "today" (parsed as UTC
 * midnight) is 20 hours in the PAST, rounding to `-1` — "1 day ago" for an
 * event still happening today.
 *
 * Pure `Date`-to-`Date` version of {@link calendarDayDiff}'s day math, for a
 * caller that already holds a parsed `Date` — in particular one normalized
 * to UTC via {@link parseCalendarDate} for a naive `YYYY-MM-DD HH:mm:ss`
 * timestamp, where `new Date(targetIso)` would silently reparse as local
 * time (spec 2026-09-28 — the news prompt's macro-calendar section hit this
 * exact bug before routing through `parseCalendarDate` first).
 */
export function calendarDayDiffFromDate(target: Date, now: Date): number {
    const targetDateOnly = Date.UTC(
        target.getUTCFullYear(),
        target.getUTCMonth(),
        target.getUTCDate()
    );
    const nowDateOnly = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
    );
    return Math.round((targetDateOnly - nowDateOnly) / MS_PER_DAY);
}

/**
 * @internal Whole calendar days from `now`'s UTC date to `targetIso`'s UTC
 * date (spec 2026-09-18). `null` when `targetIso` cannot be parsed.
 *
 * Parses `targetIso` with a bare `new Date(...)`, which is only safe for a
 * date-only (`YYYY-MM-DD`) or already-zoned string — both are UTC per the
 * `Date` spec. A naive `YYYY-MM-DD HH:mm:ss` timestamp (FMP's economic
 * calendar) parses as **local** time here; callers with that shape must
 * parse via {@link parseCalendarDate} first and call
 * {@link calendarDayDiffFromDate} on the normalized `Date` instead.
 */
export function calendarDayDiff(targetIso: string, now: Date): number | null {
    const target = new Date(targetIso);
    if (Number.isNaN(target.getTime())) return null;
    return calendarDayDiffFromDate(target, now);
}

/**
 * @internal
 * Parses a calendar timestamp as UTC. FMP's economic calendar returns naive
 * `YYYY-MM-DD HH:mm:ss` timestamps in UTC with no zone suffix; `new
 * Date(isoDate)` parses a space-separated, zone-less string as **local**
 * time per the JS Date spec, which silently shifts every event by the
 * runtime's UTC offset. Appending `Z` (after normalizing the separator)
 * forces the intended UTC interpretation. Date-only (`YYYY-MM-DD`) is
 * already UTC midnight per the Date spec.
 *
 * Shared by {@link buildMacroBriefingPrompt} (`economy/macroBriefingPrompt.ts`)
 * and the news prompt's macro-calendar section (`analysis/newsPrompt.ts`) —
 * both render FMP calendar rows and must not silently drift by the
 * runtime's UTC offset (spec 2026-09-28).
 *
 * `labelUtc` is true when the printed string is a naive time, so the caller
 * can name its zone in the rendered text.
 */
export function parseCalendarDate(
    isoDate: string
): { date: Date; labelUtc: boolean } | null {
    const hasTime = isoDate.includes('T') || isoDate.includes(' ');
    const normalized = isoDate.replace(' ', 'T');
    const hasZone = /Z$|[+-]\d\d:?\d\d$/.test(normalized);
    const date = new Date(hasTime && !hasZone ? `${normalized}Z` : normalized);
    if (Number.isNaN(date.getTime())) return null;
    return { date, labelUtc: hasTime && !hasZone };
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
 * A signed number (`+1.23` / `-0.45`), or `'N/A'` for a non-finite value.
 *
 * Shared by every signed-delta formatter in this codebase (percent, pp,
 * ATR-multiples, raw diffs) so the sign/zero handling lives in one place —
 * {@link formatNullableNumber} already drops the sign for a value that
 * rounds to exactly zero (never `-0.00`); this only adds the `+` a plain
 * `toFixed` does not.
 */
export function formatSignedNumber(
    n: number | null | undefined,
    dp = 2
): string {
    const text = formatNullableNumber(n, dp);
    if (text === 'N/A') return text;
    return text.startsWith('-') ? text : `+${text}`;
}

/**
 * @internal
 * A signed percent (`+1.23%` / `-0.45%`), or `'N/A'` for a non-finite value.
 *
 * Replaces the `n >= 0 ? '+' : ''` + `toFixed` pattern, which printed `NaN%` (and no
 * sign) for a missing change and `+-0.00%`-style noise near zero.
 */
export function formatSignedPercent(n: number | null | undefined): string {
    const text = formatSignedNumber(n);
    return text === 'N/A' ? text : `${text}%`;
}

/**
 * Significant digits kept when stripping binary float noise from a plain figure.
 *
 * 15 is the most a double round-trips exactly. Ten used to cut real digits off large
 * published figures (`29723864123.45` became `29723864120`).
 */
const PLAIN_NUMBER_SIGNIFICANT_DIGITS = 15;

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

/**
 * @internal
 * Framing sentence for an equity listing — U.S. by default, Korean for a KRW quote.
 *
 * Keyed on the supplied quote currency, never on the symbol (see {@link CurrencyCode}).
 * The U.S. sentence is kept byte-identical to the one every builder already emitted. The
 * Korean sentence exists because Korean listings travel with `assetClass: 'equity'`, and
 * the U.S. framing made models cite U.S.-only benchmarks (sector ETFs, VIX) on Korean
 * charts.
 */
export function equityListingContext(currency: CurrencyCode = 'USD'): string {
    return currency === 'KRW'
        ? 'This is a Korean equity listed on the KRX (KOSPI/KOSDAQ). Prices are quoted in KRW (whole won, no decimal ticks) and the regular session runs 09:00–15:30 KST. Do not describe it as a U.S. stock or cite U.S.-only benchmarks, indices, or sector ETFs.'
        : 'This is a publicly traded U.S. equity.';
}

/** Decimal places for equity prices of one unit or more (USD cent precision). */
const DEFAULT_PRICE_DECIMAL_PLACES = 2;
/** Decimal places of a KRW price: whole won. */
const KRW_WHOLE_WON_DECIMAL_PLACES = 0;
/** Significant digits kept for sub-unit equity prices (e.g. `0.08359`). */
const SUB_UNIT_PRICE_SIGNIFICANT_DIGITS = 4;
/**
 * Significant digits kept for crypto prices at every magnitude.
 *
 * Crypto has no cent tick: a 5-minute XRP bar near 2.50 moves in the third decimal, so two
 * decimals printed whole runs of identical `O:2.50 H:2.50 L:2.50 C:2.50` rows.
 */
const CRYPTO_PRICE_SIGNIFICANT_DIGITS = 5;
/**
 * Significant digits kept for difference-scale values (MACD, ATR, momentum, Elder-Ray).
 *
 * Those values are a small fraction of the price, so the price's precision can erase them:
 * at whole-won precision a KRX histogram of `-0.4` renders `0`, and the crossover it
 * carries disappears.
 */
const DIFFERENCE_SIGNIFICANT_DIGITS = 3;
/**
 * Ceiling on decimals so a corrupt near-zero price cannot request absurd precision. High
 * enough for meme-coin quotes near `1e-8`, which a ceiling of 10 truncated.
 */
const MAX_PRICE_DECIMAL_PLACES = 15;

/** Decimals that keep `significantDigits` of a positive finite value. */
const decimalsForSignificantDigits = (
    value: number,
    significantDigits: number
): number => significantDigits - 1 - Math.floor(Math.log10(value));

const clampDecimals = (dp: number, min: number): number =>
    Math.min(MAX_PRICE_DECIMAL_PLACES, Math.max(min, dp));

const isPositiveFinite = (n: number | null | undefined): n is number =>
    n != null && Number.isFinite(n) && n > 0;

/**
 * @internal
 * Decimal places to render prices at, from a reference price's magnitude.
 *
 * A fixed two decimals erased every sub-dollar asset: SHIBUSD rendered every
 * bar as `O:0.00 H:0.00 L:0.00 C:0.00`, and DOGEUSD collapsed its moving
 * averages to `0.08`. Sub-unit equity prices therefore keep four significant
 * digits and crypto keeps five at every magnitude (never fewer than two
 * decimals). KRW is quoted in whole won, so it takes none — `269500.00` claims
 * precision the market does not have.
 *
 * Pick it **once per prompt** from the latest close and apply it to every
 * price-scale value, so a band and the close it brackets never render at
 * different precisions. Difference-scale values take
 * {@link differenceDecimalPlaces} instead.
 */
export function priceDecimalPlaces(
    referencePrice: number | null | undefined,
    currency: CurrencyCode = 'USD',
    assetClass: AssetClass = 'equity'
): number {
    if (currency === 'KRW') return KRW_WHOLE_WON_DECIMAL_PLACES;
    if (!isPositiveFinite(referencePrice)) return DEFAULT_PRICE_DECIMAL_PLACES;
    if (assetClass === 'crypto') {
        return clampDecimals(
            decimalsForSignificantDigits(
                referencePrice,
                CRYPTO_PRICE_SIGNIFICANT_DIGITS
            ),
            DEFAULT_PRICE_DECIMAL_PLACES
        );
    }
    if (referencePrice >= 1) return DEFAULT_PRICE_DECIMAL_PLACES;
    return clampDecimals(
        decimalsForSignificantDigits(
            referencePrice,
            SUB_UNIT_PRICE_SIGNIFICANT_DIGITS
        ),
        0
    );
}

/**
 * @internal
 * Decimal places for difference-scale values (MACD line/signal/histogram, ATR, squeeze
 * momentum, Elder-Ray), from a typical difference magnitude such as the latest ATR.
 *
 * Never fewer decimals than the prices themselves, and enough to keep three significant
 * digits of `scale`. Falls back to `priceDp` when `scale` is unusable.
 */
export function differenceDecimalPlaces(
    scale: number | null | undefined,
    priceDp: number
): number {
    if (!isPositiveFinite(scale)) return priceDp;
    return clampDecimals(
        decimalsForSignificantDigits(scale, DIFFERENCE_SIGNIFICANT_DIGITS),
        priceDp
    );
}

/**
 * @internal
 * One precision for a set of isolated prices (overall key levels, chat targets).
 *
 * Formatting each level at its own magnitude printed `0.9950` next to `1.01` in one list;
 * the smallest usable price decides, so every level gets the decimals the finest one needs.
 */
export function sharedPriceDecimalPlaces(
    prices: readonly number[],
    currency: CurrencyCode = 'USD',
    assetClass: AssetClass = 'equity'
): number {
    return sharedPriceQuoting(prices, currency, assetClass).dp;
}

/**
 * How a prompt quotes prices: the decimals, and — for a KRX listing — the
 * tick table every price-axis value is rounded to.
 *
 * `krxTick` is the explicit "this is a KRX price" signal: it is `null` for
 * every non-KRW listing, so no caller infers the market from the decimals.
 */
export interface PriceQuoting {
    readonly dp: number;
    readonly krxTick: KrxTickTable | null;
}

/**
 * @internal
 * The {@link PriceQuoting} of a listing, picked **once per prompt** from the
 * latest close (see {@link priceDecimalPlaces}). `krxTick` is ignored unless
 * `currency` is KRW.
 */
export function priceQuoting(
    referencePrice: number | null | undefined,
    currency: CurrencyCode = 'USD',
    assetClass: AssetClass = 'equity',
    krxTick: KrxTickTable = 'share'
): PriceQuoting {
    return {
        dp: priceDecimalPlaces(referencePrice, currency, assetClass),
        krxTick: currency === 'KRW' ? krxTick : null,
    };
}

/**
 * @internal
 * {@link PriceQuoting} for a set of isolated prices — the {@link sharedPriceDecimalPlaces}
 * precision plus the listing's KRX tick table.
 */
export function sharedPriceQuoting(
    prices: readonly number[],
    currency: CurrencyCode = 'USD',
    assetClass: AssetClass = 'equity',
    krxTick: KrxTickTable = 'share'
): PriceQuoting {
    const usable = prices.filter(isPositiveFinite);
    return priceQuoting(
        usable.length > 0 ? Math.min(...usable) : null,
        currency,
        assetClass,
        krxTick
    );
}

/**
 * @internal
 * A price-axis value as the market quotes it under `quoting`: a KRX price
 * rounded to its tick, any other price unchanged — `formatNullableNumber`
 * then rounds the decimals. Only for prices: a difference-scale value (ATR,
 * MACD, a pattern height) at whole-won precision is not a quote and keeps
 * `formatNullableNumber`.
 */
export function roundQuotedPrice(price: number, quoting: PriceQuoting): number {
    return quoting.krxTick === null
        ? price
        : roundToKrxTick(price, quoting.krxTick);
}

/**
 * @internal
 * {@link formatNullableNumber} for a price-axis value: a KRX price is printed
 * at its KRX tick (`205,325` → `205500`), so the model cites and the chart
 * draws prices the market can quote. `'N/A'` for a missing or non-finite value.
 */
export function formatQuotedPrice(
    price: number | null | undefined,
    quoting: PriceQuoting
): string {
    return formatNullableNumber(
        price == null ? price : roundQuotedPrice(price, quoting),
        quoting.dp
    );
}

/**
 * @internal
 * One price at the precision its own magnitude calls for — for a lone figure (an options
 * underlying, a fallback level) rather than a list or a bar series. A KRW price is
 * printed at its KRX tick on `krxTick`'s table.
 */
export function formatPrice(
    price: number | null | undefined,
    currency: CurrencyCode = 'USD',
    krxTick: KrxTickTable = 'share'
): string {
    return formatQuotedPrice(
        price,
        priceQuoting(price, currency, 'equity', krxTick)
    );
}

/** Largest first; the unit row renders sub-million amounts unscaled. */
const LARGE_AMOUNT_SCALES = [
    { divisor: 1e12, suffix: 'T', dp: 1 },
    { divisor: 1e9, suffix: 'B', dp: 1 },
    { divisor: 1e6, suffix: 'M', dp: 1 },
    { divisor: 1, suffix: '', dp: 0 },
] as const;

/**
 * @internal
 * A large money amount scaled to T/B/M, suffixed with its currency when one is known, or
 * `'N/A'`.
 *
 * The prompts used to print `(n / 1e9).toFixed(0)B USD` unconditionally. A KRX market cap
 * arrives in won, which rendered as roughly `1600000B USD`, and a sub-$500M U.S. small cap
 * rendered as `0B`. An amount whose rounding reaches the next scale moves up to it, so
 * `999_950_000` reads `1.0B` rather than `1000.0M` (while `960_000_000` stays `960.0M`).
 *
 * `currency` is a free ISO code, not {@link CurrencyCode}: statement amounts carry the
 * filer's reporting currency, which for an ADR is not the listing's (TSM reports in TWD).
 * Omit it when that currency is unknown — an unlabelled amount is honest, a wrong label is
 * a 30× error.
 */
export function formatLargeAmount(
    n: number | null | undefined,
    currency?: string
): string {
    if (n == null || !Number.isFinite(n)) return 'N/A';
    const unit = currency ? ` ${currency}` : '';
    const render = (scale: (typeof LARGE_AMOUNT_SCALES)[number]): string =>
        `${formatNullableNumber(n / scale.divisor, scale.dp)}${scale.suffix}${unit}`;
    const index = LARGE_AMOUNT_SCALES.findIndex(s => Math.abs(n) >= s.divisor);
    // Below one unit (including 0) nothing matches; render it unscaled.
    const scale =
        LARGE_AMOUNT_SCALES[index] ??
        LARGE_AMOUNT_SCALES[LARGE_AMOUNT_SCALES.length - 1];
    const larger = LARGE_AMOUNT_SCALES[index - 1];
    const rounded = Math.abs(
        Number(formatNullableNumber(n / scale.divisor, scale.dp))
    );
    return larger !== undefined && rounded >= larger.divisor / scale.divisor
        ? render(larger)
        : render(scale);
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
