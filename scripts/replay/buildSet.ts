/**
 * Builds the frozen replay set from per-symbol bars files. Pure and deterministic: no
 * random numbers, no clock (the creation time is an argument), no network.
 *
 * Usage:
 *   npx tsx scripts/replay/buildSet.ts --bars <dir> --out <set-dir> [--created-at <iso>] [--allow-partial] [--force]
 *
 * `--bars` holds `<SYMBOL>.json` (the `StoredBars` shape). `--out` must be outside the
 * repository; it receives `manifest.json` and a verbatim copy of each bars file under
 * `bars/`, whose sha256 the manifest records.
 *
 * Case selection, per symbol:
 *  - candidate dates: bars with at least {@link MIN_PRIOR_BARS} bars before and
 *    {@link MIN_LATER_BARS} after them;
 *  - regime of a candidate from the symbol's own bars, first match wins: `crash` (20-bar
 *    return ≤ −20%), `downtrend` (close below SMA200 and 60-bar return ≤ −10%), `uptrend`
 *    (close above SMA200 and 60-bar return ≥ +10%), else `range`;
 *  - per regime, in the order crash, downtrend, uptrend, range, the quota
 *    ({@link CASES_PER_REGIME}) of candidates evenly spaced over that regime's candidate
 *    dates, each dropped when fewer than {@link MIN_GAP_BARS} bars from a date already
 *    chosen for the symbol (so forward windows never overlap).
 * The variance subset is the first {@link VARIANCE_CASES_PER_REGIME} cases of each regime
 * ordered by sha256 of the case id.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from '../ab-harness/cliArgs';
import { assertOutsideRepo, sha256Hex, writeJsonAtomic } from './fsUtil';
import { marketOfSymbol, profileOf } from './markets';
import { REPLAY_SYMBOLS } from './symbols';
import {
    REPLAY_REGIMES,
    REPLAY_SET_ID,
    type ReplayBarsEntry,
    type ReplayCase,
    type ReplayManifest,
    type ReplayRegime,
    type StoredBars,
} from './types';

const SECONDS_PER_DAY = 86_400;
export const MIN_PRIOR_BARS = 260;
export const MIN_LATER_BARS = 20;
export const MIN_GAP_BARS = 20;
export const SMA_PERIOD = 200;
export const CRASH_BARS = 20;
export const CRASH_RETURN = -0.2;
export const TREND_BARS = 60;
export const DOWNTREND_RETURN = -0.1;
export const UPTREND_RETURN = 0.1;
export const VARIANCE_CASES_PER_REGIME = 25;

export const CASES_PER_REGIME: Readonly<Record<ReplayRegime, number>> = {
    crash: 2,
    downtrend: 4,
    uptrend: 4,
    range: 4,
};

/** `(close − earlier) / earlier`, written so that exact ratios such as 80 vs 100 give exactly −0.2. */
function changeSince(
    closes: readonly number[],
    i: number,
    bars: number
): number {
    const earlier = closes[i - bars];
    return (closes[i] - earlier) / earlier;
}

function smaAt(closes: readonly number[], i: number, period: number): number {
    const window = closes.slice(i - period + 1, i + 1);
    return window.reduce((sum, close) => sum + close, 0) / period;
}

/**
 * Regime of bar `i` from the symbol's own closes. Needs `i ≥ SMA_PERIOD − 1`; candidates
 * always have more bars before them than that.
 */
export function classifyRegime(
    closes: readonly number[],
    i: number
): ReplayRegime {
    if (changeSince(closes, i, CRASH_BARS) <= CRASH_RETURN) return 'crash';
    const trend = changeSince(closes, i, TREND_BARS);
    const sma = smaAt(closes, i, SMA_PERIOD);
    if (closes[i] < sma && trend <= DOWNTREND_RETURN) return 'downtrend';
    if (closes[i] > sma && trend >= UPTREND_RETURN) return 'uptrend';
    return 'range';
}

/**
 * `count` entries evenly spaced over `items`: the centre of each of `count` equal slices.
 * All of `items` when there are no more than `count`.
 */
export function pickEvenly<T>(
    items: readonly T[],
    count: number
): readonly T[] {
    if (items.length <= count) return items;
    return Array.from(
        { length: count },
        (_, j) => items[Math.floor(((2 * j + 1) * items.length) / (2 * count))]
    );
}

/**
 * Keeps each pick that is at least `minGap` bars from every index kept before it
 * (`chosen` are indices already taken, e.g. by an earlier regime).
 */
export function dropNearIndices(
    picks: readonly number[],
    chosen: readonly number[],
    minGap: number
): readonly number[] {
    // Each pick is judged against the ones kept before it, so the state is carried across
    // steps in one pass (CONVENTIONS.md#CP-5).
    const kept: number[] = [];
    for (const index of picks) {
        if (
            [...chosen, ...kept].every(
                other => Math.abs(index - other) >= minGap
            )
        ) {
            kept.push(index);
        }
    }
    return kept;
}

export function isoDateOf(timeSeconds: number): string {
    return new Date(timeSeconds * 1000).toISOString().slice(0, 10);
}

/** Bar indices of one symbol's cases (ascending), with their regime. */
export function selectCaseIndices(
    closes: readonly number[]
): readonly { index: number; regime: ReplayRegime }[] {
    const candidates = Array.from(
        {
            length: Math.max(
                0,
                closes.length - MIN_LATER_BARS - MIN_PRIOR_BARS
            ),
        },
        (_, k) => MIN_PRIOR_BARS + k
    ).map(index => ({ index, regime: classifyRegime(closes, index) }));
    // Regimes are taken in order and each one sees the dates the earlier ones claimed:
    // state carried across steps in one pass (CONVENTIONS.md#CP-5).
    const chosen: { index: number; regime: ReplayRegime }[] = [];
    for (const regime of REPLAY_REGIMES) {
        const ofRegime = candidates
            .filter(candidate => candidate.regime === regime)
            .map(candidate => candidate.index);
        const picks = pickEvenly(ofRegime, CASES_PER_REGIME[regime]);
        dropNearIndices(
            picks,
            chosen.map(entry => entry.index),
            MIN_GAP_BARS
        ).forEach(index => chosen.push({ index, regime }));
    }
    return chosen.toSorted((a, b) => a.index - b.index);
}

/** Cases of one symbol, `variance` unset (it is decided over the whole set). */
export function selectSymbolCases(
    symbol: string,
    stored: StoredBars
): readonly ReplayCase[] {
    const closes = stored.bars.map(bar => bar.close);
    return selectCaseIndices(closes).map(({ index, regime }) => {
        const asOf = isoDateOf(stored.bars[index].time);
        return {
            caseId: `${symbol}|${asOf}`,
            symbol,
            timeframe: '1Day',
            asOf,
            regime,
            variance: false,
        };
    });
}

/** Marks the first {@link VARIANCE_CASES_PER_REGIME} cases of each regime by sha256 of the case id. */
export function assignVarianceFlags(
    cases: readonly ReplayCase[]
): readonly ReplayCase[] {
    const flagged = new Set(
        REPLAY_REGIMES.flatMap(regime =>
            cases
                .filter(c => c.regime === regime)
                .map(c => ({ caseId: c.caseId, key: sha256Hex(c.caseId) }))
                .toSorted((a, b) =>
                    a.key < b.key ? -1 : a.key > b.key ? 1 : 0
                )
                .slice(0, VARIANCE_CASES_PER_REGIME)
                .map(c => c.caseId)
        )
    );
    return cases.map(c => ({ ...c, variance: flagged.has(c.caseId) }));
}

/** Throws unless the bars are finite and strictly increasing in time. */
export function assertUsableBars(symbol: string, stored: StoredBars): void {
    const bad = stored.bars.findIndex(
        (bar, i) =>
            ![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite) ||
            !Number.isFinite(bar.time) ||
            (i > 0 && bar.time <= stored.bars[i - 1].time)
    );
    if (bad !== -1) {
        throw new Error(
            `${symbol}: bar ${bad} is not finite or not in time order`
        );
    }
    // `storedProvider` and `label.ts` look bars up by the UTC-midnight stamp of a date.
    const offMidnight = stored.bars.findIndex(
        bar => bar.time % SECONDS_PER_DAY !== 0
    );
    if (offMidnight !== -1) {
        throw new Error(
            `${symbol}: bar ${offMidnight} is not stamped at UTC midnight (time ${stored.bars[offMidnight].time})`
        );
    }
    if (stored.ticker !== symbol) {
        throw new Error(`${symbol}: file names ticker ${stored.ticker}`);
    }
}

export interface BarsInput {
    symbol: string;
    /** The file's exact bytes; their sha256 goes into the manifest. */
    raw: string;
    stored: StoredBars;
}

function barsEntry(input: BarsInput): ReplayBarsEntry {
    const market = marketOfSymbol(input.symbol);
    const { bars } = input.stored;
    return {
        file: `bars/${input.symbol}.json`,
        sha256: sha256Hex(input.raw),
        from: isoDateOf(bars[0].time),
        to: isoDateOf(bars[bars.length - 1].time),
        count: bars.length,
        market,
        currency: profileOf(market).currency,
    };
}

/** The manifest of a set: bars entries in symbol order, cases by symbol then date. */
export function buildManifest(
    inputs: readonly BarsInput[],
    createdAt: string
): ReplayManifest {
    const ordered = inputs.toSorted((a, b) =>
        a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0
    );
    ordered.forEach(input => assertUsableBars(input.symbol, input.stored));
    const cases = assignVarianceFlags(
        ordered.flatMap(input => selectSymbolCases(input.symbol, input.stored))
    );
    return {
        setId: REPLAY_SET_ID,
        createdAt,
        frozen: true,
        bars: Object.fromEntries(
            ordered
                .filter(input => input.stored.bars.length > 0)
                .map(input => [input.symbol, barsEntry(input)])
        ),
        cases: [...cases],
    };
}

/** Symbols of {@link REPLAY_SYMBOLS} that have no file in `dir`. */
export function missingSymbols(dir: string): readonly string[] {
    return REPLAY_SYMBOLS.filter(
        symbol => !existsSync(join(dir, `${symbol}.json`))
    );
}

function loadInputs(
    dir: string,
    symbols: readonly string[]
): readonly BarsInput[] {
    return symbols.map(symbol => {
        const raw = readFileSync(join(dir, `${symbol}.json`), 'utf-8');
        // The cast types the parsed file as the shape `fetchBars.ts` and the app-side snippet
        // write; `assertUsableBars` then checks the parts the selection reads (finite prices,
        // time order, UTC midnight, ticker), so a file of another shape fails there.
        return { symbol, raw, stored: JSON.parse(raw) as StoredBars };
    });
}

/**
 * Writes the set under `out`. Refuses an existing manifest unless `force` (a frozen set is
 * replaced on purpose, never by accident).
 */
export function writeSet(
    barsDir: string,
    out: string,
    options: { createdAt: string; allowPartial: boolean; force: boolean }
): ReplayManifest {
    assertOutsideRepo(out);
    const missing = missingSymbols(barsDir);
    if (missing.length > 0 && !options.allowPartial) {
        throw new Error(
            `missing bars for ${missing.length} symbols (${missing.join(', ')}); pass --allow-partial to build anyway`
        );
    }
    if (existsSync(join(out, 'manifest.json')) && !options.force) {
        throw new Error(
            `${out} already holds a set; pass --force to replace it`
        );
    }
    const present = REPLAY_SYMBOLS.filter(symbol => !missing.includes(symbol));
    const manifest = buildManifest(
        loadInputs(barsDir, present),
        options.createdAt
    );
    mkdirSync(join(out, 'bars'), { recursive: true });
    present.forEach(symbol =>
        copyFileSync(
            join(barsDir, `${symbol}.json`),
            join(out, `bars/${symbol}.json`)
        )
    );
    writeJsonAtomic(join(out, 'manifest.json'), manifest);
    return manifest;
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    if (!args.bars || !args.out) {
        throw new Error(
            'usage: buildSet.ts --bars <dir> --out <set-dir> [--created-at <iso>] [--allow-partial] [--force]'
        );
    }
    const manifest = writeSet(resolve(args.bars), resolve(args.out), {
        createdAt: args['created-at'] ?? new Date().toISOString(),
        allowPartial: args['allow-partial'] === 'true',
        force: args.force === 'true',
    });
    const perRegime = REPLAY_REGIMES.map(
        regime =>
            `${regime} ${manifest.cases.filter(c => c.regime === regime).length}`
    ).join(', ');
    console.log(
        `wrote ${Object.keys(manifest.bars).length} symbols, ${manifest.cases.length} cases (${perRegime}); variance ${manifest.cases.filter(c => c.variance).length}`
    );
}

if (require.main === module) {
    main();
}
