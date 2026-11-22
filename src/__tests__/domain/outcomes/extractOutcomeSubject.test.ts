import { describe, expect, it } from 'vitest';
import { OUTCOME_SUBJECT_VERSION } from '@/domain/outcomes/constants';
import { extractOutcomeSubject } from '@/domain/outcomes/extractOutcomeSubject';

/** The smallest stored result the extractor accepts. */
const MINIMAL = { trend: 'bullish', riskLevel: 'medium' };

function extract(
    extra: Record<string, unknown> = {},
    prompt: string | null = null
) {
    return extractOutcomeSubject({ ...MINIMAL, ...extra }, prompt);
}

function plan(recommendation: Record<string, unknown>) {
    return extract({ actionRecommendation: recommendation })?.plan;
}

const PROMPT = [
    '## Indicator Values',
    '- 999.99 (Not a reference; 1.00% away)',
    '## Market Reference (deterministic · advisory)',
    '### Short-term',
    'Resistance (above):',
    '- 110.50 (VWAP; 0.54% away)',
    '- 105.00 (Round 105; 2.50% away)',
    'Support (below):',
    '- 95.00 (Fib 38.2%; 3.28% away)',
    '### Medium-term',
    '- 95.00 (Pivot S1; 3.28% away)',
    '- 95.00 (Fib 38.2%; 3.28% away)',
    '## Next Section',
    '- 90.00 (After the section; 1.00% away)',
].join('\n');

describe('extractOutcomeSubject — validity', () => {
    it.each([
        ['null', null],
        ['a string', 'analysis'],
        ['an array', []],
        ['no trend', { riskLevel: 'low' }],
        ['an unknown trend', { trend: 'sideways', riskLevel: 'low' }],
        ['no risk level', { trend: 'bullish' }],
        ['an unknown risk level', { trend: 'bullish', riskLevel: 'extreme' }],
    ])('returns null for %s', (_name, result) => {
        expect(extractOutcomeSubject(result, null)).toBeNull();
    });

    it.each(['bullish', 'bearish', 'neutral'] as const)(
        'accepts the %s trend',
        trend => {
            expect(extract({ trend })?.trend).toBe(trend);
        }
    );

    it.each(['low', 'medium', 'high'] as const)(
        'accepts the %s risk level',
        riskLevel => {
            expect(extract({ riskLevel })?.riskLevel).toBe(riskLevel);
        }
    );

    it('reads an analysis with nothing else as an empty subject', () => {
        expect(extract()).toEqual({
            v: OUTCOME_SUBJECT_VERSION,
            anchor: null,
            trend: 'bullish',
            riskLevel: 'medium',
            plan: null,
            levels: [],
            scenarioTargets: [],
            patterns: [],
        });
    });
});

describe('extractOutcomeSubject — anchor', () => {
    it('reads dataAsOf', () => {
        expect(
            extract({ dataAsOf: { barTime: 1_700_000_000, close: 101.5 } })
                ?.anchor
        ).toEqual({
            barTime: 1_700_000_000,
            close: 101.5,
        });
    });

    it.each([
        ['a missing dataAsOf', undefined],
        ['a fractional barTime', { barTime: 1.5, close: 100 }],
        ['a zero barTime', { barTime: 0, close: 100 }],
        ['a string barTime', { barTime: '1700000000', close: 100 }],
        ['a zero close', { barTime: 1_700_000_000, close: 0 }],
        ['a negative close', { barTime: 1_700_000_000, close: -1 }],
        [
            'a non-finite close',
            { barTime: 1_700_000_000, close: Number.POSITIVE_INFINITY },
        ],
        ['a missing close', { barTime: 1_700_000_000 }],
    ])('has no anchor for %s', (_name, dataAsOf) => {
        expect(extract({ dataAsOf })?.anchor).toBeNull();
    });
});

describe('extractOutcomeSubject — plan', () => {
    it('is null without an actionRecommendation, and present (empty) with an empty one', () => {
        expect(extract({ actionRecommendation: 'wait' })?.plan).toBeNull();
        expect(plan({})).toEqual({
            recommendation: null,
            position: null,
            entryLow: null,
            entryHigh: null,
            stop: null,
            targets: [],
            reconciled: false,
        });
    });

    it.each(['enter', 'wait', 'avoid'] as const)(
        'keeps the %s verdict',
        recommendation => {
            expect(
                plan({ entryRecommendation: recommendation })?.recommendation
            ).toBe(recommendation);
        }
    );

    it.each(['in_zone', 'above_zone', 'below_zone', 'no_setup'] as const)(
        'keeps the %s plan position',
        position => {
            expect(plan({ planState: { position } })?.position).toBe(position);
        }
    );

    it('has no position without a plan state, or with an unknown or malformed one', () => {
        expect(plan({})?.position).toBeNull();
        expect(plan({ planState: { position: 'chase' } })?.position).toBeNull();
        expect(plan({ planState: 'in_zone' })?.position).toBeNull();
    });

    it('drops an unknown verdict', () => {
        expect(plan({ entryRecommendation: 'buy' })?.recommendation).toBeNull();
    });

    it('takes the zone edges as the min and max of the usable entry prices, in any order', () => {
        expect(
            plan({ entryPrices: [101, 0, 99, 'x', Number.NaN, -5] })
        ).toMatchObject({
            entryLow: 99,
            entryHigh: 101,
        });
        expect(plan({ entryPrices: [100] })).toMatchObject({
            entryLow: 100,
            entryHigh: 100,
        });
        expect(plan({ entryPrices: 'many' })).toMatchObject({
            entryLow: null,
            entryHigh: null,
        });
    });

    describe('stop', () => {
        it('is the model stop when core wrote none', () => {
            expect(plan({ stopLoss: 95 })?.stop).toBe(95);
        });

        it('is the reconciled stop over the model stop', () => {
            expect(
                plan({ stopLoss: 95, reconciledLevels: { stopLoss: 96 } })?.stop
            ).toBe(96);
        });

        it('falls back to the model stop when reconciled levels carry none and did not reject it', () => {
            expect(
                plan({
                    stopLoss: 95,
                    reconciledLevels: { takeProfitPrices: [] },
                })?.stop
            ).toBe(95);
        });

        it('is null, not the model stop, when core rejected the stop', () => {
            expect(
                plan({
                    stopLoss: 95,
                    reconciledLevels: { stopLossRejected: true },
                })?.stop
            ).toBeNull();
        });

        it('is null when core rejected the stop even if it also wrote one', () => {
            expect(
                plan({
                    stopLoss: 95,
                    reconciledLevels: { stopLoss: 96, stopLossRejected: true },
                })?.stop
            ).toBeNull();
        });

        it('ignores a stop flag that is not literally true', () => {
            expect(
                plan({
                    stopLoss: 95,
                    reconciledLevels: { stopLossRejected: 'yes' },
                })?.stop
            ).toBe(95);
        });

        it.each([0, -1, Number.NaN, '95', null])(
            'is null for an unusable stop %s',
            stopLoss => {
                expect(plan({ stopLoss })?.stop).toBeNull();
            }
        );

        it.each([
            ['null', null],
            ['negative', -1],
            ['zero', 0],
            ['not finite', Number.NaN],
            ['a string', '96'],
        ])(
            'is null, not the model stop, when the reconciled stopLoss key is present but %s',
            (_name, stopLoss) => {
                expect(
                    plan({ stopLoss: 90, reconciledLevels: { stopLoss } })?.stop
                ).toBeNull();
            }
        );

        it('is the model stop only when reconciledLevels has no stopLoss key at all', () => {
            expect(plan({ stopLoss: 90, reconciledLevels: {} })?.stop).toBe(90);
        });

        it('is the reconciled stop when it is usable, over the model stop', () => {
            expect(
                plan({ stopLoss: 90, reconciledLevels: { stopLoss: 96 } })?.stop
            ).toBe(96);
        });
    });

    describe('targets', () => {
        it('are the model targets, sorted ascending and unique', () => {
            expect(
                plan({ takeProfitPrices: [110, 105, 110, 120] })?.targets
            ).toEqual([105, 110, 120]);
        });

        it('are the reconciled array over the model array when present', () => {
            expect(
                plan({
                    takeProfitPrices: [105, 110],
                    reconciledLevels: { takeProfitPrices: [110] },
                })?.targets
            ).toEqual([110]);
        });

        it('are empty, not the model array, when the reconciled array is empty (every target dropped)', () => {
            expect(
                plan({
                    takeProfitPrices: [105],
                    reconciledLevels: { takeProfitPrices: [] },
                })?.targets
            ).toEqual([]);
        });

        it('are the model array when reconciled levels hold no array', () => {
            expect(
                plan({
                    takeProfitPrices: [105],
                    reconciledLevels: { takeProfitPrices: 'x' },
                })?.targets
            ).toEqual([105]);
        });

        it('must be above the zone high, strictly', () => {
            expect(
                plan({
                    entryPrices: [98, 100],
                    takeProfitPrices: [99, 100, 100.01, 105],
                })?.targets
            ).toEqual([100.01, 105]);
        });

        it('are not filtered by a zone when there is none', () => {
            expect(plan({ takeProfitPrices: [1, 2] })?.targets).toEqual([1, 2]);
        });

        it('drop unusable values', () => {
            expect(
                plan({ takeProfitPrices: [105, 0, -3, Number.NaN, 'x'] })
                    ?.targets
            ).toEqual([105]);
        });
    });

    it('marks reconciled when reconciledLevels is present, even when empty', () => {
        expect(plan({ reconciledLevels: {} })?.reconciled).toBe(true);
        expect(plan({})?.reconciled).toBe(false);
        expect(plan({ reconciledLevels: 'x' })?.reconciled).toBe(false);
    });
});

describe('extractOutcomeSubject — levels', () => {
    const keyLevels = {
        support: [
            { price: 95, reason: 'a' },
            { price: 95, reason: 'dup' },
            { price: 90, reason: 'b' },
        ],
        resistance: [
            { price: 105, reason: 'c' },
            { price: 0, reason: 'bad' },
            null,
            { reason: 'none' },
        ],
        poc: { price: 100, reason: 'poc' },
    };

    it('reads support, resistance and poc in that order, deduplicated by role and price', () => {
        expect(extract({ keyLevels })?.levels).toEqual([
            { role: 'support', price: 95, refLabels: [] },
            { role: 'support', price: 90, refLabels: [] },
            { role: 'resistance', price: 105, refLabels: [] },
            { role: 'poc', price: 100, refLabels: [] },
        ]);
    });

    it('keeps the same price under two roles', () => {
        expect(
            extract({
                keyLevels: {
                    support: [{ price: 100 }],
                    resistance: [{ price: 100 }],
                    poc: { price: 100 },
                },
            })?.levels.map(level => level.role)
        ).toEqual(['support', 'resistance', 'poc']);
    });

    it('is empty for a missing or malformed keyLevels', () => {
        expect(extract({ keyLevels: 'x' })?.levels).toEqual([]);
        expect(
            extract({ keyLevels: { support: 'x', poc: 'y' } })?.levels
        ).toEqual([]);
    });

    it('labels a level with the Market Reference levels printed at its price, first-seen and unique', () => {
        const levels = extract(
            {
                keyLevels: {
                    support: [{ price: 95 }],
                    resistance: [{ price: 105 }, { price: 107 }],
                },
            },
            PROMPT
        )?.levels;
        expect(levels).toEqual([
            {
                role: 'support',
                price: 95,
                refLabels: ['Fib 38.2%', 'Pivot S1'],
            },
            { role: 'resistance', price: 105, refLabels: ['Round 105'] },
            { role: 'resistance', price: 107, refLabels: [] },
        ]);
    });

    it('matches a printed price within 0.6 units of its last decimal', () => {
        const at = (price: number) =>
            extract({ keyLevels: { support: [{ price }] } }, PROMPT)?.levels[0]
                .refLabels;
        expect(at(95.005)).toEqual(['Fib 38.2%', 'Pivot S1']);
        expect(at(95.007)).toEqual([]);
        expect(at(94.995)).toEqual(['Fib 38.2%', 'Pivot S1']);
    });

    it('ignores prices printed outside the Market Reference section', () => {
        expect(
            extract({ keyLevels: { support: [{ price: 90 }] } }, PROMPT)
                ?.levels[0].refLabels
        ).toEqual([]);
    });

    it('tags nothing without a prompt', () => {
        expect(
            extract({ keyLevels: { support: [{ price: 95 }] } }, null)
                ?.levels[0].refLabels
        ).toEqual([]);
    });
});

describe('extractOutcomeSubject — scenario targets', () => {
    it('reads the usable prices of both scenarios in order', () => {
        expect(
            extract({
                priceTargets: {
                    bullish: {
                        targets: [
                            { price: 110 },
                            { price: 0 },
                            { price: 120 },
                            null,
                        ],
                    },
                    bearish: { targets: [{ price: 90 }] },
                },
            })?.scenarioTargets
        ).toEqual([
            { side: 'bullish', price: 110 },
            { side: 'bullish', price: 120 },
            { side: 'bearish', price: 90 },
        ]);
    });

    it('is empty for null scenarios or a missing priceTargets', () => {
        expect(
            extract({ priceTargets: { bullish: null, bearish: null } })
                ?.scenarioTargets
        ).toEqual([]);
        expect(extract({ priceTargets: 'x' })?.scenarioTargets).toEqual([]);
        expect(extract()?.scenarioTargets).toEqual([]);
    });
});

describe('extractOutcomeSubject — patterns', () => {
    const geometry = {
        breakoutLevel: 100,
        extremeLevel: 90,
        direction: 'up',
        invalidationLevel: 95,
    };
    const detected = {
        patternName: 'double_bottom',
        detected: true,
        candidateId: 'c1',
        geometry,
    };

    it('reads a detected pattern with usable geometry', () => {
        expect(extract({ patternSummaries: [detected] })?.patterns).toEqual([
            {
                name: 'double_bottom',
                candidateId: 'c1',
                breakout: 100,
                extreme: 90,
                direction: 'up',
                invalidation: 95,
            },
        ]);
    });

    it('has no candidate id or invalidation when the model gave none', () => {
        const { candidateId: _candidate, ...withoutCandidate } = detected;
        expect(
            extract({
                patternSummaries: [
                    {
                        ...withoutCandidate,
                        geometry: { ...geometry, invalidationLevel: undefined },
                    },
                ],
            })?.patterns[0]
        ).toMatchObject({ candidateId: null, invalidation: null });
    });

    it.each([
        ['not detected', { ...detected, detected: false }],
        ['detected as a string', { ...detected, detected: 'true' }],
        ['without a name', { ...detected, patternName: undefined }],
        ['without geometry', { ...detected, geometry: undefined }],
        [
            'with an unknown direction',
            { ...detected, geometry: { ...geometry, direction: 'sideways' } },
        ],
        [
            'with a zero breakout',
            { ...detected, geometry: { ...geometry, breakoutLevel: 0 } },
        ],
        [
            'with a missing extreme',
            { ...detected, geometry: { ...geometry, extremeLevel: undefined } },
        ],
        ['that is not an object', 'double_bottom'],
    ])('skips a pattern %s', (_name, pattern) => {
        expect(extract({ patternSummaries: [pattern] })?.patterns).toEqual([]);
    });

    it('keeps the order of the patterns and reads a down pattern', () => {
        const down = {
            ...detected,
            patternName: 'double_top',
            geometry: { ...geometry, direction: 'down' },
        };
        expect(
            extract({ patternSummaries: [down, detected] })?.patterns.map(
                pattern => [pattern.name, pattern.direction]
            )
        ).toEqual([
            ['double_top', 'down'],
            ['double_bottom', 'up'],
        ]);
    });
});
