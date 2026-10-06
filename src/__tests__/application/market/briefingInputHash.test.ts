import { describe, it, expect } from 'vitest';
import {
    hashBriefingInput,
    quantizeForBriefingKey,
} from '@/application/market/briefingInputHash';
import type { MarketIndexData, MarketSectorData } from '@/domain/types';

const idx = (fmpSymbol: string, price: number, ch: number): MarketIndexData =>
    ({
        fmpSymbol,
        price,
        changesPercentage: ch,
    }) as MarketIndexData;

const sec = (symbol: string, price: number, ch: number): MarketSectorData =>
    ({
        symbol,
        price,
        changesPercentage: ch,
    }) as MarketSectorData;

const CTX = {
    marketLabel: '미국 증시',
    volatility: { label: 'VIX', level: 18.3 },
} as const;

describe('hashBriefingInput', () => {
    it('(Happy) 같은 입력은 같은 해시', () => {
        const a = hashBriefingInput(
            [idx('^GSPC', 1, 0.1)],
            [sec('XLK', 2, 0.2)],
            CTX
        );
        const b = hashBriefingInput(
            [idx('^GSPC', 1, 0.1)],
            [sec('XLK', 2, 0.2)],
            CTX
        );
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{16}$/);
    });
    it('(Happy) 배열 순서 무관 — 정렬로 동일 해시', () => {
        const a = hashBriefingInput(
            [],
            [sec('XLK', 1, 0), sec('XLF', 2, 0)],
            CTX
        );
        const b = hashBriefingInput(
            [],
            [sec('XLF', 2, 0), sec('XLK', 1, 0)],
            CTX
        );
        expect(a).toBe(b);
    });
    it('(Happy) indices 배열 순서 무관 — 정렬로 동일 해시', () => {
        const a = hashBriefingInput(
            [idx('^GSPC', 1, 0), idx('^DJI', 2, 0)],
            [],
            CTX
        );
        const b = hashBriefingInput(
            [idx('^DJI', 2, 0), idx('^GSPC', 1, 0)],
            [],
            CTX
        );
        expect(a).toBe(b);
    });
    it('(Happy) price 틱은 해시를 바꾸지 않는다 — 키는 등락률 버킷만 본다', () => {
        const a = hashBriefingInput([], [sec('XLK', 1, 0)], CTX);
        const b = hashBriefingInput([], [sec('XLK', 9, 0)], CTX);
        expect(a).toBe(b);
    });
    it('(Happy) 같은 버킷 안의 등락률 틱은 같은 해시', () => {
        const a = hashBriefingInput(
            [idx('^GSPC', 5000, 0.41)],
            [sec('XLK', 200, 1.2)],
            CTX
        );
        const b = hashBriefingInput(
            [idx('^GSPC', 5003, 0.58)],
            [sec('XLK', 201, 0.7)],
            CTX
        );
        expect(a).toBe(b);
    });
    it('(Happy) 0 근처의 ± 틱은 같은 버킷 — -0이 따로 갈라지지 않는다', () => {
        const a = hashBriefingInput([idx('^GSPC', 1, -0.1)], [], CTX);
        const b = hashBriefingInput([idx('^GSPC', 1, 0.1)], [], CTX);
        expect(a).toBe(b);
    });
    it('(Worst) 지수 등락률이 버킷 경계를 넘으면 해시 변경', () => {
        const a = hashBriefingInput([idx('^GSPC', 1, 0.2)], [], CTX);
        const b = hashBriefingInput([idx('^GSPC', 1, 0.8)], [], CTX);
        expect(a).not.toBe(b);
    });
    it('(Worst) 섹터 등락률이 크게 움직이면 해시 변경', () => {
        const a = hashBriefingInput([], [sec('XLK', 1, 0)], CTX);
        const b = hashBriefingInput([], [sec('XLK', 1, 5.5)], CTX);
        expect(a).not.toBe(b);
    });
    it('(Worst) 시세 실패(price 0)는 실제 보합과 다른 해시', () => {
        const a = hashBriefingInput([], [sec('XLK', 0, 0)], CTX);
        const b = hashBriefingInput([], [sec('XLK', 100, 0)], CTX);
        expect(a).not.toBe(b);
    });
    it('(Happy) 변동성 수치의 작은 틱은 같은 해시, 큰 이동은 다른 해시', () => {
        const at = (level: number): string =>
            hashBriefingInput([], [], {
                marketLabel: '미국 증시',
                volatility: { label: 'VIX', level },
            });
        expect(at(18.3)).toBe(at(18.9));
        expect(at(18.3)).not.toBe(at(24.1));
    });
    it('(Worst) 변동성 판독값 유무는 해시를 바꾼다', () => {
        const a = hashBriefingInput([], [], CTX);
        const b = hashBriefingInput([], [], {
            marketLabel: '미국 증시',
            volatility: null,
        });
        expect(a).not.toBe(b);
    });
    it('(Worst) 빈 입력도 결정적 해시', () => {
        expect(hashBriefingInput([], [], CTX)).toBe(
            hashBriefingInput([], [], CTX)
        );
    });
});

describe('quantizeForBriefingKey', () => {
    it('(Happy) 격자 위의 가장 가까운 버킷 번호를 돌려준다', () => {
        expect(quantizeForBriefingKey(0.74, 0.5)).toBe(1);
        expect(quantizeForBriefingKey(-1.3, 0.5)).toBe(-3);
        expect(quantizeForBriefingKey(2.4, 1)).toBe(2);
    });
    it('(Edge) -0을 0으로 접는다', () => {
        expect(Object.is(quantizeForBriefingKey(-0.1, 0.5), 0)).toBe(true);
    });
    it('(Worst) 유한하지 않은 값은 null', () => {
        expect(quantizeForBriefingKey(Number.NaN, 0.5)).toBeNull();
        expect(quantizeForBriefingKey(Number.POSITIVE_INFINITY, 1)).toBeNull();
    });
});
