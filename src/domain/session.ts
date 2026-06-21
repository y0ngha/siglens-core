import type { MarketSessionStatus, MarketSessionSpec } from '@/domain/types';
import {
    MARKET_OPEN_HOUR,
    MARKET_OPEN_MINUTE,
    MARKET_CLOSE_HOUR,
    MARKET_CLOSE_MINUTE,
} from '@/domain/constants/time';

/**
 * US NYSE regular session: 09:30–16:00 ET, Mon–Fri.
 *
 * `openMinute` and `closeMinute` are derived from the shared market-hours
 * constants ({@link MARKET_OPEN_HOUR}/{@link MARKET_OPEN_MINUTE} and
 * {@link MARKET_CLOSE_HOUR}/{@link MARKET_CLOSE_MINUTE}) so there is a
 * single source of truth for the ET session boundaries across this module
 * and `utils.ts`.
 */
export const US_EQUITY_SESSION: MarketSessionSpec = {
    kind: 'scheduled',
    timeZone: 'America/New_York',
    openMinute: MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE,
    closeMinute: MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE,
    weekendDays: [0, 6],
};

/** Crypto: trades 24/7. */
export const CRYPTO_SESSION: MarketSessionSpec = { kind: 'always-open' };

/**
 * Eagerly-created, immutable formatters for known IANA time zones.
 *
 * Known zones (currently only `America/New_York` for {@link US_EQUITY_SESSION})
 * are pre-allocated at module load so the hot ET path never allocates during a
 * request. Zones not listed here fall back to an inline `new Intl.DateTimeFormat`
 * call in {@link localSessionParts} — non-crashing but not pre-warmed.
 */
const _dtfByZone: Readonly<Record<string, Intl.DateTimeFormat>> = {
    'America/New_York': new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }),
};

/**
 * @internal Weekday index + minutes-since-local-midnight decomposition.
 *
 * Shape returned by {@link localSessionParts} — local weekday + clock position
 * for a given IANA time zone.
 */
export interface SessionParts {
    /** Local weekday index (0 = Sun … 6 = Sat). */
    weekdayIndex: number;
    /** Minutes elapsed since local midnight (0–1439). */
    minutesOfDay: number;
}

/** Stable weekday abbreviation → index map shared by all callers. */
const WEEKDAY_INDEX: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
};

/**
 * @internal Decompose an IANA-zoned instant into local weekday index (0=Sun…6=Sat)
 * and minutes elapsed since local midnight.
 */
export function localSessionParts(now: Date, timeZone: string): SessionParts {
    // Use the pre-created eager formatter for known zones; fall back to an
    // inline formatter for any zone not in _dtfByZone (non-crashing, on-demand).
    const fmt =
        _dtfByZone[timeZone] ??
        new Intl.DateTimeFormat('en-US', {
            timeZone,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        });
    const parts = fmt.formatToParts(now);
    const wd = parts.find(p => p.type === 'weekday')?.value ?? 'Sun';
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
    return {
        weekdayIndex: WEEKDAY_INDEX[wd] ?? 0,
        minutesOfDay: hour * 60 + minute,
    };
}

/**
 * Classify an instant against a {@link MarketSessionSpec}.
 *
 * DST-safe: the IANA `timeZone` on `spec` is resolved via `Intl.DateTimeFormat`,
 * so summer-time transitions are handled automatically by the platform without
 * any manual offset arithmetic.
 *
 * @param spec - The session schedule to evaluate against. Use
 *   {@link US_EQUITY_SESSION} for NYSE, {@link CRYPTO_SESSION} for 24/7 assets.
 * @param now - The instant to classify.
 * @returns `'open'` when the session is active (including any `always-open`
 *   spec), `'weekend'` when `now` falls on a configured weekend day, or
 *   `'closed'` for any other weekday time outside the open window.
 */
export function getSessionStatus(
    spec: MarketSessionSpec,
    now: Date
): MarketSessionStatus {
    if (spec.kind === 'always-open') return 'open';
    const { weekdayIndex, minutesOfDay } = localSessionParts(
        now,
        spec.timeZone
    );
    if (spec.weekendDays.includes(weekdayIndex)) return 'weekend';
    if (spec.openMinute <= minutesOfDay && minutesOfDay < spec.closeMinute) {
        return 'open';
    }
    return 'closed';
}

/**
 * Return `true` when `now` falls inside the regular trading session for
 * the given {@link MarketSessionSpec}.
 *
 * Thin wrapper over {@link getSessionStatus} that collapses the 3-state
 * result to a boolean. DST-safe — see {@link getSessionStatus} for details.
 *
 * @param spec - The session schedule to evaluate against. Use
 *   {@link US_EQUITY_SESSION} for NYSE, {@link CRYPTO_SESSION} for 24/7 assets.
 * @param now - The instant to test.
 * @returns `true` only while the session is open (i.e. `getSessionStatus`
 *   returns `'open'`); `false` on weekends or closed weekday hours.
 */
export function isRegularSessionOpen(
    spec: MarketSessionSpec,
    now: Date
): boolean {
    return getSessionStatus(spec, now) === 'open';
}
