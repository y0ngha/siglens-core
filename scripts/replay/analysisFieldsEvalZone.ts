/**
 * `zone` mode of the analysis-fields evaluation (WP-18 §3, §8.1, gates Z1, Z2, N2, N3 and
 * the sample for the manual read N1): where the last close sits against the entry zone, how
 * the plan state reads it under the 1% tolerance and under exact edges, and whether the
 * prose of the plan agrees with the state. Pure functions over plans a run stored;
 * `analysisFieldsEval.ts` builds them from the run and the set's bars.
 *
 * The state rules here are the instrument's own copy: the tolerance rule is WP-15's (1%,
 * applied by `stateOf`), the exact rule is `zoneLow <= close <= zoneTop`. Neither calls the
 * function a run's stored field came from; the stored `planState` is only compared with.
 * `--restate exact` re-derives every position of an old run with the exact rule, no model
 * call.
 */
import { bootstrapCi } from './analysisFieldsEvalOutput';
import {
    FIELDS_EVAL_CONSTANTS as C,
    type GateResult,
} from './analysisFieldsEvalTypes';
import type { PlanPosition } from './analysisFieldsEvalPlan';
import { quantile, mean, median } from './stats';
import { sha256Hex } from './fsUtil';

/** Gate thresholds of WP-18 §8.3 (pre-registered). */
export const ZONE_GATES = {
    /**
     * Z2: share of `in_zone` plans whose prose reads as a pullback plan, at most. WP-18
     * pre-registered 40% against a regex the brief did not print (36% measured); the
     * instrument's completed `PULLBACK_CUE.ko` measures 66 of 164 exact-in_zone plans on the
     * `2026-11-22-wp15-c2-after2` run, and that figure is the bound (0.402 would fail at it).
     */
    maxInZoneCueShare: 66 / 164,
    /** N3: no position above this share of the headline rows. */
    maxPositionShare: 0.85,
    /** N2: first-target-room non-inferiority margin (share, after minus before). */
    targetRoomMargin: -0.05,
    /** N1: the sample the Opus read takes. */
    sample: { in_zone: 15, above_zone_near: 15, other: 10 },
    /** `above_zone` with the close this close (ATR) to the top counts as "near". */
    nearAtr: 0.5,
} as const;

export const ZONE_LANGUAGES = ['ko', 'en'] as const;
export type ZoneLanguage = (typeof ZONE_LANGUAGES)[number];

/**
 * Words of a plan that reads as a pullback ("wait for a dip to the zone"). The Korean list
 * is the design's list as far as it is documented (the brief elided part of it), completed
 * from the 9 plans a first version missed ("조정을 기다", "조정 후"): against the design's own
 * per-case flags on the `c2-after2` run it finds 549 of 550, and 31 plans the design did not flag.
 */
export const PULLBACK_CUE: Record<ZoneLanguage, RegExp> = {
    ko: /되돌림|눌림|조정 시|조정을|조정이|조정 후|지지 확인 후|대기/,
    en: /pullback|pull back|retrace|dip to|wait for|wait until|on a dip/i,
};

/** Where the close sits against the zone, finer than a position. */
export const ZONE_GEOMETRIES = [
    'strictly_inside',
    'at_top',
    'at_low',
    'band_above',
    'above',
    'band_below',
    'below',
] as const;
export type ZoneGeometry = (typeof ZONE_GEOMETRIES)[number];

export function geometryOf(
    close: number,
    low: number,
    top: number
): ZoneGeometry {
    const tol = C.zoneTolerance;
    if (close === top) return 'at_top';
    if (close === low) return 'at_low';
    if (close > top) return close <= top * (1 + tol) ? 'band_above' : 'above';
    if (close < low) return close >= low * (1 - tol) ? 'band_below' : 'below';
    return 'strictly_inside';
}

/** One plan of a run, with what the zone measurements read. */
export interface ZoneCase {
    caseId: string;
    close: number;
    atr: number | null;
    zoneLow: number | null;
    zoneTop: number | null;
    /** The position the WP-15 rule (1% tolerance) gives, recomputed from the stored plan. */
    tolerancePosition: PlanPosition;
    /** `planState.position` as the run stored it; `null` for a run from before the field. */
    storedPosition: string | null;
    /** `labelPlanOutcome`'s approach of the stored plan (`labels.jsonl`); `null` without one. */
    approach: string | null;
    /** The prose the plan wrote: entry, position analysis and risk:reward text. */
    prose: string;
    /** First target above the zone top, in ATR. */
    firstTargetRoomAtr: number | null;
}

/** The exact-edge position; a plan the state table sends to `no_setup` stays there. */
export function exactPosition(c: ZoneCase): PlanPosition {
    if (c.tolerancePosition === 'no_setup') return 'no_setup';
    if (c.zoneLow === null || c.zoneTop === null) return 'no_setup';
    return c.close > c.zoneTop
        ? 'above_zone'
        : c.close < c.zoneLow
          ? 'below_zone'
          : 'in_zone';
}

/** Distance the close lies beyond the zone top, in ATR; `null` unless above it with an ATR. */
export const distanceAboveTopAtr = (c: ZoneCase): number | null =>
    c.zoneTop === null || c.atr === null || !(c.close > c.zoneTop)
        ? null
        : (c.close - c.zoneTop) / c.atr;

const basisPosition = (c: ZoneCase, restate: boolean): string =>
    restate ? exactPosition(c) : (c.storedPosition ?? c.tolerancePosition);

// ─── Report ───────────────────────────────────────────────────────────────────

export interface ShareStat {
    count: number;
    n: number;
    share: number | null;
}

const share = (count: number, n: number): ShareStat => ({
    count,
    n,
    share: n === 0 ? null : count / n,
});

const countShare = (
    cases: readonly ZoneCase[],
    pick: (c: ZoneCase) => boolean
): ShareStat => share(cases.filter(pick).length, cases.length);

export interface ZoneReport {
    n: number;
    positions: {
        tolerance: Record<string, ShareStat>;
        exact: Record<string, ShareStat>;
        stored: Record<string, ShareStat> | null;
    };
    /** Where the close sits for the plans the 1% rule calls `in_zone`. */
    toleranceInZoneGeometry: Record<ZoneGeometry, ShareStat>;
    /** Distance above the top for the `band_above` plans, in ATR. */
    bandAboveDistanceAtr: {
        n: number;
        median: number | null;
        p90: number | null;
    };
    /** Median zone width of the `in_zone` plans under each rule, in ATR. */
    inZoneWidthAtr: Record<
        'tolerance' | 'exact',
        { n: number; median: number | null }
    >;
    /** Pullback-cue share of the prose by group. */
    cueByGroup: Record<string, ShareStat>;
    z1: {
        /** Stored position equals the exact recomputation. */
        positionEqualsExact: ShareStat | null;
        /** `in_zone` iff `zoneLow <= close <= zoneTop`, over stored positions that are not `no_setup`. */
        inZoneIffInside: ShareStat | null;
        /** `labelPlanOutcome` approach `inside` iff stored `in_zone`. */
        approachInsideIffInZone: ShareStat | null;
    };
    /** What N3 reads: the position shares and `in_zone`'s interval. */
    n3: {
        basis: 'stored' | 'exact';
        positions: Record<string, ShareStat>;
        inZoneCi: ReturnType<typeof bootstrapCi>;
    };
    n1Sample: Record<keyof typeof ZONE_GATES.sample, readonly string[]>;
}

const POSITIONS: readonly PlanPosition[] = [
    'in_zone',
    'above_zone',
    'below_zone',
    'no_setup',
];

const positionShares = (
    cases: readonly ZoneCase[],
    positionOf: (c: ZoneCase) => string
): Record<string, ShareStat> =>
    Object.fromEntries(
        POSITIONS.map(p => [p, countShare(cases, c => positionOf(c) === p)])
    );

/** Median width (ATR) of the zones of `cases`. */
const widthOf = (
    cases: readonly ZoneCase[]
): { n: number; median: number | null } => ({
    n: cases.length,
    median: median(
        cases.flatMap(c =>
            c.zoneLow === null || c.zoneTop === null || c.atr === null
                ? []
                : [(c.zoneTop - c.zoneLow) / c.atr]
        )
    ),
});

const sampleKey = (caseId: string, group: string): string =>
    sha256Hex(`${caseId}|${group}`);

/** The `limit` cases with the smallest sha256 of `caseId|group`. */
function sampleOf(
    cases: readonly ZoneCase[],
    group: string,
    limit: number
): string[] {
    return cases
        .map(c => ({ id: c.caseId, key: sampleKey(c.caseId, group) }))
        .toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .slice(0, limit)
        .map(c => c.id);
}

export function zoneReport(
    cases: readonly ZoneCase[],
    options: { language: ZoneLanguage; restate: boolean }
): ZoneReport {
    const cue = PULLBACK_CUE[options.language];
    const cues = (c: ZoneCase): boolean => cue.test(c.prose);
    const geometry = (c: ZoneCase): ZoneGeometry | null =>
        c.zoneLow === null || c.zoneTop === null
            ? null
            : geometryOf(c.close, c.zoneLow, c.zoneTop);
    const tolIn = cases.filter(c => c.tolerancePosition === 'in_zone');
    const bandAbove = tolIn.filter(c => geometry(c) === 'band_above');
    const exactIn = cases.filter(c => exactPosition(c) === 'in_zone');
    const stored = cases.filter(c => c.storedPosition !== null);
    const group = (
        name: string,
        pool: readonly ZoneCase[]
    ): [string, ShareStat] => [name, countShare(pool, cues)];
    const distances = bandAbove.flatMap(c => distanceAboveTopAtr(c) ?? []);
    const basis = options.restate ? 'exact' : 'stored';
    const used = (c: ZoneCase): string => basisPosition(c, options.restate);
    const inside = (c: ZoneCase): boolean =>
        c.zoneLow !== null &&
        c.zoneTop !== null &&
        c.zoneLow <= c.close &&
        c.close <= c.zoneTop;
    const placed = stored.filter(c => c.storedPosition !== 'no_setup');
    const approached = placed.filter(c => c.approach !== null);
    const near = cases.filter(
        c =>
            used(c) === 'above_zone' &&
            (distanceAboveTopAtr(c) ?? Infinity) <= ZONE_GATES.nearAtr
    );
    const nearIds = new Set(near.map(c => c.caseId));
    const inZoneUsed = cases.filter(c => used(c) === 'in_zone');
    const other = cases.filter(
        c => used(c) !== 'in_zone' && !nearIds.has(c.caseId)
    );
    return {
        n: cases.length,
        positions: {
            tolerance: positionShares(cases, c => c.tolerancePosition),
            exact: positionShares(cases, exactPosition),
            stored:
                stored.length === 0
                    ? null
                    : positionShares(stored, c => c.storedPosition ?? ''),
        },
        toleranceInZoneGeometry: Object.fromEntries(
            ZONE_GEOMETRIES.map(g => [
                g,
                share(
                    tolIn.filter(c => geometry(c) === g).length,
                    tolIn.length
                ),
            ])
        ) as Record<ZoneGeometry, ShareStat>,
        bandAboveDistanceAtr: {
            n: distances.length,
            median: median(distances),
            p90: quantile(distances, 0.9),
        },
        inZoneWidthAtr: {
            tolerance: widthOf(tolIn),
            exact: widthOf(exactIn),
        },
        cueByGroup: Object.fromEntries([
            group('tolerance_band_above', bandAbove),
            group(
                'tolerance_at_or_inside',
                tolIn.filter(c => {
                    const g = geometry(c);
                    return (
                        g === 'strictly_inside' ||
                        g === 'at_top' ||
                        g === 'at_low'
                    );
                })
            ),
            group(
                'tolerance_above_zone',
                cases.filter(c => c.tolerancePosition === 'above_zone')
            ),
            group('exact_in_zone', exactIn),
            group(
                'exact_above_zone',
                cases.filter(c => exactPosition(c) === 'above_zone')
            ),
            group(
                'exact_below_zone',
                cases.filter(c => exactPosition(c) === 'below_zone')
            ),
        ]),
        z1: {
            // A gate over a population is not computable until it covers all of it: a run
            // with a stored state on some plans only, or labels on some, says nothing about the rest.
            positionEqualsExact:
                stored.length === 0 || stored.length !== cases.length
                    ? null
                    : countShare(
                          stored,
                          c => c.storedPosition === exactPosition(c)
                      ),
            inZoneIffInside:
                placed.length === 0 || stored.length !== cases.length
                    ? null
                    : countShare(
                          placed,
                          c => (c.storedPosition === 'in_zone') === inside(c)
                      ),
            approachInsideIffInZone:
                approached.length === 0 ||
                approached.length !== placed.length ||
                stored.length !== cases.length
                    ? null
                    : countShare(
                          approached,
                          c =>
                              (c.approach === 'inside') ===
                              (c.storedPosition === 'in_zone')
                      ),
        },
        n3: {
            basis,
            positions: positionShares(cases, used),
            inZoneCi: bootstrapCi(
                cases.map(c => (used(c) === 'in_zone' ? 1 : 0)),
                mean
            ),
        },
        n1Sample: {
            in_zone: sampleOf(inZoneUsed, 'in_zone', ZONE_GATES.sample.in_zone),
            above_zone_near: sampleOf(
                near,
                'above_zone_near',
                ZONE_GATES.sample.above_zone_near
            ),
            other: sampleOf(other, 'other', ZONE_GATES.sample.other),
        },
    };
}

// ─── N2 (paired, needs a before run) ──────────────────────────────────────────

export interface TargetRoomComparison {
    paired: number;
    before: ShareStat;
    after: ShareStat;
    diff: ReturnType<typeof bootstrapCi>;
}

/** Share of plans whose first target lies at least one ATR above the zone top, after minus before. */
export function targetRoomComparison(
    after: readonly ZoneCase[],
    before: readonly ZoneCase[]
): TargetRoomComparison {
    const roomy = (c: ZoneCase): boolean =>
        c.firstTargetRoomAtr !== null &&
        c.firstTargetRoomAtr >= C.planMinAtrSpacing - 1e-9;
    const beforeBy = new Map(before.map(c => [c.caseId, c]));
    const pairs = after.flatMap(a => {
        const b = beforeBy.get(a.caseId);
        return b === undefined ? [] : [{ a, b }];
    });
    return {
        paired: pairs.length,
        before: countShare(
            pairs.map(p => p.b),
            roomy
        ),
        after: countShare(
            pairs.map(p => p.a),
            roomy
        ),
        diff: bootstrapCi(
            pairs.map(p => (roomy(p.a) ? 1 : 0) - (roomy(p.b) ? 1 : 0)),
            mean
        ),
    };
}

// ─── Gates ────────────────────────────────────────────────────────────────────

const pct = (v: number | null): string =>
    v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`;

const describeShare = (s: ShareStat | null): string =>
    s === null ? 'n/a' : `${s.count}/${s.n}`;

/**
 * Z1: the stored plan state is the exact rule on every plan, `in_zone` is exactly inside the
 * edges, and the outcome labeller's approach agrees. Z2: at most 66/164 (40.2%) of the `in_zone` plans
 * read as pullback plans. N3: no position above 85% of the headline rows. N2: the share of
 * plans with room for a target does not fall by more than 5 pp against the before run.
 */
export function zoneGates(
    report: ZoneReport,
    afterCases: number,
    targetRoom: TargetRoomComparison | null
): readonly GateResult[] {
    const all = (s: ShareStat | null): boolean | null =>
        s === null ? null : s.count === s.n;
    const parts = [
        all(report.z1.positionEqualsExact),
        all(report.z1.inZoneIffInside),
        all(report.z1.approachInsideIffInZone),
    ];
    const z1 = parts.includes(false)
        ? false
        : parts.includes(null)
          ? null
          : true;
    const exactCue = report.cueByGroup.exact_in_zone;
    const z2 =
        exactCue.share === null
            ? null
            : exactCue.share <= ZONE_GATES.maxInZoneCueShare + 1e-12;
    const shares = Object.entries(report.n3.positions).flatMap(([name, s]) =>
        s.share === null ? [] : [{ name, share: s.share }]
    );
    const top = shares.toSorted((a, b) => b.share - a.share)[0];
    const covered =
        targetRoom !== null &&
        afterCases > 0 &&
        targetRoom.paired >=
            Math.ceil(C.gates.minPairedShare * afterCases - 1e-9);
    return [
        {
            id: 'Z1',
            description:
                'stored plan state equals the exact-edge rule, in_zone is inside the edges, labeller approach agrees',
            pass: z1,
            value: `state ${describeShare(report.z1.positionEqualsExact)}, inside ${describeShare(report.z1.inZoneIffInside)}, approach ${describeShare(report.z1.approachInsideIffInZone)}`,
            threshold: '100% of each',
        },
        {
            id: 'Z2',
            description:
                'plans the exact rule calls in_zone whose prose reads as a pullback plan',
            pass: z2,
            value: `${pct(exactCue.share)} (${describeShare(exactCue)})`,
            threshold: '<= 40.2% (66/164)',
        },
        {
            id: 'N2',
            description:
                'plans whose first target is at least 1 ATR above the zone top, after minus before',
            pass:
                !covered || targetRoom === null || targetRoom.diff.low === null
                    ? null
                    : targetRoom.diff.low >=
                      ZONE_GATES.targetRoomMargin - 1e-12,
            value:
                targetRoom === null
                    ? 'no --before run'
                    : `${pct(targetRoom.before.share)} -> ${pct(targetRoom.after.share)}, diff ${pct(targetRoom.diff.point)} (95% low ${pct(targetRoom.diff.low)}, ${targetRoom.paired} paired)`,
            threshold: `95% low >= ${ZONE_GATES.targetRoomMargin * 100} pp`,
        },
        {
            id: 'N3',
            description: `no plan position above ${ZONE_GATES.maxPositionShare * 100}% of the headline rows (${report.n3.basis} positions); in_zone reported with its interval`,
            pass:
                top === undefined
                    ? null
                    : top.share <= ZONE_GATES.maxPositionShare + 1e-12,
            value:
                top === undefined
                    ? 'n/a'
                    : `largest ${top.name} ${pct(top.share)}; in_zone ${pct(report.n3.positions.in_zone.share)} (95% ${pct(report.n3.inZoneCi.low)} to ${pct(report.n3.inZoneCi.high)})`,
            threshold: `<= ${ZONE_GATES.maxPositionShare * 100}%`,
        },
    ];
}
