import { describe, expect, it } from 'vitest';
import {
    CHART_PATTERN_CANDIDATES_SECTION_HEADER,
    CHART_PATTERN_CANDIDATES_SECTION_INTRO,
    NO_CHART_PATTERNS_LINE,
    formatChartPatternCandidatesSection,
    isFailedBreakout,
    printedPatternGeometriesByOverlayId,
    spacingLine,
} from '@/domain/analysis/chartPatternCandidatesSection';
import { qualifyPatterns } from '@/domain/patterns/qualify/qualifyPatterns';
import { computeCandidateGeometry } from '@/domain/patterns/patternGeometry';
import {
    computePatternTargets,
    printedPatternGeometry,
} from '@/domain/analysis/patternTargets';
import {
    buildPatternOverlayCandidates,
    patternOverlayId,
} from '@/domain/overlays/patternOverlays';
import { COMPUTED_SECTIONS_HEADING } from '@/domain/analysis/computedSectionsHeading';
import { makeBars } from '@/__tests__/domain/patterns/helpers';
import type {
    Bar,
    PatternGeometry,
    PivotPoint,
    QualifiedPattern,
} from '@/domain/types';
import hsTextbook from '@/__tests__/domain/patterns/fixtures/hs-textbook.json';
import doubleTop from '@/__tests__/domain/patterns/fixtures/double-top.json';
import ascendingTriangle from '@/__tests__/domain/patterns/fixtures/ascending-triangle.json';
import bullFlag from '@/__tests__/domain/patterns/fixtures/bull-flag.json';
import cupAndHandle from '@/__tests__/domain/patterns/fixtures/cup-and-handle.json';

interface Fixture {
    atr: number;
    bars: Bar[];
}
const FIXTURES = [
    hsTextbook,
    doubleTop,
    ascendingTriangle,
    bullFlag,
    cupAndHandle,
] as Fixture[];

const qualifiedOf = (f: Fixture): QualifiedPattern[] =>
    qualifyPatterns([], f.bars, f.atr, '1Day').qualified;

/** Mirrors `prompt.ts`'s `offeredPatternOverlayIds` derivation exactly. */
const offeredIdsFor = (
    candidates: readonly QualifiedPattern[],
    bars: readonly Bar[],
    atr: number | null
): ReadonlySet<string> =>
    new Set(
        buildPatternOverlayCandidates(candidates, bars, atr ?? 0, 2).map(
            c => c.id
        )
    );

const render = (
    candidates: readonly QualifiedPattern[],
    bars: readonly Bar[],
    atr: number | null,
    opts: {
        priceDp?: number;
        offered?: ReadonlySet<string>;
    } = {}
): string =>
    formatChartPatternCandidatesSection(
        candidates,
        bars,
        atr,
        opts.priceDp ?? 2,
        '1Day',
        opts.offered ?? offeredIdsFor(candidates, bars, atr)
    );

const block = (section: string, id: string): string => {
    const found = section.split('\n### ').find(b => b.startsWith(id));
    if (found === undefined) throw new Error(`no ${id} block`);
    return found;
};

const pivot = (
    index: number,
    price: number,
    kind: PivotPoint['kind']
): PivotPoint => ({ index, price, kind });

/** A hand-built double bottom: troughs 10/10.02, neckline peak `neck`. */
const doubleBottomAt = (neck: number): QualifiedPattern => ({
    id: 'double_bottom',
    startIndex: 1,
    endIndex: 3,
    pivots: [
        pivot(1, 10, 'low'),
        pivot(2, neck, 'high'),
        pivot(3, 10.02, 'low'),
    ],
    shape: { kind: 'extreme', neckline: pivot(2, neck, 'high') },
    touches: 2,
});

/** A hand-built double top: peaks 25, neckline trough 10 — taller than its breakout. */
const tallDoubleTop: QualifiedPattern = {
    id: 'double_top',
    startIndex: 1,
    endIndex: 3,
    pivots: [pivot(1, 25, 'high'), pivot(2, 10, 'low'), pivot(3, 25, 'high')],
    shape: { kind: 'extreme', neckline: pivot(2, 10, 'low') },
    touches: 2,
};

const undirectedRectangle: QualifiedPattern = {
    id: 'rectangle',
    startIndex: 1,
    endIndex: 4,
    pivots: [],
    shape: {
        kind: 'trendline',
        upper: {
            start: { index: 1, price: 20 },
            end: { index: 3, price: 20 },
            touches: [
                { index: 1, price: 20 },
                { index: 3, price: 20 },
            ],
        },
        lower: {
            start: { index: 2, price: 10 },
            end: { index: 4, price: 10 },
            touches: [
                { index: 2, price: 10 },
                { index: 4, price: 10 },
            ],
        },
        direction: null,
    },
    touches: 4,
};

describe('formatChartPatternCandidatesSection', () => {
    it('renders the no-pattern line when nothing qualified', () => {
        expect(render([], makeBars([1]), null)).toBe(
            `${CHART_PATTERN_CANDIDATES_SECTION_HEADER}\n${CHART_PATTERN_CANDIDATES_SECTION_INTRO}\n${NO_CHART_PATTERNS_LINE}`
        );
    });

    it('the intro tells the model to leave candidateId empty for an unlisted pattern', () => {
        expect(CHART_PATTERN_CANDIDATES_SECTION_INTRO).toContain(
            'leave candidateId empty'
        );
    });

    // 2026-10-08 A/B: 4 of 18 summaries retold the one-line list of
    // unconfirmed shape resemblances. The section names no pattern beyond
    // the listed ones and the intro does not mention such a list.
    it('names no shape resemblance — neither a line nor the intro', () => {
        expect(
            CHART_PATTERN_CANDIDATES_SECTION_INTRO.toLowerCase()
        ).not.toContain('resemblance');
        const f = ascendingTriangle as Fixture;
        const section = render(qualifiedOf(f), f.bars, f.atr);
        expect(section.toLowerCase()).not.toContain('resemblance');
        expect(section.split('\n').at(-1)).toMatch(/^- Invalidation level: /);
    });

    it('the intro points to the general rule on writing about computed sections', () => {
        expect(CHART_PATTERN_CANDIDATES_SECTION_INTRO).toContain(
            `${COMPUTED_SECTIONS_HEADING} in ## Analysis Guidelines`
        );
    });

    // The 2026-10-08 A/B: these words in the section were copied into
    // user-facing text ("사전 스크리너", "그리기 검증", "작도 불가"). Removed
    // on purpose; a revert must fail here (CONVENTIONS.md#TE-12 exception).
    it.each(['screen', 'drawable', 'drawing', 'shape hint', 'qualif', 'check'])(
        'no rendered line of the section says "%s"',
        word => {
            const f = ascendingTriangle as Fixture;
            const section = render(qualifiedOf(f), f.bars, f.atr);
            const none = render([], makeBars([1]), null);
            expect(section.toLowerCase()).not.toContain(word);
            expect(none.toLowerCase()).not.toContain(word);
        }
    );

    it('renders a qualified pattern with its computed numbers, % distances and Candidate id', () => {
        const f = ascendingTriangle as Fixture;
        const q = qualifiedOf(f);
        const section = render(q, f.bars, f.atr);
        const tri = block(section, 'ascending_triangle');
        const g = computeCandidateGeometry(q[0], f.bars, f.atr);
        if (g === null || g.direction === null) throw new Error('undirected');
        const p = printedPatternGeometry(g, 2);
        expect(tri.startsWith('ascending_triangle (forming)')).toBe(true);
        expect(tri).toContain(
            `- Candidate id: ${patternOverlayId(q[0], f.bars)}`
        );
        expect(tri).toContain(
            `- Breakout level: ${p.breakoutLevel.toFixed(2)} (`
        );
        expect(tri).toContain('from last close)');
        expect(tri).toContain('- Direction: up');
        expect(tri).toContain(
            `- Invalidation level: ${p.invalidationLevel!.toFixed(2)}`
        );
        expect(tri).toMatch(/- Key points: resistance touch 1 /);
    });

    it('prints the Spacing line right after Key points for a double top', () => {
        const f = doubleTop as Fixture;
        const lines = block(
            render(qualifiedOf(f), f.bars, f.atr),
            'double_top'
        ).split('\n');
        const kp = lines.findIndex(l => l.startsWith('- Key points: '));
        expect(lines[kp + 1]).toBe('- Spacing (bars): peak 1 → peak 2: 14');
    });

    it('prints no Spacing line for a boundary pattern', () => {
        const f = ascendingTriangle as Fixture;
        expect(
            render(qualifiedOf(f), f.bars, f.atr).includes('- Spacing')
        ).toBe(false);
    });

    describe('spacingLine', () => {
        const pt = (label: string, index: number) => ({
            label,
            price: 1,
            index,
            time: index,
        });

        it('is the bar count between consecutive peaks/troughs in index order (OXY 2026-10-02: 5, not "7봉"/"14봉")', () => {
            expect(
                spacingLine([
                    pt('trough 1', 492),
                    pt('trough 2', 497),
                    pt('neckline', 494),
                ])
            ).toBe('- Spacing (bars): trough 1 → trough 2: 5');
        });

        it('covers head and shoulders and ignores non-structural points', () => {
            expect(
                spacingLine([
                    pt('left shoulder', 10),
                    pt('left trough', 12),
                    pt('head', 18),
                    pt('right trough', 21),
                    pt('right shoulder', 25),
                    pt('neckline', 21),
                ])
            ).toBe(
                '- Spacing (bars): left shoulder → head: 8 / head → right shoulder: 7'
            );
        });

        it('is null with fewer than two structural points', () => {
            expect(spacingLine([pt('rim', 1), pt('bottom', 9)])).toBeNull();
            expect(spacingLine([pt('peak 1', 4)])).toBeNull();
        });
    });

    // A model copies the PRINTED breakout/extreme, so the app's recomputation
    // must reproduce the PRINTED targets exactly — with raw, non-terminating
    // geometry (sloped boundaries) and at every price precision.
    it.each([2, 0])(
        'printed targets equal computePatternTargets of the printed breakout/extreme, every fixture family (priceDp %i)',
        priceDp => {
            let checked = 0;
            for (const f of FIXTURES) {
                const section = render(qualifiedOf(f), f.bars, f.atr, {
                    priceDp,
                });
                for (const b of section
                    .split('\n### ')
                    .slice(1)
                    .filter(x => x.includes('- Breakout level: '))) {
                    const num = (label: string): string =>
                        new RegExp(`- ${label}: (-?[\\d.]+)`).exec(b)![1]!;
                    const direction = /- Direction: (up|down)/.exec(b)![1] as
                        'up' | 'down';
                    const recomputed = computePatternTargets(
                        Number(num('Breakout level')),
                        Number(num('Extreme level')),
                        direction
                    );
                    expect(Number(num('Measured target'))).toBe(
                        recomputed.measuredTarget
                    );
                    expect(Number(num('Conservative target \\(50%\\)'))).toBe(
                        recomputed.conservativeTarget
                    );
                    const text = num('Conservative target \\(50%\\)');
                    const decimals = text.includes('.')
                        ? text.split('.')[1]!.length
                        : 0;
                    expect(decimals).toBeLessThanOrEqual(priceDp + 1);
                    checked++;
                }
            }
            expect(checked).toBe(FIXTURES.length);
        }
    );

    it('prints N/A for a measured target at or below zero', () => {
        const bars = makeBars([20, 25, 10, 25, 20]);
        const section = render([tallDoubleTop], bars, 1);
        expect(section).toContain('- Measured target: N/A');
        expect(section).not.toMatch(/target(?: \(50%\))?: -\d/);
    });

    it('takes the status from the printed (rounded) breakout — 19.9951 prints 20.00 and a close of 20 is not "broken"', () => {
        const bars = makeBars([15, 10, 19, 10, 20]);
        const section = render([doubleBottomAt(19.9951)], bars, 1);
        const b = block(section, 'double_bottom');
        expect(b).toContain('- Breakout level: 20.00');
        expect(b.startsWith('double_bottom (forming)')).toBe(true);
    });

    it('renders (broken) when the last close has already moved past the breakout level', () => {
        const bars = makeBars([15, 10, 19, 10, 20.5]);
        expect(render([doubleBottomAt(19.9951)], bars, 1)).toContain(
            '### double_bottom (broken)'
        );
    });

    describe('an undirected boundary pair (no prior trend)', () => {
        it('prints both boundaries, an undetermined direction and no target', () => {
            const bars = makeBars([15, 15, 15, 15, 15, 15]);
            const b = block(
                render([undirectedRectangle], bars, 1),
                'rectangle'
            );
            expect(b.startsWith('rectangle (forming)')).toBe(true);
            expect(b).toContain('- Upper boundary: 20.00');
            expect(b).toContain('- Lower boundary: 10.00');
            expect(b).toContain('- Direction: undetermined');
            expect(b).toContain('- Height: 10.00');
            expect(b).not.toContain('- Measured target');
            expect(b).not.toContain('- Breakout level');
        });

        it('is "broken" once the last close sits outside a boundary', () => {
            const bars = makeBars([15, 15, 15, 15, 15, 21]);
            expect(render([undirectedRectangle], bars, 1)).toContain(
                '### rectangle (broken)'
            );
        });

        it('is "broken" below the lower boundary too', () => {
            const bars = makeBars([15, 15, 15, 15, 15, 9]);
            expect(render([undirectedRectangle], bars, 1)).toContain(
                '### rectangle (broken)'
            );
        });
    });

    describe('when geometry cannot be computed at render time', () => {
        const f = doubleTop as Fixture;
        const candidates = qualifiedOf(f);

        it('renders each qualified pattern as "geometry unavailable" when atr is null', () => {
            const section = render(candidates, f.bars, null);
            expect(section).toContain('### double_top — geometry unavailable');
            expect(section).not.toContain('- Breakout level');
            expect(section).not.toContain('None detected');
        });

        it('renders "geometry unavailable" instead of throwing when the bar series is empty', () => {
            expect(render(candidates, [], 1)).toContain(
                '### double_top — geometry unavailable'
            );
        });
    });

    it('omits the "% from last close" suffix when the last close is not a positive price (bad feed tick)', () => {
        const bars = makeBars([15, 10, 19, 10, 0]);
        const section = render([doubleBottomAt(19.9951)], bars, 1);
        expect(section).toMatch(/- Breakout level: \d+\.\d{2}\n/);
        expect(section).not.toContain('from last close');
    });

    it('a pattern with geometry but no offered overlay gets no "Candidate id" line', () => {
        const f = ascendingTriangle as Fixture;
        const section = render(qualifiedOf(f), f.bars, f.atr, {
            offered: new Set(),
        });
        expect(section).toContain('### ascending_triangle');
        expect(section).toContain('- Breakout level: ');
        expect(section).not.toContain('- Candidate id:');
    });
});

describe('printedPatternGeometriesByOverlayId', () => {
    it.each([2, 0])(
        'maps each printed Candidate id to exactly the breakout/extreme/direction/invalidation its block prints (priceDp %i)',
        priceDp => {
            let checked = 0;
            for (const f of FIXTURES) {
                const candidates = qualifiedOf(f);
                const offered = offeredIdsFor(candidates, f.bars, f.atr);
                const section = render(candidates, f.bars, f.atr, {
                    priceDp,
                    offered,
                });
                const geometries = printedPatternGeometriesByOverlayId(
                    candidates,
                    f.bars,
                    f.atr,
                    priceDp,
                    offered
                );
                const blocks = section
                    .split('\n### ')
                    .filter(b => b.includes('- Candidate id: '));
                expect(geometries.size).toBe(blocks.length);
                for (const b of blocks) {
                    const field = (label: string): string =>
                        new RegExp(`- ${label}: (\\S+)`).exec(b)![1]!;
                    expect(geometries.get(field('Candidate id'))).toEqual({
                        breakoutLevel: Number(field('Breakout level')),
                        extremeLevel: Number(field('Extreme level')),
                        direction: field('Direction'),
                        invalidationLevel: Number(field('Invalidation level')),
                    });
                    checked++;
                }
            }
            expect(checked).toBe(FIXTURES.length);
        }
    );

    it('leaves out a candidate whose overlay was not offered', () => {
        const f = ascendingTriangle as Fixture;
        expect(
            printedPatternGeometriesByOverlayId(
                qualifiedOf(f),
                f.bars,
                f.atr,
                2,
                new Set()
            ).size
        ).toBe(0);
    });

    it('maps an offered undirected pattern to null — it has no breakout side and no target', () => {
        const bars = makeBars([15, 15, 15, 15, 15, 15]);
        const id = patternOverlayId(undirectedRectangle, bars);
        expect(
            printedPatternGeometriesByOverlayId(
                [undirectedRectangle],
                bars,
                1,
                2,
                new Set([id])
            )
        ).toEqual(new Map([[id, null]]));
    });
});

describe('printedPatternGeometry', () => {
    const geometry: PatternGeometry = {
        keyPoints: [],
        breakoutLevel: 50.004,
        height: 10.123,
        measuredTarget: 0,
        conservativeTarget: 0,
        invalidationLevel: 0,
        invalidationIndex: 0,
        direction: 'down',
    };

    it('rounds breakout and breakout ± height to the printed precision', () => {
        expect(printedPatternGeometry(geometry, 2)).toEqual({
            breakoutLevel: 50,
            extremeLevel: 60.13,
            direction: 'down',
        });
    });

    it('omits an invalidation level the block prints as N/A', () => {
        expect(printedPatternGeometry(geometry, 2)).not.toHaveProperty(
            'invalidationLevel'
        );
        expect(
            printedPatternGeometry(
                { ...geometry, invalidationLevel: 61.456 },
                2
            ).invalidationLevel
        ).toBe(61.46);
    });
});

describe('isFailedBreakout', () => {
    const UNDIRECTED = { direction: null } as const;
    const up = (breakoutLevel: number) =>
        ({ direction: 'up', breakoutLevel }) as const;
    const down = (breakoutLevel: number) =>
        ({ direction: 'down', breakoutLevel }) as const;
    // undirectedRectangle: upper 20 touched at bars 1 and 3, lower 10 at 2 and 4.
    const closes = (tail: number[]): Bar[] =>
        makeBars([15, 15, 15, 15, 15, 15, ...tail]);

    it('an undirected pair: a close over the upper boundary after its last touch, then back inside, failed', () => {
        expect(
            isFailedBreakout(
                undirectedRectangle,
                UNDIRECTED,
                closes([21, 15]),
                1
            )
        ).toBe(true);
    });

    it('is not failed while the last close is itself outside (that is broken)', () => {
        expect(
            isFailedBreakout(
                undirectedRectangle,
                UNDIRECTED,
                closes([15, 21]),
                1
            )
        ).toBe(false);
    });

    it('a close beyond by no more than the containment slack is not a breakout', () => {
        expect(
            isFailedBreakout(
                undirectedRectangle,
                UNDIRECTED,
                closes([20.25, 15]),
                1
            )
        ).toBe(false);
    });

    it('a directed pair only watches its breakout side', () => {
        expect(
            isFailedBreakout(undirectedRectangle, up(20), closes([9, 15]), 1)
        ).toBe(false);
        expect(
            isFailedBreakout(undirectedRectangle, down(10), closes([9, 15]), 1)
        ).toBe(true);
    });

    it('a neckline family: a close through the neckline after the last structural point, then back, failed (2026-10-18)', () => {
        // tallDoubleTop: peaks 25 at bars 1 and 3, neckline 10 (breakout down).
        // Closed at 8 (beyond 10 by more than the 0.25 slack), back at 15.
        expect(
            isFailedBreakout(tallDoubleTop, down(10), closes([8, 15]), 1)
        ).toBe(true);
        // Still under the neckline at the last bar: broken, not failed.
        expect(
            isFailedBreakout(tallDoubleTop, down(10), closes([15, 8]), 1)
        ).toBe(false);
        // Within the slack is no breakout.
        expect(
            isFailedBreakout(tallDoubleTop, down(10), closes([9.8, 15]), 1)
        ).toBe(false);
        // Only after the last structural point (bar 3): the pattern's own
        // trough at the neckline does not count.
        expect(
            isFailedBreakout(
                tallDoubleTop,
                down(10),
                makeBars([15, 25, 8, 25, 15, 15, 15]),
                1
            )
        ).toBe(false);
    });

    it('a retest of the neckline from the broken side is not a failure', () => {
        // Broke to 8, retests to 9.9 — still under the 10 neckline (that is
        // `broken`), though within the 0.25 slack of it.
        expect(
            isFailedBreakout(tallDoubleTop, down(10), closes([8, 9.9]), 1)
        ).toBe(false);
        expect(
            isFailedBreakout(tallDoubleTop, down(10), closes([8, 10]), 1)
        ).toBe(true);
    });

    it('an up-breaking neckline family mirrors it (a double bottom)', () => {
        const doubleBottom: QualifiedPattern = {
            ...tallDoubleTop,
            id: 'double_bottom',
            pivots: [
                pivot(1, 5, 'low'),
                pivot(2, 20, 'high'),
                pivot(3, 5, 'low'),
            ],
            shape: { kind: 'extreme', neckline: pivot(2, 20, 'high') },
        };
        expect(
            isFailedBreakout(doubleBottom, up(20), closes([22, 15]), 1)
        ).toBe(true);
        expect(
            isFailedBreakout(doubleBottom, up(20), closes([22, 21]), 1)
        ).toBe(false);
        // The opposite side is not its breakout.
        expect(isFailedBreakout(doubleBottom, up(20), closes([2, 15]), 1)).toBe(
            false
        );
    });

    it('every other directed family reads its printed breakout level from its last structural point', () => {
        // The check reads only the family kind and `endIndex` (bar 3).
        const shaped = (
            shape: QualifiedPattern['shape']
        ): QualifiedPattern => ({
            ...tallDoubleTop,
            shape,
        });
        const families = [
            shaped({
                kind: 'head_and_shoulders',
                neckline: {
                    start: { index: 1, price: 30 },
                    end: { index: 3, price: 0 },
                    touches: [],
                },
                breakoutIndex: 5,
            }),
            shaped({
                kind: 'rounding',
            } as unknown as QualifiedPattern['shape']),
            shaped({
                kind: 'high_tight_flag',
            } as unknown as QualifiedPattern['shape']),
        ];
        for (const family of families) {
            expect(isFailedBreakout(family, down(10), closes([8, 15]), 1)).toBe(
                true
            );
            // A close through the level at or before the last structural
            // point (bar 3) is part of the pattern, not a breakout.
            expect(
                isFailedBreakout(
                    family,
                    down(10),
                    makeBars([15, 15, 15, 8, 15, 15, 15]),
                    1
                )
            ).toBe(false);
        }
    });
});
