import { describe, expect, it } from 'vitest';
import {
    SWING_EPISODES_LISTED_MAX,
    computeSwingHistory,
    type SwingCurrent,
    type SwingHistory,
} from '@/domain/agent/swingHistory';

/** Consecutive calendar days from 2020-01-01, one close each. */
function series(closes: readonly number[]): { date: string; close: number }[] {
    return closes.map((close, i) => ({
        date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10),
        close,
    }));
}

function run(closes: readonly number[], minSwingPct = 10): SwingHistory {
    const result = computeSwingHistory(series(closes), { minSwingPct });
    if (result === null) throw new Error('expected a result');
    return result;
}

function openLeg<S extends SwingCurrent['state']>(
    current: SwingCurrent,
    state: S
): Extract<SwingCurrent, { state: S }> {
    if (current.state !== state)
        throw new Error(`expected ${state}, got ${current.state}`);
    return current as Extract<SwingCurrent, { state: S }>;
}

/**
 * 50 → 100 (first high, from the window start) → 80 (confirmed low) → 100 (rally) → 70 (confirmed low)
 * → 90 (rally) → 120: two confirmed lows, so the second decline (100 → 70) is the first one with a confirmed high.
 */
const TWO_SWINGS = [50, 100, 80, 100, 70, 90, 120];

describe('computeSwingHistory — 하락 구간', () => {
    it('확정 저점 뒤의 고점에서 시작한 하락을 일수·거래일·낙폭·회복과 함께 낸다', () => {
        const h = run(TWO_SWINGS);
        expect(h.declines.episodes).toEqual([
            {
                peakDate: '2020-01-04',
                peakClose: 100,
                troughDate: '2020-01-05',
                troughClose: 70,
                changePct: -30,
                days: 1,
                sessions: 1,
                recoveryDate: '2020-01-07',
                daysToRecover: 2,
            },
        ]);
    });

    it('창 첫 종가에서 올라간 첫 고점의 하락은 고점이 확정되지 않아 뺀다', () => {
        const h = run([50, 100, 80, 100]);
        expect(h.declines.summary.episodes).toBe(0);
    });

    it('요약은 회복한 구간만으로 회복 일수를 낸다', () => {
        const h = run([50, 100, 80, 100, 70, 90, 120, 100, 130, 110, 130]);
        // Declines with a confirmed high: 100→70 (back 2 days later), 120→100 (1 day), 130→110 (1 day).
        expect(h.declines.summary).toMatchObject({
            episodes: 3,
            recovered: 3,
            daysToRecover: {
                samples: 3,
                medianDays: 1,
                minDays: 1,
                maxDays: 2,
            },
        });
        expect(h.declines.summary.change).toEqual({
            medianPct: -16.67,
            avgPct: -20.68,
            extremePct: -30,
        });
    });

    it('회복한 구간과 못한 구간이 섞이면 회복 통계는 회복한 구간만 센다', () => {
        // 100→70 recovers on day 7 (2 days after the trough, 3 after the peak); 120→90 never gets back.
        const h = run([50, 100, 80, 100, 70, 90, 120, 90, 100]);
        expect(h.declines.summary).toMatchObject({
            episodes: 2,
            recovered: 1,
            daysToRecover: { samples: 1, medianDays: 2 },
            peakToRecoveryDays: { samples: 1, medianDays: 3 },
        });
    });

    it('회복하지 못한 하락은 recoveryDate·daysToRecover가 null이고 회복 통계에서 빠진다', () => {
        const h = run([50, 100, 80, 100, 70, 80]);
        expect(h.declines.episodes[0]).toMatchObject({
            recoveryDate: null,
            daysToRecover: null,
        });
        expect(h.declines.summary.recovered).toBe(0);
        expect(h.declines.summary.daysToRecover.samples).toBe(0);
        expect(h.declines.summary.peakToRecoveryDays.medianDays).toBeNull();
    });

    it('크기 구간은 minSwingPct부터 10·20·30·50 경계로 나뉘고 구간별 중앙값을 낸다', () => {
        const h = run([50, 100, 80, 100, 85, 100, 70, 100], 12);
        expect(
            h.declines.bySize.map(b => [
                b.fromPct,
                b.toPct,
                b.episodes,
                b.medianDays,
                b.recovered,
                b.medianDaysToRecover,
            ])
        ).toEqual([
            [12, 20, 1, 1, 1, 1],
            [20, 30, 0, null, 0, null],
            [30, 50, 1, 1, 1, 1],
            [50, null, 0, null, 0, null],
        ]);
    });
});

describe('computeSwingHistory — 상승 구간', () => {
    it('확정 저점에서 다음 확정 고점까지를 상승 구간으로 낸다', () => {
        const h = run(TWO_SWINGS);
        // 80 → 100 ended by the drop to 70; 70 → 120 is still open.
        expect(h.rallies.episodes).toEqual([
            {
                troughDate: '2020-01-03',
                troughClose: 80,
                peakDate: '2020-01-04',
                peakClose: 100,
                changePct: 25,
                days: 1,
                sessions: 1,
            },
        ]);
        expect(h.rallies.summary).toMatchObject({
            episodes: 1,
            sessionsMedian: 1,
            change: { medianPct: 25, avgPct: 25, extremePct: 25 },
        });
    });

    it('상승 크기 구간은 100% 경계까지 있다', () => {
        const h = run([50, 100, 80, 200, 150]);
        expect(h.rallies.bySize.map(b => [b.fromPct, b.episodes])).toEqual([
            [10, 0],
            [20, 0],
            [30, 0],
            [50, 0],
            [100, 1],
        ]);
    });
});

describe('computeSwingHistory — 현재 구간', () => {
    it('열린 상승은 시작 저점·고점·되돌림과 과거 상승 대비 개수를 낸다', () => {
        // Past rally 80 → 100 (1 day, +25%). Open rally from 70: high 120 on day 6, last 115.
        const current = openLeg(run([...TWO_SWINGS, 115]).current, 'in_rally');
        expect(current).toEqual({
            state: 'in_rally',
            startDate: '2020-01-05',
            startClose: 70,
            extremeDate: '2020-01-07',
            extremeClose: 120,
            extremePct: 71.43,
            lastClose: 115,
            changePct: 64.29,
            fromExtremePct: -4.17,
            daysSinceStart: 3,
            daysToExtreme: 2,
            pastEpisodes: 1,
            pastLongerThanNow: 0,
            pastBiggerThanNow: 0,
        });
    });

    it('열린 하락은 과거 하락 중 더 길거나 더 깊었던 개수를 센다(같으면 세지 않는다)', () => {
        // Completed declines with a confirmed high: 100→70 (1 day, −30%), 120→96 (2 days, −20%).
        // Open: 130 → 104 (−20%) over 2 days, last 105 three days after the high.
        const h = run([
            50, 100, 80, 100, 70, 90, 120, 100, 96, 110, 130, 115, 104, 105,
        ]);
        const current = openLeg(h.current, 'in_decline');
        expect(current).toMatchObject({
            startDate: '2020-01-11',
            extremeDate: '2020-01-13',
            extremePct: -20,
            daysSinceStart: 3,
            daysToExtreme: 2,
            pastEpisodes: 2,
            // Past start-to-low took 1 and 2 days; neither is longer than this leg's 2 (a tie).
            pastLongerThanNow: 0,
            // −30% is deeper; −20% ties and does not count.
            pastBiggerThanNow: 1,
        });
    });

    it('과거 구간이 지금보다 길면 센다', () => {
        // Completed: 100 → 70 over 3 days. Open: 120 → 105 in 1 day.
        const h = run([50, 100, 80, 100, 90, 85, 70, 90, 120, 105]);
        expect(openLeg(h.current, 'in_decline')).toMatchObject({
            daysSinceStart: 1,
            pastLongerThanNow: 1,
        });
    });

    it('지금 구간의 길이는 극값까지의 일수로 비교한다(극값 뒤 옆걸음은 세지 않는다)', () => {
        // Past: 100 → 70 over 2 days. Open: 120 → 105 on day 1, then drifts for 5 more days.
        const h = run([
            50, 100, 80, 100, 85, 70, 90, 120, 105, 106, 107, 106, 107, 106,
        ]);
        expect(openLeg(h.current, 'in_decline')).toMatchObject({
            daysToExtreme: 1,
            daysSinceStart: 6,
            pastLongerThanNow: 1,
        });
    });

    it('1 미만 가격(코인)은 유효숫자 5자리로 내고 비율은 반올림 전 종가로 계산한다', () => {
        // The high (0.0001234649) and the last close (0.0001234551) both round to 0.00012346, so
        // only raw closes give a non-zero pullback (−0.01%) and a 76.38% (not 76.37%) rally.
        const h = run([
            0.00005, 0.0001, 0.00008, 0.0001, 0.00007, 0.00009, 0.0001234649,
            0.0001234551,
        ]);
        const current = openLeg(h.current, 'in_rally');
        expect(current).toMatchObject({
            startClose: 0.00007,
            extremeClose: 0.00012346,
            lastClose: 0.00012346,
            extremePct: 76.38,
            fromExtremePct: -0.01,
        });
        expect(h.windowHigh).toEqual({
            date: '2020-01-07',
            close: 0.00012346,
            fromHighPct: -0.01,
        });
        expect(h.declines.episodes[0]?.peakClose).toBe(0.0001);
    });

    it('1 이상 가격은 소수 둘째 자리까지 낸다', () => {
        expect(run([50, 12345.678, 12000]).windowHigh.close).toBe(12345.68);
    });

    it('확정된 스윙점이 없으면 no_confirmed_swing', () => {
        expect(run([100, 95, 99, 100]).current).toEqual({
            state: 'no_confirmed_swing',
            lastClose: 100,
        });
        // A decline from the window's first high is not measured either.
        expect(run([100, 80, 85]).current.state).toBe('no_confirmed_swing');
    });

    it('windowHigh는 기간 최고 종가와 마지막 종가의 거리다', () => {
        expect(run([50, 100, 80, 90]).windowHigh).toEqual({
            date: '2020-01-02',
            close: 100,
            fromHighPct: -10,
        });
    });
});

describe('computeSwingHistory — 경계와 입력', () => {
    it('정확히 minSwingPct만큼의 하락과 반등도 스윙을 확정한다(부동소수 오차 무시)', () => {
        // 50 → 55 is exactly +10% (50 * 1.1 = 55.000000000000007 in floats).
        const h = run([60, 50, 55, 49.5, 54.45]);
        expect(h.rallies.episodes).toHaveLength(1);
        expect(h.declines.episodes).toHaveLength(1);
    });

    it('기준에 조금 못 미치는 움직임은 스윙이 아니다', () => {
        const h = run([60, 50, 54.99, 50, 54.99]);
        expect(h.rallies.summary.episodes).toBe(0);
        expect(h.declines.summary.episodes).toBe(0);
    });

    it('lookbackYears는 마지막 종가에서 정확히 그만큼 이전 날짜부터 남긴다', () => {
        const rows = [
            { date: '2019-06-01', close: 50 },
            { date: '2020-06-02', close: 100 },
            { date: '2021-01-04', close: 80 },
            { date: '2025-06-02', close: 121 },
        ];
        const recent = computeSwingHistory(rows, {
            minSwingPct: 10,
            lookbackYears: 5,
        });
        expect(recent?.firstDate).toBe('2020-06-02');
        expect(recent?.sessions).toBe(3);
    });

    it('잘못된 종가·없는 날짜는 버리고 같은 날짜는 뒤 행이 이기며 순서는 가리지 않는다', () => {
        const h = computeSwingHistory(
            [
                { date: '2020-01-03', close: 80 },
                { date: '2020-01-01', close: 50 },
                { date: '2020-01-02', close: 1 },
                { date: '2020-01-02', close: 100 },
                { date: '2020-13-01', close: 70 },
                { date: '2020-02-30', close: 70 },
                { date: '2020/01/07', close: 70 },
                { date: '2020-1-8', close: 70 },
                { date: '2020-01-04', close: Number.NaN },
                { date: '2020-01-05', close: 0 },
                { date: '2020-01-06', close: 95 },
            ],
            { minSwingPct: 10 }
        );
        expect(h?.sessions).toBe(4);
        expect(h?.windowHigh.date).toBe('2020-01-02');
    });

    it('범위 밖·정수가 아닌 옵션과 종가 두 개 미만은 null', () => {
        const rows = series([50, 100, 80, 100]);
        for (const minSwingPct of [2, 51, 10.5, Number.NaN])
            expect(computeSwingHistory(rows, { minSwingPct })).toBeNull();
        for (const lookbackYears of [0, 61, 2.5])
            expect(
                computeSwingHistory(rows, { minSwingPct: 10, lookbackYears })
            ).toBeNull();
        expect(computeSwingHistory(rows, { minSwingPct: 3 })).not.toBeNull();
        expect(computeSwingHistory(rows, { minSwingPct: 50 })).not.toBeNull();
    });

    it('종가가 두 개 미만이면 null', () => {
        expect(computeSwingHistory([], { minSwingPct: 10 })).toBeNull();
        expect(
            computeSwingHistory(series([1]), { minSwingPct: 10 })
        ).toBeNull();
    });

    it('목록은 최신순 상한까지만 싣고 나머지는 notListed로 센다(통계에는 모두 포함)', () => {
        const cycles = SWING_EPISODES_LISTED_MAX + 3;
        const h = run([
            50,
            ...Array.from({ length: cycles }, () => [100, 80]).flat(),
            100,
        ]);
        // The first decline starts from the window's first high and is dropped.
        expect(h.declines.summary.episodes).toBe(cycles - 1);
        expect(h.declines.episodes).toHaveLength(SWING_EPISODES_LISTED_MAX);
        expect(h.declines.notListed).toBe(
            cycles - 1 - SWING_EPISODES_LISTED_MAX
        );
        expect(h.rallies.summary.episodes).toBe(cycles - 1);
        const [newest, next] = h.declines.episodes;
        expect((newest?.peakDate ?? '') > (next?.peakDate ?? '')).toBe(true);
        expect(h.rallies.episodes).toHaveLength(SWING_EPISODES_LISTED_MAX);
        expect(h.rallies.notListed).toBe(
            cycles - 1 - SWING_EPISODES_LISTED_MAX
        );
        const [newestRally, nextRally] = h.rallies.episodes;
        expect(
            (newestRally?.troughDate ?? '') > (nextRally?.troughDate ?? '')
        ).toBe(true);
    });
});
