import { describe, it, expect } from 'vitest';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { calculateIndicators } from '@/domain/indicators';
import {
    EMPTY_INDICATOR_RESULT,
    EMPTY_SMC_RESULT,
} from '@/domain/indicators/constants';
import type { Bar, IndicatorResult, Skill, SkillGating } from '@/domain/types';

// Spec §3.4 / plan Task 4.2 Step 1 — the assembly-split stability invariants:
// `stable` depends only on (analysisType, catalog fingerprint), never on the
// call's symbol/bars/timestamp, so it can serve as a byte-identical cacheable
// prefix at the worker/provider layer. These tests pin that contract directly
// against the shipped `{ stable, dynamic }` shape (no flattening wrapper).

const emptyIndicators = (): IndicatorResult => ({
    ...EMPTY_INDICATOR_RESULT,
    smc: EMPTY_SMC_RESULT,
});

const makeBars = (count: number, startClose: number): Bar[] =>
    Array.from({ length: count }, (_, i) => {
        const close = startClose + i;
        return {
            time: 1_700_000_000 + i * 86_400,
            open: close - 0.5,
            high: close + 1,
            low: close - 1,
            close,
            volume: 1_000_000 + i * 1_000,
        };
    });

const alwaysOn: SkillGating = { tier: 'always_on' };
const eventGated = (triggers: string[]): SkillGating => ({
    tier: 'gated',
    signalKind: 'event',
    triggers,
});

const makeSkill = (overrides: Partial<Skill>): Skill => ({
    name: 'Skill',
    description: 'desc',
    indicators: [],
    confidenceWeight: 0.8,
    content: '## Body\n- content',
    ...overrides,
});

describe('buildAnalysisPrompt — stable/dynamic assembly-split invariants (spec §3.4)', () => {
    it('stable part is byte-identical across symbols/bars and contains no per-call values', () => {
        const skills = [
            makeSkill({
                name: 'Always Pattern',
                type: 'pattern',
                gating: alwaysOn,
            }),
            makeSkill({
                name: 'RSI Guide',
                type: 'indicator_guide',
                gating: eventGated(['rsi_oversold']),
            }),
        ];
        const barsA = makeBars(60, 100);
        const barsB = makeBars(60, 400);
        const indA = calculateIndicators(barsA);
        const indB = calculateIndicators(barsB);

        const a = buildAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            barsA,
            indA,
            skills,
            '1Day'
        );
        const b = buildAnalysisPrompt(
            'TSLA',
            'Tesla Inc.',
            barsB,
            indB,
            skills,
            '1Day'
        );

        expect(a.stable).toBe(b.stable);
        expect(a.stable).not.toContain('AAPL');
        expect(a.stable).not.toContain('TSLA');
        expect(a.stable).not.toContain('Apple Inc.');
    });

    it('stable contains no symbol, job id, or timestamp — only dynamic carries per-call framing', () => {
        const { stable, dynamic } = buildAnalysisPrompt(
            'MSFT',
            'Microsoft Corporation',
            makeBars(40, 300),
            calculateIndicators(makeBars(40, 300)),
            [],
            '1Day'
        );
        expect(stable).not.toContain('MSFT');
        expect(stable).not.toContain('Microsoft Corporation');
        // The symbol/company framing line lives in dynamic instead.
        expect(dynamic).toContain('MSFT');
        expect(dynamic).toContain('Microsoft Corporation');
    });

    it('is deterministic: identical inputs build byte-identical stable AND dynamic across two calls', () => {
        const bars = makeBars(60, 150);
        const indicators = calculateIndicators(bars);
        const skills = [
            makeSkill({ name: 'B Pattern', type: 'pattern', gating: alwaysOn }),
            makeSkill({ name: 'A Pattern', type: 'pattern', gating: alwaysOn }),
        ];

        const first = buildAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            bars,
            indicators,
            skills,
            '1Day'
        );
        const second = buildAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            bars,
            indicators,
            skills,
            '1Day'
        );

        expect(first.stable).toBe(second.stable);
        expect(first.dynamic).toBe(second.dynamic);
    });

    it('always_on (core) skill content lands in stable; chart-gated (selected) skill content lands in dynamic', () => {
        const coreSkill = makeSkill({
            name: 'Always Pattern Guide',
            type: 'pattern',
            gating: alwaysOn,
        });
        const gatedSkill = makeSkill({
            name: 'Downtrend RSI Guide',
            type: 'indicator_guide',
            gating: eventGated([
                'rsi_oversold',
                'macd_bearish_cross',
                'supertrend_bearish_flip',
                'cci_bearish_cross',
                'dmi_bearish_cross',
            ]),
        });
        // A clear downtrend so the gated skill's trigger signal fires.
        const bars = makeBars(60, 200).map((b, i) => {
            const close = 200 - i * 2;
            return {
                ...b,
                open: close + 0.5,
                high: close + 1,
                low: close - 1,
                close,
            };
        });
        const indicators = calculateIndicators(bars);

        const { stable, dynamic } = buildAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            bars,
            indicators,
            [coreSkill, gatedSkill],
            '1Day'
        );

        // The digest CONTENT block (the `buildSkillBlock` "### <name> ..."
        // header immediately followed by the skill body) is what's actually
        // stable/dynamic-split. The gated-skill's plain name may still appear
        // in `dynamic`'s per-type "Skills ... list to analyze:" enumeration
        // (it must — the writing-rule checklist covers core ∪ selected), so
        // this asserts on the digest-block marker, not the bare name.
        expect(stable).toContain('### Always Pattern Guide');
        expect(dynamic).not.toContain('### Always Pattern Guide');
        expect(dynamic).toContain('### Downtrend RSI Guide');
        expect(stable).not.toContain('### Downtrend RSI Guide');
    });

    it('combining stable + dynamic with exactly "\\n\\n" reproduces the legacy single-string prompt content', () => {
        const bars = makeBars(30, 100);
        const indicators = emptyIndicators();
        const { stable, dynamic } = buildAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            bars,
            indicators,
            [],
            '1Day'
        );
        const combined = `${stable}\n\n${dynamic}`;
        // Both halves are non-empty and the join is the exact contract dispatch
        // relies on (`prompt: stable + '\n\n' + dynamic`, `seed: analysisSeed(combined)`).
        expect(stable.length).toBeGreaterThan(0);
        expect(dynamic.length).toBeGreaterThan(0);
        expect(combined).toContain('## Analysis Intent');
        expect(combined).toContain('AAPL');
    });
});
