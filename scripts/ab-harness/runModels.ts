/**
 * A/B prompt-quality harness — Stage 2 (plan Task 2.5,
 * `docs/superpowers/plans/2026-07-03-prompt-size-quality-redesign.md`).
 *
 * Sends every prompt case produced by `buildPrompts.ts` to the production
 * default analysis model (Gemini 2.5 Flash Lite — see
 * `DEFAULT_ANALYSIS_MODEL_ID` below) and records the raw result + usage.
 * Calls are made SEQUENTIALLY (no `Promise.all`) — the real worker respects
 * provider rate limits and this harness should not amplify them.
 *
 * Usage:
 *   GEMINI_API_KEY=... npx tsx scripts/ab-harness/runModels.ts --in prompts-<mode>.json --out results-<mode>.json [--samples N]
 *
 * `--samples N` (default 1) runs every case N times, recording each run's
 * `sampleIndex` (0..N-1) alongside the unchanged `caseId` — a noise-hardening
 * measure for the final gate run: `judge.ts --batch` later medians across
 * these samples before aggregating, so a single unlucky model draw can't
 * flip a case's verdict. Resume (via `--out`, loaded if it already exists)
 * keys on the `(caseId, sampleIndex)` pair, not `caseId` alone, so a partial
 * multi-sample run resumes exactly where it left off.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import { parseArgs, parsePositiveIntArg } from './cliArgs';
import type { AnalysisTypeUnderTest, PromptCaseOutput } from './buildPrompts';

/**
 * Production default technical-analysis model, resolved from the siglens
 * frontend's `useSelectedModel` hook (`DEFAULT_MODEL = GEMINI_2_5_FLASH_LITE_MODEL`,
 * `src/features/symbol-model/hooks/useSelectedModel.ts`) — NOT
 * `DEFAULT_ANALYSIS_MODEL_ID` from `infrastructure/cache/config.ts`, which is
 * just the cache-key placeholder string `'analysis-worker'`, not a real model id.
 */
const DEFAULT_ANALYSIS_MODEL = 'gemini-2.5-flash-lite' as const;

/** Per-case retry budget: up to 4 attempts total, with backoff between attempts 1→2, 2→3, 3→4. */
const MAX_ATTEMPTS = 4;
const RETRY_BACKOFFS_MS = [15_000, 60_000, 180_000] as const;

export interface NormalizedUsage {
    promptTokens: number;
    cachedTokens: number;
    outputTokens: number;
}

export interface ModelRunResult {
    caseId: string;
    mode: string;
    analysisType: AnalysisTypeUnderTest;
    resultText: string;
    usage: NormalizedUsage;
    latencyMs: number;
    /** `prompt.length` from the source case — carried through so `judge.ts` can report size without re-reading the prompts file. */
    promptChars: number;
    /**
     * Which of the `--samples N` repeats of this SAME `caseId` this result is
     * (0..N-1) — `caseId` is never mangled to encode this, so pre-existing
     * single-sample results files (and any code keying purely on `caseId`)
     * stay meaningful. Always present (default-run `--samples 1` still
     * writes `sampleIndex: 0`) so downstream consumers never have to
     * special-case an absent field.
     */
    sampleIndex: number;
}

function requireGeminiApiKey(): string {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        throw new Error(
            'GEMINI_API_KEY is not set. Export it before running runModels.ts — no network call is attempted until this check passes.'
        );
    }
    return key;
}

/** Infer the `mode` label (`full`/`digest`) from the `--in` filename convention (`prompts-full.json` / `prompts-digest.json`). */
export function inferModeFromFilename(inFile: string): string {
    if (inFile.includes('digest')) return 'digest';
    if (inFile.includes('full')) return 'full';
    return 'unknown';
}

async function callGeminiOnce(
    client: GoogleGenAI,
    apiModelId: string,
    promptCase: PromptCaseOutput
): Promise<{ text: string; usage: NormalizedUsage }> {
    const response = await client.models.generateContent({
        model: apiModelId,
        contents: promptCase.prompt,
        config: {
            systemInstruction: promptCase.system,
            temperature: 0,
            responseMimeType: 'application/json',
            // Bridges the domain `ResponseJsonSchema` type to `@google/genai`'s
            // `responseJsonSchema` field (typed loosely, effectively `unknown`,
            // in that SDK). Safe because both sides treat it as an opaque
            // JSON-schema object passed straight through to the API — this
            // harness never inspects or mutates its shape.
            responseJsonSchema: promptCase.responseSchema as unknown,
        },
    });
    const usage = response.usageMetadata;
    return {
        text: response.text ?? '',
        usage: {
            promptTokens: usage?.promptTokenCount ?? 0,
            cachedTokens: usage?.cachedContentTokenCount ?? 0,
            outputTokens: usage?.candidatesTokenCount ?? 0,
        },
    };
}

/**
 * Whether a failure is a transient capacity/rate-limit error worth retrying
 * (Gemini 503/UNAVAILABLE capacity spikes, 429 rate limiting). Anything else
 * (bad request, auth, schema errors, etc.) is treated as non-retryable and
 * aborts the run immediately.
 */
export function isRetryableError(error: unknown): boolean {
    const status = (error as { status?: unknown } | undefined)?.status;
    const code = (error as { code?: unknown } | undefined)?.code;
    if (status === 503 || status === 429 || code === 503 || code === 429) {
        return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    return /\b503\b|UNAVAILABLE|\b429\b/i.test(message);
}

/**
 * Retry up to `MAX_ATTEMPTS` total attempts on retryable errors (503/UNAVAILABLE/429),
 * backing off `RETRY_BACKOFFS_MS` (15s/60s/180s) between attempts. Non-retryable
 * errors abort immediately without waiting out the remaining budget.
 */
async function callGeminiWithRetry(
    client: GoogleGenAI,
    apiModelId: string,
    promptCase: PromptCaseOutput
): Promise<{ text: string; usage: NormalizedUsage }> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            return await callGeminiOnce(client, apiModelId, promptCase);
        } catch (error) {
            const retryable = isRetryableError(error);
            if (!retryable || attempt === MAX_ATTEMPTS) {
                throw error;
            }
            const backoffMs = RETRY_BACKOFFS_MS[attempt - 1];
            console.warn(
                `[runModels] ${promptCase.caseId}: attempt ${attempt}/${MAX_ATTEMPTS} failed (${String(error)}), retrying in ${backoffMs}ms...`
            );
            await new Promise(r => setTimeout(r, backoffMs));
        }
    }
    // Unreachable — the loop above always returns or throws on its final iteration.
    throw new Error(
        `[runModels] ${promptCase.caseId}: retry loop exited unexpectedly`
    );
}

/** One `(case, sampleIndex)` unit of work still left to run. */
export interface PendingSample {
    promptCase: PromptCaseOutput;
    sampleIndex: number;
}

/** `(caseId, sampleIndex)` key shared by {@link PendingSample} planning and existing-results resume lookup. */
function sampleKey(caseId: string, sampleIndex: number): string {
    return `${caseId}::${sampleIndex}`;
}

/**
 * Expands `cases` into every `(case, sampleIndex)` unit of work for the
 * requested `samples` count (0..samples-1 per case — `caseId` itself is
 * never mangled, only `sampleIndex` varies), then drops any unit already
 * present in `existingResults` — keyed on `(caseId, sampleIndex)`, not
 * `caseId` alone, so a resumed multi-sample run only re-does the specific
 * samples it hadn't finished. `r.sampleIndex ?? 0` tolerates loading an
 * older results file written before this field existed (implicitly sample 0).
 */
export function filterUnfinishedCases(
    cases: readonly PromptCaseOutput[],
    existingResults: readonly ModelRunResult[],
    samples = 1
): PendingSample[] {
    const doneKeys = new Set(
        existingResults.map(r => sampleKey(r.caseId, r.sampleIndex ?? 0))
    );
    const pending: PendingSample[] = [];
    for (const promptCase of cases) {
        for (let sampleIndex = 0; sampleIndex < samples; sampleIndex++) {
            if (!doneKeys.has(sampleKey(promptCase.caseId, sampleIndex))) {
                pending.push({ promptCase, sampleIndex });
            }
        }
    }
    return pending;
}

/** Atomic write: write to a `.tmp` sibling then rename over the target, so a crash mid-write never corrupts `outFile`. */
function writeResultsAtomic(
    outFile: string,
    results: readonly ModelRunResult[]
): void {
    const resolvedOut = resolve(outFile);
    const tmpFile = `${resolvedOut}.tmp`;
    writeFileSync(tmpFile, JSON.stringify(results, null, 2) + '\n');
    renameSync(tmpFile, resolvedOut);
}

/** Parse and validate `--samples` (default 1, must be a positive integer). */
export function parseSamplesArg(raw: string | undefined): number {
    return parsePositiveIntArg(raw, 'samples');
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const inFile = args.in;
    const outFile = args.out;
    if (!inFile || !outFile) {
        throw new Error(
            'Usage: runModels.ts --in prompts-<mode>.json --out results-<mode>.json [--samples N]'
        );
    }
    const samples = parseSamplesArg(args.samples);

    const apiKey = requireGeminiApiKey();
    const modelSpec = MODEL_SPECS[DEFAULT_ANALYSIS_MODEL];
    const client = new GoogleGenAI({ apiKey });

    const cases = JSON.parse(
        readFileSync(resolve(inFile), 'utf-8')
    ) as PromptCaseOutput[];
    const mode = inferModeFromFilename(inFile);

    const results: ModelRunResult[] = existsSync(resolve(outFile))
        ? (JSON.parse(
              readFileSync(resolve(outFile), 'utf-8')
          ) as ModelRunResult[])
        : [];
    if (results.length > 0) {
        console.log(`[runModels] resuming, ${results.length} done`);
    }
    const remaining = filterUnfinishedCases(cases, results, samples);

    console.log(
        `[runModels] ${remaining.length}/${cases.length * samples} (case, sample) unit(s) remaining, model=${modelSpec.apiModelId}, mode=${mode}, samples=${samples}`
    );

    // Sequential by design — see file header.
    for (const { promptCase: c, sampleIndex } of remaining) {
        const start = Date.now();
        const { text, usage } = await callGeminiWithRetry(
            client,
            modelSpec.apiModelId,
            c
        );
        const latencyMs = Date.now() - start;
        results.push({
            caseId: c.caseId,
            mode,
            analysisType: c.analysisType,
            resultText: text,
            usage,
            latencyMs,
            promptChars: c.prompt.length,
            sampleIndex,
        });
        writeResultsAtomic(outFile, results);
        console.log(
            `[runModels] ${c.caseId} (sample ${sampleIndex}): ${latencyMs}ms, output=${usage.outputTokens} tok, cached=${usage.cachedTokens} tok`
        );
    }

    console.log(
        `\n[runModels] wrote ${results.length} result(s) to ${outFile}`
    );
}

if (require.main === module) {
    main().catch(error => {
        console.error('[runModels] failed:', error);
        process.exitCode = 1;
    });
}
