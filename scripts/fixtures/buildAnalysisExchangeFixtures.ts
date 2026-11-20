/**
 * One-off builder of the 12 real-exchange fixtures under
 * `src/__tests__/fixtures/analysisExchanges/` (committed; this script is only needed to
 * regenerate them).
 *
 * Source: a local copy of the published daily-AI backtest data (`ai/raw/{TICKER}/*.json.gz`
 * holds each stored DeepSeek HTTP exchange, `ai/{TICKER}.json` the call index,
 * `ai/prompts/…` the prompt record with its template version, `dataset/{TICKER}.json.gz`
 * the per-day close and ATR). The source is read-only; nothing is fetched and no model is
 * called. Only what the checks need is copied: the dynamic prompt (the request `input`),
 * the concatenated `response.output_text.delta` text, and the day's close and ATR. The
 * system prompt, request options, response metadata and every header are left behind.
 *
 * Usage:
 *   npx tsx scripts/fixtures/buildAnalysisExchangeFixtures.ts --v8-data <dir> [--out <dir>] [--dry-run]
 *   npx tsx scripts/fixtures/buildAnalysisExchangeFixtures.ts --v8-data <dir> --report
 *
 * `--report` writes nothing: it runs the checks over every stored exchange and prints the
 * invariant violations per rule and the plan-provenance rate (a measurement, not a gate).
 *
 * Selection scans every exchange in sorted (ticker, key) order and takes, per class and
 * in this order, the first not-yet-chosen matches: 1 trailing-content salvage, 1 reversed
 * entry array, 2 raw stop at or above the zone low, 2 raw first target at or below the
 * zone high, 2 ungrounded plan price, 4 clean. The classes are decided by
 * {@link evaluateAnalysisExchange}, the same function the fixture tests run. Of an
 * exchange file the last HTTP 200 exchange is used: the one whose reply the run stored.
 */
import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { parseArgs } from '../ab-harness/cliArgs';
import { priceQuoting } from '@/domain/analysis/promptFormat';
import {
    evaluateAnalysisExchange,
    falseGroundingRate,
    type AnalysisExchangeEvaluation,
    type AnalysisExchangeFixture,
} from './evaluateAnalysisExchange';

export type FixtureClass =
    | 'salvage'
    | 'reversed_entry'
    | 'stop_not_below_zone'
    | 'target_not_above_zone'
    | 'ungrounded_plan_price'
    | 'clean';

/** Per-class quota, in selection order (a class is filled completely before the next). */
export const FIXTURE_QUOTAS: readonly { cls: FixtureClass; count: number }[] = [
    { cls: 'salvage', count: 1 },
    { cls: 'reversed_entry', count: 1 },
    { cls: 'stop_not_below_zone', count: 2 },
    { cls: 'target_not_above_zone', count: 2 },
    { cls: 'ungrounded_plan_price', count: 2 },
    { cls: 'clean', count: 4 },
];

const SOURCE = 'backtest-2026-11-daily-ai';
/**
 * Largest gzipped fixture a candidate may be. Twelve of them plus `expected.json` have to
 * stay under the 400 KB budget, so an unusually long prompt (many skills, many patterns)
 * is passed over rather than squeezing the others.
 */
export const MAX_FIXTURE_BYTES = 33_000;
const DEFAULT_OUT = join(
    __dirname,
    '../../src/__tests__/fixtures/analysisExchanges'
);
const DELTA_EVENT = 'response.output_text.delta';

interface StoredExchange {
    readonly status: number;
    readonly requestBody: { readonly input?: unknown };
    readonly responseText: string;
}

interface Candidate {
    readonly ticker: string;
    readonly key: string;
    readonly rawFile: string;
}

function readGzJson<T>(path: string): T {
    return JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as T;
}

/** The model's text: every `response.output_text.delta` of the stored SSE stream, in order. */
export function extractRawText(sse: string): string {
    return sse
        .split('\n')
        .filter(line => line.startsWith('data: '))
        .flatMap(line => {
            try {
                const event = JSON.parse(line.slice('data: '.length)) as {
                    type?: unknown;
                    delta?: unknown;
                };
                return event.type === DELTA_EVENT &&
                    typeof event.delta === 'string'
                    ? [event.delta]
                    : [];
            } catch {
                return [];
            }
        })
        .join('');
}

function stableId(candidate: Candidate): string {
    const [date, , hash] = candidate.key.split('|');
    return `${candidate.ticker}-${date}-${hash}`;
}

interface CallIndex {
    readonly calls: Record<string, { rawFile?: string; promptFile?: string }>;
}

/** Per-ticker files read once: the call index and the per-day dataset. */
const memo = new Map<string, unknown>();
function memoised<T>(path: string, read: () => T): T {
    if (!memo.has(path)) memo.set(path, read());
    return memo.get(path) as T;
}

function callIndex(dataDir: string, ticker: string): CallIndex {
    const path = join(dataDir, 'ai', `${ticker}.json`);
    return memoised(path, () =>
        JSON.parse(readFileSync(path, 'utf8'))
    ) as CallIndex;
}

/**
 * Every stored exchange in sorted (ticker, key) order, listed from the call index so the
 * (large) exchange files are only opened for the candidates that get evaluated.
 */
function listCandidates(dataDir: string): readonly Candidate[] {
    return readdirSync(join(dataDir, 'ai', 'raw'))
        .toSorted()
        .flatMap(ticker =>
            Object.entries(callIndex(dataDir, ticker).calls)
                .filter(([, call]) => call.rawFile !== undefined)
                .map(([key, call]) => ({
                    ticker,
                    key,
                    rawFile: join(dataDir, 'ai', call.rawFile as string),
                }))
                .toSorted((a, b) => a.key.localeCompare(b.key))
        );
}

interface DayRecord {
    readonly date: string;
    readonly close: number;
    readonly indicators: { readonly atr?: number | null };
}

function loadFixture(
    dataDir: string,
    candidate: Candidate
): AnalysisExchangeFixture | null {
    const { exchanges } = readGzJson<{ exchanges: StoredExchange[] }>(
        candidate.rawFile
    );
    const exchange = exchanges.findLast(e => e.status === 200);
    if (
        exchange === undefined ||
        typeof exchange.requestBody.input !== 'string'
    ) {
        return null;
    }
    const [date] = candidate.key.split('|');
    const datasetPath = join(dataDir, 'dataset', `${candidate.ticker}.json.gz`);
    const dataset = memoised(datasetPath, () =>
        readGzJson<{ days: DayRecord[] }>(datasetPath)
    );
    const day = dataset.days.find(d => d.date === date);
    if (day === undefined) return null;
    const index = callIndex(dataDir, candidate.ticker);
    const promptFile = index.calls[candidate.key]?.promptFile;
    if (promptFile === undefined) return null;
    const { promptVersion } = readGzJson<{ promptVersion: string }>(
        join(dataDir, 'ai', promptFile)
    );
    return {
        id: stableId(candidate),
        source: SOURCE,
        ticker: candidate.ticker,
        date,
        promptVersion,
        lastClose: day.close,
        atr: day.indicators.atr ?? null,
        dynamic: exchange.requestBody.input,
        rawText: extractRawText(exchange.responseText),
    };
}

/** Which classes a stored exchange belongs to; `null` when it cannot be evaluated. */
export function classify(
    evaluation: AnalysisExchangeEvaluation
): ReadonlySet<FixtureClass> {
    const rec = evaluation.rawRecommendation;
    const entries = (rec?.entryPrices ?? []).filter(
        p => Number.isFinite(p) && p > 0
    );
    const zoneLow = entries.length > 0 ? Math.min(...entries) : null;
    const zoneHigh = entries.length > 0 ? Math.max(...entries) : null;
    const planned = rec?.entryRecommendation !== 'avoid' && zoneLow !== null;
    const firstTarget = rec?.takeProfitPrices?.[0];
    const stop = rec?.stopLoss;
    const rawDefect = {
        reversed_entry:
            (rec?.entryPrices?.length ?? 0) >= 2 &&
            (rec?.entryPrices?.[0] ?? 0) > (rec?.entryPrices?.[1] ?? 0),
        stop_not_below_zone:
            planned &&
            zoneLow !== null &&
            typeof stop === 'number' &&
            Number.isFinite(stop) &&
            stop >= zoneLow,
        target_not_above_zone:
            planned &&
            zoneHigh !== null &&
            typeof firstTarget === 'number' &&
            Number.isFinite(firstTarget) &&
            firstTarget <= zoneHigh,
    };
    const ungrounded = evaluation.provenance.plan.length > 0;
    return new Set<FixtureClass>([
        ...(evaluation.needsTrailingContentSalvage
            ? (['salvage'] as const)
            : []),
        ...(rawDefect.reversed_entry ? (['reversed_entry'] as const) : []),
        ...(rawDefect.stop_not_below_zone
            ? (['stop_not_below_zone'] as const)
            : []),
        ...(rawDefect.target_not_above_zone
            ? (['target_not_above_zone'] as const)
            : []),
        ...(ungrounded ? (['ungrounded_plan_price'] as const) : []),
        ...(!evaluation.needsTrailingContentSalvage &&
        !rawDefect.reversed_entry &&
        !rawDefect.stop_not_below_zone &&
        !rawDefect.target_not_above_zone &&
        !ungrounded &&
        evaluation.invariants.length === 0 &&
        rec !== undefined &&
        rec.entryRecommendation !== 'avoid' &&
        zoneLow !== null
            ? (['clean'] as const)
            : []),
    ]);
}

function gzipBytes(fixture: AnalysisExchangeFixture): number {
    return gzipSync(JSON.stringify(fixture), { level: 9 }).length;
}

function evaluateCandidate(
    dataDir: string,
    candidate: Candidate
): ReadonlySet<FixtureClass> {
    try {
        const fixture = loadFixture(dataDir, candidate);
        if (fixture === null || gzipBytes(fixture) > MAX_FIXTURE_BYTES) {
            return new Set();
        }
        return classify(evaluateAnalysisExchange(fixture));
    } catch {
        // An exchange the production chain cannot normalize is not a fixture candidate.
        return new Set();
    }
}

/** The first `count` items satisfying `predicate`, evaluating it no further than needed. */
function takeFirst<T>(
    items: readonly T[],
    predicate: (item: T) => boolean,
    count: number,
    from = 0,
    found: readonly T[] = []
): readonly T[] {
    if (found.length >= count || from >= items.length) return found;
    const item = items[from];
    return takeFirst(
        items,
        predicate,
        count,
        from + 1,
        predicate(item) ? [...found, item] : found
    );
}

/**
 * Greedy per-class selection over `candidates` (already in scan order). `classesOf` is
 * called lazily and memoised, so a class that fills early never evaluates the tail.
 *
 * One fixture per ticker first: a class takes its first matches on tickers no earlier pick
 * used, and only when it still falls short does it take further matches on tickers
 * already used (a run with ten tickers cannot give twelve distinct ones).
 */
export function selectCandidates<T>(
    candidates: readonly T[],
    classesOf: (candidate: T) => ReadonlySet<FixtureClass>,
    tickerOf: (candidate: T) => string,
    quotas: readonly { cls: FixtureClass; count: number }[] = FIXTURE_QUOTAS
): readonly { cls: FixtureClass; candidate: T }[] {
    const memo = new Map<T, ReadonlySet<FixtureClass>>();
    const memoised = (candidate: T): ReadonlySet<FixtureClass> => {
        const cached = memo.get(candidate);
        if (cached !== undefined) return cached;
        const fresh = classesOf(candidate);
        memo.set(candidate, fresh);
        return fresh;
    };
    const pickOne = (
        chosen: readonly { cls: FixtureClass; candidate: T }[],
        cls: FixtureClass
    ): readonly { cls: FixtureClass; candidate: T }[] => {
        const taken = new Set(chosen.map(c => c.candidate));
        const usedTickers = new Set(chosen.map(c => tickerOf(c.candidate)));
        const matches = (c: T): boolean =>
            !taken.has(c) && memoised(c).has(cls);
        const [candidate] = [
            ...takeFirst(
                candidates,
                c => matches(c) && !usedTickers.has(tickerOf(c)),
                1
            ),
            ...takeFirst(candidates, matches, 1),
        ];
        return candidate === undefined
            ? chosen
            : [...chosen, { cls, candidate }];
    };
    return quotas.reduce<readonly { cls: FixtureClass; candidate: T }[]>(
        (chosen, { cls, count }) =>
            Array.from({ length: count }).reduce<
                readonly { cls: FixtureClass; candidate: T }[]
            >(acc => pickOne(acc, cls), chosen),
        []
    );
}

interface ReportRow {
    readonly invariantIds: readonly string[];
    readonly planChecked: number;
    readonly planUngrounded: number;
    readonly planValuesUngrounded: number;
    readonly keyPricesChecked: number;
    readonly keyPricesUngrounded: number;
    readonly falseGrounding: number;
}

function reportRow(dataDir: string, candidate: Candidate): ReportRow | null {
    try {
        const fixture = loadFixture(dataDir, candidate);
        if (fixture === null) return null;
        const { invariants, provenance } = evaluateAnalysisExchange(fixture);
        return {
            keyPricesChecked: provenance.checked.keyPrices,
            keyPricesUngrounded: provenance.keyPrices.length,
            falseGrounding: falseGroundingRate(
                fixture.dynamic,
                fixture.lastClose,
                priceQuoting(fixture.lastClose).dp
            ),
            invariantIds: invariants.map(v => v.id),
            planChecked: provenance.checked.plan,
            planUngrounded: provenance.plan.length > 0 ? 1 : 0,
            planValuesUngrounded: provenance.plan.length,
        };
    } catch {
        return null;
    }
}

function printReport(dataDir: string, candidates: readonly Candidate[]): void {
    const rows = candidates.flatMap(c => reportRow(dataDir, c) ?? []);
    const sum = (pick: (row: ReportRow) => number): number =>
        rows.reduce((total, row) => total + pick(row), 0);
    const byRule = rows
        .flatMap(row => row.invariantIds)
        .reduce(
            (acc, id) => acc.set(id, (acc.get(id) ?? 0) + 1),
            new Map<string, number>()
        );
    console.log(`evaluated ${rows.length} of ${candidates.length} exchanges`);
    console.log(
        `plans with an invariant violation: ${rows.filter(r => r.invariantIds.length > 0).length}`
    );
    byRule.forEach((count, id) => console.log(`  ${id}: ${count}`));
    console.log(
        `plans with an ungrounded plan price: ${sum(r => r.planUngrounded)} of ${rows.length}`
    );
    console.log(
        `ungrounded plan values: ${sum(r => r.planValuesUngrounded)} of ${sum(r => r.planChecked)}`
    );
    console.log(
        `ungrounded key prices: ${sum(r => r.keyPricesUngrounded)} of ${sum(r => r.keyPricesChecked)}`
    );
    const rates = rows.map(r => r.falseGrounding).toSorted((a, b) => a - b);
    console.log(
        `false-grounding control: mean ${(sum(r => r.falseGrounding) / rows.length).toFixed(4)}, median ${rates[Math.floor(rows.length / 2)]}, min ${rates[0]}, max ${rates[rows.length - 1]}`
    );
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    const dataDir = args['v8-data'];
    if (dataDir === undefined || dataDir === 'true') {
        throw new Error('--v8-data <dir> is required');
    }
    const root = resolve(dataDir);
    if (!existsSync(join(root, 'ai', 'raw'))) {
        throw new Error(`no ai/raw directory under ${root}`);
    }
    const out = resolve(args.out ?? DEFAULT_OUT);
    const candidates = listCandidates(root);
    if (args.report !== undefined) {
        printReport(root, candidates);
        return;
    }
    console.log(`scanning up to ${candidates.length} stored exchanges`);
    const selected = selectCandidates(
        candidates,
        c => evaluateCandidate(root, c),
        c => c.ticker
    );
    selected.forEach(({ cls, candidate }) =>
        console.log(`${cls.padEnd(24)} ${stableId(candidate)}`)
    );
    if (args['dry-run'] !== undefined) return;

    mkdirSync(out, { recursive: true });
    const expected = Object.fromEntries(
        selected.flatMap(({ cls, candidate }) => {
            const fixture = loadFixture(root, candidate);
            if (fixture === null) return [];
            const { provenance } = evaluateAnalysisExchange(fixture);
            writeFileSync(
                join(out, `${fixture.id}.json.gz`),
                gzipSync(JSON.stringify(fixture), { level: 9 })
            );
            return [
                [
                    fixture.id,
                    {
                        class: cls,
                        provenance,
                        falseGroundingRate: falseGroundingRate(
                            fixture.dynamic,
                            fixture.lastClose,
                            priceQuoting(fixture.lastClose).dp
                        ),
                    },
                ],
            ];
        })
    );
    writeFileSync(
        join(out, 'expected.json'),
        `${JSON.stringify(expected, null, 4)}\n`
    );
    console.log(`wrote ${Object.keys(expected).length} fixtures to ${out}`);
}

if (require.main === module) {
    main();
}
