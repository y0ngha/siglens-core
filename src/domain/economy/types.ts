import type { NewsSentiment } from '@/domain/types';

/** Calendar event importance. Mirrors FMP `impact` values. */
export type CalendarImpact = 'Low' | 'Medium' | 'High';

/** A single point in an economic-indicator time series. */
export interface EconomicIndicatorPoint {
    /** ISO date (`YYYY-MM-DD`). */
    date: string;
    /** Reported indicator value in its native unit (registry-defined per `name`). */
    value: number;
}

/**
 * Normalized series for one economic indicator (e.g. `federalFunds`).
 *
 * `latest` is the most recent release, `previous` is the one before it,
 * and `trend` contains the most-recent-to-oldest points (up to N).
 */
export interface EconomicIndicatorSeries {
    /** FMP economic-indicators `name` (e.g. `'federalFunds'`). Matches the registry key. */
    name: string;
    /** Most recent release point, or `null` when the FMP response has no usable rows. */
    latest: EconomicIndicatorPoint | null;
    /** Release immediately preceding `latest`; `null` when only one point is available. */
    previous: EconomicIndicatorPoint | null;
    /** Most-recent-to-oldest points for the mini-trend (capped to a fixed length). */
    trend: EconomicIndicatorPoint[];
    /**
     * Unit label for `latest`/`previous`/`trend` values (e.g. `'%'`, `'K'`),
     * mirroring {@link EconomicCalendarEvent.unit}. Optional and caller-
     * supplied — this series carries no built-in per-`name` registry, so the
     * caller (which does know each indicator's unit) is the only source.
     * Drives the macro-briefing prompt's rate-type (`%` -> percentage-point
     * delta) vs level-type (delta + `%` change) formatting. `undefined` renders as level-type.
     */
    unit?: string;
}

/** Selected yields extracted from the most recent treasury-rates row. */
export interface TreasuryRateSnapshot {
    /** ISO date of the rate snapshot (`YYYY-MM-DD`). */
    date: string;
    /** 2-year treasury yield in percentage points; `null` when missing from the FMP response. */
    year2: number | null;
    /** 10-year treasury yield in percentage points; `null` when missing from the FMP response. */
    year10: number | null;
}

/** Single economic-calendar event (post-filter). The country is the caller's filter, not a property of this type. */
export interface EconomicCalendarEvent {
    /** Event datetime verbatim from FMP (`YYYY-MM-DD HH:mm:ss`). */
    date: string;
    /** Event name as provided by FMP (e.g. `'Interest Rate Decision'`). */
    event: string;
    /** Market impact classification. */
    impact: CalendarImpact;
    /** Reported actual value; `null` before the release. */
    actual: number | null;
    /** Analyst consensus estimate; `null` when unavailable. */
    estimate: number | null;
    /** Previous period's reported value; `null` when unavailable. */
    previous: number | null;
    /** Unit label for the numeric fields (e.g. `'%'`). */
    unit: string;
}

/** Options for `selectCalendarEvents`. */
export interface SelectCalendarEventsOptions {
    /** Upper bound on returned events, rate decisions included; a non-positive or non-finite value returns none. */
    max: number;
    /**
     * Drops events before this instant (an event at exactly `notBefore` is
     * kept), and events whose date cannot be parsed. Omit to keep every row
     * (the caller's fetch window already bounds it).
     */
    notBefore?: Date;
}

/** Result of `selectCalendarEvents`. */
export interface CalendarSelection {
    /** Picked events, date-ascending, as given (dates are not rewritten). */
    events: EconomicCalendarEvent[];
    /** Eligible events left out by `max`, per impact. */
    omitted: Record<CalendarImpact, number>;
}

/** Macro snapshot bundle that drives the `/economy` page and the briefing prompt. */
export interface EconomySnapshot {
    /** Normalized series per indicator in registry order. */
    indicators: EconomicIndicatorSeries[];
    /** Latest treasury yields; `null` when the rates response is empty/unavailable. */
    treasury: TreasuryRateSnapshot | null;
    /** Upcoming events for the requested country, ascending by date. */
    calendar: EconomicCalendarEvent[];
}

/** Macro regime label produced by the AI briefing. */
export type MacroRegime =
    'expansion' | 'slowdown' | 'contraction' | 'recovery' | 'neutral';

/**
 * Normalized macro AI briefing response.
 *
 * `summary` is required: if empty, callers must treat the briefing as failed.
 */
export interface MacroBriefingResponse {
    /** Korean (존댓말) 1–2 paragraph summary of the current US macro regime. */
    summary: string;
    /** Korean (존댓말) bullet highlights (may be empty). */
    highlights: string[];
    /** Current macro regime label. */
    regime: MacroRegime;
}

// Application result types (`SubmitMacroBriefingResult` / `PollMacroBriefingResult`
// and their named variants) live in `application/economy/types.ts` — the layer
// that produces them — mirroring the financials pattern (Architecture #0).

// ─────────────────────────────────────────
// Economic Event AI Analysis
// ─────────────────────────────────────────

/**
 * Input fields extracted from an announced economic-calendar event that the
 * AI-analysis prompt needs. Actual vs estimate vs previous is the primary
 * signal for the LLM's market-implication assessment.
 */
export interface EconomicEventAnalysisInput {
    /**
     * Which economy the release belongs to, as a display label
     * (e.g. `'미국'`, `'한국'`).
     *
     * **Required, and deliberately not defaulted.** Many event names carry no
     * country (`'Interest Rate Decision'`, `'CPI YoY'`), so without this the
     * model falls back on its priors and narrates a Bank of Korea decision in
     * Federal Reserve terms. A default of `'미국'` would reintroduce exactly
     * that failure silently, which is why the field is mandatory.
     *
     * It also enters the analysis cache key — the same event name with the same
     * figures in two economies must not share one cached interpretation.
     */
    region: string;
    /** Event name as provided by FMP (e.g. `'CPI MoM'`). */
    event: string;
    /** Market impact classification of the event. */
    impact: CalendarImpact;
    /** Reported actual value; `null` before the release or when unavailable. */
    actual: number | null;
    /** Analyst consensus estimate; `null` when unavailable. */
    estimate: number | null;
    /** Previous period's reported value; `null` when unavailable. */
    previous: number | null;
    /** Unit label for the numeric fields (e.g. `'%'`, `'K'`). */
    unit: string;
}

/**
 * Normalized AI-analysis result for a single announced economic event.
 *
 * Reuses {@link NewsSentiment} (`bullish` / `neutral` / `bearish`) as the
 * market-implication tri-state — "bullish" means the release supports
 * risk-on/rate-cut expectations; "bearish" means risk-off/hawkish pressure;
 * "neutral" means in-line or mixed signals.
 */
export interface EconomicEventAnalysis {
    /**
     * Market-implication sentiment for the release.
     *
     * - `bullish`: data supports risk assets / rate-cut expectations.
     * - `bearish`: data implies risk-off / hawkish pressure on the region's
     *   rates or its own currency.
     * - `neutral`: release in line with estimates or signals are mixed.
     */
    sentiment: NewsSentiment;
    /**
     * Korean (존댓말) one-to-two sentence factual summary of what was
     * announced: actual figure, deviation from estimate/previous.
     */
    summaryKo: string;
    /**
     * Korean (존댓말) market-interpretation commentary: what the release
     * implies for the region's risk assets, interest rates, or its own
     * currency — never another economy's.
     */
    interpretationKo: string;
}

/**
 * Loose raw shape for defensive normalization of the LLM payload.
 *
 * @internal Every field is typed as `unknown` because the LLM may omit or
 * mis-type any key; the normalizer coerces each field via `as*` helpers.
 */
export type RawEconomicEventAnalysis = Record<string, unknown>;
