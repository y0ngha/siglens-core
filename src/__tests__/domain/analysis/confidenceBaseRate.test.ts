import { describe, expect, it } from 'vitest';
import {
    enrichAnalysisWithConfidence,
    normalizeCachedAnalysisResponse,
} from '@/domain/analysis/confidence';
import {
    CANDLE_BASE_RATES,
    PATTERN_BASE_RATES,
    PATTERN_POOLED_BASE_RATE,
    CANDLE_POOLED_BASE_RATE,
    PRICE_LEVEL_BASE_RATE,
} from '@/domain/analysis/measuredBaseRates';
import type { Skill } from '@/domain/types';

const DOUBLE_BOTTOM_SKILL: Skill = {
    name: '이중 바닥',
    description: '',
    type: 'pattern',
    pattern: 'double_bottom',
    indicators: [],
    confidenceWeight: 0.7,
    content: '',
};

const NO_ID_SKILL: Skill = {
    name: '이름만 있는 패턴',
    description: '',
    type: 'pattern',
    indicators: [],
    confidenceWeight: 0.6,
    content: '',
};

const reply = (
    extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
    summary: '요약',
    trend: 'bullish',
    patternSummaries: [
        {
            patternName: 'Double Bottom',
            skillName: '이중 바닥',
            detected: true,
            trend: 'bullish',
            summary: '패턴',
        },
    ],
    candlePatterns: [
        {
            patternName: 'Bullish Engulfing',
            detected: true,
            trend: 'bullish',
            summary: '캔들',
        },
    ],
    ...extra,
});

describe('enrichAnalysisWithConfidence: measured base rate (WP-18 C4)', () => {
    it('attaches the table row of the skill pattern id to a pattern card and of the name to a candle card on a daily chart', () => {
        const result = enrichAnalysisWithConfidence(
            reply(),
            [DOUBLE_BOTTOM_SKILL],
            undefined,
            { timeframe: '1Day' }
        );
        expect(result.patternSummaries[0].baseRate).toBe(
            PATTERN_BASE_RATES.double_bottom
        );
        expect(result.candlePatterns[0].baseRate).toBe(
            CANDLE_BASE_RATES.bullish_engulfing
        );
    });

    it('still fills confidenceWeight from the skill (old readers keep working)', () => {
        const result = enrichAnalysisWithConfidence(
            reply(),
            [DOUBLE_BOTTOM_SKILL],
            undefined,
            { timeframe: '1Day' }
        );
        expect(result.patternSummaries[0].confidenceWeight).toBe(0.7);
    });

    it('attaches the pooled rows to a card the table has no family for', () => {
        const result = enrichAnalysisWithConfidence(
            reply({
                patternSummaries: [
                    {
                        patternName: 'x',
                        skillName: '이름만 있는 패턴',
                        detected: true,
                        trend: 'bullish',
                        summary: '',
                    },
                ],
                candlePatterns: [
                    {
                        patternName: '망치형',
                        detected: true,
                        trend: 'bullish',
                        summary: '',
                    },
                ],
            }),
            [NO_ID_SKILL],
            undefined,
            { timeframe: '1Day' }
        );
        expect(result.patternSummaries[0].baseRate).toBe(
            PATTERN_POOLED_BASE_RATE
        );
        expect(result.candlePatterns[0].baseRate).toBe(CANDLE_POOLED_BASE_RATE);
    });

    it('attaches null off daily bars: not measured there', () => {
        const result = enrichAnalysisWithConfidence(
            reply(),
            [DOUBLE_BOTTOM_SKILL],
            undefined,
            { timeframe: '1Hour' }
        );
        expect(result.patternSummaries[0].baseRate).toBeNull();
        expect(result.candlePatterns[0].baseRate).toBeNull();
    });

    it('leaves the field off when the caller gives no timeframe', () => {
        const result = enrichAnalysisWithConfidence(reply(), [
            DOUBLE_BOTTOM_SKILL,
        ]);
        expect('baseRate' in result.patternSummaries[0]).toBe(false);
        expect('baseRate' in result.candlePatterns[0]).toBe(false);
    });

    it('drops a baseRate the model wrote (CP-13): the figure is the table row, not the reply', () => {
        const forged = { ...PRICE_LEVEL_BASE_RATE, eventShare: 0.99 };
        const raw = reply();
        const result = enrichAnalysisWithConfidence(
            {
                ...raw,
                patternSummaries: [
                    {
                        ...(raw.patternSummaries as object[])[0],
                        baseRate: forged,
                    },
                ],
                candlePatterns: [
                    {
                        ...(raw.candlePatterns as object[])[0],
                        baseRate: forged,
                    },
                ],
            },
            [DOUBLE_BOTTOM_SKILL],
            undefined,
            { timeframe: '1Day' }
        );
        expect(result.patternSummaries[0].baseRate).toBe(
            PATTERN_BASE_RATES.double_bottom
        );
        expect(result.candlePatterns[0].baseRate).toBe(
            CANDLE_BASE_RATES.bullish_engulfing
        );
        const noTimeframe = enrichAnalysisWithConfidence(
            {
                ...raw,
                patternSummaries: [
                    {
                        ...(raw.patternSummaries as object[])[0],
                        baseRate: forged,
                    },
                ],
            },
            [DOUBLE_BOTTOM_SKILL]
        );
        expect('baseRate' in noTimeframe.patternSummaries[0]).toBe(false);
    });
});

describe('normalizeCachedAnalysisResponse: baseRate', () => {
    const storedCards = (baseRate: unknown) => ({
        patternSummaries: [
            {
                id: 'p0',
                patternName: 'Double Bottom',
                skillName: '이중 바닥',
                detected: true,
                trend: 'bullish',
                summary: '패턴',
                confidenceWeight: 0.7,
                ...(baseRate === undefined ? {} : { baseRate }),
            },
        ],
        candlePatterns: [
            {
                id: 'c0',
                patternName: 'hammer',
                detected: true,
                trend: 'bullish',
                summary: '캔들',
                ...(baseRate === undefined ? {} : { baseRate }),
            },
        ],
    });

    it('keeps a valid stored baseRate on both card kinds', () => {
        const stored = JSON.parse(
            JSON.stringify(PATTERN_BASE_RATES.double_bottom)
        ) as unknown;
        const result = normalizeCachedAnalysisResponse(storedCards(stored));
        expect(result.patternSummaries[0].baseRate).toEqual(
            PATTERN_BASE_RATES.double_bottom
        );
        expect(result.candlePatterns[0].baseRate).toEqual(
            PATTERN_BASE_RATES.double_bottom
        );
    });

    it('keeps a stored null (not measured)', () => {
        const result = normalizeCachedAnalysisResponse(storedCards(null));
        expect(result.patternSummaries[0].baseRate).toBeNull();
        expect(result.candlePatterns[0].baseRate).toBeNull();
    });

    it('drops an invalid baseRate without losing the card', () => {
        const result = normalizeCachedAnalysisResponse(
            storedCards({ subject: 'chart_pattern', n: 'many' })
        );
        expect(result.patternSummaries).toHaveLength(1);
        expect(result.candlePatterns).toHaveLength(1);
        expect(result.patternSummaries[0].confidenceWeight).toBe(0.7);
        expect('baseRate' in result.patternSummaries[0]).toBe(false);
        expect('baseRate' in result.candlePatterns[0]).toBe(false);
    });

    it('leaves a card stored before baseRate existed without one', () => {
        const result = normalizeCachedAnalysisResponse(storedCards(undefined));
        expect('baseRate' in result.patternSummaries[0]).toBe(false);
        expect('baseRate' in result.candlePatterns[0]).toBe(false);
    });
});
