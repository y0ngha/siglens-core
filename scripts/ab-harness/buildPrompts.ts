/**
 * A/B prompt-quality harness — Stage 1.
 *
 * Builds the exact prompts the production analysis path would send to the
 * worker for the 8 frozen fixtures (`fixtures/*.json`), in either `full`
 * (pre-digest production content) or `digest` (current production loader)
 * mode. Run it twice — once per mode — to produce the two prompt sets
 * `judge.ts` ultimately compares.
 *
 * Usage:
 *   npx tsx scripts/ab-harness/buildPrompts.ts --mode <full|digest> --out <file.json> --skills <dir> [--fold-stable-into-system]
 *
 * `--skills` is required: the path of a skills directory (the skill catalog
 * the prompts are built from). Point it at the production catalog to measure
 * what production would send.
 *
 * `--fold-stable-into-system` models Design C's worker-side system
 * composition (skills-to-system split, see `domain/analysis/prompt.ts`'s
 * `buildAnalysisPrompt` doc comment): each case's `system` becomes the
 * builder's original system prompt + `'\n\n'` + `stable` (the always_on
 * skill digests), and `prompt` becomes `dynamic` alone — `stable` is never
 * folded into `prompt`. Default (flag unset) behavior is unchanged: `system`
 * is the plain system prompt and `prompt` is `stable + '\n\n' + dynamic`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
    Bar,
    EarningsCalendarItem,
    EnrichedNewsItem,
    ResponseJsonSchema,
    Skill,
    Timeframe,
} from '@/domain/types';
import { calculateIndicators } from '@/domain/indicators';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { buildNewsAnalysisPrompt } from '@/domain/analysis/newsPrompt';
import {
    AI_SYSTEM_PROMPT,
    NEWS_SYSTEM_PROMPT,
} from '@/domain/analysis/systemPrompt';
import {
    NEWS_RESPONSE_SCHEMA,
    TECHNICAL_RESPONSE_SCHEMA,
} from '@/domain/analysis/responseSchemas';
import { parseArgs } from './cliArgs';
import { loadSkillCatalog, type PromptMode } from './skillCatalog';

const FIXTURES_DIR = join(__dirname, 'fixtures');

const TECHNICAL_FIXTURE_FILES = [
    'tech-trend.json',
    'tech-range.json',
    'tech-highvol.json',
    'tech-lowliq.json',
    'tech-pattern-hs.json',
    'tech-pattern-doubletop.json',
] as const;

const NEWS_FIXTURE_FILES = ['news-earnings.json', 'news-macro.json'] as const;

interface TechnicalFixture {
    caseId: string;
    symbol: string;
    companyName: string;
    timeframe: Timeframe;
    bars: Bar[];
}

interface NewsFixture {
    caseId: string;
    symbol: string;
    companyName: string;
    articles: EnrichedNewsItem[];
    upcomingCalendar: EarningsCalendarItem[];
}

export type AnalysisTypeUnderTest = 'technical' | 'news';

export interface PromptCaseOutput {
    caseId: string;
    analysisType: AnalysisTypeUnderTest;
    system: string;
    prompt: string;
    responseSchema: ResponseJsonSchema;
}

function loadJsonFixture<T>(file: string): T {
    return JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf-8')) as T;
}

/**
 * Fold `stable` into the `system` message (Design C's worker-side
 * composition) instead of the default `prompt: stable + '\n\n' + dynamic`.
 * Shared by {@link buildTechnicalCase} and {@link buildNewsCase} so both
 * follow the exact same folding contract.
 */
function composeCase(
    systemPrompt: string,
    stable: string,
    dynamic: string,
    foldStableIntoSystem: boolean
): { system: string; prompt: string } {
    if (foldStableIntoSystem) {
        return {
            system: stable ? `${systemPrompt}\n\n${stable}` : systemPrompt,
            prompt: dynamic,
        };
    }
    return {
        system: systemPrompt,
        prompt: stable ? `${stable}\n\n${dynamic}` : dynamic,
    };
}

/**
 * Build the technical-analysis prompt case for one fixture. Indicators are
 * computed via the real `calculateIndicators` pipeline (the same one
 * `fetchBarsWithIndicators` uses in production) so the prompt is byte-for-byte
 * what `submitAnalysis` would have built from these bars.
 *
 * @param foldStableIntoSystem - When `true`, models Design C's worker-side
 *   system composition: `system` becomes `AI_SYSTEM_PROMPT + '\n\n' +
 *   stable`, and `prompt` is `dynamic` alone. Defaults to `false` (legacy
 *   `prompt: stable + '\n\n' + dynamic` fallback).
 */
export function buildTechnicalCase(
    fixture: TechnicalFixture,
    skills: readonly Skill[],
    foldStableIntoSystem = false
): PromptCaseOutput {
    const indicators = calculateIndicators(fixture.bars);
    // `buildAnalysisPrompt` returns `{ stable, dynamic }` (assembly
    // split); the harness sends the model the same combined string
    // production dispatch builds as its `prompt` fallback field ('\n\n' join)
    // — or, under `--fold-stable-into-system`, folds `stable` into `system`
    // instead (see `composeCase`).
    const { stable, dynamic } = buildAnalysisPrompt(
        fixture.symbol,
        fixture.companyName,
        fixture.bars,
        indicators,
        // `buildAnalysisPrompt` requires mutable `Skill[]` but never mutates
        // it: it only reads via `selectSkills` (which itself returns a new
        // name-sorted copy, per its own doc comment) and `.filter`/loop-push
        // into fresh `skillGroups` arrays. The caller's `readonly Skill[]` is
        // never written through, so the widen to mutable is safe here.
        skills as Skill[],
        fixture.timeframe,
        undefined,
        'equity'
    );
    const { system, prompt } = composeCase(
        AI_SYSTEM_PROMPT,
        stable,
        dynamic,
        foldStableIntoSystem
    );
    return {
        caseId: fixture.caseId,
        analysisType: 'technical',
        system,
        prompt,
        responseSchema: TECHNICAL_RESPONSE_SCHEMA,
    };
}

/**
 * Build the news-analysis prompt case for one fixture, via the same builder
 * `submitNewsAnalysis` calls.
 *
 * @param foldStableIntoSystem - When `true`, models Design C's worker-side
 *   system composition: `system` becomes `NEWS_SYSTEM_PROMPT + '\n\n' +
 *   stable`, and `prompt` is `dynamic` alone. Defaults to `false` (legacy
 *   `prompt: stable + '\n\n' + dynamic` fallback).
 */
export function buildNewsCase(
    fixture: NewsFixture,
    skills: readonly Skill[],
    foldStableIntoSystem = false
): PromptCaseOutput {
    // `buildNewsAnalysisPrompt` returns `{ stable, dynamic }` (assembly
    // split); the harness sends the model the same combined string
    // production dispatch builds as its `prompt` fallback field ('\n\n' join)
    // — or, under `--fold-stable-into-system`, folds `stable` into `system`
    // instead (see `composeCase`).
    const { stable, dynamic } = buildNewsAnalysisPrompt(
        fixture.symbol,
        fixture.companyName,
        fixture.articles,
        fixture.upcomingCalendar,
        // Same widen as `buildTechnicalCase` above: the callee only reads
        // the array (`filterNewsSkills` takes `readonly Skill[]` and
        // returns a new filtered array via `.filter`), so the mutable
        // widen never lets the callee write back into the caller's array.
        skills as Skill[],
        'equity'
    );
    const { system, prompt } = composeCase(
        NEWS_SYSTEM_PROMPT,
        stable,
        dynamic,
        foldStableIntoSystem
    );
    return {
        caseId: fixture.caseId,
        analysisType: 'news',
        system,
        prompt,
        responseSchema: NEWS_RESPONSE_SCHEMA,
    };
}

function printSizeReport(cases: readonly PromptCaseOutput[]): void {
    console.log('\ncaseId'.padEnd(26) + 'type'.padEnd(12) + 'prompt chars');
    console.log('-'.repeat(50));
    for (const c of cases) {
        console.log(
            c.caseId.padEnd(26) +
                c.analysisType.padEnd(12) +
                String(c.prompt.length)
        );
    }
    const total = cases.reduce((sum, c) => sum + c.prompt.length, 0);
    console.log('-'.repeat(50));
    console.log(`total`.padEnd(38) + String(total));
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const mode = args.mode;
    if (mode !== 'full' && mode !== 'digest') {
        throw new Error(
            'Usage: buildPrompts.ts --mode <full|digest> --out <file.json> --skills <dir>'
        );
    }
    if (!args.out) {
        throw new Error('--out <file.json> is required');
    }
    const outPath = resolve(args.out);
    if (!args.skills) {
        throw new Error('--skills <dir> is required (a skills directory)');
    }
    const skillsPath = resolve(args.skills);
    // Boolean CLI flag: `parseArgs` stores a bare `--fold-stable-into-system`
    // (no following value) as the string `'true'`; any other value is also
    // treated as "set" (only an entirely absent key means unset/false).
    const foldStableIntoSystem = args['fold-stable-into-system'] !== undefined;

    // The `mode !== 'full' && mode !== 'digest'` guard above throws on any
    // other value, so by this point `mode` is provably one of the two
    // `PromptMode` literals — TS just can't narrow a `string` to a literal
    // union via inequality checks against string literals.
    const skills = await loadSkillCatalog(mode as PromptMode, skillsPath);
    console.log(
        `[ab-harness] loaded ${skills.length} skill(s) from ${skillsPath} (mode=${mode}, foldStableIntoSystem=${foldStableIntoSystem})`
    );

    const technicalCases = TECHNICAL_FIXTURE_FILES.map(file =>
        buildTechnicalCase(
            loadJsonFixture<TechnicalFixture>(file),
            skills,
            foldStableIntoSystem
        )
    );
    const newsCases = NEWS_FIXTURE_FILES.map(file =>
        buildNewsCase(
            loadJsonFixture<NewsFixture>(file),
            skills,
            foldStableIntoSystem
        )
    );
    const allCases = [...technicalCases, ...newsCases];

    writeFileSync(outPath, JSON.stringify(allCases, null, 2) + '\n');
    printSizeReport(allCases);
    console.log(
        `\n[ab-harness] wrote ${allCases.length} prompt case(s) to ${outPath}`
    );
}

if (require.main === module) {
    main().catch(error => {
        console.error('[ab-harness] buildPrompts failed:', error);
        process.exitCode = 1;
    });
}
