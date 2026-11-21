/**
 * The engine evaluation: a placebo-controlled measurement of the candle and chart-pattern
 * engines on a frozen bars set.
 *
 *   npx tsx scripts/replay/engineEval.ts --set <set dir> --out <dir> [--arm <name>]
 *   npx tsx scripts/replay/engineEval.ts --bars <bars dir> --out <dir> [--arm <name>]
 *
 * An arm is a checkout: the script imports `src/` directly, so running it from two
 * checkouts with the same `--set` gives two comparable runs (`engineEvalCompare.ts`).
 * `--set` verifies the manifest hashes and also reports what a case's prompt carries;
 * `--bars` takes a plain directory of `<SYMBOL>.json` files (e.g. the published daily-AI
 * backtest bars) and fingerprints it by file hash. Optional: `--only candles|patterns`,
 * `--symbols A,B`, and `--gate c9|pivots|geometry` (with `--allow-skipped-cases` to
 * tolerate cases without a bar at their `asOf` date) to score G1 for one PR (core-1,
 * core-2, core-3): a gated run passes only when every counter that PR owns is 0 and its
 * half was measured.
 *
 * Writes `run.json` (core sha, data fingerprint, constants), `events.jsonl` and
 * `summary.json`. No network, no model call, no cost; the only randomness is the seeded
 * placebo draw, so a rerun on the same checkout is byte-identical. Output inside the
 * repository is refused (market data and run output stay out of it).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from '../ab-harness/cliArgs';
import {
    candleEventsForSymbol,
    caseCandleLines,
    type CaseCandleLines,
} from './engineEvalCandles';
import { summarizeArm } from './engineEvalCompute';
import {
    patternWalkForSymbol,
    type PatternCounters,
} from './engineEvalPatterns';
import { weeksOfTimes } from './engineEvalStats';
import {
    CORE_DERIVED,
    EVAL_CONSTANTS,
    G1_GATES,
    HORIZONS,
    type CandleEvent,
    type EvalEvent,
    type EvalMarket,
    type G1Gate,
    type PatternEvent,
} from './engineEvalTypes';
import {
    REPO_ROOT,
    assertOutsideRepo,
    gitOutput,
    readJson,
    sha256Hex,
    writeFileAtomic,
} from './fsUtil';
import { marketOfSymbol } from './markets';
import { barsFingerprint, verifySetHashes } from './setIntegrity';
import type { ReplayCase, ReplayManifest, StoredBars } from './types';
import type { Bar } from '@/domain/types';

export type EvalOnly = 'candles' | 'patterns' | null;

export interface EngineEvalArgs {
    set: string | null;
    bars: string | null;
    out: string;
    arm: string;
    only: EvalOnly;
    symbols: readonly string[] | null;
    gate: G1Gate | null;
    /** A gated run fails when a case has no bar at its `asOf` date, unless this is set. */
    allowSkippedCases: boolean;
}

function parseOnly(raw: string | undefined): EvalOnly {
    if (raw === undefined) return null;
    if (raw === 'candles' || raw === 'patterns') return raw;
    throw new Error(`--only must be "candles" or "patterns" (got "${raw}")`);
}

function parseGate(raw: string | undefined): G1Gate | null {
    if (raw === undefined) return null;
    const gate = G1_GATES.find(candidate => candidate === raw);
    if (gate === undefined) {
        throw new Error(
            `--gate must be one of ${G1_GATES.join(', ')} (got "${raw}")`
        );
    }
    return gate;
}

export function parseEngineEvalArgs(argv: readonly string[]): EngineEvalArgs {
    const raw = parseArgs(argv);
    if (!raw.out) throw new Error('--out is required');
    if ((raw.set === undefined) === (raw.bars === undefined)) {
        throw new Error('exactly one of --set and --bars is required');
    }
    return {
        set: raw.set === undefined ? null : resolve(raw.set),
        bars: raw.bars === undefined ? null : resolve(raw.bars),
        out: resolve(raw.out),
        arm: raw.arm ?? 'unnamed',
        only: parseOnly(raw.only),
        symbols: raw.symbols === undefined ? null : raw.symbols.split(','),
        gate: parseGate(raw.gate),
        allowSkippedCases: raw['allow-skipped-cases'] === 'true',
    };
}

// ─── Loading ──────────────────────────────────────────────────────────────────

export interface LoadedSymbol {
    symbol: string;
    market: EvalMarket;
    bars: Bar[];
}

export interface LoadedData {
    kind: 'set' | 'bars';
    fingerprint: string;
    symbols: LoadedSymbol[];
    cases: readonly ReplayCase[];
}

export function loadSet(setDir: string): LoadedData {
    const manifest = readJson<ReplayManifest>(join(setDir, 'manifest.json'));
    verifySetHashes(setDir, manifest);
    return {
        kind: 'set',
        fingerprint: barsFingerprint(manifest),
        symbols: Object.entries(manifest.bars)
            .toSorted(([a], [b]) => a.localeCompare(b, 'en'))
            .map(([symbol, entry]) => ({
                symbol,
                market: entry.market,
                bars: readJson<StoredBars>(join(setDir, entry.file)).bars,
            })),
        cases: manifest.cases,
    };
}

const BAR_FIELDS = ['time', 'open', 'high', 'low', 'close', 'volume'] as const;

/** A bars file whose shape is not the stored-bars shape; the message names the file. */
export class InvalidBarsFileError extends Error {
    constructor(file: string, reason: string) {
        super(`${file} is not a stored-bars file: ${reason}`);
        this.name = 'InvalidBarsFileError';
    }
}

/**
 * The bars of a stored-bars file (`{ bars: [{ time, open, high, low, close, volume }] }`).
 * Throws `InvalidBarsFileError` naming the file when the shape is not that, instead of
 * letting a wrong file fail somewhere inside the evaluation.
 */
export function parseStoredBars(file: string, text: string): Bar[] {
    const parsed: unknown = JSON.parse(text);
    const bars =
        typeof parsed === 'object' && parsed !== null && 'bars' in parsed
            ? parsed.bars
            : undefined;
    if (!Array.isArray(bars))
        throw new InvalidBarsFileError(file, 'no `bars` array');
    const bad = bars.findIndex(
        bar =>
            typeof bar !== 'object' ||
            bar === null ||
            BAR_FIELDS.some(field => typeof bar[field] !== 'number')
    );
    if (bad >= 0) {
        throw new InvalidBarsFileError(
            file,
            `bar ${bad} lacks numeric ${BAR_FIELDS.join(', ')}`
        );
    }
    // Every element was just checked to carry the six numeric `Bar` fields.
    return bars as Bar[];
}

/** A plain directory of `<SYMBOL>.json` files, fingerprinted by the hash of every file. */
export function loadBarsDir(dir: string): LoadedData {
    const files = readdirSync(dir)
        .filter(name => name.endsWith('.json'))
        .toSorted((a, b) => a.localeCompare(b, 'en'));
    const contents = files.map(name => readFileSync(join(dir, name)));
    return {
        kind: 'bars',
        fingerprint: sha256Hex(
            files
                .map((name, i) => `${name}:${sha256Hex(contents[i])}`)
                .join('\n')
        ),
        symbols: files.map((name, i) => {
            const symbol = name.slice(0, -'.json'.length);
            return {
                symbol,
                market: marketOfSymbol(symbol),
                bars: parseStoredBars(name, contents[i].toString('utf-8')),
            };
        }),
        cases: [],
    };
}

// ─── Running ──────────────────────────────────────────────────────────────────

function mergeCounters(parts: readonly PatternCounters[]): PatternCounters {
    const keys = [...new Set(parts.flatMap(part => Object.keys(part)))];
    return Object.fromEntries(
        keys.map(key => [
            key,
            parts.reduce((sum, part) => sum + (part[key] ?? 0), 0),
        ])
    );
}

/** Case lines of every case whose `asOf` bar exists, and how many cases had none. */
function caseLinesOf(data: LoadedData): {
    rows: CaseCandleLines[];
    skipped: number;
} {
    const bySymbol = new Map(data.symbols.map(s => [s.symbol, s.bars]));
    const rows = data.cases.flatMap(c => {
        const bars = bySymbol.get(c.symbol);
        if (bars === undefined) return [];
        const asOfSeconds = Date.parse(`${c.asOf}T00:00:00Z`) / 1000;
        const t = bars.findIndex(bar => bar.time === asOfSeconds);
        return t < 0 ? [] : [caseCandleLines(bars, t)];
    });
    return { rows, skipped: data.cases.length - rows.length };
}

/**
 * sha256 of everything that differs from the commit: the tracked diff plus every untracked,
 * non-ignored file (path and content hash). `null` on a clean tree. Two runs with the same
 * `+dirty` sha and the same hash ran the same code.
 */
export function dirtyDiffSha256(): string | null {
    if (gitOutput(['status', '--porcelain']) === '') return null;
    const untracked = gitOutput(['ls-files', '--others', '--exclude-standard'])
        .split('\n')
        .filter(file => file !== '')
        .toSorted()
        .map(
            file => `${file}\0${sha256Hex(readFileSync(join(REPO_ROOT, file)))}`
        );
    return sha256Hex([gitOutput(['diff', 'HEAD']), ...untracked].join('\n'));
}

export interface EngineEvalDeps {
    log: (line: string) => void;
    gitSha: () => string;
    dirtyDiffSha256: () => string | null;
}

export const defaultDeps: EngineEvalDeps = {
    log: console.log,
    gitSha: () =>
        `${gitOutput(['rev-parse', 'HEAD'])}${gitOutput(['status', '--porcelain']) === '' ? '' : '+dirty'}`,
    dirtyDiffSha256,
};

/** Writes the run and returns its exit code: 0, or 2 when the `--gate` did not pass. */
export function runEngineEval(
    args: EngineEvalArgs,
    deps: EngineEvalDeps
): number {
    assertOutsideRepo(args.out);
    const data =
        args.set !== null ? loadSet(args.set) : loadBarsDir(args.bars ?? '');
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
    deps.log(`arm ${args.arm}: ${symbols.length} symbols (${data.kind})`);

    const perSymbol = symbols.map(({ symbol, market, bars }, i) => {
        const candles: CandleEvent[] =
            args.only === 'patterns'
                ? []
                : candleEventsForSymbol(symbol, market, bars);
        const patterns: { events: PatternEvent[]; counters: PatternCounters } =
            args.only === 'candles'
                ? { events: [], counters: {} }
                : patternWalkForSymbol(symbol, market, bars);
        deps.log(
            `  ${i + 1}/${symbols.length} ${symbol}: ${candles.length} candle events, ${patterns.events.length} pattern events`
        );
        return { candles, patterns };
    });
    const candleEvents = perSymbol.flatMap(s => s.candles);
    const patternEvents = perSymbol.flatMap(s => s.patterns.events);
    const counters = mergeCounters(perSymbol.map(s => s.patterns.counters));

    const cases =
        args.only === 'patterns' || data.cases.length === 0
            ? null
            : caseLinesOf(data);
    if (cases !== null && cases.skipped > 0) {
        deps.log(
            `WARNING: ${cases.skipped} case(s) have no bar at their asOf date and are not in the case lines`
        );
    }
    const summary = summarizeArm({
        arm: args.arm,
        weeks: weeksOfTimes(symbols.flatMap(s => s.bars.map(bar => bar.time))),
        gate: args.gate,
        candleEvents: args.only === 'patterns' ? null : candleEvents,
        patternEvents: args.only === 'candles' ? null : patternEvents,
        patternCounters: args.only === 'candles' ? null : counters,
        caseLines: cases?.rows ?? null,
        skippedCases: cases?.skipped ?? 0,
    });
    const events: EvalEvent[] = [...candleEvents, ...patternEvents];
    writeFileAtomic(
        join(args.out, 'run.json'),
        `${JSON.stringify(
            {
                tool: 'engineEval',
                arm: args.arm,
                coreGitSha: deps.gitSha(),
                dirtyDiffSha256: deps.dirtyDiffSha256(),
                source: {
                    kind: data.kind,
                    fingerprint: data.fingerprint,
                    symbols: symbols.map(s => s.symbol),
                },
                only: args.only,
                gate: args.gate,
                horizons: HORIZONS,
                constants: { ...EVAL_CONSTANTS, derived: CORE_DERIVED },
            },
            null,
            2
        )}\n`
    );
    writeFileAtomic(
        join(args.out, 'events.jsonl'),
        events.map(e => `${JSON.stringify(e)}\n`).join('')
    );
    writeFileAtomic(
        join(args.out, 'summary.json'),
        `${JSON.stringify(summary, null, 2)}\n`
    );
    deps.log(`wrote ${args.out}`);
    // A gated run that did not pass exits 2 (errors throw and exit 1). A skipped case is a
    // case the numbers silently lack, so under a gate it fails the run unless allowed.
    const skippedFails =
        args.gate !== null &&
        !args.allowSkippedCases &&
        (cases?.skipped ?? 0) > 0;
    if (skippedFails) {
        deps.log(
            'FAIL: skipped cases under --gate (pass --allow-skipped-cases to accept)'
        );
    }
    return summary.g1.pass === false || skippedFails ? 2 : 0;
}

if (require.main === module) {
    try {
        process.exitCode = runEngineEval(
            parseEngineEvalArgs(process.argv.slice(2)),
            defaultDeps
        );
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
