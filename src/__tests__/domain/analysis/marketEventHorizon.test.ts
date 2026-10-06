import { describe, expect, it } from 'vitest';
import { newsDrivenWashoutEvent } from '@/domain/analysis/confluenceSection';
import {
    compareMarketEventPriority,
    MARKET_EVENT_CACHE_KEY_CAP,
    marketEventHorizonMs,
    RANKED_IMPACTS,
    selectMarketEvents,
} from '@/domain/analysis/marketEvents';
import { MS_PER_DAY } from '@/domain/constants/time';
import { CRYPTO_SESSION, US_EQUITY_SESSION } from '@/domain/session';
import type {
    Bar,
    MarketEvent,
    MarketSessionSpec,
    NewsCategory,
    NewsImpact,
    NewsSentiment,
    Timeframe,
} from '@/domain/types';
import { narrowMarketEventsForCacheKey } from '@/infrastructure/cache/config';

const utc = (iso: string) => Date.parse(iso);

/** 상한이 있어야 하는 호출에서 `null`을 걸러 낸다 — 단언 없이 `number`로 좁힌다. */
const requireHorizon = (
    session: MarketSessionSpec,
    now: Date,
    timeframe: Timeframe = '1Day'
): number => {
    const horizon = marketEventHorizonMs(timeframe, session, now);
    if (horizon === null) {
        throw new Error(`expected a horizon for ${now.toISOString()}`);
    }
    return horizon;
};

/** 정규장 09:00–15:30 KST, 주말 토·일. 소비자가 넘기는 KRX 스펙과 같은 모양이다. */
const KRX_SESSION: MarketSessionSpec = {
    kind: 'scheduled',
    timeZone: 'Asia/Seoul',
    openMinute: 9 * 60,
    closeMinute: 15 * 60 + 30,
    weekendDays: [0, 6],
};

describe('marketEventHorizonMs', () => {
    it('1Day + scheduled: 가장 늦은 거래일의 일봉 스탬프 + 1일(배타)이다', () => {
        // 화요일 장중 → 화요일 봉 스탬프(10-06 00:00Z) + 1일.
        expect(
            marketEventHorizonMs(
                '1Day',
                US_EQUITY_SESSION,
                new Date('2026-10-06T14:30:00Z')
            )
        ).toBe(utc('2026-10-07T00:00:00Z'));
    });

    it('토요일·일요일 호출은 금요일 기준 — 토요일 00:00Z가 상한이다', () => {
        for (const iso of ['2026-10-03T15:00:00Z', '2026-10-04T15:00:00Z']) {
            expect(
                marketEventHorizonMs('1Day', US_EQUITY_SESSION, new Date(iso))
            ).toBe(utc('2026-10-03T00:00:00Z'));
        }
    });

    it('KRX(UTC+9): 월요일 새벽 KST는 월요일, 토요일 KST는 금요일, 금요일 저녁 KST는 금요일 기준이다', () => {
        // 월요일 08:00 KST = 일요일 23:00Z → 월요일(10-05) 스탬프 + 1일.
        expect(
            requireHorizon(KRX_SESSION, new Date('2026-10-04T23:00:00Z'))
        ).toBe(utc('2026-10-06T00:00:00Z'));
        // 토요일 12:00 KST → 금요일(10-02) 스탬프 + 1일.
        expect(
            requireHorizon(KRX_SESSION, new Date('2026-10-03T03:00:00Z'))
        ).toBe(utc('2026-10-03T00:00:00Z'));
        // 금요일 21:00 KST(= 12:00Z)와 23:59 KST(= 14:59Z) → 금요일.
        for (const iso of ['2026-10-02T12:00:00Z', '2026-10-02T14:59:00Z']) {
            expect(requireHorizon(KRX_SESSION, new Date(iso))).toBe(
                utc('2026-10-03T00:00:00Z')
            );
        }
    });

    it('세션이 없거나 always-open이면 상한이 없다', () => {
        const now = new Date('2026-10-04T15:00:00Z');
        expect(marketEventHorizonMs('1Day', undefined, now)).toBeNull();
        expect(marketEventHorizonMs('1Day', CRYPTO_SESSION, now)).toBeNull();
    });

    it('일봉이 아닌 타임프레임은 상한이 없다', () => {
        const now = new Date('2026-10-04T15:00:00Z');
        for (const timeframe of [
            '5Min',
            '15Min',
            '30Min',
            '1Hour',
            '4Hour',
        ] as const satisfies readonly Timeframe[]) {
            expect(
                marketEventHorizonMs(timeframe, US_EQUITY_SESSION, now)
            ).toBeNull();
        }
    });
});

/**
 * 프롬프트 소비자 둘이 읽는 집합이 1단계 후보(상한 적용)와 전체 이벤트에서 같은지
 * 확인한다. 키와 프롬프트가 같은 후보를 보는 불변식이 깨지면, 키가 못 보는 이벤트가
 * 프롬프트에 실려 오래된 캐시를 서빙하게 된다.
 */
describe('시간 상한이 프롬프트 소비자의 결과를 바꾸지 않는다', () => {
    const DAILY_BAR_COUNT = 30;
    // 상한 20개 컷이 실제로 무는 트라이얼이 섞이도록 컷보다 훨씬 많이 뽑는다.
    const MAX_EVENTS = 2 * MARKET_EVENT_CACHE_KEY_CAP;
    const CATEGORIES: readonly NewsCategory[] = [
        'earnings',
        'guidance',
        'regulation',
        'm_and_a',
    ];
    const SENTIMENTS: readonly NewsSentiment[] = [
        'bullish',
        'neutral',
        'bearish',
    ];
    const IMPACTS: readonly NewsImpact[] = [
        'high',
        'medium',
        'high',
        'medium',
        'low',
    ];

    /** 결정적 난수 — 실패를 재현할 수 있어야 한다. */
    const makeRandom = (seed: number) => {
        let state = seed;
        return () => {
            state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
            return state / 4_294_967_296;
        };
    };

    /** 테스트 구간에 걸린 NYSE 휴장일 — 노동절. 이 날은 일봉이 없다. */
    const HOLIDAYS = ['2026-09-07'];

    const isTradingDay = (ms: number) => {
        const day = new Date(ms).getUTCDay();
        return (
            day !== 0 &&
            day !== 6 &&
            !HOLIDAYS.includes(new Date(ms).toISOString().slice(0, 10))
        );
    };

    /**
     * `lastBarMs`로 끝나는 거래일 일봉. 일봉은 거래소 날짜의 UTC 자정으로 스탬프된다.
     */
    const dailyBarsEndingAt = (lastBarMs: number): Bar[] => {
        const times: number[] = [];
        for (
            let at = lastBarMs;
            times.length < DAILY_BAR_COUNT;
            at -= MS_PER_DAY
        ) {
            if (isTradingDay(at)) times.unshift(at / 1000);
        }
        return times.map(time => ({
            time,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1000,
        }));
    };

    /** 뉴욕 현지 날짜를 UTC 자정으로 찍은 값 — 일봉 스탬프 규칙과 같다. */
    const exchangeDateStamp = (now: Date) => {
        const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/New_York',
        })
            .format(now)
            .split('-')
            .map(Number);
        return Date.UTC(year, month - 1, day);
    };

    /** `now`에서 존재할 수 있는 가장 늦은 일봉 스탬프(오늘 포함). */
    const latestBarStamp = (now: Date) => {
        let at = exchangeDateStamp(now);
        while (!isTradingDay(at)) at -= MS_PER_DAY;
        return at;
    };

    const previousTradingStamp = (stamp: number) => {
        let at = stamp - MS_PER_DAY;
        while (!isTradingDay(at)) at -= MS_PER_DAY;
        return at;
    };

    const randomEvents = (
        random: () => number,
        fromMs: number,
        toMs: number
    ): MarketEvent[] =>
        Array.from({ length: Math.floor(random() * (MAX_EVENTS + 1)) }, () => ({
            publishedAt: new Date(fromMs + random() * (toMs - fromMs)),
            category: CATEGORIES[Math.floor(random() * CATEGORIES.length)],
            sentiment: SENTIMENTS[Math.floor(random() * SENTIMENTS.length)],
            impact: IMPACTS[Math.floor(random() * IMPACTS.length)],
        }));

    // 장중·개장 전·마감 후·주말·휴장일(노동절) 호출 시각.
    const NOWS = [
        '2026-10-06T08:00:00Z',
        '2026-10-06T14:30:00Z',
        '2026-10-07T00:30:00Z',
        '2026-10-03T15:00:00Z',
        '2026-10-04T15:00:00Z',
        '2026-10-05T03:00:00Z',
        '2026-09-07T15:00:00Z',
    ].map(iso => new Date(iso));

    it('selectMarketEvents는 항상, newsDrivenWashoutEvent는 컷이 물지 않을 때 전체 이벤트와 같다', () => {
        let compared = 0;
        let horizonCuts = 0;
        let capBites = 0;
        let washoutCompared = 0;
        NOWS.forEach((now, nowIndex) => {
            const horizon = requireHorizon(US_EQUITY_SESSION, now);
            const latestStamp = latestBarStamp(now);
            // 마지막 봉은 오늘 봉이거나(장 시작 뒤), 직전 거래일 봉(장 시작 전·휴장).
            for (const lastBarMs of [
                latestStamp,
                previousTradingStamp(latestStamp),
            ]) {
                const bars = dailyBarsEndingAt(lastBarMs);
                for (let trial = 0; trial < 60; trial++) {
                    const random = makeRandom(nowIndex * 1000 + trial + 1);
                    // 첫 봉 직전부터 `now`까지 — 상한 밖(주말·야간) 이벤트가 섞인다.
                    const events = randomEvents(
                        random,
                        bars[0].time * 1000 - MS_PER_DAY,
                        now.getTime()
                    );
                    const { candidates } = narrowMarketEventsForCacheKey(
                        events,
                        horizon
                    );
                    const eligible = events.filter(
                        entry =>
                            RANKED_IMPACTS.includes(entry.impact) &&
                            entry.publishedAt.getTime() < horizon
                    );
                    const capBit = eligible.length > MARKET_EVENT_CACHE_KEY_CAP;
                    if (capBit) capBites++;
                    if (
                        events.some(
                            entry => entry.publishedAt.getTime() >= horizon
                        )
                    ) {
                        horizonCuts++;
                    }

                    expect(selectMarketEvents(candidates, bars)).toEqual(
                        selectMarketEvents(events, bars)
                    );
                    compared++;

                    // 워시아웃은 입력 순서의 첫 항목(`find`)을 돌려주는데, 상한 20개
                    // 컷이 물면 후보에서 빠진 항목이 유일한 해당 이벤트일 수 있다.
                    // 그건 상한 도입 전부터 있던 성질(`runAnalysis`는 늘 컷된 후보를
                    // 넘긴다)이라 이 불변식의 대상이 아니다 — 컷이 물지 않은 경우만 본다.
                    // 후보는 우선순위 순이므로 전체 이벤트도 같은 순서로 맞춘다.
                    if (!capBit) {
                        expect(
                            newsDrivenWashoutEvent(candidates, bars)
                        ).toEqual(
                            newsDrivenWashoutEvent(
                                events.toSorted(compareMarketEventPriority),
                                bars
                            )
                        );
                        washoutCompared++;
                    }
                }
            }
        });
        // 시간 상한과 20개 컷이 모두 실제로 무는 케이스가 섞여 있어야 비교가 공허하지 않다.
        expect(compared).toBeGreaterThan(0);
        expect(horizonCuts).toBeGreaterThan(compared / 10);
        expect(capBites).toBeGreaterThan(compared / 10);
        expect(washoutCompared).toBeGreaterThan(compared / 10);
    });

    it('상한 직전 이벤트는 워시아웃 소비자가 읽고, 상한 이후 이벤트는 읽지 못한다', () => {
        // 토요일 호출: 마지막 봉은 금요일(10-02) 스탬프, 상한은 토요일 00:00Z.
        const now = new Date('2026-10-03T15:00:00Z');
        const horizon = requireHorizon(US_EQUITY_SESSION, now);
        const bars = dailyBarsEndingAt(utc('2026-10-02T00:00:00Z'));
        const at = (ms: number): MarketEvent => ({
            publishedAt: new Date(ms),
            category: 'earnings',
            sentiment: 'bearish',
            impact: 'high',
        });
        const justBefore = at(horizon - 1);
        const atHorizon = at(horizon);

        expect(newsDrivenWashoutEvent([justBefore], bars)).toBe(justBefore);
        expect(newsDrivenWashoutEvent([atHorizon], bars)).toBeNull();
        expect(
            narrowMarketEventsForCacheKey([justBefore, atHorizon], horizon)
                .candidates
        ).toEqual([justBefore]);
    });
});
