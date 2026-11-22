import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateIndicators } from '@/domain/indicators';
import type {
    AssembledPrompt,
    Bar,
    CandlePatternEntry,
    Skill,
    SkillGating,
} from '@/domain/types';
import doubleTop from '@/__tests__/domain/patterns/fixtures/double-top.json';

// WP-16 core-1: a gated candle guide is injected iff its candle is one of the
// lines the prompt prints under `## Detected Candle Patterns (computed)`, i.e.
// the latest multi-bar and the latest single-bar entry, not every entry in the
// detection window.

interface Fixture {
    bars: Bar[];
}

const flat = ({ stable, dynamic }: AssembledPrompt): string =>
    `${stable}\n\n${dynamic}`;

const makeSkill = (name: string, trigger: string): Skill => ({
    name,
    description: 'desc',
    indicators: [],
    confidenceWeight: 0.8,
    content: '## Body\n- content',
    type: 'candlestick',
    gating: {
        tier: 'gated',
        signalKind: 'event',
        triggers: [trigger],
    } satisfies SkillGating,
});

const single = (
    barIndex: number,
    singlePattern: 'doji' | 'hammer'
): CandlePatternEntry => ({
    barIndex,
    patternType: 'single',
    singlePattern,
    multiPattern: null,
});

const multi = (barIndex: number): CandlePatternEntry => ({
    barIndex,
    patternType: 'multi',
    singlePattern: null,
    multiPattern: 'bullish_engulfing',
});

const GUIDES = [
    makeSkill('Doji Guide', 'doji'),
    makeSkill('Hammer Guide', 'hammer'),
    makeSkill('Engulfing Guide', 'bullish_engulfing'),
];

const FIRST_BAR_INDEX = 10;

const buildWithEntries = async (
    entries: CandlePatternEntry[]
): Promise<string> => {
    vi.resetModules();
    vi.doMock('@/domain/analysis/candle-detection', async importOriginal => ({
        ...(await importOriginal<
            typeof import('@/domain/analysis/candle-detection')
        >()),
        detectCandlePatternEntries: () => entries,
    }));
    const { buildAnalysisPrompt } = await import('@/domain/analysis/prompt');
    const { bars } = doubleTop as Fixture;
    return flat(
        buildAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            bars,
            calculateIndicators(bars),
            GUIDES,
            '1Day'
        )
    );
};

afterEach(() => {
    vi.doUnmock('@/domain/analysis/candle-detection');
    vi.resetModules();
});

describe('buildAnalysisPrompt — candle guides follow the printed candles', () => {
    it('injects no guide for a candle detected earlier in the window but not among the printed ones', async () => {
        // The earlier doji is shadowed by the later hammer (latest single-bar
        // entry); only the hammer and the engulfing are printed.
        const out = await buildWithEntries([
            single(FIRST_BAR_INDEX, 'doji'),
            multi(FIRST_BAR_INDEX + 5),
            single(FIRST_BAR_INDEX + 10, 'hammer'),
        ]);
        expect(out).not.toContain('Doji Guide');
        expect(out).toContain('Hammer Guide');
        expect(out).toContain('Engulfing Guide');
    });

    it('injects both guides when the printed multi-bar and single-bar candles each have one', async () => {
        const out = await buildWithEntries([
            multi(FIRST_BAR_INDEX),
            single(FIRST_BAR_INDEX + 1, 'doji'),
        ]);
        expect(out).toContain('Doji Guide');
        expect(out).toContain('Engulfing Guide');
        expect(out).not.toContain('Hammer Guide');
    });

    it('the candle names printed under the header are exactly the candles whose guide is injected', async () => {
        const out = await buildWithEntries([
            single(FIRST_BAR_INDEX, 'doji'),
            multi(FIRST_BAR_INDEX + 5),
            single(FIRST_BAR_INDEX + 10, 'hammer'),
        ]);
        const section = out.slice(
            out.indexOf('## Detected Candle Patterns (computed)')
        );
        const printed = [
            ...section.matchAll(
                /(?:Single candle|Multi-candle) pattern: (\w+) \[trend:/g
            ),
        ].map(match => match[1]);
        const injected = GUIDES.filter(guide => out.includes(guide.name)).map(
            guide =>
                guide.gating?.tier === 'gated' &&
                guide.gating.signalKind === 'event'
                    ? guide.gating.triggers[0]
                    : undefined
        );
        expect(printed.toSorted()).toEqual(['bullish_engulfing', 'hammer']);
        expect(injected.toSorted()).toEqual(printed.toSorted());
    });

    it('injects no candle guide when nothing was detected', async () => {
        const out = await buildWithEntries([]);
        expect(out).not.toContain('Doji Guide');
        expect(out).not.toContain('Hammer Guide');
        expect(out).not.toContain('Engulfing Guide');
    });
});
