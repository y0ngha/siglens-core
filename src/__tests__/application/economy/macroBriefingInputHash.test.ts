import { describe, it, expect } from 'vitest';
import { hashMacroBriefingInput } from '@/application/economy/macroBriefingInputHash';
import type { EconomySnapshot } from '@/domain/types';

const ind = (name: string, value: number | null) => ({
    name,
    latest: value === null ? null : { date: '2026-05-01', value },
    previous: null,
    trend: [],
});

const evt = (date: string, event: string, actual: number | null = null) => ({
    date,
    event,
    impact: 'High' as const,
    actual,
    estimate: null,
    previous: null,
    unit: '%',
});

const BASE: EconomySnapshot = {
    indicators: [ind('federalFunds', 3.63), ind('CPI', 333.9)],
    treasury: { date: '2026-06-15', year2: 4.07, year10: 4.47 },
    calendar: [evt('2026-06-17 14:00:00', 'Fed Rate Decision')],
};

describe('hashMacroBriefingInput', () => {
    it('16자 소문자 hex를 반환', () => {
        expect(hashMacroBriefingInput(BASE)).toMatch(/^[0-9a-f]{16}$/);
    });

    it('동일 입력은 동일 해시(결정적)', () => {
        expect(hashMacroBriefingInput(BASE)).toBe(hashMacroBriefingInput(BASE));
    });

    it('지표 배열 순서가 달라도 동일 해시', () => {
        const reordered: EconomySnapshot = {
            ...BASE,
            indicators: [ind('CPI', 333.9), ind('federalFunds', 3.63)],
        };
        expect(hashMacroBriefingInput(reordered)).toBe(
            hashMacroBriefingInput(BASE)
        );
    });

    it('지표 latest 값이 바뀌면 해시도 바뀜', () => {
        const changed: EconomySnapshot = {
            ...BASE,
            indicators: [ind('federalFunds', 3.99), ind('CPI', 333.9)],
        };
        expect(hashMacroBriefingInput(changed)).not.toBe(
            hashMacroBriefingInput(BASE)
        );
    });

    it('캘린더 기여 — 이벤트가 추가되면 해시가 바뀜', () => {
        const withMore: EconomySnapshot = {
            ...BASE,
            calendar: [...BASE.calendar, evt('2026-06-18 12:30:00', 'CPI YoY')],
        };
        expect(hashMacroBriefingInput(withMore)).not.toBe(
            hashMacroBriefingInput(BASE)
        );
    });

    it('캘린더 배열 순서가 달라도 동일 해시(정렬 적용)', () => {
        const a = evt('2026-06-17 14:00:00', 'Fed Rate Decision');
        const b = evt('2026-06-18 12:30:00', 'CPI YoY');
        const order1: EconomySnapshot = { ...BASE, calendar: [a, b] };
        const order2: EconomySnapshot = { ...BASE, calendar: [b, a] };
        expect(hashMacroBriefingInput(order1)).toBe(
            hashMacroBriefingInput(order2)
        );
    });

    it('같은 날짜·다른 이벤트 tiebreak — 순서 무관하게 동일 해시', () => {
        const a = evt('2026-06-17 14:00:00', 'Fed Rate Decision');
        const b = evt('2026-06-17 14:00:00', 'Jobless Claims');
        const order1: EconomySnapshot = { ...BASE, calendar: [a, b] };
        const order2: EconomySnapshot = { ...BASE, calendar: [b, a] };
        expect(hashMacroBriefingInput(order1)).toBe(
            hashMacroBriefingInput(order2)
        );
    });

    it('treasury 객체 키 삽입 순서가 달라도 동일 해시(결정성)', () => {
        // wire 응답이 { year10, year2, date } 같이 다른 순서로 와도 같은 값이면 같은 해시.
        // JSON.stringify는 키 삽입 순서를 따르므로, hashMacroBriefingInput은 명시적 키
        // 매핑으로 정규화해 read==write 일관성을 보장한다.
        const reordered: EconomySnapshot = {
            ...BASE,
            treasury: { year10: 4.47, year2: 4.07, date: '2026-06-15' },
        };
        expect(hashMacroBriefingInput(reordered)).toBe(
            hashMacroBriefingInput(BASE)
        );
    });

    it('treasury=null도 결정적 해시(treasury 미가용 시)', () => {
        const withoutTreasury: EconomySnapshot = { ...BASE, treasury: null };
        expect(hashMacroBriefingInput(withoutTreasury)).toMatch(
            /^[0-9a-f]{16}$/
        );
        expect(hashMacroBriefingInput(withoutTreasury)).not.toBe(
            hashMacroBriefingInput(BASE)
        );
    });

    it('latest=null 지표(값 결측)도 결정적으로 해시', () => {
        const withNull: EconomySnapshot = {
            ...BASE,
            indicators: [ind('federalFunds', null), ind('CPI', 333.9)],
        };
        expect(hashMacroBriefingInput(withNull)).toMatch(/^[0-9a-f]{16}$/);
        expect(hashMacroBriefingInput(withNull)).not.toBe(
            hashMacroBriefingInput(BASE)
        );
    });

    it('캘린더 estimate revision은 해시를 바꿈(consensus 갱신 stale 방지)', () => {
        const updated: EconomySnapshot = {
            ...BASE,
            calendar: [
                {
                    ...evt('2026-06-17 14:00:00', 'Fed Rate Decision'),
                    estimate: 3.5,
                },
            ],
        };
        expect(hashMacroBriefingInput(updated)).not.toBe(
            hashMacroBriefingInput(BASE)
        );
    });

    it('캘린더 impact 재분류는 해시를 바꿈(중요도 변경 반영)', () => {
        const downgraded: EconomySnapshot = {
            ...BASE,
            calendar: [
                {
                    ...evt('2026-06-17 14:00:00', 'Fed Rate Decision'),
                    impact: 'Medium',
                },
            ],
        };
        expect(hashMacroBriefingInput(downgraded)).not.toBe(
            hashMacroBriefingInput(BASE)
        );
    });

    it('캘린더 actual 갱신은 해시를 바꿈(발표 반영)', () => {
        const updated: EconomySnapshot = {
            ...BASE,
            calendar: [evt('2026-06-17 14:00:00', 'Fed Rate Decision', 3.63)],
        };
        expect(hashMacroBriefingInput(updated)).not.toBe(
            hashMacroBriefingInput(BASE)
        );
    });
});
