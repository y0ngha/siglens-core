import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildAnalysisPrompt as buildAnalysisPromptRaw } from '@/domain/analysis/prompt';
import { calculateIndicators } from '@/domain/indicators';
import type { AssembledPrompt, Bar, Skill, SkillGating } from '@/domain/types';
import doubleTop from '@/__tests__/domain/patterns/fixtures/double-top.json';

// See prompt.test.ts for why this file shadows the raw `{ stable, dynamic }`
// return with a flattening wrapper (spec §3.4 assembly split). `flat` is
// exposed separately for the dynamic `await import(...)` call sites below,
// which bind directly to the real module export and bypass this shadow.
const flat = ({ stable, dynamic }: AssembledPrompt): string =>
    `${stable}\n\n${dynamic}`;
const buildAnalysisPrompt = (
    ...args: Parameters<typeof buildAnalysisPromptRaw>
): string => flat(buildAnalysisPromptRaw(...args));

// ── Task 3.3: pattern-screener candidates wired into skill selection ────────
// Covers the third event-trigger source (`patternCandidates`) added to
// `SkillSelectionContext`: a real chart-pattern fixture firing a gated
// pattern skill, the screener-throw exception-safety guarantee, and a
// regression invariant that an all-`always_on` catalog's prompt bytes never
// depend on what the screener finds (only gated skills can react to it).

const TEST_SYMBOL = 'AAPL';
const TEST_COMPANY = 'Apple Inc.';

interface Fixture {
    atr: number;
    bars: Bar[];
}

const makeSkill = (overrides: Partial<Skill>): Skill => ({
    name: 'Skill',
    description: 'desc',
    indicators: [],
    confidenceWeight: 0.8,
    content: '## Body\n- content',
    ...overrides,
});

const alwaysOn: SkillGating = { tier: 'always_on' };
const eventGated = (triggers: string[]): SkillGating => ({
    tier: 'gated',
    signalKind: 'event',
    triggers,
});

afterEach(() => {
    vi.doUnmock('@/domain/patterns');
    vi.resetModules();
});

describe('buildAnalysisPrompt — pattern-candidate gating (real screener)', () => {
    it('injects a pattern skill whose trigger matches a screener-detected pattern id, and only that one', () => {
        const fixture = doubleTop as Fixture;
        const indicators = calculateIndicators(fixture.bars);
        const matching = makeSkill({
            name: 'Double Top Guide',
            type: 'pattern',
            gating: eventGated(['double_top']),
        });
        const nonMatching = makeSkill({
            name: 'Bull Flag Guide',
            type: 'pattern',
            gating: eventGated(['bull_flag']),
        });

        const out = buildAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY,
            fixture.bars,
            indicators,
            [matching, nonMatching],
            '1Day'
        );

        expect(out).toContain('Double Top Guide');
        expect(out).not.toContain('Bull Flag Guide');
    });

    it('excludes the pattern skill entirely when there are no bars (no candidates possible)', () => {
        const skill = makeSkill({
            name: 'Double Top Guide',
            type: 'pattern',
            gating: eventGated(['double_top']),
        });
        const out = buildAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY,
            [],
            calculateIndicators([]),
            [skill],
            '1Day'
        );
        expect(out).not.toContain('Double Top Guide');
    });
});

describe('buildAnalysisPrompt — pattern-screener exception safety', () => {
    it('degrades patternCandidates to [] and still builds the prompt when the screener throws', async () => {
        vi.resetModules();
        vi.doMock('@/domain/patterns', () => ({
            screenChartPatterns: () => {
                throw new Error('boom: classifier bug');
            },
            computeCandidateGeometry: () => null,
        }));

        const { buildAnalysisPrompt: buildWithThrowingScreener } =
            await import('@/domain/analysis/prompt');
        const fixture = doubleTop as Fixture;
        const indicators = calculateIndicators(fixture.bars);
        const skill = makeSkill({
            name: 'Double Top Guide',
            type: 'pattern',
            gating: eventGated(['double_top']),
        });

        let out = '';
        expect(() => {
            out = flat(
                buildWithThrowingScreener(
                    TEST_SYMBOL,
                    TEST_COMPANY,
                    fixture.bars,
                    indicators,
                    [skill],
                    '1Day'
                )
            );
        }).not.toThrow();
        // patternCandidates degraded to [] — the gated pattern skill never fires.
        expect(out).not.toContain('Double Top Guide');
    });
});

describe('buildAnalysisPrompt — pattern-candidates never affect an all-always_on catalog (regression)', () => {
    it('selects the identical skill catalog whether or not the screener finds candidates (spec 2026-09-18 §A1 narrowed this — see comments below)', async () => {
        const skills = [
            makeSkill({ name: 'B Pattern', type: 'pattern', gating: alwaysOn }),
            makeSkill({ name: 'A Pattern', type: 'pattern', gating: alwaysOn }),
            makeSkill({
                name: 'RSI Guide',
                type: 'indicator_guide',
                gating: alwaysOn,
            }),
        ];
        const fixture = doubleTop as Fixture;
        const indicators = calculateIndicators(fixture.bars);

        vi.resetModules();
        vi.doMock('@/domain/patterns', () => ({
            screenChartPatterns: () => [],
            computeCandidateGeometry: () => null,
        }));
        const { buildAnalysisPrompt: buildWithNoCandidates } =
            await import('@/domain/analysis/prompt');
        const withNoCandidates = flat(
            buildWithNoCandidates(
                TEST_SYMBOL,
                TEST_COMPANY,
                fixture.bars,
                indicators,
                skills,
                '1Day'
            )
        );

        vi.resetModules();
        vi.doMock('@/domain/patterns', () => ({
            screenChartPatterns: () => [
                { id: 'double_top', startIndex: 0, endIndex: 1 },
                { id: 'bull_flag', startIndex: 2, endIndex: 3 },
            ],
            computeCandidateGeometry: () => null,
        }));
        const { buildAnalysisPrompt: buildWithCandidates } =
            await import('@/domain/analysis/prompt');
        const withCandidates = flat(
            buildWithCandidates(
                TEST_SYMBOL,
                TEST_COMPANY,
                fixture.bars,
                indicators,
                skills,
                '1Day'
            )
        );

        // The active-skill catalog (and everything selection derives — the
        // stable prefix, patternSummaries Writing Rules skill list, etc.) is
        // unaffected: `patternCandidates` only reaches `selectSkills` for
        // `gated`/`event` skills, and every skill here is `always_on`. Scope
        // the equality check to that portion — everything up to the first
        // per-call value (`Symbol:`) — rather than the whole prompt, since
        // `## Chart Pattern Candidates (computed)` now legitimately renders
        // the screener's raw findings (spec 2026-09-18 §A1) and is expected
        // to differ.
        const skillPortion = (s: string): string =>
            s.slice(0, s.indexOf('Symbol:'));
        expect(skillPortion(withCandidates)).toBe(
            skillPortion(withNoCandidates)
        );

        // Document (not silently drop) the new, intentional difference: the
        // candidates section itself does react to the screener's findings.
        expect(withCandidates).not.toBe(withNoCandidates);
        expect(withNoCandidates).toContain(
            '- None detected by the pre-screener'
        );
        expect(withCandidates).not.toContain(
            '- None detected by the pre-screener'
        );
    });
});
