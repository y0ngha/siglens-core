import type { MarketSessionSpec } from '@/domain/types';

export type ScheduledSessionSpec = Extract<
    MarketSessionSpec,
    { kind: 'scheduled' }
>;

/** KST 달력 날짜(`YYYY-MM-DD`) — KST는 DST가 없어 +9h 보정으로 충분하다. */
function kstDate(now: Date): string {
    return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * core는 KRX 스펙을 갖지 않는다(consumer가 주입). 세션 일반 함수가 비-ET 스펙에서
 * 맞는지 보려는 테스트용 모형 — 09:00~15:30 KST, 주말 휴장, `holidays`의 KST 날짜는 휴장.
 */
export function makeKrSession(
    holidays: readonly string[] = []
): ScheduledSessionSpec {
    return {
        kind: 'scheduled',
        timeZone: 'Asia/Seoul',
        openMinute: 9 * 60,
        closeMinute: 15 * 60 + 30,
        weekendDays: [0, 6],
        closeMinuteFor: now =>
            holidays.includes(kstDate(now)) ? 0 : 15 * 60 + 30,
    };
}
