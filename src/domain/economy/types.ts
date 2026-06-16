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

/** Single US economic-calendar event (post-filter). */
export interface EconomicCalendarEvent {
    /** Event datetime verbatim from FMP (`YYYY-MM-DD HH:mm:ss`). */
    date: string;
    /** Event name as provided by FMP (e.g. `'Fed Rate Decision'`). */
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

/** Macro snapshot bundle that drives the `/economy` page and the briefing prompt. */
export interface EconomySnapshot {
    /** Normalized series per indicator in registry order. */
    indicators: EconomicIndicatorSeries[];
    /** Latest treasury yields; `null` when the rates response is empty/unavailable. */
    treasury: TreasuryRateSnapshot | null;
    /** Upcoming US events, ascending by date. */
    calendar: EconomicCalendarEvent[];
}

/** Macro regime label produced by the AI briefing. */
export type MacroRegime =
    | 'expansion'
    | 'slowdown'
    | 'contraction'
    | 'recovery'
    | 'neutral';

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
