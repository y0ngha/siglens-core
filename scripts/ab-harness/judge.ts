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

function isValidAxisScores(raw: unknown): raw is AxisScores {
    if (typeof raw !== 'object' || raw === null) return false;
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
 * Max allowed (full - digest) drop for a SINGLE case's axis score, checked
 * independently of the mean-floor above. Deliberately a *different*
 * granularity (per-case, not per-axis-mean) and a looser bound than
 * `GATE_TOLERANCE` — this guards against a mean that clears the floor only
 * because a couple of strong cases offset one case that regressed badly
 * (spec §3.6 "no axis... significant drop"). A per-axis-mean check alone
 * cannot catch that; the two clauses are intentionally independent, not a
 * tighter/looser restatement of the same comparison.
 */
const GATE_MAX_DROP = 0.25;

export interface AxisGateResult {
    full: number;
    digest: number;
    delta: number;
    meanOk: boolean;
    worstCaseDrop: number;
    worstCaseOk: boolean;
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
 * 2. No single-case outlier: for every individual case,
 *    `full score - digest score <= GATE_MAX_DROP`.
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

        const worstCaseDrop = records.reduce((worst, record) => {
            const { full: f, digest: d } = unblindAxisScores(record, axis);
            return Math.max(worst, f - d);
        }, 0);
        const worstCaseOk = worstCaseDrop <= GATE_MAX_DROP;

        const ok = meanOk && worstCaseOk;
        perAxis[axis] = {
            full,
            digest,
            delta,
            meanOk,
            worstCaseDrop,
            worstCaseOk,
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
        '| axis | full mean | digest mean | delta (digest - full) | mean floor ok | worst-case drop | worst-case ok | axis ok |'
    );
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const axis of AXES) {
        const { full, digest, delta, meanOk, worstCaseDrop, worstCaseOk, ok } =
            gate.perAxis[axis];
        lines.push(
            `| ${axis} | ${fmt(full)} | ${fmt(digest)} | ${fmt(delta)} | ${meanOk ? 'yes' : 'NO'} | ${fmt(worstCaseDrop)} | ${worstCaseOk ? 'yes' : 'NO'} | ${ok ? 'yes' : 'NO'} |`
        );
    }

    lines.push('');
    lines.push('## Pass/fail logic');
    lines.push('');
    lines.push(
        `Per axis: PASS iff BOTH (1) mean floor — \`digest_mean >= full_mean - ${GATE_TOLERANCE}\` — AND (2) no single-case outlier — every case's \`full_score - digest_score <= ${GATE_MAX_DROP}\`.`
    );
    lines.push('Overall: PASS iff every axis passes.');
    lines.push('');
    lines.push(`## Verdict: ${gate.passed ? 'PASS (digest >= full)' : 'FAIL'}`);
    lines.push('');

    return lines.join('\n') + '\n';
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const aFile = args.a;
    const bFile = args.b;
    const outFile = args.out;
    if (!aFile || !bFile || !outFile) {
        throw new Error(
            'Usage: judge.ts --a results-full.json --b results-digest.json --out report.md'
        );
    }

    const apiKey = requireAnthropicApiKey();
    const resultsA = JSON.parse(
        readFileSync(resolve(aFile), 'utf-8')
    ) as ModelRunResult[];
    const resultsB = JSON.parse(
        readFileSync(resolve(bFile), 'utf-8')
    ) as ModelRunResult[];
    const byCase = mergeResultsByCase(resultsA, resultsB);

    const client = new Anthropic({ apiKey });
    const modelSpec = MODEL_SPECS[JUDGE_MODEL];

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
