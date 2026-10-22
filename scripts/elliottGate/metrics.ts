import type { Bar, ElliottStructure, OverlayCandidate } from '@/domain/types';
import { EW_MIN_WAVE_BARS } from '@/domain/overlays/constants';
import {
    makeRandomWalk,
    makeRng,
    makeSample,
    SAMPLE_ABC_TYPE,
    SAMPLE_STRUCTURE,
    type Sample,
    type SampleKind,
} from './generator';

/**
 * Gate harness: per structure, recall, false
 * positives on zero-drift random walks, and confusion with other structures.
 */

export type BuildFn = (bars: readonly Bar[], atr: number) => OverlayCandidate[];

/** Structure of an elliott candidate, read off its id suffix. */
export function structureOf(id: string): ElliottStructure {
    if (id.endsWith(':tri')) return 'triangle';
    if (/:combo3?$/.test(id)) return 'combination';
    if (id.endsWith(':diag')) return 'diagonal';
    if (/^ew:(up|down):\d+:\d+(:abc)?$/.test(id)) return 'impulse';
    return 'abc';
}

/** Start point + every labelled point, as bar indices (sample bars use time = index). */
export const anchorsOf = (c: OverlayCandidate): number[] => [
    c.segments[0].from.time,
    ...c.labels.map(l => l.at.time),
];

const near = (a: number, b: number) => Math.abs(a - b) <= EW_MIN_WAVE_BARS;

/**
 * The candidate draws THIS structure: its anchors sit on the true anchors in
 * order. An in-progress sample may lack the last (still forming) anchor; a
 * longer count (an impulse with an A–B–C attached) only has its prefix compared.
 */
export function matchesTruth(c: OverlayCandidate, s: Sample): boolean {
    const a = anchorsOf(c);
    const need = s.inProgress ? s.truth.length - 1 : s.truth.length;
    if (a.length < need) return false;
    return s.truth
        .slice(0, Math.min(a.length, s.truth.length))
        .every((t, i) => near(a[i], t));
}

/** The candidate is drawn over the structure: ≥ min(4, its anchors) anchors on structure pivots. */
export function overlapsStructure(c: OverlayCandidate, s: Sample): boolean {
    const a = anchorsOf(c);
    const hits = a.filter(x => s.pivots.some(p => near(x, p))).length;
    return hits >= Math.min(4, a.length);
}

/** The A–B–C type named in a promptLine, if any. */
export const abcTypeOf = (promptLine: string): string | undefined =>
    /\b(zigzag|regular flat|expanded or running flat|expanded flat|running flat)\b/.exec(
        promptLine
    )?.[1];

/**
 * The named type is right: the built type, or — while C is still forming
 * short of A's end — `expanded or running flat` for either of those two.
 */
const typeIsRight = (
    named: string | undefined,
    built: string,
    forming: boolean
) =>
    named === built ||
    (forming &&
        named === 'expanded or running flat' &&
        (built === 'expanded flat' || built === 'running flat'));

export interface KindResult {
    kind: SampleKind;
    noise: number;
    n: number;
    /** Share of samples with a matching candidate of the right structure. */
    recall: number;
    /** Share whose first overlapping candidate is another structure. */
    confusion: number;
    confusedAs: Partial<Record<ElliottStructure, number>>;
    /** A–B–C families: share of recalled samples whose type text is right. */
    typeAccuracy?: number;
}

export function measureKind(
    build: BuildFn,
    kind: SampleKind,
    noise: number,
    n: number,
    seed: number
): KindResult {
    const rng = makeRng(seed);
    const expected = SAMPLE_STRUCTURE[kind];
    const wantType = SAMPLE_ABC_TYPE[kind];
    let hit = 0;
    let typed = 0;
    let confused = 0;
    const confusedAs: Partial<Record<ElliottStructure, number>> = {};
    for (let i = 0; i < n; i++) {
        const s = makeSample(kind, noise, i % 2 === 1, rng);
        const out = build(s.bars, s.atr);
        const match = out.find(
            c => structureOf(c.id) === expected && matchesTruth(c, s)
        );
        if (match) {
            hit++;
            if (
                wantType &&
                typeIsRight(abcTypeOf(match.promptLine), wantType, s.inProgress)
            )
                typed++;
        }
        const first = out.find(c => overlapsStructure(c, s));
        const firstKind = first && structureOf(first.id);
        if (firstKind && firstKind !== expected) {
            confused++;
            confusedAs[firstKind] = (confusedAs[firstKind] ?? 0) + 1;
        }
    }
    return {
        kind,
        noise,
        n,
        recall: hit / n,
        confusion: confused / n,
        confusedAs,
        typeAccuracy: wantType ? (hit > 0 ? typed / hit : 0) : undefined,
    };
}

/** Share of random walks offering at least one candidate of each structure. */
export function measureFalsePositives(
    build: BuildFn,
    n: number,
    seed: number
): Record<ElliottStructure, number> {
    const rng = makeRng(seed);
    const counts: Record<ElliottStructure, number> = {
        impulse: 0,
        diagonal: 0,
        triangle: 0,
        combination: 0,
        abc: 0,
    };
    for (let i = 0; i < n; i++) {
        const { bars, atr } = makeRandomWalk(rng);
        const seen = new Set(build(bars, atr).map(c => structureOf(c.id)));
        seen.forEach(k => counts[k]++);
    }
    return Object.fromEntries(
        Object.entries(counts).map(([k, v]) => [k, v / n])
    ) as Record<ElliottStructure, number>;
}

/** Spec gate thresholds. */
export const GATE = {
    recallLowNoise: 0.8,
    recallHighNoise: 0.6,
    maxFalsePositive: 0.05,
    maxConfusion: 0.1,
} as const;
export const NOISE_LEVELS = [0.1, 0.25] as const;

export const KINDS_BY_STRUCTURE: Readonly<
    Record<ElliottStructure, readonly SampleKind[]>
> = {
    impulse: ['impulse', 'impulse_abc'],
    abc: ['zigzag', 'flat_regular', 'flat_expanded', 'flat_running'],
    triangle: ['triangle'],
    diagonal: ['diagonal'],
    combination: ['combination', 'combination3'],
};

export interface StructureGate {
    structure: ElliottStructure;
    recall: Record<number, number>;
    confusion: Record<number, number>;
    falsePositive: number;
    passes: boolean;
    kinds: KindResult[];
}

/**
 * Splits `perStructure` samples (per noise level) evenly over a structure's
 * sample families, pools them and applies the gate. Seeds derive from `seed`
 * per structure × family × noise, so runs are reproducible.
 */
export function measureGate(
    build: BuildFn,
    perStructure: number,
    walks: number,
    seed: number
): StructureGate[] {
    const fp = measureFalsePositives(build, walks, seed);
    return (Object.keys(KINDS_BY_STRUCTURE) as ElliottStructure[]).map(
        (structure, si) => {
            const families = KINDS_BY_STRUCTURE[structure];
            const perKind = Math.ceil(perStructure / families.length);
            const kinds = families.flatMap((kind, ki) =>
                NOISE_LEVELS.map((noise, ni) =>
                    measureKind(
                        build,
                        kind,
                        noise,
                        perKind,
                        seed + 10000 * (si + 1) + 1000 * ki + 100 * ni
                    )
                )
            );
            const pooled = (noise: number, f: (k: KindResult) => number) => {
                const at = kinds.filter(k => k.noise === noise);
                return at.reduce((s, k) => s + f(k), 0) / at.length;
            };
            const recall = Object.fromEntries(
                NOISE_LEVELS.map(nz => [nz, pooled(nz, k => k.recall)])
            );
            const confusion = Object.fromEntries(
                NOISE_LEVELS.map(nz => [nz, pooled(nz, k => k.confusion)])
            );
            const passes =
                recall[0.1] >= GATE.recallLowNoise &&
                recall[0.25] >= GATE.recallHighNoise &&
                fp[structure] <= GATE.maxFalsePositive &&
                NOISE_LEVELS.every(nz => confusion[nz] <= GATE.maxConfusion);
            return {
                structure,
                recall,
                confusion,
                falsePositive: fp[structure],
                passes,
                kinds,
            };
        }
    );
}
