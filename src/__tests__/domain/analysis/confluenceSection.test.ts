import { describe, it, expect } from 'vitest';
import {
    CONFLUENCE_PARAMS_BY_TIMEFRAME,
    DETERMINISTIC_METRICS_HEADER,
    formatDeterministicMetricsSection,
} from '@/domain/analysis/confluenceSection';
import { CONFLUENCE_MIN_BARS } from '@/domain/signals/confluence';
import type {
    Bar,
    HorizonReference,
    MarketReference,
    ReferenceLevel,
    Timeframe,
} from '@/domain/types';

function bars(count: number, start = 100, step = 0.4): Bar[] {
    return Array.from({ length: count }, (_, i) => {
        const close = start + i * step;
        return {
            time: 1700000000 + i * 1800,
            open: close,
            high: close * 1.002,
            low: close * 0.998,
            close,
            volume: 1000 + i,
        };
    });
}

/** Falling series — exercises the bearish side of the trend filter. */
function fallingBars(count: number): Bar[] {
    return bars(count, 160, -0.4);
}

/**
 * Uptrend that breaks down in the last three bars.
 *
 * A monotone decline produces no bearish signals at all: the crosses happened long ago so
 * nothing is "newly lit", and a persistently low RSI reads as oversold, which is bullish.
 * Firing the exit rule takes a late reversal.
 */
function reversalBars(count: number): Bar[] {
    const closes: number[] = [];
    let price = 100;
    for (let i = 0; i < count; i++) {
        price += i < count - 3 ? 0.5 : -4;
        closes.push(price);
    }
    return closes.map((close, i) => ({
        time: 1700000000 + i * 1800,
        open: close,
        high: close * 1.003,
        low: close * 0.997,
        close,
        volume: 900_000 + (i % 5) * 90_000,
    }));
}

function level(price: number, distancePercent: number): ReferenceLevel {
    return { price, label: 'MA50', kind: 'ma', distancePercent };
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

function reference(
    resistance: ReferenceLevel[] = [level(101, 1)],
    support: ReferenceLevel[] = [level(96, -4)]
): MarketReference {
    const h = horizon(resistance, support);
    return { short: h, medium: h, long: h };
}

const EMPTY_REFERENCE: MarketReference = (() => {
    const h = horizon([], []);
    return { short: h, medium: h, long: h };
})();

describe('CONFLUENCE_PARAMS_BY_TIMEFRAME', () => {
    it('gives the daily chart the parameters the rule was actually backtested with', () => {
        // 3 families, expected signals at full weight — the configuration measured at 70%
        // over a ten-day hold on daily bars.
        expect(CONFLUENCE_PARAMS_BY_TIMEFRAME['1Day']).toEqual({
            min: 3,
            expectedWeight: 1,
        });
    });

    it('gives every intraday chart the looser, unvalidated variant', () => {
        // A 30-minute bar is not a small daily bar: the same "3 signals" bar is reached far
        // more often and by weaker evidence, so intraday trades the backtest's authority
        // for a comparable signal rate.
        const intraday: Timeframe[] = [
            '5Min',
            '15Min',
            '30Min',
            '1Hour',
            '4Hour',
        ];
        for (const tf of intraday) {
            expect(CONFLUENCE_PARAMS_BY_TIMEFRAME[tf], tf).toEqual({
                min: 2.5,
                expectedWeight: 0.5,
            });
        }
    });
});

describe('formatDeterministicMetricsSection', () => {
    const enough = bars(CONFLUENCE_MIN_BARS + 5);

    it('renders the tally with its own threshold so the verdict is checkable', () => {
        const out = formatDeterministicMetricsSection(
            enough,
            '30Min',
            reference()
        );
        expect(out).toContain(DETERMINISTIC_METRICS_HEADER);
        expect(out).toContain('### Indicator Confluence');
        expect(out).toContain('Entry rule (>= 2.5 weighted bullish families');
        expect(out).toContain('Confluence score:');
    });

    it('prints the daily threshold on the daily chart', () => {
        const out = formatDeterministicMetricsSection(
            enough,
            '1Day',
            reference()
        );
        expect(out).toContain('Entry rule (>= 3 weighted bullish families');
        expect(out).toContain('thresholds the original backtest used');
    });

    it('does not claim the backtest win rate for the family-counting variant', () => {
        // The measured 70% was produced by a rule that counted signal TYPES. Restoring the
        // thresholds does not restore the counting unit, and a prompt line that says
        // otherwise hands the model a validated-sounding number for an unvalidated rule.
        const out = formatDeterministicMetricsSection(
            enough,
            '1Day',
            reference()
        );
        expect(out).toContain('not the measured rule itself');
        expect(out).not.toContain('measured at a 70% win rate');
    });

    it('leaves the exit threshold below the raised daily entry threshold', () => {
        // Entry 3 / exit 2.5. Tightening entry must never tighten exit with it.
        const out = formatDeterministicMetricsSection(
            enough,
            '1Day',
            reference()
        );
        expect(out).toContain('Entry rule (>= 3 weighted bullish families');
        expect(out).toContain('Exit rule (>= 2.5 weighted bearish families');
    });

    it('marks the intraday variant as unvalidated rather than borrowing the win rate', () => {
        const out = formatDeterministicMetricsSection(
            enough,
            '30Min',
            reference()
        );
        expect(out).toContain('unvalidated parameters');
        expect(out).not.toContain('70% win rate');
    });

    it('names the counting unit so the model does not recount indicator rows', () => {
        // The prompt lists RSI, StochRSI and Connors RSI separately elsewhere; without
        // this line they read as three confirmations of the same close series.
        const out = formatDeterministicMetricsSection(
            enough,
            '30Min',
            reference()
        );
        expect(out).toContain('Counting unit: indicator families');
        expect(out).toContain('RSI, StochRSI and Connors RSI are one family');
    });

    it('says so explicitly when the history is too short to measure', () => {
        // A silently absent section reads to the model as "no confluence", which is a
        // different and stronger claim than "not measurable".
        const out = formatDeterministicMetricsSection(
            bars(10),
            '30Min',
            reference()
        );
        expect(out).toContain('Not measurable');
        expect(out).toContain('received 10');
        expect(out).not.toContain('Confluence score:');
    });

    it('flags a sub-1.0 ratio as a reason to wait, not to enter', () => {
        // resistance +1%, support -4% → 0.25
        const out = formatDeterministicMetricsSection(
            enough,
            '30Min',
            reference([level(101, 1)], [level(96, -4)])
        );
        expect(out).toContain(
            'Structural risk:reward from current price = 0.25'
        );
        expect(out).toContain('Below 1.0');
        expect(out).toContain('"wait"');
    });

    it('reports a healthy ratio without the warning', () => {
        const out = formatDeterministicMetricsSection(
            enough,
            '30Min',
            reference([level(104, 4)], [level(99, -1)])
        );
        expect(out).toContain(
            'Structural risk:reward from current price = 4.00'
        );
        expect(out).toContain('At or above 1.0');
        expect(out).not.toContain('Below 1.0');
    });

    it('falls back to a wider horizon when the nearest one has no levels', () => {
        const mixed: MarketReference = {
            short: horizon([], []),
            medium: horizon([level(104, 4)], [level(99, -1)]),
            long: horizon([level(120, 20)], [level(80, -20)]),
        };
        const out = formatDeterministicMetricsSection(enough, '30Min', mixed);
        expect(out).toContain(
            'Structural risk:reward from current price = 4.00'
        );
    });

    it('drops the risk:reward block entirely when no horizon has both sides', () => {
        const out = formatDeterministicMetricsSection(
            enough,
            '30Min',
            EMPTY_REFERENCE
        );
        expect(out).toContain('### Indicator Confluence');
        expect(out).not.toContain('### Risk:Reward From Current Price');
    });

    it('renders the bearish side of the trend filter on a falling chart', () => {
        // Every other case here trends up, so `close > SMA50` was the only branch the
        // suite ever rendered — and the exit rule was never seen firing at all.
        const out = formatDeterministicMetricsSection(
            fallingBars(CONFLUENCE_MIN_BARS + 5),
            '30Min',
            reference()
        );
        expect(out).toContain('at or below');
        expect(out).not.toContain('SMA50 unavailable');
        expect(out).toContain('Exit rule (>= 2.5 weighted bearish families');
    });

    it('renders a fired exit rule', () => {
        const out = formatDeterministicMetricsSection(
            reversalBars(130),
            '30Min',
            reference()
        );
        expect(out).toContain(
            'Exit rule (>= 2.5 weighted bearish families, >= 1 newly lit, close below SMA50): MET'
        );
        expect(out).toContain('Newly lit on this bar (bearish):');
        // The exit side never gained the higher-timeframe or volume gate that entry has,
        // so its rendered clause list must stay shorter than entry's.
        expect(out).not.toContain(
            'Exit rule (>= 2.5 weighted bearish families, >= 1 newly lit, close below SMA50, higher timeframe'
        );
    });

    it('never throws on an empty bar array', () => {
        expect(() =>
            formatDeterministicMetricsSection([], '1Day', EMPTY_REFERENCE)
        ).not.toThrow();
    });
});
