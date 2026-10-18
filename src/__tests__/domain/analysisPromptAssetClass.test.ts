import { describe, it, expect } from 'vitest';
import { buildAnalysisPrompt as buildAnalysisPromptRaw } from '@/domain/analysis/prompt';
import { calculateIndicators } from '@/domain/indicators';
import { EMPTY_INDICATOR_RESULT } from '@/domain/indicators/constants';
import type { AssetClass, Bar, CurrencyCode, Timeframe } from '@/domain/types';

// See prompt.test.ts for why this file shadows the raw `{ stable, dynamic }`
// return with a flattening wrapper (spec §3.4 assembly split).
const buildAnalysisPrompt = (
    ...args: Parameters<typeof buildAnalysisPromptRaw>
): string => {
    const { stable, dynamic } = buildAnalysisPromptRaw(...args);
    return `${stable}\n\n${dynamic}`;
};

const bars: Bar[] = []; // empty is fine; we assert framing text, not data sections
const indicators = EMPTY_INDICATOR_RESULT;

describe('buildAnalysisPrompt assetClass framing', () => {
    it('crypto prompt avoids equity-only framing and adds 24/7 context', () => {
        const p = buildAnalysisPrompt(
            'BTCUSD',
            'Bitcoin',
            bars,
            indicators,
            [],
            '1Day',
            undefined,
            'crypto'
        );
        expect(p).toMatch(/24\/7|no market open\/close/i);
        expect(p).not.toMatch(/earnings report|quarterly earnings|P\/E ratio/i);
    });

    it('equity prompt (default) is unchanged framing', () => {
        const p = buildAnalysisPrompt(
            'AAPL',
            'Apple',
            bars,
            indicators,
            [],
            '1Day'
        );
        // Must contain the equity framing literal emitted by buildAnalysisPrompt.
        expect(p).toContain('U.S. equity');
        // Must not bleed crypto-specific context into an equity prompt.
        expect(p).not.toMatch(/24\/7|no market open\/close/i);
    });
});

/** Oscillating bars around `base`, long enough for every indicator to warm up. */
function syntheticBars(
    count: number,
    base: number,
    intervalSeconds = 3_600
): Bar[] {
    return Array.from({ length: count }, (_, i) => {
        const close = base * (1 + 0.02 * Math.sin(i / 4) + 0.0005 * i);
        return {
            time: 1_788_000_000 + i * intervalSeconds,
            open: close * 0.999,
            high: close * 1.004,
            low: close * 0.995,
            close,
            volume: 1_000_000 + i * 1_000,
        };
    });
}

const renderDynamic = (
    symbol: string,
    series: Bar[],
    timeframe: Timeframe,
    assetClass: AssetClass = 'equity',
    currency: CurrencyCode = 'USD'
): string =>
    buildAnalysisPromptRaw(
        symbol,
        symbol,
        series,
        calculateIndicators(series),
        [],
        timeframe,
        undefined,
        assetClass,
        undefined,
        undefined,
        undefined,
        undefined,
        currency
    ).dynamic;

describe('buildAnalysisPrompt listing framing and numeric rendering', () => {
    it('frames a KRW listing as Korean, not a U.S. equity', () => {
        const p = buildAnalysisPrompt(
            '005930.KS',
            '삼성전자',
            bars,
            indicators,
            [],
            '1Day',
            undefined,
            'equity',
            undefined,
            undefined,
            undefined,
            undefined,
            'KRW'
        );
        expect(p).toContain('Korean equity listed on the KRX');
        expect(p).not.toContain('U.S. equity');
    });

    it('keeps significant digits on a sub-dollar asset instead of flattening bars to 0.00', () => {
        const p = renderDynamic(
            'SHIBUSD',
            syntheticBars(260, 0.00000507),
            '1Hour',
            'crypto'
        );
        expect(p).not.toMatch(/O:0\.00 H:0\.00 L:0\.00 C:0\.00/);
        // Crypto keeps five significant digits.
        expect(p).toMatch(/C:0\.00000\d{5} V:/);
    });

    it('renders KRX prices in whole won', () => {
        const p = renderDynamic(
            '005930.KS',
            syntheticBars(260, 269500, 86_400),
            '1Day',
            'equity',
            'KRW'
        );
        expect(p).toMatch(/C:\d{6} V:/);
        expect(p).not.toMatch(/C:\d+\.\d{2} V:/);
    });

    it('prints every KRX price-axis value at its KRX tick — bars, bands, averages, levels, tables', () => {
        // Synthetic bars around 269,500 sit in the 200,000–500,000 band (tick
        // 500): computed levels (MA, Keltner, pivots, fib) land between ticks
        // unless the prompt rounds them (2026-10-18: `205,325` was quoted).
        const p = renderDynamic(
            '005930.KS',
            syntheticBars(260, 269500, 86_400),
            '1Day',
            'equity',
            'KRW'
        );
        const priceLines = p
            .split('\n')
            .filter(l =>
                /^- (Snapshot Price|MA\(|EMA\(|Bollinger|Keltner|Donchian|VWAP)|^Fib (table|anchor)|^Pivot table|^- \d{6} \(/.test(
                    l
                )
            );
        expect(priceLines.length).toBeGreaterThan(5);
        const sixDigit = priceLines.flatMap(l =>
            [...l.matchAll(/(?<![\d.])(\d{6})(?![\d.])/g)].map(m =>
                Number(m[1])
            )
        );
        expect(sixDigit.length).toBeGreaterThan(10);
        expect(sixDigit.filter(n => n >= 200_000 && n % 500 !== 0)).toEqual([]);
        expect(p).toMatch(/C:\d{6} V:/);
        expect(
            [...p.matchAll(/C:(\d{6}) V:/g)]
                .map(m => Number(m[1]))
                .filter(n => n % 500 !== 0)
        ).toEqual([]);
    });

    it('renders differences below the price precision so a whole-won chart keeps its MACD', () => {
        // A 1,000-won listing moves ~10 won a bar; whole-won MACD and ATR erased crossovers.
        const p = renderDynamic(
            '000000.KQ',
            syntheticBars(260, 1000, 86_400),
            '1Day',
            'equity',
            'KRW'
        );
        expect(p).toMatch(/C:\d{3,4} V:/);
        expect(p).not.toMatch(/C:\d+\.\d+ V:/);
        expect(p).toMatch(/- ATR\(\d+\): \d+\.\d+/);
        expect(p).toMatch(/- MACD: -?\d+\.\d+ \/ Signal -?\d+\.\d+/);
    });

    it('gives crypto between $1 and $10 more than cent precision', () => {
        // 5-minute XRP bars near 2.50 printed runs of identical `C:2.50` rows.
        const p = renderDynamic(
            'XRPUSD',
            syntheticBars(260, 2.5, 300),
            '5Min',
            'crypto'
        );
        expect(p).toMatch(/C:\d\.\d{4} V:/);
    });

    it('tags at-price reference levels instead of offering them as stops', () => {
        const series = syntheticBars(260, 230, 86_400);
        const p = renderDynamic('AAPL', series, '1Day');
        expect(p).toContain(
            'at price — inside bar noise, not a stop or target'
        );
        // The stopLoss rule lives in the Analysis Guidelines, which sit at the
        // head of `stable` (system message) rather than in `dynamic`.
        const { stable } = buildAnalysisPromptRaw(
            'AAPL',
            'AAPL',
            series,
            calculateIndicators(series),
            [],
            '1Day'
        );
        expect(stable).toContain('never on a level tagged "at price"');
    });

    it('describes crypto horizon spans in wall-clock time, not trading sessions', () => {
        const p = renderDynamic(
            'BTCUSD',
            syntheticBars(260, 77000),
            '1Hour',
            'crypto'
        );
        expect(p).toContain('### Short-term — ~24 hours (24 bars)');
        // 72 and 200 hourly bars cross the 48-hour limit into days.
        expect(p).toContain('### Medium-term — ~3 days (72 bars)');
        expect(p).toContain('### Long-term — ~8 days (200 bars)');
        expect(p).not.toContain('~4 trading days');
    });

    it('switches crypto spans to weeks past 14 days', () => {
        const p = renderDynamic(
            'BTCUSD',
            syntheticBars(260, 77000, 86_400),
            '1Day',
            'crypto'
        );
        expect(p).toContain('### Short-term — ~3 weeks (20 bars)');
        expect(p).toContain('### Long-term — ~29 weeks (200 bars)');
        expect(p).not.toContain('~1 month');
    });

    it('renders volatility and BandWidth as percentages and Force Index as a grouped integer', () => {
        const p = renderDynamic('AAPL', syntheticBars(260, 320), '1Hour');
        expect(p).toMatch(/- Volatility \(per-bar σ\): Yang-Zhang \d+\.\d{2}%/);
        expect(p).toMatch(/BandWidth \d+\.\d{2}%/);
        expect(p).toMatch(/- Force Index: -?[\d,]+ \[/);
    });

    it('labels the squeeze histogram direction apart from its windowed trend', () => {
        const p = renderDynamic('AAPL', syntheticBars(260, 320), '1Hour');
        expect(p).toMatch(/momentum -?\d+\.\d{2} \[(up|down) vs prior bar\]/);
    });

    it('renders a percent against a non-positive base as N/A', () => {
        const zeroBase: Bar[] = [
            {
                time: 1_788_000_000,
                open: 0,
                high: 0,
                low: 0,
                close: 0,
                volume: 0,
            },
            {
                time: 1_788_003_600,
                open: 10,
                high: 11,
                low: 9,
                close: 10,
                volume: 1000,
            },
        ];
        const p = buildAnalysisPrompt(
            'AAPL',
            'Apple',
            zeroBase,
            indicators,
            [],
            '1Hour'
        );
        expect(p).toContain('- Price Change %: N/A');
        expect(p).toContain('- Period Return: N/A');
        expect(p).toContain('- Current vs Low: N/A');
    });
});
