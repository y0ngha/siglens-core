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
            pastBiggerThanNow: 0,
            endsAtClose: 108,
            afterThisAge: {
                ageDays: 3,
                unendedAtThisAge: 0,
                extremeAlreadyIn: 0,
                extraDaysToExtreme: {
                    samples: 0,
                    medianDays: null,
                    p25Days: null,
                    p75Days: null,
                    maxDays: null,
                },
            },
        });
    });

    /**
     * Confirmed on day 1 (88, a 12% drop), low of 80 on day k, rebound to 100 on day k + 1.
     * A one-day decline goes straight to 80.
     */
    const decline = (days: number) => [
        ...Array.from({ length: days }, (_, j) =>
            days === 1 ? 80 : 88 - (8 * j) / (days - 1)
        ),
        100,
    ];
    /** A slow decline only confirmed on day 5 (90), low of 85 on day 6, rebound on day 7. */
    const slowDecline = [98, 96, 94, 92, 90, 85, 100];
    /** Down to 80 on day 1, then `drift` days at 82 before the rebound (low early, ended late). */
    const earlyLow = (drift: number) => [
        80,
        ...Array<number>(drift).fill(82),
        100,
    ];

    it('이 나이에 끝나지 않았던 과거 구간만 골라 극값까지 더 걸린 일수를 낸다(표본이 적으면 사분위는 null)', () => {
        // Past declines are confirmed on day 1, bottom 1, 3, 5, 6 days after their high and end a
        // day later; the open decline is 2 days old. Unended at day 2: the 3-, 5- and 6-day ones.
        const h = run([
            50,
            100,
            80,
            100,
            ...[1, 3, 5, 6].flatMap(decline),
            95,
            85,
        ]);
        expect(openLeg(h.current, 'in_decline').afterThisAge).toEqual({
            ageDays: 2,
            unendedAtThisAge: 3,
            extremeAlreadyIn: 0,
            extraDaysToExtreme: {
                samples: 3,
                medianDays: 3,
                p25Days: null,
                p75Days: null,
                maxDays: 4,
            },
        });
    });

    it('이 나이에 끝나지 않았지만 극값은 이미 나와 있던 구간을 따로 세고, 5개 이상이면 사분위를 낸다', () => {
        // earlyLow(3): low on day 1, ended on day 5 → unended at day 2 with its low already in.
        // The 3-, 5-, 6-, 8- and 9-day declines need 1, 3, 4, 6 and 7 more days.
        const h = run([
            50,
            100,
            80,
            100,
            ...earlyLow(3),
            ...[3, 5, 6, 8, 9].flatMap(decline),
            95,
            85,
        ]);
        expect(openLeg(h.current, 'in_decline').afterThisAge).toEqual({
            ageDays: 2,
            unendedAtThisAge: 6,
            extremeAlreadyIn: 1,
            extraDaysToExtreme: {
                samples: 5,
                medianDays: 4,
                p25Days: 3,
                p75Days: 6,
                maxDays: 7,
            },
        });
    });

    it('표본이 4개면 사분위는 아직 null이다(p25가 최솟값이 되므로)', () => {
        const h = run([
            50,
            100,
            80,
            100,
            ...[3, 5, 6, 8].flatMap(decline),
            95,
            85,
        ]);
        expect(
            openLeg(h.current, 'in_decline').afterThisAge.extraDaysToExtreme
        ).toEqual({
            samples: 4,
            medianDays: 3.5,
            p25Days: null,
            p75Days: null,
            maxDays: 6,
        });
    });

    it('이 나이에 아직 시작이 확정되지 않았던 과거 구간은 세지 않는다', () => {
        // The slow decline was only confirmed on day 5; at day 2 it was not yet a decline.
        const h = run([50, 100, 80, 100, ...slowDecline, 95, 85]);
        expect(openLeg(h.current, 'in_decline').afterThisAge).toMatchObject({
            ageDays: 2,
            unendedAtThisAge: 0,
        });
    });

    it('나이와 같은 날 극값을 찍은 구간은 이미 극값이 나온 것으로 센다', () => {
        // Past decline: low on day 2, ended on day 3. The open decline is 2 days old.
        const h = run([50, 100, 80, 100, 90, 80, 100, 95, 85]);
        expect(openLeg(h.current, 'in_decline').afterThisAge).toMatchObject({
            unendedAtThisAge: 1,
            extremeAlreadyIn: 1,
            extraDaysToExtreme: { samples: 0, medianDays: null },
        });
    });

    it('열린 상승은 과거 하락이 아니라 과거 상승의 시점과 비교한다', () => {
        // Past rallies: 80 → 120 (high day 4, ended day 5) and 105 → 130 (day 2, ended day 3).
        // Past declines end on days 2 and 3, so only the rally timings leave one unended at day 3.
        const h = run([
            50, 100, 80, 90, 100, 110, 120, 105, 116, 130, 117, 100, 112, 125,
            140,
        ]);
        expect(openLeg(h.current, 'in_rally').afterThisAge).toEqual({
            ageDays: 3,
            unendedAtThisAge: 1,
            extremeAlreadyIn: 0,
            extraDaysToExtreme: {
                samples: 1,
                medianDays: 1,
                p25Days: null,
                p75Days: null,
                maxDays: 1,
            },
        });
    });

    it('이 나이에 아직 저점이 확정되지 않았던(반등이 느렸던) 과거 상승은 세지 않는다', () => {
        // Past rally from 80: the rebound only reaches +10% (88) on day 4, high 110 on day 6,
        // ended on day 7. The open rally from 99 is 3 days old, so that rally was not yet a rally.
        const h = run([
            50, 100, 80, 82, 84, 86, 88, 100, 110, 99, 110, 120, 130,
        ]);
        const current = openLeg(h.current, 'in_rally');
        expect(current.pastEpisodes).toBe(1);
        expect(current.afterThisAge).toMatchObject({
            ageDays: 3,
            unendedAtThisAge: 0,
        });
    });

    it('열린 하락은 저점보다 minSwingPct 위 종가에서 끝난다(endsAtClose)', () => {
        // Open decline 100 → 85 (low so far); a close of 93.5 (85 × 1.1) would end it.
        const h = run([50, 100, 80, 100, 95, 85], 10);
        expect(openLeg(h.current, 'in_decline').endsAtClose).toBe(93.5);
    });

    it('endsAtClose는 하락이면 올림, 상승이면 내림이라 보이는 가격의 종가가 실제로 구간을 끝낸다', () => {
        // 85.0036 × 1.1 = 93.50396 → 93.51 (93.50 would not end it).
        const down = run([50, 100, 80, 100, 95, 85.0036], 10);
        expect(openLeg(down.current, 'in_decline').endsAtClose).toBe(93.51);
        // 356.2733 × 0.9 = 320.64597 → 320.64 (320.65 would not end it).
        const up = run([50, 100, 80, 100, 70, 90, 356.2733, 350]);
        expect(openLeg(up.current, 'in_rally').endsAtClose).toBe(320.64);
    });

    it('1 미만 가격의 endsAtClose도 유효숫자 5자리에서 올림한다', () => {
        // 0.000123451 × 1.1 = 0.0001357961 → 0.0001358 (5 significant digits, rounded up).
        const h = run([0.00005, 0.0002, 0.00016, 0.0002, 0.000123451]);
        expect(openLeg(h.current, 'in_decline').endsAtClose).toBe(0.0001358);
    });

    it('열린 하락은 과거 하락 중 더 깊었던 개수를 센다(같으면 세지 않는다)', () => {
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
            // −30% is deeper; −20% ties and does not count.
            pastBiggerThanNow: 1,
        });
    });

    it('과거 구간이 이 나이에 끝나지 않았으면 unendedAtThisAge로 센다', () => {
        // Completed: 100 → 70 over 3 days, ended on day 4. Open: 120 → 105, 1 day old.
        const h = run([50, 100, 80, 100, 90, 85, 70, 90, 120, 105]);
        expect(openLeg(h.current, 'in_decline').afterThisAge).toMatchObject({
            ageDays: 1,
            unendedAtThisAge: 1,
            extremeAlreadyIn: 0,
            extraDaysToExtreme: { samples: 1, medianDays: 2 },
        });
    });

    it('나이는 극값까지가 아니라 오늘까지의 일수다(극값 뒤 옆걸음도 나이에 든다)', () => {
        // Past: 100 → 70 over 2 days. Open: 120 → 105 on day 1, then drifts to day 6.
        const h = run([
            50, 100, 80, 100, 85, 70, 90, 120, 105, 106, 107, 106, 107, 106,
        ]);
        const current = openLeg(h.current, 'in_decline');
        expect(current).toMatchObject({ daysToExtreme: 1, daysSinceStart: 6 });
        expect(current.afterThisAge).toMatchObject({
            ageDays: 6,
            unendedAtThisAge: 0,
        });
        // The deprecated count is no longer filled.
        expect('pastLongerThanNow' in current).toBe(false);
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
