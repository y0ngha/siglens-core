/**
 * The measured base-rate table generator (WP-18 §4.1, §8.1): turns the events of the engine
 * evaluation and the summary of the level evaluation of one set into
 * `src/domain/analysis/measuredBaseRates.ts`.
 *
 *   npx tsx scripts/replay/baseRateTable.ts --engine <engineEval dir (gate geometry)> \
 *       --candles <engineEval dir (gate c9)> --levels <levelEval dir> --date <YYYY-MM-DD> \
 *       --out <file> [--json <file>]
 *
 * It refuses (exit 1) inputs it cannot trust: a run made on a dirty checkout, runs of
 * different sets or different core commits, a run whose own gate did not pass or was not
 * the one this table needs, a level run that is not the whole reference population, and
 * events that do not match their summary. The table is deterministic: the same inputs and
 * `--date` give a byte-identical file. `--out` may be inside the repository only at
 * `src/domain/analysis/measuredBaseRates.ts` (the table is committed there); the JSON
 * companion (every number the verdict rule read) goes outside it. `--allow-dirty` lets runs
 * of an uncommitted checkout through so the table can be inspected; it is refused for the
 * committed path, and the header keeps the `+dirty` sha.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { parseArgs } from '../ab-harness/cliArgs';
import {
    candleTable,
    patternTable,
    priceLevelRow,
    type BaseRateScope,
    type LevelSummaryInput,
    type SubjectTable,
} from './baseRateTableCompute';
import { renderBaseRateTable } from './baseRateTableRender';
import {
    isCandleEvent,
    isPatternEvent,
    type ArmSummary,
} from './engineEvalCompute';
import type { EvalEvent } from './engineEvalTypes';
import { OUTCOME_LABEL_VERSION } from '@/domain/outcomes/constants';
import {
    REPO_ROOT,
    assertOutsideRepo,
    readJson,
    sha256Hex,
    writeFileAtomic,
} from './fsUtil';
import { REPLAY_SET_ID } from './types';

/** The one place inside the repository the table may be written. */
export const TABLE_PATH = join(
    REPO_ROOT,
    'src',
    'domain',
    'analysis',
    'measuredBaseRates.ts'
);

export interface BaseRateTableArgs {
    engine: string;
    candles: string;
    levels: string;
    out: string;
    json: string | null;
    date: string;
    /** Accept dirty runs for a look at the table; refused when writing the committed path. */
    allowDirty: boolean;
}

/** A run directory, or the `summary.json` inside it. */
const runDirOf = (path: string): string =>
    resolve(basename(path) === 'summary.json' ? dirname(path) : path);

export function parseBaseRateTableArgs(
    argv: readonly string[]
): BaseRateTableArgs {
    const raw = parseArgs(argv);
    const required = ['engine', 'candles', 'levels', 'out', 'date'] as const;
    const missing = required.filter(name => !raw[name]);
    if (missing.length > 0) {
        throw new Error(`missing ${missing.map(m => `--${m}`).join(', ')}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) {
        throw new Error('--date must be YYYY-MM-DD');
    }
    return {
        engine: runDirOf(raw.engine),
        candles: runDirOf(raw.candles),
        levels: runDirOf(raw.levels),
        out: resolve(raw.out),
        json: raw.json === undefined ? null : resolve(raw.json),
        date: raw.date,
        allowDirty: raw['allow-dirty'] === 'true',
    };
}

// ─── Inputs ───────────────────────────────────────────────────────────────────

interface EngineRunJson {
    tool: string;
    arm: string;
    coreGitSha: string;
    dirtyDiffSha256: string | null;
    source: { kind: string; fingerprint: string; symbols: readonly string[] };
    only: string | null;
    gate: string | null;
    constants: unknown;
}

interface LevelRunJson {
    tool: string;
    coreGitSha: string;
    dirtyDiffSha256: string | null;
    source: { fingerprint: string; symbols: readonly string[] };
    referencePopulation: boolean;
    constants: unknown;
}

interface LevelSummaryJson extends LevelSummaryInput {
    scope: BaseRateScope;
    labelAgreement: { disagreements: number };
    gates: readonly { id: string; pass: boolean | null }[];
}

export interface EngineInput {
    dir: string;
    run: EngineRunJson;
    summary: ArmSummary;
    events: readonly EvalEvent[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;
const isText = (value: unknown): boolean => typeof value === 'string';
const isNumber = (value: unknown): boolean =>
    typeof value === 'number' && Number.isFinite(value);
const isHorizons = (value: unknown): boolean =>
    isRecord(value) && ['h1', 'h5', 'h10'].every(k => isNumber(value[k]));
const isPlacebo = (value: unknown): boolean =>
    isRecord(value) &&
    isNumber(value.n) &&
    isHorizons(value.y) &&
    isHorizons(value.pct) &&
    isHorizons(value.hit);

/**
 * Whether `value` has every field the table reads from an event, of the type it reads it as:
 * the slice, the week and half it is clustered by, the outcome and its placebo. A line that
 * lacks one would otherwise turn into a NaN row.
 */
export function isEvalEvent(value: unknown): value is EvalEvent {
    if (!isRecord(value)) return false;
    const common =
        isText(value.symbol) &&
        (value.market === 'us' || value.market === 'kr') &&
        isText(value.date) &&
        isText(value.week) &&
        (value.half === 'early' || value.half === 'late');
    if (!common) return false;
    if (value.kind === 'pattern') {
        const outcome = (v: unknown): boolean =>
            v === 'hit' || v === 'inval' || v === 'open';
        return (
            isText(value.id) &&
            outcome(value.target60) &&
            outcome(value.cons60) &&
            isNumber(value.placeboTargetHit) &&
            isNumber(value.placeboConsHit) &&
            isNumber(value.placeboN)
        );
    }
    if (value.kind === 'candle') {
        const tested = value.status === 'tested';
        return (
            isText(value.pattern) &&
            (value.direction === 1 ||
                value.direction === -1 ||
                value.direction === 0) &&
            (tested ||
                value.status === 'neutral' ||
                value.status === 'dropped') &&
            (!tested ||
                (isHorizons(value.y) &&
                    isHorizons(value.pct) &&
                    isPlacebo(value.matched) &&
                    isPlacebo(value.unmatched)))
        );
    }
    return false;
}

export function readEngineInput(dir: string): EngineInput {
    const lines = readFileSync(join(dir, 'events.jsonl'), 'utf-8')
        .split('\n')
        .filter(line => line !== '');
    return {
        dir,
        run: readJson<EngineRunJson>(join(dir, 'run.json')),
        summary: readJson<ArmSummary>(join(dir, 'summary.json')),
        events: lines.map((line, i) => {
            const parsed: unknown = JSON.parse(line);
            if (!isEvalEvent(parsed)) {
                throw new Error(
                    `${dir}/events.jsonl line ${i + 1} is not an event of the shape engineEval writes`
                );
            }
            return parsed;
        }),
    };
}

export interface LevelInput {
    dir: string;
    run: LevelRunJson;
    summary: LevelSummaryJson;
}

export function readLevelInput(dir: string): LevelInput {
    return {
        dir,
        run: readJson<LevelRunJson>(join(dir, 'run.json')),
        summary: readJson<LevelSummaryJson>(join(dir, 'summary.json')),
    };
}

const sameSymbols = (
    a: { run: { source: { symbols: readonly string[] } } },
    b: { run: { source: { symbols: readonly string[] } } }
): boolean =>
    JSON.stringify(a.run.source.symbols.toSorted()) ===
    JSON.stringify(b.run.source.symbols.toSorted());

/**
 * Everything wrong with the inputs, as sentences. An empty list means the table may be
 * generated: the three runs are clean, of one set and one commit, and cover what the table
 * reads.
 */
export function inputProblems(
    engine: EngineInput,
    candles: EngineInput,
    levels: LevelInput,
    allowDirty = false
): string[] {
    const clean = (name: string, sha: string, diff: string | null): string[] =>
        !allowDirty && (sha.endsWith('+dirty') || diff !== null)
            ? [
                  `${name} was made on a dirty checkout (${sha}); re-run it on a clean main`,
              ]
            : [];
    const patternEvents = engine.events.filter(isPatternEvent).length;
    const candleEvents = candles.events.filter(isCandleEvent).length;
    return [
        ...clean('--engine', engine.run.coreGitSha, engine.run.dirtyDiffSha256),
        ...clean(
            '--candles',
            candles.run.coreGitSha,
            candles.run.dirtyDiffSha256
        ),
        ...clean('--levels', levels.run.coreGitSha, levels.run.dirtyDiffSha256),
        ...(engine.run.tool === 'engineEval' &&
        candles.run.tool === 'engineEval'
            ? []
            : ['--engine and --candles must be engineEval runs']),
        ...(levels.run.tool === 'levelEval'
            ? []
            : ['--levels must be a levelEval run']),
        ...(engine.run.source.kind === 'set' &&
        candles.run.source.kind === 'set'
            ? []
            : [
                  'the engine runs must be of a frozen set (--set), not a bars directory',
              ]),
        ...(engine.run.gate === 'geometry' && engine.summary.g1.pass === true
            ? []
            : ['--engine must be a run with --gate geometry that passed']),
        ...(candles.run.gate === 'c9' && candles.summary.g1.pass === true
            ? []
            : ['--candles must be a run with --gate c9 that passed']),
        ...(engine.run.only === 'candles' || engine.summary.patterns === null
            ? ['--engine did not measure the chart patterns']
            : []),
        ...(candles.run.only === 'patterns' || candles.summary.candles === null
            ? ['--candles did not measure the candles']
            : []),
        ...(levels.run.referencePopulation
            ? []
            : ['--levels is not the reference population (whole set, step 3)']),
        ...(levels.summary.gates.find(g => g.id === 'L0')?.pass === true
            ? []
            : [
                  '--levels did not pass its L0 gate: the instrument does not reproduce WP-18 section 1 on this run',
              ]),
        ...(levels.summary.labelAgreement.disagreements === 0
            ? []
            : [
                  `--levels counts ${levels.summary.labelAgreement.disagreements} real levels the labeller and the instrument label differently`,
              ]),
        ...(sameSymbols(engine, candles) && sameSymbols(engine, levels)
            ? []
            : [
                  'the runs cover different symbols: every run must be of the whole set, not a subset',
              ]),
        ...(engine.run.source.fingerprint === candles.run.source.fingerprint &&
        engine.run.source.fingerprint === levels.run.source.fingerprint
            ? []
            : ['the runs are of different bars (fingerprints differ)']),
        ...(engine.run.coreGitSha === candles.run.coreGitSha &&
        engine.run.coreGitSha === levels.run.coreGitSha
            ? []
            : ['the runs were made on different core commits']),
        ...(engine.summary.patterns !== null &&
        engine.summary.patterns.events !== patternEvents
            ? [
                  `--engine summary counts ${engine.summary.patterns.events} pattern events, events.jsonl holds ${patternEvents}`,
              ]
            : []),
        ...(candles.summary.candles !== null &&
        candles.summary.candles.events !== candleEvents
            ? [
                  `--candles summary counts ${candles.summary.candles.events} candle events, events.jsonl holds ${candleEvents}`,
              ]
            : []),
    ];
}

const scopeOf = (
    input: EngineInput,
    events: readonly { date: string }[]
): BaseRateScope => {
    const dates = events.map(e => e.date).toSorted();
    return {
        timeframe: '1Day',
        symbols: input.run.source.symbols.length,
        from: dates[0] ?? '',
        to: dates[dates.length - 1] ?? '',
    };
};

// ─── Generation ───────────────────────────────────────────────────────────────

export interface GeneratedTable {
    source: string;
    json: unknown;
}

/** The table's source (formatted with the repository's prettier config) and its JSON companion. */
export async function generateTable(
    args: BaseRateTableArgs,
    inputs: { engine: EngineInput; candles: EngineInput; levels: LevelInput }
): Promise<GeneratedTable> {
    const { engine, candles, levels } = inputs;
    const problems = inputProblems(engine, candles, levels, args.allowDirty);
    if (problems.length > 0) {
        throw new Error(
            `the inputs cannot be trusted:\n- ${problems.join('\n- ')}`
        );
    }
    const patternEvents = engine.events.filter(isPatternEvent);
    const candleEvents = candles.events.filter(isCandleEvent);
    const patterns: SubjectTable = patternTable(
        patternEvents,
        engine.summary.weeks,
        scopeOf(engine, patternEvents)
    );
    const candleRows: SubjectTable = candleTable(
        candleEvents,
        candles.summary.weeks,
        scopeOf(candles, candleEvents)
    );
    const priceLevel = priceLevelRow(levels.summary, levels.summary.scope);
    const definitions = `outcome labels v${OUTCOME_LABEL_VERSION}, constants ${sha256Hex(
        JSON.stringify({
            engine: engine.run.constants,
            candles: candles.run.constants,
            levels: levels.run.constants,
        })
    ).slice(0, 12)}`;
    const runName = (dir: string): string =>
        `${basename(dirname(dir))}/${basename(dir)}`;
    const command = `npx tsx scripts/replay/baseRateTable.ts --engine ${runName(args.engine)} --candles ${runName(args.candles)} --levels ${runName(args.levels)} --date ${args.date}`;
    const raw = renderBaseRateTable({
        header: {
            setId: REPLAY_SET_ID,
            fingerprint: engine.run.source.fingerprint,
            coreSha: engine.run.coreGitSha,
            definitions,
            date: args.date,
            command,
        },
        patterns,
        candles: candleRows,
        priceLevel: priceLevel.row,
    });
    const config = (await resolveConfig(TABLE_PATH)) ?? {};
    return {
        source: await format(raw, { ...config, parser: 'typescript' }),
        json: {
            definitions,
            command,
            chartPatterns: patterns,
            candles: candleRows,
            priceLevel,
        },
    };
}

/** Reads the inputs, writes the table and returns the exit code (0). */
export async function runBaseRateTable(
    args: BaseRateTableArgs,
    log: (line: string) => void = console.log
): Promise<number> {
    if (args.out === TABLE_PATH) {
        if (args.allowDirty) {
            throw new Error(
                '--allow-dirty cannot write the committed table: re-run the evaluations on a clean main'
            );
        }
    } else {
        assertOutsideRepo(args.out);
    }
    if (args.json !== null) assertOutsideRepo(args.json);
    const generated = await generateTable(args, {
        engine: readEngineInput(args.engine),
        candles: readEngineInput(args.candles),
        levels: readLevelInput(args.levels),
    });
    writeFileAtomic(args.out, generated.source);
    if (args.json !== null) {
        writeFileAtomic(
            args.json,
            `${JSON.stringify(generated.json, null, 2)}\n`
        );
    }
    log(`wrote ${args.out}`);
    return 0;
}

if (require.main === module) {
    runBaseRateTable(parseBaseRateTableArgs(process.argv.slice(2)))
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
