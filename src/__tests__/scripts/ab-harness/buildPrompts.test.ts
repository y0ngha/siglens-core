import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateIndicators } from '@/domain/indicators';
import {
    AI_SYSTEM_PROMPT,
    NEWS_SYSTEM_PROMPT,
} from '@/domain/analysis/systemPrompt';
import {
    NEWS_RESPONSE_SCHEMA,
    TECHNICAL_RESPONSE_SCHEMA,
} from '@/domain/analysis/responseSchemas';
import type {
    Bar,
    EarningsCalendarItem,
    EnrichedNewsItem,
    Skill,
    Timeframe,
} from '@/domain/types';
import {
    buildNewsCase,
    buildTechnicalCase,
} from '../../../../scripts/ab-harness/buildPrompts';

const FIXTURES_DIR = join(__dirname, '../../../../scripts/ab-harness/fixtures');

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

function loadFixture<T>(file: string): T {
    return JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf-8')) as T;
}

const NO_SKILLS: Skill[] = [];

describe('buildTechnicalCase', () => {
    const fixture = loadFixture<TechnicalFixture>('tech-trend.json');

    it('produces a technical prompt case wired to the real system prompt and schema', () => {
        const result = buildTechnicalCase(fixture, NO_SKILLS);
        expect(result.caseId).toBe('tech-trend');
        expect(result.analysisType).toBe('technical');
        expect(result.system).toBe(AI_SYSTEM_PROMPT);
        expect(result.responseSchema).toBe(TECHNICAL_RESPONSE_SCHEMA);
        expect(result.prompt).toContain(fixture.symbol);
        expect(result.prompt).toContain(fixture.companyName);
        expect(result.prompt.length).toBeGreaterThan(0);
    });

    it('computes indicators from the fixture bars via the real calculateIndicators pipeline', () => {
        // Sanity check that the fixture itself is a valid, indicator-computable
        // bar series (fails loudly if the fixture generator ever produces
        // malformed bars) — mirrors what buildTechnicalCase does internally.
        expect(() => calculateIndicators(fixture.bars)).not.toThrow();
    });

    it('every frozen technical fixture builds a non-empty prompt without throwing', () => {
        const files = [
            'tech-trend.json',
            'tech-range.json',
            'tech-highvol.json',
            'tech-lowliq.json',
            'tech-pattern-hs.json',
            'tech-pattern-doubletop.json',
        ];
        for (const file of files) {
            const f = loadFixture<TechnicalFixture>(file);
            const result = buildTechnicalCase(f, NO_SKILLS);
            expect(result.caseId).toBe(f.caseId);
            expect(result.prompt.length).toBeGreaterThan(0);
        }
    });

    // Design C's `--fold-stable-into-system` harness flag: models the
    // worker-side system composition (`system = <original> + '\n\n' +
    // stable`, `prompt = dynamic`), instead of the default legacy fallback
    // (`prompt = stable + '\n\n' + dynamic`).
    describe('foldStableIntoSystem', () => {
        const ALWAYS_ON_SKILL: Skill[] = [
            {
                name: 'Always Pattern Guide',
                description: 'desc',
                indicators: [],
                confidenceWeight: 0.8,
                content: '## Body\n- content',
                type: 'pattern',
                gating: { tier: 'always_on' },
            },
        ];

        it('default (unset): system is unchanged and prompt is stable + dynamic', () => {
            const result = buildTechnicalCase(fixture, ALWAYS_ON_SKILL);
            expect(result.system).toBe(AI_SYSTEM_PROMPT);
            expect(result.prompt).toContain('### Always Pattern Guide');
        });

        it('enabled: folds stable into system and prompt becomes dynamic alone', () => {
            const folded = buildTechnicalCase(fixture, ALWAYS_ON_SKILL, true);
            const unfolded = buildTechnicalCase(
                fixture,
                ALWAYS_ON_SKILL,
                false
            );

            // The always_on skill digest moves from `prompt` to `system`.
            expect(folded.system).toContain(AI_SYSTEM_PROMPT);
            expect(folded.system).toContain('### Always Pattern Guide');
            expect(folded.prompt).not.toContain('### Always Pattern Guide');

            // Folded system + prompt reproduces the same total content as the
            // unfolded system + prompt (modulo where the boundary sits).
            expect(`${folded.system}\n\n${folded.prompt}`).toBe(
                `${unfolded.system}\n\n${unfolded.prompt}`
            );
        });

        // p22: the technical `stable` always leads with the fixed Analysis
        // Intent + Guidelines blocks, so it is non-empty even with no skills
        // and the folded system is the persona plus that head.
        it('enabled without skills: system is the plain system prompt plus the Intent/Guidelines head', () => {
            const result = buildTechnicalCase(fixture, NO_SKILLS, true);
            expect(
                result.system.startsWith(
                    `${AI_SYSTEM_PROMPT}\n\n## Analysis Intent\n`
                )
            ).toBe(true);
            expect(result.system).toContain('## Analysis Guidelines');
            expect(result.prompt.startsWith('Symbol: ')).toBe(true);
        });
    });
});

describe('buildNewsCase', () => {
    const fixture = loadFixture<NewsFixture>('news-earnings.json');

    it('produces a news prompt case wired to the real system prompt and schema', () => {
        const result = buildNewsCase(fixture, NO_SKILLS);
        expect(result.caseId).toBe('news-earnings');
        expect(result.analysisType).toBe('news');
        expect(result.system).toBe(NEWS_SYSTEM_PROMPT);
        expect(result.responseSchema).toBe(NEWS_RESPONSE_SCHEMA);
        expect(result.prompt).toContain(fixture.symbol);
        expect(result.prompt.length).toBeGreaterThan(0);
    });

    it('includes article content from every article in the fixture', () => {
        const result = buildNewsCase(fixture, NO_SKILLS);
        for (const article of fixture.articles) {
            expect(result.prompt).toContain(article.card.summaryKo);
        }
    });

    it('both frozen news fixtures build a non-empty prompt without throwing', () => {
        for (const file of ['news-earnings.json', 'news-macro.json']) {
            const f = loadFixture<NewsFixture>(file);
            const result = buildNewsCase(f, NO_SKILLS);
            expect(result.caseId).toBe(f.caseId);
            expect(result.prompt.length).toBeGreaterThan(0);
        }
    });
});
