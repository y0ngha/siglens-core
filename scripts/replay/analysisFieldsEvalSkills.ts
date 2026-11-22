/**
 * Pure parts of the `skills` mode: which technical skills reach a rendered prompt for each
 * tier, read off the prompt text, and the gates that follow (WP-15 §7.3 S1 to S3, and the
 * live S5 and S6 when runs are given).
 *
 * "Reaches the prompt" is decided by the digest's heading in the text, not by asking the
 * selector: the evaluation checks what the model is sent. The catalog supplies only each
 * skill's name, injection group and whether its gate is always-on.
 */
import {
    EPS,
    FIELDS_EVAL_CONSTANTS as C,
    type GateResult,
    type Interval,
    type Share,
} from './analysisFieldsEvalTypes';
import {
    groupBy,
    intervalOf,
    quantilesOf,
    share,
    type Quantiles,
} from './analysisFieldsEvalCompute';
import type { RunCallStats } from './analysisFieldsEvalPlan';
import type { IndicatorGuideResult, RawStrategyResult } from '@/domain/types';

export type SkillTier = 'free' | 'member';
export const SKILL_TIERS: readonly SkillTier[] = ['free', 'member'];

export interface CatalogSkill {
    name: string;
    /** Injection group: `type ?? category ?? 'regular'`. */
    group: string;
    alwaysOn: boolean;
    /** `false` for a skill the prompt never carries as a digest (the SMC full guide). */
    injected: boolean;
    /** The signal and candle ids that select a gated skill (`gating.triggers`). */
    triggers?: readonly string[];
    /** The `computed_card` kind of a card-producing skill (WP-16); absent on an untagged skill. */
    computedCard?: string;
}

export interface PromptSample {
    caseId: string;
    tier: SkillTier;
    stable: string;
    dynamic: string;
    /**
     * The computed cards the assembled prompt record carries (`indicatorCards`, `cycleCards`),
     * absent or `null` for a prompt that came without them.
     */
    cards?: {
        indicator: readonly IndicatorGuideResult[];
        cycle: readonly RawStrategyResult[];
    } | null;
}

/** Index of a skill's digest heading in `text`, or `-1`. */
export function digestPosition(text: string, name: string): number {
    const spaced = text.indexOf(`### ${name} `);
    return spaced >= 0 ? spaced : text.indexOf(`### ${name}\n`);
}

interface PromptReading {
    caseId: string;
    tier: SkillTier;
    /** Injected catalog skills present, in order of appearance. */
    present: readonly CatalogSkill[];
    stableChars: number;
    dynamicChars: number;
    stable: string;
}

function readPrompt(
    sample: PromptSample,
    catalog: readonly CatalogSkill[]
): PromptReading {
    const text = `${sample.stable}\n${sample.dynamic}`;
    const found = catalog
        .filter(skill => skill.injected)
        .map(skill => ({ skill, at: digestPosition(text, skill.name) }))
        .filter(({ at }) => at >= 0)
        .toSorted((a, b) => a.at - b.at);
    return {
        caseId: sample.caseId,
        tier: sample.tier,
        present: found.map(f => f.skill),
        stableChars: sample.stable.length,
        dynamicChars: sample.dynamic.length,
        stable: sample.stable,
    };
}

/** One line per rendered prompt: the skills it carries, in order, and its sizes. */
export function skillRows(
    catalog: readonly CatalogSkill[],
    samples: readonly PromptSample[]
): readonly {
    caseId: string;
    tier: SkillTier;
    skills: readonly string[];
    stableChars: number;
    dynamicChars: number;
}[] {
    return samples.map(sample => {
        const reading = readPrompt(sample, catalog);
        return {
            caseId: reading.caseId,
            tier: reading.tier,
            skills: reading.present.map(s => s.name),
            stableChars: reading.stableChars,
            dynamicChars: reading.dynamicChars,
        };
    });
}

export interface TierSkillStats {
    n: number;
    skillsPerPrompt: Quantiles;
    alwaysOnPerPrompt: Quantiles;
    gatedPerPrompt: Quantiles;
    gatedByGroup: Record<string, Quantiles & { max: number }>;
    /** Prompts carrying each always-on skill. */
    alwaysOnCoverage: Record<string, Share>;
    stableChars: Quantiles;
    dynamicChars: Quantiles;
    distinctStablePrefixes: number;
    totalGated: number;
}

export interface SkillsSummary {
    catalog: {
        technical: number;
        alwaysOn: readonly string[];
        injectedAlwaysOn: readonly string[];
        gated: number;
        groups: readonly string[];
    };
    cases: number;
    tiers: Record<SkillTier, TierSkillStats>;
    /** Free's fired gated skills as a share of member's (the quantity WP-15 §1 measures on main). */
    freeGatedShareOfMember: number | null;
    s2: {
        /** Cases where every group's free gated skills are the first of member's order, within the cap. */
        ok: Share;
        overCap: number;
        notPrefix: number;
    };
    s3: {
        freeDistinct: number;
        memberDistinct: number;
        freeEqualsMember: boolean;
    };
}

function tierStats(
    readings: readonly PromptReading[],
    catalog: readonly CatalogSkill[]
): TierSkillStats {
    const groups = [...new Set(catalog.map(s => s.group))].toSorted();
    const alwaysOn = catalog.filter(s => s.alwaysOn && s.injected);
    const gatedOf = (r: PromptReading) => r.present.filter(s => !s.alwaysOn);
    return {
        n: readings.length,
        skillsPerPrompt: quantilesOf(readings.map(r => r.present.length)),
        alwaysOnPerPrompt: quantilesOf(
            readings.map(r => r.present.filter(s => s.alwaysOn).length)
        ),
        gatedPerPrompt: quantilesOf(readings.map(r => gatedOf(r).length)),
        gatedByGroup: Object.fromEntries(
            groups.map(group => {
                const counts = readings.map(
                    r => gatedOf(r).filter(s => s.group === group).length
                );
                return [
                    group,
                    { ...quantilesOf(counts), max: Math.max(0, ...counts) },
                ];
            })
        ),
        alwaysOnCoverage: Object.fromEntries(
            alwaysOn.map(skill => [
                skill.name,
                share(
                    readings.filter(r =>
                        r.present.some(p => p.name === skill.name)
                    ).length,
                    readings.length
                ),
            ])
        ),
        stableChars: quantilesOf(readings.map(r => r.stableChars)),
        dynamicChars: quantilesOf(readings.map(r => r.dynamicChars)),
        distinctStablePrefixes: new Set(readings.map(r => r.stable)).size,
        totalGated: readings.reduce((sum, r) => sum + gatedOf(r).length, 0),
    };
}

/** `true` when the free gated skills of every group are the first of member's, within the cap. */
function freeFollowsMember(
    free: PromptReading,
    member: PromptReading
): { overCap: boolean; prefix: boolean } {
    const groupsOf = (r: PromptReading) =>
        groupBy(
            r.present.filter(s => !s.alwaysOn),
            s => s.group
        );
    const freeGroups = groupsOf(free);
    const memberGroups = groupsOf(member);
    const keys = new Set([...freeGroups.keys(), ...memberGroups.keys()]);
    const checks = [...keys].map(key => {
        const f = (freeGroups.get(key) ?? []).map(s => s.name);
        const m = (memberGroups.get(key) ?? []).map(s => s.name);
        const expected = m.slice(0, C.gates.skillsFreeGatedPerGroup);
        return {
            overCap: f.length > C.gates.skillsFreeGatedPerGroup,
            prefix:
                f.length === expected.length &&
                f.every(name => expected.includes(name)),
        };
    });
    return {
        overCap: checks.some(c => c.overCap),
        prefix: checks.every(c => c.prefix),
    };
}

/**
 * Reads every sample and summarises both tiers. Throws when a case lacks one of its two
 * tiers or when there is no sample at all: a measurement over a partial set is not one.
 */
export function summarizeSkills(
    catalog: readonly CatalogSkill[],
    samples: readonly PromptSample[]
): SkillsSummary {
    if (samples.length === 0) throw new Error('no prompt was rendered');
    const readings = samples.map(s => readPrompt(s, catalog));
    const byTier = (tier: SkillTier) => readings.filter(r => r.tier === tier);
    const free = byTier('free');
    const member = byTier('member');
    const memberById = new Map(member.map(r => [r.caseId, r]));
    const unpaired = free.filter(r => !memberById.has(r.caseId));
    if (unpaired.length > 0 || free.length !== member.length) {
        throw new Error(
            `every case needs a free and a member prompt (free ${free.length}, member ${member.length})`
        );
    }
    const follows = free.map(f => {
        const m = memberById.get(f.caseId);
        return m === undefined ? null : freeFollowsMember(f, m);
    });
    const gated = catalog.filter(s => !s.alwaysOn && s.injected);
    const stats = {
        free: tierStats(free, catalog),
        member: tierStats(member, catalog),
    };
    const freeStable = new Set(free.map(r => r.stable));
    const memberStable = new Set(member.map(r => r.stable));
    return {
        catalog: {
            technical: catalog.length,
            alwaysOn: catalog.filter(s => s.alwaysOn).map(s => s.name),
            injectedAlwaysOn: catalog
                .filter(s => s.alwaysOn && s.injected)
                .map(s => s.name),
            gated: gated.length,
            groups: [...new Set(catalog.map(s => s.group))].toSorted(),
        },
        cases: free.length,
        tiers: stats,
        freeGatedShareOfMember:
            stats.member.totalGated === 0
                ? null
                : stats.free.totalGated / stats.member.totalGated,
        s2: {
            ok: share(
                follows.filter(f => f !== null && !f.overCap && f.prefix)
                    .length,
                follows.length
            ),
            overCap: follows.filter(f => f?.overCap === true).length,
            notPrefix: follows.filter(f => f?.prefix === false).length,
        },
        s3: {
            freeDistinct: freeStable.size,
            memberDistinct: memberStable.size,
            freeEqualsMember:
                freeStable.size === 1 &&
                memberStable.size === 1 &&
                [...freeStable][0] === [...memberStable][0],
        },
    };
}

// ─── Live gates (S5, S6) ──────────────────────────────────────────────────────

/** One result's key levels, with the ATR to measure them in. */
export interface LevelCase {
    caseId: string;
    repeat: number;
    atr: number | null;
    levels: readonly number[];
}

export interface LevelOverlap {
    /** Cases of the run that have a member counterpart with levels and a usable ATR. */
    n: number;
    /** Mean share of the run's levels within the overlap distance of a member level. */
    mean: number | null;
}

const key = (c: { caseId: string; repeat: number }): string =>
    `${c.caseId}#${c.repeat}`;

function overlapShare(
    levels: readonly number[],
    memberLevels: readonly number[],
    atr: number
): number | null {
    return levels.length === 0 || memberLevels.length === 0
        ? null
        : levels.filter(level =>
              memberLevels.some(
                  m => Math.abs(level - m) <= C.levelOverlapAtr * atr
              )
          ).length / levels.length;
}

/** Share of a run's levels near a member level, per case (`atr` of the case's own bar). */
export function levelOverlapPerCase(
    run: readonly LevelCase[],
    member: readonly LevelCase[]
): Map<string, number> {
    const memberBy = new Map(member.map(c => [key(c), c]));
    return new Map(
        run.flatMap(c => {
            const m = memberBy.get(key(c));
            if (m === undefined || c.atr === null || !(c.atr > 0)) return [];
            const value = overlapShare(c.levels, m.levels, c.atr);
            return value === null ? [] : [[key(c), value] as const];
        })
    );
}

export interface LiveSkillsComparison {
    overlap: { before: LevelOverlap; after: LevelOverlap; diff: Interval };
}

export function compareLevelOverlap(
    after: ReadonlyMap<string, number>,
    before: ReadonlyMap<string, number>
): LiveSkillsComparison {
    const pairs = [...after.entries()].flatMap(([k, a]) => {
        const b = before.get(k);
        return b === undefined ? [] : [{ a, b }];
    });
    const mean = (values: readonly number[]): number | null =>
        values.length === 0
            ? null
            : values.reduce((s, v) => s + v, 0) / values.length;
    return {
        overlap: {
            before: { n: pairs.length, mean: mean(pairs.map(p => p.b)) },
            after: { n: pairs.length, mean: mean(pairs.map(p => p.a)) },
            diff: intervalOf(pairs.map(p => p.a - p.b)),
        },
    };
}

// ─── Skills gates ─────────────────────────────────────────────────────────────

const gate = (
    id: string,
    description: string,
    pass: boolean | null,
    value: number | string | null,
    threshold: string
): GateResult => ({ id, description, pass, value, threshold });

export interface SkillsGateInput {
    summary: SkillsSummary;
    live: {
        after: RunCallStats;
        before: RunCallStats;
        overlap: LiveSkillsComparison | null;
        noiseFloor: number;
    } | null;
}

const pct = (v: number | null): string =>
    v === null ? 'n/a' : `${(v * 100).toFixed(2)}%`;

/** S1 to S3, and S5 and S6 when a run pair was given (S4 is a unit test). */
export function skillsGates(input: SkillsGateInput): readonly GateResult[] {
    const g = C.gates;
    const { summary, live } = input;
    const coverage = Object.values(summary.tiers.free.alwaysOnCoverage);
    const minCoverage = Math.min(...coverage.map(c => c.share ?? 0));
    const base = [
        gate(
            'S1',
            'every injected always-on skill is in every free prompt',
            coverage.length === 0 ? null : minCoverage === 1,
            `lowest coverage ${pct(coverage.length === 0 ? null : minCoverage)} of ${coverage.length} skills`,
            '100%'
        ),
        gate(
            'S2',
            'free fired gated skills per group are within the cap and the first of member order',
            // With no gated skill in any member prompt the prefix property is vacuous.
            summary.s2.ok.n === 0 || summary.tiers.member.totalGated === 0
                ? null
                : summary.s2.ok.count === summary.s2.ok.n,
            `${summary.s2.ok.count}/${summary.s2.ok.n} (over cap ${summary.s2.overCap}, not a prefix ${summary.s2.notPrefix})`,
            `cap ${g.skillsFreeGatedPerGroup}, 100% of cases`
        ),
        gate(
            'S3',
            'one distinct free stable prefix, equal to member',
            summary.s3.freeDistinct === 1 && summary.s3.freeEqualsMember,
            `free ${summary.s3.freeDistinct} distinct, member ${summary.s3.memberDistinct} distinct, equal ${summary.s3.freeEqualsMember}`,
            'one prefix, equal'
        ),
    ];
    if (live === null) return base;
    const margin = Math.max(g.planSideEffectMinPp, live.noiseFloor);
    const diff = (a: Share, b: Share): number | null =>
        a.share === null || b.share === null ? null : a.share - b.share;
    const failed = diff(live.after.failed, live.before.failed);
    const missing = diff(live.after.missingPlan, live.before.missingPlan);
    const ratio = (a: number | null, b: number | null): number | null =>
        a === null || b === null || b === 0 ? null : a / b;
    const uncached = ratio(
        live.after.medianUncachedInputTokens,
        live.before.medianUncachedInputTokens
    );
    const latency = ratio(
        live.after.medianLatencyMs,
        live.before.medianLatencyMs
    );
    const overlapDiff = live.overlap?.overlap.diff ?? null;
    return [
        ...base,
        gate(
            'S5',
            'free failed and missing-plan rates, median uncached input tokens and median latency, after against before',
            failed === null ||
                missing === null ||
                uncached === null ||
                latency === null
                ? null
                : failed <= margin + EPS &&
                      missing <= margin + EPS &&
                      uncached <= g.skillsMaxUncachedInputGrowth &&
                      latency <= 1 + g.skillsMaxLatencyGrowth,
            `failed ${failed === null ? 'n/a' : `${(failed * 100).toFixed(2)} pp`}, missing plan ${missing === null ? 'n/a' : `${(missing * 100).toFixed(2)} pp`}, uncached input x${uncached === null ? 'n/a' : uncached.toFixed(2)}, latency x${latency === null ? 'n/a' : latency.toFixed(2)}`,
            `rates <= +${(margin * 100).toFixed(2)} pp, uncached <= x${g.skillsMaxUncachedInputGrowth}, latency <= x${1 + g.skillsMaxLatencyGrowth}`
        ),
        gate(
            'S6',
            'share of free levels within 0.25 ATR of a member level, paired, after minus before',
            overlapDiff === null || overlapDiff.low === null
                ? null
                : overlapDiff.low >= 0,
            overlapDiff === null
                ? null
                : `${pct(overlapDiff.mean)} (95% low ${pct(overlapDiff.low)}, n ${overlapDiff.n})`,
            '95% low >= 0'
        ),
    ];
}
