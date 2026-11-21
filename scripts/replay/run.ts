/**
 * Replay runner: analyses the cases of a frozen set with the production `runAnalysis`
 * path, on stored bars cut at each case's `asOf`, with the clock set to that session.
 *
 * Usage:
 *   npx tsx scripts/replay/run.ts --set <set-dir> --out <run-dir> [--skills <path ending in /skills>]
 *     [--tier free|member] [--subset variance] [--repeat N] [--limit N] [--concurrency 4]
 *     [--keep-raw] [--retry-errors] [--execute --approved-calls <n>]
 *
 * The default is a dry run: it checks the set's hashes, counts the calls still to make
 * (cases × repeats, minus result files that already exist), prints the token and USD
 * estimate and exits having made no provider call. `--execute` runs only when
 * `--approved-calls` equals that pending count exactly; `--skills` and a
 * `DEEPSEEK_API_KEY` in the environment are needed then.
 *
 * `--tier` is the tier the analyses run as (default `member`; `free` caps the skills of the
 * prompt like a free user's). It is part of the run identity, so a resumed run must use the
 * same tier.
 *
 * `--limit N` takes the N cases with the smallest sha256(caseId), so a pilot is a spread
 * over symbols and regimes and two arms given the same `--limit` run the same cases.
 * Results are written to `<run>/results/<symbol>_<asOf>.r<k>.json`; a run resumes by
 * skipping existing results (a failed call is a result too; `--retry-errors` redoes them).
 * The model call failing is recorded, never retried by the runner: every retry is a cost.
 * `--concurrency N` is the number of **symbols** analysed side by side; the jobs of one symbol
 * always run one after another (see {@link runPerSymbol}). Before the first call the skills
 * are loaded once and the run stops when none loaded (see {@link assertSkillsLoaded}).
 *
 * FileSkillsLoader reads `<cwd>/skills`, so the process changes directory to the parent of
 * `--skills` before core is imported; every path argument is resolved before that.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseArgs, parsePositiveIntArg } from '../ab-harness/cliArgs';
import {
    installFetchRecorder,
    recordExchanges,
    sumUsage,
} from './exchangeRecorder';
import type { RecordedExchange } from './exchangeRecorder';
import {
    acquireLock,
    assertOutsideRepo,
    fileExists,
    gitOutput,
    readJson,
    sha256Hex,
    writeFileAtomic,
    writeJsonAtomic,
} from './fsUtil';
import { marketOfSymbol, profileOf, sessionCloseInstantMs } from './markets';
import type { MarketProfile } from './markets';
import { runAtInstant } from './clock';
import { redactProviderText } from './redact';
import { barsFingerprint, verifySetHashes } from './setIntegrity';
import { createStoredProvider } from './storedProvider';
import { JOINED_GENERATION_ERROR } from './types';
import type {
    CaseResultFile,
    PromptHashes,
    ReplayCase,
    ReplayManifest,
    RunMeta,
    StoredBars,
} from './types';
import { AI_RETRY_MAX_ATTEMPTS } from '@/infrastructure/ai/retry/withRetry';
import type { AssembledPromptRecord, Tier } from '@/domain/types';

// ─── Cost estimate ────────────────────────────────────────────────────────────
/** Measured mean call size and price of a daily technical analysis (flash, reasoning off). */
export const INPUT_TOKENS_PER_CALL = 35_700;
export const OUTPUT_TOKENS_PER_CALL = 7_300;
export const USD_PER_CALL = 0.0074;
export const PEAK_PRICE_MULTIPLIER = 2;
/** UTC hour ranges `[from, to)` of the weekday DeepSeek peak pricing. */
export const PEAK_HOURS_UTC: readonly (readonly [number, number])[] = [
    [1, 4],
    [6, 10],
];

/**
 * One approved "call" is one `runAnalysis`. It bills at most {@link MAX_GENERATIONS_PER_CALL}
 * complete generations: `callAnalysisAi` generates once more when the first reply is not
 * parseable JSON. Each generation goes through `withRetry` (up to `AI_RETRY_MAX_ATTEMPTS`
 * attempts) and every attempt is an HTTP request the OpenAI-compatible client may itself
 * retry.
 */
export const MAX_GENERATIONS_PER_CALL = 2;

/**
 * Extra tries the OpenAI SDK makes for one request on its own. ASSUMPTION: the DeepSeek
 * client is built without `maxRetries` (`providers/deepseek.ts`), so the SDK default of 2
 * applies (`maxRetries` default in `node_modules/openai/client.js`). If either changes, this
 * constant is wrong and the worst case below is too low or too high.
 */
export const OPENAI_SDK_DEFAULT_MAX_RETRIES = 2;

/** HTTP requests one call can send in the worst case, SDK retries included. */
export const WORST_CASE_REQUESTS_PER_CALL =
    MAX_GENERATIONS_PER_CALL *
    AI_RETRY_MAX_ATTEMPTS *
    (1 + OPENAI_SDK_DEFAULT_MAX_RETRIES);

/** Weekday (UTC Monday to Friday) inside a peak range: the provider bills double. */
export function isDeepSeekPeak(at: Date): boolean {
    const weekday = at.getUTCDay();
    const hour = at.getUTCHours();
    return (
        weekday >= 1 &&
        weekday <= 5 &&
        PEAK_HOURS_UTC.some(([from, to]) => hour >= from && hour < to)
    );
}

export interface CostEstimate {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    usd: number;
    peak: boolean;
}

/** Estimate for `calls` started at `startedAt` (the price is decided by the start only). */
export function estimateCost(calls: number, startedAt: Date): CostEstimate {
    const peak = isDeepSeekPeak(startedAt);
    return {
        calls,
        inputTokens: calls * INPUT_TOKENS_PER_CALL,
        outputTokens: calls * OUTPUT_TOKENS_PER_CALL,
        usd: calls * USD_PER_CALL * (peak ? PEAK_PRICE_MULTIPLIER : 1),
        peak,
    };
}

// ─── Arguments ────────────────────────────────────────────────────────────────
/** The tiers a replay can run as (`pro` has the member's prompt and is not measured). */
export const RUN_TIERS = ['free', 'member'] as const satisfies readonly Tier[];
export type RunTier = (typeof RUN_TIERS)[number];

function parseTier(raw: string | undefined): RunTier {
    if (raw === undefined) return 'member';
    const tier = RUN_TIERS.find(candidate => candidate === raw);
    if (tier === undefined) {
        throw new Error(
            `--tier must be one of ${RUN_TIERS.join(', ')} (got "${raw}")`
        );
    }
    return tier;
}

export interface RunArgs {
    set: string;
    out: string;
    skills: string | null;
    /** The tier the analyses run as; part of the run identity. */
    tier: RunTier;
    subset: 'variance' | null;
    repeat: number;
    limit: number | null;
    concurrency: number;
    keepRaw: boolean;
    retryErrors: boolean;
    execute: boolean;
    approvedCalls: number | null;
}

function parseCount(raw: string | undefined, flag: string): number | null {
    if (raw === undefined) return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(
            `--${flag} must be a non-negative integer (got "${raw}")`
        );
    }
    return value;
}

/** Validates the command line; paths are resolved to absolute ones here, before any chdir. */
export function parseRunArgs(argv: readonly string[]): RunArgs {
    const raw = parseArgs(argv);
    if (!raw.set || !raw.out) {
        throw new Error('--set and --out are required');
    }
    if (raw.subset !== undefined && raw.subset !== 'variance') {
        throw new Error(`--subset must be "variance" (got "${raw.subset}")`);
    }
    if (raw.skills !== undefined && basename(raw.skills) !== 'skills') {
        throw new Error(
            '--skills must be the path of a directory named "skills"'
        );
    }
    const execute = raw.execute === 'true';
    if (execute && raw.skills === undefined) {
        throw new Error('--execute needs --skills <path ending in /skills>');
    }
    return {
        set: resolve(raw.set),
        out: resolve(raw.out),
        skills: raw.skills === undefined ? null : resolve(raw.skills),
        tier: parseTier(raw.tier),
        subset: raw.subset === 'variance' ? 'variance' : null,
        repeat: parsePositiveIntArg(raw.repeat, 'repeat'),
        limit:
            raw.limit === undefined
                ? null
                : parsePositiveIntArg(raw.limit, 'limit'),
        concurrency:
            raw.concurrency === undefined
                ? 4
                : parsePositiveIntArg(raw.concurrency, 'concurrency'),
        keepRaw: raw['keep-raw'] === 'true',
        retryErrors: raw['retry-errors'] === 'true',
        execute,
        approvedCalls: parseCount(raw['approved-calls'], 'approved-calls'),
    };
}

// ─── Set integrity ────────────────────────────────────────────────────────────
/** sha256 over every file of a directory tree (relative path and content, sorted). */
export function hashTree(dir: string): string {
    const files = (current: string): readonly string[] =>
        readdirSync(current, { withFileTypes: true })
            .toSorted((a, b) =>
                a.name < b.name ? -1 : a.name > b.name ? 1 : 0
            )
            .flatMap(entry =>
                entry.isDirectory()
                    ? files(join(current, entry.name))
                    : [join(current, entry.name)]
            );
    const hash = files(dir).map(file => {
        const rel = file.slice(dir.length + 1);
        return `${rel}\0${sha256Hex(readFileSync(file))}`;
    });
    return sha256Hex(hash.join('\n'));
}

// ─── Case selection and jobs ──────────────────────────────────────────────────
/** The cases a run covers: the subset, then `--limit` by smallest sha256(caseId). */
export function selectRunCases(
    manifest: ReplayManifest,
    options: { subset: 'variance' | null; limit: number | null }
): readonly ReplayCase[] {
    const inSubset =
        options.subset === 'variance'
            ? manifest.cases.filter(c => c.variance)
            : manifest.cases;
    if (options.limit === null) return inSubset;
    const kept = new Set(
        inSubset
            .map(c => ({ id: c.caseId, key: sha256Hex(c.caseId) }))
            .toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
            .slice(0, options.limit)
            .map(c => c.id)
    );
    return inSubset.filter(c => kept.has(c.caseId));
}

export interface Job {
    case: ReplayCase;
    /** 1-based. */
    repeat: number;
    /** Result file name inside `<run>/results/`. */
    name: string;
}

export function jobName(c: ReplayCase, repeat: number): string {
    return `${c.symbol}_${c.asOf}.r${repeat}`;
}

export function jobsFor(
    cases: readonly ReplayCase[],
    repeat: number
): readonly Job[] {
    return cases.flatMap(c =>
        Array.from({ length: repeat }, (_, k) => ({
            case: c,
            repeat: k + 1,
            name: jobName(c, k + 1),
        }))
    );
}

export function resultPath(runDir: string, job: Job): string {
    return join(runDir, 'results', `${job.name}.json`);
}

export interface JobSplit {
    /** Results that exist and count (a failed one too, unless `retryErrors`). */
    done: readonly Job[];
    pending: readonly Job[];
}

export function splitJobs(
    jobs: readonly Job[],
    runDir: string,
    retryErrors: boolean
): JobSplit {
    const isDone = (job: Job): boolean => {
        const path = resultPath(runDir, job);
        if (!fileExists(path)) return false;
        return !retryErrors || readJson<CaseResultFile>(path).error === null;
    };
    return {
        done: jobs.filter(isDone),
        pending: jobs.filter(job => !isDone(job)),
    };
}

// ─── Plan and approval ────────────────────────────────────────────────────────
export function describePlan(
    split: JobSplit,
    estimate: CostEstimate
): readonly string[] {
    const million = (n: number): string => `${(n / 1e6).toFixed(2)}M`;
    return [
        `planned calls: ${estimate.calls} (done ${split.done.length}, total ${split.done.length + split.pending.length})`,
        `token estimate: ${million(estimate.inputTokens)} in / ${million(estimate.outputTokens)} out (${INPUT_TOKENS_PER_CALL} / ${OUTPUT_TOKENS_PER_CALL} per call)`,
        `cost estimate: $${estimate.usd.toFixed(2)} (${USD_PER_CALL}/call${estimate.peak ? ', doubled: started inside a DeepSeek peak window' : ''})`,
        `billed generations: at most ${MAX_GENERATIONS_PER_CALL} complete generations per call (a second one when the first reply is not parseable JSON)`,
        `HTTP requests: up to ${WORST_CASE_REQUESTS_PER_CALL} per call (${MAX_GENERATIONS_PER_CALL} generations x ${AI_RETRY_MAX_ATTEMPTS} attempts x ${1 + OPENAI_SDK_DEFAULT_MAX_RETRIES} with the SDK's own retries, assuming its default of ${OPENAI_SDK_DEFAULT_MAX_RETRIES}), so ${estimate.calls} calls can send up to ${estimate.calls * WORST_CASE_REQUESTS_PER_CALL}`,
    ];
}

export type Approval = { ok: true } | { ok: false; reason: string };

/** `--execute` runs only when the approved number is exactly the planned count. */
export function checkApproval(
    plannedCalls: number,
    approvedCalls: number | null
): Approval {
    if (approvedCalls === null) {
        return {
            ok: false,
            reason: `--execute needs --approved-calls ${plannedCalls} (the planned count)`,
        };
    }
    return approvedCalls === plannedCalls
        ? { ok: true }
        : {
              ok: false,
              reason: `--approved-calls ${approvedCalls} does not equal the planned count ${plannedCalls}`,
          };
}

// ─── Execution ────────────────────────────────────────────────────────────────
export interface AnalyzeInput {
    case: ReplayCase;
    stored: StoredBars;
    profile: MarketProfile;
    /** The clock instant (epoch ms) the case is analysed at. */
    clockMs: number;
}

export interface AnalyzeOutput {
    /** `runAnalysis().unfilteredResult`, `null` on failure. */
    unfilteredResult: unknown;
    prompt: AssembledPromptRecord | null;
    exchanges: readonly RecordedExchange[];
    error: string | null;
    latencyMs: number;
}

export interface ExecuteDeps {
    analyze: (input: AnalyzeInput) => Promise<AnalyzeOutput>;
    identity: Pick<
        RunMeta,
        'coreGitSha' | 'promptTemplateVersion' | 'model' | 'tier'
    >;
}

export interface RunDeps {
    log: (line: string) => void;
    now: () => Date;
    /** Imports core and builds the analyzer; only called after the approval check passed. */
    loadExecuteDeps: (
        skillsDir: string,
        log: (line: string) => void,
        tier: RunTier
    ) => Promise<ExecuteDeps>;
}

function promptHashes(prompt: AssembledPromptRecord): PromptHashes {
    return {
        system: sha256Hex(prompt.system),
        stable: sha256Hex(prompt.stable),
        dynamic: sha256Hex(prompt.dynamic),
        full: sha256Hex(`${prompt.system}\n\n${prompt.dynamic}`),
    };
}

/**
 * A call that reports success but never fired `onPromptAssembled` did not generate: core
 * hands a concurrent caller on the same cache key the first caller's raw reply. Such a
 * result belongs to another case, so it is stored as an error, never as a success.
 */
export function normalizeOutput(output: AnalyzeOutput): AnalyzeOutput {
    return output.error === null && output.prompt === null
        ? {
              ...output,
              unfilteredResult: null,
              error: JOINED_GENERATION_ERROR,
          }
        : output;
}

export function toResultFile(job: Job, raw: AnalyzeOutput): CaseResultFile {
    const output = normalizeOutput(raw);
    return {
        caseId: job.case.caseId,
        symbol: job.case.symbol,
        asOf: job.case.asOf,
        repeat: job.repeat,
        unfilteredResult: output.unfilteredResult,
        promptVersion: output.prompt?.promptVersion ?? null,
        promptHashes:
            output.prompt === null ? null : promptHashes(output.prompt),
        promptDynamic: output.prompt?.dynamic ?? null,
        usage: sumUsage(output.exchanges),
        exchangeCount: output.exchanges.length,
        latencyMs: Math.round(output.latencyMs),
        error: output.error === null ? null : redactProviderText(output.error),
    };
}

function errorMessage(error: unknown): string {
    return redactProviderText(
        error instanceof Error ? error.message : String(error)
    );
}

function failedOutput(error: unknown): AnalyzeOutput {
    return {
        unfilteredResult: null,
        prompt: null,
        exchanges: [],
        error: errorMessage(error),
        latencyMs: 0,
    };
}

/**
 * Runs one job and writes its result (and with `keepRaw` the gzipped exchanges: request
 * body and response text only). Never throws: a failure is the job's result.
 */
export async function executeJob(
    job: Job,
    context: {
        deps: ExecuteDeps;
        runDir: string;
        keepRaw: boolean;
        stored: ReadonlyMap<string, StoredBars>;
    }
): Promise<CaseResultFile> {
    const stored = context.stored.get(job.case.symbol);
    const output =
        stored === undefined
            ? failedOutput(`no bars loaded for ${job.case.symbol}`)
            : await Promise.resolve()
                  .then(() => {
                      const profile = profileOf(
                          marketOfSymbol(job.case.symbol)
                      );
                      return context.deps.analyze({
                          case: job.case,
                          stored,
                          profile,
                          clockMs: sessionCloseInstantMs(
                              profile.session,
                              job.case.asOf
                          ),
                      });
                  })
                  .catch(failedOutput);
    const result = toResultFile(job, output);
    writeJsonAtomic(resultPath(context.runDir, job), result);
    if (context.keepRaw && output.exchanges.length > 0) {
        writeFileAtomic(
            join(context.runDir, 'raw', `${job.name}.json.gz`),
            gzipSync(
                JSON.stringify(
                    output.exchanges.map(({ requestBody, responseText }) => ({
                        requestBody,
                        responseText,
                    }))
                )
            )
        );
    }
    return result;
}

/**
 * Runs `worker` over `items` with at most `limit` in flight; results come back in input
 * order. Workers pull from one shared iterator, so no item runs twice.
 */
export async function mapLimit<T, R>(
    items: readonly T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>
): Promise<readonly R[]> {
    const results: R[] = new Array(items.length);
    const queue = items.entries();
    const drain = async (): Promise<void> => {
        const next = queue.next();
        if (next.done) return;
        const [index, item] = next.value;
        results[index] = await worker(item, index);
        return drain();
    };
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, () => drain())
    );
    return results;
}

/**
 * Runs jobs so that **no two jobs of one symbol are ever in flight together**: one ordered
 * queue per symbol (a case's repeats and the dates of the symbol run one after another),
 * and up to `concurrency` symbol queues in parallel.
 *
 * Why: `runAnalysis` goes through `dedupeGeneration`, which joins concurrent callers on one
 * in-process promise keyed by the analysis cache key
 * (`analysis:<symbol>:<timeframe>:<model>:<prompt version>:<tier>:<skills>`, see
 * `buildAnalysisCacheKey`), even with `cache: null`. That key holds no date and no bars
 * hash, so two concurrent jobs of one symbol (two dates, or two repeats of one case) would
 * run a single generation and both would receive its raw reply: a result built from another
 * date's prompt (look-ahead) and a repeat that is not independent. Keys of different
 * symbols differ, so symbols can overlap freely.
 *
 * Results are returned grouped by symbol, not in job order.
 *
 * If a worker throws, no queue starts another job; the jobs in flight settle, and then the
 * first error is thrown with the number of jobs that had completed.
 */
export async function runPerSymbol<R>(
    jobs: readonly Job[],
    concurrency: number,
    worker: (job: Job) => Promise<R>
): Promise<readonly R[]> {
    const symbols = [...new Set(jobs.map(job => job.case.symbol))];
    const queues = symbols.map(symbol =>
        jobs.filter(job => job.case.symbol === symbol)
    );
    // The first unexpected error stops every queue from starting another job; jobs already
    // in flight finish (their calls are already billed) and only then is the error raised.
    const stop: { failed: boolean; error: unknown; completed: number } = {
        failed: false,
        error: undefined,
        completed: 0,
    };
    const runQueue = async (queue: readonly Job[]): Promise<readonly R[]> => {
        const results: R[] = new Array(queue.length);
        await queue.reduce<Promise<void>>(
            (previous, job, index) =>
                previous.then(async () => {
                    if (stop.failed) return;
                    try {
                        results[index] = await worker(job);
                        stop.completed += 1;
                    } catch (error) {
                        if (!stop.failed) {
                            stop.failed = true;
                            stop.error = error;
                        }
                    }
                }),
            Promise.resolve()
        );
        return results;
    };
    const grouped = await mapLimit(queues, concurrency, runQueue);
    if (stop.failed) {
        throw new Error(
            `${errorMessage(stop.error)} (stopped after the first failure; ${stop.completed} of ${jobs.length} jobs had completed)`,
            { cause: stop.error }
        );
    }
    return grouped.flat();
}

/** `1: 34 jobs, 2: 3 jobs`: how many billed exchanges each job needed. */
export function describeExchangeCounts(counts: readonly number[]): string {
    const distinct = [...new Set(counts)].toSorted((a, b) => a - b);
    return distinct
        .map(n => `${n}: ${counts.filter(c => c === n).length} jobs`)
        .join(', ');
}

const IDENTITY_FIELDS = [
    'setId',
    'coreGitSha',
    'promptTemplateVersion',
    'model',
    'tier',
    'skillsSha256',
    'repeat',
    'subset',
    'limit',
    'setBarsSha256',
] as const satisfies readonly (keyof RunMeta)[];

/**
 * Throws when an existing `run.json` is from a different set or bars, code, prompt, model,
 * skills, repeat count or selection (subset and limit).
 */
export function assertSameRun(existing: RunMeta, next: RunMeta): void {
    const differing = IDENTITY_FIELDS.filter(
        field => existing[field] !== next[field]
    );
    if (differing.length > 0) {
        throw new Error(
            `${differing.join(', ')} differ from the run already in this directory; use a new --out`
        );
    }
}

function loadStored(
    setDir: string,
    manifest: ReplayManifest,
    symbols: readonly string[]
): ReadonlyMap<string, StoredBars> {
    return new Map(
        symbols.map(symbol => [
            symbol,
            readJson<StoredBars>(join(setDir, manifest.bars[symbol].file)),
        ])
    );
}

/** Name of the lock file taken in the run directory by `--execute`. */
export const RUN_LOCK_FILE = '.run.lock';

/** The command: returns the process exit code (0 done or dry run, 2 refused, 1 error). */
export async function runReplay(args: RunArgs, deps: RunDeps): Promise<number> {
    assertOutsideRepo(args.out);
    if (args.skills !== null) {
        // The skills' parent is the app checkout: sets and runs must not be written into it.
        assertOutsideRepo(args.out, dirname(args.skills));
        assertOutsideRepo(args.set, dirname(args.skills));
    }
    const manifest = readJson<ReplayManifest>(join(args.set, 'manifest.json'));
    verifySetHashes(args.set, manifest);
    const cases = selectRunCases(manifest, args);
    const split = splitJobs(
        jobsFor(cases, args.repeat),
        args.out,
        args.retryErrors
    );
    const estimate = estimateCost(split.pending.length, deps.now());
    deps.log(
        `set ${manifest.setId}: ${cases.length} cases x ${args.repeat} repeat${args.subset === null ? '' : ` (${args.subset} subset)`}`
    );
    describePlan(split, estimate).forEach(line => deps.log(line));
    if (!args.execute) {
        deps.log(
            `dry run: no provider call made. To run: add --skills <path>/skills --execute --approved-calls ${split.pending.length}`
        );
        return 0;
    }
    if (split.pending.length === 0) {
        deps.log('nothing to run: every result already exists');
        return 0;
    }
    const approval = checkApproval(split.pending.length, args.approvedCalls);
    if (!approval.ok) {
        deps.log(`refused: ${approval.reason}`);
        return 2;
    }
    if (args.skills === null) {
        deps.log('refused: --skills is required to execute');
        return 2;
    }
    // Two processes on one run directory would each pass the approval for the same pending
    // jobs and bill up to twice the approved calls: the run takes an exclusive lock.
    const lockPath = join(args.out, RUN_LOCK_FILE);
    const release = acquireLock(lockPath);
    if (release === null) {
        deps.log(
            `refused: ${lockPath} exists, so another replay is using this run directory. If no replay is running (for example one that crashed), delete that file and start again`
        );
        return 2;
    }
    try {
        return await executeApproved(args, deps, manifest, split, args.skills);
    } finally {
        release();
    }
}

/** The part of the command that makes calls: runs under the run-directory lock. */
async function executeApproved(
    args: RunArgs,
    deps: RunDeps,
    manifest: ReplayManifest,
    split: JobSplit,
    skills: string
): Promise<number> {
    const executeDeps = await deps.loadExecuteDeps(skills, deps.log, args.tier);
    const meta: RunMeta = {
        setId: manifest.setId,
        setBarsSha256: barsFingerprint(manifest),
        ...executeDeps.identity,
        skillsSha256: hashTree(skills),
        repeat: args.repeat,
        subset: args.subset,
        limit: args.limit,
        startedAt: deps.now().toISOString(),
    };
    const metaPath = join(args.out, 'run.json');
    if (fileExists(metaPath)) assertSameRun(readJson<RunMeta>(metaPath), meta);
    else writeJsonAtomic(metaPath, meta);
    const stored = loadStored(args.set, manifest, [
        ...new Set(split.pending.map(job => job.case.symbol)),
    ]);
    const progress = { finished: 0 };
    const results = await runPerSymbol(
        split.pending,
        args.concurrency,
        async job => {
            const result = await executeJob(job, {
                deps: executeDeps,
                runDir: args.out,
                keepRaw: args.keepRaw,
                stored,
            });
            progress.finished += 1;
            deps.log(
                `[${progress.finished}/${split.pending.length}] ${job.name} ${result.error === null ? `ok ${result.latencyMs}ms` : `error: ${result.error}`}`
            );
            return result;
        }
    );
    const failed = results.filter(result => result.error !== null).length;
    deps.log(`finished: ${results.length - failed} ok, ${failed} failed`);
    if (results.some(result => result.exchangeCount > 0)) {
        deps.log(
            `billed exchanges per job: ${describeExchangeCounts(results.map(result => result.exchangeCount))}`
        );
    }
    return 0;
}

// ─── Wiring to core (not exercised by tests: it calls the real provider) ──────

export interface SkillsLoad {
    skills: readonly unknown[];
    skillsDegraded: boolean;
}

/**
 * Refuses to go on when the skills did not load. A wrong `--skills` directory makes
 * `loadSkillsCached` return no skills and `skillsDegraded: true`, after which every call
 * would still run and be billed, with a prompt that has no skills in it. Makes no provider
 * call. Returns the skill count (also logged, before the first call).
 */
export async function assertSkillsLoaded(
    load: () => Promise<SkillsLoad>,
    log: (line: string) => void
): Promise<number> {
    const { skills, skillsDegraded } = await load();
    if (skillsDegraded || skills.length === 0) {
        throw new Error(
            `skills did not load from the --skills directory (degraded: ${skillsDegraded}, count: ${skills.length}); refusing to run, every call would be billed with no skills in the prompt`
        );
    }
    log(`skills loaded: ${skills.length}`);
    return skills.length;
}

/**
 * Imports core after changing into the skills' parent directory (the skills loader
 * resolves `<cwd>/skills` when its module is first evaluated), installs the exchange
 * recorder and returns the analyzer that calls `runAnalysis` like the production prewarm.
 */
export async function loadCoreExecuteDeps(
    skillsDir: string,
    log: (line: string) => void,
    tier: RunTier
): Promise<ExecuteDeps> {
    if (!statSync(skillsDir).isDirectory()) {
        throw new Error(`${skillsDir} is not a directory`);
    }
    if (!process.env.DEEPSEEK_API_KEY) {
        throw new Error('DEEPSEEK_API_KEY is not set in the environment');
    }
    process.chdir(dirname(skillsDir));
    const [
        { runAnalysis },
        { DEEPSEEK_V4_1_FLASH_MODEL },
        { PROMPT_TEMPLATE_VERSION },
    ] = await Promise.all([
        import('@/application/market/runAnalysis'),
        import('@/application/chat/constants'),
        import('@/infrastructure/cache/config'),
    ]);
    // The same cached load `runAnalysis` uses; checked once, before any call.
    const { loadSkillsCached } = await import('@/infrastructure/skills/loader');
    await assertSkillsLoaded(loadSkillsCached, log);
    installFetchRecorder();
    const dirty = gitOutput(['status', '--porcelain']) !== '';
    return {
        identity: {
            coreGitSha: `${gitOutput(['rev-parse', 'HEAD'])}${dirty ? '+dirty' : ''}`,
            promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
            model: DEEPSEEK_V4_1_FLASH_MODEL,
            tier,
        },
        analyze: async input => {
            const startedAt = performance.now();
            const captured: { prompt: AssembledPromptRecord | null } = {
                prompt: null,
            };
            const recorded = await recordExchanges(() =>
                runAtInstant(input.clockMs, () =>
                    runAnalysis(
                        input.case.symbol,
                        input.stored.companyName,
                        '1Day',
                        true,
                        undefined,
                        {
                            modelId: DEEPSEEK_V4_1_FLASH_MODEL,
                            marketDataProvider: createStoredProvider(
                                input.stored.bars,
                                input.case.asOf
                            ),
                            session: input.profile.session,
                            assetClass: 'equity',
                            currency: input.profile.currency,
                            krxTickTable: input.profile.krxTickTable,
                            tierContext: { userId: null, tier },
                            reasoning: false,
                            cache: null,
                            onPromptAssembled: record => {
                                captured.prompt = record;
                            },
                        }
                    )
                )
            );
            const base = {
                prompt: captured.prompt,
                exchanges: recorded.exchanges,
                latencyMs: performance.now() - startedAt,
            };
            if (!recorded.ok) {
                return {
                    ...base,
                    unfilteredResult: null,
                    error: errorMessage(recorded.error),
                };
            }
            return recorded.value.status === 'done'
                ? {
                      ...base,
                      unfilteredResult: recorded.value.unfilteredResult,
                      error: null,
                  }
                : {
                      ...base,
                      unfilteredResult: null,
                      error: redactProviderText(
                          `status=${recorded.value.status} ${JSON.stringify('error' in recorded.value ? recorded.value.error : '')}`
                      ),
                  };
        },
    };
}

if (require.main === module) {
    runReplay(parseRunArgs(process.argv.slice(2)), {
        log: console.log,
        now: () => new Date(),
        loadExecuteDeps: loadCoreExecuteDeps,
    })
        .then(code => {
            process.exitCode = code;
        })
        .catch(error => {
            console.error(errorMessage(error));
            process.exitCode = 1;
        });
}
