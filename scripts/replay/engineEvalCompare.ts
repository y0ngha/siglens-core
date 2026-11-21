/**
 * Before/after comparison of two engine-evaluation arms (G2), and the CLI:
 *
 *   npx tsx scripts/replay/engineEvalCompare.ts --before <run dir> --after <run dir> --out <dir>
 *
 * Two runs are comparable only when they measured the same data the same way: the
 * `run.json` source fingerprint, symbol list, `only` and constants must be identical, or the
 * comparison is refused. A `+dirty` checkout is allowed but warned about (its diff hash is
 * in `run.json`).
 *
 * `Δ = E_after − E_before` of each pool is taken inside every resample of one shared week
 * bootstrap, so the interval reflects both arms' sampling together. The merge gate G2 reads
 * the upper bound of the pooled Δ (primary horizon for candles, target-first share for
 * patterns): a bound that cannot be computed fails when both arms measured that half. The
 * qualified-instance count is reported with the families that fell by more than 25%; G1 is
 * the after arm's own deterministic, gate-scoped count.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from '../ab-harness/cliArgs';
import {
    CANDLE_POOLS,
    candleObservations,
    candlePoolEvents,
    deltaStat,
    isCandleEvent,
    isPatternEvent,
    makeResamplings,
    patternObservations,
    toBlocks,
    type ArmSummary,
    type CandlePool,
    type DeltaStat,
    type G1Report,
} from './engineEvalCompute';
import { recordOf } from './engineEvalStats';
import {
    EVAL_CONSTANTS,
    HORIZON_KEYS,
    PRIMARY_HORIZON,
    type EvalEvent,
    type HorizonKey,
} from './engineEvalTypes';
import { assertOutsideRepo, readJson, writeFileAtomic } from './fsUtil';

/** A family's qualified-instance count may fall by at most this share from `before`. */
export const MAX_INSTANCE_DROP = 0.25;

/** The parts of `run.json` the comparison reads. */
export interface RunInfo {
    arm: string;
    coreGitSha: string;
    dirtyDiffSha256: string | null;
    source: { kind: string; fingerprint: string; symbols: string[] };
    only: string | null;
    gate: string | null;
    constants: unknown;
}

export interface ArmData {
    run: RunInfo;
    summary: ArmSummary;
    events: readonly EvalEvent[];
}

export interface InstanceChange {
    family: string;
    before: number;
    after: number;
    /** `after / before − 1`; `null` when `before` is 0. */
    change: number | null;
}

export interface CandleCountChange {
    pattern: string;
    before: number;
    after: number;
}

export interface CompareReport {
    before: string;
    after: string;
    warnings: string[];
    candles: Record<
        CandlePool,
        { primary: DeltaStat; horizons: Record<HorizonKey, DeltaStat> }
    > | null;
    /** Detected candle events per pattern, before and after. */
    candleEventCounts: CandleCountChange[] | null;
    patterns: {
        target: DeltaStat;
        targetBlock: DeltaStat;
        cons: DeltaStat;
        families: { family: string; delta: DeltaStat }[];
    } | null;
    instances: {
        total: InstanceChange;
        /** Families that fell by more than `MAX_INSTANCE_DROP`, for the orchestrator to decide. */
        droppedFamilies: InstanceChange[];
        byFamily: InstanceChange[];
    } | null;
    gates: {
        g1: { pass: boolean; gate: string | null; after: G1Report };
        g2: {
            candleUpperBoundNonNegative: boolean | null;
            patternUpperBoundNonNegative: boolean | null;
            /** `true` when the total fell by at most `MAX_INSTANCE_DROP` (reported, not automatic). */
            instancesWithinBound: boolean | null;
            pass: boolean;
        };
    };
}

/** JSON with sorted keys, so two equal objects compare equal whatever their key order. */
function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        return `{${Object.entries(value)
            .toSorted(([a], [b]) => a.localeCompare(b, 'en'))
            .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

/**
 * Throws unless the two runs measured the same data the same way: source fingerprint,
 * symbol list, `only` and constants.
 */
export function assertComparable(before: RunInfo, after: RunInfo): void {
    const differences = [
        before.source.fingerprint !== after.source.fingerprint &&
            'source fingerprint',
        stableJson(before.source.symbols) !==
            stableJson(after.source.symbols) && 'symbol list',
        before.only !== after.only && '`only`',
        stableJson(before.constants) !== stableJson(after.constants) &&
            'constants',
        before.gate !== after.gate && '`gate`',
    ].filter((name): name is string => typeof name === 'string');
    if (differences.length > 0) {
        throw new Error(
            `runs are not comparable: ${differences.join(', ')} differ between ${before.arm} and ${after.arm}`
        );
    }
}

const instanceChange = (
    family: string,
    before: number,
    after: number
): InstanceChange => ({
    family,
    before,
    after,
    change: before === 0 ? null : after / before - 1,
});

function instanceReport(
    before: ArmSummary,
    after: ArmSummary
): CompareReport['instances'] {
    if (before.patterns === null || after.patterns === null) return null;
    const b = before.patterns.counters;
    const a = after.patterns.counters;
    const families = [
        ...new Set(
            [...Object.keys(b), ...Object.keys(a)]
                .filter(key => key.startsWith('instances:'))
                .map(key => key.slice('instances:'.length))
        ),
    ].toSorted();
    const byFamily = families.map(family =>
        instanceChange(
            family,
            b[`instances:${family}`] ?? 0,
            a[`instances:${family}`] ?? 0
        )
    );
    return {
        total: instanceChange('all', b.instances ?? 0, a.instances ?? 0),
        droppedFamilies: byFamily.filter(
            f => f.change !== null && f.change < -MAX_INSTANCE_DROP
        ),
        byFamily,
    };
}

function candleCountChanges(
    before: ArmSummary,
    after: ArmSummary
): CandleCountChange[] | null {
    if (before.candles === null || after.candles === null) return null;
    const b = before.candles.byPattern;
    const a = after.candles.byPattern;
    return [...new Set([...Object.keys(b), ...Object.keys(a)])]
        .toSorted()
        .map(pattern => ({
            pattern,
            before: b[pattern] ?? 0,
            after: a[pattern] ?? 0,
        }));
}

/** `null` when the half was not measured by both arms; a missing bound then fails. */
function upperBoundNonNegative(
    measured: boolean,
    high: number | null | undefined
): boolean | null {
    if (!measured) return null;
    return high !== null && high !== undefined && high >= 0;
}

export function compareArms(before: ArmData, after: ArmData): CompareReport {
    if (after.run.gate === null) {
        throw new Error(
            `the after run (${after.run.arm}) was made without --gate: G1 cannot be scored; rerun both arms with the same --gate`
        );
    }
    assertComparable(before.run, after.run);
    const warnings = [before, after]
        .filter(arm => arm.run.coreGitSha.endsWith('+dirty'))
        .map(
            arm =>
                `${arm.run.arm} ran on a dirty checkout (${arm.run.coreGitSha}, diff ${arm.run.dirtyDiffSha256 ?? 'unhashed'})`
        );
    const candleBefore = before.events.filter(isCandleEvent);
    const candleAfter = after.events.filter(isCandleEvent);
    const patternBefore = before.events.filter(isPatternEvent);
    const patternAfter = after.events.filter(isPatternEvent);
    const haveCandles =
        before.summary.candles !== null && after.summary.candles !== null;
    const havePatterns =
        before.summary.patterns !== null && after.summary.patterns !== null;

    const resamplings = makeResamplings(before.summary.weeks);
    const resampling = resamplings.weeks;
    const candleObs = (
        events: typeof candleBefore,
        pool: CandlePool,
        horizon: HorizonKey
    ) =>
        candleObservations(
            candlePoolEvents(events, pool),
            'y',
            horizon,
            'matched'
        );

    const candles = haveCandles
        ? recordOf(CANDLE_POOLS, pool => ({
              primary: deltaStat(
                  candleObs(candleBefore, pool, PRIMARY_HORIZON),
                  candleObs(candleAfter, pool, PRIMARY_HORIZON),
                  resampling
              ),
              horizons: recordOf(HORIZON_KEYS, h =>
                  deltaStat(
                      candleObs(candleBefore, pool, h),
                      candleObs(candleAfter, pool, h),
                      resampling
                  )
              ),
          }))
        : null;

    const familyIds = [
        ...new Set([...patternBefore, ...patternAfter].map(e => e.id)),
    ].toSorted();
    const familyDeltas = familyIds
        .map(family => {
            const own = (events: typeof patternBefore) =>
                patternObservations(
                    events.filter(e => e.id === family),
                    'target'
                );
            return {
                family,
                delta: deltaStat(
                    own(patternBefore),
                    own(patternAfter),
                    resampling
                ),
            };
        })
        .filter(
            f =>
                f.delta.nBefore >= EVAL_CONSTANTS.minFamilyN &&
                f.delta.nAfter >= EVAL_CONSTANTS.minFamilyN
        );
    const patterns = havePatterns
        ? {
              target: deltaStat(
                  patternObservations(patternBefore, 'target'),
                  patternObservations(patternAfter, 'target'),
                  resampling
              ),
              targetBlock: deltaStat(
                  toBlocks(patternObservations(patternBefore, 'target')),
                  toBlocks(patternObservations(patternAfter, 'target')),
                  resamplings.blocks
              ),
              cons: deltaStat(
                  patternObservations(patternBefore, 'cons'),
                  patternObservations(patternAfter, 'cons'),
                  resampling
              ),
              families: familyDeltas,
          }
        : null;

    const instances = instanceReport(before.summary, after.summary);
    const instancesWithinBound =
        instances === null || instances.total.change === null
            ? null
            : instances.total.change >= -MAX_INSTANCE_DROP;
    const candleBound = upperBoundNonNegative(
        haveCandles,
        candles?.pooled.primary.high
    );
    const patternBound = upperBoundNonNegative(
        havePatterns,
        patterns?.target.high
    );
    return {
        before: before.summary.arm,
        after: after.summary.arm,
        warnings,
        candles,
        candleEventCounts: candleCountChanges(before.summary, after.summary),
        patterns,
        instances,
        gates: {
            g1: {
                pass: after.summary.g1.pass === true,
                gate: after.summary.g1.gate,
                after: after.summary.g1,
            },
            g2: {
                candleUpperBoundNonNegative: candleBound,
                patternUpperBoundNonNegative: patternBound,
                instancesWithinBound,
                // Fails closed: with neither half measured there is nothing to pass.
                pass:
                    (candleBound !== null || patternBound !== null) &&
                    candleBound !== false &&
                    patternBound !== false,
            },
        },
    };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

/** A `run.json` that lacks the fields the comparison reads. */
export class InvalidRunInfoError extends Error {
    constructor(reason: string) {
        super(`run.json is not an engine-evaluation run: ${reason}`);
        this.name = 'InvalidRunInfoError';
    }
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isNullOr = (v: unknown, check: (x: unknown) => boolean): boolean =>
    v === null || check(v);

/** Validates the fields of `run.json` the comparison reads; throws `InvalidRunInfoError`. */
export function parseRunInfo(raw: unknown): RunInfo {
    if (typeof raw !== 'object' || raw === null) {
        throw new InvalidRunInfoError('not an object');
    }
    // Narrowed to a non-null object above; each field is checked individually below.
    const run = raw as Record<string, unknown>;
    const source = run.source as Record<string, unknown> | null | undefined;
    const checks: readonly [string, boolean][] = [
        ['arm', isString(run.arm)],
        ['coreGitSha', isString(run.coreGitSha)],
        ['dirtyDiffSha256', isNullOr(run.dirtyDiffSha256, isString)],
        ['only', isNullOr(run.only, isString)],
        ['gate', isNullOr(run.gate, isString)],
        [
            'constants',
            typeof run.constants === 'object' && run.constants !== null,
        ],
        [
            'source',
            typeof source === 'object' &&
                source !== null &&
                isString(source.kind) &&
                isString(source.fingerprint) &&
                Array.isArray(source.symbols) &&
                source.symbols.every(isString),
        ],
    ];
    const bad = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (bad.length > 0)
        throw new InvalidRunInfoError(`bad field(s): ${bad.join(', ')}`);
    // Every field the comparison reads was just checked above.
    return raw as RunInfo;
}

/** One `events.jsonl` line; throws `InvalidEventError` unless it is a candle or pattern row. */
export class InvalidEventError extends Error {
    constructor(line: string) {
        super(
            `events.jsonl holds a row that is not a candle or pattern event: ${line.slice(0, 80)}`
        );
        this.name = 'InvalidEventError';
    }
}

function parseEvent(line: string): EvalEvent {
    const row: unknown = JSON.parse(line);
    const kind =
        typeof row === 'object' && row !== null && 'kind' in row
            ? row.kind
            : undefined;
    if (kind !== 'candle' && kind !== 'pattern')
        throw new InvalidEventError(line);
    // The `kind` field was just checked; the rest is trusted to be what `engineEval.ts`
    // wrote, and every reader goes through the typed fields.
    return row as EvalEvent;
}

/** Reads a run directory written by `engineEval.ts`. */
export function readArm(runDir: string): ArmData {
    return {
        run: parseRunInfo(readJson<unknown>(join(runDir, 'run.json'))),
        summary: readJson<ArmSummary>(join(runDir, 'summary.json')),
        events: readFileSync(join(runDir, 'events.jsonl'), 'utf-8')
            .split('\n')
            .filter(line => line !== '')
            // Trusts each line to be an event row `engineEval.ts` wrote; every reader goes
            // through the typed fields, and a row of another shape fails there.
            .map(line => parseEvent(line)),
    };
}

export interface CompareArgs {
    before: string;
    after: string;
    out: string;
}

export function parseCompareArgs(argv: readonly string[]): CompareArgs {
    const raw = parseArgs(argv);
    if (!raw.before || !raw.after || !raw.out) {
        throw new Error('--before, --after and --out are required');
    }
    return {
        before: resolve(raw.before),
        after: resolve(raw.after),
        out: resolve(raw.out),
    };
}

export function runCompare(
    args: CompareArgs,
    log: (line: string) => void
): CompareReport {
    assertOutsideRepo(args.out);
    const report = compareArms(readArm(args.before), readArm(args.after));
    writeFileAtomic(
        join(args.out, 'compare.json'),
        `${JSON.stringify(report, null, 2)}\n`
    );
    report.warnings.forEach(warning => log(`WARNING: ${warning}`));
    log(
        `G1 (after, gate ${report.gates.g1.gate ?? 'none'}): ${report.gates.g1.pass ? 'PASS' : 'FAIL'}`
    );
    log(
        `G2 candle upper bound >= 0: ${String(report.gates.g2.candleUpperBoundNonNegative)}`
    );
    log(
        `G2 pattern upper bound >= 0: ${String(report.gates.g2.patternUpperBoundNonNegative)}`
    );
    log(
        `G2 qualified instances within -25%: ${String(report.gates.g2.instancesWithinBound)}`
    );
    return report;
}

/** Exit code of a finished comparison: 0 when G1 and G2 both pass, 2 when either fails. */
export function exitCodeOf(report: CompareReport): 0 | 2 {
    return report.gates.g1.pass && report.gates.g2.pass ? 0 : 2;
}

if (require.main === module) {
    try {
        process.exitCode = exitCodeOf(
            runCompare(parseCompareArgs(process.argv.slice(2)), console.log)
        );
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
