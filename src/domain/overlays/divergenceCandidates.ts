import type {
    Bar,
    OverlayCandidate,
    OverlayFormat,
    RsiDivergenceKind,
} from '@/domain/types';
import { findRegularDivergencePair } from '@/domain/signals/anticipation';
import { formatOverlayPoint } from '@/domain/overlays/format';

const KINDS: readonly RsiDivergenceKind[] = ['bullish', 'bearish'];

/**
 * @internal
 * RSI regular divergences as drawable candidates (spec 2026-09-28 §3.3) — only
 * when the same rule that fires `rsi_*_divergence` fires, so the divergence
 * skill's gate and the candidate list always agree.
 */
export function buildDivergenceCandidates(
    bars: readonly Bar[],
    rsi: readonly (number | null)[],
    fmt: OverlayFormat
): OverlayCandidate[] {
    return KINDS.flatMap(kind => {
        const pair = findRegularDivergencePair(bars, rsi, kind);
        if (!pair) return [];
        const r1 = rsi[pair.first];
        const r2 = rsi[pair.second];
        if (r1 == null || r2 == null) return [];
        const priceOf = (i: number) =>
            kind === 'bullish' ? bars[i].low : bars[i].high;
        const from = {
            time: bars[pair.first].time,
            price: priceOf(pair.first),
        };
        const to = {
            time: bars[pair.second].time,
            price: priceOf(pair.second),
        };
        return [
            {
                id: `div:rsi_${kind}:${to.time}`,
                kind: 'divergence' as const,
                skill: 'divergence',
                promptLine: `RSI ${kind} divergence: price ${formatOverlayPoint(from, fmt)} → ${formatOverlayPoint(to, fmt)}, RSI ${r1.toFixed(1)} → ${r2.toFixed(1)}`,
                segments: [
                    {
                        from,
                        to,
                        role: 'price',
                        style: 'solid' as const,
                        pane: 'price' as const,
                    },
                    {
                        from: { time: from.time, price: r1 },
                        to: { time: to.time, price: r2 },
                        role: 'rsi',
                        style: 'solid' as const,
                        pane: 'rsi' as const,
                    },
                ],
                levels: [],
                labels: [],
            },
        ];
    });
}
