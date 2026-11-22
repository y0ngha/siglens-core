/**
 * The price-level evaluation (WP-18 core-0): are the levels a prompt prints more likely to
 * "hold" than a price at the same distance on another date, and would any score built from
 * their features say which will? Placebo-controlled, offline, no model call, no cost.
 *
 *   npx tsx scripts/replay/levelEval.ts --set <set dir> --out <dir> [--step 3] [--arm <name>]
 *       [--symbols A,B] [--gate L0,L-gate,G42|all]
 *
 * For every `--step`-th bar from bar 300 (with 20 forward bars) the production 500-bar window
 * ending at the bar gives the market reference; every printed level (`printedLevelsOnSide`)
 * gets features read from bars up to the day only, its outcome from `labelLevelOutcome` on the
 * 20 bars after (touch within 0.1 ATR; held = a close 0.5 ATR back on the level's side before
 * a close 0.5 ATR through it, within 10 bars) and the date-transplant placebo of the same
 * distance on 3 other days of the symbol within 250 bars.
 *
 * Writes `run.json` (core sha, dirty-diff hash, data fingerprint, constants) and
 * `summary.json` (held-rate tables with n and week-clustered intervals, the score fit with a
 * time split, the structural-ratio anchors, the non-positive-level count and the gates).
 * Gates (WP-18 §8.3) are always computed; `--gate` picks the ones that decide the exit code
 * (2 when a selected gate fails or cannot be computed, 1 on an error). Output inside the
 * repository is refused.
 */
import { join, resolve } from 'node:path';
import { buildOutcomeWindow } from '@/domain/outcomes/buildOutcomeWindow';
import type { OutcomeWindow } from '@/domain/outcomes/types';
import { parseArgs } from '../ab-harness/cliArgs';
import { dirtyDiffSha256, loadSet, type LoadedData } from './engineEval';
import { makeResamplings } from './engineEvalCompute';
import { isoDate, weeksOfTimes } from './engineEvalStats';
import {
    addRobust,
    heldTables,
    labelDay,
    levelFeaturesAt,
    levelHash,
    nonPositiveSummary,
    partnerDays,
    robustRows,
    scoreSummary,
    structuralSummary,
    toDayRow,
    touchRateByDistance,
    transplantPicks,
    groupStat,
    type RobustTally,
} from './levelEvalCompute';
import {
    L0_REFERENCE,
    LEVEL_EVAL_SEED,
    LEVEL_EVAL_CONSTANTS as C,
    LEVEL_EVAL_CORE_DERIVED,
    type DayRow,
    type LevelRow,
} from './levelEvalTypes';
import type { GateResult } from './analysisFieldsEvalTypes';
import { assertOutsideRepo, gitOutput, writeFileAtomic } from './fsUtil';

export const LEVEL_GATE_IDS = ['L0', 'L-gate', 'G42'] as const;
export type LevelGateId = (typeof LEVEL_GATE_IDS)[number];

export interface LevelEvalArgs {
    set: string;
    out: string;
    arm: string;
    step: number;
    symbols: readonly string[] | null;
    gate: readonly LevelGateId[] | null;
}

export function parseLevelEvalArgs(argv: readonly string[]): LevelEvalArgs {
    const raw = parseArgs(argv);
    if (!raw.set) throw new Error('--set is required');
    if (!raw.out) throw new Error('--out is required');
    const step = raw.step === undefined ? C.defaultStep : Number(raw.step);
    if (!Number.isInteger(step) || step < 1) {
        throw new Error(
            `--step must be a positive integer (got "${raw.step}")`
        );
    }
    const ids =
        raw.gate === undefined
            ? null
            : raw.gate === 'all' || raw.gate === 'true'
              ? [...LEVEL_GATE_IDS]
              : raw.gate.split(',').map(id => {
                    const known = LEVEL_GATE_IDS.find(g => g === id);
                    if (known === undefined) {
                        throw new Error(
                            `--gate ids must be among ${LEVEL_GATE_IDS.join(', ')} (got "${id}")`
                        );
                    }
                    return known;
                });
    return {
        set: resolve(raw.set),
        out: resolve(raw.out),
        arm: raw.arm ?? 'unnamed',
        step,
        symbols: raw.symbols === undefined ? null : raw.symbols.split(','),
        gate: ids,
    };
}

// ─── Gates ────────────────────────────────────────────────────────────────────

const pp = (v: number | null): string =>
    v === null ? 'n/a' : `${(v * 100).toFixed(2)} pp`;

export interface GateInput {
    /** The run covers the whole of set B at the reference step (the L0 population). */
    isReferencePopulation: boolean;
    /** Real levels the labeller and the instrument's evaluator label differently; L0 needs 0. */
    labelDisagreements: number;
    held: number | null;
    transplantHeld: number | null;
    aucTest: number | null;
    topMinusTransplant: {
        mean: number | null;
        low: number | null;
    } | null;
    topByMarket: Record<string, number | null>;
    topByHalf: Record<string, number | null>;
    nonPositiveTotal: number;
    measurableDays: number;
}

const near = (value: number | null, expected: number): boolean | null =>
    value === null
        ? null
        : Math.abs(value - expected) <= L0_REFERENCE.tolerance;

/**
 * L0: the instrument reproduces WP-18 §1 on set B within the tolerance. Another set, another
 * step or a narrowed symbol list is a different population: the gate cannot be computed.
 * L-gate: a score's top quintile beats its own transplant placebo out of sample (the interval's
 * low bound above 0) with a positive point estimate in both markets and both test halves; it
 * documents why no score ships. G42: no non-positive level anywhere.
 */
export function levelGates(input: GateInput): readonly GateResult[] {
    const l0Parts = [
        near(input.held, L0_REFERENCE.held),
        near(input.transplantHeld, L0_REFERENCE.transplantHeld),
        near(input.aucTest, L0_REFERENCE.auc),
        near(
            input.topMinusTransplant?.mean ?? null,
            L0_REFERENCE.topMinusTransplant
        ),
    ];
    const l0 =
        !input.isReferencePopulation || input.labelDisagreements > 0
            ? null
            : l0Parts.includes(null)
              ? null
              : l0Parts.every(p => p === true);
    const top = input.topMinusTransplant;
    const subs = [
        ...Object.values(input.topByMarket),
        ...Object.values(input.topByHalf),
    ];
    const lGate =
        top === null ||
        top.low === null ||
        top.mean === null ||
        subs.includes(null)
            ? null
            : top.low > 0 && subs.every(v => v !== null && v > 0);
    return [
        {
            id: 'L0',
            description:
                'the instrument reproduces held, transplant, test AUC and top minus transplant of WP-18 section 1',
            pass: l0,
            value:
                input.labelDisagreements > 0
                    ? `${input.labelDisagreements} real levels are labelled differently by labelLevelOutcome and the instrument's evaluator: the instrument has drifted from the labeller`
                    : input.isReferencePopulation
                      ? `held ${pp(input.held)} (${pp(L0_REFERENCE.held)}), transplant ${pp(input.transplantHeld)} (${pp(L0_REFERENCE.transplantHeld)}), AUC ${input.aucTest?.toFixed(4) ?? 'n/a'} (${L0_REFERENCE.auc}), top minus transplant ${pp(top?.mean ?? null)} (${pp(L0_REFERENCE.topMinusTransplant)})`
                      : 'not the reference population (set B, step 3, every symbol)',
            threshold: `each within ${L0_REFERENCE.tolerance * 100} pp`,
        },
        {
            id: 'L-gate',
            description:
                'a level score beats its own transplant placebo out of sample (top quintile), in both markets and both test halves',
            pass: lGate,
            value: `top minus transplant ${pp(top?.mean ?? null)} (95% low ${pp(top?.low ?? null)}); by market ${JSON.stringify(input.topByMarket)}; by half ${JSON.stringify(input.topByHalf)}`,
            threshold:
                '95% low > 0 and every market and half point estimate > 0',
        },
        {
            id: 'G42',
            description:
                'non-positive levels in any horizon, in printedLevelsOnSide and in the Fibonacci overlay levels',
            pass:
                input.measurableDays === 0
                    ? null
                    : input.nonPositiveTotal === 0,
            value: `${input.nonPositiveTotal} over ${input.measurableDays} days`,
            threshold: '0',
        },
    ];
}

// ─── Running ──────────────────────────────────────────────────────────────────

export interface LevelEvalDeps {
    log: (line: string) => void;
    gitSha: () => string;
    dirtyDiffSha256: () => string | null;
}

export const defaultDeps: LevelEvalDeps = {
    log: console.log,
    gitSha: () =>
        `${gitOutput(['rev-parse', 'HEAD'])}${gitOutput(['status', '--porcelain']) === '' ? '' : '+dirty'}`,
    dirtyDiffSha256,
};

interface SymbolResult {
    days: DayRow[];
    rows: LevelRow[];
    disagreements: number;
    skipped: Record<string, number>;
}

const bump = (
    counts: Record<string, number>,
    key: string
): Record<string, number> => ({
    ...counts,
    [key]: (counts[key] ?? 0) + 1,
});

/** Study days of one symbol: features, labels, transplant and the robustness tallies. */
function studySymbol(
    symbol: LoadedData['symbols'][number],
    step: number,
    tallies: Map<string, RobustTally>
): SymbolResult {
    const { bars, market } = symbol;
    const studyTs = Array.from(
        {
            length: Math.max(
                0,
                Math.ceil((bars.length - C.forwardBars - C.firstBar) / step)
            ),
        },
        (_, i) => C.firstBar + i * step
    ).filter(t => t < bars.length - C.forwardBars);
    const built = studyTs.map(t => {
        const day = levelFeaturesAt(bars, t, { symbol: symbol.symbol, market });
        if (day === null)
            return { t, day: null, window: null, reason: 'unusable' };
        const result = buildOutcomeWindow(
            bars.slice(0, t + C.forwardBars + 1),
            {
                barTime: day.time,
                closeAtAnalysis: day.close,
                closedAtAnalysis: true,
            }
        );
        return result.status === 'ok'
            ? { t, day, window: result.window, reason: null }
            : { t, day, window: null, reason: result.status };
    });
    const windows = new Map<number, OutcomeWindow>(
        built.flatMap(b =>
            b.window === null ? [] : [[b.t, b.window] as const]
        )
    );
    const days = [...windows.keys()].toSorted((a, b) => a - b);
    const labelled = built.flatMap(b => {
        if (b.day === null || b.window === null) return [];
        const partners = partnerDays(b.t, days);
        const out = labelDay(b.day, b.window, windows, partners);
        out.rows.forEach(row => {
            const hash = levelHash(row.symbol, row.t, row.side, row.rank);
            if (hash % BigInt(C.robustSampleModulus) !== 0n) return;
            const picks = transplantPicks(hash, partners).flatMap(pick => {
                const w = windows.get(pick);
                return w === undefined ? [] : [w];
            });
            if (picks.length === 0 || b.window === null) return;
            addRobust(tallies, row, b.window, picks);
        });
        return [{ b, out }];
    });
    return {
        days: built.flatMap(b =>
            b.day === null || b.window === null ? [] : [toDayRow(b.day, bars)]
        ),
        rows: labelled.flatMap(l => l.out.rows),
        disagreements: labelled.reduce((s, l) => s + l.out.disagreements, 0),
        skipped: built.reduce<Record<string, number>>(
            (acc, b) => (b.reason === null ? acc : bump(acc, b.reason)),
            {}
        ),
    };
}

/** Writes the run and returns its exit code: 0, or 2 when a selected gate did not pass. */
export function runLevelEval(args: LevelEvalArgs, deps: LevelEvalDeps): number {
    assertOutsideRepo(args.out);
    const data = loadSet(args.set);
    const symbols =
        args.symbols === null
            ? data.symbols
            : data.symbols.filter(s => args.symbols?.includes(s.symbol));
    const missing = (args.symbols ?? []).filter(
        wanted => !data.symbols.some(s => s.symbol === wanted)
    );
    if (missing.length > 0) {
        throw new Error(`--symbols not in the data: ${missing.join(', ')}`);
    }
    if (symbols.length === 0) throw new Error('no symbols to evaluate');
    deps.log(`arm ${args.arm}: ${symbols.length} symbols, step ${args.step}`);
    const tallies = new Map<string, RobustTally>();
    const results = symbols.map((symbol, i) => {
        const result = studySymbol(symbol, args.step, tallies);
        deps.log(
            `  ${i + 1}/${symbols.length} ${symbol.symbol}: ${result.days.length} days, ${result.rows.length} levels`
        );
        return result;
    });
    const days = results.flatMap(r => r.days);
    const rows = results.flatMap(r => r.rows);
    if (days.length === 0 || rows.length === 0) {
        throw new Error('the evaluation measured no day or no level');
    }
    const resampling = makeResamplings(
        weeksOfTimes(symbols.flatMap(s => s.bars.map(bar => bar.time))),
        LEVEL_EVAL_SEED
    );
    const overall = groupStat(rows, resampling);
    const score = scoreSummary(rows, resampling);
    const nonPositive = nonPositiveSummary(days);
    const isReference =
        args.symbols === null &&
        args.step === L0_REFERENCE.step &&
        data.fingerprint === L0_REFERENCE.setFingerprint;
    const disagreements = results.reduce((s, r) => s + r.disagreements, 0);
    if (disagreements > 0) {
        deps.log(
            `WARNING: ${disagreements} real levels are labelled differently by labelLevelOutcome and the instrument's own evaluator; L0 is not computable`
        );
    }
    const gates = levelGates({
        isReferencePopulation: isReference,
        labelDisagreements: disagreements,
        held: overall.held.share,
        transplantHeld: overall.transplant.share,
        aucTest: score?.aucTest ?? null,
        topMinusTransplant: score?.topMinusTransplant ?? null,
        topByMarket: score?.topMinusTransplantByMarket ?? {
            us: null,
            kr: null,
        },
        topByHalf: score?.topMinusTransplantByHalf ?? {
            first: null,
            second: null,
        },
        nonPositiveTotal: nonPositive.total,
        measurableDays: days.length,
    });
    const outcomes = rows.reduce<Record<string, number>>(
        (acc, r) => bump(acc, r.outcome),
        {}
    );
    const [firstTime, lastTime] = days.reduce<[number, number]>(
        ([lo, hi], d) => [Math.min(lo, d.time), Math.max(hi, d.time)],
        [Infinity, -Infinity]
    );
    const summary = {
        arm: args.arm,
        scope: {
            timeframe: '1Day',
            symbols: symbols.length,
            from: isoDate(firstTime),
            to: isoDate(lastTime),
        },
        days: {
            studied: days.length,
            skipped: results.reduce<Record<string, number>>(
                (acc, r) =>
                    Object.entries(r.skipped).reduce(
                        (a, [k, v]) => ({ ...a, [k]: (a[k] ?? 0) + v }),
                        acc
                    ),
                {}
            ),
        },
        levels: { total: rows.length, outcomes },
        labelAgreement: {
            checked: rows.length,
            disagreements,
        },
        overall,
        tables: heldTables(rows, resampling),
        touchRateByDistance: touchRateByDistance(rows),
        score,
        robust: robustRows(tallies),
        structural: structuralSummary(days),
        nonPositive,
        gates,
    };
    writeFileAtomic(
        join(args.out, 'run.json'),
        `${JSON.stringify(
            {
                tool: 'levelEval',
                arm: args.arm,
                coreGitSha: deps.gitSha(),
                dirtyDiffSha256: deps.dirtyDiffSha256(),
                source: {
                    fingerprint: data.fingerprint,
                    symbols: symbols.map(s => s.symbol),
                },
                step: args.step,
                gate: args.gate,
                referencePopulation: isReference,
                constants: { ...C, derived: LEVEL_EVAL_CORE_DERIVED },
            },
            null,
            2
        )}\n`
    );
    writeFileAtomic(
        join(args.out, 'summary.json'),
        `${JSON.stringify(summary, null, 2)}\n`
    );
    deps.log(`wrote ${args.out}`);
    gates.forEach(g =>
        deps.log(
            `${g.id} ${g.pass === null ? 'NOT COMPUTABLE' : g.pass ? 'pass' : 'FAIL'}: ${g.value}`
        )
    );
    if (args.gate === null) {
        deps.log(
            'NOTICE: no --gate given, so no gate decides the exit code (0 whatever the gates above say).'
        );
    }
    const failed = (args.gate ?? []).filter(
        id => gates.find(g => g.id === id)?.pass !== true
    );
    failed.forEach(id => deps.log(`GATE ${id} did not pass`));
    return failed.length > 0 ? 2 : 0;
}

if (require.main === module) {
    try {
        process.exitCode = runLevelEval(
            parseLevelEvalArgs(process.argv.slice(2)),
            defaultDeps
        );
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
