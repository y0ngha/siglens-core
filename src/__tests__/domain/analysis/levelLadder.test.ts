import { describe, expect, it } from 'vitest';
import {
    LEVEL_LADDER_RUNGS_PER_SIDE,
    buildLevelLadder,
} from '@/domain/analysis/levelLadder';
import type {
    LevelCandidate,
    LevelSourceKind,
} from '@/domain/analysis/levelLadder';

function candidates(
    kind: LevelSourceKind,
    prices: readonly number[]
): LevelCandidate[] {
    return prices.map(price => ({ price, kind }));
}

describe('buildLevelLadder', () => {
    describe('side of the price', () => {
        it('places an analysis support above the reference price on the above side', () => {
            const ladder = buildLevelLadder(100, [
                { price: 105, kind: 'analysis_support' },
            ]);
            expect(ladder?.above).toEqual([
                { price: 105, distancePct: 5, sources: ['analysis support'] },
            ]);
            expect(ladder?.below).toEqual([]);
        });

        it('places an analysis resistance below the reference price on the below side', () => {
            const ladder = buildLevelLadder(100, [
                { price: 95, kind: 'analysis_resistance' },
            ]);
            expect(ladder?.below).toEqual([
                {
                    price: 95,
                    distancePct: -5,
                    sources: ['analysis resistance'],
                },
            ]);
            expect(ladder?.above).toEqual([]);
        });

        it('keeps a price equal to the reference out of above and below', () => {
            const ladder = buildLevelLadder(100, [
                { price: 100, kind: 'analysis_target' },
                { price: 105, kind: 'high_52w' },
                { price: 95, kind: 'low_52w' },
            ]);
            expect(ladder?.atPrice).toEqual([
                { price: 100, distancePct: 0, sources: ['analysis target'] },
            ]);
            expect(ladder?.above.map(rung => rung.price)).toEqual([105]);
            expect(ladder?.below.map(rung => rung.price)).toEqual([95]);
        });

        it('has an empty atPrice when no level equals the reference', () => {
            const ladder = buildLevelLadder(100, [
                { price: 100.01, kind: 'high_20' },
            ]);
            expect(ladder?.atPrice).toEqual([]);
        });

        it('treats a level a hair above the reference as above, with no near band', () => {
            const ladder = buildLevelLadder(117.44, [
                { price: 117.77, kind: 'analysis_target' },
                { price: 119.7, kind: 'analysis_resistance' },
            ]);
            expect(ladder?.atPrice).toEqual([]);
            expect(ladder?.above.map(rung => rung.price)).toEqual([
                117.77, 119.7,
            ]);
        });
    });

    describe('ordering and cap', () => {
        it('orders above rungs nearest first and below rungs nearest first', () => {
            const ladder = buildLevelLadder(100, [
                ...candidates('high_20', [103, 101, 102]),
                ...candidates('low_20', [97, 99, 98]),
            ]);
            expect(ladder?.above.map(rung => rung.price)).toEqual([
                101, 102, 103,
            ]);
            expect(ladder?.below.map(rung => rung.price)).toEqual([99, 98, 97]);
        });

        it('keeps only the nearest rungs per side up to the cap', () => {
            expect(LEVEL_LADDER_RUNGS_PER_SIDE).toBe(4);
            const ladder = buildLevelLadder(100, [
                ...candidates('high_52w', [106, 101, 105, 102, 104, 103]),
                ...candidates('low_52w', [94, 99, 95, 98, 96, 97]),
            ]);
            expect(ladder?.above.map(rung => rung.price)).toEqual([
                101, 102, 103, 104,
            ]);
            expect(ladder?.below.map(rung => rung.price)).toEqual([
                99, 98, 97, 96,
            ]);
        });

        it('keeps a rung count at the cap when exactly the cap is given', () => {
            const ladder = buildLevelLadder(
                100,
                candidates('high_20', [101, 102, 103, 104])
            );
            expect(ladder?.above).toHaveLength(LEVEL_LADDER_RUNGS_PER_SIDE);
        });
    });

    describe('merging', () => {
        it('merges sources of exactly equal prices in label order, whatever the input order', () => {
            const ladder = buildLevelLadder(100, [
                { price: 110, kind: 'sma200' },
                { price: 110, kind: 'high_52w' },
                { price: 110, kind: 'analysis_resistance' },
            ]);
            expect(ladder?.above).toEqual([
                {
                    price: 110,
                    distancePct: 10,
                    sources: [
                        'analysis resistance',
                        '52-week high',
                        '200-day average',
                    ],
                },
            ]);
        });

        it('lists a repeated kind at one price once', () => {
            const ladder = buildLevelLadder(100, [
                { price: 110, kind: 'analysis_target' },
                { price: 110, kind: 'analysis_target' },
            ]);
            expect(ladder?.above[0]?.sources).toEqual(['analysis target']);
        });

        it('does not merge or average nearby but different prices', () => {
            const ladder = buildLevelLadder(100, [
                { price: 100.01, kind: 'sma20' },
                { price: 100.02, kind: 'sma50' },
            ]);
            expect(ladder?.above.map(rung => rung.price)).toEqual([
                100.01, 100.02,
            ]);
        });

        it('labels every kind', () => {
            const kinds: LevelSourceKind[] = [
                'analysis_support',
                'analysis_resistance',
                'analysis_poc',
                'analysis_target',
                'analysis_stop',
                'high_52w',
                'low_52w',
                'high_20',
                'low_20',
                'sma20',
                'sma50',
                'sma200',
            ];
            const ladder = buildLevelLadder(100, [
                ...kinds.map(kind => ({ price: 110, kind })),
            ]);
            expect(ladder?.above[0]?.sources).toEqual([
                'analysis support',
                'analysis resistance',
                'analysis volume node',
                'analysis target',
                'analysis stop',
                '52-week high',
                '52-week low',
                '20-day high',
                '20-day low',
                '20-day average',
                '50-day average',
                '200-day average',
            ]);
        });
    });

    describe('distance', () => {
        it('is positive above and negative below, rounded to 2 decimals', () => {
            const ladder = buildLevelLadder(51.7, [
                { price: 52.4, kind: 'high_52w' },
                { price: 50.1, kind: 'sma50' },
            ]);
            expect(ladder?.above[0]?.distancePct).toBe(1.35);
            expect(ladder?.below[0]?.distancePct).toBe(-3.09);
        });

        it('rounds a tiny positive distance to +0 rather than -0', () => {
            const ladder = buildLevelLadder(100000, [
                { price: 100000.001, kind: 'sma20' },
            ]);
            expect(Object.is(ladder?.above[0]?.distancePct, 0)).toBe(true);
        });
    });

    describe('closer', () => {
        it('is above when the nearest level above is nearer', () => {
            const ladder = buildLevelLadder(100, [
                { price: 101, kind: 'high_20' },
                { price: 95, kind: 'low_20' },
            ]);
            expect(ladder?.closer).toBe('above');
        });

        it('is below when the nearest level below is nearer', () => {
            const ladder = buildLevelLadder(100, [
                { price: 110, kind: 'high_20' },
                { price: 99, kind: 'low_20' },
            ]);
            expect(ladder?.closer).toBe('below');
        });

        it('is equal when both nearest levels are the same distance', () => {
            const ladder = buildLevelLadder(100, [
                { price: 101, kind: 'high_20' },
                { price: 99, kind: 'low_20' },
            ]);
            expect(ladder?.closer).toBe('equal');
        });

        it('breaks a tie of printed distances toward the below side when it is nearer', () => {
            const ladder = buildLevelLadder(100, [
                { price: 101.004, kind: 'high_20' },
                { price: 99.001, kind: 'low_20' },
            ]);
            expect(ladder?.above[0]?.distancePct).toBe(1);
            expect(ladder?.below[0]?.distancePct).toBe(-1);
            expect(ladder?.closer).toBe('below');
        });

        it('breaks a tie of printed distances toward the above side when it is nearer', () => {
            const ladder = buildLevelLadder(100, [
                { price: 100.996, kind: 'high_20' },
                { price: 98.996, kind: 'low_20' },
            ]);
            expect(ladder?.above[0]?.distancePct).toBe(1);
            expect(ladder?.below[0]?.distancePct).toBe(-1);
            expect(ladder?.closer).toBe('above');
        });

        it('reports equal only when the unrounded gaps tie as well', () => {
            const ladder = buildLevelLadder(100, [
                { price: 101.004, kind: 'high_20' },
                { price: 98.996, kind: 'low_20' },
            ]);
            expect(ladder?.closer).toBe('equal');
        });

        it('lets the printed distances decide when they differ', () => {
            const ladder = buildLevelLadder(100, [
                { price: 101.4, kind: 'high_20' },
                { price: 98.9, kind: 'low_20' },
            ]);
            expect(ladder?.closer).toBe('below');
        });

        it('keeps two sub-cent rungs on opposite sides from reading as equally close', () => {
            const ladder = buildLevelLadder(500, [
                { price: 500.02, kind: 'high_20' },
                { price: 499.99, kind: 'low_20' },
            ]);
            expect(ladder?.above[0]?.distancePct).toBe(0);
            expect(ladder?.below[0]?.distancePct).toBe(0);
            expect(ladder?.closer).toBe('below');
        });

        it('is null when there is nothing above', () => {
            const ladder = buildLevelLadder(100, [
                { price: 99, kind: 'low_20' },
            ]);
            expect(ladder?.closer).toBeNull();
        });

        it('is null when there is nothing below', () => {
            const ladder = buildLevelLadder(100, [
                { price: 101, kind: 'high_20' },
            ]);
            expect(ladder?.closer).toBeNull();
        });
    });

    describe('merging exact prices only', () => {
        it('keeps prices that differ only past the second decimal as separate rungs', () => {
            const ladder = buildLevelLadder(117.44, [
                { price: 117.771, kind: 'high_20' },
                { price: 117.774, kind: 'sma20' },
            ]);
            expect(ladder?.above.map(rung => rung.price)).toEqual([
                117.771, 117.774,
            ]);
        });
    });

    describe('invalid input', () => {
        it('drops candidates that are not finite and positive', () => {
            const ladder = buildLevelLadder(100, [
                { price: NaN, kind: 'sma20' },
                { price: Infinity, kind: 'sma50' },
                { price: -Infinity, kind: 'sma200' },
                { price: 0, kind: 'low_20' },
                { price: -5, kind: 'low_52w' },
                { price: 101, kind: 'high_20' },
            ]);
            expect(ladder?.above.map(rung => rung.price)).toEqual([101]);
            expect(ladder?.below).toEqual([]);
            expect(ladder?.atPrice).toEqual([]);
        });

        it('returns null when every candidate is invalid', () => {
            expect(
                buildLevelLadder(100, [
                    { price: NaN, kind: 'sma20' },
                    { price: 0, kind: 'sma50' },
                    { price: -1, kind: 'sma200' },
                ])
            ).toBeNull();
        });

        it('returns null for no candidates', () => {
            expect(buildLevelLadder(100, [])).toBeNull();
        });

        it.each([0, -5, NaN, Infinity])(
            'returns null when the reference price is %s',
            referencePrice => {
                expect(
                    buildLevelLadder(referencePrice, [
                        { price: 101, kind: 'high_20' },
                    ])
                ).toBeNull();
            }
        );
    });

    describe('summary', () => {
        it('names both nearest rungs and the closer side', () => {
            const ladder = buildLevelLadder(51.7, [
                { price: 52.4, kind: 'high_52w' },
                { price: 50.1, kind: 'analysis_support' },
                { price: 50.1, kind: 'sma50' },
                { price: 55, kind: 'sma200' },
            ]);
            expect(ladder?.summary).toBe(
                'Nearest above: 52.4 (+1.35%, 52-week high). Nearest below: 50.1 (-3.09%, analysis support, 50-day average). The level above is closer.'
            );
        });

        it('says the level below is closer', () => {
            const ladder = buildLevelLadder(100, [
                { price: 110, kind: 'high_52w' },
                { price: 99, kind: 'low_20' },
            ]);
            expect(ladder?.summary).toBe(
                'Nearest above: 110 (+10%, 52-week high). Nearest below: 99 (-1%, 20-day low). The level below is closer.'
            );
        });

        it('says the two levels are equally close', () => {
            const ladder = buildLevelLadder(100, [
                { price: 101, kind: 'high_20' },
                { price: 99, kind: 'low_20' },
            ]);
            expect(ladder?.summary).toBe(
                'Nearest above: 101 (+1%, 20-day high). Nearest below: 99 (-1%, 20-day low). The two levels are equally close.'
            );
        });

        it('prints a sign-preserving small value for a rung that rounds to zero', () => {
            const ladder = buildLevelLadder(500, [
                { price: 500.01, kind: 'high_20' },
                { price: 499.99, kind: 'low_20' },
                { price: 500, kind: 'analysis_target' },
            ]);
            expect(ladder?.summary).toBe(
                'Nearest above: 500.01 (+<0.01%, 20-day high). Nearest below: 499.99 (-<0.01%, 20-day low). At the price: 500 (0%, analysis target). The two levels are equally close.'
            );
        });

        it('says none listed above and omits the closer sentence', () => {
            const ladder = buildLevelLadder(98.9, [
                { price: 98.5, kind: 'low_20' },
            ]);
            expect(ladder?.summary).toBe(
                'Nearest above: none listed. Nearest below: 98.5 (-0.4%, 20-day low).'
            );
        });

        it('says none listed below and omits the closer sentence', () => {
            const ladder = buildLevelLadder(100, [
                { price: 105, kind: 'high_52w' },
            ]);
            expect(ladder?.summary).toBe(
                'Nearest above: 105 (+5%, 52-week high). Nearest below: none listed.'
            );
        });

        it('reports a level at the price in its own sentence', () => {
            const ladder = buildLevelLadder(100, [
                { price: 100, kind: 'analysis_target' },
                { price: 105, kind: 'high_52w' },
            ]);
            expect(ladder?.summary).toBe(
                'Nearest above: 105 (+5%, 52-week high). Nearest below: none listed. At the price: 100 (0%, analysis target).'
            );
        });

        it('prints only the nearest rung per side, not the farther ones', () => {
            const ladder = buildLevelLadder(100, [
                { price: 101, kind: 'high_20' },
                { price: 120, kind: 'high_52w' },
            ]);
            expect(ladder?.summary.includes('120')).toBe(false);
        });
    });

    it('echoes the reference price', () => {
        expect(
            buildLevelLadder(51.7, [{ price: 52, kind: 'sma20' }])
                ?.referencePrice
        ).toBe(51.7);
    });

    it('does not mutate its candidates', () => {
        const input = [
            { price: 103, kind: 'high_20' as const },
            { price: 101, kind: 'high_20' as const },
        ];
        const copy = structuredClone(input);
        buildLevelLadder(100, input);
        expect(input).toEqual(copy);
    });
});
