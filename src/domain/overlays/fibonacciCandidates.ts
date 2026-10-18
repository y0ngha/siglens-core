import type {
    AbcExtensionProjection,
    Bar,
    FibonacciProjection,
    HorizonKey,
    MarketReference,
    OverlayCandidate,
    OverlayFormat,
} from '@/domain/types';
import { formatFibRatio } from '@/domain/analysis/marketReference';
import {
    buildExtensions,
    buildRetracements,
    isBrokenAbcExtension,
    isBrokenFibLeg,
} from '@/domain/analysis/fibLevels';
import {
    FIB_ABC_OVERLAY_RATIOS,
    FIB_CANDIDATE_LIMIT,
    FIB_OVERLAY_RATIOS,
} from '@/domain/overlays/constants';
import { formatOverlayPoint } from '@/domain/overlays/format';

const HORIZONS: readonly HorizonKey[] = ['short', 'medium', 'long'];

function legCandidate(
    key: HorizonKey,
    fib: FibonacciProjection,
    bars: readonly Bar[],
    fmt: OverlayFormat
): OverlayCandidate {
    const [startIndex, endIndex] =
        fib.lowIndex < fib.highIndex
            ? [fib.lowIndex, fib.highIndex]
            : [fib.highIndex, fib.lowIndex];
    const priceAt = (i: number) => (i === fib.lowIndex ? fib.low : fib.high);
    const from = { time: bars[startIndex].time, price: priceAt(startIndex) };
    const to = { time: bars[endIndex].time, price: priceAt(endIndex) };
    // Reuse fibLevels.ts's own formulas so a drawn level always equals the `Fib table:` row.
    const retracementByRatio = new Map(
        buildRetracements(fib.high, fib.low, fib.direction).map(l => [
            l.ratio,
            l.price,
        ])
    );
    const extensionByRatio = new Map(
        buildExtensions(fib.high, fib.low, fib.direction).map(l => [
            l.ratio,
            l.price,
        ])
    );
    // Retracements are measured from the leg's end, extensions from its start
    // (fibLevels.ts), so one bare-percent ladder would read out of order on the
    // chart (23.6% then 127.2% on the same side). Extensions carry the `ext`
    // prefix the `Fib table:` line already uses.
    const levels = FIB_OVERLAY_RATIOS.flatMap(ratio => {
        const retracement = retracementByRatio.get(ratio);
        const price = retracement ?? extensionByRatio.get(ratio);
        if (price === undefined) return [];
        const percent = formatFibRatio(ratio);
        const label = retracement === undefined ? `ext ${percent}` : percent;
        return [{ price, fromTime: to.time, label }];
    });
    return {
        id: `fib:${key}:${to.time}`,
        kind: 'fibonacci',
        skill: 'fibonacci-retracement',
        promptLine: `${key} leg ${fib.direction} ${formatOverlayPoint(from, fmt)} → ${formatOverlayPoint(to, fmt)}`,
        segments: [
            { from, to, role: 'anchor', style: 'dashed', pane: 'price' },
        ],
        levels,
        labels: [],
    };
}

function abcCandidate(
    abc: AbcExtensionProjection,
    bars: readonly Bar[],
    fmt: OverlayFormat
): OverlayCandidate {
    const a = { time: bars[abc.aIndex].time, price: abc.a };
    const b = { time: bars[abc.bIndex].time, price: abc.b };
    const c = { time: bars[abc.cIndex].time, price: abc.c };
    // Reuse abc.extensions' own prices (rather than re-deriving from ratio/range)
    // so a drawn level always equals the analysis's own ABC extension table.
    const extensionByRatio = new Map(
        abc.extensions.map(l => [l.ratio, l.price])
    );
    const levels = FIB_ABC_OVERLAY_RATIOS.flatMap(ratio => {
        const price = extensionByRatio.get(ratio);
        return price === undefined
            ? []
            : [
                  {
                      price,
                      fromTime: c.time,
                      label: `ABC ${formatFibRatio(ratio)}`,
                  },
              ];
    });
    return {
        id: `fib:abc:${c.time}`,
        kind: 'fibonacci',
        skill: 'fibonacci-extension',
        promptLine: `ABC ${abc.direction}: A ${formatOverlayPoint(a, fmt)}, B ${formatOverlayPoint(b, fmt)}, C ${formatOverlayPoint(c, fmt)}`,
        segments: [
            { from: a, to: b, role: 'anchor', style: 'dashed', pane: 'price' },
            { from: b, to: c, role: 'anchor', style: 'dashed', pane: 'price' },
        ],
        levels,
        labels: [
            {
                at: a,
                text: 'A',
                position: abc.direction === 'up' ? 'below' : 'above',
            },
            {
                at: b,
                text: 'B',
                position: abc.direction === 'up' ? 'above' : 'below',
            },
            {
                at: c,
                text: 'C',
                position: abc.direction === 'up' ? 'below' : 'above',
            },
        ],
    };
}

/**
 * @internal
 * Horizon fib legs (deduped by anchor pair) plus the first ABC projection
 * (spec 2026-09-28 §3.4). Level prices use the same formulas as
 * `fibLevels.ts` so the drawn lines equal the `Fib table:` rows.
 *
 * A leg or ABC the price has already closed through (`isBrokenFibLeg`,
 * `isBrokenAbcExtension`) is not offered: drawn, its pullback levels and
 * extension targets read as live levels on a structure that already failed.
 * The prompt keeps such a leg's anchor line with its `(leg fully retraced)`
 * note, so the model still knows it.
 */
export function buildFibonacciCandidates(
    ref: MarketReference,
    bars: readonly Bar[],
    fmt: OverlayFormat
): OverlayCandidate[] {
    const seenLegs = new Set<string>();
    const legs = HORIZONS.flatMap(key => {
        const fib = ref[key].fibProjection;
        if (!fib || isBrokenFibLeg(fib, bars)) return [];
        const legKey = `${fib.lowIndex}-${fib.highIndex}`;
        if (seenLegs.has(legKey)) return [];
        seenLegs.add(legKey);
        return [legCandidate(key, fib, bars, fmt)];
    });
    const abc = HORIZONS.map(key => ref[key].abcExtension).find(
        x => x != null && !isBrokenAbcExtension(x, bars)
    );
    return [...legs, ...(abc ? [abcCandidate(abc, bars, fmt)] : [])].slice(
        0,
        FIB_CANDIDATE_LIMIT
    );
}
