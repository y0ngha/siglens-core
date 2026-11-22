import { describe, expect, it } from 'vitest';
import {
    blockOf,
    fearGreedOf,
    marketReferenceOf,
    printedBackdrop,
    printedBarRows,
    printedHigherBlock,
    printedWeekTag,
    withoutHtfBlocks,
} from '../../../../scripts/replay/htfEvalPrompt';

const ROWS = [
    '## Recent Bar Data (Last 2 bars)',
    'Format: Date/Time(UTC) | O:Open H:High L:Low C:Close V:Volume [CandlePattern]',
    '[ts:1763251200] 2025-11-16 00:00 | O:10.00 H:12.50 L:9.50 C:11.00 V:1,234,567 [음봉]',
    '[ts:1763856000] 2025-11-23 | O:11.00 H:13.00 L:10.00 C:12.00 V:99 [망치형] (week in progress: 3 of 5 sessions so far; its close is the latest price)',
    '## Next',
].join('\n');

describe('printedBarRows', () => {
    it('reads rows with and without a time, the declared count and the volume', () => {
        const printed = printedBarRows(ROWS);
        expect(printed.declared).toBe(2);
        expect(printed.unparsed).toBe(0);
        expect(printed.rows[0]).toMatchObject({
            ts: 1763251200,
            date: '2025-11-16',
            time: '00:00',
            open: '10.00',
            close: '11.00',
            volume: 1234567,
        });
        expect(printed.rows[1].time).toBeNull();
    });

    it('counts a row-looking line it cannot read, and handles an absent section', () => {
        const broken = `${ROWS}\n`.replace(
            '[ts:1763856000] 2025-11-23',
            '[ts:oops] 2025-11-23'
        );
        expect(printedBarRows(broken).unparsed).toBe(1);
        const none = printedBarRows('## Other\nx');
        expect(none.rows).toEqual([]);
        expect(none.declared).toBeNull();
    });
});

describe('printedWeekTag', () => {
    it('reads the tag on the last row and counts the tagged rows', () => {
        const tag = printedWeekTag(printedBarRows(ROWS).rows);
        expect(tag.onLastRow).toEqual({ sessionsSoFar: 3, sessionsTotal: 5 });
        expect(tag.rowsWithTag).toBe(1);
    });

    it('reports no tag on the last row and a tag elsewhere', () => {
        const moved = ROWS.replace(
            ' (week in progress: 3 of 5 sessions so far; its close is the latest price)',
            ''
        ).replace(
            'V:1,234,567 [음봉]',
            'V:1,234,567 [음봉] (week in progress: 1 of 5 sessions so far; its close is the latest price)'
        );
        const tag = printedWeekTag(printedBarRows(moved).rows);
        expect(tag.onLastRow).toBeNull();
        expect(tag.rowsWithTag).toBe(1);
        expect(printedWeekTag([]).onLastRow).toBeNull();
    });
});

const HIGHER = [
    '### Higher Timeframe (computed, weekly bars built from daily history)',
    'Weekly trend: bullish. EMA20 moved +1.62 ATR(14) over the last 20 weekly bars (from 212.40 to 228.10) and the weekly close 231.55 is above EMA20.',
    'Weekly RSI(14) 61.2; weekly close 12.4% above its 50-week average.',
    'The last weekly bar is the current week (3 of 5 sessions so far).',
    "Alignment with this chart's trend (bullish): aligned.",
    'Descriptive only: agreement showed no measured forward edge.',
    '### Next',
].join('\n');

describe('printedHigherBlock', () => {
    it('reads every figure of a measurable block', () => {
        expect(printedHigherBlock(`x\n${HIGHER}`)).toEqual({
            kind: 'weekly',
            trend: {
                label: 'bullish',
                slopeAtr: '+1.62',
                emaFrom: '212.40',
                emaLast: '228.10',
                close: '231.55',
                closeVsEma: 'above',
            },
            receivedBars: null,
            rsi14: '61.2',
            closeVsMa50: { pct: '12.4', side: 'above' },
            progress: { sessionsSoFar: 3, sessionsTotal: 5 },
            alignment: { analysisTrend: 'bullish', label: 'aligned' },
            unparsed: [],
        });
    });

    it('reads the not-measurable form with the bars received', () => {
        const text = [
            '### Higher Timeframe (computed, monthly bars built from daily history)',
            'Monthly trend: Not measurable: the rule needs at least 40 bars; received 27 bars. Judge it yourself.',
        ].join('\n');
        const block = printedHigherBlock(text);
        expect(block?.kind).toBe('monthly');
        expect(block?.trend).toBeNull();
        expect(block?.receivedBars).toBe(27);
        expect(block?.unparsed).toEqual([]);
    });

    it('lists the lines it does not recognise and a heading with no kind', () => {
        const odd = HIGHER.replace(
            'Weekly RSI(14) 61.2; weekly close 12.4% above its 50-week average.',
            'Something unexpected.'
        );
        expect(printedHigherBlock(odd)?.unparsed.length).toBeGreaterThan(0);
        const noKind = printedHigherBlock(
            '### Higher Timeframe (computed, hourly)\nx'
        );
        expect(noKind?.unparsed.length).toBeGreaterThan(0);
        expect(printedHigherBlock('## nothing')).toBeNull();
    });
});

const BACKDROP = [
    '### Market Backdrop (computed, daily bars)',
    'S&P 500 (SPY): trend bullish (same rule as above); close 6.2% above its 200-day average.',
    'AAPL vs S&P 500 (SPY), last 20 sessions: +4.1% vs +1.3%; last 60 sessions: +9.8% vs -5.0% (both to 2026-11-20).',
].join('\n');

describe('printedBackdrop', () => {
    it('reads the trend, the average distance, both changes and the end date', () => {
        const block = printedBackdrop(BACKDROP);
        expect(block).toMatchObject({
            label: 'S&P 500 (SPY)',
            trend: 'bullish',
            closeVsMa200: { pct: '6.2', side: 'above' },
            endDate: '2026-11-20',
            unitlessNumbers: [],
            unparsed: [],
        });
        expect(block?.relative).toEqual([
            {
                symbol: 'AAPL',
                sessions: 20,
                symbolPct: '+4.1',
                benchmarkPct: '+1.3',
            },
            {
                symbol: 'AAPL',
                sessions: 60,
                symbolPct: '+9.8',
                benchmarkPct: '-5.0',
            },
        ]);
    });

    it('reads a not-measurable trend and flags an index price (a number without a unit)', () => {
        const odd = BACKDROP.replace(
            'trend bullish (same rule as above); close 6.2% above its 200-day average',
            'trend not measurable at 5,432.10'
        );
        const block = printedBackdrop(odd);
        expect(block?.trend).toBe('not measurable');
        expect(block?.closeVsMa200).toBeNull();
        expect(block?.unitlessNumbers).toEqual(['5,432.10']);
    });

    it('returns null without the block and keeps unknown lines', () => {
        expect(printedBackdrop('## none')).toBeNull();
        expect(
            printedBackdrop(`${BACKDROP}\nsomething else`)?.unparsed
        ).toEqual(['something else']);
    });
});

describe('sections and cutting', () => {
    it('cuts exactly the two registered blocks', () => {
        const prompt = [
            '## A',
            'a',
            HIGHER.replace('### Next\n', '').replace('\n### Next', ''),
            '### Keep',
            'k',
            BACKDROP,
            '## B',
            'b',
        ].join('\n');
        const cut = withoutHtfBlocks(prompt);
        expect(cut).not.toContain('Higher Timeframe');
        expect(cut).not.toContain('Market Backdrop');
        expect(cut).toContain('### Keep\nk');
        expect(cut).toContain('## B\nb');
        expect(withoutHtfBlocks('## A\nx')).toBe('## A\nx');
    });

    it('finds blocks and sections by their heading', () => {
        expect(blockOf('a\n### H1 x\nl1\n### H2\nl2', '### H1')).toEqual([
            '### H1 x',
            'l1',
        ]);
        expect(blockOf('a', '### H1')).toBeNull();
        expect(
            marketReferenceOf('## Market Reference (x)\nbody\n## Other\n')
        ).toContain('body');
        expect(fearGreedOf('## Fear & Greed Index (Reference)\nfg')).toContain(
            'fg'
        );
    });
});
