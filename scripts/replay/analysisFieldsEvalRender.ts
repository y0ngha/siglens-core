/**
 * Renders the technical prompt of a case for each tier through the production
 * `runAnalysis` path, without a model call: the `skills` mode reads what a tier's prompt
 * carries off the rendered text. Going through `runAnalysis` (not the prompt builders) keeps
 * the instrument independent of how the arm under test wires skill selection, so the same
 * code measures `main` and a branch that changes the selection.
 *
 * No network and no model call is possible here: `fetch` is replaced by a function that
 * throws, and the prompt-assembled hook aborts the call's signal before the provider is
 * reached. A case whose prompt was not assembled fails the run.
 *
 * FileSkillsLoader reads `<cwd>/skills`, so the process changes directory to the parent of
 * `--skills` before core is imported (as `run.ts` does).
 */
import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CatalogSkill, PromptSample } from './analysisFieldsEvalSkills';
import { runAtInstant } from './clock';
import { marketOfSymbol, profileOf, sessionCloseInstantMs } from './markets';
import { createStoredProvider } from './storedProvider';
import type { ReplayCase, StoredBars } from './types';
import type { AssembledPromptRecord, Skill } from '@/domain/types';

export interface RenderInput {
    skillsDir: string;
    cases: readonly ReplayCase[];
    storedOf: (symbol: string) => StoredBars;
    log: (line: string) => void;
}

export interface Rendered {
    catalog: readonly CatalogSkill[];
    samples: readonly PromptSample[];
}

export type RenderSkills = (input: RenderInput) => Promise<Rendered>;

/** Injection group of a skill: `type ?? category ?? 'regular'`. */
export function groupOf(skill: Pick<Skill, 'type' | 'category'>): string {
    return skill.type ?? skill.category ?? 'regular';
}

const OFFLINE_KEY = 'offline-evaluation-no-network';

/**
 * Silences the production code's own diagnostics (`[ChartPatterns]`, `[RunAnalysis]`
 * lines) while prompts are rendered: they are one block per case and bury the report.
 * Returns the function that puts the console back.
 */
function muteConsole(): () => void {
    const saved = {
        info: console.info,
        warn: console.warn,
        error: console.error,
    };
    console.info = () => undefined;
    console.warn = () => undefined;
    console.error = () => undefined;
    return () => {
        console.info = saved.info;
        console.warn = saved.warn;
        console.error = saved.error;
    };
}

export const renderWithCore: RenderSkills = async input => {
    if (!statSync(input.skillsDir).isDirectory()) {
        throw new Error(`${input.skillsDir} is not a directory`);
    }
    process.chdir(dirname(input.skillsDir));
    const [
        { runAnalysis },
        { DEEPSEEK_V4_1_FLASH_MODEL },
        { loadSkillsCached },
        { isSkillAllowedInContext },
    ] = await Promise.all([
        import('@/application/market/runAnalysis'),
        import('@/application/chat/constants'),
        import('@/infrastructure/skills/loader'),
        import('@/domain/analysis/skillWhitelist'),
    ]);
    const loaded = await loadSkillsCached();
    const technical = loaded.skills.filter(s =>
        isSkillAllowedInContext(s, 'technical')
    );
    if (technical.length === 0 || loaded.skillsDegraded) {
        throw new Error(
            `${input.skillsDir}: no technical skill loaded (or the load degraded)`
        );
    }
    const catalog: CatalogSkill[] = technical.map(skill => ({
        name: skill.name,
        group: groupOf(skill),
        alwaysOn: skill.gating?.tier === 'always_on',
        injected: skill.smcFullGuide !== true,
    }));

    // The DeepSeek client only checks that a key exists before the request; the request
    // itself is never made (the call is aborted and `fetch` throws).
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY ??= OFFLINE_KEY;
    globalThis.fetch = () => {
        throw new Error('network is disabled in the skills evaluation');
    };
    const unmute = muteConsole();
    try {
        const samples: PromptSample[] = [];
        for (const [i, replayCase] of input.cases.entries()) {
            const stored = input.storedOf(replayCase.symbol);
            const profile = profileOf(marketOfSymbol(replayCase.symbol));
            for (const tier of ['free', 'member'] as const) {
                const controller = new AbortController();
                const captured: { prompt: AssembledPromptRecord | null } = {
                    prompt: null,
                };
                await runAtInstant(
                    sessionCloseInstantMs(profile.session, replayCase.asOf),
                    () =>
                        runAnalysis(
                            replayCase.symbol,
                            stored.companyName,
                            '1Day',
                            true,
                            undefined,
                            {
                                modelId: DEEPSEEK_V4_1_FLASH_MODEL,
                                marketDataProvider: createStoredProvider(
                                    stored.bars,
                                    replayCase.asOf
                                ),
                                session: profile.session,
                                assetClass: 'equity',
                                currency: profile.currency,
                                krxTickTable: profile.krxTickTable,
                                tierContext: { userId: null, tier },
                                reasoning: false,
                                cache: null,
                                signal: controller.signal,
                                onPromptAssembled: record => {
                                    captured.prompt = record;
                                    controller.abort();
                                },
                            }
                        ).catch(() => null)
                );
                if (captured.prompt === null) {
                    throw new Error(
                        `${replayCase.caseId} (${tier}): no prompt was assembled`
                    );
                }
                samples.push({
                    caseId: replayCase.caseId,
                    tier,
                    stable: captured.prompt.stable,
                    dynamic: captured.prompt.dynamic,
                });
            }
            if ((i + 1) % 50 === 0) {
                input.log(`  rendered ${i + 1}/${input.cases.length} cases`);
            }
        }
        return { catalog, samples };
    } finally {
        unmute();
        globalThis.fetch = previousFetch;
        if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    }
};
