import { describe, it, expect } from 'vitest';
import {
    parseNumberOrDefault,
    computeSecondsUntilCacheExpiry,
    getEtSessionStatus,
    isEtRegularSessionOpen,
    secondsUntilNextRegularClose,
    secondsUntilNextRegularOpen,
    secondsUntilNextUtcMidnight,
} from '@/domain/utils';
import { CRYPTO_SESSION, US_EQUITY_SESSION } from '@/domain/session';
import { makeKrSession } from '../helpers/krSession';
import {
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
} from '@/domain/constants/time';

const TEST_EXPIRY_HOUR_KST = 17;

describe('parseNumberOrDefault', () => {
    it('returns defaultValue when raw is undefined', () => {
        expect(parseNumberOrDefault(undefined, 42)).toBe(42);
    });

    it('returns defaultValue when raw is empty string', () => {
        expect(parseNumberOrDefault('', 42)).toBe(42);
    });

    it('parses valid float', () => {
        expect(parseNumberOrDefault('3.14', 0)).toBe(3.14);
    });

    it('parses valid integer', () => {
        expect(parseNumberOrDefault('100', 0)).toBe(100);
    });

    it('returns defaultValue for non-numeric string', () => {
        expect(parseNumberOrDefault('not-a-number', 99)).toBe(99);
    });

    it('returns defaultValue for NaN string', () => {
        expect(parseNumberOrDefault('NaN', 5)).toBe(5);
    });

    it('returns defaultValue for Infinity', () => {
        expect(parseNumberOrDefault('Infinity', 5)).toBe(5);
    });
});

describe('computeSecondsUntilCacheExpiry', () => {
    it('returns seconds remaining before expiry when before that time', () => {
        // KST 14:00 = UTC 05:00
        const now = new Date('2026-04-25T05:00:00.000Z');
        const result = computeSecondsUntilCacheExpiry(
            now,
            TEST_EXPIRY_HOUR_KST
        );
        // KST 17:00 = UTC 08:00 → diff = 3 hours = 10800 seconds
        expect(result).toBe(3 * SECONDS_PER_HOUR);
    });

    it('returns seconds to next day when at exactly expiry time', () => {
        // KST 17:00 = UTC 08:00 — rawDiffMs = 0, so next day
        const now = new Date('2026-04-25T08:00:00.000Z');
        const result = computeSecondsUntilCacheExpiry(
            now,
            TEST_EXPIRY_HOUR_KST
        );
        // next day KST 17:00 = 24 hours = 86400 seconds
        expect(result).toBe(SECONDS_PER_DAY);
    });

    it('returns seconds to next day when after expiry time', () => {
        // KST 20:00 = UTC 11:00
        const now = new Date('2026-04-25T11:00:00.000Z');
        const result = computeSecondsUntilCacheExpiry(
            now,
            TEST_EXPIRY_HOUR_KST
        );
        // next KST 17:00 is in 21 hours = 75600 seconds
        expect(result).toBe(21 * SECONDS_PER_HOUR);
    });

    it('returns at least 1 when diff rounds to 0', () => {
        // KST 16:59:59.500 = UTC 07:59:59.500
        const now = new Date('2026-04-25T07:59:59.500Z');
        const result = computeSecondsUntilCacheExpiry(
            now,
            TEST_EXPIRY_HOUR_KST
        );
        // Math.floor(500ms / 1000) = 0 → Math.max(1, 0) = 1
        expect(result).toBe(1);
    });

    it('handles midnight (KST 00:00 = UTC 15:00 previous day)', () => {
        // KST 00:00 = UTC 15:00 previous day
        const now = new Date('2026-04-24T15:00:00.000Z');
        const result = computeSecondsUntilCacheExpiry(
            now,
            TEST_EXPIRY_HOUR_KST
        );
        // KST 17:00 is 17 hours later = 61200 seconds
        expect(result).toBe(17 * SECONDS_PER_HOUR);
    });
});

describe('isEtRegularSessionOpen', () => {
    it('EDT 평일 정규장 중이면 true (Mon 10:00 ET)', () => {
        expect(isEtRegularSessionOpen(new Date('2026-07-06T14:00:00Z'))).toBe(
            true
        );
    });
    it('EST 평일 정규장 중이면 true (Mon 10:00 ET)', () => {
        expect(isEtRegularSessionOpen(new Date('2026-01-05T15:00:00Z'))).toBe(
            true
        );
    });
    it('개장 전이면 false (Mon 08:00 ET)', () => {
        expect(isEtRegularSessionOpen(new Date('2026-07-06T12:00:00Z'))).toBe(
            false
        );
    });
    it('마감 후면 false (Mon 17:00 ET)', () => {
        expect(isEtRegularSessionOpen(new Date('2026-07-06T21:00:00Z'))).toBe(
            false
        );
    });
    it('주말이면 false (Sat 14:00 ET)', () => {
        expect(isEtRegularSessionOpen(new Date('2026-07-04T18:00:00Z'))).toBe(
            false
        );
    });
    it('정확히 09:30 ET = 개장 포함 (boundary inclusive)', () => {
        // 2026-07-06T13:30:00Z = Mon 09:30 EDT
        expect(isEtRegularSessionOpen(new Date('2026-07-06T13:30:00Z'))).toBe(
            true
        );
    });
    it('정확히 16:00 ET = 마감 제외 (boundary exclusive)', () => {
        // 2026-07-06T20:00:00Z = Mon 16:00 EDT
        expect(isEtRegularSessionOpen(new Date('2026-07-06T20:00:00Z'))).toBe(
            false
        );
    });
    it('일요일이면 false (Sun 12:00 ET)', () => {
        // 2026-07-05T16:00:00Z = Sun 12:00 EDT
        expect(isEtRegularSessionOpen(new Date('2026-07-05T16:00:00Z'))).toBe(
            false
        );
    });
});

describe('getEtSessionStatus', () => {
    it('토요일이면 weekend (Sat 14:00 ET)', () => {
        expect(getEtSessionStatus(new Date('2026-07-04T18:00:00Z'))).toBe(
            'weekend'
        );
    });
    it('EDT 평일 정규장 중이면 open (Mon 10:00 ET)', () => {
        expect(getEtSessionStatus(new Date('2026-07-06T14:00:00Z'))).toBe(
            'open'
        );
    });
    it('정확히 09:30 ET = open (개장 포함, boundary inclusive)', () => {
        // 2026-07-06T13:30:00Z = Mon 09:30 EDT
        expect(getEtSessionStatus(new Date('2026-07-06T13:30:00Z'))).toBe(
            'open'
        );
    });
    it('정확히 16:00 ET = closed (마감 정각 제외, boundary exclusive)', () => {
        // 2026-07-06T20:00:00Z = Mon 16:00 EDT
        expect(getEtSessionStatus(new Date('2026-07-06T20:00:00Z'))).toBe(
            'closed'
        );
    });
    it('개장 전이면 closed (Mon 08:00 ET)', () => {
        expect(getEtSessionStatus(new Date('2026-07-06T12:00:00Z'))).toBe(
            'closed'
        );
    });
    it('서머타임 갈림: 동일 13:30Z가 겨울엔 ET 08:30 → closed', () => {
        // 2026-01-05T13:30:00Z = Mon 08:30 EST (개장 전). 같은 UTC라도 여름엔
        // 09:30 EDT라 open인 것과 대비 — DST 처리 검증.
        expect(getEtSessionStatus(new Date('2026-01-05T13:30:00Z'))).toBe(
            'closed'
        );
    });
});

describe('secondsUntilNextRegularOpen (US)', () => {
    // 09:30 ET 개장. EDT는 13:30 UTC, EST는 14:30 UTC.
    it('EDT 개장 전 → 오늘 개장까지 (Mon 08:00 ET → 90분)', () => {
        expect(
            secondsUntilNextRegularOpen(
                US_EQUITY_SESSION,
                new Date('2026-07-06T12:00:00Z')
            )
        ).toBe(90 * SECONDS_PER_MINUTE);
    });
    it('현재 분의 경과 초를 빼서 정확히 개장 시각에 만료된다 (Mon 08:00:30 ET)', () => {
        // 2026-07-06T12:00:30Z = Mon 08:00:30 EDT → 90분 후 개장, 30초 보정
        expect(
            secondsUntilNextRegularOpen(
                US_EQUITY_SESSION,
                new Date('2026-07-06T12:00:30Z')
            )
        ).toBe(90 * SECONDS_PER_MINUTE - 30);
    });
    it('EST 개장 전 → 오늘 개장까지 (Mon 09:00 ET → 30분)', () => {
        expect(
            secondsUntilNextRegularOpen(
                US_EQUITY_SESSION,
                new Date('2026-01-05T14:00:00Z')
            )
        ).toBe(30 * SECONDS_PER_MINUTE);
    });
    it('EDT 마감 후 → 다음 평일 개장까지 (Mon 17:00 ET → 990분)', () => {
        expect(
            secondsUntilNextRegularOpen(
                US_EQUITY_SESSION,
                new Date('2026-07-06T21:00:00Z')
            )
        ).toBe(990 * SECONDS_PER_MINUTE);
    });
    it('토요일 → 월요일 개장까지 (Sat 14:00 ET → 2610분)', () => {
        expect(
            secondsUntilNextRegularOpen(
                US_EQUITY_SESSION,
                new Date('2026-07-04T18:00:00Z')
            )
        ).toBe(2610 * SECONDS_PER_MINUTE);
    });
    it('금요일 마감 후 → 월요일 개장까지 (Fri 17:00 ET → 3870분)', () => {
        expect(
            secondsUntilNextRegularOpen(
                US_EQUITY_SESSION,
                new Date('2026-07-03T21:00:00Z')
            )
        ).toBe(3870 * SECONDS_PER_MINUTE);
    });
    it('일요일 → 월요일 개장까지 (Sun 14:00 ET → 1170분)', () => {
        // 2026-07-05T18:00:00Z = Sun 14:00 EDT
        expect(
            secondsUntilNextRegularOpen(
                US_EQUITY_SESSION,
                new Date('2026-07-05T18:00:00Z')
            )
        ).toBe(1170 * SECONDS_PER_MINUTE);
    });
});

describe('secondsUntilNextRegularOpen (US) — 휴장일 건너뛰기', () => {
    // 종전에는 주말만 건너뛰어서, 휴장일 전날 밤이면 "열리지도 않는 날의 09:30"까지로
    // 잡혔다. 이 값이 캐시 TTL·백오프의 상한이라 짧게 잡히면 닫힌 시장에 재조회가 반복된다.

    it('추수감사절 전날 마감 후 → 목요일(휴장)을 건너뛰고 금요일 개장까지', () => {
        // 2026-11-25(수) 17:00 ET. 26일은 추수감사절 휴장 → 27일(금) 09:30이 다음 개장.
        // 990분(수 17:00→목 09:30) + 1440분(하루) = 2430분.
        expect(
            secondsUntilNextRegularOpen(
                US_EQUITY_SESSION,
                new Date('2026-11-25T22:00:00Z')
            )
        ).toBe(2430 * SECONDS_PER_MINUTE);
    });

    it('휴장일 당일 아침에도 그날이 아니라 다음 거래일을 가리킨다', () => {
        // 2026-11-26(목) 08:00 ET — 개장 전이지만 휴장일이다. 다음은 27일(금) 09:30.
        // 90분 + 1440분 = 1530분.
        expect(
            secondsUntilNextRegularOpen(
                US_EQUITY_SESSION,
                new Date('2026-11-26T13:00:00Z')
            )
        ).toBe(1530 * SECONDS_PER_MINUTE);
    });

    it('휴장일이 금요일이면 주말까지 함께 건너뛴다', () => {
        // 2026-07-02(목) 17:00 ET. 3일(금)은 독립기념일 관측 휴장, 4~5일 주말
        // → 다음 개장은 6일(월) 09:30. 990분 + 3×1440분 = 5310분.
        expect(
            secondsUntilNextRegularOpen(
                US_EQUITY_SESSION,
                new Date('2026-07-02T21:00:00Z')
            )
        ).toBe(5310 * SECONDS_PER_MINUTE);
    });

    it('연속 휴장(성금요일 + 주말)도 건너뛴다', () => {
        // 2026-04-02(목) 17:00 ET. 3일 성금요일 휴장, 4~5일 주말 → 6일(월) 09:30.
        expect(
            secondsUntilNextRegularOpen(
                US_EQUITY_SESSION,
                new Date('2026-04-02T21:00:00Z')
            )
        ).toBe(5310 * SECONDS_PER_MINUTE);
    });

    it('예정 외 휴장도 건너뛴다', () => {
        // 2025-01-08(수) 17:00 ET. 9일은 카터 국가 애도의 날로 폐장 → 10일(금) 09:30.
        expect(
            secondsUntilNextRegularOpen(
                US_EQUITY_SESSION,
                new Date('2025-01-08T22:00:00Z')
            )
        ).toBe(2430 * SECONDS_PER_MINUTE);
    });

    it('반장은 거래일이므로 건너뛰지 않는다', () => {
        // 2026-11-26(목, 휴장) 다음은 27일(금) 반장 — 열리기는 하므로 그날 09:30이 답이다.
        expect(
            secondsUntilNextRegularOpen(
                US_EQUITY_SESSION,
                new Date('2026-11-26T13:00:00Z')
            )
        ).toBe(1530 * SECONDS_PER_MINUTE);
    });
});

describe('secondsUntilNextRegularOpen (US) — DST 전환일', () => {
    it('봄 전환을 가로지르면 실제 경과 시간을 잰다 (Sat 12:00 EST → Mon 09:30 EDT)', () => {
        // 2026-03-08(일) 02:00에 EST→EDT. 토 17:00Z(12:00 EST)에서 월 13:30Z(09:30 EDT)까지
        // 44.5시간 — 하루를 1440분으로 세던 종전 산식은 한 시간 더 길게 잰다(163800초).
        expect(
            secondsUntilNextRegularOpen(
                US_EQUITY_SESSION,
                new Date('2026-03-07T17:00:00Z')
            )
        ).toBe(160200);
    });
    it('가을 전환을 가로지르면 실제 경과 시간을 잰다 (Sat 12:00 EDT → Mon 09:30 EST)', () => {
        // 2026-11-01(일) 02:00에 EDT→EST. 토 16:00Z(12:00 EDT)에서 월 14:30Z까지 46.5시간.
        expect(
            secondsUntilNextRegularOpen(
                US_EQUITY_SESSION,
                new Date('2026-10-31T16:00:00Z')
            )
        ).toBe(167400);
    });
});

describe('secondsUntilNextRegularOpen — KRX 모형 스펙', () => {
    // 09:00 KST = 00:00 UTC. KST는 DST가 없다.
    const kr = makeKrSession();

    it('KST 평일 마감 후(Mon 23:00 KST = 14:00Z)에는 다음 개장(Tue 00:00Z)까지 10시간 — ET 개장(13:30Z)이 아니다', () => {
        expect(
            secondsUntilNextRegularOpen(kr, new Date('2026-07-06T14:00:00Z'))
        ).toBe(10 * SECONDS_PER_HOUR);
    });
    it('휴장일(Tue)을 건너뛰고 수요일 개장까지', () => {
        // 2026-07-07(화) 휴장 → 수 00:00Z. 월 14:00Z부터 34시간.
        expect(
            secondsUntilNextRegularOpen(
                makeKrSession(['2026-07-07']),
                new Date('2026-07-06T14:00:00Z')
            )
        ).toBe(34 * SECONDS_PER_HOUR);
    });
    it('개장 전(Mon 08:00 KST = Sun 23:00Z)에는 오늘 개장까지', () => {
        expect(
            secondsUntilNextRegularOpen(kr, new Date('2026-07-05T23:00:00Z'))
        ).toBe(SECONDS_PER_HOUR);
    });
    it('always-open 스펙에는 다음 개장이 없어 0이다', () => {
        expect(
            secondsUntilNextRegularOpen(
                CRYPTO_SESSION,
                new Date('2026-07-06T14:00:00Z')
            )
        ).toBe(0);
    });
});

describe('secondsUntilNextRegularClose', () => {
    const SETTLE = 30;

    it('EDT 장중: 마감 + 버퍼까지 (Mon 15:00 EDT → 16:30까지 90분)', () => {
        expect(
            secondsUntilNextRegularClose(
                US_EQUITY_SESSION,
                new Date('2026-07-06T19:00:00Z'),
                SETTLE
            )
        ).toBe(90 * SECONDS_PER_MINUTE);
    });
    it('EST 장중: 같은 현지 시각이어도 UTC 경계가 다르다 (Mon 15:00 EST → 16:30까지 90분)', () => {
        expect(
            secondsUntilNextRegularClose(
                US_EQUITY_SESSION,
                new Date('2026-01-05T20:00:00Z'),
                SETTLE
            )
        ).toBe(90 * SECONDS_PER_MINUTE);
    });
    it('버퍼 구간(마감 직후)에는 오늘의 마감 + 버퍼를 가리킨다', () => {
        // Mon 16:10 EDT — 이미 마감했지만 정착 버퍼 안이라 16:30까지 20분.
        expect(
            secondsUntilNextRegularClose(
                US_EQUITY_SESSION,
                new Date('2026-07-06T20:10:00Z'),
                SETTLE
            )
        ).toBe(20 * SECONDS_PER_MINUTE);
    });
    it('버퍼 이후에는 다음 거래일 마감 + 버퍼까지', () => {
        // Mon 16:40 EDT → Tue 16:30 EDT = 23시간 50분.
        expect(
            secondsUntilNextRegularClose(
                US_EQUITY_SESSION,
                new Date('2026-07-06T20:40:00Z'),
                SETTLE
            )
        ).toBe(23 * SECONDS_PER_HOUR + 50 * SECONDS_PER_MINUTE);
    });
    it('버퍼를 생략하면 정각 마감까지', () => {
        expect(
            secondsUntilNextRegularClose(
                US_EQUITY_SESSION,
                new Date('2026-07-06T19:00:00Z')
            )
        ).toBe(SECONDS_PER_HOUR);
    });
    it('반장(13:00 ET)은 그날의 실제 마감을 쓴다', () => {
        // 2026-11-27(금) 반장. 12:00 EST(17:00Z) → 13:30까지 90분.
        expect(
            secondsUntilNextRegularClose(
                US_EQUITY_SESSION,
                new Date('2026-11-27T17:00:00Z'),
                SETTLE
            )
        ).toBe(90 * SECONDS_PER_MINUTE);
    });
    it('휴장일은 건너뛴다 (Wed 17:00 ET → 목 추수감사절 건너뛰고 금 반장 13:00)', () => {
        // 2026-11-25(수) 22:00Z → 11-27(금) 반장 13:30 EST(18:30Z): 44.5시간.
        expect(
            secondsUntilNextRegularClose(
                US_EQUITY_SESSION,
                new Date('2026-11-25T22:00:00Z'),
                SETTLE
            )
        ).toBe(44 * SECONDS_PER_HOUR + 30 * SECONDS_PER_MINUTE);
    });
    it('KRX 모형: 평일 장중(Mon 14:00 KST = 05:00Z)은 15:30 + 버퍼 = 16:00 KST(07:00Z)까지 2시간', () => {
        expect(
            secondsUntilNextRegularClose(
                makeKrSession(),
                new Date('2026-07-06T05:00:00Z'),
                SETTLE
            )
        ).toBe(2 * SECONDS_PER_HOUR);
    });
    it('KRX 모형: 휴장일 당일에는 그날 마감이 없어 다음 거래일 마감을 가리킨다', () => {
        // 2026-07-07(화) 휴장, 10:00 KST(01:00Z) → 수 07:00Z까지 30시간.
        expect(
            secondsUntilNextRegularClose(
                makeKrSession(['2026-07-07']),
                new Date('2026-07-07T01:00:00Z'),
                SETTLE
            )
        ).toBe(30 * SECONDS_PER_HOUR);
    });
    it('always-open 스펙은 null이다', () => {
        expect(
            secondsUntilNextRegularClose(
                CRYPTO_SESSION,
                new Date('2026-07-06T05:00:00Z')
            )
        ).toBeNull();
    });
    it('모든 날이 휴장인 잘못된 스펙은 null이다', () => {
        const allClosed = {
            ...makeKrSession(),
            closeMinuteFor: () => 0,
        };
        expect(
            secondsUntilNextRegularClose(
                allClosed,
                new Date('2026-07-06T05:00:00Z')
            )
        ).toBeNull();
    });
});

describe('secondsUntilNextUtcMidnight', () => {
    it('다음 UTC 자정까지의 초', () => {
        expect(
            secondsUntilNextUtcMidnight(new Date('2026-07-06T18:30:00Z'))
        ).toBe(5.5 * SECONDS_PER_HOUR);
    });
    it('자정 정각이면 24시간 뒤', () => {
        expect(
            secondsUntilNextUtcMidnight(new Date('2026-07-06T00:00:00Z'))
        ).toBe(SECONDS_PER_DAY);
    });
    it('자정 직전 반 초는 최소 1초로 올린다', () => {
        expect(
            secondsUntilNextUtcMidnight(new Date('2026-07-06T23:59:59.500Z'))
        ).toBe(1);
    });
});
