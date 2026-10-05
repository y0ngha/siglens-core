import type { MarketSessionStatus, MarketSessionSpec } from '@/domain/types';
import {
    MARKET_OPEN_HOUR,
    MARKET_OPEN_MINUTE,
    MARKET_CLOSE_HOUR,
    MARKET_CLOSE_MINUTE,
    MS_PER_DAY,
    MS_PER_MINUTE,
    MINUTES_PER_DAY,
} from '@/domain/constants/time';
import { usMarketCloseMinute } from '@/domain/marketCalendar';

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
    // NYSE 휴장일·반장은 규칙으로 계산된다 — `marketCalendar.ts` 참조. 이게 없으면
    // 추수감사절에도 정규장으로 판정하고, 13:00 반장 뒤 3시간을 개장으로 읽는다.
    closeMinuteFor: usMarketCloseMinute,
};

/** Crypto: trades 24/7. */
export const CRYPTO_SESSION: MarketSessionSpec = { kind: 'always-open' };

/**
 * Field options shared by every zone's formatter — weekday, calendar date and
 * clock, all of which {@link localSessionParts} reads.
 */
function clockFormatOptions(timeZone: string): Intl.DateTimeFormatOptions {
    return {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    };
}

/**
 * Eagerly-created, immutable formatters for known IANA time zones.
 *
 * Known zones (`America/New_York` for {@link US_EQUITY_SESSION} and
 * `Asia/Seoul` for KRX specs supplied by consumers) are pre-allocated at module
 * load so the hot path never allocates during a request. Zones not listed here
 * fall back to an inline `new Intl.DateTimeFormat` call in
 * {@link localSessionParts} — non-crashing but not pre-warmed.
 */
const _dtfByZone: Readonly<Record<string, Intl.DateTimeFormat>> = {
    'America/New_York': new Intl.DateTimeFormat(
        'en-US',
        clockFormatOptions('America/New_York')
    ),
    'Asia/Seoul': new Intl.DateTimeFormat(
        'en-US',
        clockFormatOptions('Asia/Seoul')
    ),
};

/**
 * @internal Local calendar date, weekday and clock position of an instant in an
 * IANA zone.
 *
 * Shape returned by {@link localSessionParts}. The calendar date is what lets a
 * caller turn another day's open/close into a UTC instant.
 */
export interface SessionParts {
    /** Local calendar year (e.g. 2026). */
    year: number;
    /** 1-12. */
    month: number;
    /** Local day of month, 1-31. */
    day: number;
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
 * @internal Decompose an IANA-zoned instant into its local calendar date,
 * weekday index (0=Sun…6=Sat) and minutes elapsed since local midnight.
 */
export function localSessionParts(now: Date, timeZone: string): SessionParts {
    // Use the pre-created eager formatter for known zones; fall back to an
    // inline formatter for any zone not in _dtfByZone (non-crashing, on-demand).
    const fmt =
        _dtfByZone[timeZone] ??
        new Intl.DateTimeFormat('en-US', clockFormatOptions(timeZone));
    const parts = fmt.formatToParts(now);
    // A missing part would otherwise become `Number('') === 0` and flow into
    // `Date.UTC` as day 0 / month 0 — a silently wrong date. Fail loudly instead.
    const get = (type: Intl.DateTimeFormatPartTypes): string => {
        const value = parts.find(p => p.type === type)?.value;
        if (value === undefined) {
            throw new RangeError(
                `localSessionParts: Intl output for ${timeZone} lacks "${type}"`
            );
        }
        return value;
    };
    return {
        year: Number(get('year')),
        month: Number(get('month')),
        day: Number(get('day')),
        weekdayIndex: WEEKDAY_INDEX[get('weekday')] ?? 0,
        minutesOfDay: Number(get('hour')) * 60 + Number(get('minute')),
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
    // 거래소 캘린더가 있으면 그날의 실제 마감이 스펙의 기본 마감을 이긴다.
    // `0`은 휴장 — 어떤 시각도 개장 구간에 들지 않는다.
    const closeMinute = spec.closeMinuteFor?.(now) ?? spec.closeMinute;
    if (spec.openMinute <= minutesOfDay && minutesOfDay < closeMinute) {
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

/**
 * @internal 연휴를 건너뛰기 위한 탐색 상한(일).
 *
 * 주요 거래소에서 가장 긴 연속 휴장은 주말 + 인접 휴일 조합이라 나흘을 넘지 않는다
 * (예: 성금요일 금 + 토 + 일). KRX 설·추석 연휴처럼 5~6일 붙는 경우와 예정 외
 * 휴장이 며칠 겹쳐도 여유가 있다. 무한 루프 방지용 상한이지 도메인 규칙이 아니다.
 */
const MAX_CLOSURE_LOOKAHEAD_DAYS = 10;

/** `at` 시점의 존 오프셋(ms) — 현지 벽시계 − UTC 벽시계. */
function zoneOffsetMs(at: Date, timeZone: string): number {
    const c = localSessionParts(at, timeZone);
    const localMs =
        Date.UTC(c.year, c.month - 1, c.day) + c.minutesOfDay * MS_PER_MINUTE;
    // localSessionParts는 분 해상도라 UTC 쪽도 분으로 절사해야 초 단위 오차가 남지 않는다.
    const utcMs = Math.floor(at.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE;
    return localMs - utcMs;
}

/**
 * 현지 달력 날짜 + 현지 분(minutes-of-day)을 UTC epoch ms로 환산한다.
 *
 * 오프셋을 두 번 재는 이유: 첫 추정은 "현지 벽시계를 UTC로 읽은 값"이라 DST 전환일에는
 * 전환 전/후 중 어느 쪽 오프셋인지 알 수 없다. 1차 보정으로 얻은 순간에서 오프셋을 다시
 * 재면 전환의 올바른 쪽에 들어간다. `minutesOfDay`가 1440을 넘으면 다음 날로 넘어간다.
 */
function localWallClockToUtcMs(
    year: number,
    month: number,
    day: number,
    minutesOfDay: number,
    timeZone: string
): number {
    const wallMs =
        Date.UTC(year, month - 1, day) + minutesOfDay * MS_PER_MINUTE;
    const firstPass = wallMs - zoneOffsetMs(new Date(wallMs), timeZone);
    return wallMs - zoneOffsetMs(new Date(firstPass), timeZone);
}

/**
 * @internal `now` 이후(초과)에 오는 **가장 이른** 정규장 개장/마감 순간의 UTC epoch ms.
 *
 * 주말과 `closeMinuteFor` 휴장일(`0`)을 건너뛰고, 반장은 그날의 실제 마감을 쓴다.
 * 순서대로 오늘부터 훑으므로 장중에는 오늘 마감, 마감 후에는 다음 거래일 마감이 나온다.
 * DST 전환일도 날짜별로 오프셋을 다시 재므로 정확하다.
 *
 * @param spec - `scheduled` 세션 스펙.
 * @param now - 기준 시각.
 * @param boundary - `'open'` 개장, `'close'` 마감.
 * @param offsetMinutes - 경계에 더할 분(예: 마감 후 정착 버퍼). 더한 뒤의 순간이 `now`를
 *   넘는 첫 날을 고른다 — 그래서 버퍼 구간 안에서는 오늘의 마감+버퍼가 나온다.
 * @returns epoch ms, 탐색 상한 안에 거래일이 없으면 `null`(잘못된 스펙).
 */
export function nextRegularSessionBoundaryMs(
    spec: Extract<MarketSessionSpec, { kind: 'scheduled' }>,
    now: Date,
    boundary: 'open' | 'close',
    offsetMinutes: number = 0
): number | null {
    const { minutesOfDay } = localSessionParts(now, spec.timeZone);
    const nowMs = now.getTime();
    for (let offset = 0; offset <= MAX_CLOSURE_LOOKAHEAD_DAYS; offset++) {
        // 대상 날짜의 현지 정오 부근(DST 전환일에도 ±1h)을 찍어 날짜를 읽는다. 자정
        // 근처를 찍으면 전환일에 날짜가 하루 밀릴 수 있다. `closeMinuteFor`도 이
        // 순간을 받으므로 "그 날짜에 속한 순간"이라는 계약을 지킨다.
        const probe = new Date(
            nowMs +
                offset * MS_PER_DAY +
                (MINUTES_PER_DAY / 2 - minutesOfDay) * MS_PER_MINUTE
        );
        const day = localSessionParts(probe, spec.timeZone);
        if (spec.weekendDays.includes(day.weekdayIndex)) continue;
        const closeMinute = spec.closeMinuteFor?.(probe) ?? spec.closeMinute;
        if (closeMinute <= 0) continue;
        const boundaryMinute =
            boundary === 'open' ? spec.openMinute : closeMinute;
        const atMs = localWallClockToUtcMs(
            day.year,
            day.month,
            day.day,
            boundaryMinute + offsetMinutes,
            spec.timeZone
        );
        if (atMs > nowMs) return atMs;
    }
    return null;
}
