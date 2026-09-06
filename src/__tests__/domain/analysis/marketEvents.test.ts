import { describe, it, expect } from 'vitest';
import {
    MARKET_EVENT_LIMIT,
    selectMarketEvents,
} from '@/domain/analysis/marketEvents';
import type { Bar, MarketEvent } from '@/domain/types';

const START = 1_700_000_000;
const IV = 900; // 15분

/** 봉은 오래된 것부터. */
function makeBars(count: number): Bar[] {
    return Array.from({ length: count }, (_, i) => ({
        time: START + i * IV,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1000,
    }));
}

function event(
    barIndex: number,
    overrides: Partial<MarketEvent> = {}
): MarketEvent {
    return {
        publishedAt: new Date((START + barIndex * IV) * 1000),
        category: 'earnings',
        sentiment: 'bullish',
        impact: 'high',
        ...overrides,
    };
}

describe('selectMarketEvents', () => {
    it('봉 범위 밖 이벤트는 버린다', () => {
        const bars = makeBars(10);
        const tooOld = event(-5);
        const tooNew: MarketEvent = {
            ...event(0),
            publishedAt: new Date((START + 20 * IV) * 1000),
        };
        const inside = event(4);

        const selected = selectMarketEvents([tooOld, tooNew, inside], bars);

        expect(selected).toHaveLength(1);
        expect(selected[0].publishedAt).toEqual(inside.publishedAt);
    });

    it('negligible / low 영향도는 버린다', () => {
        const bars = makeBars(10);
        const kept = [
            event(2, { impact: 'high' }),
            event(4, { impact: 'medium' }),
        ];
        const dropped = [
            event(6, { impact: 'low' }),
            event(8, { impact: 'negligible' }),
        ];

        const selected = selectMarketEvents([...kept, ...dropped], bars);

        expect(selected.map(e => e.impact).toSorted()).toEqual([
            'high',
            'medium',
        ]);
    });

    it('상한 초과 시 impact 우선으로 자른다', () => {
        const bars = makeBars(30);
        // medium 을 오래된 쪽, high 를 최신 쪽에 둔다.
        const events = [
            ...Array.from({ length: 5 }, (_, i) =>
                event(i, { impact: 'medium' })
            ),
            ...Array.from({ length: 5 }, (_, i) =>
                event(10 + i, { impact: 'high' })
            ),
        ];

        const selected = selectMarketEvents(events, bars);

        expect(selected).toHaveLength(MARKET_EVENT_LIMIT);
        // 최신순이 아니라 impact 가 1순위이므로 high 만 남아야 한다.
        expect(selected.every(e => e.impact === 'high')).toBe(true);
    });

    it('봉이 비었으면 빈 배열', () => {
        expect(selectMarketEvents([event(0)], [])).toEqual([]);
    });

    it('반환 순서는 최신순', () => {
        const bars = makeBars(10);
        const selected = selectMarketEvents(
            [event(2), event(6), event(4)],
            bars
        );

        const times = selected.map(e => e.publishedAt.getTime());
        expect(times).toEqual([...times].toSorted((a, b) => b - a));
    });
});
