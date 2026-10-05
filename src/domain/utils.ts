import {
    KST_OFFSET_HOURS,
    MS_PER_DAY,
    MS_PER_HOUR,
    MS_PER_SECOND,
} from '@/domain/constants/time';
import {
    US_EQUITY_SESSION,
    getSessionStatus,
    isRegularSessionOpen,
    nextRegularSessionBoundaryMs,
} from '@/domain/session';
import type { EtSessionStatus, MarketSessionSpec } from '@/domain/types';

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
 * @internal 다음 정규장 개장까지 남은 초를 반환한다. 세션 스펙에 따라 어느 시장이든 쓴다.
 *
 * 주말과 `closeMinuteFor` 휴장일을 건너뛴다. 종전 `secondsUntilNextEtRegularOpen`도 NYSE
 * 휴장일은 건너뛰었지만 시간대가 ET로 고정돼 있었다. 이 함수는 스펙의 시간대·주말·
 * 캘린더를 따르므로 KRX 같은 비-ET 시장도 맞게 잰다 — 시장을 잘못 짚으면(ET 기준으로
 * KRX를 재면) 한국 장중 내내 TTL이 몇 시간으로 늘어 시세가 얼어붙는다. 또 하루를
 * 1440분으로 세지 않고 DST 전환일의 실제 경과 시간을 잰다(전환 주말에만 ±3600초 차이).
 * 이 값이 캐시 TTL·백오프의 상한이라, 짧게 잡히면 열리지도 않은 시장을 향해 재조회가
 * 반복된다.
 *
 * `always-open` 스펙에는 "다음 개장"이 없어 `0`을 돌려준다 — 호출자는 상시 개장
 * 경로를 따로 처리해야 한다. 탐색 상한 안에 거래일이 없는 잘못된 스펙도 `0`이다.
 */
export function secondsUntilNextRegularOpen(
    session: MarketSessionSpec,
    now: Date
): number {
    if (session.kind !== 'scheduled') return 0;
    const atMs = nextRegularSessionBoundaryMs(session, now, 'open');
    if (atMs === null) return 0;
    return Math.ceil((atMs - now.getTime()) / MS_PER_SECOND);
}

/**
 * @internal 다음 정규장 마감 + `bufferMinutes`까지 남은 초를 반환한다.
 *
 * 버퍼 구간(마감 직후)에는 오늘의 마감+버퍼를 가리키므로, 마감 직후 정착 전 가격으로
 * 만든 결과가 다음 거래일까지 살아남지 않는다. 휴장일·반장·DST는
 * {@link secondsUntilNextRegularOpen}과 같은 규칙으로 처리한다.
 *
 * @returns 초. `always-open` 스펙이거나 탐색 상한 안에 거래일이 없으면 `null`.
 */
export function secondsUntilNextRegularClose(
    session: MarketSessionSpec,
    now: Date,
    bufferMinutes: number = 0
): number | null {
    if (session.kind !== 'scheduled') return null;
    const atMs = nextRegularSessionBoundaryMs(
        session,
        now,
        'close',
        bufferMinutes
    );
    if (atMs === null) return null;
    return Math.ceil((atMs - now.getTime()) / MS_PER_SECOND);
}

/** @internal 다음 UTC 00:00(24/7 시장의 일봉 마감)까지 남은 초. 최소 1초. */
export function secondsUntilNextUtcMidnight(now: Date): number {
    const nextMidnightMs =
        (Math.floor(now.getTime() / MS_PER_DAY) + 1) * MS_PER_DAY;
    return Math.max(
        1,
        Math.ceil((nextMidnightMs - now.getTime()) / MS_PER_SECOND)
    );
}
