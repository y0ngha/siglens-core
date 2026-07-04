/**
 * A/B prompt-quality harness — Stage 3 (plan Task 2.5,
 * `docs/superpowers/plans/2026-07-03-prompt-size-quality-redesign.md`).
 *
 * Pairs the `full` and `digest` results for every case, blind-labels them
 * (deterministic per caseId — NOT `Math.random()`, so re-runs and tests are
 * reproducible), asks Claude Opus to score both on 4 axes (1-5), then
 * unblinds and aggregates into a PASS/FAIL gate + a markdown report.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx scripts/ab-harness/judge.ts --a results-full.json --b results-digest.json --out report.md
 *
 * `--a`/`--b` may be passed in either order — each result's own `mode` field
 * (written by `runModels.ts`) determines which is `full` and which is
 * `digest`, not the flag name or file name.
 *
 * Noise-hardened final gate run — `--passes K --batch`:
 *
 *   ANTHROPIC_API_KEY=... npx tsx scripts/ab-harness/judge.ts --a results-full.json --b results-digest.json --out report.md --passes 5 --batch
 *
 * `--passes K` (default 1) re-judges every `(caseId, sampleIndex)` pair K
 * times, each pass using a DIFFERENT deterministic blind A/B assignment
 * (`assignBlindLabelsForPass`, seeded on `caseId+sampleIndex+pass` — never
 * `Math.random()`) so K passes see K different orderings and a single
 * position-bias judge call can't dominate. `--batch` submits every
 * `(caseId, sampleIndex, pass)` judge request as ONE Anthropic Message Batch
 * (`client.messages.batches.create`) instead of K*cases sequential calls,
 * polls `batches.retrieve` every 30s until `processing_status === 'ended'`,
 * then streams `batches.results`. Without `--batch`, `--passes` is ignored —
 * the sequential per-case path only ever judges sample 0 / pass 0 (unchanged
 * from the original single-pass behavior).
 *
 * Aggregation, when `--batch` multi-sample/multi-pass data is present:
 * for every `(caseId, sampleIndex, axis)`, take the MEDIAN across the K
 * passes' unblinded full/digest scores (medians shrug off a single outlier
 * judge call in a way a mean can't); then, per `(caseId, axis)`, take the
 * MEAN across samples of those per-sample medians — this is the case's
 * aggregated full/digest score. The overall per-axis mean fed into the
 * mean-floor gate check is the mean of these aggregated per-case scores
 * across cases. The integer-aware outlier rule (a single-case >= 2-point
 * drop is a hard fail; a 1-point drop is tolerated in at most one case per
 * axis) now operates on these aggregated per-case scores too, but since
 * medians/means of 1-5 integers are no longer themselves integers, the drop
 * is first rounded to the nearest 0.5 (`roundToHalf`) before being classified
 * as a ">= 2" or ">= 1 (but < 2)" drop — see `evaluateAggregatedGate`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { extractJsonWithRepair } from '@/infrastructure/ai/extractJsonWithRepair';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import { parseArgs } from './cliArgs';
import type { ModelRunResult } from './runModels';

/**
 * Judge model — Claude Opus, resolved from `MODEL_SPECS['claude-opus-4-7']`
 * (the exact Opus id currently configured for production use).
 */
const JUDGE_MODEL = 'claude-opus-4-7' as const;
const JUDGE_MAX_TOKENS = 4_096;
const RETRY_DELAY_MS = 2_000;

/** How often to poll `batches.retrieve` while waiting for a Message Batch to finish (spec: every 30s). */
const BATCH_POLL_INTERVAL_MS = 30_000;

/**
 * Max consecutive `batches.retrieve` poll failures tolerated before
 * {@link pollBatchUntilEnded} gives up and rethrows — batches can take hours,
 * so a single transient blip must not abort the whole run, but a truly
 * persistent outage still needs to surface and fail it.
 */
const MAX_CONSECUTIVE_POLL_FAILURES = 10;

const AXES = [
    'dataGroundedness',
    'hallucinationFreedom',
    'actionability',
    'patternJudgmentAccuracy',
] as const;
export type JudgeAxis = (typeof AXES)[number];

export type Winner = 'A' | 'B' | 'tie';
export type BlindVariant = 'full' | 'digest';

export type AxisScores = Record<JudgeAxis, number>;

export interface JudgeVerdict {
    scoresA: AxisScores;
    scoresB: AxisScores;
    winner: Winner;
}

export interface BlindLabels {
    aVariant: BlindVariant;
    bVariant: BlindVariant;
}

export interface CasePair {
    full: ModelRunResult;
    digest: ModelRunResult;
}

export interface CaseVerdictRecord {
    caseId: string;
    blindLabels: BlindLabels;
    verdict: JudgeVerdict;
}

const MIN_SCORE = 1;
const MAX_SCORE = 5;

/** Short human description per caseId — enriches the judge prompt without needing to re-plumb fixture data through runModels.ts. */
const CASE_DESCRIPTIONS: Record<string, string> = {
    'tech-trend': 'Technical analysis, daily chart, clean uptrend (AAPL).',
    'tech-range':
        'Technical analysis, daily chart, sideways/range-bound chop (MSFT).',
    'tech-highvol':
        'Technical analysis, daily chart, high-volatility whipsaw (TSLA).',
    'tech-lowliq':
        'Technical analysis, daily chart, thin/low-volume drift, small-cap (GEVO).',
    'tech-pattern-hs':
        'Technical analysis, daily chart, head-and-shoulders pattern forming near the end of the series (NVDA).',
    'tech-pattern-doubletop':
        'Technical analysis, daily chart, double-top pattern forming near the end of the series (AMD).',
    'news-earnings':
        'News analysis, earnings-beat scenario with analyst upgrades (NFLX).',
    'news-macro':
        'News analysis, macro-shock / rate-hike sector selloff scenario (INTC).',
};

/**
 * Deterministically assign which variant (`full`/`digest`) is blinded as "A"
 * vs "B" for a given case, derived from a SHA-256 hash of the caseId — NOT
 * `Math.random()` — so the same caseId always gets the same blind assignment
 * across re-runs (reproducible reports) and in tests.
 */
export function assignBlindLabels(caseId: string): BlindLabels {
    const hex = createHash('sha256').update(caseId).digest('hex');
    const firstNibble = parseInt(hex[0], 16);
    const fullIsA = firstNibble % 2 === 0;
    return fullIsA
        ? { aVariant: 'full', bVariant: 'digest' }
        : { aVariant: 'digest', bVariant: 'full' };
}

/**
 * Per-pass variant of {@link assignBlindLabels} for the `--batch --passes K`
 * path: the blind A/B assignment is seeded on `caseId+sampleIndex+pass`
 * (still SHA-256, still NOT `Math.random()`) instead of `caseId` alone, so
 * different passes of the SAME `(caseId, sampleIndex)` deliberately see
 * different A/B orderings — the whole point of multi-pass judging is that a
 * judge's position bias on one ordering gets outvoted by other passes seeing
 * the opposite ordering. `assignBlindLabels(caseId)` itself is left
 * unchanged (used by the original non-batch, single-pass path) precisely so
 * existing reports stay reproducible.
 */
export function assignBlindLabelsForPass(
    caseId: string,
    sampleIndex: number,
    pass: number
): BlindLabels {
    const hex = createHash('sha256')
        .update(`${caseId}::${sampleIndex}::${pass}`)
        .digest('hex');
    const firstNibble = parseInt(hex[0], 16);
    const fullIsA = firstNibble % 2 === 0;
    return fullIsA
        ? { aVariant: 'full', bVariant: 'digest' }
        : { aVariant: 'digest', bVariant: 'full' };
}

/** Separator used by {@link encodeCustomId}/{@link decodeCustomId} — chosen to never plausibly collide with a caseId (fixture ids are short kebab-case slugs). */
const CUSTOM_ID_SEP = '__';

/**
 * Encode `(caseId, sampleIndex, pass)` into a single Anthropic Message Batch
 * `custom_id` (used to match async batch results back to the request that
 * produced them — batch results arrive out of order). `caseId` is placed
 * first and unbounded in length; `sampleIndex`/`pass` are always the LAST two
 * `__`-delimited segments, so {@link decodeCustomId} can recover the exact
 * original `caseId` even in the (currently impossible, since fixture ids
 * don't contain `__`) case it embeds the separator itself.
 */
export function encodeCustomId(
    caseId: string,
    sampleIndex: number,
    pass: number
): string {
    return `${caseId}${CUSTOM_ID_SEP}s${sampleIndex}${CUSTOM_ID_SEP}p${pass}`;
}

export interface DecodedCustomId {
    caseId: string;
    sampleIndex: number;
    pass: number;
}

/** Inverse of {@link encodeCustomId}. Throws on a malformed id (defensive — should never happen for ids this script itself generated). */
export function decodeCustomId(customId: string): DecodedCustomId {
    const parts = customId.split(CUSTOM_ID_SEP);
    if (parts.length < 3) {
        throw new Error(`malformed custom_id (too few segments): ${customId}`);
    }
    const passPart = parts[parts.length - 1];
    const samplePart = parts[parts.length - 2];
    const caseId = parts.slice(0, parts.length - 2).join(CUSTOM_ID_SEP);
    if (!samplePart.startsWith('s') || !passPart.startsWith('p')) {
        throw new Error(
            `malformed custom_id (bad segment prefix): ${customId}`
        );
    }
    const sampleIndex = Number(samplePart.slice(1));
    const pass = Number(passPart.slice(1));
    if (!Number.isInteger(sampleIndex) || !Number.isInteger(pass)) {
        throw new Error(
            `malformed custom_id (non-integer sampleIndex/pass): ${customId}`
        );
    }
    return { caseId, sampleIndex, pass };
}

function isValidAxisScores(raw: unknown): raw is AxisScores {
    if (typeof raw !== 'object' || raw === null) return false;
    // The guard above already excludes `null` and non-object `typeof`s, so
    // `raw` is provably a plain object here — TS just can't narrow `unknown`
    // to `Record<string, unknown>` from a `typeof`/`null` check alone.
    const obj = raw as Record<string, unknown>;
    return AXES.every(axis => {
        const v = obj[axis];
        return (
            typeof v === 'number' &&
            Number.isFinite(v) &&
            v >= MIN_SCORE &&
            v <= MAX_SCORE
        );
    });
}

/**
 * Parse the judge model's raw text response into a strict {@link JudgeVerdict},
 * or `null` when the response is malformed (missing/out-of-range scores,
 * invalid winner, unparseable JSON). Reuses `extractJsonWithRepair` (the same
 * salvage-on-malformed-JSON helper the production worker uses) so minor LLM
 * formatting slips (markdown fences, trailing commas) don't spuriously fail
 * an otherwise-valid verdict.
 */
export function parseJudgeVerdict(raw: string): JudgeVerdict | null {
    let parsed: unknown;
    try {
        parsed = extractJsonWithRepair(raw);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    // Same pattern as `isValidAxisScores` above: the preceding guard already
    // rules out `null` and non-object `typeof`s, so this widen is just
    // recovering the structural guarantee TS can't infer from that check.
    const obj = parsed as Record<string, unknown>;
    const { scoresA, scoresB, winner } = obj;
    if (
        !isValidAxisScores(scoresA) ||
        !isValidAxisScores(scoresB) ||
        (winner !== 'A' && winner !== 'B' && winner !== 'tie')
    ) {
        return null;
    }
    return { scoresA, scoresB, winner };
}

/**
 * Merge two `ModelRunResult` lists (each expected to be homogeneous in
 * `mode`, in either order) into a `caseId -> {full, digest}` map, keyed by
 * each result's own `mode` field (not by which flag/file it came from).
 * Throws with a specific message when a case is missing either side —
 * every case in the harness must have both variants to be scored.
 */
export function mergeResultsByCase(
    listA: readonly ModelRunResult[],
    listB: readonly ModelRunResult[]
): Map<string, CasePair> {
    const partial = new Map<string, Partial<CasePair>>();
    for (const r of [...listA, ...listB]) {
        if (r.mode !== 'full' && r.mode !== 'digest') {
            throw new Error(
                `Result for case "${r.caseId}" has unknown mode "${r.mode}" (expected "full" or "digest")`
            );
        }
        const entry = partial.get(r.caseId) ?? {};
        entry[r.mode] = r;
        partial.set(r.caseId, entry);
    }
    const merged = new Map<string, CasePair>();
    for (const [caseId, entry] of partial) {
        if (!entry.full || !entry.digest) {
            throw new Error(
                `Case "${caseId}" is missing a ${!entry.full ? 'full' : 'digest'} result — --a and --b must cover the same case set`
            );
        }
        merged.set(caseId, entry as CasePair);
    }
    return merged;
}

/** One `(caseId, sampleIndex)` unit with its paired `full`/`digest` results — the batch-judging analog of {@link CasePair}, which only ever held sample 0. */
export interface CaseSamplePair {
    caseId: string;
    sampleIndex: number;
    full: ModelRunResult;
    digest: ModelRunResult;
}

/**
 * Groups multi-sample results by `(caseId, mode)`, then pairs `full`/`digest`
 * samples index-for-index (`sampleIndex` 0 vs 0, 1 vs 1, ...) for the
 * `--batch` path. `runModels.ts --samples N` always writes samples 0..N-1
 * contiguously for a completed run, so sample counts per case are assumed
 * contiguous from 0. When one side has fewer samples for a case, only
 * `min(fullCount, digestCount)` pairs are produced for it — trailing
 * unmatched samples on the longer side have no partner to judge against and
 * are silently dropped (this is the documented "pair by min" behavior).
 * Throws if a caseId is missing a side entirely, same as
 * {@link mergeResultsByCase}.
 */
export function buildCaseSamplePairs(
    listA: readonly ModelRunResult[],
    listB: readonly ModelRunResult[]
): CaseSamplePair[] {
    const byCaseMode = new Map<string, Map<number, ModelRunResult>>();
    for (const r of [...listA, ...listB]) {
        if (r.mode !== 'full' && r.mode !== 'digest') {
            throw new Error(
                `Result for case "${r.caseId}" has unknown mode "${r.mode}" (expected "full" or "digest")`
            );
        }
        const key = `${r.caseId}::${r.mode}`;
        const sampleIndex = r.sampleIndex ?? 0;
        let bySample = byCaseMode.get(key);
        if (!bySample) {
            bySample = new Map();
            byCaseMode.set(key, bySample);
        }
        bySample.set(sampleIndex, r);
    }

    const caseIds = new Set([...listA, ...listB].map(r => r.caseId));
    const pairs: CaseSamplePair[] = [];
    for (const caseId of caseIds) {
        const fullMap = byCaseMode.get(`${caseId}::full`);
        const digestMap = byCaseMode.get(`${caseId}::digest`);
        if (!fullMap || !digestMap) {
            throw new Error(
                `Case "${caseId}" is missing a ${!fullMap ? 'full' : 'digest'} result — --a and --b must cover the same case set`
            );
        }
        const sampleCount = Math.min(fullMap.size, digestMap.size);
        for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
            const full = fullMap.get(sampleIndex);
            const digest = digestMap.get(sampleIndex);
            if (!full || !digest) {
                throw new Error(
                    `Case "${caseId}" sample ${sampleIndex} has a gap in its ${!full ? 'full' : 'digest'} samples (expected contiguous sampleIndex 0..N-1)`
                );
            }
            pairs.push({ caseId, sampleIndex, full, digest });
        }
    }
    pairs.sort(
        (a, b) =>
            a.caseId.localeCompare(b.caseId) || a.sampleIndex - b.sampleIndex
    );
    return pairs;
}

const JUDGE_SYSTEM_PROMPT = `You are an impartial AI-output quality judge for financial chart/news analysis results.
You will be shown ONE case description and TWO candidate analysis result JSONs, labeled A and B.
Score EACH candidate independently on 4 axes, 1 (worst) to 5 (best):
- dataGroundedness: does the analysis cite only values/levels that plausibly derive from real input data, with no invented specifics?
- hallucinationFreedom: absence of fabricated facts, levels, or events not grounded in the case description.
- actionability: is the guidance concrete and usable (not vague platitudes)?
- patternJudgmentAccuracy: for technical cases, does the read of trend/pattern/levels look sound given the case description; for news cases, does the sentiment/impact read look sound?
Then declare an overall winner: "A", "B", or "tie".
Respond with ONLY a single JSON object, no prose, no markdown fences:
{"scoresA": {"dataGroundedness": n, "hallucinationFreedom": n, "actionability": n, "patternJudgmentAccuracy": n}, "scoresB": {...same 4 keys...}, "winner": "A" | "B" | "tie"}`;

/** Build the judge's user-turn prompt for one case. Pure (no I/O) — directly unit-testable. */
export function buildJudgePrompt(
    caseId: string,
    resultA: ModelRunResult,
    resultB: ModelRunResult
): string {
    const description = CASE_DESCRIPTIONS[caseId] ?? caseId;
    return [
        `Case: ${caseId}`,
        `Description: ${description}`,
        '',
        '=== Candidate A ===',
        resultA.resultText,
        '',
        '=== Candidate B ===',
        resultB.resultText,
    ].join('\n');
}

/** One planned judge request for the `--batch` path: which `(caseId, sampleIndex, pass)` it covers, its blind A/B assignment, and the already-blinded result pair to send. */
export interface BatchJudgeRequestInfo {
    customId: string;
    caseId: string;
    sampleIndex: number;
    pass: number;
    blindLabels: BlindLabels;
    resultA: ModelRunResult;
    resultB: ModelRunResult;
}

/**
 * Builds every judge request for the `--batch --passes K` path up front: one
 * request per `(caseSamplePair, pass)` for `pass` in `0..passes-1`. Each
 * pass gets its own deterministic blind flip via
 * {@link assignBlindLabelsForPass} (seeded on `caseId+sampleIndex+pass`), so
 * different passes of the same sample see different A/B orderings. Pure
 * (no I/O, no SDK types) — directly unit-testable.
 */
export function buildBatchRequests(
    pairs: readonly CaseSamplePair[],
    passes: number
): BatchJudgeRequestInfo[] {
    const requests: BatchJudgeRequestInfo[] = [];
    for (const pair of pairs) {
        for (let pass = 0; pass < passes; pass++) {
            const blindLabels = assignBlindLabelsForPass(
                pair.caseId,
                pair.sampleIndex,
                pass
            );
            requests.push({
                customId: encodeCustomId(pair.caseId, pair.sampleIndex, pass),
                caseId: pair.caseId,
                sampleIndex: pair.sampleIndex,
                pass,
                blindLabels,
                resultA: pair[blindLabels.aVariant],
                resultB: pair[blindLabels.bVariant],
            });
        }
    }
    return requests;
}

async function callJudgeOnce(
    client: Anthropic,
    apiModelId: string,
    caseId: string,
    resultA: ModelRunResult,
    resultB: ModelRunResult
): Promise<JudgeVerdict> {
    const message = await client.messages.create({
        model: apiModelId,
        max_tokens: JUDGE_MAX_TOKENS,
        system: JUDGE_SYSTEM_PROMPT,
        messages: [
            {
                role: 'user',
                content: buildJudgePrompt(caseId, resultA, resultB),
            },
        ],
    });
    const textBlock = message.content.find(
        (block): block is Anthropic.TextBlock => block.type === 'text'
    );
    const verdict = textBlock ? parseJudgeVerdict(textBlock.text) : null;
    if (verdict === null) {
        throw new Error(
            `[judge] ${caseId}: judge response was not a valid verdict`
        );
    }
    return verdict;
}

/** Retry exactly once on a transient failure or malformed verdict. */
async function callJudgeWithRetry(
    client: Anthropic,
    apiModelId: string,
    caseId: string,
    resultA: ModelRunResult,
    resultB: ModelRunResult
): Promise<JudgeVerdict> {
    try {
        return await callJudgeOnce(
            client,
            apiModelId,
            caseId,
            resultA,
            resultB
        );
    } catch (error) {
        console.warn(
            `[judge] ${caseId}: first attempt failed (${String(error)}), retrying once...`
        );
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        return await callJudgeOnce(
            client,
            apiModelId,
            caseId,
            resultA,
            resultB
        );
    }
}

/** Convert one planned request into the Anthropic Message Batch request shape — model/params identical to {@link callJudgeOnce}'s single-call params. */
function toBatchCreateRequest(
    request: BatchJudgeRequestInfo,
    apiModelId: string
): Anthropic.Messages.BatchCreateParams.Request {
    return {
        custom_id: request.customId,
        params: {
            model: apiModelId,
            max_tokens: JUDGE_MAX_TOKENS,
            system: JUDGE_SYSTEM_PROMPT,
            messages: [
                {
                    role: 'user',
                    content: buildJudgePrompt(
                        request.caseId,
                        request.resultA,
                        request.resultB
                    ),
                },
            ],
        },
    };
}

/** Submit every planned request as ONE Message Batch and return its id. */
async function submitJudgeBatch(
    client: Anthropic,
    apiModelId: string,
    requests: readonly BatchJudgeRequestInfo[]
): Promise<string> {
    const batch = await client.messages.batches.create({
        requests: requests.map(r => toBatchCreateRequest(r, apiModelId)),
    });
    console.log(
        `[judge] batch ${batch.id}: submitted ${requests.length} request(s)`
    );
    return batch.id;
}

/**
 * Poll `batches.retrieve` every {@link BATCH_POLL_INTERVAL_MS} until
 * `processing_status === 'ended'`.
 *
 * Resilient to transient poll failures: batches can take hours, so a single
 * network blip, 429, or 5xx from `batches.retrieve` must not abort the whole
 * run. A non-transient `APIError` (4xx other than 429 — auth/validation,
 * retrying is pointless) is rethrown immediately. Any other error (network
 * error, 429, 5xx, or an error we can't classify) is logged and the loop
 * retries after the usual poll interval, tracking a consecutive-failure
 * counter (reset on any successful retrieve) that is rethrown once it
 * reaches {@link MAX_CONSECUTIVE_POLL_FAILURES} — so a truly persistent
 * outage still surfaces and fails the run instead of polling forever.
 */
async function pollBatchUntilEnded(
    client: Anthropic,
    batchId: string
): Promise<Anthropic.Messages.MessageBatch> {
    let consecutiveFailures = 0;
    for (;;) {
        let batch: Anthropic.Messages.MessageBatch;
        try {
            batch = await client.messages.batches.retrieve(batchId);
            consecutiveFailures = 0;
        } catch (error) {
            // Non-transient: a 4xx (other than 429 rate-limit) means retrying
            // is pointless — auth/validation errors won't resolve themselves.
            if (
                error instanceof Anthropic.APIError &&
                typeof error.status === 'number' &&
                error.status >= 400 &&
                error.status < 500 &&
                error.status !== 429
            ) {
                throw error;
            }
            consecutiveFailures++;
            console.warn(
                `[judge] batch ${batchId}: poll failed (consecutive failure ${consecutiveFailures}/${MAX_CONSECUTIVE_POLL_FAILURES}):`,
                error
            );
            if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
                throw error;
            }
            await new Promise(r => setTimeout(r, BATCH_POLL_INTERVAL_MS));
            continue;
        }
        console.log(
            `[judge] batch ${batchId}: status=${batch.processing_status}, counts=${JSON.stringify(batch.request_counts)}`
        );
        if (batch.processing_status === 'ended') return batch;
        await new Promise(r => setTimeout(r, BATCH_POLL_INTERVAL_MS));
    }
}

/**
 * Stream `batches.results` and parse each line into a verdict keyed by
 * `custom_id`. Per-request errors (an `errored`/`canceled`/`expired` result,
 * or a `succeeded` result whose text isn't a valid verdict) are logged and
 * recorded as `null` — a missing verdict — rather than aborting the whole
 * batch; `aggregateBatchEntries` treats a `null` verdict as "this pass
 * contributed nothing" and still aggregates over whatever passes DID
 * succeed.
 */
async function collectBatchVerdicts(
    client: Anthropic,
    batchId: string
): Promise<Map<string, JudgeVerdict | null>> {
    const stream = await client.messages.batches.results(batchId);
    const verdicts = new Map<string, JudgeVerdict | null>();
    for await (const line of stream) {
        const { custom_id: customId, result } = line;
        if (result.type === 'succeeded') {
            const textBlock = result.message.content.find(
                (block): block is Anthropic.TextBlock => block.type === 'text'
            );
            const verdict = textBlock
                ? parseJudgeVerdict(textBlock.text)
                : null;
            if (verdict === null) {
                console.warn(
                    `[judge] ${customId}: batch response was not a valid verdict`
                );
            }
            verdicts.set(customId, verdict);
        } else {
            const detail =
                result.type === 'errored'
                    ? ` (${JSON.stringify(result.error)})`
                    : '';
            console.warn(
                `[judge] ${customId}: batch request ${result.type}${detail} — treating as a missing verdict`
            );
            verdicts.set(customId, null);
        }
    }
    return verdicts;
}

/** One `(caseId, sampleIndex, pass)` judge result — `verdict` is `null` when that pass errored, was malformed, or never ran (missing from the batch results stream). */
export interface BatchVerdictEntry {
    caseId: string;
    sampleIndex: number;
    pass: number;
    blindLabels: BlindLabels;
    verdict: JudgeVerdict | null;
}

/** Submit, poll, and collect verdicts for every request built by {@link buildBatchRequests} — the full `--batch` network round trip. */
async function runJudgeBatch(
    client: Anthropic,
    apiModelId: string,
    requests: readonly BatchJudgeRequestInfo[]
): Promise<BatchVerdictEntry[]> {
    const batchId = await submitJudgeBatch(client, apiModelId, requests);
    await pollBatchUntilEnded(client, batchId);
    const verdicts = await collectBatchVerdicts(client, batchId);
    return requests.map(r => {
        const verdict = verdicts.get(r.customId);
        if (verdict === undefined) {
            console.warn(
                `[judge] ${r.customId}: missing from batch results entirely — treating as a missing verdict`
            );
        }
        return {
            caseId: r.caseId,
            sampleIndex: r.sampleIndex,
            pass: r.pass,
            blindLabels: r.blindLabels,
            verdict: verdict ?? null,
        };
    });
}

function requireAnthropicApiKey(): string {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
        throw new Error(
            'ANTHROPIC_API_KEY is not set. Export it before running judge.ts — no network call is attempted until this check passes.'
        );
    }
    return key;
}

function zeroAxisScores(): Record<JudgeAxis, number> {
    return Object.fromEntries(AXES.map(axis => [axis, 0])) as Record<
        JudgeAxis,
        number
    >;
}

function addAxisScores(
    target: Record<JudgeAxis, number>,
    scores: AxisScores
): void {
    for (const axis of AXES) target[axis] += scores[axis];
}

function divideAxisScores(
    sums: Record<JudgeAxis, number>,
    count: number
): Record<JudgeAxis, number> {
    if (count === 0) return zeroAxisScores();
    return Object.fromEntries(
        AXES.map(axis => [axis, sums[axis] / count])
    ) as Record<JudgeAxis, number>;
}

export interface VariantAxisMeans {
    full: Record<JudgeAxis, number>;
    digest: Record<JudgeAxis, number>;
}

/** Unblind each verdict's A/B scores back to full/digest, then average per axis per variant. */
export function aggregateVerdicts(
    records: readonly CaseVerdictRecord[]
): VariantAxisMeans {
    const sums: Record<BlindVariant, Record<JudgeAxis, number>> = {
        full: zeroAxisScores(),
        digest: zeroAxisScores(),
    };
    const counts: Record<BlindVariant, number> = { full: 0, digest: 0 };

    for (const { verdict, blindLabels } of records) {
        addAxisScores(sums[blindLabels.aVariant], verdict.scoresA);
        addAxisScores(sums[blindLabels.bVariant], verdict.scoresB);
        counts[blindLabels.aVariant]++;
        counts[blindLabels.bVariant]++;
    }

    return {
        full: divideAxisScores(sums.full, counts.full),
        digest: divideAxisScores(sums.digest, counts.digest),
    };
}

/**
 * Digest is allowed to fall short of full by up to this much on the AGGREGATE
 * (mean-across-cases) axis score before that axis fails the mean-floor check
 * (spec §3.6 "digest >= full (mean)").
 */
const GATE_TOLERANCE = 0.1;

/**
 * Scores are 1-5 INTEGERS, so a per-case outlier rule must be integer-aware.
 * A flat `full - digest <= 0.25` bound (an earlier version of this gate) is
 * meaningless on this scale: the minimum nonzero difference is 1, so *any*
 * single-point regression anywhere fails it — a de facto
 * zero-regressions-anywhere rule, far stricter than the approved spec
 * criterion ("digest mean >= full mean per axis, no meaningful
 * degradation"). Instead, per axis:
 * - a single case regressing by >= GATE_OUTLIER_DROP (2) points is a hard
 *   fail — a 2-point drop on a 1-5 scale is a real, not rounding-noise,
 *   regression;
 * - a 1-point drop is tolerated in isolation (a single point of judge
 *   variance on an integer scale), but not when it recurs — see
 *   MAX_TOLERATED_ONE_POINT_DROPS below. This is checked independently of
 *   the mean-floor above (spec §3.6 "no axis... significant drop"): a mean
 *   check alone can't catch one case regressing badly if other cases in the
 *   same axis improved enough to offset it.
 */
const GATE_OUTLIER_DROP = 2;

/**
 * Max number of cases per axis allowed to show an isolated 1-point drop
 * before that pattern itself counts as an axis-level regression. One
 * 1-point drop is tolerated as noise; two or more cases dropping 1 point on
 * the same axis is a signal, not noise, and fails the axis.
 */
const MAX_TOLERATED_ONE_POINT_DROPS = 1;

export interface AxisGateResult {
    full: number;
    digest: number;
    delta: number;
    meanOk: boolean;
    twoPointDropCount: number;
    onePointDropCount: number;
    outlierOk: boolean;
    ok: boolean;
}

export interface GateResult {
    passed: boolean;
    perAxis: Record<JudgeAxis, AxisGateResult>;
}

/** Unblinded (full, digest) score pair for one case on one axis. */
function unblindAxisScores(
    record: CaseVerdictRecord,
    axis: JudgeAxis
): { full: number; digest: number } {
    const { verdict, blindLabels } = record;
    const aScore = verdict.scoresA[axis];
    const bScore = verdict.scoresB[axis];
    return blindLabels.aVariant === 'full'
        ? { full: aScore, digest: bScore }
        : { full: bScore, digest: aScore };
}

/**
 * PASS iff, on EVERY axis, BOTH hold:
 * 1. Mean floor: `digest mean >= full mean - GATE_TOLERANCE`.
 * 2. Integer-aware outlier rule: no case regresses by
 *    `>= GATE_OUTLIER_DROP` (2) points, AND at most
 *    `MAX_TOLERATED_ONE_POINT_DROPS` (1) case regresses by exactly 1 point.
 *
 * Both checks and their per-axis values are returned so the report can show
 * the pass/fail logic transparently rather than just a final bit.
 */
export function evaluateGate(
    means: VariantAxisMeans,
    records: readonly CaseVerdictRecord[]
): GateResult {
    const perAxis = {} as Record<JudgeAxis, AxisGateResult>;
    let passed = true;
    for (const axis of AXES) {
        const full = means.full[axis];
        const digest = means.digest[axis];
        const delta = digest - full;
        const meanOk = delta >= -GATE_TOLERANCE;

        let twoPointDropCount = 0;
        let onePointDropCount = 0;
        for (const record of records) {
            const { full: f, digest: d } = unblindAxisScores(record, axis);
            const drop = f - d;
            if (drop >= GATE_OUTLIER_DROP) twoPointDropCount++;
            else if (drop === 1) onePointDropCount++;
        }
        const outlierOk =
            twoPointDropCount === 0 &&
            onePointDropCount <= MAX_TOLERATED_ONE_POINT_DROPS;

        const ok = meanOk && outlierOk;
        perAxis[axis] = {
            full,
            digest,
            delta,
            meanOk,
            twoPointDropCount,
            onePointDropCount,
            outlierOk,
            ok,
        };
        if (!ok) passed = false;
    }
    return { passed, perAxis };
}

/** Standard median: sorted-middle for odd counts, average-of-two-middles for even. Returns 0 for an empty input (mirrors {@link divideAxisScores}'s divide-by-zero guard — callers never have 0 valid passes for a sample they bothered to include). */
export function median(nums: readonly number[]): number {
    if (nums.length === 0) return 0;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

/** One axis's aggregated batch score for one case: mean-of-per-sample-medians for both variants, plus the raw min/max spread across every contributing pass (for the report). */
export interface CaseAxisAggregate {
    full: number;
    digest: number;
    fullSpread: [number, number];
    digestSpread: [number, number];
    /** Total non-null (caseId, sampleIndex, pass) verdicts that contributed to this axis. */
    passCount: number;
    /** Samples (of the case's total) that had at least one non-null verdict. */
    sampleCount: number;
}

export type PerCaseAxisAggregates = Record<JudgeAxis, CaseAxisAggregate>;

export interface PerCaseAggregate {
    caseId: string;
    axes: PerCaseAxisAggregates;
}

/**
 * Aggregates `--batch --passes K` verdicts into one score per `(caseId,
 * axis)`, per the two-stage rule documented in the file header: MEDIAN
 * across the K passes' unblinded scores per sample, then MEAN across
 * samples of those per-sample medians. Entries with a `null` verdict (an
 * errored/malformed/missing batch response) are skipped entirely — a sample
 * with zero surviving passes contributes nothing (not a 0) and is excluded
 * from `sampleCount`; a case with zero surviving samples is dropped from the
 * output altogether (there's nothing to aggregate). Pure — no I/O, no SDK
 * types — directly unit-testable against hand-built `BatchVerdictEntry[]`
 * fixtures.
 */
export function aggregateBatchEntries(
    entries: readonly BatchVerdictEntry[]
): PerCaseAggregate[] {
    // caseId -> sampleIndex -> unblinded {full, digest} AxisScores, one per surviving pass
    const byCase = new Map<
        string,
        Map<number, { full: AxisScores; digest: AxisScores }[]>
    >();
    for (const entry of entries) {
        if (!entry.verdict) continue;
        const { caseId, sampleIndex, blindLabels, verdict } = entry;
        const full =
            blindLabels.aVariant === 'full' ? verdict.scoresA : verdict.scoresB;
        const digest =
            blindLabels.aVariant === 'full' ? verdict.scoresB : verdict.scoresA;
        let bySample = byCase.get(caseId);
        if (!bySample) {
            bySample = new Map();
            byCase.set(caseId, bySample);
        }
        const list = bySample.get(sampleIndex) ?? [];
        list.push({ full, digest });
        bySample.set(sampleIndex, list);
    }

    const results: PerCaseAggregate[] = [];
    for (const [caseId, bySample] of byCase) {
        const axes = {} as PerCaseAxisAggregates;
        for (const axis of AXES) {
            const sampleMediansFull: number[] = [];
            const sampleMediansDigest: number[] = [];
            const allFullRaw: number[] = [];
            const allDigestRaw: number[] = [];
            for (const passList of bySample.values()) {
                if (passList.length === 0) continue;
                const fullVals = passList.map(p => p.full[axis]);
                const digestVals = passList.map(p => p.digest[axis]);
                allFullRaw.push(...fullVals);
                allDigestRaw.push(...digestVals);
                sampleMediansFull.push(median(fullVals));
                sampleMediansDigest.push(median(digestVals));
            }
            const mean = (nums: number[]): number =>
                nums.length === 0
                    ? 0
                    : nums.reduce((a, b) => a + b, 0) / nums.length;
            axes[axis] = {
                full: mean(sampleMediansFull),
                digest: mean(sampleMediansDigest),
                fullSpread: allFullRaw.length
                    ? [Math.min(...allFullRaw), Math.max(...allFullRaw)]
                    : [0, 0],
                digestSpread: allDigestRaw.length
                    ? [Math.min(...allDigestRaw), Math.max(...allDigestRaw)]
                    : [0, 0],
                passCount: allFullRaw.length,
                sampleCount: sampleMediansFull.length,
            };
        }
        results.push({ caseId, axes });
    }
    results.sort((a, b) => a.caseId.localeCompare(b.caseId));
    return results;
}

/** Overall per-axis mean across cases of their {@link aggregateBatchEntries} aggregated full/digest scores — the batch-path analog of {@link aggregateVerdicts}. */
export function meansFromAggregates(
    aggregates: readonly PerCaseAggregate[]
): VariantAxisMeans {
    const sums = { full: zeroAxisScores(), digest: zeroAxisScores() };
    for (const { axes } of aggregates) {
        for (const axis of AXES) {
            sums.full[axis] += axes[axis].full;
            sums.digest[axis] += axes[axis].digest;
        }
    }
    return {
        full: divideAxisScores(sums.full, aggregates.length),
        digest: divideAxisScores(sums.digest, aggregates.length),
    };
}

/** Round to the nearest 0.5 (half-up on ties) — see {@link evaluateAggregatedGate} for why the outlier rule needs this on aggregated (non-integer) scores. */
export function roundToHalf(n: number): number {
    return Math.round(n * 2) / 2;
}

/**
 * Batch-path analog of {@link evaluateGate}, operating on
 * {@link aggregateBatchEntries} output instead of single-verdict
 * `CaseVerdictRecord[]`. Same two-clause rule (mean floor + integer-aware
 * outlier), but the per-case outlier drop is `roundToHalf`-ed first: once
 * scores are medians-of-medians they're no longer integers, so the original
 * exact `drop === 1` / `drop >= 2` integer comparisons would almost never
 * fire on real aggregated data. Rounding to the nearest 0.5 keeps the same
 * "one point on a 1-5 scale" granularity while remaining meaningful on
 * continuous aggregated input — a rounded drop of `1.0` is still "about a
 * single point", `2.0`+ is still "about two or more points, a real
 * regression". The one-point bucket is `>= 1` (not `=== 1`): a 1.5 rounded
 * drop is a real, non-negligible regression that must land in the
 * one-point bucket rather than falling through uncounted between the two
 * buckets.
 */
export function evaluateAggregatedGate(
    means: VariantAxisMeans,
    aggregates: readonly PerCaseAggregate[]
): GateResult {
    const perAxis = {} as Record<JudgeAxis, AxisGateResult>;
    let passed = true;
    for (const axis of AXES) {
        const full = means.full[axis];
        const digest = means.digest[axis];
        const delta = digest - full;
        const meanOk = delta >= -GATE_TOLERANCE;

        let twoPointDropCount = 0;
        let onePointDropCount = 0;
        for (const { axes } of aggregates) {
            const drop = roundToHalf(axes[axis].full - axes[axis].digest);
            // Buckets must be exhaustive and non-overlapping over the real
            // 0.5-quantized domain: roundToHalf can produce 1.5, which is
            // neither >= GATE_OUTLIER_DROP (2) nor === 1 — an `=== 1` check
            // would silently drop it from both buckets. `>= 1` (with the
            // `< GATE_OUTLIER_DROP` upper bound already implied by the
            // preceding `if`) correctly counts it as a one-point-bucket drop.
            if (drop >= GATE_OUTLIER_DROP) twoPointDropCount++;
            else if (drop >= 1) onePointDropCount++;
        }
        const outlierOk =
            twoPointDropCount === 0 &&
            onePointDropCount <= MAX_TOLERATED_ONE_POINT_DROPS;

        const ok = meanOk && outlierOk;
        perAxis[axis] = {
            full,
            digest,
            delta,
            meanOk,
            twoPointDropCount,
            onePointDropCount,
            outlierOk,
            ok,
        };
        if (!ok) passed = false;
    }
    return { passed, perAxis };
}

function fmt(n: number): string {
    return n.toFixed(2);
}

function scoreCell(scores: AxisScores): string {
    return AXES.map(a => scores[a]).join('/');
}

function buildReport(
    records: readonly CaseVerdictRecord[],
    byCase: ReadonlyMap<string, CasePair>,
    means: VariantAxisMeans,
    gate: GateResult
): string {
    const lines: string[] = [];
    lines.push('# A/B Prompt Quality Harness — Report');
    lines.push('');
    lines.push(
        `Axes (in score order): ${AXES.join(', ')}. Each score cell is \`${AXES.map(() => 'n').join('/')}\`.`
    );
    lines.push('');
    lines.push('## Per-case results');
    lines.push('');
    lines.push(
        '| caseId | A=variant | B=variant | scores A | scores B | winner (raw) | winner (unblinded) | prompt chars (full/digest) | output tok (full/digest) | latency ms (full/digest) |'
    );
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const record of records) {
        const pair = byCase.get(record.caseId);
        if (!pair) continue;
        const { blindLabels, verdict } = record;
        const unblindedWinner =
            verdict.winner === 'tie'
                ? 'tie'
                : verdict.winner === 'A'
                  ? blindLabels.aVariant
                  : blindLabels.bVariant;
        lines.push(
            `| ${record.caseId} | ${blindLabels.aVariant} | ${blindLabels.bVariant} | ${scoreCell(verdict.scoresA)} | ${scoreCell(verdict.scoresB)} | ${verdict.winner} | ${unblindedWinner} | ${pair.full.promptChars}/${pair.digest.promptChars} | ${pair.full.usage.outputTokens}/${pair.digest.usage.outputTokens} | ${pair.full.latencyMs}/${pair.digest.latencyMs} |`
        );
    }

    lines.push('');
    lines.push('## Aggregate means per variant per axis');
    lines.push('');
    lines.push(
        '| axis | full mean | digest mean | delta (digest - full) | mean floor ok | 2pt-drop count | 1pt-drop count | axis ok |'
    );
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const axis of AXES) {
        const {
            full,
            digest,
            delta,
            meanOk,
            twoPointDropCount,
            onePointDropCount,
            ok,
        } = gate.perAxis[axis];
        lines.push(
            `| ${axis} | ${fmt(full)} | ${fmt(digest)} | ${fmt(delta)} | ${meanOk ? 'yes' : 'NO'} | ${twoPointDropCount} | ${onePointDropCount} | ${ok ? 'yes' : 'NO'} |`
        );
    }

    lines.push('');
    lines.push('## Pass/fail logic');
    lines.push('');
    lines.push(
        `Per axis: PASS iff BOTH (1) mean floor — \`digest_mean >= full_mean - ${GATE_TOLERANCE}\` — AND (2) integer-aware outlier rule — no case regresses by >= ${GATE_OUTLIER_DROP} points on this axis, AND at most ${MAX_TOLERATED_ONE_POINT_DROPS} case regresses by exactly 1 point (a scale-minimum, single-point drop is tolerated once as judge noise; 2+ cases with a 1-point drop on the same axis fails it).`
    );
    lines.push('Overall: PASS iff every axis passes.');
    lines.push('');
    lines.push(`## Verdict: ${gate.passed ? 'PASS (digest >= full)' : 'FAIL'}`);
    lines.push('');

    return lines.join('\n') + '\n';
}

function formatSpread(spread: readonly [number, number]): string {
    return spread[0] === spread[1]
        ? spread[0].toFixed(1)
        : `${spread[0].toFixed(1)}-${spread[1].toFixed(1)}`;
}

/**
 * Report builder for the `--batch --passes K` noise-hardened path — same
 * overall shape as {@link buildReport} (per-case table, per-axis aggregate
 * table, pass/fail logic, verdict), but the per-case table shows the
 * MEDIAN-then-MEAN aggregated full/digest score per axis plus each axis's
 * raw per-pass min-max spread (so a reader can see how much judge noise was
 * smoothed over), and the header records `K` (passes) and the sample count
 * actually used so a report is self-describing about how hardened it is.
 */
function buildBatchReport(
    aggregates: readonly PerCaseAggregate[],
    pairs: readonly CaseSamplePair[],
    passes: number,
    means: VariantAxisMeans,
    gate: GateResult
): string {
    const samplesByCase = new Map<string, number>();
    for (const pair of pairs) {
        samplesByCase.set(
            pair.caseId,
            Math.max(samplesByCase.get(pair.caseId) ?? 0, pair.sampleIndex + 1)
        );
    }

    const lines: string[] = [];
    lines.push('# A/B Prompt Quality Harness — Report (batch, noise-hardened)');
    lines.push('');
    lines.push(
        `Passes per sample (K): ${passes}. Cases: ${aggregates.length}. Per-case aggregation: median across the ${passes} pass(es) per sample, then mean across samples per case (see file header of \`judge.ts\` for the full rule).`
    );
    lines.push('');
    lines.push('## Per-case aggregated results');
    lines.push('');
    lines.push(
        '| caseId | samples | axis | full (agg) | digest (agg) | full spread (min-max) | digest spread (min-max) | passes contributing |'
    );
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const { caseId, axes } of aggregates) {
        const sampleCount = samplesByCase.get(caseId) ?? 0;
        for (const axis of AXES) {
            const a = axes[axis];
            lines.push(
                `| ${caseId} | ${sampleCount} | ${axis} | ${fmt(a.full)} | ${fmt(a.digest)} | ${formatSpread(a.fullSpread)} | ${formatSpread(a.digestSpread)} | ${a.passCount} |`
            );
        }
    }

    lines.push('');
    lines.push('## Aggregate means per variant per axis');
    lines.push('');
    lines.push(
        '| axis | full mean | digest mean | delta (digest - full) | mean floor ok | 2pt-drop count | 1pt-drop count | axis ok |'
    );
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const axis of AXES) {
        const {
            full,
            digest,
            delta,
            meanOk,
            twoPointDropCount,
            onePointDropCount,
            ok,
        } = gate.perAxis[axis];
        lines.push(
            `| ${axis} | ${fmt(full)} | ${fmt(digest)} | ${fmt(delta)} | ${meanOk ? 'yes' : 'NO'} | ${twoPointDropCount} | ${onePointDropCount} | ${ok ? 'yes' : 'NO'} |`
        );
    }

    lines.push('');
    lines.push('## Pass/fail logic (batch, aggregated)');
    lines.push('');
    lines.push(
        `Per axis: PASS iff BOTH (1) mean floor — \`digest_mean >= full_mean - ${GATE_TOLERANCE}\` — over the per-case aggregated (median-of-passes, then mean-of-samples) scores — AND (2) integer-aware outlier rule applied to those SAME aggregated per-case scores, each first rounded to the nearest 0.5 (\`roundToHalf\`) since aggregation makes them non-integer: no case's rounded drop is >= ${GATE_OUTLIER_DROP}, AND at most ${MAX_TOLERATED_ONE_POINT_DROPS} case has a rounded drop of 1 or more (but less than ${GATE_OUTLIER_DROP}).`
    );
    lines.push('Overall: PASS iff every axis passes.');
    lines.push('');
    lines.push(`## Verdict: ${gate.passed ? 'PASS (digest >= full)' : 'FAIL'}`);
    lines.push('');

    return lines.join('\n') + '\n';
}

/** Parse and validate `--passes` (default 1, must be a positive integer). */
function parsePassesArg(raw: string | undefined): number {
    if (raw === undefined) return 1;
    const passes = Number(raw);
    if (!Number.isInteger(passes) || passes < 1) {
        throw new Error(`--passes must be a positive integer (got "${raw}")`);
    }
    return passes;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const aFile = args.a;
    const bFile = args.b;
    const outFile = args.out;
    if (!aFile || !bFile || !outFile) {
        throw new Error(
            'Usage: judge.ts --a results-full.json --b results-digest.json --out report.md [--passes K --batch]'
        );
    }
    const isBatch = args.batch === 'true';
    const passes = parsePassesArg(args.passes);

    const apiKey = requireAnthropicApiKey();
    const resultsA = JSON.parse(
        readFileSync(resolve(aFile), 'utf-8')
    ) as ModelRunResult[];
    const resultsB = JSON.parse(
        readFileSync(resolve(bFile), 'utf-8')
    ) as ModelRunResult[];

    const client = new Anthropic({ apiKey });
    const modelSpec = MODEL_SPECS[JUDGE_MODEL];

    if (isBatch) {
        const pairs = buildCaseSamplePairs(resultsA, resultsB);
        const requests = buildBatchRequests(pairs, passes);
        console.log(
            `[judge] --batch: ${pairs.length} (case, sample) pair(s) x ${passes} pass(es) = ${requests.length} request(s)`
        );
        const entries = await runJudgeBatch(
            client,
            modelSpec.apiModelId,
            requests
        );
        const aggregates = aggregateBatchEntries(entries);
        const means = meansFromAggregates(aggregates);
        const gate = evaluateAggregatedGate(means, aggregates);
        const report = buildBatchReport(aggregates, pairs, passes, means, gate);
        writeFileSync(resolve(outFile), report);
        console.log(
            `\n[judge] ${gate.passed ? 'PASS' : 'FAIL'} — batch report written to ${outFile}`
        );
        return;
    }

    const byCase = mergeResultsByCase(resultsA, resultsB);
    const records: CaseVerdictRecord[] = [];
    // Sequential by design, mirrors runModels.ts.
    for (const [caseId, pair] of byCase) {
        const blindLabels = assignBlindLabels(caseId);
        const resultA = pair[blindLabels.aVariant];
        const resultB = pair[blindLabels.bVariant];
        const verdict = await callJudgeWithRetry(
            client,
            modelSpec.apiModelId,
            caseId,
            resultA,
            resultB
        );
        records.push({ caseId, blindLabels, verdict });
        console.log(`[judge] ${caseId}: winner=${verdict.winner}`);
    }

    const means = aggregateVerdicts(records);
    const gate = evaluateGate(means, records);
    const report = buildReport(records, byCase, means, gate);
    writeFileSync(resolve(outFile), report);
    console.log(
        `\n[judge] ${gate.passed ? 'PASS' : 'FAIL'} — report written to ${outFile}`
    );
}

if (require.main === module) {
    main().catch(error => {
        console.error('[judge] failed:', error);
        process.exitCode = 1;
    });
}
