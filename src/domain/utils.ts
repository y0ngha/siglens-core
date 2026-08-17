import {
    KST_OFFSET_HOURS,
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
import { etCalendarDate, isUsTradingDay } from '@/domain/marketCalendar';
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

/**
 * @internal 연휴를 건너뛰기 위한 탐색 상한(일).
 *
 * NYSE에서 가장 긴 연속 휴장은 주말 + 인접 휴일 조합이라 나흘을 넘지 않는다
 * (예: 성금요일 금 + 토 + 일). 예정 외 휴장이 며칠 붙어도(2012 샌디 2일) 여유가 있다.
 * 무한 루프 방지용 상한이지 도메인 규칙이 아니다.
 */
const MAX_CLOSURE_LOOKAHEAD_DAYS = 10;

/**
 * @internal 다음 뉴욕 정규장 개장(09:30 ET)까지 남은 초를 반환한다.
 *
 * 휴장일을 건너뛴다. 종전에는 주말만 건너뛰어서, 예컨대 목요일이 추수감사절일 때
 * "내일 09:30"을 답했지만 그 목요일은 아예 열리지 않았다. 이 값이 캐시 TTL·백오프의
 * 상한으로 쓰이므로, 짧게 잡히면 열리지도 않은 시장을 향해 재조회가 반복된다.
 */
export function secondsUntilNextEtRegularOpen(now: Date): number {
    // US_EQUITY_SESSION is a 'scheduled' spec — the kind guard lets TypeScript
    // narrow to the branch that carries timeZone and openMinute.
    if (US_EQUITY_SESSION.kind !== 'scheduled') return 0;
    const { minutesOfDay } = localSessionParts(now, US_EQUITY_SESSION.timeZone);
    const base = etCalendarDate(now);

    // 오늘 개장 전이면 오늘부터, 아니면 내일부터 찾는다.
    const start = minutesOfDay < US_EQUITY_SESSION.openMinute ? 0 : 1;

    for (
        let offset = start;
        offset <= start + MAX_CLOSURE_LOOKAHEAD_DAYS;
        offset++
    ) {
        // 17:00 UTC로 탐침한다 — EST(정오)든 EDT(13시)든 한낮이라 의도한 ET 날짜를
        // 가리킨다. 자정 근처를 찍으면 DST 전환일에 날짜가 하루 밀릴 수 있다.
        const probe = new Date(
            Date.UTC(base.year, base.month - 1, base.day + offset, 17)
        );
        if (!isUsTradingDay(probe)) continue;

        // 하루를 1440분으로 세는 것은 종전과 같다. DST 전환일에 한 시간 어긋나지만
        // 이 값의 용도가 TTL·백오프라 정확한 타임스탬프가 필요하지 않다.
        const minutesUntilOpen =
            offset * MINUTES_PER_DAY +
            US_EQUITY_SESSION.openMinute -
            minutesOfDay;
        return minutesUntilOpen * SECONDS_PER_MINUTE - now.getUTCSeconds();
    }
    return 0;
}
