import {
    KST_OFFSET_HOURS,
    MARKET_CLOSE_HOUR,
    MARKET_CLOSE_MINUTE,
    MARKET_OPEN_HOUR,
    MARKET_OPEN_MINUTE,
    MINUTES_PER_DAY,
    MS_PER_DAY,
    MS_PER_HOUR,
    MS_PER_SECOND,
    SECONDS_PER_MINUTE,
} from '@/domain/constants/time';
import {
    US_EQUITY_SESSION,
    getSessionStatus,
    isRegularSessionOpen,
    localSessionParts,
} from '@/domain/session';
import type { EtSessionStatus } from '@/domain/types';

export function parseNumberOrDefault(
    raw: string | undefined,
    defaultValue: number
): number {
    if (raw == null || raw === '') return defaultValue;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function computeSecondsUntilCacheExpiry(
    now: Date,
    expiryHourKst: number
): number {
    const kstNow = new Date(now.getTime() + KST_OFFSET_HOURS * MS_PER_HOUR);

    // 오늘 KST expiryHourKst:00 설정 (kstNow는 UTC+9 오프셋이 더해진 가상 UTC 날짜)
    const kstExpiryToday = new Date(
        Date.UTC(
            kstNow.getUTCFullYear(),
            kstNow.getUTCMonth(),
            kstNow.getUTCDate(),
            expiryHourKst,
            0,
            0,
            0
        )
    );

    const rawDiffMs = kstExpiryToday.getTime() - kstNow.getTime();

    // 현재 시각이 KST expiryHourKst 이후이면 내일 기준으로 전환
    const diffMs = rawDiffMs <= 0 ? rawDiffMs + MS_PER_DAY : rawDiffMs;

    // 최소 1초를 보장하여 Redis EX 0 오류 방지
    return Math.max(1, Math.floor(diffMs / MS_PER_SECOND));
}

// Re-export market-hours constants so the public API surface (index.ts /
// index.client.ts) is unchanged. The canonical definitions live in
// `@/domain/constants/time` to allow both this module and `session.ts` to
// import them without a circular dependency.

/** U.S. regular-session open hour in Eastern Time. */
export { MARKET_OPEN_HOUR } from '@/domain/constants/time';
/** U.S. regular-session open minute in Eastern Time (opens at 09:30). */
export { MARKET_OPEN_MINUTE } from '@/domain/constants/time';
/** U.S. regular-session close hour in Eastern Time. */
export { MARKET_CLOSE_HOUR } from '@/domain/constants/time';
/** U.S. regular-session close minute in Eastern Time (closes at 16:00, exclusive). */
export { MARKET_CLOSE_MINUTE } from '@/domain/constants/time';

/** US 정규장 개장 시각을 자정 기준 분으로 환산 (09:30 → 570). */
const ET_REGULAR_OPEN_MINUTES = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE;

/**
 * Classify an instant into a U.S. regular-session state in Eastern Time.
 *
 * DST-safe: `Intl.DateTimeFormat('America/New_York')` resolves EDT/EST from the
 * calendar position of `now`, so callers never handle the summer-time shift.
 * Pure function — the caller supplies an explicit `now` so results are
 * deterministic and testable without mocking the system clock.
 *
 * @param now - The instant to classify.
 * @returns `'weekend'` (Sat/Sun), `'open'` (weekday 09:30–16:00 ET with the
 *   16:00 close **excluded**), or `'closed'` (any other weekday time).
 */
export function getEtSessionStatus(now: Date): EtSessionStatus {
    return getSessionStatus(US_EQUITY_SESSION, now);
}

/**
 * Whether `now` is inside the U.S. regular session (ET 09:30–16:00, close
 * excluded). DST-safe; thin wrapper over {@link getEtSessionStatus}.
 *
 * @param now - The instant to test.
 * @returns `true` only while the regular session is open.
 */
export function isEtRegularSessionOpen(now: Date): boolean {
    return isRegularSessionOpen(US_EQUITY_SESSION, now);
}

/** @internal 주어진 ET 요일 인덱스(0=일~6=토) 기준 다음 평일까지의 일수. 주말은 건너뛴다. */
function daysToNextWeekday(fromWeekdayIndex: number): number {
    let offset = 1;
    let wd = (fromWeekdayIndex + 1) % 7;
    while (wd === 0 || wd === 6) {
        offset += 1;
        wd = (wd + 1) % 7;
    }
    return offset;
}

/** @internal 다음 뉴욕 정규장 개장(09:30 ET)까지 남은 초를 반환한다. */
export function secondsUntilNextEtRegularOpen(now: Date): number {
    const { weekdayIndex, minutesOfDay } = localSessionParts(
        now,
        'America/New_York'
    );
    const isWeekday = weekdayIndex >= 1 && weekdayIndex <= 5;

    const dayOffset =
        isWeekday && minutesOfDay < ET_REGULAR_OPEN_MINUTES
            ? 0
            : daysToNextWeekday(weekdayIndex);

    const minutesUntilOpen =
        dayOffset * MINUTES_PER_DAY + ET_REGULAR_OPEN_MINUTES - minutesOfDay;
    return minutesUntilOpen * SECONDS_PER_MINUTE - now.getUTCSeconds();
}
