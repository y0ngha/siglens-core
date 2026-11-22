/**
 * Fixtures of the WP-16 instrument tests: a rendered technical prompt in the shape the
 * instrument reads (sections, guide headings, writing-rule blocks, lists) and a catalog.
 */
import type { CatalogSkill } from '../../../../scripts/replay/analysisFieldsEvalSkills';

export const PATTERN_GUIDE_A = '이중천장';
export const PATTERN_GUIDE_B = '이중바닥';
export const CANDLE_GUIDE_DOJI = 'Doji Pattern Guide';
export const CANDLE_GUIDE_HAMMER = 'Hammer/Shooting Star Guide';

export const CATALOG: readonly CatalogSkill[] = [
    {
        name: 'Core Reference',
        group: 'indicator_guide',
        alwaysOn: true,
        injected: true,
    },
    {
        name: PATTERN_GUIDE_A,
        group: 'pattern',
        alwaysOn: false,
        injected: true,
        triggers: ['double_top'],
    },
    {
        name: PATTERN_GUIDE_B,
        group: 'pattern',
        alwaysOn: false,
        injected: true,
        triggers: ['double_bottom'],
    },
    {
        name: CANDLE_GUIDE_DOJI,
        group: 'candlestick',
        alwaysOn: false,
        injected: true,
        triggers: ['doji', 'gravestone_doji'],
    },
    {
        name: CANDLE_GUIDE_HAMMER,
        group: 'candlestick',
        alwaysOn: false,
        injected: true,
        triggers: ['hammer', 'shooting_star'],
    },
    {
        name: 'Candle Reading Primer',
        group: 'candlestick',
        alwaysOn: true,
        injected: true,
    },
];

export interface PromptOptions {
    /** Chart-pattern ids printed as qualified candidates. */
    qualified?: readonly string[];
    /** Candle names printed under the detected-candle header. */
    candles?: readonly string[];
    patternGuides?: readonly string[];
    candleGuides?: readonly string[];
    strategies?: readonly string[];
    /** Lines of `## Indicator State (computed)`. */
    stateLines?: readonly string[];
    indicatorRules?: boolean;
    /** Text appended to the chart candidates' instruction paragraph. */
    candidatesIntro?: string;
}

const guideBlock = (name: string): string =>
    `### ${name} [Medium Confidence]\nbody of ${name}\n`;

/** A dynamic prompt part with the sections and blocks the instrument reads. */
export function dynamicPrompt(options: PromptOptions = {}): string {
    const qualified = options.qualified ?? [];
    const candles = options.candles ?? [];
    const patternGuides = options.patternGuides ?? [];
    const candleGuides = options.candleGuides ?? [];
    const strategies = options.strategies ?? [];
    return [
        '## Analysis Snapshot\nSymbol: TEST\n',
        candles.length === 0
            ? ''
            : `## Detected Candle Patterns (computed)\nCandle formations.\n${candles
                  .map(
                      name =>
                          `- [3 bars ago · bar 2024-01-02 00:00] Single candle pattern: ${name} [trend: neutral]`
                  )
                  .join('\n')}\n`,
        (options.stateLines ?? []).length === 0
            ? ''
            : `## Indicator State (computed)\n${(options.stateLines ?? []).join('\n')}\n`,
        qualified.length === 0
            ? ''
            : `## Chart Pattern Candidates (computed)\nEach pattern below is measured.${options.candidatesIntro ?? ''}\n${qualified
                  .map(
                      (id, i) =>
                          `### ${id} (confirmed)\n- Candidate id: pattern:${id}:${1000 + i}\n- Height: 5\n`
                  )
                  .join('')}`,
        patternGuides.length === 0
            ? ''
            : `## Pattern Analysis\n${patternGuides.map(guideBlock).join('')}`,
        candleGuides.length === 0
            ? ''
            : `## Candlestick Pattern Guides\n${candleGuides.map(guideBlock).join('')}`,
        '## Analysis Request\n\n### Critical Response Rules\n- be careful\n',
        '## Field Content Guidance\n',
        options.indicatorRules === false
            ? ''
            : '### indicatorResults Writing Rules for Indicator Guides\n- one entry each\n\nIndicator guide list (use these exact names for indicatorName):\n- MA Signal Guide\n',
        patternGuides.length === 0
            ? ''
            : `### patternSummaries Writing Rules\n- include every pattern\n\n### geometry Writing Rules\n- copy it\n\n### candidateId Writing Rules\n- copy the id\n\nSkills pattern list to analyze:\n${patternGuides.map(n => `- ${n}`).join('\n')}\n`,
        `### strategyResults Writing Rules for Strategy Skills\n- one each\n\nStrategy skill list to analyze:${strategies.map(n => `\n- ${n}`).join('')}\n`,
        candleGuides.length === 0
            ? ''
            : `### candlePatterns Writing Rules for Candlestick Skills\n- read the primer\n\nCandlestick pattern guide list to apply:\n${candleGuides.map(n => `- ${n}`).join('\n')}\n`,
        '### keyLevels Writing Rules for Support/Resistance Tools\n- levels\n',
    ]
        .filter(part => part !== '')
        .join('\n');
}

export const STABLE =
    '## Intent\nstable text\n### Core Reference [High Confidence]\nbody\n';
