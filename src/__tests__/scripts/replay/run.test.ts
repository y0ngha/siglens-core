import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeSet } from '../../../../scripts/replay/buildSet';
import { REPO_ROOT, sha256Hex } from '../../../../scripts/replay/fsUtil';
import { US_EQUITY_SESSION } from '@/domain/session';
import {
    INPUT_TOKENS_PER_CALL,
    OUTPUT_TOKENS_PER_CALL,
    PEAK_PRICE_MULTIPLIER,
    USD_PER_CALL,
    assertSameRun,
    checkApproval,
    estimateCost,
    executeJob,
    hashTree,
    isDeepSeekPeak,
    jobName,
    jobsFor,
    assertSkillsLoaded,
    describeExchangeCounts,
    mapLimit,
    normalizeOutput,
    parseRunArgs,
    runPerSymbol,
    MAX_GENERATIONS_PER_CALL,
    OPENAI_SDK_DEFAULT_MAX_RETRIES,
    RUN_LOCK_FILE,
    WORST_CASE_REQUESTS_PER_CALL,
    resultPath,
    runReplay,
    selectRunCases,
    splitJobs,
    type AnalyzeInput,
    type AnalyzeOutput,
    type ExecuteDeps,
    type RunArgs,
    type RunDeps,
} from '../../../../scripts/replay/run';
import { sessionCloseInstantMs } from '../../../../scripts/replay/markets';
import { AI_RETRY_MAX_ATTEMPTS } from '@/infrastructure/ai/retry/withRetry';
import { barsFingerprint } from '../../../../scripts/replay/setIntegrity';
import { JOINED_GENERATION_ERROR } from '../../../../scripts/replay/types';
import type {
    CaseResultFile,
    ReplayManifest,
    RunMeta,
} from '../../../../scripts/replay/types';
import {
    deferred,
    makeTempDir,
    tradingBars,
    writeBarsDir,
} from './replayFixtures';

const temps = new Set<() => void>();

describe('replay runner', () => {
    afterEach(() => {
        [...temps].forEach(remove => remove());
        temps.clear();
    });
    function temp(): string {
        const { dir, remove } = makeTempDir();
        temps.add(remove);
        return dir;
    }

    // ─── Synthetic set and stub analyzer ──────────────────────────────────────────
    interface Fixture {
        setDir: string;
        outDir: string;
        skillsDir: string;
        manifest: ReplayManifest;
    }

    function makeFixture(
        symbols: readonly string[] = ['NVDA', '005930.KS']
    ): Fixture {
        const root = temp();
        const barsDir = join(root, 'bars-src');
        writeBarsDir(
            barsDir,
            symbols.map(symbol => ({
                symbol,
                bars: tradingBars({
                    symbol,
                    startIso: '2020-01-02',
                    count: 700,
                }),
            }))
        );
        const setDir = join(root, 'set');
        const manifest = writeSet(barsDir, setDir, {
            createdAt: '2026-11-20T00:00:00.000Z',
            allowPartial: true,
            force: false,
        });
        const skillsDir = join(root, 'app', 'skills');
        mkdirSync(skillsDir, { recursive: true });
        writeFileSync(join(skillsDir, 'a.md'), 'skill a');
        return { setDir, outDir: join(root, 'run'), skillsDir, manifest };
    }

    const SSE_USAGE =
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":1000,"output_tokens":200,"input_tokens_details":{"cached_tokens":400}}}}\n';

    function okOutput(input: AnalyzeInput): AnalyzeOutput {
        return {
            unfilteredResult: { trend: 'bullish', symbol: input.case.symbol },
            prompt: {
                system: 'sys',
                stable: 'stb',
                dynamic: `dyn ${input.case.caseId}`,
                promptVersion: 'p34',
            },
            exchanges: [
                {
                    url: 'https://api.deepseek.com/responses',
                    method: 'POST',
                    requestBody: { n: 1 },
                    status: 200,
                    responseText: SSE_USAGE,
                },
                {
                    url: 'https://api.deepseek.com/responses',
                    method: 'POST',
                    requestBody: { n: 2 },
                    status: 200,
                    responseText: SSE_USAGE,
                },
            ],
            error: null,
            latencyMs: 12.6,
        };
    }

    const IDENTITY: ExecuteDeps['identity'] = {
        coreGitSha: 'abc123',
        promptTemplateVersion: 'p34',
        model: 'deepseek-v4.1-flash',
        tier: 'member',
    };

    function makeDeps(
        analyze: ExecuteDeps['analyze'] = async input => okOutput(input),
        identity = IDENTITY
    ) {
        const analyzeSpy = vi.fn(analyze);
        const loadExecuteDeps = vi.fn<RunDeps['loadExecuteDeps']>(async () => ({
            analyze: analyzeSpy,
            identity,
        }));
        const log = vi.fn<(line: string) => void>();
        const deps: RunDeps = {
            log,
            now: () => new Date('2026-11-21T12:00:00Z'),
            loadExecuteDeps,
        };
        const logged = (): string =>
            log.mock.calls.map(([line]) => line).join('\n');
        return { deps, analyzeSpy, loadExecuteDeps, logged };
    }

    function argsFor(f: Fixture, extra: readonly string[] = []): RunArgs {
        return parseRunArgs([
            '--set',
            f.setDir,
            '--out',
            f.outDir,
            '--skills',
            f.skillsDir,
            ...extra,
        ]);
    }

    const resultFiles = (f: Fixture): readonly string[] =>
        existsSync(join(f.outDir, 'results'))
            ? readdirSync(join(f.outDir, 'results'))
            : [];

    describe('the synthetic set', () => {
        it('has cases of both markets, several of each, so the run tests count something', () => {
            const { manifest } = makeFixture();
            expect(
                manifest.cases.filter(c => c.symbol === 'NVDA').length
            ).toBeGreaterThan(2);
            expect(
                manifest.cases.filter(c => c.symbol === '005930.KS').length
            ).toBeGreaterThan(2);
        });
    });

    // ─── Arguments ────────────────────────────────────────────────────────────────
    describe('parseRunArgs', () => {
        it('defaults to a dry run of one repeat, concurrency 4', () => {
            const args = parseRunArgs(['--set', '/s', '--out', '/o']);
            expect(args).toMatchObject({
                set: '/s',
                out: '/o',
                skills: null,
                tier: 'member',
                subset: null,
                repeat: 1,
                limit: null,
                concurrency: 4,
                keepRaw: false,
                retryErrors: false,
                execute: false,
                approvedCalls: null,
            });
        });

        it('takes the tier of the run, member by default', () => {
            const base = ['--set', '/s', '--out', '/o'];
            expect(parseRunArgs(base).tier).toBe('member');
            expect(parseRunArgs([...base, '--tier', 'free']).tier).toBe('free');
            expect(parseRunArgs([...base, '--tier', 'member']).tier).toBe(
                'member'
            );
        });

        it('takes the chart timeframe of the run, 1Day by default, and refuses one core does not list', () => {
            const base = ['--set', '/s', '--out', '/o'];
            expect(parseRunArgs(base).timeframe).toBe('1Day');
            expect(
                parseRunArgs([...base, '--timeframe', '1Hour']).timeframe
            ).toBe('1Hour');
            expect(() =>
                parseRunArgs([...base, '--timeframe', '2Week'])
            ).toThrow(/--timeframe must be one of .*1Day/);
        });

        it('rejects a tier that is not measured', () => {
            const base = ['--set', '/s', '--out', '/o'];
            expect(() => parseRunArgs([...base, '--tier', 'pro'])).toThrow(
                '--tier must be one of free, member (got "pro")'
            );
            expect(() => parseRunArgs([...base, '--tier'])).toThrow(
                '--tier must be one of free, member (got "true")'
            );
        });

        it('resolves path arguments to absolute paths', () => {
            const args = parseRunArgs([
                '--set',
                'rel/set',
                '--out',
                'rel/out',
                '--skills',
                'rel/skills',
            ]);
            expect(args.set).toBe(resolve('rel/set'));
            expect(args.out).toBe(resolve('rel/out'));
            expect(args.skills).toBe(resolve('rel/skills'));
        });

        it('reads every option', () => {
            const args = parseRunArgs([
                '--set',
                '/s',
                '--out',
                '/o',
                '--skills',
                '/app/skills',
                '--subset',
                'variance',
                '--repeat',
                '3',
                '--limit',
                '20',
                '--concurrency',
                '2',
                '--keep-raw',
                '--retry-errors',
                '--execute',
                '--approved-calls',
                '300',
            ]);
            expect(args).toMatchObject({
                skills: '/app/skills',
                subset: 'variance',
                repeat: 3,
                limit: 20,
                concurrency: 2,
                keepRaw: true,
                retryErrors: true,
                execute: true,
                approvedCalls: 300,
            });
        });

        it('requires --set and --out', () => {
            expect(() => parseRunArgs(['--out', '/o'])).toThrow(
                '--set and --out'
            );
            expect(() => parseRunArgs(['--set', '/s'])).toThrow(
                '--set and --out'
            );
        });

        it('rejects a subset other than variance', () => {
            expect(() =>
                parseRunArgs(['--set', '/s', '--out', '/o', '--subset', 'all'])
            ).toThrow('--subset');
        });

        it('rejects a skills path that does not end in a directory named skills', () => {
            expect(() =>
                parseRunArgs([
                    '--set',
                    '/s',
                    '--out',
                    '/o',
                    '--skills',
                    '/app/skill',
                ])
            ).toThrow('named "skills"');
        });

        it('needs --skills to execute', () => {
            expect(() =>
                parseRunArgs(['--set', '/s', '--out', '/o', '--execute'])
            ).toThrow('--execute needs --skills');
        });

        it('rejects a non-positive repeat, limit or concurrency', () => {
            const base = ['--set', '/s', '--out', '/o'];
            expect(() => parseRunArgs([...base, '--repeat', '0'])).toThrow(
                '--repeat'
            );
            expect(() => parseRunArgs([...base, '--limit', '-1'])).toThrow(
                '--limit'
            );
            expect(() =>
                parseRunArgs([...base, '--concurrency', '1.5'])
            ).toThrow('--concurrency');
        });

        it('rejects an approved-calls that is not a non-negative integer', () => {
            const base = ['--set', '/s', '--out', '/o'];
            expect(() =>
                parseRunArgs([...base, '--approved-calls', 'many'])
            ).toThrow('--approved-calls');
            expect(() =>
                parseRunArgs([...base, '--approved-calls', '-3'])
            ).toThrow('--approved-calls');
            expect(
                parseRunArgs([...base, '--approved-calls', '0']).approvedCalls
            ).toBe(0);
        });
    });

    // ─── Cost ─────────────────────────────────────────────────────────────────────
    describe('isDeepSeekPeak', () => {
        const at = (iso: string): Date => new Date(iso);

        it('is true inside 01:00-04:00 and 06:00-10:00 UTC on weekdays, half-open', () => {
            expect(isDeepSeekPeak(at('2026-11-23T01:00:00Z'))).toBe(true);
            expect(isDeepSeekPeak(at('2026-11-23T03:59:00Z'))).toBe(true);
            expect(isDeepSeekPeak(at('2026-11-23T06:00:00Z'))).toBe(true);
            expect(isDeepSeekPeak(at('2026-11-23T09:59:00Z'))).toBe(true);
        });

        it('is false just outside the windows', () => {
            expect(isDeepSeekPeak(at('2026-11-23T00:59:00Z'))).toBe(false);
            expect(isDeepSeekPeak(at('2026-11-23T04:00:00Z'))).toBe(false);
            expect(isDeepSeekPeak(at('2026-11-23T05:59:00Z'))).toBe(false);
            expect(isDeepSeekPeak(at('2026-11-23T10:00:00Z'))).toBe(false);
        });

        it('is false at the weekend and true on Monday and Friday', () => {
            expect(isDeepSeekPeak(at('2026-11-21T02:00:00Z'))).toBe(false); // Saturday
            expect(isDeepSeekPeak(at('2026-11-22T07:00:00Z'))).toBe(false); // Sunday
            expect(isDeepSeekPeak(at('2026-11-23T02:00:00Z'))).toBe(true); // Monday
            expect(isDeepSeekPeak(at('2026-11-27T02:00:00Z'))).toBe(true); // Friday
        });
    });

    describe('estimateCost', () => {
        it('scales the measured call size and price by the call count', () => {
            const estimate = estimateCost(
                300,
                new Date('2026-11-21T12:00:00Z')
            );
            expect(estimate).toEqual({
                calls: 300,
                inputTokens: 300 * INPUT_TOKENS_PER_CALL,
                outputTokens: 300 * OUTPUT_TOKENS_PER_CALL,
                usd: 300 * USD_PER_CALL,
                peak: false,
            });
            expect(estimate.inputTokens).toBe(10_710_000);
            expect(estimate.usd).toBeCloseTo(2.22, 2);
        });

        it('doubles the price when started inside a peak window', () => {
            const estimate = estimateCost(
                300,
                new Date('2026-11-23T02:00:00Z')
            );
            expect(estimate.peak).toBe(true);
            expect(estimate.usd).toBeCloseTo(
                300 * USD_PER_CALL * PEAK_PRICE_MULTIPLIER,
                10
            );
        });

        it('is zero for no calls', () => {
            expect(estimateCost(0, new Date('2026-11-21T12:00:00Z')).usd).toBe(
                0
            );
        });
    });

    // ─── Approval ─────────────────────────────────────────────────────────────────
    describe('checkApproval', () => {
        it('passes only when the approved count equals the planned count', () => {
            expect(checkApproval(300, 300)).toEqual({ ok: true });
        });

        it('refuses a smaller and a larger approved count', () => {
            expect(checkApproval(300, 299)).toMatchObject({ ok: false });
            expect(checkApproval(300, 301)).toMatchObject({ ok: false });
        });

        it('refuses a missing approval and names the planned count', () => {
            const result = checkApproval(300, null);
            expect(result).toMatchObject({ ok: false });
            expect(JSON.stringify(result)).toContain('--approved-calls 300');
        });

        it('does not read an approval of 0 as missing', () => {
            expect(checkApproval(5, 0)).toMatchObject({
                ok: false,
                reason: expect.stringContaining('does not equal'),
            });
            expect(checkApproval(0, 0)).toEqual({ ok: true });
        });
    });

    describe('hashTree', () => {
        it('is stable for the same tree and changes with content, name and nesting', () => {
            const dir = temp();
            mkdirSync(join(dir, 'sub'));
            writeFileSync(join(dir, 'a.md'), 'one');
            writeFileSync(join(dir, 'sub/b.md'), 'two');
            const first = hashTree(dir);
            expect(hashTree(dir)).toBe(first);
            writeFileSync(join(dir, 'sub/b.md'), 'three');
            const changed = hashTree(dir);
            expect(changed).not.toBe(first);
            writeFileSync(join(dir, 'sub/b.md'), 'two');
            expect(hashTree(dir)).toBe(first);
            writeFileSync(join(dir, 'sub/c.md'), 'two');
            expect(hashTree(dir)).not.toBe(first);
        });

        it('tells a moved file from an unchanged tree', () => {
            const left = temp();
            const right = temp();
            writeFileSync(join(left, 'a.md'), 'x');
            writeFileSync(join(right, 'b.md'), 'x');
            expect(hashTree(left)).not.toBe(hashTree(right));
        });
    });

    // ─── Selection and jobs ───────────────────────────────────────────────────────
    describe('selectRunCases', () => {
        const f = makeFixture();
        const withVariance: ReplayManifest = {
            ...f.manifest,
            cases: f.manifest.cases.map((c, i) => ({
                ...c,
                variance: i % 2 === 0,
            })),
        };

        it('takes every case by default', () => {
            expect(
                selectRunCases(withVariance, { subset: null, limit: null })
            ).toEqual(withVariance.cases);
        });

        it('takes only the variance subset when asked', () => {
            const selected = selectRunCases(withVariance, {
                subset: 'variance',
                limit: null,
            });
            expect(selected.length).toBeGreaterThan(0);
            expect(selected.every(c => c.variance)).toBe(true);
            expect(selected.length).toBe(
                withVariance.cases.filter(c => c.variance).length
            );
        });

        it('takes the cases with the smallest sha256(caseId) for a limit, in manifest order', () => {
            const limited = selectRunCases(withVariance, {
                subset: null,
                limit: 3,
            });
            const expected = withVariance.cases
                .map(c => ({ c, key: sha256Hex(c.caseId) }))
                .toSorted((a, b) => (a.key < b.key ? -1 : 1))
                .slice(0, 3)
                .map(x => x.c.caseId);
            expect(limited.map(c => c.caseId).toSorted()).toEqual(
                expected.toSorted()
            );
            const order = withVariance.cases.map(c => c.caseId);
            expect(limited.map(c => order.indexOf(c.caseId))).toEqual(
                limited
                    .map(c => order.indexOf(c.caseId))
                    .toSorted((a, b) => a - b)
            );
        });

        it('is the same cases on every call (two arms see the same pilot)', () => {
            expect(
                selectRunCases(withVariance, { subset: null, limit: 3 })
            ).toEqual(selectRunCases(withVariance, { subset: null, limit: 3 }));
        });

        it('applies the limit inside the subset', () => {
            const limited = selectRunCases(withVariance, {
                subset: 'variance',
                limit: 2,
            });
            expect(limited).toHaveLength(2);
            expect(limited.every(c => c.variance)).toBe(true);
        });

        it('returns every case when the limit exceeds the count', () => {
            expect(
                selectRunCases(withVariance, { subset: null, limit: 10_000 })
            ).toHaveLength(withVariance.cases.length);
        });
    });

    describe('jobsFor / splitJobs', () => {
        const f = makeFixture();
        const cases = f.manifest.cases.slice(0, 2);

        it('makes one job per case and 1-based repeat', () => {
            const jobs = jobsFor(cases, 3);
            expect(jobs).toHaveLength(6);
            expect(jobs.map(j => j.repeat)).toEqual([1, 2, 3, 1, 2, 3]);
            expect(jobs[0].name).toBe(jobName(cases[0], 1));
            expect(jobs[0].name).toBe(`${cases[0].symbol}_${cases[0].asOf}.r1`);
        });

        it('counts an existing result as done and the rest as pending', () => {
            const runDir = temp();
            const jobs = jobsFor(cases, 2);
            mkdirSync(join(runDir, 'results'), { recursive: true });
            writeFileSync(
                resultPath(runDir, jobs[1]),
                JSON.stringify({ error: null })
            );
            const split = splitJobs(jobs, runDir, false);
            expect(split.done.map(j => j.name)).toEqual([jobs[1].name]);
            expect(split.pending).toHaveLength(3);
        });

        it('keeps a failed result done unless errors are to be retried', () => {
            const runDir = temp();
            const jobs = jobsFor(cases, 1);
            mkdirSync(join(runDir, 'results'), { recursive: true });
            writeFileSync(
                resultPath(runDir, jobs[0]),
                JSON.stringify({ error: 'boom' })
            );
            writeFileSync(
                resultPath(runDir, jobs[1]),
                JSON.stringify({ error: null })
            );
            expect(splitJobs(jobs, runDir, false).done).toHaveLength(2);
            const retry = splitJobs(jobs, runDir, true);
            expect(retry.done.map(j => j.name)).toEqual([jobs[1].name]);
            expect(retry.pending.map(j => j.name)).toEqual([jobs[0].name]);
        });
    });

    // ─── Concurrency ──────────────────────────────────────────────────────────────
    describe('mapLimit', () => {
        it('never runs more than `limit` workers at once and returns results in input order', async () => {
            const state = { running: 0, peak: 0 };
            const results = await mapLimit(
                [5, 1, 4, 2, 3, 6, 7],
                3,
                async n => {
                    state.running += 1;
                    state.peak = Math.max(state.peak, state.running);
                    await new Promise(done => setTimeout(done, n));
                    state.running -= 1;
                    return n * 10;
                }
            );
            expect(results).toEqual([50, 10, 40, 20, 30, 60, 70]);
            expect(state.peak).toBe(3);
        });

        it('runs each item exactly once', async () => {
            const seen = vi.fn();
            await mapLimit([1, 2, 3, 4, 5], 2, async n => {
                seen(n);
                return n;
            });
            expect(seen.mock.calls.map(([n]) => n).toSorted()).toEqual([
                1, 2, 3, 4, 5,
            ]);
        });

        it('handles a limit above the item count and no items', async () => {
            expect(await mapLimit([1, 2], 10, async n => n)).toEqual([1, 2]);
            expect(await mapLimit([], 4, async n => n)).toEqual([]);
        });

        it('passes the item index', async () => {
            expect(await mapLimit(['a', 'b'], 1, async (_, i) => i)).toEqual([
                0, 1,
            ]);
        });
    });

    // ─── executeJob ───────────────────────────────────────────────────────────────
    describe('executeJob', () => {
        it('writes the result with prompt hashes, summed usage and rounded latency', async () => {
            const f = makeFixture();
            const job = jobsFor(f.manifest.cases.slice(0, 1), 1)[0];
            const stored = new Map([
                [
                    job.case.symbol,
                    JSON.parse(
                        readFileSync(
                            join(
                                f.setDir,
                                f.manifest.bars[job.case.symbol].file
                            ),
                            'utf-8'
                        )
                    ),
                ],
            ]);
            const result = await executeJob(job, {
                deps: {
                    analyze: async input => okOutput(input),
                    identity: IDENTITY,
                },
                runDir: f.outDir,
                keepRaw: false,
                stored,
            });
            const onDisk = JSON.parse(
                readFileSync(resultPath(f.outDir, job), 'utf-8')
            ) as CaseResultFile;
            expect(onDisk).toEqual(result);
            expect(onDisk).toMatchObject({
                caseId: job.case.caseId,
                repeat: 1,
                promptVersion: 'p34',
                promptDynamic: `dyn ${job.case.caseId}`,
                usage: {
                    inputTokens: 2000,
                    outputTokens: 400,
                    cachedTokens: 800,
                },
                latencyMs: 13,
                error: null,
            });
            expect(onDisk.promptHashes).toEqual({
                system: sha256Hex('sys'),
                stable: sha256Hex('stb'),
                dynamic: sha256Hex(`dyn ${job.case.caseId}`),
                full: sha256Hex(`sys\n\ndyn ${job.case.caseId}`),
            });
        });

        it('hands the analyzer the stored bars, the market profile and the clock instant of the session close', async () => {
            const f = makeFixture();
            const job = jobsFor(
                f.manifest.cases.filter(c => c.symbol === 'NVDA').slice(0, 1),
                1
            )[0];
            const bars = JSON.parse(
                readFileSync(join(f.setDir, f.manifest.bars.NVDA.file), 'utf-8')
            );
            const analyze = vi.fn(async (input: AnalyzeInput) =>
                okOutput(input)
            );
            await executeJob(job, {
                deps: { analyze, identity: IDENTITY },
                runDir: f.outDir,
                keepRaw: false,
                stored: new Map([['NVDA', bars]]),
            });
            const input = analyze.mock.lastCall?.[0];
            expect(input?.stored).toBe(bars);
            expect(input?.profile.session).toBe(US_EQUITY_SESSION);
            expect(input?.clockMs).toBe(
                sessionCloseInstantMs(US_EQUITY_SESSION, job.case.asOf)
            );
        });

        it('records a thrown analyzer error as the result instead of throwing', async () => {
            const f = makeFixture();
            const job = jobsFor(f.manifest.cases.slice(0, 1), 1)[0];
            const bars = JSON.parse(
                readFileSync(
                    join(f.setDir, f.manifest.bars[job.case.symbol].file),
                    'utf-8'
                )
            );
            const result = await executeJob(job, {
                deps: {
                    analyze: async () => {
                        throw new Error('provider down');
                    },
                    identity: IDENTITY,
                },
                runDir: f.outDir,
                keepRaw: false,
                stored: new Map([[job.case.symbol, bars]]),
            });
            expect(result).toMatchObject({
                error: 'provider down',
                unfilteredResult: null,
                usage: null,
            });
            expect(existsSync(resultPath(f.outDir, job))).toBe(true);
        });

        it('records a case on a non-trading day as an error without calling the analyzer', async () => {
            const f = makeFixture();
            const base = f.manifest.cases.find(c => c.symbol === 'NVDA');
            const holiday = {
                ...(base as NonNullable<typeof base>),
                asOf: '2024-11-28',
                caseId: 'NVDA|2024-11-28',
            };
            const analyze = vi.fn(async (input: AnalyzeInput) =>
                okOutput(input)
            );
            const result = await executeJob(jobsFor([holiday], 1)[0], {
                deps: { analyze, identity: IDENTITY },
                runDir: f.outDir,
                keepRaw: false,
                stored: new Map([
                    [
                        'NVDA',
                        JSON.parse(
                            readFileSync(
                                join(f.setDir, f.manifest.bars.NVDA.file),
                                'utf-8'
                            )
                        ),
                    ],
                ]),
            });
            expect(result.error).toContain('not a trading day');
            expect(analyze).not.toHaveBeenCalled();
        });

        it('records a symbol with no loaded bars as an error', async () => {
            const f = makeFixture();
            const job = jobsFor(f.manifest.cases.slice(0, 1), 1)[0];
            const result = await executeJob(job, {
                deps: {
                    analyze: async input => okOutput(input),
                    identity: IDENTITY,
                },
                runDir: f.outDir,
                keepRaw: false,
                stored: new Map(),
            });
            expect(result.error).toContain('no bars loaded');
        });

        it('writes gzipped request bodies and response texts only with keepRaw', async () => {
            const f = makeFixture();
            const [job] = jobsFor(f.manifest.cases.slice(0, 1), 1);
            const bars = JSON.parse(
                readFileSync(
                    join(f.setDir, f.manifest.bars[job.case.symbol].file),
                    'utf-8'
                )
            );
            const context = {
                deps: {
                    analyze: async (input: AnalyzeInput) => okOutput(input),
                    identity: IDENTITY,
                },
                runDir: f.outDir,
                stored: new Map([[job.case.symbol, bars]]),
            };
            await executeJob(job, { ...context, keepRaw: false });
            expect(existsSync(join(f.outDir, 'raw'))).toBe(false);
            await executeJob(job, { ...context, keepRaw: true });
            const raw = JSON.parse(
                gunzipSync(
                    readFileSync(join(f.outDir, 'raw', `${job.name}.json.gz`))
                ).toString('utf-8')
            );
            expect(raw).toEqual([
                { requestBody: { n: 1 }, responseText: SSE_USAGE },
                { requestBody: { n: 2 }, responseText: SSE_USAGE },
            ]);
        });

        it('writes no raw file when the call made no exchange', async () => {
            const f = makeFixture();
            const [job] = jobsFor(f.manifest.cases.slice(0, 1), 1);
            const bars = JSON.parse(
                readFileSync(
                    join(f.setDir, f.manifest.bars[job.case.symbol].file),
                    'utf-8'
                )
            );
            await executeJob(job, {
                deps: {
                    analyze: async input => ({
                        ...okOutput(input),
                        exchanges: [],
                    }),
                    identity: IDENTITY,
                },
                runDir: f.outDir,
                keepRaw: true,
                stored: new Map([[job.case.symbol, bars]]),
            });
            expect(existsSync(join(f.outDir, 'raw'))).toBe(false);
        });
    });

    // ─── assertSameRun ────────────────────────────────────────────────────────────
    describe('assertSameRun', () => {
        const meta: RunMeta = {
            setId: 'replay-v1',
            setBarsSha256: 'b',
            coreGitSha: 'a',
            promptTemplateVersion: 'p34',
            model: 'm',
            tier: 'member',
            skillsSha256: 's',
            repeat: 1,
            subset: null,
            limit: null,
            startedAt: '2026-01-01T00:00:00Z',
        };

        it('accepts the same identity whatever the start time', () => {
            expect(() =>
                assertSameRun(meta, { ...meta, startedAt: 'later' })
            ).not.toThrow();
        });

        it('treats a run made before the timeframe was recorded as a 1Day run', () => {
            expect(() =>
                assertSameRun(meta, { ...meta, timeframe: '1Day' })
            ).not.toThrow();
            expect(() =>
                assertSameRun({ ...meta, timeframe: '1Hour' }, meta)
            ).toThrow('timeframe');
            expect(() =>
                assertSameRun(meta, { ...meta, timeframe: '1Hour' })
            ).toThrow('timeframe');
        });

        it('refuses to resume with a different subset or limit', () => {
            expect(() =>
                assertSameRun(meta, { ...meta, subset: 'variance' })
            ).toThrow('subset');
            expect(() => assertSameRun(meta, { ...meta, limit: 5 })).toThrow(
                'limit'
            );
        });

        it.each([
            'setId',
            'setBarsSha256',
            'coreGitSha',
            'promptTemplateVersion',
            'model',
            'tier',
            'skillsSha256',
            'repeat',
        ] as const)('refuses a different %s', field => {
            expect(() =>
                assertSameRun(meta, {
                    ...meta,
                    [field]: field === 'repeat' ? 2 : 'other',
                })
            ).toThrow(field);
        });
    });

    // ─── runReplay ────────────────────────────────────────────────────────────────
    describe('runReplay: dry run', () => {
        it('prints the plan, makes no call and writes nothing', async () => {
            const f = makeFixture();
            const { deps, analyzeSpy, loadExecuteDeps, logged } = makeDeps();
            const code = await runReplay(argsFor(f), deps);
            expect(code).toBe(0);
            expect(logged()).toContain(
                `planned calls: ${f.manifest.cases.length}`
            );
            expect(logged()).toContain('token estimate');
            expect(logged()).toContain('cost estimate');
            expect(logged()).toContain('dry run: no provider call made');
            expect(loadExecuteDeps).not.toHaveBeenCalled();
            expect(analyzeSpy).not.toHaveBeenCalled();
            expect(existsSync(f.outDir)).toBe(false);
        });

        it('logs each line as one argument', async () => {
            const f = makeFixture();
            const log = vi.fn();
            const { deps } = makeDeps();
            await runReplay(argsFor(f), { ...deps, log } as RunDeps);
            expect(log.mock.calls.length).toBeGreaterThan(3);
            expect(log.mock.calls.every(args => args.length === 1)).toBe(true);
        });

        it('multiplies the plan by --repeat and narrows it with --subset and --limit', async () => {
            const f = makeFixture();
            const { deps, logged } = makeDeps();
            await runReplay(
                argsFor(f, ['--repeat', '3', '--limit', '2']),
                deps
            );
            expect(logged()).toContain('planned calls: 6');
        });

        it('prints the doubled estimate when started inside a peak window', async () => {
            const f = makeFixture();
            const { deps, logged } = makeDeps();
            await runReplay(argsFor(f), {
                ...deps,
                now: () => new Date('2026-11-23T02:00:00Z'),
            });
            expect(logged()).toContain(
                'doubled: started inside a DeepSeek peak window'
            );
        });

        it('works without --skills', async () => {
            const f = makeFixture();
            const { deps } = makeDeps();
            const code = await runReplay(
                parseRunArgs(['--set', f.setDir, '--out', f.outDir]),
                deps
            );
            expect(code).toBe(0);
        });

        it('refuses a set whose bars hash changed, even for a dry run', async () => {
            const f = makeFixture();
            const file = join(f.setDir, f.manifest.bars.NVDA.file);
            writeFileSync(file, `${readFileSync(file, 'utf-8')} `);
            const { deps } = makeDeps();
            await expect(runReplay(argsFor(f), deps)).rejects.toThrow(
                'set hash mismatch'
            );
        });

        it('refuses an output directory inside the repository', async () => {
            const f = makeFixture();
            const { deps } = makeDeps();
            const args = { ...argsFor(f), out: join(REPO_ROOT, 'run-out') };
            await expect(runReplay(args, deps)).rejects.toThrow(
                'inside the repository'
            );
        });
    });

    describe('runReplay: approval guard', () => {
        it('refuses --execute without --approved-calls and runs nothing', async () => {
            const f = makeFixture();
            const { deps, analyzeSpy, loadExecuteDeps, logged } = makeDeps();
            const code = await runReplay(argsFor(f, ['--execute']), deps);
            expect(code).toBe(2);
            expect(logged()).toContain(
                `--approved-calls ${f.manifest.cases.length}`
            );
            expect(loadExecuteDeps).not.toHaveBeenCalled();
            expect(analyzeSpy).not.toHaveBeenCalled();
            expect(resultFiles(f)).toEqual([]);
        });

        it('refuses an approved count one below and one above the planned count', async () => {
            const f = makeFixture();
            const planned = f.manifest.cases.length;
            const { deps, analyzeSpy, logged } = makeDeps();
            expect(
                await runReplay(
                    argsFor(f, [
                        '--execute',
                        '--approved-calls',
                        String(planned - 1),
                    ]),
                    deps
                )
            ).toBe(2);
            expect(
                await runReplay(
                    argsFor(f, [
                        '--execute',
                        '--approved-calls',
                        String(planned + 1),
                    ]),
                    deps
                )
            ).toBe(2);
            expect(logged()).toContain('does not equal the planned count');
            expect(analyzeSpy).not.toHaveBeenCalled();
        });

        it('runs when the approved count equals the planned count', async () => {
            const f = makeFixture();
            const planned = f.manifest.cases.length;
            const { deps, analyzeSpy } = makeDeps();
            expect(
                await runReplay(
                    argsFor(f, [
                        '--execute',
                        '--approved-calls',
                        String(planned),
                    ]),
                    deps
                )
            ).toBe(0);
            expect(analyzeSpy).toHaveBeenCalledTimes(planned);
        });

        it('compares the approval with the repeat-multiplied count', async () => {
            const f = makeFixture();
            const planned = f.manifest.cases.length;
            const { deps, analyzeSpy } = makeDeps();
            const refused = await runReplay(
                argsFor(f, [
                    '--repeat',
                    '2',
                    '--execute',
                    '--approved-calls',
                    String(planned),
                ]),
                deps
            );
            expect(refused).toBe(2);
            expect(analyzeSpy).not.toHaveBeenCalled();
        });

        it('refuses to execute without a skills path when called directly', async () => {
            const f = makeFixture();
            const { deps, loadExecuteDeps, logged } = makeDeps();
            const args = {
                ...argsFor(f, [
                    '--execute',
                    '--approved-calls',
                    String(f.manifest.cases.length),
                ]),
                skills: null,
            };
            expect(await runReplay(args, deps)).toBe(2);
            expect(logged()).toContain('--skills is required');
            expect(loadExecuteDeps).not.toHaveBeenCalled();
        });
    });

    describe('runReplay: execute and resume', () => {
        it('writes run.json and one result per case', async () => {
            const f = makeFixture();
            const planned = f.manifest.cases.length;
            const { deps, loadExecuteDeps } = makeDeps();
            await runReplay(
                argsFor(f, ['--execute', '--approved-calls', String(planned)]),
                deps
            );
            expect(loadExecuteDeps).toHaveBeenCalledWith(
                f.skillsDir,
                expect.any(Function),
                'member',
                '1Day'
            );
            expect(resultFiles(f)).toHaveLength(planned);
            const meta = JSON.parse(
                readFileSync(join(f.outDir, 'run.json'), 'utf-8')
            ) as RunMeta;
            expect(meta).toMatchObject({
                ...IDENTITY,
                setId: 'replay-v1',
                repeat: 1,
                subset: null,
                limit: null,
                timeframe: '1Day',
            });
            expect(meta.skillsSha256).toBe(hashTree(f.skillsDir));
            expect(meta.startedAt).toBe('2026-11-21T12:00:00.000Z');
        });

        it('passes the requested timeframe to the loader, records it in run.json and refuses to resume under another', async () => {
            const f = makeFixture();
            const planned = f.manifest.cases.length;
            const run = (timeframe: string) =>
                argsFor(f, [
                    '--timeframe',
                    timeframe,
                    '--limit',
                    '2',
                    '--execute',
                    '--approved-calls',
                    '2',
                ]);
            const { deps, loadExecuteDeps } = makeDeps();
            await runReplay(run('1Hour'), deps);
            expect(loadExecuteDeps).toHaveBeenCalledWith(
                f.skillsDir,
                expect.any(Function),
                'member',
                '1Hour'
            );
            const meta = JSON.parse(
                readFileSync(join(f.outDir, 'run.json'), 'utf-8')
            ) as RunMeta;
            expect(meta.timeframe).toBe('1Hour');
            expect(planned).toBeGreaterThanOrEqual(2);
            // Pending again, so the run reaches the identity check.
            rmSync(join(f.outDir, 'results'), { recursive: true });
            await expect(
                runReplay(run('1Day'), makeDeps().deps)
            ).rejects.toThrow('timeframe differ from the run already');
        });

        it('passes the requested tier to the loader and records it in run.json', async () => {
            const f = makeFixture();
            const planned = f.manifest.cases.length;
            const { deps, loadExecuteDeps } = makeDeps(undefined, {
                ...IDENTITY,
                tier: 'free',
            });
            await runReplay(
                argsFor(f, [
                    '--tier',
                    'free',
                    '--execute',
                    '--approved-calls',
                    String(planned),
                ]),
                deps
            );
            expect(loadExecuteDeps).toHaveBeenCalledWith(
                f.skillsDir,
                expect.any(Function),
                'free',
                '1Day'
            );
            const meta = JSON.parse(
                readFileSync(join(f.outDir, 'run.json'), 'utf-8')
            ) as RunMeta;
            expect(meta.tier).toBe('free');
        });

        it('refuses to resume a run directory under another tier', async () => {
            const f = makeFixture();
            const withLimit = (tier: string) =>
                argsFor(f, [
                    '--tier',
                    tier,
                    '--limit',
                    '2',
                    '--execute',
                    '--approved-calls',
                    '2',
                ]);
            const first = makeDeps(undefined, { ...IDENTITY, tier: 'free' });
            await runReplay(withLimit('free'), first.deps);
            // Pending again, so the run reaches the identity check.
            rmSync(join(f.outDir, 'results'), { recursive: true });
            const second = makeDeps();
            await expect(
                runReplay(withLimit('member'), second.deps)
            ).rejects.toThrow('tier differ from the run already');
        });

        it('skips existing results when resumed and asks for the new pending count', async () => {
            const f = makeFixture();
            const planned = f.manifest.cases.length;
            const first = makeDeps();
            await runReplay(
                argsFor(f, ['--execute', '--approved-calls', String(planned)]),
                first.deps
            );
            const removed = resultFiles(f)[0];
            rmSync(join(f.outDir, 'results', removed));

            const second = makeDeps();
            const refused = await runReplay(
                argsFor(f, ['--execute', '--approved-calls', String(planned)]),
                second.deps
            );
            expect(refused).toBe(2);
            expect(second.logged()).toContain(
                'does not equal the planned count 1'
            );

            const resumed = await runReplay(
                argsFor(f, ['--execute', '--approved-calls', '1']),
                second.deps
            );
            expect(resumed).toBe(0);
            expect(second.analyzeSpy).toHaveBeenCalledTimes(1);
            expect(resultFiles(f)).toHaveLength(planned);
        });

        it('does nothing when every result exists', async () => {
            const f = makeFixture();
            const planned = f.manifest.cases.length;
            const first = makeDeps();
            await runReplay(
                argsFor(f, ['--execute', '--approved-calls', String(planned)]),
                first.deps
            );
            const again = makeDeps();
            expect(
                await runReplay(
                    argsFor(f, ['--execute', '--approved-calls', '0']),
                    again.deps
                )
            ).toBe(0);
            expect(again.logged()).toContain('nothing to run');
            expect(again.loadExecuteDeps).not.toHaveBeenCalled();
        });

        it('keeps a failed result and redoes it only with --retry-errors', async () => {
            const f = makeFixture();
            const planned = f.manifest.cases.length;
            const failing = makeDeps(async () => {
                throw new Error('down');
            });
            await runReplay(
                argsFor(f, ['--execute', '--approved-calls', String(planned)]),
                failing.deps
            );
            expect(failing.logged()).toContain(
                `finished: 0 ok, ${planned} failed`
            );

            const plain = makeDeps();
            expect(
                await runReplay(
                    argsFor(f, ['--execute', '--approved-calls', '0']),
                    plain.deps
                )
            ).toBe(0);
            expect(plain.analyzeSpy).not.toHaveBeenCalled();

            const retry = makeDeps();
            await runReplay(
                argsFor(f, [
                    '--retry-errors',
                    '--execute',
                    '--approved-calls',
                    String(planned),
                ]),
                retry.deps
            );
            expect(retry.analyzeSpy).toHaveBeenCalledTimes(planned);
        });

        it('refuses to resume a run directory made with another prompt version', async () => {
            const f = makeFixture();
            const first = makeDeps();
            await runReplay(
                argsFor(f, [
                    '--limit',
                    '2',
                    '--execute',
                    '--approved-calls',
                    '2',
                ]),
                first.deps
            );
            rmSync(join(f.outDir, 'results', resultFiles(f)[0]));
            const other = makeDeps(undefined, {
                ...IDENTITY,
                promptTemplateVersion: 'p35',
            });
            await expect(
                runReplay(
                    argsFor(f, [
                        '--limit',
                        '2',
                        '--execute',
                        '--approved-calls',
                        '1',
                    ]),
                    other.deps
                )
            ).rejects.toThrow('promptTemplateVersion differ');
            expect(other.analyzeSpy).not.toHaveBeenCalled();
        });

        it('refuses to resume with a different --limit', async () => {
            const f = makeFixture();
            const first = makeDeps();
            await runReplay(
                argsFor(f, [
                    '--limit',
                    '2',
                    '--execute',
                    '--approved-calls',
                    '2',
                ]),
                first.deps
            );
            const again = makeDeps();
            await expect(
                runReplay(
                    argsFor(f, [
                        '--limit',
                        '3',
                        '--execute',
                        '--approved-calls',
                        '1',
                    ]),
                    again.deps
                )
            ).rejects.toThrow('limit differ');
            expect(again.analyzeSpy).not.toHaveBeenCalled();
        });

        it('runs repeats as separate result files', async () => {
            const f = makeFixture();
            const { deps } = makeDeps();
            await runReplay(
                argsFor(f, [
                    '--limit',
                    '2',
                    '--repeat',
                    '3',
                    '--execute',
                    '--approved-calls',
                    '6',
                ]),
                deps
            );
            const names = resultFiles(f);
            expect(names).toHaveLength(6);
            expect(names.filter(n => n.endsWith('.r3.json'))).toHaveLength(2);
        });

        it('keeps the raw exchanges with --keep-raw', async () => {
            const f = makeFixture();
            const { deps } = makeDeps();
            await runReplay(
                argsFor(f, [
                    '--limit',
                    '1',
                    '--keep-raw',
                    '--execute',
                    '--approved-calls',
                    '1',
                ]),
                deps
            );
            expect(readdirSync(join(f.outDir, 'raw'))).toHaveLength(1);
        });

        it('logs one line per call with its outcome', async () => {
            const f = makeFixture();
            const { deps, logged } = makeDeps();
            await runReplay(
                argsFor(f, [
                    '--limit',
                    '2',
                    '--execute',
                    '--approved-calls',
                    '2',
                ]),
                deps
            );
            expect(logged()).toMatch(/\[\d\/2\] \S+\.r1 ok 13ms/);
            expect(logged()).toContain('finished: 2 ok, 0 failed');
        });

        it('never runs more calls at once than --concurrency', async () => {
            const f = makeFixture();
            const state = { running: 0, peak: 0 };
            const { deps } = makeDeps(async input => {
                state.running += 1;
                state.peak = Math.max(state.peak, state.running);
                await new Promise(done => setTimeout(done, 5));
                state.running -= 1;
                return okOutput(input);
            });
            await runReplay(
                argsFor(f, [
                    '--concurrency',
                    '2',
                    '--execute',
                    '--approved-calls',
                    String(f.manifest.cases.length),
                ]),
                deps
            );
            expect(state.peak).toBe(2);
        });
    });

    // ─── One symbol at a time ─────────────────────────────────────────────────────
    /** Tracks which symbols are in flight; `maxPerSymbol` must never exceed 1. */
    function inFlightProbe() {
        const state = {
            perSymbol: new Map<string, number>(),
            maxPerSymbol: 0,
            running: 0,
            peak: 0,
            order: [] as string[],
        };
        const enter = (symbol: string): void => {
            const next = (state.perSymbol.get(symbol) ?? 0) + 1;
            state.perSymbol.set(symbol, next);
            state.maxPerSymbol = Math.max(state.maxPerSymbol, next);
            state.running += 1;
            state.peak = Math.max(state.peak, state.running);
        };
        const leave = (symbol: string, name: string): void => {
            state.perSymbol.set(symbol, (state.perSymbol.get(symbol) ?? 1) - 1);
            state.running -= 1;
            // A collector that grows across async callbacks (CONVENTIONS.md#CP-5).
            state.order.push(name);
        };
        return { state, enter, leave };
    }

    describe('runPerSymbol', () => {
        const symbols = ['NVDA', 'AAPL', 'MSFT', '005930.KS'];

        it('never has two jobs of one symbol in flight, with 4 lanes, 3 repeats and several dates per symbol', async () => {
            const f = makeFixture(symbols);
            const jobs = jobsFor(f.manifest.cases, 3);
            const perSymbol = symbols.map(
                symbol =>
                    f.manifest.cases.filter(c => c.symbol === symbol).length
            );
            expect(Math.min(...perSymbol)).toBeGreaterThan(2);
            const probe = inFlightProbe();
            const results = await runPerSymbol(jobs, 4, async job => {
                probe.enter(job.case.symbol);
                await new Promise(done => setTimeout(done, 2));
                probe.leave(job.case.symbol, job.name);
                return job.name;
            });
            expect(results).toHaveLength(jobs.length);
            expect(probe.state.maxPerSymbol).toBe(1);
        });

        it('does run different symbols side by side, up to the concurrency', async () => {
            const f = makeFixture(symbols);
            const probe = inFlightProbe();
            await runPerSymbol(jobsFor(f.manifest.cases, 3), 4, async job => {
                probe.enter(job.case.symbol);
                await new Promise(done => setTimeout(done, 2));
                probe.leave(job.case.symbol, job.name);
            });
            expect(probe.state.peak).toBe(4);
            const narrow = inFlightProbe();
            await runPerSymbol(jobsFor(f.manifest.cases, 1), 2, async job => {
                narrow.enter(job.case.symbol);
                await new Promise(done => setTimeout(done, 2));
                narrow.leave(job.case.symbol, job.name);
            });
            expect(narrow.state.peak).toBe(2);
        });

        it("runs the jobs of a symbol in job order: a case's repeats one after another", async () => {
            const f = makeFixture(symbols);
            const jobs = jobsFor(f.manifest.cases, 3);
            const probe = inFlightProbe();
            await runPerSymbol(jobs, 4, async job => {
                probe.enter(job.case.symbol);
                await new Promise(done => setTimeout(done, 1));
                probe.leave(job.case.symbol, job.name);
            });
            symbols.forEach(symbol => {
                const expected = jobs
                    .filter(job => job.case.symbol === symbol)
                    .map(job => job.name);
                const finished = probe.state.order.filter(name =>
                    expected.includes(name)
                );
                expect(expected.length).toBeGreaterThan(0);
                expect(finished).toEqual(expected);
            });
        });

        it('returns one result per job and handles no jobs', async () => {
            const f = makeFixture(symbols);
            const jobs = jobsFor(f.manifest.cases, 2);
            const names = await runPerSymbol(jobs, 3, async job => job.name);
            expect(names.toSorted()).toEqual(
                jobs.map(job => job.name).toSorted()
            );
            expect(await runPerSymbol([], 3, async job => job.name)).toEqual(
                []
            );
        });
    });

    describe('runReplay: concurrency', () => {
        it('never runs two jobs of one symbol at once through the whole command', async () => {
            const f = makeFixture(['NVDA', 'AAPL', 'MSFT', '005930.KS']);
            const probe = inFlightProbe();
            const { deps } = makeDeps(async input => {
                probe.enter(input.case.symbol);
                await new Promise(done => setTimeout(done, 2));
                probe.leave(input.case.symbol, input.case.caseId);
                return okOutput(input);
            });
            const planned = f.manifest.cases.length * 3;
            await runReplay(
                argsFor(f, [
                    '--repeat',
                    '3',
                    '--concurrency',
                    '4',
                    '--execute',
                    '--approved-calls',
                    String(planned),
                ]),
                deps
            );
            expect(probe.state.order).toHaveLength(planned);
            expect(probe.state.maxPerSymbol).toBe(1);
            expect(probe.state.peak).toBe(4);
        });
    });

    describe('a call that joined another generation', () => {
        const withoutPrompt = (input: AnalyzeInput): AnalyzeOutput => ({
            ...okOutput(input),
            prompt: null,
        });

        it('is normalised to an error, never a success', () => {
            const f = makeFixture();
            const output = normalizeOutput(
                withoutPrompt({ case: f.manifest.cases[0] } as AnalyzeInput)
            );
            expect(output.error).toBe(JOINED_GENERATION_ERROR);
            expect(output.unfilteredResult).toBeNull();
        });

        it('leaves a success with a prompt and a failure that has its own error untouched', () => {
            const f = makeFixture();
            const input = { case: f.manifest.cases[0] } as AnalyzeInput;
            const ok = okOutput(input);
            expect(normalizeOutput(ok)).toBe(ok);
            const failed = { ...withoutPrompt(input), error: 'provider down' };
            expect(normalizeOutput(failed)).toBe(failed);
        });

        it('is stored as an error with no result, and its exchanges still count', async () => {
            const f = makeFixture();
            const [job] = jobsFor(f.manifest.cases.slice(0, 1), 1);
            const bars = JSON.parse(
                readFileSync(
                    join(f.setDir, f.manifest.bars[job.case.symbol].file),
                    'utf-8'
                )
            );
            const result = await executeJob(job, {
                deps: {
                    analyze: async input => withoutPrompt(input),
                    identity: IDENTITY,
                },
                runDir: f.outDir,
                keepRaw: false,
                stored: new Map([[job.case.symbol, bars]]),
            });
            expect(result).toMatchObject({
                error: JOINED_GENERATION_ERROR,
                unfilteredResult: null,
                promptDynamic: null,
                exchangeCount: 2,
            });
            const onDisk = JSON.parse(
                readFileSync(resultPath(f.outDir, job), 'utf-8')
            ) as CaseResultFile;
            expect(onDisk.error).toBe(JOINED_GENERATION_ERROR);
        });

        it('counts as a failed call in the run summary', async () => {
            const f = makeFixture();
            const { deps, logged } = makeDeps(async input =>
                withoutPrompt(input)
            );
            await runReplay(
                argsFor(f, [
                    '--limit',
                    '2',
                    '--execute',
                    '--approved-calls',
                    '2',
                ]),
                deps
            );
            expect(logged()).toContain('finished: 0 ok, 2 failed');
        });
    });

    describe('assertSkillsLoaded', () => {
        it('returns and logs the skill count when the skills loaded', async () => {
            const log = vi.fn<(line: string) => void>();
            const count = await assertSkillsLoaded(
                async () => ({ skills: [{}, {}, {}], skillsDegraded: false }),
                log
            );
            expect(count).toBe(3);
            expect(log).toHaveBeenCalledWith('skills loaded: 3');
        });

        it('refuses a degraded load, even when it returned skills', async () => {
            const log = vi.fn<(line: string) => void>();
            await expect(
                assertSkillsLoaded(
                    async () => ({ skills: [{}], skillsDegraded: true }),
                    log
                )
            ).rejects.toThrow('skills did not load');
            expect(log).not.toHaveBeenCalled();
        });

        it('refuses zero skills (a wrong directory)', async () => {
            await expect(
                assertSkillsLoaded(
                    async () => ({ skills: [], skillsDegraded: false }),
                    () => undefined
                )
            ).rejects.toThrow('count: 0');
        });
    });

    describe('describeExchangeCounts', () => {
        it('counts jobs per number of exchanges, ascending', () => {
            expect(describeExchangeCounts([1, 2, 1, 1, 3])).toBe(
                '1: 3 jobs, 2: 1 jobs, 3: 1 jobs'
            );
            expect(describeExchangeCounts([])).toBe('');
        });
    });

    describe('runReplay: requests, paths and secrets', () => {
        it('prints both facts: at most 2 generations per call, and the HTTP request bound with the SDK retries', async () => {
            const f = makeFixture();
            const { deps, logged } = makeDeps();
            await runReplay(argsFor(f), deps);
            expect(MAX_GENERATIONS_PER_CALL).toBe(2);
            expect(WORST_CASE_REQUESTS_PER_CALL).toBe(
                MAX_GENERATIONS_PER_CALL *
                    AI_RETRY_MAX_ATTEMPTS *
                    (1 + OPENAI_SDK_DEFAULT_MAX_RETRIES)
            );
            const planned = f.manifest.cases.length;
            expect(logged()).toContain(
                `billed generations: at most ${MAX_GENERATIONS_PER_CALL} complete generations per call`
            );
            expect(logged()).toContain(
                `HTTP requests: up to ${WORST_CASE_REQUESTS_PER_CALL} per call`
            );
            expect(logged()).toContain(
                `so ${planned} calls can send up to ${planned * WORST_CASE_REQUESTS_PER_CALL}`
            );
        });

        it('prints how many exchanges each job needed when exchanges were recorded', async () => {
            const f = makeFixture();
            const { deps, logged } = makeDeps();
            await runReplay(
                argsFor(f, [
                    '--limit',
                    '3',
                    '--execute',
                    '--approved-calls',
                    '3',
                ]),
                deps
            );
            expect(logged()).toContain('billed exchanges per job: 2: 3 jobs');
        });

        it('prints no exchange distribution when none were recorded', async () => {
            const f = makeFixture();
            const { deps, logged } = makeDeps(async input => ({
                ...okOutput(input),
                exchanges: [],
            }));
            await runReplay(
                argsFor(f, [
                    '--limit',
                    '1',
                    '--execute',
                    '--approved-calls',
                    '1',
                ]),
                deps
            );
            expect(logged()).not.toContain('billed exchanges per job');
        });

        it('records the bars fingerprint of the set in run.json', async () => {
            const f = makeFixture();
            const { deps } = makeDeps();
            await runReplay(
                argsFor(f, [
                    '--limit',
                    '1',
                    '--execute',
                    '--approved-calls',
                    '1',
                ]),
                deps
            );
            const meta = JSON.parse(
                readFileSync(join(f.outDir, 'run.json'), 'utf-8')
            ) as RunMeta;
            expect(meta.setBarsSha256).toBe(barsFingerprint(f.manifest));
        });

        it('refuses an output directory inside the parent directory of --skills (the app checkout)', async () => {
            const f = makeFixture();
            const { deps } = makeDeps();
            const args = { ...argsFor(f), skills: join(f.outDir, 'skills') };
            await expect(runReplay(args, deps)).rejects.toThrow(
                'inside the repository'
            );
        });

        it('refuses a set inside the parent directory of --skills too', async () => {
            const f = makeFixture();
            const { deps } = makeDeps();
            const args = { ...argsFor(f), skills: join(f.setDir, 'skills') };
            await expect(runReplay(args, deps)).rejects.toThrow(
                'inside the repository'
            );
        });

        it('accepts sets and runs beside the app checkout, in any other git repository', async () => {
            const f = makeFixture();
            const { deps } = makeDeps();
            expect(await runReplay(argsFor(f), deps)).toBe(0);
        });

        it('masks key-shaped text of a provider error before it reaches a result file or the log', async () => {
            const f = makeFixture();
            const hexRun = 'a1b2'.repeat(12);
            const { deps, logged } = makeDeps(async () => {
                throw new Error(
                    `401 Bearer sk-abcdef0123456789abcdef key=${hexRun} done`
                );
            });
            await runReplay(
                argsFor(f, [
                    '--limit',
                    '1',
                    '--execute',
                    '--approved-calls',
                    '1',
                ]),
                deps
            );
            const file = readdirSync(join(f.outDir, 'results'))[0];
            const text = readFileSync(join(f.outDir, 'results', file), 'utf-8');
            expect(text).toContain('[redacted]');
            expect(text).not.toContain('abcdef0123456789abcdef');
            expect(text).not.toContain(hexRun);
            expect(logged()).not.toContain(hexRun);
        });
    });

    describe('runPerSymbol: a failing job', () => {
        const symbols = ['NVDA', 'AAPL', 'MSFT', '005930.KS'];

        it('starts no job after the failure and rejects only once the jobs in flight have settled', async () => {
            const f = makeFixture(symbols);
            const jobs = jobsFor(f.manifest.cases, 1);
            const first = jobs[0];
            const events = {
                started: [] as string[],
                settledAfterFailure: [] as string[],
                failed: false,
                startedAfterFailure: 0,
            };
            const slow = deferred<void>();
            const otherLaneStarted = deferred<void>();
            const run = runPerSymbol(jobs, 2, async job => {
                if (events.failed) events.startedAfterFailure += 1;
                // A collector that grows across async callbacks (CONVENTIONS.md#CP-5).
                events.started.push(job.name);
                if (job.name === first.name) {
                    await otherLaneStarted.promise;
                    events.failed = true;
                    throw new Error('disk full');
                }
                // The other lane's job: still running when the failure is observed.
                otherLaneStarted.resolve();
                await slow.promise;
                events.settledAfterFailure.push(job.name);
            });
            const settled = run.then(
                () => 'resolved',
                (error: Error) => error
            );
            await vi.waitFor(() => expect(events.failed).toBe(true));
            // Rejection must not arrive while a job is still in flight.
            const early = await Promise.race([
                settled,
                new Promise(done => setTimeout(() => done('pending'), 20)),
            ]);
            expect(early).toBe('pending');
            slow.resolve();
            const error = await settled;
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toContain('disk full');
            expect((error as Error).message).toContain('jobs had completed');
            expect(events.settledAfterFailure.length).toBeGreaterThan(0);
            expect(events.startedAfterFailure).toBe(0);
            expect(events.started.length).toBeLessThan(jobs.length);
        });

        it('rejects with the first error and counts the completed jobs', async () => {
            const f = makeFixture(['NVDA']);
            const jobs = jobsFor(f.manifest.cases, 1);
            const error = await runPerSymbol(jobs, 1, async job => {
                if (job.name === jobs[2].name) throw new Error('boom');
                return job.name;
            }).catch((e: Error) => e);
            expect((error as Error).message).toContain('boom');
            expect((error as Error).message).toContain(
                `2 of ${jobs.length} jobs had completed`
            );
            expect(((error as Error).cause as Error).message).toBe('boom');
        });

        it('keeps only the first of several errors', async () => {
            const f = makeFixture(['NVDA', 'AAPL']);
            const jobs = jobsFor(f.manifest.cases, 1);
            const error = await runPerSymbol(jobs, 2, async job => {
                throw new Error(`fail ${job.case.symbol}`);
            }).catch((e: Error) => e);
            const [firstSymbol, otherSymbol] = [
                jobs[0].case.symbol,
                jobs.find(j => j.case.symbol !== jobs[0].case.symbol)?.case
                    .symbol,
            ];
            expect((error as Error).message).toContain(`fail ${firstSymbol}`);
            expect((error as Error).message).not.toContain(
                `fail ${otherSymbol}`
            );
        });
    });

    describe('runReplay: run-directory lock', () => {
        const lockOf = (f: Fixture): string => join(f.outDir, RUN_LOCK_FILE);

        it('refuses a second --execute on the same directory while the first runs', async () => {
            const f = makeFixture();
            const gate = deferred<void>();
            const first = makeDeps(async input => {
                await gate.promise;
                return okOutput(input);
            });
            const planned = f.manifest.cases.length;
            const args = argsFor(f, [
                '--execute',
                '--approved-calls',
                String(planned),
            ]);
            const running = runReplay(args, first.deps);
            await vi.waitFor(() => expect(first.analyzeSpy).toHaveBeenCalled());
            const second = makeDeps();
            expect(await runReplay(args, second.deps)).toBe(2);
            expect(second.logged()).toContain(`refused: ${lockOf(f)} exists`);
            expect(second.logged()).toContain('delete that file');
            expect(second.analyzeSpy).not.toHaveBeenCalled();
            expect(second.loadExecuteDeps).not.toHaveBeenCalled();
            gate.resolve();
            expect(await running).toBe(0);
        });

        it('takes the lock for the run and removes it after success', async () => {
            const f = makeFixture();
            const seen: boolean[] = [];
            const { deps } = makeDeps(async input => {
                // A collector that grows across async callbacks (CONVENTIONS.md#CP-5).
                seen.push(existsSync(lockOf(f)));
                return okOutput(input);
            });
            await runReplay(
                argsFor(f, [
                    '--limit',
                    '1',
                    '--execute',
                    '--approved-calls',
                    '1',
                ]),
                deps
            );
            expect(seen).toEqual([true]);
            expect(existsSync(lockOf(f))).toBe(false);
        });

        it('removes the lock when loading the executor throws', async () => {
            const f = makeFixture();
            const { deps } = makeDeps();
            const failing: RunDeps = {
                ...deps,
                loadExecuteDeps: async () => {
                    throw new Error('skills did not load');
                },
            };
            await expect(
                runReplay(
                    argsFor(f, [
                        '--limit',
                        '1',
                        '--execute',
                        '--approved-calls',
                        '1',
                    ]),
                    failing
                )
            ).rejects.toThrow('skills did not load');
            expect(existsSync(lockOf(f))).toBe(false);
        });

        it('removes the lock when a job fails unexpectedly, after the in-flight jobs settled', async () => {
            const f = makeFixture();
            // `raw` is a file, so the --keep-raw write of every job throws.
            mkdirSync(f.outDir, { recursive: true });
            writeFileSync(join(f.outDir, 'raw'), 'not a directory');
            const { deps, analyzeSpy } = makeDeps();
            const planned = f.manifest.cases.length;
            await expect(
                runReplay(
                    argsFor(f, [
                        '--keep-raw',
                        '--concurrency',
                        '1',
                        '--execute',
                        '--approved-calls',
                        String(planned),
                    ]),
                    deps
                )
            ).rejects.toThrow('jobs had completed');
            expect(existsSync(lockOf(f))).toBe(false);
            // One symbol queue, concurrency 1: the first failure stops everything.
            expect(analyzeSpy).toHaveBeenCalledTimes(1);
        });

        it('refuses to start while a stale lock exists, and says how to clear it', async () => {
            const f = makeFixture();
            mkdirSync(f.outDir, { recursive: true });
            writeFileSync(lockOf(f), '');
            const { deps, analyzeSpy, logged } = makeDeps();
            const planned = f.manifest.cases.length;
            expect(
                await runReplay(
                    argsFor(f, [
                        '--execute',
                        '--approved-calls',
                        String(planned),
                    ]),
                    deps
                )
            ).toBe(2);
            expect(logged()).toContain('delete that file');
            expect(analyzeSpy).not.toHaveBeenCalled();
            expect(existsSync(lockOf(f))).toBe(true);
        });

        it('takes no lock for a dry run, and a held lock does not block it', async () => {
            const f = makeFixture();
            const { deps } = makeDeps();
            expect(await runReplay(argsFor(f), deps)).toBe(0);
            expect(existsSync(lockOf(f))).toBe(false);
            mkdirSync(f.outDir, { recursive: true });
            writeFileSync(lockOf(f), '');
            expect(await runReplay(argsFor(f), deps)).toBe(0);
        });
    });
});
