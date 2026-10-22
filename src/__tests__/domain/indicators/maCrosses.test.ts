import { describe, expect, it } from 'vitest';
import { findMaCrosses } from '@/domain/indicators/maCrosses';
import type { Bar } from '@/domain/types';

const DAY = 86_400;

function bars(closes: number[]): Bar[] {
    return closes.map((close, i) => ({
        time: 1_700_000_000 + i * DAY,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1,
    }));
}

const kinds = (b: Bar[], f: number, s: number, l: number) =>
    findMaCrosses(b, f, s, l).crosses.map(c => c.kind);

// rising, then falling (fast 2 drops below slow 4), then rising again
const UP_DOWN_UP = [8, 9, 10, 11, 10, 9, 8, 7, 6, 7, 9, 11, 13];

describe('findMaCrosses', () => {
    it('2/4 이평선: 위 → 아래 → 위면 dead 다음 golden을 시간순으로 돌려준다', () => {
        const b = bars(UP_DOWN_UP);
        const r = findMaCrosses(b, 2, 4, 100);
        expect(r.crosses.map(c => c.kind)).toEqual(['dead', 'golden']);
        expect(r.crosses[0].fast).toBeLessThan(r.crosses[0].slow);
        expect(r.crosses[1].fast).toBeGreaterThan(r.crosses[1].slow);
    });

    it('룩백 창의 첫 봉에서 난 교차는 포함하고, 창 밖의 교차는 제외한다(아래 경계)', () => {
        const b = bars(UP_DOWN_UP);
        const deadAt = findMaCrosses(b, 2, 4, 100).crosses[0];
        const idx = b.findIndex(x => x.time === deadAt.time);
        expect(kinds(b, 2, 4, b.length - idx)).toEqual(['dead', 'golden']);
        expect(kinds(b, 2, 4, b.length - idx - 1)).toEqual(['golden']);
    });

    it('위에 있다가 닿고 다시 위로 가면 교차가 아니다', () => {
        expect(
            kinds(bars([1, 2, 3, 4, 5, 6, 6, 6, 6, 7, 8]), 2, 4, 100)
        ).toEqual([]);
    });

    it('아래 → 같음 → 위로 뒤집히면 골든 한 번', () => {
        expect(
            kinds(bars([9, 8, 7, 6, 5, 5, 5, 5, 6, 7, 8]), 2, 4, 100)
        ).toEqual(['golden']);
    });

    it('계속 같은 값이거나, 같은 값에서 출발해 벌어지면 교차가 없다', () => {
        expect(kinds(bars(Array(20).fill(5)), 2, 4, 100)).toEqual([]);
        expect(kinds(bars([5, 5, 5, 5, 5, 5, 6, 7]), 2, 4, 100)).toEqual([]);
    });

    it('기본값(50/200/252): 452봉 이상이면 complete, 짧으면 complete=false라 빈 결과를 "없음"으로 읽지 않는다', () => {
        const wave = (n: number) =>
            bars(Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 40)));
        const full = findMaCrosses(wave(452));
        expect(full.complete).toBe(true);
        expect(full.evaluatedBars).toBe(252);
        const partial = findMaCrosses(wave(300));
        expect(partial.complete).toBe(false);
        expect(partial.evaluatedBars).toBe(101);
        expect(findMaCrosses(wave(451)).complete).toBe(false);
    });

    it('짧은 데이터·빈 배열·비정상 가격', () => {
        expect(findMaCrosses(bars([1, 2, 3]), 2, 4, 100)).toEqual({
            crosses: [],
            evaluatedBars: 0,
            complete: false,
        });
        expect(findMaCrosses([], 50, 200, 252).complete).toBe(false);
        expect(
            findMaCrosses(bars([1, 2, NaN, 4, 5, 6, 7]), 2, 4, 100).crosses
        ).toEqual([]);
    });
});
