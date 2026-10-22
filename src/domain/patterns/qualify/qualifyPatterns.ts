import type {
    Bar,
    ChartPatternId,
    PatternCandidate,
    PatternQualification,
    QualifiedPatternGeometry,
    Timeframe,
} from '@/domain/types';
import { extractPivots } from '@/domain/patterns/pivots';
import { computeCandidateGeometry } from '@/domain/patterns/patternGeometry';
import { isSpentPattern } from '@/domain/patterns/spentPatterns';
import {
    PATTERN_MIN_HEIGHT_PRICE_PCT,
    SCREEN_LOOKBACK_BARS,
} from '@/domain/patterns/constants';
import type { QualifyContext } from '@/domain/patterns/qualify/context';
import {
    qualifyExtremes,
    qualifyHeadAndShoulders,
} from '@/domain/patterns/qualify/extremes';
import { qualifyTrendlines } from '@/domain/patterns/qualify/trendlines';
import {
    qualifyFlags,
    qualifyHighTightFlag,
} from '@/domain/patterns/qualify/flags';
import { qualifyCup, qualifyRounding } from '@/domain/patterns/qualify/curves';
import {
    type Contender,
    arbitrateWithLosers,
} from '@/domain/patterns/qualify/arbitrate';

// ─── Facade ─────────────────────────────────────────────────────────────────

/**
 * @internal
 * Strict chart-pattern qualification — what may be drawn,
 * printed with numbers and offered as a Candidate id. The pre-screener
 * (`screenChartPatterns`) stays loose and only picks skill docs; its hits
 * that do not qualify come back as `shapeHints`.
 *
 * Runs every family's strict detector over the CONFIRMED pivots of the last
 * `SCREEN_LOOKBACK_BARS` bars. It does not start from the loose hits: the
 * pre-screener misses textbook flags and cups the strict rules accept.
 *
 * Pivots are extracted over the whole series with the per-bar ATR
 * (`atrSeries`), one per bar, so each is fixed by the bars up to the bar that
 * confirmed it: neither a sliding window nor a drifting latest ATR moves,
 * adds or removes an earlier pivot (see `extractPivots`). Only the strict
 * tolerances (containment, touches, heights) use the latest `atr`.
 *
 * Hits the price has already failed or fulfilled (`isSpentPattern`) are
 * dropped before the overlap arbitration, so a spent hit cannot knock out a
 * live one.
 *
 * Pure and deterministic; never mutates its inputs.
 *
 * @param candidates - Pre-screener hits for `bars` (only their ids are read).
 * @param bars - The full bar series, oldest-first.
 * @param atr - Average True Range for `bars`.
 * @param timeframe - Bar resolution; sets the minimum height's price share.
 * @param atrSeries - Per-bar ATR aligned with `bars` — the same series the
 *   prompt's indicators carry (`calculateATR`). Pivot thresholds read it; a
 *   caller that omits it gets one threshold from `atr` for the whole series,
 *   which is not causal (tests pin ATR this way).
 * @returns The qualified patterns, the loose ids left as shape hints and the
 *   live hits the arbitration dropped (for logging).
 *   Nothing qualifies when `bars` is empty or `atr` is not a positive
 *   number; every loose id is then a shape hint.
 */
export function qualifyPatterns(
    candidates: readonly PatternCandidate[],
    bars: readonly Bar[],
    atr: number,
    timeframe: Timeframe,
    atrSeries?: readonly (number | null)[]
): PatternQualification {
    const looseIds = [...new Set(candidates.map(c => c.id))];
    if (bars.length === 0 || !Number.isFinite(atr) || atr <= 0)
        return {
            qualified: [],
            shapeHints: sortIds(looseIds),
            arbitrationDropped: [],
        };

    const windowStart = Math.max(0, bars.length - SCREEN_LOOKBACK_BARS);
    const ctx: QualifyContext = {
        bars,
        pivots: extractPivots(bars, atrSeries ?? atr, {
            onePivotPerBar: true,
        }).filter(p => p.index >= windowStart),
        atr,
        lastIndex: bars.length - 1,
        minHeightPricePct: PATTERN_MIN_HEIGHT_PRICE_PCT[timeframe],
    };
    const detected = [
        ...qualifyExtremes(ctx, 'high'),
        ...qualifyExtremes(ctx, 'low'),
        ...qualifyHeadAndShoulders(ctx, 'high', 'head_and_shoulders'),
        ...qualifyHeadAndShoulders(ctx, 'low', 'inverse_head_and_shoulders'),
        ...qualifyTrendlines(ctx),
        ...qualifyFlags(ctx),
        ...qualifyHighTightFlag(ctx),
        ...qualifyCup(ctx),
        ...qualifyRounding(ctx, 'bottom'),
        ...qualifyRounding(ctx, 'top'),
    ];

    const spentIds = new Set<ChartPatternId>();
    const live: Contender[] = [];
    for (const pattern of detected) {
        const geometry: QualifiedPatternGeometry | null =
            computeCandidateGeometry(pattern, bars, atr);
        if (geometry === null) continue;
        if (isSpentPattern(pattern, geometry, bars, atr))
            spentIds.add(pattern.id);
        else live.push({ pattern, direction: geometry.direction });
    }

    const { kept, dropped } = arbitrateWithLosers(live);
    const qualified = kept
        .map(c => c.pattern)
        .toSorted(
            (a, b) =>
                a.id.localeCompare(b.id, 'en') || a.startIndex - b.startIndex
        );
    const qualifiedIds = new Set(qualified.map(q => q.id));
    return {
        qualified,
        shapeHints: sortIds(
            looseIds.filter(id => !qualifiedIds.has(id) && !spentIds.has(id))
        ),
        arbitrationDropped: dropped.map(({ loser, winner }) => ({
            id: loser.pattern.id,
            startIndex: loser.pattern.startIndex,
            endIndex: loser.pattern.endIndex,
            lostTo: winner.pattern.id,
        })),
    };
}

function sortIds(ids: readonly ChartPatternId[]): ChartPatternId[] {
    return ids.toSorted((a, b) => a.localeCompare(b, 'en'));
}
