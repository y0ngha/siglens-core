import { describe, it, expect } from 'vitest';
import { normalizeEconomicIndicatorSeries } from '@/domain/economy/normalizeEconomicIndicators';

const RAW = [
    { name: 'federalFunds', date: '2026-05-01', value: 3.63 },
    { name: 'federalFunds', date: '2026-04-01', value: 3.58 },
    { name: 'federalFunds', date: '2026-03-01', value: 3.55 },
];

describe('normalizeEconomicIndicatorSeries', () => {
    it('latest=가장 최근, previous=직전, trend는 최신→과거 N개', () => {
        const s = normalizeEconomicIndicatorSeries('federalFunds', RAW, 2);
        expect(s.name).toBe('federalFunds');
        expect(s.latest).toEqual({ date: '2026-05-01', value: 3.63 });
        expect(s.previous).toEqual({ date: '2026-04-01', value: 3.58 });
        expect(s.trend).toHaveLength(2);
        expect(s.trend[0]).toEqual({ date: '2026-05-01', value: 3.63 });
    });

    it('입력이 과거→최신 역순이어도 date 내림차순으로 재정렬', () => {
        const s = normalizeEconomicIndicatorSeries(
            'federalFunds',
            [RAW[2], RAW[1], RAW[0]],
            5
        );
        expect(s.latest).toEqual({ date: '2026-05-01', value: 3.63 });
        expect(s.previous).toEqual({ date: '2026-04-01', value: 3.58 });
    });

    it('빈 배열이면 latest/previous=null, trend=[]', () => {
        const s = normalizeEconomicIndicatorSeries('federalFunds', [], 5);
        expect(s.latest).toBeNull();
        expect(s.previous).toBeNull();
        expect(s.trend).toEqual([]);
    });

    it('포인트 1개면 previous=null', () => {
        const s = normalizeEconomicIndicatorSeries('CPI', [RAW[0]], 5);
        expect(s.latest).not.toBeNull();
        expect(s.previous).toBeNull();
    });

    it('value가 숫자가 아닌 항목은 drop', () => {
        const s = normalizeEconomicIndicatorSeries(
            'x',
            [{ date: '2026-05-01', value: 'NaN' }, RAW[1]],
            5
        );
        expect(s.latest).toEqual({ date: '2026-04-01', value: 3.58 });
    });

    it('비배열 입력이면 빈 시리즈', () => {
        const s = normalizeEconomicIndicatorSeries('x', null, 5);
        expect(s.latest).toBeNull();
        expect(s.trend).toEqual([]);
    });

    it('비객체 항목(문자열·null)은 drop', () => {
        const s = normalizeEconomicIndicatorSeries(
            'x',
            ['bad', null, RAW[0]],
            5
        );
        expect(s.latest).toEqual({ date: '2026-05-01', value: 3.63 });
        expect(s.trend).toHaveLength(1);
    });

    it('같은 날짜 포인트가 있어도 안정적으로 정렬', () => {
        const s = normalizeEconomicIndicatorSeries(
            'x',
            [
                { date: '2026-05-01', value: 1 },
                { date: '2026-05-01', value: 2 },
            ],
            5
        );
        expect(s.trend).toHaveLength(2);
        expect(s.latest?.date).toBe('2026-05-01');
    });

    describe('unit (spec 2026-09-18 §B3)', () => {
        it('carries the caller-supplied unit through', () => {
            const s = normalizeEconomicIndicatorSeries(
                'federalFunds',
                RAW,
                2,
                '%'
            );
            expect(s.unit).toBe('%');
        });

        it('omits unit (undefined) when the caller does not supply one', () => {
            const s = normalizeEconomicIndicatorSeries('federalFunds', RAW, 2);
            expect(s.unit).toBeUndefined();
        });
    });
});
