import { describe, it, expect } from 'vitest';
import { formatMarketEventsSection } from '@/domain/analysis/marketEventsSection';
import { formatBarDateTime } from '@/domain/analysis/promptFormat';
import type { Bar, MarketEvent } from '@/domain/types';

const START = 1_700_000_000;
const IV = 900;

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

describe('formatMarketEventsSection', () => {
    it('이벤트가 없으면 "" 를 돌려준다', () => {
        expect(
            formatMarketEventsSection([], makeBars(10), 'NVDA', '15Min')
        ).toBe('');
    });

    it('봉이 없으면 "" 를 돌려준다', () => {
        expect(formatMarketEventsSection([event(2)], [], 'NVDA', '15Min')).toBe(
            ''
        );
    });

    it('필터를 통과하는 이벤트가 없으면 "" 를 돌려준다', () => {
        // 섹션 자체가 렌더 전에 좁히기를 수행하므로, low 만 주면 빈 문자열이다.
        const section = formatMarketEventsSection(
            [event(3, { impact: 'low' })],
            makeBars(10),
            'NVDA',
            '15Min'
        );
        expect(section).toBe('');
    });

    it('헤더에 심볼과 타임프레임 라벨이 들어간다', () => {
        const section = formatMarketEventsSection(
            [event(4)],
            makeBars(10),
            'NVDA',
            '15Min'
        );
        expect(section).toContain('## Market Events (NVDA · 15-Minute');
    });

    it('봉 상대 위치와 분류를 렌더한다', () => {
        const bars = makeBars(10); // 마지막 인덱스 9
        const section = formatMarketEventsSection(
            [
                event(5, {
                    category: 'regulation',
                    sentiment: 'bearish',
                    impact: 'medium',
                }),
            ],
            bars,
            'NVDA',
            '15Min'
        );

        expect(section).toContain('- 4 bars ago');
        expect(section).toContain('regulation, bearish, medium impact');
    });

    it('시각은 `formatBarDateTime` 과 같은 문자열이라 봉 행과 매칭된다', () => {
        const bars = makeBars(10);
        // 봉 사이 시각에 발행돼도 그 봉의 시각으로 앵커된다.
        const between = new Date((START + 6 * IV + 300) * 1000);
        const section = formatMarketEventsSection(
            [{ ...event(0), publishedAt: between }],
            bars,
            'NVDA',
            '15Min'
        );

        const expected = formatBarDateTime((START + 6 * IV) * 1000);
        expect(section).toContain(`(${expected})`);
    });

    it('기사 문구가 새어 나가지 않는다 — 분류 어휘만 쓴다', () => {
        const section = formatMarketEventsSection(
            [event(3)],
            makeBars(10),
            'NVDA',
            '15Min'
        );

        expect(
            section.split('\n').filter(l => l.startsWith('- '))
        ).toHaveLength(1);
    });

    describe('earningsDates', () => {
        const bars = makeBars(10);
        const render = (dates?: readonly string[]): string =>
            formatMarketEventsSection([event(8)], bars, 'NVDA', '15Min', dates);
        const reportDay = new Date(event(8).publishedAt)
            .toISOString()
            .slice(0, 10);

        it('renders earnings on a real report date as earnings', () => {
            expect(render([reportDay])).toContain(': earnings, bullish');
        });

        it('renders off-date earnings as earnings-themed news', () => {
            expect(render(['2030-01-01'])).toContain(
                "earnings-related news (not this company's report), bullish"
            );
        });

        it('treats an empty earningsDates like absent (calendar unknown)', () => {
            const out = render([]);
            expect(out).toContain(': earnings-related news, bullish');
            expect(out).not.toContain('not this company');
        });

        it('never claims a report when earningsDates is absent', () => {
            const out = render(undefined);
            expect(out).toContain(': earnings-related news, bullish');
            expect(out).not.toContain(': earnings,');
        });
    });
});
