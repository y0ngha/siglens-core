import { describe, expect, it } from 'vitest';
import {
    formatStopTargetSpacing,
    printedResistanceLevels,
    printedSupportLevels,
} from '@/domain/analysis/stopTargetSpacing';
import { PLAN_MIN_ATR_SPACING } from '@/domain/analysis/planCheck';
import {
    SL_FALLBACK_ATR_MULTIPLIER,
    SL_MAX_ATR_MULTIPLIER,
} from '@/domain/analysis/ai-levels';
import { formatDeterministicMetricsSection } from '@/domain/analysis/confluenceSection';
import type { PriceQuoting } from '@/domain/analysis/promptFormat';
import type {
    Bar,
    HorizonReference,
    MarketReference,
    ReferenceLevel,
} from '@/domain/types';

const USD: PriceQuoting = { dp: 2, krxTick: null };

/** Flat bars with a constant 2-point range: ATR(14) = 2 exactly, mean range 2%. */
function flatBars(count: number): Bar[] {
    return Array.from({ length: count }, (_, i) => ({
        time: 1700000000 + i * 86400,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1000,
    }));
}

function level(
    price: number,
    label: string,
    extra: Partial<ReferenceLevel> = {}
): ReferenceLevel {
    return {
        price,
        label,
        kind: 'ma',
        distancePercent: price - 100,
        ...extra,
    };
}

function horizon(
    resistance: ReferenceLevel[],
    support: ReferenceLevel[]
): HorizonReference {
    return {
        window: { bars: 60, fromTime: 1700000000, toTime: 1700108000 },
        levels: { resistance, support },
        structure: {
            priceVsMA60: 'above',
            priceVsMA200: 'above',
            emaStack: 'aligned_up',
            swingStructure: 'HH_HL',
            adx: 25,
            efficiencyRatio: 0.4,
            regime: 'trending',
        },
    };
}

const SUPPORTS = [
    level(99.5, 'Pivot S1', { atPrice: true }),
    level(98, 'MA20'),
    level(97.5, 'Fib 38.2%'),
    level(96, 'MA60'),
    level(94, 'POC'),
];
const RESISTANCES = [
    level(101.5, 'Pivot R1'),
    level(102.5, 'Swing high'),
    level(104, 'Fib 161.8%'),
];

function reference(
    resistance = RESISTANCES,
    support = SUPPORTS
): MarketReference {
    // The same levels in every horizon: the block must print each price once.
    const h = horizon(resistance, support);
    return { short: h, medium: h, long: h };
}

describe('formatStopTargetSpacing', () => {
    it('prints ATR(14) in price terms and states the one-ATR rule', () => {
        const lines = formatStopTargetSpacing(
            reference(),
            flatBars(30),
            '1Day',
            USD
        );
        expect(lines[0]).toBe('### Stop & Target Spacing');
        expect(lines[1]).toContain('ATR(14) = 2.00 (2.00% of the last close)');
        expect(lines[1]).toContain(
            `must sit at least ${PLAN_MIN_ATR_SPACING}×ATR below the low of entryPrices (code moves a closer stop)`
        );
    });

    it('lists, from the close, the first supports and resistance at least one ATR away', () => {
        const lines = formatStopTargetSpacing(
            reference(),
            flatBars(30),
            '1Day',
            USD
        );
        const atPrice = lines.find(l =>
            l.startsWith('- Entry zone at the current price')
        );
        // 98 sits exactly one ATR (2) below 100 and qualifies; 99.5 is inside the noise band.
        expect(atPrice).toContain(
            'stop candidates MA20 at 98.00, Fib 38.2% at 97.50;'
        );
        // 101.5 is closer than one ATR above 100 and is skipped.
        expect(atPrice).toContain('first target from Swing high at 102.50');
    });

    it('anchors the pullback line on the nearest support beyond noise, not the at-price one', () => {
        const lines = formatStopTargetSpacing(
            reference(),
            flatBars(30),
            '1Day',
            USD
        );
        const pullback = lines.find(l =>
            l.startsWith('- Entry zone at the nearest support')
        );
        expect(pullback).toContain('(MA20 at 98.00)');
        expect(pullback).toContain(
            'stop candidates MA60 at 96.00, POC at 94.00;'
        );
        expect(pullback).toContain('first target from Pivot R1 at 101.50');
    });

    it('prints each price once even when every horizon repeats it', () => {
        const text = formatStopTargetSpacing(
            reference(),
            flatBars(30),
            '1Day',
            USD
        ).join('\n');
        expect(text.match(/MA60 at 96\.00/g)).toHaveLength(1);
    });

    it('says no level clears one ATR instead of falling back to a closer one', () => {
        const lines = formatStopTargetSpacing(
            reference([level(101.5, 'Pivot R1')], [level(98.5, 'MA20')]),
            flatBars(30),
            '1Day',
            USD
        );
        const atPrice = lines.find(l =>
            l.startsWith('- Entry zone at the current price')
        );
        expect(atPrice).toContain('stop candidates none — no support level');
        expect(atPrice).toContain(
            `Do not compute a stop price yourself: set stopLoss to the lowest support printed below the zone and name it in exit; code replaces it with a stop ${SL_FALLBACK_ATR_MULTIPLIER}×ATR below the zone low (no lower than ${SL_MAX_ATR_MULTIPLIER}×ATR below the zone middle, and no stop at all when the zone is too wide for any stop to fit), so say in exit that the final stop is ATR-based and set by code`
        );
        expect(atPrice).toContain(
            'first target from none — no resistance level'
        );
    });

    it('omits the pullback line when no support lies beyond noise', () => {
        const lines = formatStopTargetSpacing(
            reference(RESISTANCES, [
                level(99.5, 'Pivot S1', { atPrice: true }),
            ]),
            flatBars(30),
            '1Day',
            USD
        );
        expect(
            lines.some(l => l.startsWith('- Entry zone at the nearest support'))
        ).toBe(false);
    });

    it('cites the backtest measurement on daily charts only', () => {
        const daily = formatStopTargetSpacing(
            reference(),
            flatBars(30),
            '1Day',
            USD
        ).join('\n');
        const hourly = formatStopTargetSpacing(
            reference(),
            flatBars(30),
            '1Hour',
            USD
        ).join('\n');
        expect(daily).toContain('Measured in a two-year daily backtest');
        expect(hourly).not.toContain('Measured in a two-year daily backtest');
    });

    it('says ATR is not measurable on a short history instead of vanishing', () => {
        const lines = formatStopTargetSpacing(
            reference(),
            flatBars(10),
            '1Day',
            USD
        );
        expect(lines).toHaveLength(2);
        expect(lines[1]).toContain(
            'Not measurable: ATR(14) needs more than 14 bars and received 10.'
        );
    });
});

describe('formatDeterministicMetricsSection — spacing block', () => {
    it('ends the section with the spacing block', () => {
        const section = formatDeterministicMetricsSection(
            flatBars(60),
            '1Day',
            reference(),
            USD,
            [],
            undefined,
            null
        );
        expect(section).toContain('### Stop & Target Spacing');
        expect(
            section.indexOf('### Risk:Reward From Current Price')
        ).toBeLessThan(section.indexOf('### Stop & Target Spacing'));
    });
});

describe('printed levels (the list the stop floor snaps to)', () => {
    it('are the levels beyond the at-price band, nearest first, one per quoted price', () => {
        const supports = printedSupportLevels(reference(), USD).map(
            l => l.price
        );
        // 99.5 is flagged at price and dropped; the three horizons repeat each price once.
        expect(supports).toEqual([98, 97.5, 96, 94]);
        expect(
            printedResistanceLevels(reference(), USD).map(l => l.price)
        ).toEqual([101.5, 102.5, 104]);
    });

    it('collapses prices that quote alike on a KRX listing and keeps the first label', () => {
        const krx: PriceQuoting = { dp: 0, krxTick: 'share' };
        const near = [
            level(70_010, 'MA20'),
            level(70_040, 'Fib 38.2%'),
            level(69_000, 'POC'),
        ];
        const found = printedSupportLevels(reference([], near), krx);
        // 70,010 and 70,040 both quote as 70,000: one entry, the first one seen.
        expect(found.map(l => l.label)).toEqual(['MA20', 'POC']);
    });

    it('drops a level whose price is not finite', () => {
        const found = printedSupportLevels(
            reference([], [level(Number.NaN, 'bad'), level(95, 'ok')]),
            USD
        );
        expect(found.map(l => l.label)).toEqual(['ok']);
    });
});

describe('printed levels carry the printed price (R1)', () => {
    it('replace a level price with the price the prompt prints, at the quoting precision, and dedupe on it', () => {
        // 79.2233 and 79.2249 both print 79.22; 79.2251 prints 79.23.
        const found = printedSupportLevels(
            reference(
                [],
                [
                    level(79.2233, 'MA20'),
                    level(79.2249, 'Fib 38.2%'),
                    level(79.2251, 'POC'),
                ]
            ),
            USD
        );
        expect(found.map(l => [l.label, l.price])).toEqual([
            ['POC', 79.23],
            ['MA20', 79.22],
        ]);
    });

    it('lets the band decide on the printed value, in both directions', () => {
        // Ceiling 79.2212: raw 79.2233 is above it, but it prints 79.22, which is inside.
        const ceiling = 79.2212;
        const [printed] = printedSupportLevels(
            reference([], [level(79.2233, 'MA20')]),
            USD
        );
        const inBand = (price: number) => price <= ceiling;
        expect(inBand(79.2233)).toBe(false);
        expect(inBand(printed.price)).toBe(true);
        // The reverse: raw 79.2211 is inside the ceiling but prints 79.22 as well, while raw
        // 79.2251 prints 79.23 and is outside it.
        const [up] = printedSupportLevels(
            reference([], [level(79.2251, 'POC')]),
            USD
        );
        expect(79.2251 <= ceiling).toBe(false);
        expect(up.price <= ceiling).toBe(false);
    });

    it('has no duplicate prices after printing', () => {
        const prices = printedSupportLevels(
            reference(
                [],
                [level(10.001, 'a'), level(10.004, 'b'), level(10.006, 'c')]
            ),
            USD
        ).map(l => l.price);
        expect(new Set(prices).size).toBe(prices.length);
    });
});

describe('same-leg Fibonacci levels are not candidates (R2)', () => {
    const projection = {
        high: 120,
        low: 90,
        highIndex: 40,
        lowIndex: 10,
        direction: 'up' as const,
        retracements: [],
        extensions: [],
    };
    const withLeg = (levels: ReferenceLevel[]): HorizonReference => ({
        ...horizon([], levels),
        fibProjection: projection,
    });

    it("drops the Fib rows of a horizon that repeats an earlier horizon's leg, as the prompt does", () => {
        const fib = level(94, 'Fib 61.8%', { kind: 'fib_retracement' });
        const ma = level(96, 'MA60');
        const reference: MarketReference = {
            short: withLeg([fib]),
            medium: withLeg([fib, ma]),
            long: withLeg([ma]),
        };
        const found = printedSupportLevels(reference, USD);
        // The first horizon prints the Fib row; the repeats do not, the MA row is not Fib.
        expect(found.map(l => l.label)).toEqual(['MA60', 'Fib 61.8%']);
    });

    it('is not a candidate when only the repeating horizon would have carried it', () => {
        const medium = level(94, 'Fib only here', { kind: 'fib_retracement' });
        const reference: MarketReference = {
            short: withLeg([]),
            medium: withLeg([medium]),
            long: withLeg([]),
        };
        expect(printedSupportLevels(reference, USD)).toEqual([]);
    });

    it('keeps the Fib rows of a horizon with a different leg', () => {
        const other = { ...projection, highIndex: 41 };
        const fib = level(94, 'Fib 61.8%', { kind: 'fib_retracement' });
        const reference: MarketReference = {
            short: withLeg([]),
            medium: { ...horizon([], [fib]), fibProjection: other },
            long: withLeg([]),
        };
        expect(printedSupportLevels(reference, USD).map(l => l.label)).toEqual([
            'Fib 61.8%',
        ]);
    });
});
