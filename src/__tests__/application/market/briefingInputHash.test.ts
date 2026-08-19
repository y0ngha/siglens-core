import { describe, it, expect } from 'vitest';
import { hashBriefingInput } from '@/application/market/briefingInputHash';
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
    it('(Worst) price 변동 시 해시 변경', () => {
        const a = hashBriefingInput([], [sec('XLK', 1, 0)], CTX);
        const b = hashBriefingInput([], [sec('XLK', 9, 0)], CTX);
        expect(a).not.toBe(b);
    });
    it('(Worst) changesPercentage 변동 시 해시 변경', () => {
        const a = hashBriefingInput([], [sec('XLK', 1, 0)], CTX);
        const b = hashBriefingInput([], [sec('XLK', 1, 5.5)], CTX);
        expect(a).not.toBe(b);
    });
    it('(Worst) 빈 입력도 결정적 해시', () => {
        expect(hashBriefingInput([], [], CTX)).toBe(
            hashBriefingInput([], [], CTX)
        );
    });
});
