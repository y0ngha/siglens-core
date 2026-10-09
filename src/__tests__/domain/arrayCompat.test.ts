import { describe, expect, it } from 'vitest';
import { findLast, findLastIndex } from '@/domain/arrayCompat';

describe('findLastIndex', () => {
    it('뒤에서부터 조건을 만족하는 첫 인덱스를 돌려준다', () => {
        expect(findLastIndex([1, 2, 3, 2], v => v === 2)).toBe(3);
    });

    it('없으면 -1', () => {
        expect(findLastIndex([1, 2, 3], v => v > 5)).toBe(-1);
        expect(findLastIndex([], () => true)).toBe(-1);
    });

    it('predicate에 인덱스를 함께 넘긴다', () => {
        expect(findLastIndex(['a', 'b', 'c'], (_, i) => i < 2)).toBe(1);
    });
});

describe('findLast', () => {
    it('뒤에서부터 조건을 만족하는 첫 값을 돌려준다', () => {
        expect(findLast([1, null, 3, null], v => v !== null)).toBe(3);
    });

    it('없으면 undefined', () => {
        expect(findLast([1, 2], v => v > 5)).toBeUndefined();
    });

    it('타입 가드 predicate면 좁힌 타입을 돌려준다', () => {
        const value: number | undefined = findLast(
            [1, null] as readonly (number | null)[],
            (v): v is number => v !== null
        );
        expect(value).toBe(1);
    });
});
