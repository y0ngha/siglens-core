import { describe, it, expect } from 'vitest';
import {
    CONFLUENCE_PARAMS_BY_TIMEFRAME,
    DETERMINISTIC_METRICS_HEADER,
    formatDeterministicMetricsSection,
    newsDrivenWashoutEvent,
} from '@/domain/analysis/confluenceSection';
import { CONFLUENCE_MIN_BARS } from '@/domain/signals/confluence';
import type {
    Bar,
    HorizonReference,
    MarketEvent,
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
        expect(out).toContain('### Indicator Agreement');
        expect(out).toContain('Entry rule (>= 2.5 weighted bullish families');
        // No printed 0-100 score — the model quoted it ("47/100") as a finding.
        expect(out).not.toMatch(/score|\/ ?100/i);
        expect(out).toMatch(
            /Agreeing indicator groups \(weighted, a half-weight member counts 0\.5\): [\d.]+ bullish vs [\d.]+ bearish/
        );
    });

    it('prints the daily threshold on the daily chart', () => {
        const out = formatDeterministicMetricsSection(
            enough,
            '1Day',
            reference()
        );
        expect(out).toContain('Entry rule (>= 3 weighted bullish families');
        expect(out).toContain('Reliability: Daily, descriptive only');
    });

    it('skips levels inside half the mean bar range when picking the risk:reward pair', () => {
        // bars() spans 0.4% per bar, so the floor is 0.20%. The 0.10% / -0.05% levels sit
        // inside it; a ratio built from them would read 2.00 on pure noise.
        const out = formatDeterministicMetricsSection(
            enough,
            '30Min',
            reference(
                [level(100.1, 0.1), level(103, 3)],
                [level(99.95, -0.05), level(98, -2)]
            )
        );
        expect(out).toContain('Levels within 0.20% of the current price');
        expect(out).toContain('Nearest resistance MA50 at 103.00 (3.00%)');
        expect(out).toContain('Nearest support MA50 at 98.00 (-2.00%)');
        expect(out).toContain(
            'Structural risk:reward from current price = 1.50'
        );
    });

    it('renders prices at the precision it is given', () => {
        const out = formatDeterministicMetricsSection(
            enough,
            '30Min',
            reference([level(0.08423, 1)], [level(0.0826, -2)]),
            5
        );
        expect(out).toContain('MA50 at 0.08423 (1.00%)');
        expect(out).toContain('MA50 at 0.08260 (-2.00%)');
    });

    it('skips no level and prints no noise line when the bars have zero range', () => {
        // A zero-range history gives a 0% floor: the nearest levels are used as-is.
        const flat = enough.map(b => ({ ...b, high: b.close, low: b.close }));
        const out = formatDeterministicMetricsSection(
            flat,
            '30Min',
            reference()
        );
        expect(out).not.toContain('Levels within');
        expect(out).toContain(
            'Structural risk:reward from current price = 0.25'
        );
    });

    it('treats a history with no usable bar range as a 0% floor', () => {
        // Every bar fails the `high >= low` guard, so no range is measurable at all —
        // a separate branch from zero-width bars, which still produce a (zero) range.
        const inverted = enough.map(b => ({
            ...b,
            high: b.close * 0.99,
            low: b.close * 1.01,
        }));
        const out = formatDeterministicMetricsSection(
            inverted,
            '30Min',
            reference()
        );
        expect(out).not.toContain('Levels within');
        expect(out).toContain(
            'Structural risk:reward from current price = 0.25'
        );
    });

    it('renders the daily rule as descriptive, with the re-measurement instead of the old win rate', () => {
        // The old 70% came from a rule that counted signal TYPES and was never compared
        // with a baseline; re-measured (2000–2026) the daily entry rule trailed the
        // baseline in every period. The prompt must say so rather than lend it authority.
        const out = formatDeterministicMetricsSection(
            enough,
            '1Day',
            reference()
        );
        expect(out).toContain(
            'days with this entry rule met were followed by below-baseline 10-day returns in every period'
        );
        expect(out).toContain('not as evidence for or against entering');
        expect(out).not.toContain('strong evidence');
        expect(out).not.toContain('70%');
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
        expect(out).toContain('Reliability: Intraday, descriptive only');
        expect(out).toContain('no measured forward edge on intraday bars');
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
        expect(out).not.toMatch(/Agreeing indicator groups/);
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

    it('says the risk:reward is not measurable when no horizon has both sides', () => {
        // A silently missing block reads to the model as "nothing to worry about".
        const out = formatDeterministicMetricsSection(
            enough,
            '30Min',
            EMPTY_REFERENCE
        );
        expect(out).toContain('### Indicator Agreement');
        expect(out).toContain('### Risk:Reward From Current Price');
        expect(out).toContain('Not measurable:');
        expect(out).not.toContain('Structural risk:reward from current price');
    });

    it('skips levels the reference builder flagged at price', () => {
        const flagged: MarketReference = {
            short: horizon(
                [{ ...level(100.1, 0.1), atPrice: true }, level(104, 4)],
                [{ ...level(99.9, -0.1), atPrice: true }, level(99, -1)]
            ),
            medium: horizon([], []),
            long: horizon([], []),
        };
        const out = formatDeterministicMetricsSection(enough, '30Min', flagged);
        expect(out).toContain('at 104');
        expect(out).not.toContain('at 100.1');
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

describe('formatDeterministicMetricsSection — risk leg', () => {
    it('divides by the support distance itself, with no extra floor', () => {
        // `bars()` ranges ±0.2%: mean range 0.4%, at-price band 0.2%. A support 0.3% away
        // clears the band, so the ratio is 4 / 0.3 = 13.33. A full-bar-range floor on the
        // risk leg alone flipped 34 of 90 real-chart verdicts and was removed.
        const out = formatDeterministicMetricsSection(
            bars(CONFLUENCE_MIN_BARS + 5),
            '30Min',
            reference([level(104, 4)], [level(99.7, -0.3)])
        );
        expect(out).toContain(
            'Structural risk:reward from current price = 13.33'
        );
        expect(out).not.toContain('floored');
    });
});

describe('formatDeterministicMetricsSection — Short-Term Washout', () => {
    const shortDaily = bars(CONFLUENCE_MIN_BARS + 5);

    /** 250 daily bars rising, the last one dropping below the 14-bar low — still above MA200. */
    function washoutBars(): Bar[] {
        const closes = [
            ...Array.from({ length: 249 }, (_, i) => 100 + i * 0.5),
            205,
        ];
        return closes.map((close, i) => ({
            time: 1700000000 + i * 86400,
            open: close,
            high: close + 1,
            low: close - 1,
            close,
            volume: 1000 + i,
        }));
    }

    /** 상승 추세 끝 14봉 범위(고가 225, 저가 217)의 85% 지점 — %R -85, MA200 위. */
    function nearWashoutBars(): Bar[] {
        const closes = [
            ...Array.from({ length: 249 }, (_, i) => 100 + i * 0.5),
            218.2,
        ];
        return closes.map((close, i) => ({
            time: 1700000000 + i * 86400,
            open: close,
            high: close + 1,
            low: close - 1,
            close,
            volume: 1000 + i,
        }));
    }

    /** 하락 추세 끝에서 신저가 — %R ≤ -90, MA200 아래. */
    function belowMa200Bars(): Bar[] {
        const closes = [
            ...Array.from({ length: 249 }, (_, i) => 300 - i * 0.5),
            170,
        ];
        return closes.map((close, i) => ({
            time: 1700000000 + i * 86400,
            open: close,
            high: close + 1,
            low: close - 1,
            close,
            volume: 1000 + i,
        }));
    }

    it('never prints the internal labels (confluence / washout / rule engine) in any measured block — the model echoes them', () => {
        const banned = /confluence|washout|rule engine/i;
        const lastMs = washoutBars().at(-1)!.time * 1000;
        const event: MarketEvent = {
            publishedAt: new Date(lastMs + 13 * 3_600_000),
            category: 'earnings',
            sentiment: 'bearish',
            impact: 'high',
        };
        const outputs = [
            formatDeterministicMetricsSection(
                washoutBars(),
                '1Day',
                reference()
            ),
            formatDeterministicMetricsSection(
                washoutBars(),
                '1Day',
                reference(),
                2,
                [event]
            ),
            formatDeterministicMetricsSection(shortDaily, '1Day', reference()),
            formatDeterministicMetricsSection(bars(10), '1Day', reference()),
            // The two readings that carry their own base-rate text.
            formatDeterministicMetricsSection(
                nearWashoutBars(),
                '1Day',
                reference()
            ),
            formatDeterministicMetricsSection(
                belowMa200Bars(),
                '1Day',
                reference()
            ),
        ];
        // The scan only means something if the blocks it covers were really rendered.
        expect(outputs[4]).toContain('Reading: near sell-off in an uptrend');
        expect(outputs[4]).toContain('Measured: Historical base rate');
        expect(outputs[5]).toContain('Reading: sell-off below MA200');
        expect(outputs[5]).toContain('Measured: Historical base rate');
        for (const out of outputs) {
            expect(out.split('\n').filter(line => banned.test(line))).toEqual(
                []
            );
        }
    });

    it('renders the reading, its inputs and the measured base rate on a daily washout, between the tally and risk:reward', () => {
        const out = formatDeterministicMetricsSection(
            washoutBars(),
            '1Day',
            reference()
        );
        expect(out).toContain(
            '### Short-term sell-off check (computed, 1Day bars)'
        );
        expect(out).toContain('Reading: sell-off in an uptrend');
        expect(out).toMatch(/Williams %R\(14\): -\d/);
        expect(out).toContain('RSI(2): ');
        expect(out).toContain('Exit reference MA5: ');
        expect(out).toContain(
            'Measured: Historical base rate, not an instruction.'
        );
        const washoutAt = out.indexOf('### Short-term sell-off check');
        expect(washoutAt).toBeGreaterThan(
            out.indexOf('### Indicator Agreement')
        );
        expect(washoutAt).toBeLessThan(
            out.indexOf('### Risk:Reward From Current Price')
        );
    });

    it('prints the computed entry verdict for a washout in an uptrend, before the base rate', () => {
        const out = formatDeterministicMetricsSection(
            washoutBars(),
            '1Day',
            reference()
        );
        const verdictAt = out.indexOf(
            'Entry verdict (computed): enter — sell-off path.'
        );
        expect(verdictAt).toBeGreaterThan(
            out.indexOf('Reading: sell-off in an uptrend')
        );
        expect(verdictAt).toBeLessThan(
            out.indexOf('Measured: Historical base rate')
        );
        expect(out).toContain('No confirmation candle is required.');
    });

    it('suspends the verdict when an earnings event landed in the last sessions — a news-driven drop the measurement does not cover', () => {
        const bs = washoutBars();
        const lastMs = bs.at(-1)!.time * 1000;
        const earnings: MarketEvent = {
            // 같은 세션의 기사는 봉 스탬프(UTC 자정)보다 늦게 찍힌다.
            publishedAt: new Date(lastMs + 13 * 3_600_000),
            category: 'earnings',
            sentiment: 'bearish',
            impact: 'high',
        };
        const out = formatDeterministicMetricsSection(
            bs,
            '1Day',
            reference(),
            2,
            [earnings]
        );
        const publishedUtc = new Date(lastMs + 13 * 3_600_000)
            .toISOString()
            .slice(0, 16)
            .replace('T', ' ');
        expect(out).toContain(
            `Entry verdict (computed): none — a high-impact earnings event (bearish, published ${publishedUtc} UTC) landed within the last 3 sessions.`
        );
        // 판정 줄은 이벤트를 직접 적는다 — `## Market Events`는 봉 스탬프에서 끊겨 그 기사가 없을 수 있다.
        expect(out).not.toContain('see ## Market Events');
        expect(out).not.toContain('enter — sell-off path');
        expect(out).toContain('Reading: sell-off in an uptrend');
    });

    it('keeps the enter verdict when the only event is old, bullish or not a company event', () => {
        const bs = washoutBars();
        const lastMs = bs.at(-1)!.time * 1000;
        const day = 86_400_000;
        const events: MarketEvent[] = [
            {
                publishedAt: new Date(lastMs - 5 * day),
                category: 'earnings',
                sentiment: 'bearish',
                impact: 'high',
            },
            {
                publishedAt: new Date(lastMs),
                category: 'earnings',
                sentiment: 'bullish',
                impact: 'high',
            },
            {
                publishedAt: new Date(lastMs),
                category: 'product',
                sentiment: 'bearish',
                impact: 'high',
            },
        ];
        const out = formatDeterministicMetricsSection(
            bs,
            '1Day',
            reference(),
            2,
            events
        );
        expect(out).toContain(
            'Entry verdict (computed): enter — sell-off path.'
        );
    });

    it('prints no entry verdict for a near washout, which stays a model judgment', () => {
        const out = formatDeterministicMetricsSection(
            nearWashoutBars(),
            '1Day',
            reference()
        );
        expect(out).toContain('Reading: near sell-off in an uptrend');
        expect(out).toContain('Measured: Historical base rate');
        expect(out).not.toContain('Entry verdict (computed)');
    });

    it('prints no entry verdict for a washout below MA200', () => {
        const out = formatDeterministicMetricsSection(
            belowMa200Bars(),
            '1Day',
            reference()
        );
        expect(out).toContain('Reading: sell-off below MA200');
        expect(out).not.toContain('Entry verdict (computed)');
    });

    it('prints no base rate when the reading is none', () => {
        const out = formatDeterministicMetricsSection(
            bars(260, 100, 0.4),
            '1Day',
            reference()
        );
        expect(out).toContain('Reading: none');
        expect(out).not.toContain('Measured: Historical base rate');
        expect(out).not.toContain('Entry verdict (computed)');
    });

    it('says the reading is not measurable below 200 daily bars instead of omitting it', () => {
        const out = formatDeterministicMetricsSection(
            shortDaily,
            '1Day',
            reference()
        );
        expect(out).toContain('### Short-term sell-off check');
        expect(out).toContain(
            `the reading needs 200 daily bars for MA200 and received ${shortDaily.length}`
        );
    });

    it('is not rendered on intraday charts, where it was never measured', () => {
        const out = formatDeterministicMetricsSection(
            washoutBars(),
            '30Min',
            reference()
        );
        expect(out).not.toContain('Short-term sell-off check');
    });
});

describe('newsDrivenWashoutEvent', () => {
    const day = 86_400_000;
    const daily = (n: number): Bar[] =>
        Array.from({ length: n }, (_, i) => ({
            time: 1_700_006_400 + i * 86_400,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1000,
        }));
    const event = (
        at: number,
        over: Partial<MarketEvent> = {}
    ): MarketEvent => ({
        publishedAt: new Date(at),
        category: 'earnings',
        sentiment: 'bearish',
        impact: 'high',
        ...over,
    });
    const bs = daily(10);
    const lastMs = bs.at(-1)!.time * 1000;
    const thirdLastMs = bs.at(-3)!.time * 1000;

    describe('잡는 경우', () => {
        it('마지막 봉 당일(봉 스탬프 이후) 기사', () => {
            const e = event(lastMs + 20 * 3_600_000);
            expect(newsDrivenWashoutEvent([e], bs)).toBe(e);
        });

        it('3세션 전 봉 스탬프 시각의 기사(창의 시작 경계 포함)', () => {
            expect(
                newsDrivenWashoutEvent([event(thirdLastMs)], bs)
            ).not.toBeNull();
        });

        it('가이던스·규제 이벤트, 중립 방향, medium 영향도 잡는다', () => {
            expect(
                newsDrivenWashoutEvent(
                    [
                        event(lastMs, {
                            category: 'guidance',
                            sentiment: 'neutral',
                            impact: 'medium',
                        }),
                    ],
                    bs
                )
            ).not.toBeNull();
            expect(
                newsDrivenWashoutEvent(
                    [event(lastMs, { category: 'regulation' })],
                    bs
                )
            ).not.toBeNull();
        });
    });

    describe('잡지 않는 경우', () => {
        it('창보다 오래된 기사, 또는 다음 날 이후 기사', () => {
            expect(
                newsDrivenWashoutEvent([event(thirdLastMs - 1)], bs)
            ).toBeNull();
            expect(
                newsDrivenWashoutEvent([event(lastMs + day)], bs)
            ).toBeNull();
        });

        it('bullish 방향, 회사 이벤트가 아닌 범주, low·negligible 영향', () => {
            expect(
                newsDrivenWashoutEvent(
                    [event(lastMs, { sentiment: 'bullish' })],
                    bs
                )
            ).toBeNull();
            expect(
                newsDrivenWashoutEvent(
                    [event(lastMs, { category: 'macro' })],
                    bs
                )
            ).toBeNull();
            expect(
                newsDrivenWashoutEvent(
                    [event(lastMs, { category: 'm_and_a' })],
                    bs
                )
            ).toBeNull();
            expect(
                newsDrivenWashoutEvent([event(lastMs, { impact: 'low' })], bs)
            ).toBeNull();
            expect(
                newsDrivenWashoutEvent(
                    [event(lastMs, { impact: 'negligible' })],
                    bs
                )
            ).toBeNull();
        });

        it('이벤트나 봉이 없으면 null', () => {
            expect(newsDrivenWashoutEvent([], bs)).toBeNull();
            expect(newsDrivenWashoutEvent([event(lastMs)], [])).toBeNull();
        });
    });

    it('봉이 3개보다 적으면 첫 봉부터 본다', () => {
        const two = daily(2);
        expect(
            newsDrivenWashoutEvent([event(two[0]!.time * 1000)], two)
        ).not.toBeNull();
    });
});
