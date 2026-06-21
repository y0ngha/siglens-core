import type { EtSessionStatus } from '@/domain/types';

/**
 * Declarative trading-session schedule. `always-open` = 24/7 (crypto);
 * `scheduled` = a regional regular session (US ET today, KST later).
 * Pure data so callers can branch without per-market code.
 *
 * DST is handled automatically by `Intl.DateTimeFormat` with the IANA
 * `timeZone` — no `dst` field is needed on the spec.
 */
export type MarketSessionSpec =
    | { kind: 'always-open' }
    | {
          kind: 'scheduled';
          timeZone: string; // IANA, e.g. 'America/New_York'
          openMinute: number; // minutes from local midnight
          closeMinute: number; // close excluded
          weekendDays: number[]; // local weekday indexes (0=Sun..6=Sat)
      };

/** US NYSE regular session: 09:30–16:00 ET, Mon–Fri. */
export const US_EQUITY_SESSION: MarketSessionSpec = {
    kind: 'scheduled',
    timeZone: 'America/New_York',
    openMinute: 9 * 60 + 30,
    closeMinute: 16 * 60,
    weekendDays: [0, 6],
};

/** Crypto: trades 24/7. */
export const CRYPTO_SESSION: MarketSessionSpec = { kind: 'always-open' };

/** Per-timezone `Intl.DateTimeFormat` cache — avoids allocating a new formatter per call. */
const _dtfCache = new Map<string, Intl.DateTimeFormat>();

/** Returns (or creates and caches) a formatter for the given IANA `timeZone`. */
function _getDtf(timeZone: string): Intl.DateTimeFormat {
    let dtf = _dtfCache.get(timeZone);
    if (dtf === undefined) {
        dtf = new Intl.DateTimeFormat('en-US', {
            timeZone,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        });
        _dtfCache.set(timeZone, dtf);
    }
    return dtf;
}

/** Derive local weekday index (0=Sun..6=Sat) and minutes-of-day for `now` in `timeZone`. */
function localSessionParts(
    now: Date,
    timeZone: string
): { weekdayIndex: number; minutesOfDay: number } {
    const fmt = _getDtf(timeZone);
    const parts = fmt.formatToParts(now);
    const wd = parts.find(p => p.type === 'weekday')?.value ?? 'Sun';
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
    const map: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
    };
    return { weekdayIndex: map[wd] ?? 0, minutesOfDay: hour * 60 + minute };
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
): EtSessionStatus {
    if (spec.kind === 'always-open') return 'open';
    const { weekdayIndex, minutesOfDay } = localSessionParts(
        now,
        spec.timeZone
    );
    if (spec.weekendDays.includes(weekdayIndex)) return 'weekend';
    if (minutesOfDay >= spec.openMinute && minutesOfDay < spec.closeMinute) {
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
