export const KST_OFFSET_HOURS = 9;

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3_600;
export const SECONDS_PER_DAY = 86_400;
export const SECONDS_PER_YEAR = 31_536_000;

export const MINUTES_PER_DAY = 1_440;

// U.S. regular-session open/close times (ET) — single source of truth consumed
// by both session.ts (US_EQUITY_SESSION spec) and utils.ts (ET session helpers).
// Placing these here breaks the session.ts ↔ utils.ts import cycle while
// keeping the values in one canonical location.

/** U.S. regular-session open hour in Eastern Time. */
export const MARKET_OPEN_HOUR = 9;
/** U.S. regular-session open minute in Eastern Time (opens at 09:30). */
export const MARKET_OPEN_MINUTE = 30;
/** U.S. regular-session close hour in Eastern Time. */
export const MARKET_CLOSE_HOUR = 16;
/** U.S. regular-session close minute in Eastern Time (closes at 16:00, exclusive). */
export const MARKET_CLOSE_MINUTE = 0;
