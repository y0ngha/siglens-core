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
 *   GEMINI_API_KEY=... npx tsx scripts/ab-harness/runModels.ts --in prompts-<mode>.json --out results-<mode>.json
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import { parseArgs } from './cliArgs';
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

/** Case ids already present in a loaded results file — used to skip finished work on resume. */
export function filterUnfinishedCases(
    cases: readonly PromptCaseOutput[],
    existingResults: readonly ModelRunResult[]
): PromptCaseOutput[] {
    const doneIds = new Set(existingResults.map(r => r.caseId));
    return cases.filter(c => !doneIds.has(c.caseId));
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

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const inFile = args.in;
    const outFile = args.out;
    if (!inFile || !outFile) {
        throw new Error(
            'Usage: runModels.ts --in prompts-<mode>.json --out results-<mode>.json'
        );
    }

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
    const remainingCases = filterUnfinishedCases(cases, results);

    console.log(
        `[runModels] ${remainingCases.length}/${cases.length} case(s) remaining, model=${modelSpec.apiModelId}, mode=${mode}`
    );

    // Sequential by design — see file header.
    for (const c of remainingCases) {
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
        });
        writeResultsAtomic(outFile, results);
        console.log(
            `[runModels] ${c.caseId}: ${latencyMs}ms, output=${usage.outputTokens} tok, cached=${usage.cachedTokens} tok`
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
