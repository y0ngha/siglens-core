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
import { readFileSync, writeFileSync } from 'node:fs';
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

const RETRY_DELAY_MS = 2_000;

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

/** Retry exactly once on a transient failure (network blip, 5xx, etc.) — no infinite retry loop. */
async function callGeminiWithRetry(
    client: GoogleGenAI,
    apiModelId: string,
    promptCase: PromptCaseOutput
): Promise<{ text: string; usage: NormalizedUsage }> {
    try {
        return await callGeminiOnce(client, apiModelId, promptCase);
    } catch (error) {
        console.warn(
            `[runModels] ${promptCase.caseId}: first attempt failed (${String(error)}), retrying once...`
        );
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        return await callGeminiOnce(client, apiModelId, promptCase);
    }
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

    console.log(
        `[runModels] ${cases.length} case(s), model=${modelSpec.apiModelId}, mode=${mode}`
    );

    const results: ModelRunResult[] = [];
    // Sequential by design — see file header.
    for (const c of cases) {
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
        console.log(
            `[runModels] ${c.caseId}: ${latencyMs}ms, output=${usage.outputTokens} tok, cached=${usage.cachedTokens} tok`
        );
    }

    writeFileSync(resolve(outFile), JSON.stringify(results, null, 2) + '\n');
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
