/**
 * A/B prompt-quality harness — Stage 1 (plan Task 2.5,
 * `docs/superpowers/plans/2026-07-03-prompt-size-quality-redesign.md`).
 *
 * Builds the exact prompts the production analysis path would send to the
 * worker for the 8 frozen fixtures (`fixtures/*.json`), in either `full`
 * (pre-digest production content) or `digest` (current production loader)
 * mode. Run it twice — once per mode — to produce the two prompt sets
 * `judge.ts` ultimately compares.
 *
 * Usage:
 *   npx tsx scripts/ab-harness/buildPrompts.ts --mode <full|digest> --out <file.json> [--skills <path>]
 *
 * `--skills` defaults to `../siglens-digests/skills` (sibling of this repo)
 * — see `README.md` for why, and pass e.g. `--skills ../siglens/skills` to
 * point at the real production skill catalog.
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
// Resolved relative to THIS FILE (not cwd) so the default works regardless of
// where `npx tsx` is invoked from — mirrors `scripts/validation/loadEnv.ts`'s
// `requireFmpApiKey` sibling-repo resolution.
const DEFAULT_SKILLS_PATH = join(__dirname, '../../../siglens-digests/skills');

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
 * Build the technical-analysis prompt case for one fixture. Indicators are
 * computed via the real `calculateIndicators` pipeline (the same one
 * `fetchBarsWithIndicators` uses in production) so the prompt is byte-for-byte
 * what `submitAnalysis` would have built from these bars.
 */
export function buildTechnicalCase(
    fixture: TechnicalFixture,
    skills: readonly Skill[]
): PromptCaseOutput {
    const indicators = calculateIndicators(fixture.bars);
    // `buildAnalysisPrompt` returns `{ stable, dynamic }` (spec §3.4 assembly
    // split); the harness sends the model the same combined string
    // production dispatch builds as its `prompt` fallback field ('\n\n' join).
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
    const prompt = `${stable}\n\n${dynamic}`;
    return {
        caseId: fixture.caseId,
        analysisType: 'technical',
        system: AI_SYSTEM_PROMPT,
        prompt,
        responseSchema: TECHNICAL_RESPONSE_SCHEMA,
    };
}

/** Build the news-analysis prompt case for one fixture, via the same builder `submitNewsAnalysis` calls. */
export function buildNewsCase(
    fixture: NewsFixture,
    skills: readonly Skill[]
): PromptCaseOutput {
    const prompt = buildNewsAnalysisPrompt(
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
    return {
        caseId: fixture.caseId,
        analysisType: 'news',
        system: NEWS_SYSTEM_PROMPT,
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
            'Usage: buildPrompts.ts --mode <full|digest> --out <file.json> [--skills <path>]'
        );
    }
    if (!args.out) {
        throw new Error('--out <file.json> is required');
    }
    const outPath = resolve(args.out);
    const skillsPath = args.skills ? resolve(args.skills) : DEFAULT_SKILLS_PATH;

    // The `mode !== 'full' && mode !== 'digest'` guard above throws on any
    // other value, so by this point `mode` is provably one of the two
    // `PromptMode` literals — TS just can't narrow a `string` to a literal
    // union via inequality checks against string literals.
    const skills = await loadSkillCatalog(mode as PromptMode, skillsPath);
    console.log(
        `[ab-harness] loaded ${skills.length} skill(s) from ${skillsPath} (mode=${mode})`
    );

    const technicalCases = TECHNICAL_FIXTURE_FILES.map(file =>
        buildTechnicalCase(loadJsonFixture<TechnicalFixture>(file), skills)
    );
    const newsCases = NEWS_FIXTURE_FILES.map(file =>
        buildNewsCase(loadJsonFixture<NewsFixture>(file), skills)
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
