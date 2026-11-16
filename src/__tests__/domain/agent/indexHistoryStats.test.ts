import { describe, expect, it } from 'vitest';
import { computeIndexHistoryStats } from '@/domain/agent/indexHistoryStats';

/** from년 1월~to년 12월 월말 종가: 해마다 annual(%)만큼 12월에 한 번 오른다(나머지 달은 그대로). */
function yearly(from: number, to: number, annual: (year: number) => number) {
    const rows: { month: string; close: number }[] = [];
    let close = 100;
    rows.push({ month: `${from - 1}-12`, close });
    for (let y = from; y <= to; y++) {
        for (let m = 1; m <= 12; m++) {
            if (m === 12) close = close * (1 + annual(y) / 100);
            rows.push({ month: `${y}-${String(m).padStart(2, '0')}`, close });
        }
    }
    return rows;
}

describe('computeIndexHistoryStats', () => {
    it('연간 수익률은 전년 12월 → 그해 12월, 진행 중인 달 이후는 버린다', () => {
        const rows = [
            ...yearly(2021, 2022, y => (y === 2021 ? 10 : -20)),
            { month: '2023-01', close: 999 },
        ];
        const stats = computeIndexHistoryStats(rows, {
            usCycle: false,
            currentMonth: '2023-01',
        })!;
        expect(stats.annual.map(r => [r.year, r.returnPct])).toEqual([
            [2021, 10],
            [2022, -20],
        ]);
        expect(stats.lastMonth).toBe('2022-12');
        expect(stats.firstFullYear).toBe(2021);
        expect(stats.presidentialCycle).toBeNull();
        expect(stats.midtermForward12m).toBeNull();
    });

    it('연중 최대 낙폭은 월말 종가의 고점 대비, 전년 12월이 출발점', () => {
        const rows = [
            { month: '2021-12', close: 100 },
            { month: '2022-01', close: 120 },
            { month: '2022-02', close: 90 },
            ...Array.from({ length: 10 }, (_, i) => ({
                month: `2022-${String(i + 3).padStart(2, '0')}`,
                close: 110,
            })),
        ];
        const [year] = computeIndexHistoryStats(rows, {
            usCycle: false,
            currentMonth: '2026-11',
        })!.annual;
        expect(year).toEqual({
            year: 2022,
            returnPct: 10,
            maxDrawdownPct: -25,
        });
    });

    it('월별 계절성은 그 달 종가 / 전달 종가이고 전달이 없으면 세지 않는다', () => {
        const stats = computeIndexHistoryStats(
            yearly(2020, 2023, () => 10),
            {
                usCycle: false,
                currentMonth: '2026-11',
            }
        )!;
        const dec = stats.monthly.find(m => m.month === 12)!;
        expect(dec).toEqual({
            month: 12,
            samples: 4, // 2020~2023의 12월(2019-12는 전달이 없어 빠진다)
            positive: 4,
            avgPct: 10,
            medianPct: 10,
            positivePct: 100,
        });
    });

    it('대통령 임기 주기와 중간선거 해 10월 → 다음 해 10월 수익률(미국)', () => {
        const stats = computeIndexHistoryStats(
            yearly(2017, 2024, y => (y % 4 === 2 ? -10 : 20)),
            { usCycle: true, currentMonth: '2026-11' }
        )!;
        const midterm = stats.presidentialCycle!.find(
            c => c.position === 'midterm'
        )!;
        expect(midterm.years).toEqual([2018, 2022]);
        expect(midterm.avgPct).toBe(-10);
        expect(stats.presidentialCycle!.map(c => c.position)).toEqual([
            'post_election',
            'midterm',
            'pre_election',
            'election',
        ]);
        // 10월 말 → 다음 해 10월 말: 그 사이의 12월은 중간선거 해 자신의 12월(−10%)이다.
        expect(stats.midtermForward12m!.rows).toEqual([
            { year: 2018, returnPct: -10 },
            { year: 2022, returnPct: -10 },
        ]);
        expect(stats.midtermForward12m!.summary.positivePct).toBe(0);
    });

    it('잘못된 월·0 이하 종가는 버리고, 남는 게 없으면 null', () => {
        expect(
            computeIndexHistoryStats(
                [
                    { month: '2022-13', close: 1 },
                    { month: '2022-01', close: 0 },
                ],
                { usCycle: false, currentMonth: '2026-11' }
            )
        ).toBeNull();
    });

    it('첫 해에 전년 12월이 없으면 연간 표에서 빠지고, 중간에 달이 빠져도 12월끼리로 센다', () => {
        const rows = [
            { month: '2020-03', close: 100 },
            { month: '2020-12', close: 110 },
            { month: '2021-06', close: 90 },
            { month: '2021-12', close: 121 },
        ];
        const stats = computeIndexHistoryStats(rows, {
            usCycle: false,
            currentMonth: '2026-11',
        })!;
        expect(stats.firstFullYear).toBe(2021);
        expect(stats.annual).toEqual([
            { year: 2021, returnPct: 10, maxDrawdownPct: -18.18 },
        ]);
    });

    it('currentMonth가 해 중간이면 그해 12월이 없어 그해는 연간 표에 없다', () => {
        const stats = computeIndexHistoryStats(
            yearly(2020, 2022, () => 5),
            {
                usCycle: false,
                currentMonth: '2022-12',
            }
        )!;
        expect(stats.annual.map(r => r.year)).toEqual([2020, 2021]);
        expect(stats.lastMonth).toBe('2022-11');
    });

    it('부호가 섞인 짝수 개 표본: 중앙값은 가운데 둘의 평균, 상승 수·비율이 맞는다', () => {
        const returns: Record<number, number> = {
            2019: 10,
            2020: -20,
            2021: 30,
            2022: -5,
        };
        const stats = computeIndexHistoryStats(
            yearly(2019, 2022, y => returns[y]!),
            { usCycle: false, currentMonth: '2026-11' }
        )!;
        expect(stats.annualSummary).toEqual({
            samples: 4,
            positive: 2,
            avgPct: 3.75,
            medianPct: 2.5,
            positivePct: 50,
        });
    });

    it('중간선거 다음 해 10월이 아직 없으면 그 중간선거는 전방 수익률에서 빠진다', () => {
        const stats = computeIndexHistoryStats(
            yearly(2017, 2022, () => 10),
            {
                usCycle: true,
                currentMonth: '2023-05',
            }
        )!;
        expect(stats.midtermForward12m!.rows.map(r => r.year)).toEqual([2018]);
    });

    it('반올림된 0은 -0이 아니다', () => {
        const stats = computeIndexHistoryStats(
            [
                { month: '2021-12', close: 100 },
                { month: '2022-12', close: 99.9999 },
            ],
            { usCycle: false, currentMonth: '2026-11' }
        )!;
        expect(Object.is(stats.annual[0]!.returnPct, 0)).toBe(true);
    });
});
