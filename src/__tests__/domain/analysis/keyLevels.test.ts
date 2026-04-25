import { describe, it, expect } from 'vitest';
import {
    validateKeyLevels,
    clusterKeyLevels,
} from '@/domain/analysis/keyLevels';
import type { KeyLevels } from '@/domain/types';

describe('validateKeyLevels', () => {
    it('유효한 지지/저항 레벨을 그대로 반환한다', () => {
        const levels: KeyLevels = {
            support: [{ price: 100, reason: 'previous low' }],
            resistance: [{ price: 110, reason: 'previous high' }],
        };

        const result = validateKeyLevels(levels);

        expect(result.support).toHaveLength(1);
        expect(result.resistance).toHaveLength(1);
    });

    it('price가 0 이하인 레벨을 제거한다', () => {
        const levels: KeyLevels = {
            support: [
                { price: 0, reason: 'zero price' },
                { price: -10, reason: 'negative price' },
                { price: 100, reason: 'valid' },
            ],
            resistance: [],
        };

        const result = validateKeyLevels(levels);

        expect(result.support).toHaveLength(1);
        expect(result.support[0].price).toBe(100);
    });

    it('reason이 빈 문자열인 레벨을 제거한다', () => {
        const levels: KeyLevels = {
            support: [
                { price: 100, reason: '' },
                { price: 101, reason: '   ' },
                { price: 102, reason: 'valid' },
            ],
            resistance: [],
        };

        const result = validateKeyLevels(levels);

        expect(result.support).toHaveLength(1);
        expect(result.support[0].price).toBe(102);
    });

    it('poc가 유효하면 그대로 반환한다', () => {
        const levels: KeyLevels = {
            support: [],
            resistance: [],
            poc: { price: 105, reason: 'volume POC' },
        };

        const result = validateKeyLevels(levels);

        expect(result.poc).toEqual({ price: 105, reason: 'volume POC' });
    });

    it('poc가 유효하지 않으면 undefined로 반환한다', () => {
        const levels: KeyLevels = {
            support: [],
            resistance: [],
            poc: { price: 0, reason: 'invalid' },
        };

        const result = validateKeyLevels(levels);

        expect(result.poc).toBeUndefined();
    });

    it('poc가 undefined이면 undefined로 반환한다', () => {
        const levels: KeyLevels = { support: [], resistance: [] };

        const result = validateKeyLevels(levels);

        expect(result.poc).toBeUndefined();
    });
});

describe('clusterKeyLevels', () => {
    it('빈 레벨은 빈 배열로 반환한다', () => {
        const levels: KeyLevels = { support: [], resistance: [] };

        const result = clusterKeyLevels(levels, 100);

        expect(result.support).toHaveLength(0);
        expect(result.resistance).toHaveLength(0);
    });

    it('단일 레벨은 그대로 반환한다', () => {
        const levels: KeyLevels = {
            support: [{ price: 100, reason: 'low' }],
            resistance: [],
        };

        const result = clusterKeyLevels(levels, 100);

        expect(result.support).toHaveLength(1);
        expect(result.support[0].price).toBe(100);
        expect(result.support[0].count).toBe(1);
    });

    it('epsilon 내의 레벨들을 클러스터로 묶는다', () => {
        const currentPrice = 100;
        const levels: KeyLevels = {
            support: [
                { price: 100, reason: 'first' },
                { price: 100.3, reason: 'second' },
            ],
            resistance: [],
        };

        const result = clusterKeyLevels(levels, currentPrice);

        expect(result.support).toHaveLength(1);
        expect(result.support[0].count).toBe(2);
        expect(result.support[0].reason).toBe('2개 지표 수렴');
        expect(result.support[0].sources).toHaveLength(2);
    });

    it('epsilon을 초과한 레벨들은 별도 클러스터로 유지된다', () => {
        const levels: KeyLevels = {
            support: [
                { price: 100, reason: 'low1' },
                { price: 102, reason: 'low2' },
            ],
            resistance: [],
        };

        const result = clusterKeyLevels(levels, 100);

        expect(result.support).toHaveLength(2);
    });

    it('지지선 클러스터는 내림차순 정렬된다', () => {
        const levels: KeyLevels = {
            support: [
                { price: 100, reason: 'low1' },
                { price: 95, reason: 'low2' },
            ],
            resistance: [],
        };

        const result = clusterKeyLevels(levels, 100);

        expect(result.support[0].price).toBeGreaterThan(result.support[1].price);
    });

    it('저항선 클러스터는 오름차순 정렬된다', () => {
        const levels: KeyLevels = {
            support: [],
            resistance: [
                { price: 110, reason: 'high1' },
                { price: 105, reason: 'high2' },
            ],
        };

        const result = clusterKeyLevels(levels, 100);

        expect(result.resistance[0].price).toBeLessThan(
            result.resistance[1].price
        );
    });

    it('poc는 그대로 전달된다', () => {
        const poc = { price: 103, reason: 'volume POC' };
        const levels: KeyLevels = {
            support: [],
            resistance: [],
            poc,
        };

        const result = clusterKeyLevels(levels, 100);

        expect(result.poc).toEqual(poc);
    });
});
