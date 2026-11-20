import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeMarketReference } from '@/domain/analysis/marketReference';
import {
    computedPromptText,
    extractGroundingNumbers,
    extractPromptNumbers,
    inferPromptPriceDecimals,
    parsePromptReferenceLevels,
    promptNumberPattern,
} from '@/domain/analysis/promptNumbers';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { priceQuoting } from '@/domain/analysis/promptFormat';
import { calculateIndicators } from '@/domain/indicators';
import type { Bar, Timeframe } from '@/domain/types';

const FIXTURES_DIR = join(__dirname, '../../../../scripts/ab-harness/fixtures');

interface TechnicalFixture {
    caseId: string;
    symbol: string;
    companyName: string;
    timeframe: Timeframe;
    bars: Bar[];
}

const TECHNICAL_FIXTURE_FILES = [
    'tech-trend.json',
    'tech-range.json',
    'tech-highvol.json',
    'tech-lowliq.json',
    'tech-pattern-hs.json',
    'tech-pattern-doubletop.json',
] as const;

const SECTION = [
    '## Indicator Values',
    '- 999.99 (Not a reference; 1.00% away)',
    '## Market Reference (deterministic · advisory)',
    'Anti-fabrication: cite ONLY price levels that appear verbatim.',
    '### Short-term — ~1 month (20 bars)',
    'Fib table: 23.6% 203.22 / 38.2% 201.36',
    'Resistance (above):',
    '- 197.51 (VWAP; 0.54% away; at price — inside bar noise, not a stop or target)',
    '- 1,234.50 (Fib 38.2%; 2.50% away)',
    'Support (below):',
    '- 190.00 (Round 190; 3.28% away)',
    '## Next Section',
    '- 555.55 (After the section; 1.00% away)',
].join('\n');

describe('extractPromptNumbers', () => {
    it('removes thousands separators and records the written decimals', () => {
        expect(extractPromptNumbers('price 1,234.50 and 12,345 and 7')).toEqual(
            [
                { value: 1234.5, decimals: 2 },
                { value: 12345, decimals: 0 },
                { value: 7, decimals: 0 },
            ]
        );
    });

    it('yields nothing for digits glued to a word, as in MA200', () => {
        expect(extractPromptNumbers('MA200 EMA9 Fib38')).toEqual([]);
    });

    it('does not split a decimal into a second token', () => {
        expect(extractPromptNumbers('ratio 1.5.')).toEqual([
            { value: 1.5, decimals: 1 },
        ]);
    });

    it('keeps the same value written with different precision as two tokens', () => {
        expect(extractPromptNumbers('197.5 and 197.50')).toEqual([
            { value: 197.5, decimals: 1 },
            { value: 197.5, decimals: 2 },
        ]);
    });

    it('lists a repeated token once', () => {
        expect(extractPromptNumbers('5 5 5.0')).toEqual([
            { value: 5, decimals: 0 },
            { value: 5, decimals: 1 },
        ]);
    });

    it('returns an empty list for text without numbers', () => {
        expect(extractPromptNumbers('no digits here')).toEqual([]);
    });
});

describe('parsePromptReferenceLevels', () => {
    it('reads only the level lines inside the Market Reference section', () => {
        expect(parsePromptReferenceLevels(SECTION)).toEqual([
            { price: 197.51, decimals: 2, label: 'VWAP' },
            { price: 1234.5, decimals: 2, label: 'Fib 38.2%' },
            { price: 190, decimals: 2, label: 'Round 190' },
        ]);
    });

    it('returns nothing when the section is absent', () => {
        expect(
            parsePromptReferenceLevels(
                '## Indicator Values\n- 1.00 (RSI; 1.00% away)'
            )
        ).toEqual([]);
    });

    it('reads to the end of the text when no heading follows the section', () => {
        expect(
            parsePromptReferenceLevels(
                '## Market Reference\n- 12 (POC; 0.10% away)'
            )
        ).toEqual([{ price: 12, decimals: 0, label: 'POC' }]);
    });
});

describe('inferPromptPriceDecimals', () => {
    it('is the modal fractional-digit count of the reference prices', () => {
        expect(
            inferPromptPriceDecimals(
                [
                    '## Market Reference',
                    '- 0.0123 (A; 1.00% away)',
                    '- 0.0125 (B; 1.00% away)',
                    '- 0.012 (C; 1.00% away)',
                ].join('\n')
            )
        ).toBe(4);
    });

    it('is 2 when the section is absent', () => {
        expect(inferPromptPriceDecimals('no section')).toBe(2);
    });

    it('is 0 for whole-unit prices', () => {
        expect(
            inferPromptPriceDecimals(
                '## Market Reference\n- 71,500 (MA20; 1.00% away)'
            )
        ).toBe(0);
    });

    it('resolves a tie to the larger count', () => {
        expect(
            inferPromptPriceDecimals(
                '## Market Reference\n- 10 (A; 1.00% away)\n- 10.5 (B; 1.00% away)'
            )
        ).toBe(1);
    });
});

/**
 * Format guard. The prompt text is parsed back with the helpers above, so a change to how
 * `## Market Reference` renders a level breaks here instead of silently turning every
 * downstream check into "nothing was printed".
 */
describe.each(TECHNICAL_FIXTURE_FILES)(
    'prompt format guard on %s (real buildAnalysisPrompt)',
    file => {
        const fixture = JSON.parse(
            readFileSync(join(FIXTURES_DIR, file), 'utf-8')
        ) as TechnicalFixture;
        const indicators = calculateIndicators(fixture.bars);
        const { dynamic } = buildAnalysisPrompt(
            fixture.symbol,
            fixture.companyName,
            fixture.bars,
            indicators,
            [],
            fixture.timeframe,
            undefined,
            'equity'
        );
        const reference = computeMarketReference(
            fixture.bars,
            indicators,
            fixture.timeframe,
            { assetClass: 'equity', currency: 'USD' }
        );
        const lastClose = fixture.bars[fixture.bars.length - 1].close;
        const quoting = priceQuoting(lastClose);
        const parsed = parsePromptReferenceLevels(dynamic);
        const horizons = [reference.short, reference.medium, reference.long];

        it('infers the decimals the prompt quotes prices with', () => {
            expect(inferPromptPriceDecimals(dynamic)).toBe(quoting.dp);
        });

        it('returns every computed level with its label and printed price', () => {
            const computed = horizons.flatMap(horizon => [
                ...horizon.levels.resistance,
                ...horizon.levels.support,
            ]);
            expect(computed.length).toBeGreaterThan(0);
            const printed = new Map(
                parsed.map(level => [
                    `${level.label}|${level.price}`,
                    level.decimals,
                ])
            );
            const missing = computed.filter(
                level =>
                    printed.get(
                        `${level.label}|${Number(level.price.toFixed(quoting.dp))}`
                    ) !== quoting.dp
            );
            expect(missing).toEqual([]);
        });

        it('parses exactly the number of level lines the prompt prints', () => {
            const computedCount = horizons.reduce(
                (sum, horizon) =>
                    sum +
                    horizon.levels.resistance.length +
                    horizon.levels.support.length,
                0
            );
            expect(parsed).toHaveLength(computedCount);
        });
    }
);

describe('promptNumberPattern', () => {
    it("returns a new matcher every call, so no caller inherits another's lastIndex", () => {
        const first = promptNumberPattern();
        first.exec('1 2 3');
        expect(first.lastIndex).toBeGreaterThan(0);
        expect(promptNumberPattern()).not.toBe(first);
        expect(promptNumberPattern().lastIndex).toBe(0);
    });

    it('matches the same tokens extractPromptNumbers reads', () => {
        expect('MA200 1,234.50 7'.match(promptNumberPattern())).toEqual([
            '1,234.50',
            '7',
        ]);
    });
});

describe('computedPromptText', () => {
    const PROMPT = [
        'Symbol: TEST',
        '## Market Reference (deterministic)',
        '- 1.00 (VWAP; 1.00% away)',
        '### Short-term',
        'Fib table: 2.00',
        '## Indicator Signal Guides',
        '### RSI',
        'guide 3.00',
        '## Fear & Greed Index (Reference)',
        'index 4.00',
        '## Field Content Guidance',
        'rules 5.00',
    ].join('\n');

    it('keeps the header lines and data sections, drops guidance sections to the next heading', () => {
        expect(computedPromptText(PROMPT)).toBe(
            [
                'Symbol: TEST',
                '## Market Reference (deterministic)',
                '- 1.00 (VWAP; 1.00% away)',
                '### Short-term',
                'Fib table: 2.00',
                '## Fear & Greed Index (Reference)',
                'index 4.00',
            ].join('\n')
        );
    });

    it('returns a prompt without any section heading whole', () => {
        expect(computedPromptText('Symbol: TEST\nprice 1.00')).toBe(
            'Symbol: TEST\nprice 1.00'
        );
    });
});

describe('extractGroundingNumbers', () => {
    it('keeps ordinary numbers of the computed sections', () => {
        expect(
            extractGroundingNumbers(
                '## Market Reference\n- 197.51 (VWAP; 2 bars)'
            )
        ).toEqual([
            { value: 197.51, decimals: 2 },
            { value: 2, decimals: 0 },
        ]);
    });

    it('drops dates, times, percentages, negatives and guidance sections', () => {
        const text = [
            'Date 2026-11-20 at 09:30 on 11/20/2026',
            '## Indicator Values',
            'RSI 55.5, change 3.25%, MACD -45.30, range 100-105',
            '## Indicator Signal Guides',
            'example 999.99',
        ].join('\n');
        expect(extractGroundingNumbers(text)).toEqual([
            { value: 55.5, decimals: 1 },
            { value: 100, decimals: 0 },
            { value: 105, decimals: 0 },
        ]);
    });
});
