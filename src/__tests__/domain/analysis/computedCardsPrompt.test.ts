import { describe, expect, it } from 'vitest';
import {
    buildAnalysisPrompt,
    formatCycleCardNote,
    INDICATOR_CARDS_BUILT_BY_CODE_NOTE,
} from '@/domain/analysis/prompt';
import { TECHNICAL_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { calculateIndicators } from '@/domain/indicators';
import type {
    Bar,
    ComputedCardKind,
    Skill,
    SkillGating,
    SkillType,
} from '@/domain/types';
import doubleTop from '@/__tests__/domain/patterns/fixtures/double-top.json';

const bars = (doubleTop as { bars: Bar[] }).bars;
const indicators = calculateIndicators(bars);

const ALWAYS_ON: SkillGating = { tier: 'always_on' };

const skill = (
    name: string,
    type: SkillType,
    computedCard?: ComputedCardKind,
    gating: SkillGating = ALWAYS_ON
): Skill => ({
    name,
    description: 'd',
    type,
    indicators: [],
    confidenceWeight: 0.8,
    content: `${name} DIGEST BODY`,
    gating,
    computedCard,
});

const MA = skill('MA Signal Guide', 'indicator_guide', 'ma');
const EMA = skill('EMA Signal Guide', 'indicator_guide', 'ema');
const ADX = skill('ADX Signal Guide', 'indicator_guide', 'adx');
const ATR = skill('ATR Signal Guide', 'indicator_guide', 'atr');
const OBV = skill('OBV Signal Guide', 'indicator_guide', 'obv');
const VP = skill(
    'Volume Profile Signal Guide',
    'indicator_guide',
    'volume_profile'
);
const MA_CYCLE = skill('MA Cycle Strategy', 'strategy', 'ma_cycle');
const MACD_CYCLE = skill('MACD Cycle Strategy', 'strategy', 'macd_cycle');
const FIB = skill('Fibonacci Strategy', 'strategy');
const UNTAGGED_GUIDE = skill('Untagged Guide', 'indicator_guide');

const build = (skills: Skill[]) =>
    buildAnalysisPrompt('AAPL', 'Apple Inc.', bars, indicators, skills, '1Day');

const TAGGED = [MA, EMA, ADX, ATR, OBV, VP];
const text = (skills: Skill[]): string => {
    const out = build(skills);
    return `${out.stable}\n\n${out.dynamic}`;
};

const lineOf = (prompt: string, prefix: string): string =>
    prompt.split('\n').find(l => l.startsWith(prefix)) ?? '';

describe('computed cards in the technical prompt', () => {
    it('drops indicatorResults from the response schema, properties and required', () => {
        expect('indicatorResults' in TECHNICAL_RESPONSE_SCHEMA.properties).toBe(
            false
        );
        expect(TECHNICAL_RESPONSE_SCHEMA.required).not.toContain(
            'indicatorResults'
        );
    });

    it('replaces the indicator writing rules with the one line, only when a tagged guide is injected', () => {
        const withTagged = text([...TAGGED, FIB]);
        expect(withTagged).toContain(INDICATOR_CARDS_BUILT_BY_CODE_NOTE);
        expect(withTagged).not.toContain('indicatorResults Writing Rules');
        expect(withTagged).not.toContain(
            'use these exact names for indicatorName'
        );
        expect(withTagged).not.toContain('Signal strength calibration');
        // One mention only: the line itself.
        expect(withTagged.match(/indicatorResults/g)).toHaveLength(1);

        const untagged = text([UNTAGGED_GUIDE, FIB]);
        expect(untagged).not.toContain(INDICATOR_CARDS_BUILT_BY_CODE_NOTE);
        expect(untagged).not.toContain('indicatorResults');
        expect(untagged).toContain('## Indicator Signal Guides');
    });

    it('keeps the guides themselves: the digests still interpret the values', () => {
        const out = text(TAGGED);
        for (const guide of TAGGED)
            expect(out).toContain(`${guide.name} DIGEST BODY`);
    });

    it('says what the code does, for the lines it builds the cards from', () => {
        expect(INDICATOR_CARDS_BUILT_BY_CODE_NOTE).toBe(
            '- indicatorResults is not part of your answer: code builds the indicator cards from the computed lines and detected signals above. Use the Indicator Signal Guides to interpret those values in summary and in the plan.'
        );
    });

    it('takes indicatorName and the unlisted-pattern exception out of the name-matching rules, and indicatorResults out of the regular-skills rule', () => {
        const stable = build([MA]).stable;
        expect(stable).toContain(
            '- strategyName MUST exactly match a skill name'
        );
        expect(stable).not.toContain('indicatorName');
        expect(stable).not.toContain(
            'The one exception is an unlisted chart pattern you add yourself'
        );
        expect(stable).not.toContain('add yourself');
        expect(stable).toContain(
            'patternSummaries holds only the patterns in the Skills pattern list below'
        );
        expect(stable).toContain(
            'do not force them into patternSummaries, strategyResults, candlePatterns, or keyLevels'
        );
    });

    it('no longer tells the model to write the cycle cards', () => {
        const stable = build([MA]).stable;
        expect(stable).not.toContain('for the MA cycle strategy — copy both');
        expect(stable).toContain('quote both when you mention the cycle');
    });

    it('leaves the cycle strategies out of the digests and the strategy list, and names only the selected ones', () => {
        const both = text([MA_CYCLE, MACD_CYCLE, FIB, MA]);
        expect(both).not.toContain('MA Cycle Strategy DIGEST BODY');
        expect(both).not.toContain('MACD Cycle Strategy DIGEST BODY');
        expect(both).not.toContain('- MA Cycle Strategy');
        expect(both).toContain('- Fibonacci Strategy');
        expect(both).toContain(
            '- The MA cycle and MACD cycle cards are built by code from the `- MA cycle` and `- MACD cycle` lines of ## Indicator State; do not add strategyResults entries for them.'
        );

        const one = text([MACD_CYCLE, FIB]);
        expect(one).toContain(
            '- The MACD cycle card is built by code from the `- MACD cycle` line of ## Indicator State; do not add a strategyResults entry for it.'
        );
        expect(one).not.toContain('MA cycle card');

        const none = text([FIB, MA]);
        expect(none).not.toContain('built by code from the');
    });

    it('renders the note on its own when the cycle strategies are the only strategies', () => {
        const out = text([MA_CYCLE]);
        expect(out).toContain(
            '### strategyResults Writing Rules for Strategy Skills'
        );
        expect(out).toContain('card is built by code');
        expect(out).not.toContain('Strategy skill list to analyze:');
    });

    it('names a cycle only when its stage line has a stage: a tie reads N/A, and then there is no card, no note and no digest', () => {
        const tied = {
            ...indicators,
            ma: {
                ...indicators.ma,
                20: indicators.ma[5].map((v, i, all) =>
                    i === all.length - 1 ? v : indicators.ma[20][i]
                ),
            },
        };
        const out = buildAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            bars,
            tied,
            [MA_CYCLE, MACD_CYCLE, FIB],
            '1Day'
        );
        const prompt = `${out.stable}\n\n${out.dynamic}`;
        expect(lineOf(prompt, '- MA cycle (')).toContain('N/A');
        expect(out.cycleCards.map(c => c.strategyName)).toEqual([
            'MACD Cycle Strategy',
        ]);
        expect(prompt).not.toContain('The MA cycle');
        expect(prompt).toContain('The MACD cycle card is built by code');
    });

    it('formats the note for each selection', () => {
        expect(formatCycleCardNote([])).toBe('');
        expect(formatCycleCardNote(['ma_cycle'])).toContain(
            'The MA cycle card is built'
        );
        expect(formatCycleCardNote(['macd_cycle', 'ma_cycle'])).toContain(
            'The MACD cycle and MA cycle cards are built'
        );
    });

    it('returns the cards built for the injected skills, and keeps the cycle strategies among them', () => {
        const out = build([
            ...TAGGED,
            MA_CYCLE,
            MACD_CYCLE,
            FIB,
            UNTAGGED_GUIDE,
        ]);
        expect(out.injectedSkills.map(s => s.name)).toEqual(
            expect.arrayContaining(['MA Cycle Strategy', 'MACD Cycle Strategy'])
        );
        expect(out.indicatorCards.map(c => c.indicatorName)).toEqual([
            'ADX Signal Guide',
            'ATR Signal Guide',
            'EMA Signal Guide',
            'MA Signal Guide',
            'OBV Signal Guide',
            'Volume Profile Signal Guide',
        ]);
        expect(out.cycleCards.map(c => c.strategyName)).toEqual([
            'MA Cycle Strategy',
            'MACD Cycle Strategy',
        ]);
    });

    it('builds the MA card from the very line the prompt prints', () => {
        const out = build([MA]);
        const prompt = `${out.stable}\n\n${out.dynamic}`;
        const printed = [
            ...lineOf(prompt, '- MA: ').matchAll(/MA\((\d+)\): (-?[\d.]+)/g),
        ].map(m => [`ma${m[1]}`, Number(m[2])]);
        const reading = out.indicatorCards[0].signals[0].reading;
        expect(reading?.kind).toBe('ma');
        expect(reading?.values).toMatchObject(Object.fromEntries(printed));
        const stack = lineOf(prompt, '- MA stack: ').match(
            /^- MA stack: (bullish|bearish|mixed)/
        );
        expect(reading?.state).toBe(
            stack?.[1] === 'mixed' ? 'mixed' : `${stack?.[1]}_stack`
        );
    });

    it('builds the cycle cards at the stage the prompt prints', () => {
        const out = build([MA_CYCLE, MACD_CYCLE, FIB]);
        const prompt = `${out.stable}\n\n${out.dynamic}`;
        const stageOf = (prefix: string): number | null => {
            const m = lineOf(prompt, prefix).match(/; stage (\d)\s*$/);
            return m === null ? null : Number(m[1]);
        };
        const stages = out.cycleCards.map(c => c.cycle?.stage ?? null);
        expect(stages).toEqual(
            [stageOf('- MA cycle ('), stageOf('- MACD cycle (')].filter(
                s => s !== null
            )
        );
    });

    it('is identical to the old prompt wherever the cards do not reach: the strategy list keeps its order', () => {
        const out = text([FIB, MA_CYCLE]);
        expect(out.indexOf('- Fibonacci Strategy')).toBeGreaterThan(
            out.indexOf('Strategy skill list to analyze:')
        );
    });
});
