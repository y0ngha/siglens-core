import type { EtSessionStatus } from '@/domain/types';

/**
 * Declarative trading-session schedule. `always-open` = 24/7 (crypto);
 * `scheduled` = a regional regular session (US ET today, KST later).
 * Pure data so callers can branch without per-market code.
 */
export type MarketSessionSpec =
    | { kind: 'always-open' }
    | {
          kind: 'scheduled';
          timeZone: string; // IANA, e.g. 'America/New_York'
          openMinute: number; // minutes from local midnight
          closeMinute: number; // close excluded
          weekendDays: number[]; // local weekday indexes (0=Sun..6=Sat)
          dst: 'us' | 'none';
      };

/** US NYSE regular session: 09:30–16:00 ET, Mon–Fri. */
export const US_EQUITY_SESSION: MarketSessionSpec = {
    kind: 'scheduled',
    timeZone: 'America/New_York',
    openMinute: 9 * 60 + 30,
    closeMinute: 16 * 60,
    weekendDays: [0, 6],
    dst: 'us',
};

/** Crypto: trades 24/7. */
export const CRYPTO_SESSION: MarketSessionSpec = { kind: 'always-open' };

/** Local weekday index (0=Sun..6=Sat) and minutes-of-day for `now` in `timeZone`. */
export function localSessionParts(
    now: Date,
    timeZone: string
): { weekdayIndex: number; minutesOfDay: number } {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wd = parts.find(p => p.type === 'weekday')?.value ?? 'Sun';
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0') % 24;
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

/** Classify `now` against a session spec. */
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

/** Whether `now` is inside the regular session for this spec. */
export function isRegularSessionOpen(
    spec: MarketSessionSpec,
    now: Date
): boolean {
    return getSessionStatus(spec, now) === 'open';
}
