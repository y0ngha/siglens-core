/**
 * The measured signal base-rate table generator (WP-32 G14-core): turns the daily bars of the
 * frozen replay set into `src/domain/signals/measuredSignalBaseRates.ts`, one entry per
 * confirmed signal type with the share of directional moves after the signal against a
 * matched same-symbol placebo at 1, 5, 10 and 20 bars.
 *
 *   npx tsx scripts/replay/signalBaseRateTable.ts --set <set dir> --date <YYYY-MM-DD> \
 *       --out <file> [--json <file>] [--allow-dirty]
 *
 * The definitions are pre-registered in `signalBaseRateCompute.ts`. The generator fails
 * closed (exit 2, CONVENTIONS.md#TE-16) on a dirty checkout, a set whose bars fingerprint it does not know,
 * a signal type with no episode and a horizon it cannot compute; any other error exits 1.
 * It reads bars only (no network, no model, no randomness beyond the seeded placebo draw), so
 * the same checkout, set and `--date` give a byte-identical file. `--out` may be inside the
 * repository only at `src/domain/signals/measuredSignalBaseRates.ts`; the JSON companion
 * (every number the verdict rule read) goes outside it. `--allow-dirty` lets an uncommitted
 * checkout be inspected, is refused for the committed path, and keeps the `+dirty` sha.
 *
 * Reproduction: `SIGNAL_BASE_RATE_SET=<set dir> yarn test
 * src/__tests__/scripts/replay/signalBaseRateTable.test.ts` regenerates the table from the
 * set and compares it with the committed file (everything below the header).
 */
import { join, resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { parseArgs } from '../ab-harness/cliArgs';
import { loadSet, dirtyDiffSha256 } from './engineEval';
import { weeksOfTimes } from './engineEvalStats';
import { FailClosedError } from './failClosed';
import { EVAL_CONSTANTS, type EvalMarket } from './engineEvalTypes';
import {
    REPO_ROOT,
    assertOutsideRepo,
    gitOutput,
    sha256Hex,
    writeFileAtomic,
} from './fsUtil';
import {
    SIGNAL_HORIZONS,
    assertHorizonsUnchanged,
    episodesForSymbol,
    signalTable,
    type SignalRow,
} from './signalBaseRateCompute';
import { OUTCOME_LABEL_VERSION } from '@/domain/outcomes/constants';
import { confirmedSignalTimeline } from '@/domain/signals/timeline';
import { REPLAY_SET_ID } from './types';

/** The one place inside the repository the table may be written. */
export const SIGNAL_TABLE_PATH = join(
    REPO_ROOT,
    'src',
    'domain',
    'signals',
    'measuredSignalBaseRates.ts'
);

/**
 * Bars fingerprints of the sets this table may be generated from (`barsFingerprint` of the
 * manifest). The table's scope sentence names this set, so another set is a decision.
 */
export const KNOWN_SET_FINGERPRINTS: readonly string[] = [
    '0ba4d6a50b731f880777cd867c6e472903d9c7311b2a2476fc588a3d87ec9f0e',
];

export interface SignalTableArgs {
    set: string;
    out: string;
    json: string | null;
    date: string;
    allowDirty: boolean;
}

export function parseSignalTableArgs(argv: readonly string[]): SignalTableArgs {
    const raw = parseArgs(argv);
    const missing = (['set', 'out', 'date'] as const).filter(
        name => !raw[name]
    );
    if (missing.length > 0) {
        throw new Error(`missing ${missing.map(m => `--${m}`).join(', ')}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) {
        throw new Error('--date must be YYYY-MM-DD');
    }
    return {
        set: resolve(raw.set),
        out: resolve(raw.out),
        json: raw.json === undefined ? null : resolve(raw.json),
        date: raw.date,
        allowDirty: raw['allow-dirty'] === 'true',
    };
}

// ─── Rendering ────────────────────────────────────────────────────────────────

export interface SignalTableHeader {
    setId: string;
    fingerprint: string;
    coreSha: string;
    definitions: string;
    date: string;
    command: string;
}

const round6 = (value: number): number => Number(value.toFixed(6));
const literal = (value: string): string => `'${value.replaceAll("'", "\\'")}'`;

function horizonSource(cell: SignalRow['horizons'][number]): string {
    const head = `h: ${cell.h},\nn: ${cell.n},\nverdict: ${literal(cell.verdict)},`;
    if (cell.stats === null) {
        return `{ ${head}\neventShare: null,\nplaceboShare: null,\ndifference: null }`;
    }
    const { eventShare, placeboShare, difference } = cell.stats;
    return `{ ${head}
eventShare: ${round6(eventShare)},
placeboShare: ${round6(placeboShare)},
difference: { mean: ${round6(difference.mean)}, low: ${round6(difference.low)}, high: ${round6(difference.high)} } }`;
}

function rowSource(row: SignalRow): string {
    const { scope } = row;
    return `${row.signalType}: {
signalType: ${literal(row.signalType)},
direction: ${literal(row.direction)},
horizons: [${row.horizons.map(horizonSource).join(',\n')}],
scope: {
timeframe: ${literal(scope.timeframe)},
markets: [${scope.markets.map(m => `{ market: ${literal(m.market)}, symbols: ${m.symbols} }`).join(', ')}],
composition: ${literal(scope.composition)},
symbols: ${scope.symbols},
from: ${literal(scope.from)},
to: ${literal(scope.to)},
},
},`;
}

export function renderSignalTable(input: {
    header: SignalTableHeader;
    rows: readonly SignalRow[];
}): string {
    const { header } = input;
    return `/**
 * GENERATED by scripts/replay/signalBaseRateTable.ts. Do not edit by hand: change the
 * instrument and regenerate.
 *
 * Measured past record of each confirmed signal type on the replay set (daily bars,
 * aggregate shares only, no return figure). For the first confirmed bar of a signal's
 * episode, the share of episodes whose close \`h\` bars later lies on the signal's side of
 * the anchor close, next to the same share on matched placebo dates of the same symbol, at
 * 1, 5, 10 and 20 bars, with the episode count \`n\` of each horizon and a verdict.
 *
 * Scope (every entry carries it): the symbols of the set pooled across markets (not split),
 * the anchor period from \`scope.from\` to \`scope.to\`, daily bars. A claim made from an entry
 * must state that composition, the horizon and \`n\`; it is a record of the past, not a
 * forecast. Below BASE_RATE_MIN_N episodes at a horizon the verdict is
 * \`insufficient_sample\` and no share is stored.
 *
 * Set: ${header.setId}, bars fingerprint ${header.fingerprint}
 * Core: ${header.coreSha} (${header.coreSha.endsWith('+dirty') ? 'DIRTY checkout: do not commit' : 'clean checkout'})
 * Definitions: ${header.definitions}
 * Generated: ${header.date}
 * Command: ${header.command}
 */
import type { BaseRateVerdict } from '@/domain/analysis/measuredBaseRates';
import type {
    ConfirmedSignalType,
    SignalDirection,
    Timeframe,
} from '@/domain/types';

/** One horizon of an entry. \`eventShare\` and its siblings are \`null\` exactly for \`insufficient_sample\`. */
export interface MeasuredSignalHorizon {
    /** Bars after the signal's first confirmed bar. */
    readonly h: 1 | 5 | 10 | 20;
    /** Episodes with an outcome at this horizon. */
    readonly n: number;
    readonly verdict: BaseRateVerdict;
    /** Share of episodes that moved in the signal's direction by \`h\` bars (a share, never a return). */
    readonly eventShare: number | null;
    /** The same share on matched placebo dates of the same symbols. */
    readonly placeboShare: number | null;
    /** eventShare - placeboShare with its 95% week-cluster bootstrap interval. */
    readonly difference: {
        readonly mean: number;
        readonly low: number;
        readonly high: number;
    } | null;
}

/** What the measurement covers. Always quote it with a figure from the entry. */
export interface MeasuredSignalScope {
    readonly timeframe: '1Day';
    /** Symbols measured per market; the episodes of all of them are pooled, not split. */
    readonly markets: readonly {
        readonly market: 'us' | 'kr';
        readonly symbols: number;
    }[];
    readonly composition: 'pooled';
    readonly symbols: number;
    /** First and last anchor date, \`YYYY-MM-DD\`. */
    readonly from: string;
    readonly to: string;
}

/** An entry has all four horizons (1, 5, 10, 20 bars, in this order) or does not exist. */
export interface MeasuredSignalBaseRate {
    readonly signalType: ConfirmedSignalType;
    readonly direction: SignalDirection;
    readonly horizons: readonly [
        MeasuredSignalHorizon,
        MeasuredSignalHorizon,
        MeasuredSignalHorizon,
        MeasuredSignalHorizon,
    ];
    readonly scope: MeasuredSignalScope;
}

export const MEASURED_SIGNAL_BASE_RATES: Readonly<
    Record<ConfirmedSignalType, MeasuredSignalBaseRate>
> = {
${input.rows.map(rowSource).join('\n')}
};

/**
 * The measured record of a confirmed signal type; \`null\` off daily bars (nothing was
 * measured there) and for a type without an entry.
 */
export function measuredSignalBaseRateFor(
    type: string,
    timeframe: Timeframe
): MeasuredSignalBaseRate | null {
    if (timeframe !== '1Day') return null;
    return (
        Object.entries(MEASURED_SIGNAL_BASE_RATES).find(
            ([key]) => key === type
        )?.[1] ?? null
    );
}
`;
}

// ─── Generation ───────────────────────────────────────────────────────────────

/** Runs `compute`, turning any throw of the pure instrument into a fail-closed refusal. */
function failClosed<T>(compute: () => T): T {
    try {
        return compute();
    } catch (error) {
        throw new FailClosedError(
            error instanceof Error ? error.message : String(error)
        );
    }
}

export interface GeneratedSignalTable {
    source: string;
    json: unknown;
}

export interface SignalTableDeps {
    gitSha: () => string;
    dirtyDiffSha256: () => string | null;
    knownFingerprints: readonly string[];
    log: (line: string) => void;
}

export const defaultSignalTableDeps: SignalTableDeps = {
    gitSha: () =>
        `${gitOutput(['rev-parse', 'HEAD'])}${gitOutput(['status', '--porcelain']) === '' ? '' : '+dirty'}`,
    dirtyDiffSha256,
    knownFingerprints: KNOWN_SET_FINGERPRINTS,
    log: console.log,
};

/** The table's source (formatted with the repository's prettier config) and its JSON companion. */
export async function generateSignalTable(
    args: SignalTableArgs,
    deps: SignalTableDeps
): Promise<GeneratedSignalTable> {
    assertHorizonsUnchanged();
    const coreSha = deps.gitSha();
    if (
        !args.allowDirty &&
        (coreSha.endsWith('+dirty') || deps.dirtyDiffSha256() !== null)
    ) {
        throw new FailClosedError(
            `the checkout is dirty (${coreSha}); regenerate on a clean main`
        );
    }
    const data = loadSet(args.set);
    if (!deps.knownFingerprints.includes(data.fingerprint)) {
        throw new FailClosedError(
            `unknown set fingerprint ${data.fingerprint}: the table's scope was written for ${deps.knownFingerprints.join(', ')}`
        );
    }
    const perSymbol = data.symbols.map(({ symbol, market, bars }, i) => {
        deps.log(`  ${i + 1}/${data.symbols.length} ${symbol}`);
        const days = confirmedSignalTimeline(bars, {
            days: bars.length - (EVAL_CONSTANTS.minPriorBars - 1),
        });
        return {
            symbol,
            market,
            ...failClosed(() => episodesForSymbol(symbol, market, bars, days)),
        };
    });
    const markets = (['us', 'kr'] as const satisfies readonly EvalMarket[]).map(
        market => ({
            market,
            symbols: data.symbols.filter(s => s.market === market).length,
        })
    );
    const table = failClosed(() =>
        signalTable(
            perSymbol.flatMap(s => s.episodes),
            weeksOfTimes(
                data.symbols.flatMap(s => s.bars.map(bar => bar.time))
            ),
            markets.filter(m => m.symbols > 0)
        )
    );
    const definitions = `outcome labels v${OUTCOME_LABEL_VERSION}, horizons ${SIGNAL_HORIZONS.join('/')}, constants ${sha256Hex(
        JSON.stringify({ ...EVAL_CONSTANTS, horizons: SIGNAL_HORIZONS })
    ).slice(0, 12)}`;
    const command = `npx tsx scripts/replay/signalBaseRateTable.ts --set <replay-v1 set dir> --date ${args.date}`;
    const raw = renderSignalTable({
        header: {
            setId: REPLAY_SET_ID,
            fingerprint: data.fingerprint,
            coreSha,
            definitions,
            date: args.date,
            command,
        },
        rows: table.rows,
    });
    const config = (await resolveConfig(SIGNAL_TABLE_PATH)) ?? {};
    return {
        source: await format(raw, { ...config, parser: 'typescript' }),
        json: {
            definitions,
            command,
            episodeCounts: table.episodeCounts,
            details: table.details,
            droppedNoPlacebo: perSymbol
                .filter(s => Object.keys(s.dropped).length > 0)
                .map(s => ({ symbol: s.symbol, dropped: s.dropped })),
            unevaluatedDays: perSymbol.reduce(
                (sum, s) => sum + s.unevaluatedDays,
                0
            ),
        },
    };
}

/** Reads the set, writes the table and returns the exit code: 0, or 2 when it refused. */
export async function runSignalBaseRateTable(
    args: SignalTableArgs,
    deps: SignalTableDeps = defaultSignalTableDeps
): Promise<number> {
    if (args.out === SIGNAL_TABLE_PATH) {
        if (args.allowDirty) {
            throw new Error(
                '--allow-dirty cannot write the committed table: regenerate on a clean main'
            );
        }
    } else {
        assertOutsideRepo(args.out);
    }
    if (args.json !== null) assertOutsideRepo(args.json);
    try {
        const generated = await generateSignalTable(args, deps);
        writeFileAtomic(args.out, generated.source);
        if (args.json !== null) {
            writeFileAtomic(
                args.json,
                `${JSON.stringify(generated.json, null, 2)}\n`
            );
        }
        deps.log(`wrote ${args.out}`);
        return 0;
    } catch (error) {
        if (error instanceof FailClosedError) {
            deps.log(`FAIL: ${error.message}`);
            return 2;
        }
        throw error;
    }
}

if (require.main === module) {
    runSignalBaseRateTable(parseSignalTableArgs(process.argv.slice(2)))
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
