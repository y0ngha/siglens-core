// Independent TypeScript impl of SMC/ICT concepts; not ported from LuxAlgo PineScript (CC BY-NC-SA 4.0 © LuxAlgo).

import type {
    Bar,
    SMCBreakType,
    SMCEqualLevel,
    SMCFairValueGap,
    SMCOrderBlock,
    SMCResult,
    SMCStructureBreak,
    SMCStructureDirection,
    SMCSwingPoint,
} from '@/domain/types';
import {
    EMPTY_SMC_RESULT,
    SMC_ATR_PERIOD,
    SMC_DISCOUNT_RATIO,
    SMC_EQUAL_LEVEL_ATR_MULTIPLIER,
    SMC_PREMIUM_RATIO,
    SMC_SWING_PERIOD,
} from '@/domain/indicators/constants';
import { calculateATR } from '@/domain/indicators/atr';
import { slidingMax, slidingMin } from '@/domain/indicators/utils';

// ─── Swing detection ─────────────────────────────────────────────────────────

// Centered window via right-aligned sliding window: reads result[i+period] to cover highs/lows[i-period..i+period].
function detectSwingPoints(bars: Bar[], period: number): SMCSwingPoint[] {
    const n = bars.length;
    if (n < period * 2 + 1) return [];

    const windowSize = 2 * period + 1;
    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);
    // Sliding max/min over a window of windowSize; result[k] covers [k-windowSize+1, k].
    // For center i the right-edge is i+period, so we read result[i+period].
    const winMax = slidingMax(highs, windowSize);
    const winMin = slidingMin(lows, windowSize);

    const result: SMCSwingPoint[] = [];
    for (let i = period; i < n - period; i++) {
        const maxHigh = winMax[i + period]!;
        const minLow = winMin[i + period]!;
        if (bars[i].high === maxHigh)
            result.push({ index: i, price: bars[i].high, type: 'high' });
        if (bars[i].low === minLow)
            result.push({ index: i, price: bars[i].low, type: 'low' });
    }
    return result;
}

// ─── Fair Value Gap detection ─────────────────────────────────────────────────

// Bullish FVG: bars[i].low > bars[i-2].high; bearish: bars[i].high < bars[i-2].low.
function detectFairValueGaps(bars: Bar[]): SMCFairValueGap[] {
    if (bars.length < 3) return [];

    const raw = bars
        .slice(2)
        .map((bar, idx): SMCFairValueGap | null => {
            const i = idx + 2;
            const anchor = bars[i - 2];

            const isBullish = bar.low > anchor.high;
            const isBearish = bar.high < anchor.low;

            if (!isBullish && !isBearish) return null;

            return isBullish
                ? {
                      index: i,
                      high: bar.low,
                      low: anchor.high,
                      type: 'bullish',
                      isMitigated: false,
                  }
                : {
                      index: i,
                      high: anchor.low,
                      low: bar.high,
                      type: 'bearish',
                      isMitigated: false,
                  };
        })
        .filter((fvg): fvg is SMCFairValueGap => fvg !== null);

    const mitigated = new Set<number>();
    for (let i = 0; i < raw.length; i++) {
        const fvg = raw[i];
        for (let j = fvg.index + 1; j < bars.length; j++) {
            const b = bars[j];
            const isHit =
                fvg.type === 'bullish' ? b.low <= fvg.high : b.high >= fvg.low;
            if (isHit) {
                mitigated.add(i);
                break;
            }
        }
    }
    return raw.map((fvg, i) => ({ ...fvg, isMitigated: mitigated.has(i) }));
}

// ─── Structure break detection (BOS / CHoCH) ─────────────────────────────────

interface SwingAdvanceResult {
    nextIdx: number;
    active: SMCSwingPoint | null;
    wasUpdated: boolean;
}

function advanceActiveSwing(
    swings: SMCSwingPoint[],
    startIdx: number,
    barIndex: number,
    currentActive: SMCSwingPoint | null
): SwingAdvanceResult {
    let idx = startIdx;
    let active = currentActive;
    let wasUpdated = false;

    while (idx < swings.length && swings[idx].index <= barIndex) {
        if (active === null || swings[idx].index > active.index) {
            active = swings[idx];
            wasUpdated = true;
        }
        idx++;
    }

    return { nextIdx: idx, active, wasUpdated };
}

// for loops needed: two independent advancing pointers over sorted swing arrays cannot be expressed as map/reduce.
function detectStructureBreaks(
    bars: Bar[],
    swingHighs: SMCSwingPoint[],
    swingLows: SMCSwingPoint[]
): SMCStructureBreak[] {
    if (swingHighs.length === 0 || swingLows.length === 0) return [];

    let trend: SMCStructureDirection | null = null;
    let activeHigh: SMCSwingPoint | null = null;
    let activeLow: SMCSwingPoint | null = null;
    let highConsumed = false;
    let lowConsumed = false;
    const breaks: SMCStructureBreak[] = [];
    let highIdx = 0;
    let lowIdx = 0;

    for (let i = 0; i < bars.length; i++) {
        const bar = bars[i];

        const highResult = advanceActiveSwing(
            swingHighs,
            highIdx,
            i,
            activeHigh
        );
        highIdx = highResult.nextIdx;
        activeHigh = highResult.active;
        if (highResult.wasUpdated) highConsumed = false;

        const lowResult = advanceActiveSwing(swingLows, lowIdx, i, activeLow);
        lowIdx = lowResult.nextIdx;
        activeLow = lowResult.active;
        if (lowResult.wasUpdated) lowConsumed = false;

        // Bullish break: close crosses above the active swing high
        if (
            activeHigh !== null &&
            !highConsumed &&
            bar.close > activeHigh.price
        ) {
            const breakType: SMCBreakType =
                trend === 'bearish' ? 'choch' : 'bos';
            breaks.push({
                index: i,
                price: activeHigh.price,
                type: 'bullish',
                breakType,
            });
            trend = 'bullish';
            highConsumed = true;
        }

        // Bearish break: close crosses below the active swing low
        if (activeLow !== null && !lowConsumed && bar.close < activeLow.price) {
            const breakType: SMCBreakType =
                trend === 'bullish' ? 'choch' : 'bos';
            breaks.push({
                index: i,
                price: activeLow.price,
                type: 'bearish',
                breakType,
            });
            trend = 'bearish';
            lowConsumed = true;
        }
    }

    return breaks;
}

// ─── Order Block detection ────────────────────────────────────────────────────

interface LastOpposingIndices {
    lastBullish: (number | null)[];
    lastBearish: (number | null)[];
}

function* scanLastIndex(
    bars: Bar[],
    pred: (bar: Bar) => boolean
): Generator<number | null> {
    let last: number | null = null;
    for (let i = 0; i < bars.length; i++) {
        if (pred(bars[i])) last = i;
        yield last;
    }
}

function buildLastOpposingIndices(bars: Bar[]): LastOpposingIndices {
    return {
        lastBullish: [...scanLastIndex(bars, bar => bar.close > bar.open)],
        lastBearish: [...scanLastIndex(bars, bar => bar.close < bar.open)],
    };
}

// for loop + suffix arrays avoid O(K²) from reduce+spread and O(N×K) per-OB scan.
function detectOrderBlocks(
    bars: Bar[],
    structureBreaks: SMCStructureBreak[]
): SMCOrderBlock[] {
    if (structureBreaks.length === 0) return [];

    const { lastBullish, lastBearish } = buildLastOpposingIndices(bars);

    // Precompute suffix min-low and suffix max-high for O(1) mitigation checks.
    const n = bars.length;
    const suffixMinLow = new Array<number>(n + 1);
    const suffixMaxHigh = new Array<number>(n + 1);
    suffixMinLow[n] = Infinity;
    suffixMaxHigh[n] = -Infinity;
    for (let i = n - 1; i >= 0; i--) {
        suffixMinLow[i] = Math.min(bars[i].low, suffixMinLow[i + 1]);
        suffixMaxHigh[i] = Math.max(bars[i].high, suffixMaxHigh[i + 1]);
    }

    const obs: SMCOrderBlock[] = [];
    for (const sb of structureBreaks) {
        if (sb.index === 0) continue;

        const isBullishBreak = sb.type === 'bullish';
        // Bullish break → last bearish candle; Bearish break → last bullish candle
        const obIndex = isBullishBreak
            ? lastBearish[sb.index - 1]
            : lastBullish[sb.index - 1];
        if (obIndex === null) continue;

        const obBar = bars[obIndex];
        const isMitigated = isBullishBreak
            ? suffixMinLow[obIndex + 1] < obBar.low
            : suffixMaxHigh[obIndex + 1] > obBar.high;

        obs.push({
            startIndex: obIndex,
            high: obBar.high,
            low: obBar.low,
            type: sb.type,
            isMitigated,
        });
    }
    return obs;
}

// ─── Equal High / Low detection ───────────────────────────────────────────────

function detectEqualLevels(
    swingHighs: SMCSwingPoint[],
    swingLows: SMCSwingPoint[],
    atrValues: (number | null)[]
): { equalHighs: SMCEqualLevel[]; equalLows: SMCEqualLevel[] } {
    return {
        equalHighs: findEqualLevels(swingHighs, atrValues),
        equalLows: findEqualLevels(swingLows, atrValues),
    };
}

function* findMatchingLevels(
    swings: SMCSwingPoint[],
    startJ: number,
    swing: SMCSwingPoint,
    threshold: number
): Generator<SMCEqualLevel> {
    for (let j = startJ; j < swings.length; j++) {
        if (Math.abs(swings[j].price - swing.price) <= threshold) {
            yield {
                price: (swing.price + swings[j].price) / 2,
                firstIndex: swing.index,
                secondIndex: swings[j].index,
            };
        }
    }
}

function findEqualLevels(
    swings: SMCSwingPoint[],
    atrValues: (number | null)[]
): SMCEqualLevel[] {
    return swings.flatMap((swing, i) => {
        const atr = atrValues[swing.index];
        if (atr === null) return [];

        const threshold = SMC_EQUAL_LEVEL_ATR_MULTIPLIER * atr;
        return [...findMatchingLevels(swings, i + 1, swing, threshold)];
    });
}

// ─── Premium / Discount / Equilibrium zones ───────────────────────────────────

// detectZones 가 사용하는 내부 range 표현. 외부에 노출되지 않는 구현 전용
// 타입이므로 domain/types.ts 가 아닌 본 파일에 둔다 (indicator 결과 타입만
// types.ts 에 배치하는 ARCHITECTURE.md 규칙에 부합).
interface ZoneRange {
    top: number;
    bottom: number;
}

// Bullish break: broken high tops range, post-break lowest low bottoms it (falls back to pre-break lows if none yet).
function resolveZoneRange(
    swingHighs: SMCSwingPoint[],
    swingLows: SMCSwingPoint[],
    structureBreaks: SMCStructureBreak[]
): ZoneRange | null {
    const lastBreak = structureBreaks[structureBreaks.length - 1];

    if (lastBreak === undefined) {
        if (swingHighs.length === 0 || swingLows.length === 0) return null;
        return {
            top: swingHighs.reduce((m, s) => Math.max(m, s.price), -Infinity),
            bottom: swingLows.reduce((m, s) => Math.min(m, s.price), Infinity),
        };
    }

    if (lastBreak.type === 'bullish') {
        const lowsAfter = swingLows.filter(s => s.index > lastBreak.index);
        const lowsBefore = swingLows.filter(s => s.index <= lastBreak.index);
        const relevantLows = lowsAfter.length > 0 ? lowsAfter : lowsBefore;
        if (relevantLows.length === 0) return null;

        const highsAfter = swingHighs.filter(s => s.index >= lastBreak.index);
        const highPrices = [lastBreak.price, ...highsAfter.map(s => s.price)];

        return {
            top: highPrices.reduce((m, p) => Math.max(m, p), -Infinity),
            bottom: relevantLows.reduce(
                (m, s) => Math.min(m, s.price),
                Infinity
            ),
        };
    }

    // bearish break
    const highsAfter = swingHighs.filter(s => s.index > lastBreak.index);
    const highsBefore = swingHighs.filter(s => s.index <= lastBreak.index);
    const relevantHighs = highsAfter.length > 0 ? highsAfter : highsBefore;
    if (relevantHighs.length === 0) return null;

    const lowsAfter = swingLows.filter(s => s.index >= lastBreak.index);
    const lowPrices = [lastBreak.price, ...lowsAfter.map(s => s.price)];

    return {
        top: relevantHighs.reduce((m, s) => Math.max(m, s.price), -Infinity),
        bottom: lowPrices.reduce((m, p) => Math.min(m, p), Infinity),
    };
}

function detectZones(
    swingHighs: SMCSwingPoint[],
    swingLows: SMCSwingPoint[],
    structureBreaks: SMCStructureBreak[]
): Pick<SMCResult, 'premiumZone' | 'discountZone' | 'equilibriumZone'> {
    const empty = {
        premiumZone: null,
        discountZone: null,
        equilibriumZone: null,
    };

    const resolved = resolveZoneRange(swingHighs, swingLows, structureBreaks);
    if (resolved === null) return empty;

    const { top, bottom } = resolved;
    const span = top - bottom;
    if (span <= 0) return empty;

    return {
        premiumZone: {
            high: top,
            low: bottom + SMC_PREMIUM_RATIO * span,
            type: 'premium',
        },
        equilibriumZone: {
            high: bottom + SMC_PREMIUM_RATIO * span,
            low: bottom + SMC_DISCOUNT_RATIO * span,
            type: 'equilibrium',
        },
        discountZone: {
            high: bottom + SMC_DISCOUNT_RATIO * span,
            low: bottom,
            type: 'discount',
        },
    };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/** @internal Smart Money Concepts — swing points, order blocks, FVGs, and zones. */
export function calculateSmc(
    bars: Bar[],
    swingPeriod = SMC_SWING_PERIOD
): SMCResult {
    if (bars.length === 0) return EMPTY_SMC_RESULT;

    const atrValues = calculateATR(bars, SMC_ATR_PERIOD);
    const swingPoints = detectSwingPoints(bars, swingPeriod);
    const swingHighs = swingPoints.filter(p => p.type === 'high');
    const swingLows = swingPoints.filter(p => p.type === 'low');

    const fairValueGaps = detectFairValueGaps(bars);
    const structureBreaks = detectStructureBreaks(bars, swingHighs, swingLows);
    const orderBlocks = detectOrderBlocks(bars, structureBreaks);
    const { equalHighs, equalLows } = detectEqualLevels(
        swingHighs,
        swingLows,
        atrValues
    );
    const { premiumZone, discountZone, equilibriumZone } = detectZones(
        swingHighs,
        swingLows,
        structureBreaks
    );

    return {
        swingHighs,
        swingLows,
        orderBlocks,
        fairValueGaps,
        equalHighs,
        equalLows,
        premiumZone,
        discountZone,
        equilibriumZone,
        structureBreaks,
    };
}
