import { describe, expect, it } from 'vitest';
import {
    headingPosition,
    lineStarting,
    listAfter,
    numbersOnLine,
    printedCandleNames,
    printedQualified,
    sectionOf,
    withoutGuideParts,
} from '../../../../scripts/replay/analysisFieldsEvalPrompt';
import {
    CANDLE_GUIDE_DOJI,
    dynamicPrompt,
    PATTERN_GUIDE_A,
} from './wp16Fixtures';

describe('sectionOf', () => {
    const text = '## A\nbody a\n\n## B\nbody b\n## C\nbody c';

    it('is a header to the next one', () => {
        expect(sectionOf(text, '## B')).toBe('## B\nbody b');
        expect(sectionOf(text, '## C')).toBe('## C\nbody c');
    });

    it('finds a header at the very start and returns an empty string for a missing one', () => {
        expect(sectionOf(text, '## A')).toBe('## A\nbody a\n');
        expect(sectionOf(text, '## Z')).toBe('');
    });
});

describe('listAfter', () => {
    it('reads the bullets after a marker, skipping blank lines before the first one', () => {
        const text = 'x\nList:\n\n- one\n- two\n\n- not this\nafter';
        expect(listAfter(text, 'List:')).toEqual(['one', 'two']);
    });

    it('stops at the first line that is not a bullet and tolerates the end of the text', () => {
        expect(listAfter('List:\n- a\nplain\n- b', 'List:')).toEqual(['a']);
        expect(listAfter('List:\n- a', 'List:')).toEqual(['a']);
    });

    it('is empty without the marker or without bullets', () => {
        expect(listAfter('nothing', 'List:')).toEqual([]);
        expect(listAfter('List:\n', 'List:')).toEqual([]);
        expect(listAfter('List:\nplain', 'List:')).toEqual([]);
    });
});

describe('printed readers', () => {
    const prompt = dynamicPrompt({
        qualified: ['double_top', 'rectangle'],
        candles: ['doji', 'bullish_engulfing'],
    });

    it('reads the qualified pattern ids and their candidate ids', () => {
        expect(printedQualified(prompt)).toEqual({
            ids: ['double_top', 'rectangle'],
            candidateIds: ['pattern:double_top:1000', 'pattern:rectangle:1001'],
        });
        expect(printedQualified('## Other\n')).toEqual({
            ids: [],
            candidateIds: [],
        });
    });

    it('reads the printed candle names from single and multi candle lines', () => {
        expect(printedCandleNames(prompt)).toEqual([
            'doji',
            'bullish_engulfing',
        ]);
        expect(
            printedCandleNames(
                '## Detected Candle Patterns (computed)\n- [1 bars ago] Multi-candle pattern: harami [trend: bullish]'
            )
        ).toEqual(['harami']);
        expect(printedCandleNames('')).toEqual([]);
    });

    it('does not read a candle name from the guide section', () => {
        const only = dynamicPrompt({ candleGuides: [CANDLE_GUIDE_DOJI] });
        expect(printedCandleNames(only)).toEqual([]);
    });
});

describe('headingPosition', () => {
    it('matches a heading followed by a bracket, a line break or the end, not a longer name', () => {
        expect(headingPosition('x\n### Doji Guide [High]', 'Doji Guide')).toBe(
            2
        );
        expect(headingPosition('### Doji Guide\nbody', 'Doji Guide')).toBe(0);
        expect(headingPosition('### Doji Guide [High]', 'Doji')).toBe(-1);
        expect(headingPosition('a\n### Doji Guide', 'Doji Guide')).toBe(2);
        expect(headingPosition('mention of Doji Guide', 'Doji Guide')).toBe(-1);
    });
});

describe('withoutGuideParts', () => {
    const full = dynamicPrompt({
        qualified: ['double_top'],
        candles: ['doji'],
        patternGuides: [PATTERN_GUIDE_A],
        candleGuides: [CANDLE_GUIDE_DOJI],
        strategies: ['Strategy One'],
    });
    const folded = (text: string) => withoutGuideParts(text).folded;

    it('removes the guide sections, the four rule blocks with their lists', () => {
        const stripped = folded(full);
        expect(stripped).not.toContain('## Pattern Analysis');
        expect(stripped).not.toContain('## Candlestick Pattern Guides');
        expect(stripped).not.toContain('patternSummaries Writing Rules');
        expect(stripped).not.toContain('geometry Writing Rules');
        expect(stripped).not.toContain('candidateId Writing Rules');
        expect(stripped).not.toContain('Skills pattern list to analyze');
        expect(stripped).not.toContain('candlePatterns Writing Rules');
        expect(stripped).not.toContain('Candlestick pattern guide list');
    });

    it('keeps everything else, the candidate blocks and the other rule blocks included', () => {
        const stripped = folded(full);
        expect(stripped).toContain('### double_top (confirmed)');
        expect(stripped).toContain('- Candidate id: pattern:double_top:1000');
        expect(stripped).toContain('indicatorResults Writing Rules');
        expect(stripped).toContain(
            'Strategy skill list to analyze:\n- Strategy One'
        );
        expect(stripped).toContain('### keyLevels Writing Rules');
        expect(stripped).toContain('## Detected Candle Patterns (computed)');
    });

    it('ignores the instruction paragraph above the candidate blocks', () => {
        const [a, b] = [
            dynamicPrompt({
                qualified: ['double_top'],
                candidatesIntro: ' one',
            }),
            dynamicPrompt({
                qualified: ['double_top'],
                candidatesIntro: ' two',
            }),
        ];
        expect(a).not.toBe(b);
        expect(withoutGuideParts(a)).toEqual(withoutGuideParts(b));
    });

    it('sees a change in a candidate block or in any other section', () => {
        const base = dynamicPrompt({ qualified: ['double_top'] });
        expect(folded(base.replace('Height: 5', 'Height: 6'))).not.toBe(
            folded(base)
        );
        expect(folded(base.replace('be careful', 'be very careful'))).not.toBe(
            folded(base)
        );
    });

    it('sees a change in the text of a rule block that is not one of the four', () => {
        const base = dynamicPrompt({ patternGuides: [PATTERN_GUIDE_A] });
        expect(folded(base.replace('- levels', '- other levels'))).not.toBe(
            folded(base)
        );
        expect(
            folded(base.replace('- one each', '- one each, please'))
        ).not.toBe(folded(base));
    });

    it('leaves a prompt without those parts as it is, folded and unfolded', () => {
        const plain = '## A\nbody\n\n\n## B\n### Rule\ntext\n';
        expect(withoutGuideParts(plain)).toEqual({
            folded: plain,
            unfolded: plain,
        });
    });

    it('folds the blank lines at the removal seams only, and reports the plain remainder too', () => {
        const [withParts, without] = [
            withoutGuideParts(
                dynamicPrompt({
                    patternGuides: [PATTERN_GUIDE_A],
                    candleGuides: [CANDLE_GUIDE_DOJI],
                })
            ),
            withoutGuideParts(dynamicPrompt({})),
        ];
        expect(withParts.folded).toBe(without.folded);
        expect(withParts.unfolded).not.toBe(without.unfolded);
    });

    it('does not fold blank lines that no removal touched', () => {
        const base = dynamicPrompt({ patternGuides: [PATTERN_GUIDE_A] });
        const extra = base.replace('- be careful\n', '- be careful\n\n\n\n');
        expect(extra).not.toBe(base);
        expect(folded(extra)).not.toBe(folded(base));
    });

    it('keeps a candidate section that has no block, minus its instruction text', () => {
        const text =
            '## Chart Pattern Candidates (computed)\njust text\n\n## Next\nbody';
        const stripped = folded(text);
        expect(stripped).toContain('## Chart Pattern Candidates (computed)');
        expect(stripped).toContain('## Next');
        expect(stripped).not.toContain('just text');
    });
});

describe('numbersOnLine and lineStarting', () => {
    it('reads signed numbers with thousands separators and skips NAME(period) labels', () => {
        expect(
            numbersOnLine('- MA: MA(5): 77,000 / MA(20): -79.5 / MA(60): N/A')
        ).toEqual([77000, -79.5]);
        expect(numbersOnLine('- OBV: -83,753,796 [rising]')).toEqual([
            -83753796,
        ]);
    });

    it('finds the first line with a prefix', () => {
        expect(
            lineStarting('a\n- MA stack: x\n- MA stack: y', '- MA stack: ')
        ).toBe('- MA stack: x');
        expect(lineStarting('a', '- b')).toBeNull();
    });
});
