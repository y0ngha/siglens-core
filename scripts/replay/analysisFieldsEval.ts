/**
 * The analysis-fields evaluation (WP-15): deterministic measurement of the three fields a
 * consumer reads as conclusions, on a frozen set or on stored decisions.
 *
 *   npx tsx scripts/replay/analysisFieldsEval.ts --mode trend --set <set> --out <dir>
 *       [--run <run dir> | --labels <decisions.csv>] [--arm <name>] [--gate all|T1,T2,...]
 *   npx tsx scripts/replay/analysisFieldsEval.ts --mode trend --bars <bars dir> --labels <decisions.csv> --out <dir>
 *   npx tsx scripts/replay/analysisFieldsEval.ts --mode skills --set <set> --skills <app>/skills --out <dir>
 *       [--limit N] [--run <free after> --before <free before> [--member-run <member run>]]
 *   npx tsx scripts/replay/analysisFieldsEval.ts --mode plan --set <set> --run <run dir> --out <dir> [--legacy-zone]
 *       [--before <run dir>] [--noise-pp <n>]
 *   npx tsx scripts/replay/analysisFieldsEval.ts --mode gating --set <set> --skills <app>/skills --out <dir>
 *       [--tier free|member] [--limit N] [--baseline <earlier gating out dir>]
 *   npx tsx scripts/replay/analysisFieldsEval.ts --mode output --set <set> --skills <app>/skills --out <dir>
 *       --run <after> --before <before> [--repeat <run>] [--noise-pp <n>]
 *   npx tsx scripts/replay/analysisFieldsEval.ts --mode claims --set <set> --skills <app>/skills --out <dir>
 *       --run <after> --before <before> [--repeat <run>] [--noise-pp <n>] [--lang ko|en]
 *   npx tsx scripts/replay/analysisFieldsEval.ts --mode zone --set <set> --out <dir> --run <run>
 *       [--before <run>] [--restate exact] [--lang ko|en]
 *
 * - `trend`: the shipped trend rule (EMA20 move in ATR(14)) and two reference rules
 *   recomputed from OHLC for every day from bar 300 (label distribution, day-to-day change,
 *   hard flips, prior-10-day sign match), their agreement with stored labels (a run's
 *   `trend`, or the `trend` column of a daily-AI `decisions.csv`) per regime and market, the
 *   plumbing check of a run's stored `trend` against the rule, and the summary-words check.
 * - `skills`: renders every case for the free and the member tier through `runAnalysis`
 *   (no network, no model call) and reads which technical skills reach each prompt.
 * - `plan`: for a run, the plan position, reason, stop basis and distances, the verdict by
 *   position, an independent recomputation of the plan state and verdict, the stop-band and
 *   target-room checks, the volatility grade against the next 10 sessions and the outcomes
 *   by position; with `--before`, the paired comparison of two runs.
 *
 * - `gating` (WP-16): renders every case (no model call) and reads which pattern and candle
 *   guides reach the prompt against the chart patterns and candles the same prompt prints
 *   (D1 to D4), the prompt's indicator-card instructions (D9) and, when the assembled prompt
 *   carries computed cards, the cards against the printed lines and OHLC (D5, D6, D8).
 * - `output` (WP-16): per-case pairs of an after and a before run (and a repeat run, the noise
 *   floor): output tokens, latency, what the model wrote per field, failures, levels, plan
 *   position, strategies and patterns, with bootstrap 95% intervals (O1 to V5, D7).
 *
 * - `claims` (WP-18): positive reliability claims on pattern and candle cards and strong-level
 *   wording in an after run against a before run (C1, C2), with the WP-18 form of F1, F2, L1,
 *   O1 and V1.
 * - `zone` (WP-18): where the close sits against the entry zone, the position under the 1%
 *   tolerance and under exact edges, the pullback-cue rate of the prose and the stratified
 *   sample for the manual read (Z1, Z2, N2, N3; `--restate exact` re-derives an old run).
 *
 * Every definition is recomputed here (`analysisFieldsEvalTypes.ts` holds the constants);
 * the stored field under test is only ever the thing compared with. Gates (WP-15 §7.3) are
 * always computed; `--gate` selects the ones that decide the exit code (2 when a selected
 * gate fails or cannot be computed). Errors (a missing case, a set hash mismatch, a run from
 * another set, an empty measurement, an output path inside the repository) exit 1.
 *
 * Writes `run.json`, `summary.json` and `rows.jsonl`. No network, no model call.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from '../ab-harness/cliArgs';
import {
    dayOf,
    locateRows,
    summarizeTrend,
    trendGates,
    wilderAtrSeries,
} from './analysisFieldsEvalCompute';
import {
    comparePlanRuns,
    forwardOf,
    invariantCounts,
    measurePlan,
    outcomesByPosition,
    planGates,
    runCallStats,
    summarizePlanRun,
    type PlanCase,
    type PlanMeasure,
    type StoredPlanState,
} from './analysisFieldsEvalPlan';
import {
    CARD_TREND_SKILLS,
    CYCLE_STRATEGY_SKILLS,
} from './analysisFieldsEvalCards';
import { readSkillCatalog } from './analysisFieldsEvalCatalog';
import {
    gatingGates,
    summarizeGating,
    type BaselineRow,
    type CardContext,
} from './analysisFieldsEvalGating';
import {
    compareArms,
    outputGates,
    readArmCase,
    type ArmCase,
    type PatternSkill,
} from './analysisFieldsEvalOutput';
import {
    CLAIM_LANGUAGES,
    claimsGates,
    compareClaims,
    readClaimCase,
    type ClaimCase,
    type ClaimLanguage,
} from './analysisFieldsEvalClaims';
import {
    ZONE_LANGUAGES,
    distanceAboveTopAtr,
    exactPosition,
    geometryOf,
    tolerancePositionOf,
    cueComparison,
    targetRoomComparison,
    zoneGates,
    zoneReport,
    type ZoneCase,
    type ZoneLanguage,
} from './analysisFieldsEvalZone';
import { renderWithCore, type RenderSkills } from './analysisFieldsEvalRender';
import {
    compareLevelOverlap,
    levelOverlapPerCase,
    skillRows,
    skillsGates,
    SKILL_TIERS,
    type SkillTier,
    type SkillsGateInput,
    summarizeSkills,
    type LevelCase,
} from './analysisFieldsEvalSkills';
import {
    FIELDS_EVAL_CONSTANTS as C,
    FIELDS_EVAL_CORE_DERIVED,
    EVAL_MODES,
    TREND_LABELS,
    type EvalMode,
    type GateResult,
    type StoredTrendRow,
    type SymbolBars,
    type TrendLabel,
} from './analysisFieldsEvalTypes';
import { loadBarsDir } from './engineEval';
import {
    REPO_ROOT,
    assertOutsideRepo,
    gitOutput,
    readJson,
    readLabelRows,
    sha256Hex,
    writeFileAtomic,
} from './fsUtil';
import { marketOfSymbol } from './markets';
import { bucketOf } from './reportCompute';
import { selectRunCases } from './run';
import { barsFingerprint, verifySetHashes } from './setIntegrity';
import type {
    CaseResultFile,
    LabelRow,
    ReplayCase,
    ReplayManifest,
    RunMeta,
    StoredBars,
    Verdict,
} from './types';
import { buildOutcomeWindow } from '@/domain/outcomes/buildOutcomeWindow';
import { labelAnalysisOutcome } from '@/domain/outcomes/labelAnalysisOutcome';
import type { Bar } from '@/domain/types';

// ─── Arguments ────────────────────────────────────────────────────────────────

export interface FieldsEvalArgs {
    mode: EvalMode;
    set: string | null;
    bars: string | null;
    out: string;
    arm: string;
    run: string | null;
    before: string | null;
    memberRun: string | null;
    labels: string | null;
    skills: string | null;
    limit: number | null;
    /** Gate ids that decide the exit code; `null` selects none. */
    gate: readonly string[] | 'all' | null;
    allowSkippedCases: boolean;
    /** Noise floor in percentage points, added to the side-effect margin of P6 and S5. */
    noisePp: number;
    /** `gating`: render this tier only. */
    tier: SkillTier | null;
    /** `gating`: an earlier gating output directory whose hashes D3 compares with. */
    baseline: string | null;
    /** `output`: a second run of the before arm, the noise floor. */
    repeat: string | null;
    /** `claims` and `zone`: the language of the wording lists. */
    lang: ClaimLanguage & ZoneLanguage;
    /** `zone`: read the positions with the exact edges instead of the stored ones. */
    restate: boolean;
    /**
     * `plan`: the run predates the exact-edge zone rule (WP-18), so its stored `planState` is
     * recomputed with WP-15's 1% band; without the flag P1 compares it with exact edges and a
     * legacy run fails by design.
     */
    legacyZone: boolean;
}

const GATE_IDS: Record<EvalMode, readonly string[]> = {
    trend: ['T1', 'T2', 'T3', 'T4', 'T5'],
    plan: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'],
    skills: ['S1', 'S2', 'S3', 'S5', 'S6'],
    gating: ['D1', 'D2', 'D3', 'D5', 'D6', 'D8', 'D9'],
    output: [
        'D7',
        'O1',
        'O2',
        'F1',
        'F2',
        'L1',
        'L2',
        'V1',
        'V2',
        'V3',
        'V4',
        'V5',
    ],
    claims: ['C1', 'C2', 'F1', 'F2', 'L1', 'O1', 'V1'],
    zone: ['Z1', 'Z2', 'N2', 'N3'],
};

function parseMode(raw: string | undefined): EvalMode {
    const mode = EVAL_MODES.find(candidate => candidate === raw);
    if (mode === undefined) {
        throw new Error(`--mode must be one of ${EVAL_MODES.join(', ')}`);
    }
    return mode;
}

function parseGate(
    raw: string | undefined,
    mode: EvalMode
): readonly string[] | 'all' | null {
    if (raw === undefined) return null;
    if (raw === 'true' || raw === 'all') return 'all';
    const ids = raw.split(',');
    const unknown = ids.filter(id => !GATE_IDS[mode].includes(id));
    if (unknown.length > 0) {
        throw new Error(
            `--gate ids not in mode ${mode}: ${unknown.join(', ')} (known: ${GATE_IDS[mode].join(', ')})`
        );
    }
    return ids;
}

function parseTier(raw: string | undefined): SkillTier | null {
    if (raw === undefined) return null;
    const tier = SKILL_TIERS.find(t => t === raw);
    if (tier === undefined) throw new Error('--tier must be free or member');
    return tier;
}

function parseLang(raw: string | undefined): ClaimLanguage & ZoneLanguage {
    if (raw === undefined) return 'ko';
    const known = CLAIM_LANGUAGES.find(l => l === raw);
    if (known === undefined || !ZONE_LANGUAGES.includes(known)) {
        throw new Error(`--lang must be ${CLAIM_LANGUAGES.join(' or ')}`);
    }
    return known;
}

function parseRestate(raw: string | undefined): boolean {
    if (raw === undefined) return false;
    if (raw === 'exact') return true;
    throw new Error('--restate must be "exact"');
}

function parseCount(raw: string | undefined, flag: string): number | null {
    if (raw === undefined) return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`--${flag} must be a positive integer (got "${raw}")`);
    }
    return value;
}

export function parseFieldsEvalArgs(argv: readonly string[]): FieldsEvalArgs {
    const raw = parseArgs(argv);
    const mode = parseMode(raw.mode);
    if (!raw.out) throw new Error('--out is required');
    const args: FieldsEvalArgs = {
        mode,
        set: raw.set === undefined ? null : resolve(raw.set),
        bars: raw.bars === undefined ? null : resolve(raw.bars),
        out: resolve(raw.out),
        arm: raw.arm ?? 'unnamed',
        run: raw.run === undefined ? null : resolve(raw.run),
        before: raw.before === undefined ? null : resolve(raw.before),
        memberRun:
            raw['member-run'] === undefined ? null : resolve(raw['member-run']),
        labels: raw.labels === undefined ? null : resolve(raw.labels),
        skills: raw.skills === undefined ? null : resolve(raw.skills),
        limit: parseCount(raw.limit, 'limit'),
        gate: parseGate(raw.gate, mode),
        allowSkippedCases: raw['allow-skipped-cases'] === 'true',
        noisePp: raw['noise-pp'] === undefined ? 0 : Number(raw['noise-pp']),
        tier: parseTier(raw.tier),
        baseline: raw.baseline === undefined ? null : resolve(raw.baseline),
        repeat: raw.repeat === undefined ? null : resolve(raw.repeat),
        lang: parseLang(raw.lang),
        restate: parseRestate(raw.restate),
        legacyZone: raw['legacy-zone'] === 'true',
    };
    if (!Number.isFinite(args.noisePp) || args.noisePp < 0) {
        throw new Error('--noise-pp must be a non-negative number');
    }
    validateCombination(args);
    return args;
}

function validateCombination(args: FieldsEvalArgs): void {
    const { mode } = args;
    if ((args.tier !== null || args.baseline !== null) && mode !== 'gating') {
        throw new Error(`${mode}: --tier and --baseline apply to gating only`);
    }
    if (args.repeat !== null && mode !== 'output' && mode !== 'claims') {
        throw new Error(`${mode}: --repeat applies to output and claims only`);
    }
    if (args.restate && mode !== 'zone') {
        throw new Error(`${mode}: --restate applies to zone only`);
    }
    if (args.legacyZone && mode !== 'plan') {
        throw new Error(`${mode}: --legacy-zone applies to plan only`);
    }
    if (mode === 'trend') {
        if ((args.set === null) === (args.bars === null)) {
            throw new Error(
                'trend: exactly one of --set and --bars is required'
            );
        }
        if (args.run !== null && args.labels !== null) {
            throw new Error('trend: --run and --labels are alternatives');
        }
        if (args.run !== null && args.set === null) {
            throw new Error(
                'trend: --run needs --set (the run is of that set)'
            );
        }
        if (args.before !== null || args.memberRun !== null) {
            throw new Error('trend: --before and --member-run do not apply');
        }
        return;
    }
    if (args.set === null || args.bars !== null || args.labels !== null) {
        throw new Error(
            `${mode}: --set is required; --bars and --labels do not apply`
        );
    }
    if (mode === 'gating') {
        if (args.skills === null)
            throw new Error('gating: --skills is required');
        if (
            args.run !== null ||
            args.before !== null ||
            args.memberRun !== null
        ) {
            throw new Error(
                'gating: --run, --before and --member-run do not apply'
            );
        }
        return;
    }
    if (mode === 'output' || mode === 'claims') {
        if (args.run === null || args.before === null || args.skills === null) {
            throw new Error(
                `${mode}: --run, --before and --skills are required`
            );
        }
        if (args.memberRun !== null || args.limit !== null) {
            throw new Error(`${mode}: --member-run and --limit do not apply`);
        }
        return;
    }
    if (mode === 'zone') {
        if (args.run === null) throw new Error('zone: --run is required');
        if (
            args.memberRun !== null ||
            args.skills !== null ||
            args.limit !== null
        ) {
            throw new Error(
                'zone: --member-run, --skills and --limit do not apply'
            );
        }
        return;
    }
    if (mode === 'plan') {
        if (args.run === null) throw new Error('plan: --run is required');
        if (args.memberRun !== null || args.skills !== null) {
            throw new Error('plan: --member-run and --skills do not apply');
        }
        return;
    }
    if (args.skills === null) throw new Error('skills: --skills is required');
    if ((args.run === null) !== (args.before === null)) {
        throw new Error('skills: --run and --before are given together');
    }
    if (args.memberRun !== null && args.run === null) {
        throw new Error('skills: --member-run needs --run and --before');
    }
}

// ─── Loading ──────────────────────────────────────────────────────────────────

interface SetData {
    manifest: ReplayManifest;
    fingerprint: string;
    storedOf: Map<string, StoredBars>;
    symbols: SymbolBars[];
}

/** The set with its hashes verified; every symbol's bars. */
export function loadSetData(setDir: string): SetData {
    const manifest = readJson<ReplayManifest>(join(setDir, 'manifest.json'));
    verifySetHashes(setDir, manifest);
    const entries = Object.entries(manifest.bars).toSorted(([a], [b]) =>
        a.localeCompare(b, 'en')
    );
    const storedOf = new Map(
        entries.map(([symbol, entry]) => [
            symbol,
            readJson<StoredBars>(join(setDir, entry.file)),
        ])
    );
    return {
        manifest,
        fingerprint: barsFingerprint(manifest),
        storedOf,
        symbols: entries.map(([symbol, entry]) => ({
            symbol,
            market: entry.market,
            bars: storedOf.get(symbol)?.bars ?? [],
        })),
    };
}

interface RunData {
    dir: string;
    meta: RunMeta;
    results: readonly CaseResultFile[];
    labels: readonly LabelRow[] | null;
}

/**
 * A run of the set: its `run.json` must name this set's bars, every result must be a case of
 * the set, and there must be at least one result. Labels are read when `labels.jsonl` exists.
 */
export function loadRunData(runDir: string, set: SetData): RunData {
    const meta = readJson<RunMeta>(join(runDir, 'run.json'));
    if (meta.setBarsSha256 !== set.fingerprint) {
        throw new Error(
            `${runDir} was made on different bars than the set (run.json setBarsSha256 does not match)`
        );
    }
    const names = readdirSync(join(runDir, 'results'))
        .filter(name => name.endsWith('.json'))
        .toSorted();
    if (names.length === 0) throw new Error(`${runDir} has no results`);
    const caseIds = new Set(set.manifest.cases.map(c => c.caseId));
    const results = names.map(name =>
        readJson<CaseResultFile>(join(runDir, 'results', name))
    );
    const unknown = results.filter(r => !caseIds.has(r.caseId));
    if (unknown.length > 0) {
        throw new Error(
            `${runDir}: results of cases not in the set: ${unknown
                .slice(0, 5)
                .map(r => r.caseId)
                .join(', ')}`
        );
    }
    // A run that covers fewer cases than it was started for would measure a different
    // sample under the same name.
    const have = new Set(results.map(r => `${r.caseId}#${r.repeat}`));
    const missing = selectRunCases(set.manifest, {
        subset: meta.subset,
        limit: meta.limit,
    }).flatMap(c =>
        Array.from(
            { length: meta.repeat },
            (_, k) => `${c.caseId}#${k + 1}`
        ).filter(key => !have.has(key))
    );
    if (missing.length > 0) {
        throw new Error(
            `${runDir} is incomplete: ${missing.length} result(s) missing for its subset, limit and repeat (first: ${missing[0]})`
        );
    }
    return {
        dir: runDir,
        meta,
        results,
        labels: readLabelsIfAny(runDir),
    };
}

/** A filesystem error saying the path does not exist. */
function isMissingFile(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function readLabelsIfAny(runDir: string): readonly LabelRow[] | null {
    try {
        return readLabelRows(runDir);
    } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
    }
}

/** What two runs compared case by case must share: the data, the model and the sample. */
const PAIRED_RUN_FIELDS = [
    'setId',
    'setBarsSha256',
    'tier',
    'model',
    'subset',
    'limit',
    'repeat',
] as const satisfies readonly (keyof RunMeta)[];

/** Throws when two runs differ in a field that makes them incomparable. */
export function assertComparableRuns(
    a: RunData,
    b: RunData,
    fields: readonly (keyof RunMeta)[]
): void {
    const differing = fields.filter(field => a.meta[field] !== b.meta[field]);
    if (differing.length > 0) {
        throw new Error(
            `${a.dir} and ${b.dir} are not comparable: ${differing.join(', ')} differ`
        );
    }
}

// ─── Reading stored results ───────────────────────────────────────────────────

type Rec = Record<string, unknown>;

const asRec = (value: unknown): Rec | null =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
        ? // A shallow copy: the narrowed `object` has no index signature, and a copy gives one.
          Object.fromEntries(Object.entries(value))
        : null;

const asNum = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

const asNums = (value: unknown): number[] =>
    Array.isArray(value) ? value.flatMap(v => asNum(v) ?? []) : [];

const asTrend = (value: unknown): TrendLabel | null =>
    TREND_LABELS.find(label => label === value) ?? null;

const VERDICTS_STORED: readonly Verdict[] = ['enter', 'wait', 'avoid'];

/** The index of a result's analysed bar: its `dataAsOf.barTime`, else its `asOf`; throws when absent. */
function barIndexOf(result: CaseResultFile, bars: readonly Bar[]): number {
    const stamped = asNum(
        asRec(asRec(result.unfilteredResult)?.dataAsOf)?.barTime
    );
    const day = stamped === null ? result.asOf : dayOf(stamped);
    const index = bars.findIndex(bar => dayOf(bar.time) === day);
    if (index < 0) {
        throw new Error(`${result.caseId}: no bar on ${day} in the set's bars`);
    }
    return index;
}

function trendRowsOfRun(
    run: RunData,
    set: SetData
): {
    rows: (StoredTrendRow & { caseId: string })[];
    failed: number;
    repeatsIgnored: number;
    /** First-repeat results of the run, with or without a trend. */
    total: number;
} {
    const byId = new Map(set.manifest.cases.map(c => [c.caseId, c]));
    const firsts = run.results.filter(r => r.repeat === 1);
    const rows = firsts.flatMap(result => {
        const body = asRec(result.unfilteredResult);
        const stored = asTrend(body?.trend);
        const bars = set.storedOf.get(result.symbol)?.bars;
        const replayCase = byId.get(result.caseId);
        if (stored === null || bars === undefined || replayCase === undefined) {
            return [];
        }
        const index = barIndexOf(result, bars);
        return [
            {
                caseId: result.caseId,
                symbol: result.symbol,
                market: marketOfSymbol(result.symbol),
                date: dayOf(bars[index].time),
                stored,
                regime: replayCase.regime,
                trendBasisSlope: asNum(asRec(body?.trendBasis)?.slopeAtr),
                summary:
                    typeof body?.summary === 'string' ? body.summary : null,
            },
        ];
    });
    return {
        rows,
        failed: firsts.length - rows.length,
        total: firsts.length,
        repeatsIgnored: run.results.length - firsts.length,
    };
}

/** Splits one CSV line, honouring double quotes. */
export function splitCsvLine(line: string): string[] {
    const cells: string[] = [];
    // CP-5: one pass whose quote state carries across characters.
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
            if (ch === '"' && line[i + 1] === '"') {
                cell += '"';
                i++;
            } else if (ch === '"') quoted = false;
            else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') {
            cells.push(cell);
            cell = '';
        } else cell += ch;
    }
    cells.push(cell);
    return cells;
}

/** `decisions.csv` rows with a trend: `date`, `ticker`, `kind` and `trend` columns are read. */
export function trendRowsOfCsv(
    text: string
): (StoredTrendRow & { caseId: string })[] {
    const [header, ...lines] = text
        .split('\n')
        .filter(line => line.trim() !== '');
    if (header === undefined) throw new Error('the labels file is empty');
    const columns = splitCsvLine(header);
    const at = (name: string): number => {
        const i = columns.indexOf(name);
        if (i < 0) throw new Error(`the labels file has no "${name}" column`);
        return i;
    };
    const [iDate, iTicker, iKind, iTrend] = [
        at('date'),
        at('ticker'),
        at('kind'),
        at('trend'),
    ];
    return lines.flatMap(line => {
        const cells = splitCsvLine(line);
        const stored = asTrend(cells[iTrend]);
        if (stored === null) return [];
        return [
            {
                caseId: `${cells[iTicker]}|${cells[iDate]}|${cells[iKind]}`,
                symbol: cells[iTicker],
                market: marketOfSymbol(cells[iTicker]),
                date: cells[iDate],
                stored,
                regime: null,
                trendBasisSlope: null,
                summary: null,
            },
        ];
    });
}

// ─── Modes ────────────────────────────────────────────────────────────────────

interface ModeOutput {
    inputs: Record<string, unknown>;
    summary: unknown;
    gates: readonly GateResult[];
    rows: readonly unknown[];
    /** Rows that could not be located on bars; they fail a gated run unless allowed. */
    skipped: number;
}

function trendMode(args: FieldsEvalArgs, deps: FieldsEvalDeps): ModeOutput {
    const set = args.set === null ? null : loadSetData(args.set);
    const loaded = set === null ? loadBarsDir(args.bars ?? '') : null;
    const symbols: SymbolBars[] =
        set !== null
            ? set.symbols
            : (loaded?.symbols ?? []).map(s => ({
                  symbol: s.symbol,
                  market: s.market,
                  bars: s.bars,
              }));
    if (symbols.length === 0) throw new Error('no symbols to evaluate');
    const run =
        set !== null && args.run !== null ? loadRunData(args.run, set) : null;
    const fromRun =
        run !== null && set !== null ? trendRowsOfRun(run, set) : null;
    const labelsText =
        args.labels === null ? null : readFileSync(args.labels, 'utf-8');
    const fromCsv = labelsText === null ? null : trendRowsOfCsv(labelsText);
    const rows = fromRun?.rows ?? fromCsv;
    const unknownSymbols = [...new Set((rows ?? []).map(r => r.symbol))].filter(
        symbol => !symbols.some(s => s.symbol === symbol)
    );
    if (unknownSymbols.length > 0) {
        throw new Error(
            `labels for symbols without bars: ${unknownSymbols.join(', ')}`
        );
    }
    if (rows !== null && rows.length === 0) {
        throw new Error('no stored trend label to compare with');
    }
    const located = rows === null ? null : locateRows(symbols, rows);
    const summary = summarizeTrend({
        symbols,
        located: located?.located ?? null,
        fromRun: run !== null,
        resultsTotal: fromRun?.total,
        lookbackDays: FIELDS_EVAL_CORE_DERIVED.lookbackDays,
    });
    deps.log(
        `trend: ${symbols.length} symbols, ${summary.allDays.rules.R4.n} measured days${located === null ? '' : `, ${located.located.length} stored labels`}`
    );
    return {
        inputs: {
            source: set !== null ? 'set' : 'bars',
            fingerprint: set?.fingerprint ?? loaded?.fingerprint ?? null,
            run: run === null ? null : { dir: run.dir, ...run.meta },
            labelsFile: args.labels,
            labelsSha256: labelsText === null ? null : sha256Hex(labelsText),
            failedResults: fromRun?.failed ?? null,
            repeatsIgnored: fromRun?.repeatsIgnored ?? null,
        },
        summary: { ...summary, skippedRows: located?.missing.length ?? 0 },
        gates: trendGates(summary, { labelsFile: args.labels !== null }),
        // One line per located label; with no labels, one per symbol measured.
        rows:
            located === null
                ? symbols.map(s => ({ symbol: s.symbol, bars: s.bars.length }))
                : located.located.map(l => ({
                      caseId: l.row.caseId,
                      symbol: l.row.symbol,
                      date: l.row.date,
                      stored: l.row.stored,
                  })),
        skipped: located?.missing.length ?? 0,
    };
}

interface BuiltPlan {
    result: CaseResultFile;
    plan: PlanCase;
    bars: readonly Bar[];
    index: number;
}

function planCaseOf(
    result: CaseResultFile,
    set: SetData,
    atrOf: (symbol: string) => readonly (number | null)[]
): BuiltPlan | null {
    const body = asRec(result.unfilteredResult);
    const ar = asRec(body?.actionRecommendation);
    const bars = set.storedOf.get(result.symbol)?.bars;
    const replayCase = set.manifest.cases.find(c => c.caseId === result.caseId);
    if (body === null || ar === null || bars === undefined) return null;
    const index = barIndexOf(result, bars);
    const atr = atrOf(result.symbol)[index];
    const reconciled = asRec(ar.reconciledLevels);
    const rejected = reconciled?.stopLossRejected === true;
    const stop = rejected
        ? null
        : (asNum(reconciled?.stopLoss) ?? asNum(ar.stopLoss));
    const modelStop = asNum(ar.stopLoss);
    const stateRec = asRec(ar.planState);
    const storedState: StoredPlanState | null =
        stateRec === null || typeof stateRec.position !== 'string'
            ? null
            : {
                  position: stateRec.position,
                  reason:
                      typeof stateRec.reason === 'string'
                          ? stateRec.reason
                          : null,
                  atr: asNum(stateRec.atr),
                  stopDistanceAtr: asNum(stateRec.stopDistanceAtr),
                  distanceAtr: asNum(stateRec.distanceAtr),
                  stopBasis:
                      typeof stateRec.stopBasis === 'string'
                          ? stateRec.stopBasis
                          : null,
              };
    return {
        result,
        bars,
        index,
        plan: {
            caseId: result.caseId,
            symbol: result.symbol,
            market: marketOfSymbol(result.symbol),
            regime: replayCase?.regime ?? null,
            repeat: result.repeat,
            verdict:
                VERDICTS_STORED.find(v => v === ar.entryRecommendation) ??
                'none',
            riskLevel:
                typeof body.riskLevel === 'string' ? body.riskLevel : null,
            close: bars[index].close,
            atr,
            entryPrices: asNums(ar.entryPrices),
            stop,
            modelStop,
            targets: asNums(
                reconciled?.takeProfitPrices ?? ar.takeProfitPrices
            ),
            storedState,
            promptDynamic: result.promptDynamic,
            rrAtEntry: asNum(asRec(ar.planCheck)?.riskRewardAtEntry),
            forward: forwardOf(bars, index, atr),
        },
    };
}

interface MeasuredRun {
    run: RunData;
    measures: readonly PlanMeasure[];
    planCases: ReadonlyMap<string, BuiltPlan>;
    noPlan: number;
    closeMismatch: number;
}

function measureRun(
    run: RunData,
    set: SetData,
    tolerance: number = 0
): MeasuredRun {
    const atrCache = new Map<string, readonly (number | null)[]>();
    const atrOf = (symbol: string): readonly (number | null)[] => {
        const cached = atrCache.get(symbol);
        if (cached !== undefined) return cached;
        const series = wilderAtrSeries(
            set.storedOf.get(symbol)?.bars ?? [],
            C.atrPeriod
        );
        atrCache.set(symbol, series);
        return series;
    };
    const firsts = run.results.filter(r => r.repeat === 1);
    const built = firsts.flatMap(result => {
        const c = planCaseOf(result, set, atrOf);
        return c === null ? [] : [c];
    });
    return {
        run,
        measures: built.map(b => measurePlan(b.plan, tolerance)),
        planCases: new Map(
            built.map(b => [`${b.plan.caseId}#${b.plan.repeat}`, b])
        ),
        noPlan: firsts.length - built.length,
        closeMismatch: built.filter(b => {
            const stamped = asNum(
                asRec(asRec(b.result.unfilteredResult)?.dataAsOf)?.close
            );
            return stamped !== null && stamped !== b.plan.close;
        }).length,
    };
}

/** The label of a plan measured as if the verdict had been `wait` (used for `no_setup`). */
function relabelAsWait(
    row: LabelRow,
    bars: readonly Bar[],
    dataAsOfClose: number | null
): LabelRow {
    if (row.subject === null || row.subject.plan === null) return row;
    const asOfTime = Date.parse(`${row.asOf}T00:00:00Z`) / 1000;
    const anchor = bars.find(bar => bar.time === asOfTime);
    const window = buildOutcomeWindow(bars, {
        barTime: asOfTime,
        closeAtAnalysis:
            dataAsOfClose !== null && dataAsOfClose > 0
                ? dataAsOfClose
                : (anchor?.close ?? Number.NaN),
        closedAtAnalysis: true,
    });
    if (window.status !== 'ok') return row;
    return {
        ...row,
        labels: labelAnalysisOutcome(
            {
                ...row.subject,
                plan: { ...row.subject.plan, recommendation: 'wait' },
            },
            window.window
        ),
    };
}

function p7Sample(
    measures: readonly PlanMeasure[]
): Record<string, readonly string[]> {
    const positions = [...new Set(measures.map(m => m.position))].toSorted();
    return Object.fromEntries(
        positions.map(position => [
            position,
            measures
                .filter(m => m.position === position)
                .map(m => ({
                    id: m.caseId,
                    key: sha256Hex(`${m.caseId}|${position}`),
                }))
                .toSorted((a, b) =>
                    a.key < b.key ? -1 : a.key > b.key ? 1 : 0
                )
                .slice(0, C.p7SamplePerPosition)
                .map(m => m.id),
        ])
    );
}

function planMode(args: FieldsEvalArgs, deps: FieldsEvalDeps): ModeOutput {
    const set = loadSetData(args.set ?? '');
    // A run made before the exact-edge rule shipped planState with the 1% band: compare it with
    // that rule, or P1 fails on every plan the band called in_zone.
    const tolerance = args.legacyZone ? C.zoneTolerance : 0;
    const after = measureRun(loadRunData(args.run ?? '', set), set, tolerance);
    const beforeRun =
        args.before === null ? null : loadRunData(args.before, set);
    if (beforeRun !== null) {
        assertComparableRuns(after.run, beforeRun, PAIRED_RUN_FIELDS);
    }
    const before =
        beforeRun === null ? null : measureRun(beforeRun, set, tolerance);
    const labels = after.run.labels;
    const headlineKeys =
        labels === null
            ? null
            : new Set(
                  labels
                      .filter(r => r.repeat === 1 && bucketOf(r) === 'headline')
                      .map(r => `${r.caseId}#${r.repeat}`)
              );
    const summary = summarizePlanRun(after.measures, headlineKeys);
    // The stop, state and basis checks are about every plan, not the rows a report counts.
    const summaryAll =
        headlineKeys === null
            ? summary
            : summarizePlanRun(after.measures, null);
    const positionOf = new Map(
        after.measures.map(m => [`${m.caseId}#${m.repeat}`, m.position])
    );
    const entries = (labels ?? []).flatMap(row => {
        const key = `${row.caseId}#${row.repeat}`;
        const position = positionOf.get(key);
        const built = after.planCases.get(key);
        if (
            position === undefined ||
            row.repeat !== 1 ||
            bucketOf(row) !== 'headline' ||
            built === undefined
        ) {
            return [];
        }
        const dataAsOfClose = asNum(
            asRec(asRec(built.result.unfilteredResult)?.dataAsOf)?.close
        );
        return [
            {
                position,
                row:
                    position === 'no_setup'
                        ? relabelAsWait(row, built.bars, dataAsOfClose)
                        : row,
            },
        ];
    });
    const afterStats = runCallStats(after.run.results, labels);
    const beforeStats =
        before === null
            ? null
            : runCallStats(before.run.results, before.run.labels);
    const paired =
        before === null
            ? null
            : comparePlanRuns({
                  after: after.measures,
                  before: before.measures,
                  afterLabels: labels ?? [],
                  beforeLabels: before.run.labels ?? [],
              });
    const gates = planGates({
        summary,
        summaryAll,
        paired,
        after: afterStats,
        before: beforeStats,
        invariantsAfter: labels === null ? null : invariantCounts(labels),
        invariantsBefore:
            before?.run.labels == null
                ? null
                : invariantCounts(before.run.labels),
        noiseFloor: args.noisePp / 100,
    });
    deps.log(
        `plan: ${after.measures.length} plans (${summary.basis} basis ${summary.n}), ${after.noPlan} results without a plan`
    );
    return {
        inputs: {
            fingerprint: set.fingerprint,
            run: { dir: after.run.dir, ...after.run.meta },
            before:
                beforeRun === null
                    ? null
                    : { dir: beforeRun.dir, ...beforeRun.meta },
            labels:
                labels === null
                    ? 'absent: distributions use every result, no outcomes'
                    : 'labels.jsonl',
            zoneRule: args.legacyZone
                ? 'legacy: 1% band (run predates the exact-edge rule)'
                : 'exact edges',
            resultsWithoutPlan: after.noPlan,
            closeMismatch: after.closeMismatch,
            noisePp: args.noisePp,
        },
        summary: {
            plan: summary,
            /** The same distributions over every result with a plan (labels or not). */
            planAllResults: headlineKeys === null ? null : summaryAll,
            calls: afterStats,
            beforeCalls: beforeStats,
            outcomesByPosition:
                labels === null ? null : outcomesByPosition(entries),
            paired,
            p7Sample: p7Sample(after.measures),
        },
        gates,
        rows: after.measures,
        skipped: 0,
    };
}

function levelCasesOf(run: RunData, set: SetData): readonly LevelCase[] {
    const atrCache = new Map<string, readonly (number | null)[]>();
    return run.results
        .filter(r => r.repeat === 1)
        .flatMap(result => {
            const bars = set.storedOf.get(result.symbol)?.bars;
            const levels = asRec(asRec(result.unfilteredResult)?.keyLevels);
            if (bars === undefined || levels === null) return [];
            const atrs =
                atrCache.get(result.symbol) ??
                wilderAtrSeries(bars, C.atrPeriod);
            atrCache.set(result.symbol, atrs);
            const prices = ['support', 'resistance'].flatMap(side =>
                Array.isArray(levels[side])
                    ? levels[side].flatMap(
                          (l: unknown) => asNum(asRec(l)?.price) ?? []
                      )
                    : []
            );
            return [
                {
                    caseId: result.caseId,
                    repeat: result.repeat,
                    atr: atrs[barIndexOf(result, bars)],
                    levels: prices,
                },
            ];
        });
}

/**
 * The live inputs of S5 and S6: the call statistics of the free run and its baseline, and
 * the level overlap with a member run when one is given. `null` without a run pair. Refuses
 * runs that cannot be compared, a run that is not free, and a member run that is free.
 */
export function liveSkillsInput(
    args: Pick<FieldsEvalArgs, 'run' | 'before' | 'memberRun' | 'noisePp'>,
    set: SetData
): SkillsGateInput['live'] {
    if (args.run === null || args.before === null) return null;
    const afterRun = loadRunData(args.run, set);
    const beforeRun = loadRunData(args.before, set);
    assertComparableRuns(afterRun, beforeRun, PAIRED_RUN_FIELDS);
    const memberRun =
        args.memberRun === null ? null : loadRunData(args.memberRun, set);
    if (afterRun.meta.tier !== 'free') {
        throw new Error(
            `${afterRun.dir} is a ${afterRun.meta.tier} run; S5 and S6 are about free`
        );
    }
    if (memberRun !== null) {
        assertComparableRuns(afterRun, memberRun, [
            'setId',
            'setBarsSha256',
            'model',
        ]);
        if (memberRun.meta.tier === 'free') {
            throw new Error(`${memberRun.dir} must be a member run`);
        }
    }
    const overlap =
        memberRun === null
            ? null
            : compareLevelOverlap(
                  levelOverlapPerCase(
                      levelCasesOf(afterRun, set),
                      levelCasesOf(memberRun, set)
                  ),
                  levelOverlapPerCase(
                      levelCasesOf(beforeRun, set),
                      levelCasesOf(memberRun, set)
                  )
              );
    return {
        after: runCallStats(afterRun.results, afterRun.labels),
        before: runCallStats(beforeRun.results, beforeRun.labels),
        overlap,
        noiseFloor: args.noisePp / 100,
    };
}

async function skillsMode(
    args: FieldsEvalArgs,
    deps: FieldsEvalDeps
): Promise<ModeOutput> {
    const set = loadSetData(args.set ?? '');
    const cases: readonly ReplayCase[] = selectRunCases(set.manifest, {
        subset: null,
        limit: args.limit,
    });
    if (cases.length === 0) throw new Error('no case to render');
    deps.log(`skills: rendering ${cases.length} cases for free and member`);
    const rendered = await deps.render({
        skillsDir: args.skills ?? '',
        cases,
        storedOf: symbol => {
            const stored = set.storedOf.get(symbol);
            if (stored === undefined) throw new Error(`no bars for ${symbol}`);
            return stored;
        },
        log: deps.log,
    });
    const summary = summarizeSkills(rendered.catalog, rendered.samples);
    const live = liveSkillsInput(args, set);
    return {
        inputs: {
            fingerprint: set.fingerprint,
            skillsDir: args.skills,
            limit: args.limit,
            live: live !== null,
        },
        summary: { skills: summary, live },
        gates: skillsGates({ summary, live }),
        rows: skillRows(rendered.catalog, rendered.samples),
        skipped: 0,
    };
}

const SECONDS_PER_DAY = 86_400;

/** The closes of the bars a replay prompt saw at `asOf`: the lookback window up to that day. */
function promptWindowCloses(
    bars: readonly Bar[],
    asOf: string
): readonly number[] {
    const last = Date.parse(`${asOf}T00:00:00Z`) / 1000;
    const first =
        last - (FIELDS_EVAL_CORE_DERIVED.lookbackDays - 1) * SECONDS_PER_DAY;
    return bars
        .filter(bar => bar.time >= first && bar.time <= last)
        .map(bar => bar.close);
}

/** The hashes of an earlier gating output (`rows.jsonl`), after checking it is a gating run of this set. */
export function readBaselineRows(
    dir: string,
    fingerprint: string
): readonly BaselineRow[] {
    const run = readJson<{
        tool?: unknown;
        mode?: unknown;
        inputs?: { fingerprint?: unknown };
    }>(join(dir, 'run.json'));
    if (run.tool !== 'analysisFieldsEval' || run.mode !== 'gating') {
        throw new Error(`${dir} is not an analysisFieldsEval gating output`);
    }
    if (run.inputs?.fingerprint !== fingerprint) {
        throw new Error(
            `${dir} was made on a different set (fingerprint differs)`
        );
    }
    return readFileSync(join(dir, 'rows.jsonl'), 'utf-8')
        .split('\n')
        .filter(line => line !== '')
        .map((line): BaselineRow => {
            const row = asRec(JSON.parse(line));
            const tier = SKILL_TIERS.find(t => t === row?.tier);
            if (
                typeof row?.caseId !== 'string' ||
                tier === undefined ||
                typeof row.strippedSha256 !== 'string' ||
                typeof row.stableSha256 !== 'string'
            ) {
                throw new Error(`${dir}/rows.jsonl has a row without hashes`);
            }
            return {
                caseId: row.caseId,
                tier,
                strippedSha256: row.strippedSha256,
                ...(typeof row.remainderSha256 === 'string'
                    ? { remainderSha256: row.remainderSha256 }
                    : {}),
                stableSha256: row.stableSha256,
            };
        });
}

async function gatingMode(
    args: FieldsEvalArgs,
    deps: FieldsEvalDeps
): Promise<ModeOutput> {
    const set = loadSetData(args.set ?? '');
    const cases: readonly ReplayCase[] = selectRunCases(set.manifest, {
        subset: null,
        limit: args.limit,
    });
    if (cases.length === 0) throw new Error('no case to render');
    const tiers = args.tier === null ? SKILL_TIERS : [args.tier];
    deps.log(
        `gating: rendering ${cases.length} cases for ${tiers.join(' and ')}`
    );
    const rendered = await deps.render({
        skillsDir: args.skills ?? '',
        cases,
        tiers,
        storedOf: symbol => {
            const stored = set.storedOf.get(symbol);
            if (stored === undefined) throw new Error(`no bars for ${symbol}`);
            return stored;
        },
        log: deps.log,
    });
    const asOfOf = new Map(cases.map(c => [c.caseId, c]));
    const cardContext = (caseId: string): CardContext | null => {
        const replayCase = asOfOf.get(caseId);
        const bars = replayCase && set.storedOf.get(replayCase.symbol)?.bars;
        return replayCase === undefined || bars === undefined
            ? null
            : { closes: promptWindowCloses(bars, replayCase.asOf) };
    };
    const baseline =
        args.baseline === null
            ? null
            : readBaselineRows(args.baseline, set.fingerprint);
    const { rows, summary } = summarizeGating({
        catalog: rendered.catalog,
        samples: rendered.samples,
        cardContext,
        baseline,
        schemaAsksIndicatorResults: await deps.schemaAsksIndicatorResults(),
    });
    return {
        inputs: {
            fingerprint: set.fingerprint,
            skillsDir: args.skills,
            limit: args.limit,
            tiers,
            baseline: args.baseline,
        },
        summary: { gating: summary },
        gates: gatingGates(summary),
        rows,
        skipped: 0,
    };
}

/**
 * The first-repeat results of a run as arm cases. A repeat run whose catalog differs from the
 * before run's may only be paired when every prompt is the same (the tags change nothing the
 * model is sent).
 */
function armCasesOf(run: RunData): readonly ArmCase[] {
    return run.results.filter(r => r.repeat === 1).map(readArmCase);
}

function assertSamePrompts(before: RunData, repeat: RunData): void {
    if (before.meta.skillsSha256 === repeat.meta.skillsSha256) return;
    const hashOf = new Map(
        before.results
            .filter(r => r.repeat === 1)
            .map(r => [r.caseId, r.promptHashes?.full ?? null])
    );
    const differing = repeat.results.filter(
        r =>
            r.repeat === 1 &&
            (hashOf.get(r.caseId) === null ||
                hashOf.get(r.caseId) !== (r.promptHashes?.full ?? null))
    );
    if (differing.length > 0) {
        throw new Error(
            `${before.dir} and ${repeat.dir} have different skillsSha256 and ${differing.length} case(s) with different prompts: they are not a repeat pair`
        );
    }
}

/** The run's tier; a run of an unknown tier is not one of the two the thresholds are set for. */
function tierOf(tier: string): 'free' | 'member' {
    if (tier === 'free' || tier === 'member') return tier;
    throw new Error(`the run's tier "${tier}" is neither free nor member`);
}

interface RunComparisonData {
    afterRun: RunData;
    beforeRun: RunData;
    repeatRun: RunData | null;
    after: readonly ArmCase[];
    before: readonly ArmCase[];
    repeat: readonly ArmCase[] | null;
    comparison: ReturnType<typeof compareArms>;
    skillsDir: string | null;
    fingerprint: string;
}

/** The paired comparison of an after, a before and an optional repeat run (`output` and `claims`). */
function compareRuns(args: FieldsEvalArgs, set: SetData): RunComparisonData {
    const afterRun = loadRunData(args.run ?? '', set);
    const beforeRun = loadRunData(args.before ?? '', set);
    assertComparableRuns(afterRun, beforeRun, PAIRED_RUN_FIELDS);
    const repeatRun =
        args.repeat === null ? null : loadRunData(args.repeat, set);
    if (repeatRun !== null) {
        assertComparableRuns(beforeRun, repeatRun, PAIRED_RUN_FIELDS);
        assertSamePrompts(beforeRun, repeatRun);
    }
    const catalog = readSkillCatalog(args.skills ?? '');
    const patterns: readonly PatternSkill[] = catalog
        .filter(skill => skill.type === 'pattern')
        .map(skill => ({ name: skill.name, triggers: skill.triggers }));
    const tagged = catalog.flatMap(skill =>
        skill.computedCard === null
            ? []
            : [{ name: skill.name, kind: skill.computedCard }]
    );
    // The tag names a skill's kind; the core-0 baseline names stand in for an untagged catalog.
    const kindOfSkill: Record<string, string> = {
        ...CARD_TREND_SKILLS,
        ...CYCLE_STRATEGY_SKILLS,
        ...Object.fromEntries(tagged.map(t => [t.name, t.kind])),
    };
    const [after, before] = [armCasesOf(afterRun), armCasesOf(beforeRun)];
    const repeat = repeatRun === null ? null : armCasesOf(repeatRun);
    const comparison = compareArms({
        kindOfSkill,
        triggersOfSkill: Object.fromEntries(
            catalog.map(skill => [skill.name, skill.triggers])
        ),
        taggedKinds: tagged.map(t => t.kind),
        after,
        before,
        repeat,
        patterns,
        levels: {
            after: levelCasesOf(afterRun, set),
            before: levelCasesOf(beforeRun, set),
            repeat: repeatRun === null ? null : levelCasesOf(repeatRun, set),
        },
        calls: {
            after: runCallStats(afterRun.results, afterRun.labels),
            before: runCallStats(beforeRun.results, beforeRun.labels),
            repeat:
                repeatRun === null
                    ? null
                    : runCallStats(repeatRun.results, repeatRun.labels),
        },
        noiseFloor: args.noisePp / 100,
        tier: tierOf(afterRun.meta.tier),
    });
    return {
        afterRun,
        beforeRun,
        repeatRun,
        after,
        before,
        repeat,
        comparison,
        skillsDir: args.skills,
        fingerprint: set.fingerprint,
    };
}

const runInputs = (
    data: RunComparisonData,
    args: FieldsEvalArgs
): Record<string, unknown> => ({
    fingerprint: data.fingerprint,
    skillsDir: data.skillsDir,
    run: { dir: data.afterRun.dir, ...data.afterRun.meta },
    before: { dir: data.beforeRun.dir, ...data.beforeRun.meta },
    repeat:
        data.repeatRun === null
            ? null
            : { dir: data.repeatRun.dir, ...data.repeatRun.meta },
    noisePp: args.noisePp,
});

function outputMode(args: FieldsEvalArgs, deps: FieldsEvalDeps): ModeOutput {
    const set = loadSetData(args.set ?? '');
    const data = compareRuns(args, set);
    const { comparison, after, before, repeat } = data;
    deps.log(
        `output: ${comparison.n} paired cases${repeat === null ? ', no repeat run (noise floor unknown)' : `, repeat ${repeat.length}`}`
    );
    const beforeBy = new Map(before.map(c => [c.caseId, c]));
    const pick = (c: ArmCase | undefined) =>
        c === undefined
            ? null
            : {
                  failed: c.failed,
                  outputTokens: c.outputTokens,
                  latencyMs: c.latencyMs,
                  modelChars: c.modelChars,
                  summaryChars: c.summaryChars,
                  planPosition: c.planPosition,
              };
    return {
        inputs: runInputs(data, args),
        summary: { output: comparison },
        gates: outputGates(comparison),
        rows: after.map(c => ({
            caseId: c.caseId,
            after: pick(c),
            before: pick(beforeBy.get(c.caseId)),
        })),
        skipped: 0,
    };
}

/** A result's claim case; `null` for a failed call. */
function claimCasesOf(
    run: RunData,
    language: ClaimLanguage
): readonly ClaimCase[] {
    return run.results
        .filter(r => r.repeat === 1)
        .flatMap(r => readClaimCase(r, language) ?? []);
}

/**
 * `claims`: C1 and C2 on the stored text, and the WP-18 form of the non-inferiority gates
 * (F1, F2, L1 and V1 as `output` decides them; O1 with the WP-18 bound: the change removes
 * text, so the median output-token ratio may not grow by more than 5%).
 */
function claimsMode(args: FieldsEvalArgs, deps: FieldsEvalDeps): ModeOutput {
    const set = loadSetData(args.set ?? '');
    const data = compareRuns(args, set);
    const { comparison } = data;
    const language = args.lang;
    const [after, before] = [
        claimCasesOf(data.afterRun, language),
        claimCasesOf(data.beforeRun, language),
    ];
    const repeat =
        data.repeatRun === null ? null : claimCasesOf(data.repeatRun, language);
    const claims = compareClaims({ after, before, repeat });
    deps.log(
        `claims: ${claims.paired} paired cases (${claims.unpaired} of the after run unpaired)`
    );
    const shared = outputGates(comparison).filter(g =>
        ['F1', 'F2', 'L1', 'V1'].includes(g.id)
    );
    const ratio = comparison.tokens.ratio;
    const needed = Math.ceil(C.gates.minPairedShare * comparison.n - 1e-9);
    const o1: GateResult = {
        id: 'O1',
        description:
            'median per-case output-token ratio (the change removes text, so it may not grow)',
        pass:
            ratio.point === null || comparison.paired.o1 < needed
                ? null
                : ratio.point <= C.gates.claimsOutputMaxRatio + 1e-12,
        value:
            ratio.point === null
                ? 'n/a'
                : `median ${ratio.point.toFixed(3)} (95% high ${ratio.high?.toFixed(3) ?? 'n/a'}, n ${ratio.n}, paired ${comparison.paired.o1} of ${comparison.n})`,
        threshold: `<= ${C.gates.claimsOutputMaxRatio}`,
    };
    const byCase = new Map(before.map(c => [c.caseId, c]));
    return {
        inputs: { ...runInputs(data, args), language },
        summary: { claims, output: comparison },
        gates: GATE_IDS.claims.flatMap(id =>
            [
                ...claimsGates(
                    claims,
                    data.afterRun.results.filter(r => r.repeat === 1).length
                ),
                ...shared,
                o1,
            ].filter(g => g.id === id)
        ),
        rows: after.map(c => ({
            caseId: c.caseId,
            after: c,
            before: byCase.get(c.caseId) ?? null,
        })),
        skipped: 0,
    };
}

/** The zone cases of a run: one per first-repeat result with a plan. */
function zoneCasesOf(
    run: MeasuredRun,
    labels: ReadonlyMap<string, string | null>
): readonly ZoneCase[] {
    return [...run.planCases.values()].map(built => {
        const measure = measurePlan(built.plan);
        const ar = asRec(
            asRec(built.result.unfilteredResult)?.actionRecommendation
        );
        const text = (key: string): string => {
            const value = ar?.[key];
            return typeof value === 'string' ? value : '';
        };
        return {
            caseId: built.plan.caseId,
            close: built.plan.close,
            atr: measure.atr,
            zoneLow: measure.zoneLow,
            zoneTop: measure.zoneTop,
            tolerancePosition: tolerancePositionOf(
                measure.position,
                built.plan.close,
                measure.zoneLow,
                measure.zoneTop
            ),
            storedPosition: built.plan.storedState?.position ?? null,
            approach: labels.get(built.plan.caseId) ?? null,
            prose: [
                text('entry'),
                text('positionAnalysis'),
                text('riskReward'),
            ].join('\n'),
            firstTargetRoomAtr: measure.firstTargetRoomAtr,
        };
    });
}

/** `labelPlanOutcome`'s approach per case of a run's `labels.jsonl` (repeat 1). */
function approachOf(run: RunData): ReadonlyMap<string, string | null> {
    return new Map(
        (run.labels ?? [])
            .filter(row => row.repeat === 1)
            .map(row => [row.caseId, row.labels?.plan?.approach ?? null])
    );
}

function zoneMode(args: FieldsEvalArgs, deps: FieldsEvalDeps): ModeOutput {
    const set = loadSetData(args.set ?? '');
    const afterRun = loadRunData(args.run ?? '', set);
    const beforeRun =
        args.before === null ? null : loadRunData(args.before, set);
    if (beforeRun !== null) {
        assertComparableRuns(afterRun, beforeRun, PAIRED_RUN_FIELDS);
    }
    const after = zoneCasesOf(measureRun(afterRun, set), approachOf(afterRun));
    const before =
        beforeRun === null
            ? null
            : zoneCasesOf(measureRun(beforeRun, set), approachOf(beforeRun));
    if (after.length === 0) throw new Error('zone: the run has no plan');
    const report = zoneReport(after, {
        language: args.lang,
        restate: args.restate,
    });
    const targetRoom =
        before === null ? null : targetRoomComparison(after, before);
    const cue =
        before === null ? null : cueComparison(after, before, args.lang);
    deps.log(
        `zone: ${after.length} plans${args.restate ? ', positions restated with exact edges' : ''}`
    );
    return {
        inputs: {
            fingerprint: set.fingerprint,
            run: { dir: afterRun.dir, ...afterRun.meta },
            before:
                beforeRun === null
                    ? null
                    : { dir: beforeRun.dir, ...beforeRun.meta },
            restate: args.restate,
            language: args.lang,
        },
        summary: { zone: report, targetRoom, cueComparison: cue },
        gates: zoneGates(report, after.length, targetRoom, cue),
        rows: after.map(c => ({
            caseId: c.caseId,
            tolerance: c.tolerancePosition,
            exact: exactPosition(c),
            stored: c.storedPosition,
            geometry:
                c.zoneLow === null || c.zoneTop === null
                    ? null
                    : geometryOf(c.close, c.zoneLow, c.zoneTop),
            distanceAboveTopAtr: distanceAboveTopAtr(c),
            approach: c.approach,
        })),
        skipped: 0,
    };
}

// ─── Command ──────────────────────────────────────────────────────────────────

export interface FieldsEvalDeps {
    log: (line: string) => void;
    gitSha: () => string;
    dirtyDiffSha256: () => string | null;
    render: RenderSkills;
    /** Whether the technical response schema still lists `indicatorResults` (D9). */
    schemaAsksIndicatorResults: () => Promise<boolean>;
}

export const defaultDeps: FieldsEvalDeps = {
    log: console.log,
    gitSha: () =>
        `${gitOutput(['rev-parse', 'HEAD'])}${gitOutput(['status', '--porcelain']) === '' ? '' : '+dirty'}`,
    dirtyDiffSha256: () => {
        if (gitOutput(['status', '--porcelain']) === '') return null;
        const untracked = gitOutput([
            'ls-files',
            '--others',
            '--exclude-standard',
        ])
            .split('\n')
            .filter(file => file !== '')
            .toSorted()
            .map(
                file =>
                    `${file}\0${sha256Hex(readFileSync(join(REPO_ROOT, file)))}`
            );
        return sha256Hex(
            [gitOutput(['diff', 'HEAD']), ...untracked].join('\n')
        );
    },
    render: renderWithCore,
    schemaAsksIndicatorResults: async () => {
        const { TECHNICAL_RESPONSE_SCHEMA } =
            await import('@/domain/analysis/responseSchemas');
        return JSON.stringify(TECHNICAL_RESPONSE_SCHEMA).includes(
            '"indicatorResults"'
        );
    },
};

/**
 * The gates that decide the exit code. Every selected id counts: one the input did not
 * produce (S5 without a run pair, T1 without a run) is a gate that could not be computed,
 * not a gate that is absent.
 */
function selectedGates(
    gates: readonly GateResult[],
    selection: FieldsEvalArgs['gate'],
    mode: EvalMode
): readonly GateResult[] {
    if (selection === null) return [];
    const ids = selection === 'all' ? GATE_IDS[mode] : selection;
    return ids.map(
        id =>
            gates.find(g => g.id === id) ?? {
                id,
                description: 'not produced by this input',
                pass: null,
                value: null,
                threshold: 'n/a',
            }
    );
}

const describeGate = (g: GateResult): string =>
    `${g.id} ${g.pass === null ? 'NOT COMPUTABLE' : g.pass ? 'pass' : 'FAIL'}: ${g.description} = ${g.value ?? 'n/a'} (${g.threshold})`;

/** Writes the evaluation and returns the exit code: 0, or 2 when a selected gate did not pass. */
export async function runFieldsEval(
    args: FieldsEvalArgs,
    deps: FieldsEvalDeps
): Promise<number> {
    assertOutsideRepo(args.out);
    const output =
        args.mode === 'trend'
            ? trendMode(args, deps)
            : args.mode === 'plan'
              ? planMode(args, deps)
              : args.mode === 'gating'
                ? await gatingMode(args, deps)
                : args.mode === 'output'
                  ? outputMode(args, deps)
                  : args.mode === 'claims'
                    ? claimsMode(args, deps)
                    : args.mode === 'zone'
                      ? zoneMode(args, deps)
                      : await skillsMode(args, deps);
    if (output.rows.length === 0)
        throw new Error('the evaluation measured no row');
    output.gates.forEach(g => deps.log(describeGate(g)));
    writeFileAtomic(
        join(args.out, 'run.json'),
        `${JSON.stringify(
            {
                tool: 'analysisFieldsEval',
                mode: args.mode,
                arm: args.arm,
                coreGitSha: deps.gitSha(),
                dirtyDiffSha256: deps.dirtyDiffSha256(),
                inputs: output.inputs,
                gate: args.gate,
                constants: { ...C, derived: FIELDS_EVAL_CORE_DERIVED },
            },
            null,
            2
        )}\n`
    );
    writeFileAtomic(
        join(args.out, 'summary.json'),
        `${JSON.stringify({ summary: output.summary, gates: output.gates }, null, 2)}\n`
    );
    writeFileAtomic(
        join(args.out, 'rows.jsonl'),
        output.rows.map(row => `${JSON.stringify(row)}\n`).join('')
    );
    deps.log(`wrote ${args.out}`);
    if (args.gate === null) {
        deps.log(
            'NOTICE: no --gate given, so no gate decides the exit code (0 whatever the gates above say). Pass --gate all or --gate <ids> to gate.'
        );
    }
    const decided = selectedGates(output.gates, args.gate, args.mode);
    const failed = decided.filter(g => g.pass !== true);
    const skippedFails =
        args.gate !== null && !args.allowSkippedCases && output.skipped > 0;
    if (skippedFails) {
        deps.log(
            `FAIL: ${output.skipped} stored row(s) have no bar at their date under --gate (pass --allow-skipped-cases to accept)`
        );
    }
    failed.forEach(g => deps.log(`GATE ${describeGate(g)}`));
    return failed.length > 0 || skippedFails ? 2 : 0;
}

if (require.main === module) {
    runFieldsEval(parseFieldsEvalArgs(process.argv.slice(2)), defaultDeps)
        .then(code => {
            process.exitCode = code;
        })
        .catch(error => {
            console.error(
                error instanceof Error ? error.message : String(error)
            );
            process.exitCode = 1;
        });
}
