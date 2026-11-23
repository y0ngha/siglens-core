import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { calculateIndicators } from '@/domain/indicators';
import { detectSignals } from '@/domain/signals';
import { CONFLUENCE_MIN_BARS } from '@/domain/signals/confluence';
import type { Bar, Signal, Skill } from '@/domain/types';

// `detectSignals` is replaced by a function of the bar count so a case can say "the previous
// bar's list lacks X, this bar's list has X, and an older opposite cross is still reported".
vi.mock('@/domain/signals', async importOriginal => {
    const actual = await importOriginal<typeof import('@/domain/signals')>();
    return { ...actual, detectSignals: vi.fn(actual.detectSignals) };
});

const mockDetect = vi.mocked(detectSignals);
const actualDetect = mockDetect.getMockImplementation();

afterEach(() => {
    if (actualDetect !== undefined) mockDetect.mockImplementation(actualDetect);
    mockDetect.mockClear();
});

const makeBars = (count: number): Bar[] =>
    Array.from({ length: count }, (_, i) => {
        const close = 100 + 10 * Math.sin(i / 7) + i * 0.05;
        return {
            time: 1_600_000_000 + i * 86_400,
            open: close - 0.4,
            high: close + 1,
            low: close - 1,
            close,
            volume: 1_000_000 + (i % 13) * 10_000,
        };
    });

const MACD_GUIDE: Skill = {
    name: 'MACD Signal Guide',
    description: 'd',
    type: 'indicator_guide',
    indicators: [],
    confidenceWeight: 0.9,
    content: 'MACD DIGEST',
    gating: {
        tier: 'gated',
        signalKind: 'event',
        triggers: ['macd_bullish_cross', 'macd_bearish_cross'],
    },
    computedCard: 'macd',
};

const cross = (
    type: 'macd_bullish_cross' | 'macd_bearish_cross',
    detectedAt: number
): Signal => ({
    type,
    direction: type === 'macd_bullish_cross' ? 'bullish' : 'bearish',
    phase: 'confirmed',
    detectedAt,
});

/**
 * The bar count `N` list has an older bullish cross (3 bars back) and a bearish cross on the
 * last bar; the list of `N - 1` bars has only the bullish cross: the bearish one is newly lit.
 */
const staleBullishNewBearish = (total: number): void => {
    mockDetect.mockImplementation(bars =>
        bars.length === total
            ? [
                  cross('macd_bullish_cross', total - 4),
                  cross('macd_bearish_cross', total - 1),
              ]
            : bars.length === total - 1
              ? [cross('macd_bullish_cross', total - 4)]
              : []
    );
};

const build = (bars: Bar[]) =>
    buildAnalysisPrompt({
        symbol: 'AAPL',
        companyName: 'Apple Inc.',
        bars,
        indicators: calculateIndicators(bars),
        skills: [MACD_GUIDE],
        timeframe: '1Day',
    });

const printedNewlyLit = (dynamic: string): string[] =>
    ['bullish', 'bearish'].flatMap(side => {
        const line = dynamic
            .split('\n')
            .find(l => l.startsWith(`Newly lit on this bar (${side}): `));
        return [...(line ?? '').matchAll(/([a-z][a-z0-9_]*)\(/g)].map(
            m => m[1]
        );
    });

describe('the newly lit events of the cards and of the printed line are one set', () => {
    it('a cross absent from the previous bar leads its card while an older opposite cross is still reported', () => {
        const total = CONFLUENCE_MIN_BARS + 60;
        staleBullishNewBearish(total);
        const out = build(makeBars(total));

        // The printed line lists the newly lit cross...
        expect(printedNewlyLit(out.dynamic)).toEqual(['macd_bearish_cross']);
        // ...and the card takes it as its state and trend, with the older cross after it.
        const signal = out.indicatorCards[0].signals[0];
        expect(signal.reading).toMatchObject({
            state: 'macd_bearish_cross',
            signals: [
                { type: 'macd_bearish_cross', barsAgo: 0 },
                { type: 'macd_bullish_cross', barsAgo: 3 },
            ],
        });
        expect(signal.trend).toBe('bearish');
    });

    it('takes the previous-bar pass once per prompt build', () => {
        const total = CONFLUENCE_MIN_BARS + 60;
        staleBullishNewBearish(total);
        build(makeBars(total));
        // One call on the bars, one on the bars without the last: the cards and the printed
        // lines share them.
        expect(
            mockDetect.mock.calls.map(([bars]) => bars.length).toSorted()
        ).toEqual([total - 1, total]);
    });

    it('with no previous-bar list difference nothing is newly lit and the card keeps detection order', () => {
        const total = CONFLUENCE_MIN_BARS + 60;
        mockDetect.mockImplementation(bars =>
            bars.length >= total - 1
                ? [
                      cross('macd_bullish_cross', total - 4),
                      cross('macd_bearish_cross', total - 6),
                  ]
                : []
        );
        const out = build(makeBars(total));
        expect(printedNewlyLit(out.dynamic)).toEqual([]);
        expect(out.indicatorCards[0].signals[0].reading).toMatchObject({
            state: 'macd_bullish_cross',
        });
        expect(out.indicatorCards[0].signals[0].trend).toBe('neutral');
    });

    it('at or below the confluence minimum nothing is newly lit: no printed line, detection order, no "everything is new" fallback', () => {
        const total = CONFLUENCE_MIN_BARS;
        staleBullishNewBearish(total);
        const out = build(makeBars(total));
        expect(out.dynamic).toContain(
            'Not measurable: the check needs more than'
        );
        expect(printedNewlyLit(out.dynamic)).toEqual([]);
        expect(out.indicatorCards[0].signals[0].reading).toMatchObject({
            state: 'macd_bullish_cross',
        });
        expect(out.indicatorCards[0].signals[0].trend).toBe('neutral');
        // No previous-bar pass either: nothing consumes it.
        expect(mockDetect.mock.calls.map(([bars]) => bars.length)).toEqual([
            total,
        ]);
    });

    it('one bar above the minimum is measurable: the newly lit set exists', () => {
        const total = CONFLUENCE_MIN_BARS + 1;
        staleBullishNewBearish(total);
        const out = build(makeBars(total));
        expect(printedNewlyLit(out.dynamic)).toEqual(['macd_bearish_cross']);
        expect(out.indicatorCards[0].signals[0].reading?.state).toBe(
            'macd_bearish_cross'
        );
    });

    it('on real signals the cards lead with exactly the events the printed lines list', () => {
        mockDetect.mockClear();
        const out = build(makeBars(CONFLUENCE_MIN_BARS + 200));
        expect(out.dynamic).toContain('Newly lit on this bar (bullish): ');
        const newly = printedNewlyLit(out.dynamic).filter(t =>
            MACD_GUIDE.gating?.tier === 'gated' &&
            MACD_GUIDE.gating.signalKind === 'event'
                ? MACD_GUIDE.gating.triggers.includes(t)
                : false
        );
        const reading = out.indicatorCards[0]?.signals[0].reading;
        const lead = (reading?.signals ?? [])
            .slice(0, newly.length)
            .map(s => s.type)
            .toSorted();
        expect(lead).toEqual(newly.toSorted());
    });
});
