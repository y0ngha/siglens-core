import { describe, it, expect } from 'vitest';
import { normalizeEconomicCalendar } from '@/domain/economy/normalizeEconomicCalendar';

const RAW = [
    {
        date: '2026-06-18 12:30:00',
        country: 'US',
        event: 'CPI YoY',
        impact: 'High',
        previous: 2.4,
        estimate: 2.3,
        actual: null,
        unit: '%',
    },
    {
        date: '2026-06-16 23:50:00',
        country: 'JP',
        event: 'Machinery Orders',
        impact: 'Medium',
        previous: -9.4,
        estimate: 0.9,
        actual: null,
        unit: '%',
    },
    {
        date: '2026-06-17 14:00:00',
        country: 'US',
        event: 'Fed Rate Decision',
        impact: 'High',
        previous: 3.63,
        estimate: 3.63,
        actual: null,
        unit: '%',
    },
];

describe('normalizeEconomicCalendar', () => {
    it('US만 남기고 날짜 오름차순 정렬', () => {
        const out = normalizeEconomicCalendar(RAW);
        expect(out).toHaveLength(2);
        expect(out[0].event).toBe('Fed Rate Decision'); // 06-17 < 06-18
        expect(out[1].event).toBe('CPI YoY');
    });

    it('숫자 필드 보존, 결측은 null', () => {
        const out = normalizeEconomicCalendar([
            { ...RAW[0], actual: null, estimate: undefined },
        ]);
        expect(out[0].previous).toBe(2.4);
        expect(out[0].actual).toBeNull();
        expect(out[0].estimate).toBeNull();
    });

    it('impact가 Low/Medium/High 외면 Low로 강제', () => {
        const out = normalizeEconomicCalendar([
            { ...RAW[0], impact: 'garbage' },
        ]);
        expect(out[0].impact).toBe('Low');
    });

    it('event 결측 항목은 drop', () => {
        const out = normalizeEconomicCalendar([{ ...RAW[0], event: '' }]);
        expect(out).toEqual([]);
    });

    it('date 결측 항목은 drop (event 있어도)', () => {
        const out = normalizeEconomicCalendar([{ ...RAW[0], date: '' }]);
        expect(out).toEqual([]);
    });

    it('비객체 항목(문자열·null)은 drop', () => {
        const out = normalizeEconomicCalendar(['bad', null, RAW[0]]);
        expect(out).toHaveLength(1);
        expect(out[0].event).toBe('CPI YoY');
    });

    it('같은 날짜 이벤트가 있어도 안정적으로 정렬', () => {
        const sameDate = { ...RAW[0], event: 'Retail Sales' };
        const out = normalizeEconomicCalendar([RAW[0], sameDate]);
        expect(out).toHaveLength(2);
        expect(out.every(e => e.date === '2026-06-18 12:30:00')).toBe(true);
    });

    it('빈/비배열 입력이면 []', () => {
        expect(normalizeEconomicCalendar(null)).toEqual([]);
        expect(normalizeEconomicCalendar([])).toEqual([]);
    });
});
