import { describe, expect, it } from 'vitest';
import { share } from '../../../../scripts/replay/analysisFieldsEvalCompute';
import type { RunCallStats } from '../../../../scripts/replay/analysisFieldsEvalPlan';
import {
    compareLevelOverlap,
    digestPosition,
    levelOverlapPerCase,
    skillRows,
    skillsGates,
    summarizeSkills,
    type CatalogSkill,
    type LevelCase,
    type PromptSample,
    type SkillTier,
} from '../../../../scripts/replay/analysisFieldsEvalSkills';
import { FIELDS_EVAL_CONSTANTS as C } from '../../../../scripts/replay/analysisFieldsEvalTypes';

const skill = (
    name: string,
    group: string,
    alwaysOn: boolean,
    injected = true
): CatalogSkill => ({ name, group, alwaysOn, injected });

const CATALOG: readonly CatalogSkill[] = [
    skill('Core A', 'indicator_guide', true),
    skill('Core B', 'indicator_guide', true),
    skill('Smc Full', 'strategy', true, false),
    ...['G1', 'G2', 'G3', 'G4', 'G5'].map(n => skill(n, 'pattern', false)),
    skill('S1', 'strategy', false),
];

/** A prompt: always-on digests in `stable`, gated digests in `dynamic`, in the order given. */
function sample(
    caseId: string,
    tier: SkillTier,
    stable: readonly string[],
    gated: readonly string[]
): PromptSample {
    return {
        caseId,
        tier,
        stable: stable.map(n => `### ${n} (guide)\nbody`).join('\n'),
        dynamic: gated.map(n => `### ${n} (guide)\nbody`).join('\n'),
    };
}

describe('digestPosition', () => {
    it('finds a heading followed by a space or by a line break', () => {
        expect(digestPosition('x\n### Core A (g)', 'Core A')).toBe(2);
        expect(digestPosition('### Core A\nbody', 'Core A')).toBe(0);
    });

    it('does not match a longer name or a mention outside a heading', () => {
        expect(digestPosition('### Core AB (g)', 'Core A')).toBe(-1);
        expect(digestPosition('see Core A here', 'Core A')).toBe(-1);
    });
});

describe('summarizeSkills', () => {
    const memberStable = ['Core A', 'Core B'];

    /** Member sees G1..G4 in that order, free the first three: the shape the design asks for. */
    const goodSamples = (): PromptSample[] => [
        sample('c1', 'member', memberStable, ['G1', 'G2', 'G3', 'G4', 'S1']),
        sample('c1', 'free', memberStable, ['G1', 'G2', 'G3', 'S1']),
        sample('c2', 'member', memberStable, ['G2', 'G5']),
        sample('c2', 'free', memberStable, ['G2', 'G5']),
    ];

    it('describes the catalog: always-on, the one never injected, gated and groups', () => {
        const summary = summarizeSkills(CATALOG, goodSamples());
        expect(summary.catalog.technical).toBe(CATALOG.length);
        expect(summary.catalog.alwaysOn).toEqual([
            'Core A',
            'Core B',
            'Smc Full',
        ]);
        expect(summary.catalog.injectedAlwaysOn).toEqual(['Core A', 'Core B']);
        expect(summary.catalog.gated).toBe(6);
        expect(summary.catalog.groups).toEqual([
            'indicator_guide',
            'pattern',
            'strategy',
        ]);
        expect(summary.cases).toBe(2);
    });

    it('reads skills per prompt and per group off the text', () => {
        const { tiers } = summarizeSkills(CATALOG, goodSamples());
        expect(tiers.member.skillsPerPrompt.p50).toBe(5.5);
        expect(tiers.free.gatedPerPrompt.n).toBe(2);
        expect(tiers.member.gatedByGroup.pattern.max).toBe(4);
        expect(tiers.free.gatedByGroup.pattern.max).toBe(3);
        expect(tiers.free.gatedByGroup.strategy.max).toBe(1);
        expect(tiers.free.alwaysOnCoverage['Core A']).toEqual(share(2, 2));
        expect(tiers.member.totalGated).toBe(7);
        expect(tiers.free.totalGated).toBe(6);
    });

    it('reports free gated skills as a share of member and the prompt sizes', () => {
        const summary = summarizeSkills(CATALOG, goodSamples());
        expect(summary.freeGatedShareOfMember).toBe(6 / 7);
        expect(summary.tiers.free.stableChars.n).toBe(2);
        expect(summary.tiers.free.dynamicChars.p50).toBeGreaterThan(0);
    });

    it('accepts free prompts whose gated skills are the first of member order within the cap', () => {
        const { s2 } = summarizeSkills(CATALOG, goodSamples());
        expect(s2).toEqual({ ok: share(2, 2), overCap: 0, notPrefix: 0 });
    });

    it('rejects a free prompt that keeps a skill member ranks later, or goes over the cap', () => {
        const samples = [
            sample('c1', 'member', memberStable, ['G1', 'G2', 'G3', 'G4']),
            sample('c1', 'free', memberStable, ['G1', 'G2', 'G4']),
            sample('c2', 'member', memberStable, [
                'G1',
                'G2',
                'G3',
                'G4',
                'G5',
            ]),
            sample('c2', 'free', memberStable, ['G1', 'G2', 'G3', 'G4']),
        ];
        const { s2 } = summarizeSkills(CATALOG, samples);
        expect(s2.ok).toEqual(share(0, 2));
        expect(s2.notPrefix).toBe(2);
        expect(s2.overCap).toBe(1);
    });

    it('counts the distinct stable prefixes and whether free equals member', () => {
        expect(summarizeSkills(CATALOG, goodSamples()).s3).toEqual({
            freeDistinct: 1,
            memberDistinct: 1,
            freeEqualsMember: true,
        });
        const sampled = [
            sample('c1', 'member', memberStable, ['G1']),
            sample('c1', 'free', ['Core A'], ['G1']),
            sample('c2', 'member', memberStable, ['G1']),
            sample('c2', 'free', ['Core B'], ['G1']),
        ];
        expect(summarizeSkills(CATALOG, sampled).s3).toEqual({
            freeDistinct: 2,
            memberDistinct: 1,
            freeEqualsMember: false,
        });
    });

    it('throws on no sample or on a case missing one of its tiers', () => {
        expect(() => summarizeSkills(CATALOG, [])).toThrow(
            'no prompt was rendered'
        );
        expect(() =>
            summarizeSkills(CATALOG, [sample('c1', 'free', [], [])])
        ).toThrow('every case needs a free and a member prompt');
        expect(() =>
            summarizeSkills(CATALOG, [
                sample('c1', 'free', [], []),
                sample('c2', 'member', [], []),
            ])
        ).toThrow('every case needs a free and a member prompt');
    });

    it('gives one row per prompt with its skills in order of appearance', () => {
        const rows = skillRows(CATALOG, goodSamples());
        expect(rows).toHaveLength(4);
        expect(rows[1]).toMatchObject({
            caseId: 'c1',
            tier: 'free',
            skills: ['Core A', 'Core B', 'G1', 'G2', 'G3', 'S1'],
        });
    });
});

describe('skillsGates', () => {
    const memberStable = ['Core A', 'Core B'];
    const gatesOf = (
        samples: PromptSample[],
        live: Parameters<typeof skillsGates>[0]['live'] = null
    ) =>
        Object.fromEntries(
            skillsGates({
                summary: summarizeSkills(CATALOG, samples),
                live,
            }).map(g => [g.id, g.pass])
        );

    it('S1 to S3 pass when free carries every always-on skill, within the cap, with member prefix', () => {
        expect(
            gatesOf([
                sample('c1', 'member', memberStable, ['G1', 'G2']),
                sample('c1', 'free', memberStable, ['G1', 'G2']),
            ])
        ).toEqual({ S1: true, S2: true, S3: true });
    });

    it('S1 fails when one free prompt lacks an always-on skill', () => {
        const gates = gatesOf([
            sample('c1', 'member', memberStable, ['G1']),
            sample('c1', 'free', ['Core A'], ['G1']),
        ]);
        expect(gates.S1).toBe(false);
        expect(gates.S3).toBe(false);
    });

    it('S2 is undecided when no member prompt has a gated skill', () => {
        expect(
            gatesOf([
                sample('c1', 'member', memberStable, []),
                sample('c1', 'free', memberStable, []),
            ]).S2
        ).toBeNull();
    });

    it('S2 fails when free keeps more than the cap', () => {
        const gates = gatesOf([
            sample('c1', 'member', memberStable, ['G1', 'G2', 'G3', 'G4']),
            sample('c1', 'free', memberStable, ['G1', 'G2', 'G3', 'G4']),
        ]);
        expect(gates.S2).toBe(false);
        expect(C.gates.skillsFreeGatedPerGroup).toBe(3);
    });

    const calls = (over: Partial<RunCallStats> = {}): RunCallStats => ({
        n: 200,
        failed: share(2, 200),
        missingPlan: share(2, 200),
        unlabelled: share(2, 200),
        ungroundedPlan: share(2, 200),
        medianOutputTokens: 1000,
        medianInputTokens: 30000,
        medianUncachedInputTokens: 10000,
        medianLatencyMs: 30000,
        ...over,
    });
    const good = [
        sample('c1', 'member', memberStable, ['G1']),
        sample('c1', 'free', memberStable, ['G1']),
    ];
    const live = (
        after: Partial<RunCallStats>,
        overlapLow: number | null = 0.01
    ) => ({
        after: calls(after),
        before: calls(),
        overlap: {
            overlap: {
                before: { n: 10, mean: 0.5 },
                after: { n: 10, mean: 0.6 },
                diff: { n: 10, mean: 0.1, low: overlapLow, high: 0.2 },
            },
        },
        noiseFloor: 0,
    });

    it('has no S5 or S6 without a run pair', () => {
        expect(Object.keys(gatesOf(good))).toEqual(['S1', 'S2', 'S3']);
    });

    it('S5 bounds uncached input at 1.5x and latency at +20%', () => {
        expect(
            gatesOf(good, live({ medianUncachedInputTokens: 15000 })).S5
        ).toBe(true);
        expect(
            gatesOf(good, live({ medianUncachedInputTokens: 15001 })).S5
        ).toBe(false);
        expect(gatesOf(good, live({ medianLatencyMs: 36000 })).S5).toBe(true);
        expect(gatesOf(good, live({ medianLatencyMs: 36001 })).S5).toBe(false);
    });

    it('S5 allows 1 pp more failures and fails beyond, undecided without a baseline median', () => {
        expect(gatesOf(good, live({ failed: share(4, 200) })).S5).toBe(true);
        expect(gatesOf(good, live({ failed: share(5, 200) })).S5).toBe(false);
        expect(gatesOf(good, live({ missingPlan: share(5, 200) })).S5).toBe(
            false
        );
        expect(
            gatesOf(good, live({ medianUncachedInputTokens: null })).S5
        ).toBeNull();
    });

    it('S6 needs the 95% low of the overlap change at or above 0, and a computable one', () => {
        expect(gatesOf(good, live({}, 0)).S6).toBe(true);
        expect(gatesOf(good, live({}, -0.01)).S6).toBe(false);
        expect(gatesOf(good, live({}, null)).S6).toBeNull();
        expect(gatesOf(good, { ...live({}), overlap: null }).S6).toBeNull();
    });
});

describe('level overlap with member (S6)', () => {
    const levelCase = (
        caseId: string,
        levels: number[],
        atr: number | null = 2
    ): LevelCase => ({ caseId, repeat: 1, atr, levels });

    it('is the share of a run levels within 0.25 ATR of a member level, per case', () => {
        const near = 100 + C.levelOverlapAtr * 2;
        const perCase = levelOverlapPerCase(
            [levelCase('a', [100, near, near + 0.01, 200])],
            [levelCase('a', [100])]
        );
        // 100 and the level exactly 0.25 ATR away match; one just beyond and 200 do not
        expect(perCase.get('a#1')).toBe(0.5);
    });

    it('leaves out a case without a member counterpart, levels or a usable ATR', () => {
        const perCase = levelOverlapPerCase(
            [
                levelCase('no-member', [100]),
                levelCase('no-levels', []),
                levelCase('no-atr', [100], null),
                levelCase('zero-atr', [100], 0),
            ],
            [
                levelCase('no-levels', [100]),
                levelCase('no-atr', [100]),
                levelCase('zero-atr', [100]),
            ]
        );
        expect(perCase.size).toBe(0);
    });

    it('compares two runs over the cases both have', () => {
        const after = new Map([
            ['a#1', 1],
            ['b#1', 0.5],
        ]);
        const before = new Map([
            ['a#1', 0.5],
            ['c#1', 0],
        ]);
        const { overlap } = compareLevelOverlap(after, before);
        expect(overlap.diff.n).toBe(1);
        expect(overlap.diff.mean).toBe(0.5);
        expect(overlap.before).toEqual({ n: 1, mean: 0.5 });
        expect(overlap.after).toEqual({ n: 1, mean: 1 });
    });
});
