import type { Bar, ElliottStructure } from '@/domain/types';
import { calculateATR } from '@/domain/indicators/atr';

/**
 * Deterministic synthetic charts for the Elliott structure gate. Each sample is a textbook pivot ladder (sizes and
 * durations randomised from a seeded PRNG), linearly interpolated bar by
 * bar, with Gaussian close noise σ = k·ATR and random wicks, framed by
 * zero-drift random-walk padding so the structure sits mid-chart or is cut
 * inside its last leg at the right edge (in progress).
 *
 * Prices are in an abstract unit `u`; the walk step and wicks put the
 * measured ATR at roughly 1–1.3 u, so a 1.5-ATR pivot is ≈ 1.5–2 u and
 * every template leg is kept ≥ MIN_LEG_U.
 */

/** Synthetic sample families; several (the A–B–C types) share one structure. */
export type SampleKind =
    | 'impulse'
    | 'impulse_abc'
    | 'zigzag'
    | 'flat_regular'
    | 'flat_expanded'
    | 'flat_running'
    | 'triangle'
    | 'diagonal'
    | 'combination'
    | 'combination3';

export const SAMPLE_STRUCTURE: Readonly<Record<SampleKind, ElliottStructure>> =
    {
        impulse: 'impulse',
        impulse_abc: 'impulse',
        zigzag: 'abc',
        flat_regular: 'abc',
        flat_expanded: 'abc',
        flat_running: 'abc',
        triangle: 'triangle',
        diagonal: 'diagonal',
        combination: 'combination',
        combination3: 'combination',
    };

/** The A–B–C type each A–B–C sample family is built as. */
export const SAMPLE_ABC_TYPE: Partial<Record<SampleKind, string>> = {
    zigzag: 'zigzag',
    flat_regular: 'regular flat',
    flat_expanded: 'expanded flat',
    flat_running: 'running flat',
};

export interface Sample {
    kind: SampleKind;
    bars: Bar[];
    /** Production ATR: last Wilder ATR of the (noisy) bars. */
    atr: number;
    /** Bar indices of the drawn anchors: start pivot + every labelled pivot. */
    truth: number[];
    /** Bar indices of every structure pivot, internal ones included. */
    pivots: number[];
    /** Cut inside its last leg: the last `truth` index is the right edge. */
    inProgress: boolean;
}

/** Bars per chart; the builder only reads the last SCREEN_LOOKBACK_BARS (120). */
export const CHART_BARS = 160;
const WINDOW_BARS = 120;
const BASE_PRICE = 300;
const WALK_STEP_U = 0.9;
const WICK_U = 0.35;
const MIN_LEG_U = 3;

export type Rng = () => number;

/** mulberry32 — small, fast, deterministic. */
export function makeRng(seed: number): Rng {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const uniform = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();
const intIn = (rng: Rng, lo: number, hi: number) =>
    Math.floor(uniform(rng, lo, hi + 1));
function gauss(rng: Rng): number {
    const u = Math.max(rng(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

interface Template {
    /** Pivot prices (u), first = 0, first leg pointing up. */
    prices: number[];
    /** Bars per leg (prices.length − 1 entries). */
    durations: number[];
    /** Positions in `prices` of the drawn anchors. */
    anchors: number[];
}

/**
 * u per bar a leg may move. Above ≈ 0.75 ATR a lone trend bar's range nears
 * the 1.5-ATR reversal and the zigzag splits the leg — real trend bars move
 * well under that.
 */
const MAX_SPEED_U = 1.0;
/** Longest structure, so lead-in + structure + reversal fit the 120-bar window. */
const MAX_STRUCTURE_BARS = 100;

const fromLegs = (legs: readonly number[]) =>
    legs.reduce<number[]>((acc, l) => [...acc, acc[acc.length - 1] + l], [0]);
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const legsOf = (prices: readonly number[]) =>
    prices.slice(1).map((p, i) => p - prices[i]);

/** Template from signed legs; each leg's bars follow a random speed in [lo, hi] u/bar. */
function fromSpeed(
    legs: readonly number[],
    anchors: number[],
    rng: Rng,
    [lo, hi]: [number, number]
): Template {
    return {
        prices: fromLegs(legs),
        durations: legs.map(l =>
            Math.max(3, Math.round(Math.abs(l) / uniform(rng, lo, hi)))
        ),
        anchors,
    };
}

/** A–B–C leg multipliers (B and C as multiples of A) per type. */
function abcRatios(type: string, rng: Rng): [number, number] {
    if (type === 'zigzag')
        return [uniform(rng, 0.38, 0.6), uniform(rng, 0.9, 1.5)];
    if (type === 'regular flat') {
        const b = uniform(rng, 0.92, 1.02);
        return [b, b + uniform(rng, 0, 0.12)];
    }
    const b = uniform(rng, 1.12, 1.35);
    return type === 'expanded flat'
        ? [b, b + uniform(rng, 0.2, 0.55)]
        : [b, b - uniform(rng, 0.2, 0.45)];
}

/** Legs (signed, first up) of one A–B–C sized by A, or by its net move. */
function abcLegs(
    type: string,
    rng: Rng,
    size: { a: number } | { net: number }
): number[] {
    const [b, c] = abcRatios(type, rng);
    const a = 'a' in size ? size.a : size.net / (1 - b + c);
    return [a, -b * a, c * a];
}

function impulseLegs(rng: Rng, scale: number): number[] {
    const w1 = uniform(rng, 7, 11) * scale;
    const w3 = w1 * uniform(rng, 1.3, 2.0);
    return [
        w1,
        -w1 * uniform(rng, 0.4, 0.7),
        w3,
        -w3 * uniform(rng, 0.25, 0.4),
        w1 * uniform(rng, 0.7, 1.2),
    ];
}

/** Contracting triangle between two converging lines (A–C and B–D), first leg down. */
function triangleTemplate(rng: Rng): Template {
    const d = range(5).map(() => intIn(rng, 9, 17));
    const t = fromLegs(d);
    const apex = t[5] + uniform(rng, 0.3, 1.0) * (t[5] - t[1]);
    const w1 = uniform(rng, 8, 12);
    const width = (x: number) => (w1 * (apex - x)) / (apex - t[1]);
    // tilt −1..1: −1 flat upper line (ascending triangle), +1 flat lower line.
    const tilt = uniform(rng, -0.9, 0.9);
    const k = w1 / (apex - t[1]);
    const lower = (x: number) => ((1 - tilt) / 2) * k * (x - t[1]);
    const upper = (x: number) => lower(x) + width(x);
    const raw = [
        upper(t[0]) + uniform(rng, 0.15, 0.5) * w1,
        lower(t[1]),
        upper(t[2]),
        lower(t[3]),
        upper(t[4]),
        lower(t[5]) + uniform(rng, 0, 0.25) * width(t[5]),
    ];
    // Mirrored so the first leg points up like every other template.
    return {
        prices: raw.map(p => raw[0] - p),
        durations: d,
        anchors: range(6),
    };
}

/** Contracting wedge: 0-2-4 on the steeper lower line, 1-3-5 on the upper one. */
function diagonalTemplate(rng: Rng): Template {
    const d = range(5).map(() => intIn(rng, 9, 15));
    const t = fromLegs(d);
    const apex = t[5] + uniform(rng, 0.2, 0.8) * t[5];
    const w0 = uniform(rng, 8, 12);
    const sUpper = uniform(rng, 0.03, 0.15);
    const lower = (x: number) => (sUpper + w0 / apex) * x;
    const upper = (x: number) => w0 + sUpper * x;
    const prices = t.map((x, i) =>
        i % 2 === 0
            ? lower(x)
            : upper(x) + (i === 5 ? uniform(rng, -0.5, 0.5) : 0)
    );
    return { prices, durations: d, anchors: range(6) };
}

const COMBINATION_SIMPLE_TYPES = ['zigzag', 'regular flat'] as const;
/** W–X–Y (2 simples) or W–X–Y–X–Z (3): each simple a zigzag or regular flat. */
function combinationLegs(rng: Rng, simples: number, net0: number): number[] {
    return range(simples).flatMap(i => {
        const type = COMBINATION_SIMPLE_TYPES[intIn(rng, 0, 1)];
        const net = i === 0 ? net0 : net0 * uniform(rng, 0.75, 1.3);
        const x = i === 0 ? [] : [-net0 * uniform(rng, 0.4, 0.75)];
        return [...x, ...abcLegs(type, rng, { net })];
    });
}

function template(kind: SampleKind, rng: Rng): Template {
    switch (kind) {
        case 'impulse':
            return fromSpeed(impulseLegs(rng, 1), range(6), rng, [0.5, 0.9]);
        case 'impulse_abc': {
            const legs = impulseLegs(rng, 0.8);
            const abc = abcLegs('zigzag', rng, {
                a: legs[4] * uniform(rng, 0.8, 1.3),
            }).map(l => -l);
            return fromSpeed([...legs, ...abc], range(9), rng, [0.6, 0.95]);
        }
        case 'triangle':
            return triangleTemplate(rng);
        case 'diagonal':
            return diagonalTemplate(rng);
        case 'combination':
            return fromSpeed(
                combinationLegs(rng, 2, uniform(rng, 10, 14)),
                [0, 3, 4, 7],
                rng,
                [0.55, 0.95]
            );
        case 'combination3':
            return fromSpeed(
                combinationLegs(rng, 3, uniform(rng, 9, 12)),
                [0, 3, 4, 7, 8, 11],
                rng,
                [0.75, 1.0]
            );
        default:
            return fromSpeed(
                abcLegs(SAMPLE_ABC_TYPE[kind] as string, rng, {
                    a: uniform(rng, 8, 12),
                }),
                range(4),
                rng,
                [0.5, 0.9]
            );
    }
}

/** Shape validity (rejection sampling): legs drawable at this ATR, fits the window, kind rules. */
function templateOk(kind: SampleKind, t: Template): boolean {
    const p = t.prices;
    const legs = legsOf(p);
    const w = legs.map(Math.abs);
    if (
        w.some((l, i) => l < MIN_LEG_U || l / t.durations[i] > MAX_SPEED_U) ||
        t.durations.reduce((a, b) => a + b, 0) > MAX_STRUCTURE_BARS
    )
        return false;
    if (kind === 'impulse' || kind === 'impulse_abc')
        return p[4] > p[1] + 1 && p[2] > p[0] + 1;
    if (kind === 'triangle') return w.every((l, i) => i === 0 || l < w[i - 1]);
    if (kind === 'diagonal')
        return (
            p[4] < p[1] - 0.5 &&
            p[2] > p[0] &&
            p[3] > p[1] &&
            p[5] > p[3] &&
            w[2] < w[0] &&
            w[4] < w[2]
        );
    return true;
}

function walk(rng: Rng, n: number, from: number): number[] {
    const out: number[] = [];
    let x = from;
    for (let i = 0; i < n; i++) {
        x += WALK_STEP_U * gauss(rng);
        out.push(x);
    }
    return out;
}

/** Linear path through `prices` with `durations` bars per leg (prices[0] at index 0). */
function interpolate(prices: readonly number[], durations: readonly number[]) {
    const out = [prices[0]];
    durations.forEach((d, i) => {
        for (let k = 1; k <= d; k++)
            out.push(prices[i] + ((prices[i + 1] - prices[i]) * k) / d);
    });
    return out;
}

function toBars(
    closes: readonly number[],
    wicks: readonly [number, number][]
): Bar[] {
    return closes.map((c, i) => {
        const o = i === 0 ? c : closes[i - 1];
        return {
            time: i,
            open: BASE_PRICE + o,
            high: BASE_PRICE + Math.max(o, c) + wicks[i][0],
            low: BASE_PRICE + Math.min(o, c) - wicks[i][1],
            close: BASE_PRICE + c,
            volume: 1000,
        };
    });
}

const lastAtr = (bars: readonly Bar[]) =>
    calculateATR([...bars]).findLast(v => v !== null) ?? 0;

/** Wicks, then σ = k·ATR(noise-free bars) close noise, then production ATR. */
function finish(
    closes: readonly number[],
    noiseK: number,
    rng: Rng
): { bars: Bar[]; atr: number } {
    const wicks = closes.map(
        () =>
            [Math.abs(gauss(rng)) * WICK_U, Math.abs(gauss(rng)) * WICK_U] as [
                number,
                number,
            ]
    );
    const sigma = noiseK * lastAtr(toBars(closes, wicks));
    const bars = toBars(
        closes.map(c => c + sigma * gauss(rng)),
        wicks
    );
    return { bars, atr: lastAtr(bars) };
}

/**
 * One sample of `kind`. `inProgress` cuts the structure at 50–90% of its
 * last leg at the right edge; otherwise a reversal leg confirms the last
 * pivot and a random walk follows.
 */
export function makeSample(
    kind: SampleKind,
    noiseK: number,
    inProgress: boolean,
    rng: Rng
): Sample {
    let t = template(kind, rng);
    while (!templateOk(kind, t)) t = template(kind, rng);
    const flip = rng() < 0.5 ? -1 : 1;
    const struct = t.prices.map(p => p * flip);
    const durations = [...t.durations];
    const leadDir = Math.sign(struct[1] - struct[0]);
    // A correction corrects something: A–B–C and combination samples follow
    // a prior trend leg 1.2–2× their first leg. Other templates get a short
    // 3–6 u lead-in that only makes wave 0 a turning point.
    const corrective =
        SAMPLE_STRUCTURE[kind] === 'abc' ||
        SAMPLE_STRUCTURE[kind] === 'combination';
    const leadSize = corrective
        ? Math.abs(struct[1] - struct[0]) * uniform(rng, 1.2, 2)
        : uniform(rng, 3, 6);
    const lead = leadDir * leadSize;
    const leadBars = corrective
        ? Math.max(3, Math.round(leadSize / uniform(rng, 0.5, 0.9)))
        : intIn(rng, 5, 9);
    if (inProgress) {
        const last = struct.length - 1;
        const f = uniform(rng, 0.5, 0.9);
        struct[last] = struct[last - 1] + (struct[last] - struct[last - 1]) * f;
        durations[last - 1] = Math.max(1, Math.round(durations[last - 1] * f));
    }
    const tail: number[] = [];
    const tailDur: number[] = [];
    if (!inProgress) {
        const lastLeg = struct[struct.length - 1] - struct[struct.length - 2];
        tail.push(
            struct[struct.length - 1] - Math.sign(lastLeg) * uniform(rng, 3, 6)
        );
        tailDur.push(intIn(rng, 4, 8));
    }
    const core = interpolate(
        [lead, ...struct, ...tail],
        [leadBars, ...durations, ...tailDur]
    );
    const after = inProgress
        ? 0
        : Math.min(intIn(rng, 2, 25), Math.max(0, WINDOW_BARS - core.length));
    const before = CHART_BARS - core.length - after;
    const head = walk(rng, before, 0).reverse();
    const shift = lead - (head.length > 0 ? head[head.length - 1] : lead);
    const closes = [
        ...head.map(h => h + shift),
        ...core,
        ...walk(rng, after, core[core.length - 1]),
    ];
    const offset = before + leadBars;
    const pivotIdx = fromLegs(durations).map(i => i + offset);
    const truth = t.anchors.map(a => pivotIdx[a]);
    const { bars, atr } = finish(closes, noiseK, rng);
    return {
        kind,
        bars,
        atr,
        truth: inProgress ? [...truth.slice(0, -1), bars.length - 1] : truth,
        pivots: pivotIdx,
        inProgress,
    };
}

/** Zero-drift random walk of CHART_BARS bars (the false-positive control). */
export function makeRandomWalk(rng: Rng): { bars: Bar[]; atr: number } {
    return finish(walk(rng, CHART_BARS, 0), 0, rng);
}
