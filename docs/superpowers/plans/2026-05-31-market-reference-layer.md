# Honest Market Reference Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the predictive Group-B chart computations (S/R candidates, pivot/fib, trendlines) with a single deterministic, multi-horizon **advisory** "Market Reference" layer and an honestly-framed prompt section.

**Architecture:** A new pure domain function `computeMarketReference(bars, indicators, timeframe)` returns short/medium/long `HorizonReference` objects (reference levels + descriptive trend structure). The chart prompt renders them in one advisory section. Old compute functions are deleted; reusable fib/pivot math is moved into focused helpers. Consumers need no changes.

**Tech Stack:** TypeScript (pure `domain/` layer — no I/O), Vitest, `@/`-aliased imports, types in `domain/types.ts`, constants in dedicated files, 90% branch coverage.

**Spec:** `docs/superpowers/specs/2026-05-31-honest-market-reference-layer-design.md`

**Versioning:** DO NOT bump version or add `BREAKING CHANGE:` footers — the user owns the release. Use `feat:`/`refactor:`/`chore:` messages only. Never edit `package.json` `version` / `CHANGELOG.md`. Do NOT create commits if running under the repo's orchestrator rules — leave commits to the workflow; where this plan shows a `git commit`, the executing agent commits per the project's normal flow.

**Scope note:** This plan covers **PR1** (core layer + prompt swap + deletions — shippable on its own). **PR2** (SMC market-structure / order-blocks / FVG + Anchored VWAP) is outlined at the end and gets its own detailed plan after PR1 merges.

---

## File Structure (PR1)

- **Create** `src/domain/analysis/marketReference.ts` — `computeMarketReference` + horizon assembly + level collection.
- **Create** `src/domain/analysis/referenceLevels.ts` — pure level builders (round numbers, MA/EMA/Ichimoku/Donchian/BB/Keltner/Supertrend/VWAP/POC → `ReferenceLevel`, sort/split).
- **Create** `src/domain/analysis/fibLevels.ts` — fib retracement/extension (moved from `pivotFib.ts`).
- **Create** `src/domain/analysis/pivotLevels.ts` — standard pivots (moved from `pivotFib.ts`) + Camarilla.
- **Create** `src/domain/analysis/trendStructure.ts` — efficiency ratio, EMA stack, swing structure, regime.
- **Create** `src/domain/analysis/marketReferenceConstants.ts` — horizon windows, thresholds, round tiers.
- **Modify** `src/domain/types.ts` — add the new types; remove input-only types (`LevelCandidate`, `LevelCandidates`, `PivotFibLevels`, `FibonacciPivotLevels`, `PivotLevelSet`).
- **Modify** `src/domain/analysis/prompt.ts` — new section formatter + framing; remove old formatters, imports, and section wiring.
- **Delete** `src/domain/analysis/levelCandidates.ts`, `src/domain/analysis/pivotFib.ts`, `src/domain/analysis/trendlineCandidates.ts`, `src/domain/analysis/trendline.ts` (and their `__tests__`).
- **Modify** `src/index.ts` (L107-108), `src/index.client.ts` (L112) — remove deleted exports; add `computeMarketReference` export.
- **Modify** `docs/PUBLIC_API.md`, `docs/DOMAIN.md`.

> Keep the `Trendline`/`TrendlinePoint`/`TrendlineDirection` **types** (response schema) and `FibonacciLevel`/`FibonacciProjection` types (reused by `fibLevels.ts`).

---

## Task 1: New domain types

**Files:**
- Modify: `src/domain/types.ts`

- [ ] **Step 1: Add the Market Reference types** (place near the existing `LevelCandidate` block; you will delete the old block in Task 12).

```ts
/** Horizon buckets for multi-timeframe reference (short/medium/long lookback). */
export type HorizonKey = 'short' | 'medium' | 'long';

/** Source of a reference level (descriptive label only — not a conviction rank). */
export type ReferenceLevelKind =
    | 'fib_retracement'
    | 'fib_extension'
    | 'vp_poc'
    | 'vp_vah'
    | 'vp_val'
    | 'swing_high'
    | 'swing_low'
    | 'ma'
    | 'ema'
    | 'round'
    | 'pivot_standard'
    | 'pivot_camarilla'
    | 'ichimoku'
    | 'donchian'
    | 'bollinger'
    | 'keltner'
    | 'supertrend'
    | 'vwap';

/** A single commonly-watched reference price. Advisory context, not a prediction. */
export interface ReferenceLevel {
    price: number;
    /** Human-readable label, e.g. "Fib 61.8%", "POC", "MA200", "Camarilla R3". */
    label: string;
    kind: ReferenceLevelKind;
    /** Signed percent distance from current price (negative = below). */
    distancePercent: number;
}

/** Reference levels split by side relative to current price, nearest-first. */
export interface ReferenceLevels {
    support: ReferenceLevel[];
    resistance: ReferenceLevel[];
}

export type PriceVsLevel = 'above' | 'below' | 'unknown';
export type EmaStackState = 'aligned_up' | 'aligned_down' | 'mixed';
export type SwingStructureState = 'HH_HL' | 'LH_LL' | 'mixed';
export type MarketRegime = 'trending' | 'ranging';

/** Descriptive trend structure for a horizon — facts, NOT a directional prediction. */
export interface TrendStructure {
    priceVsMA50: PriceVsLevel;
    priceVsMA200: PriceVsLevel;
    emaStack: EmaStackState;
    swingStructure: SwingStructureState;
    adx: number | null;
    efficiencyRatio: number | null;
    regime: MarketRegime;
}

export interface HorizonWindow {
    bars: number;
    fromTime: number | null;
    toTime: number | null;
}

export interface HorizonReference {
    window: HorizonWindow;
    levels: ReferenceLevels;
    structure: TrendStructure;
}

/** Deterministic, multi-horizon advisory reference for the chart prompt. */
export interface MarketReference {
    short: HorizonReference;
    medium: HorizonReference;
    long: HorizonReference;
}
```

- [ ] **Step 2: Typecheck** — Run: `yarn typecheck` → Expected: PASS (new types unused yet is fine).

- [ ] **Step 3: Commit** — `feat: add MarketReference domain types`

---

## Task 2: Constants

**Files:**
- Create: `src/domain/analysis/marketReferenceConstants.ts`
- Test: `src/__tests__/domain/analysis/marketReferenceConstants.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
    HORIZON_WINDOWS_BY_TIMEFRAME,
    ROUND_NUMBER_TIERS,
} from '@/domain/analysis/marketReferenceConstants';
import type { Timeframe } from '@/domain/types';

describe('marketReferenceConstants', () => {
    it('defines short<medium<long windows for every timeframe', () => {
        const tfs: Timeframe[] = ['5Min', '15Min', '30Min', '1Hour', '4Hour', '1Day'];
        for (const tf of tfs) {
            const w = HORIZON_WINDOWS_BY_TIMEFRAME[tf];
            expect(w.short).toBeLessThan(w.medium);
            expect(w.medium).toBeLessThan(w.long);
        }
    });

    it('orders round-number tiers by ascending price ceiling', () => {
        const ceilings = ROUND_NUMBER_TIERS.map(t => t.maxPrice);
        expect(ceilings).toEqual([...ceilings].sort((a, b) => a - b));
    });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `yarn test marketReferenceConstants` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import type { HorizonKey, Timeframe } from '@/domain/types';

/** Trailing-bar lookback window per horizon, per timeframe (capped at bars.length). */
export const HORIZON_WINDOWS_BY_TIMEFRAME: Record<
    Timeframe,
    Record<HorizonKey, number>
> = {
    '5Min': { short: 24, medium: 78, long: 200 },
    '15Min': { short: 26, medium: 78, long: 200 },
    '30Min': { short: 26, medium: 78, long: 200 },
    '1Hour': { short: 24, medium: 72, long: 200 },
    '4Hour': { short: 20, medium: 60, long: 180 },
    '1Day': { short: 20, medium: 60, long: 200 },
};

/** Round-number increment by price tier (ascending ceiling). */
export interface RoundNumberTier {
    maxPrice: number;
    increment: number;
}
export const ROUND_NUMBER_TIERS: readonly RoundNumberTier[] = [
    { maxPrice: 5, increment: 0.5 },
    { maxPrice: 50, increment: 1 },
    { maxPrice: 200, increment: 5 },
    { maxPrice: Number.POSITIVE_INFINITY, increment: 10 },
];

/** Regime descriptor thresholds. */
export const ADX_TRENDING_THRESHOLD = 25;
export const EFFICIENCY_RATIO_TRENDING_THRESHOLD = 0.3;

/** Camarilla pivot constants: level = C ± (H−L)·1.1/divisor. */
export const CAMARILLA_FACTOR = 1.1;
export const CAMARILLA_R3_S3_DIVISOR = 4;
export const CAMARILLA_R4_S4_DIVISOR = 2;

/** Max reference levels surfaced per side, per horizon (prompt-size control). */
export const MAX_REFERENCE_LEVELS_PER_SIDE = 6;
```

- [ ] **Step 4: Run test to verify it passes** — Run: `yarn test marketReferenceConstants` → Expected: PASS.

- [ ] **Step 5: Commit** — `feat: add market-reference constants`

---

## Task 3: Move fib math into `fibLevels.ts`

**Files:**
- Create: `src/domain/analysis/fibLevels.ts`
- Test: `src/__tests__/domain/analysis/fibLevels.test.ts`

> Move `computeFibonacciProjection`, `buildRetracements`, `buildExtensions`, `resolveLegDirection`, the FIB ratio constants, and `isUsablePrice` out of `pivotFib.ts` (deleted in Task 12). Export `computeFibonacciProjection`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { computeFibonacciProjection } from '@/domain/analysis/fibLevels';
import type { SMCResult } from '@/domain/types';

function smc(highIdx: number, highPrice: number, lowIdx: number, lowPrice: number): SMCResult {
    return {
        swingHighs: [{ index: highIdx, price: highPrice, time: highIdx }],
        swingLows: [{ index: lowIdx, price: lowPrice, time: lowIdx }],
        structureBreaks: [],
    } as unknown as SMCResult;
}

describe('computeFibonacciProjection', () => {
    it('returns null without swings', () => {
        expect(
            computeFibonacciProjection({ swingHighs: [], swingLows: [], structureBreaks: [] } as unknown as SMCResult)
        ).toBeNull();
    });

    it('builds up-leg retracements from high downward', () => {
        const proj = computeFibonacciProjection(smc(10, 110, 5, 100));
        expect(proj?.direction).toBe('up');
        const r50 = proj?.retracements.find(r => r.ratio === 0.5);
        expect(r50?.price).toBeCloseTo(105, 6); // 110 - 0.5*10
    });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `yarn test fibLevels` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — copy the relevant code from `pivotFib.ts` lines 25-159 verbatim into `fibLevels.ts` (the `FIB_RETRACEMENT_RATIOS`, `FIB_EXTENSION_RATIOS`, `isUsablePrice`, `resolveLegDirection`, `buildRetracements`, `buildExtensions`, `computeFibonacciProjection`), exporting `computeFibonacciProjection` and `isUsablePrice`. Keep imports of `FibonacciLevel`, `FibonacciProjection`, `SMCResult`, `SMCSwingPoint`, `SwingLegDirection` from `@/domain/types` and `lastOf` from `@/domain/analysis/analysisUtils`.

- [ ] **Step 4: Run test to verify it passes** — Run: `yarn test fibLevels` → Expected: PASS.

- [ ] **Step 5: Commit** — `refactor: extract fib projection into fibLevels`

---

## Task 4: Move standard pivots + add Camarilla into `pivotLevels.ts`

**Files:**
- Create: `src/domain/analysis/pivotLevels.ts`
- Test: `src/__tests__/domain/analysis/pivotLevels.test.ts`

> Move `resolvePivotBase`, `computeStandardPivot`, pivot constants out of `pivotFib.ts`. Add `computeCamarillaPivot`. Keep `StandardPivotLevels` type (used here). Add a new `CamarillaPivotLevels` type in `domain/types.ts` (see Step 3).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { computeStandardPivot, computeCamarillaPivot } from '@/domain/analysis/pivotLevels';
import type { Bar } from '@/domain/types';

const bar: Bar = { time: 1, open: 100, high: 110, low: 90, close: 105, volume: 1000 };

describe('pivotLevels', () => {
    it('computes the standard central pivot', () => {
        expect(computeStandardPivot(bar)?.pp).toBeCloseTo((110 + 90 + 105) / 3, 6);
    });

    it('computes Camarilla R3/R4/S3/S4 around close', () => {
        const cam = computeCamarillaPivot(bar);
        const range = 110 - 90;
        expect(cam?.r3).toBeCloseTo(105 + (range * 1.1) / 4, 6);
        expect(cam?.r4).toBeCloseTo(105 + (range * 1.1) / 2, 6);
        expect(cam?.s3).toBeCloseTo(105 - (range * 1.1) / 4, 6);
        expect(cam?.s4).toBeCloseTo(105 - (range * 1.1) / 2, 6);
    });

    it('returns null on non-finite OHLC', () => {
        expect(computeCamarillaPivot({ ...bar, high: NaN })).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `yarn test pivotLevels` → Expected: FAIL.

- [ ] **Step 3: Add `CamarillaPivotLevels` type** to `src/domain/types.ts`:

```ts
/** Camarilla pivot levels (the four most-watched). */
export interface CamarillaPivotLevels {
    pp: number;
    r3: number;
    r4: number;
    s3: number;
    s4: number;
}
```

- [ ] **Step 4: Implement `pivotLevels.ts`**

```ts
import type { Bar, CamarillaPivotLevels, StandardPivotLevels } from '@/domain/types';
import {
    CAMARILLA_FACTOR,
    CAMARILLA_R3_S3_DIVISOR,
    CAMARILLA_R4_S4_DIVISOR,
} from '@/domain/analysis/marketReferenceConstants';

const PIVOT_DIVISOR = 3;
const PIVOT_DOUBLE = 2;

const isUsablePrice = (price: number): boolean =>
    Number.isFinite(price) && price > 0;

interface PivotBase {
    pp: number;
    range: number;
}

const resolvePivotBase = (bar: Bar): PivotBase | null => {
    const { high, low, close } = bar;
    if (!isUsablePrice(high) || !isUsablePrice(low) || !isUsablePrice(close)) {
        return null;
    }
    return { pp: (high + low + close) / PIVOT_DIVISOR, range: high - low };
};

export function computeStandardPivot(bar: Bar): StandardPivotLevels | null {
    const base = resolvePivotBase(bar);
    if (base === null) return null;
    const { pp, range } = base;
    const { high, low } = bar;
    const twicePp = PIVOT_DOUBLE * pp;
    return {
        pp,
        r1: twicePp - low,
        r2: pp + range,
        r3: high + PIVOT_DOUBLE * (pp - low),
        s1: twicePp - high,
        s2: pp - range,
        s3: low - PIVOT_DOUBLE * (high - pp),
    };
}

export function computeCamarillaPivot(bar: Bar): CamarillaPivotLevels | null {
    const base = resolvePivotBase(bar);
    if (base === null) return null;
    const { pp, range } = base;
    const { close } = bar;
    const span = range * CAMARILLA_FACTOR;
    return {
        pp,
        r3: close + span / CAMARILLA_R3_S3_DIVISOR,
        r4: close + span / CAMARILLA_R4_S4_DIVISOR,
        s3: close - span / CAMARILLA_R3_S3_DIVISOR,
        s4: close - span / CAMARILLA_R4_S4_DIVISOR,
    };
}
```

- [ ] **Step 5: Run test to verify it passes** — Run: `yarn test pivotLevels` → Expected: PASS.

- [ ] **Step 6: Commit** — `feat: add standard + camarilla pivot levels`

---

## Task 5: Round-number levels

**Files:**
- Create: `src/domain/analysis/referenceLevels.ts` (start it here; extend in Task 7)
- Test: `src/__tests__/domain/analysis/referenceLevels.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { roundNumberLevels } from '@/domain/analysis/referenceLevels';

describe('roundNumberLevels', () => {
    it('uses $5 increments in the 50–200 tier', () => {
        const prices = roundNumberLevels(123).map(l => l.price).sort((a, b) => a - b);
        expect(prices).toContain(120);
        expect(prices).toContain(125);
    });

    it('uses $0.50 increments under $5', () => {
        const prices = roundNumberLevels(3.2).map(l => l.price);
        expect(prices).toContain(3);
        expect(prices).toContain(3.5);
    });

    it('labels every level kind round', () => {
        expect(roundNumberLevels(123).every(l => l.kind === 'round')).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `yarn test referenceLevels` → Expected: FAIL.

- [ ] **Step 3: Implement** — create `referenceLevels.ts`:

```ts
import type { ReferenceLevel } from '@/domain/types';
import { ROUND_NUMBER_TIERS } from '@/domain/analysis/marketReferenceConstants';

/** Number of round levels to emit on each side of price. */
const ROUND_LEVELS_PER_SIDE = 2;

const incrementFor = (price: number): number =>
    ROUND_NUMBER_TIERS.find(t => price <= t.maxPrice)?.increment ?? 10;

const roundLabel = (price: number): string => `Round ${price}`;

/** Nearest round-number levels above and below the price (advisory psychology). */
export function roundNumberLevels(currentPrice: number): ReferenceLevel[] {
    if (!(Number.isFinite(currentPrice) && currentPrice > 0)) return [];
    const inc = incrementFor(currentPrice);
    const base = Math.floor(currentPrice / inc) * inc;
    const levels: ReferenceLevel[] = [];
    for (let i = -ROUND_LEVELS_PER_SIDE; i <= ROUND_LEVELS_PER_SIDE + 1; i++) {
        const price = Number((base + i * inc).toFixed(4));
        if (price <= 0) continue;
        levels.push({
            price,
            label: roundLabel(price),
            kind: 'round',
            distancePercent: ((price - currentPrice) / currentPrice) * 100,
        });
    }
    return levels;
}
```

- [ ] **Step 4: Run test to verify it passes** — Run: `yarn test referenceLevels` → Expected: PASS.

- [ ] **Step 5: Commit** — `feat: add round-number reference levels`

---

## Task 6: Trend-structure helpers

**Files:**
- Create: `src/domain/analysis/trendStructure.ts`
- Test: `src/__tests__/domain/analysis/trendStructure.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
    efficiencyRatio,
    classifyEmaStack,
    classifySwingStructure,
} from '@/domain/analysis/trendStructure';

describe('trendStructure helpers', () => {
    it('efficiencyRatio is 1 for a perfectly monotonic path', () => {
        expect(efficiencyRatio([1, 2, 3, 4, 5], 4)).toBeCloseTo(1, 6);
    });
    it('efficiencyRatio is low for a round trip', () => {
        expect(efficiencyRatio([1, 5, 1], 2)).toBeCloseTo(0, 6);
    });
    it('classifies aligned-up EMA stack', () => {
        expect(classifyEmaStack(30, 25, 20)).toBe('aligned_up'); // price>ema9>ema20
    });
    it('classifies HH_HL from ascending swings', () => {
        expect(classifySwingStructure([100, 110], [90, 95])).toBe('HH_HL');
    });
    it('classifies LH_LL from descending swings', () => {
        expect(classifySwingStructure([110, 100], [95, 90])).toBe('LH_LL');
    });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `yarn test trendStructure` → Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type {
    EmaStackState,
    SwingStructureState,
} from '@/domain/types';

/** Kaufman efficiency ratio over the last `period` closes: |net| / Σ|step|. */
export function efficiencyRatio(
    closes: readonly number[],
    period: number
): number | null {
    if (closes.length < period + 1) return null;
    const window = closes.slice(-(period + 1));
    const net = Math.abs(window[window.length - 1] - window[0]);
    let volatility = 0;
    for (let i = 1; i < window.length; i++) {
        volatility += Math.abs(window[i] - window[i - 1]);
    }
    if (volatility === 0) return null;
    return net / volatility;
}

/** EMA-stack alignment from price + two EMAs (short, long). */
export function classifyEmaStack(
    price: number,
    emaShort: number,
    emaLong: number
): EmaStackState {
    if (price > emaShort && emaShort > emaLong) return 'aligned_up';
    if (price < emaShort && emaShort < emaLong) return 'aligned_down';
    return 'mixed';
}

/** Dow structure from the last two swing highs and lows. */
export function classifySwingStructure(
    swingHighs: readonly number[],
    swingLows: readonly number[]
): SwingStructureState {
    if (swingHighs.length < 2 || swingLows.length < 2) return 'mixed';
    const hh = swingHighs[swingHighs.length - 1] > swingHighs[swingHighs.length - 2];
    const hl = swingLows[swingLows.length - 1] > swingLows[swingLows.length - 2];
    const lh = swingHighs[swingHighs.length - 1] < swingHighs[swingHighs.length - 2];
    const ll = swingLows[swingLows.length - 1] < swingLows[swingLows.length - 2];
    if (hh && hl) return 'HH_HL';
    if (lh && ll) return 'LH_LL';
    return 'mixed';
}
```

- [ ] **Step 4: Run test to verify it passes** — Run: `yarn test trendStructure` → Expected: PASS.

- [ ] **Step 5: Commit** — `feat: add trend-structure descriptive helpers`

---

## Task 7: Reference-level collection from indicators

**Files:**
- Modify: `src/domain/analysis/referenceLevels.ts`
- Test: `src/__tests__/domain/analysis/referenceLevels.test.ts` (extend)

> Add `collectIndicatorLevels(currentPrice, indicators)` returning `ReferenceLevel[]` from the **latest non-null** value of: MA periods, EMA periods, Bollinger upper/lower, Keltner upper/lower, Donchian upper/lower, Ichimoku senkouA/senkouB (cloud edges), Supertrend value, VWAP, and Volume-Profile POC/VAH/VAL. Plus `splitBySide(levels, currentPrice)` → `ReferenceLevels` (dedupe within 0.1%, nearest-first, cap `MAX_REFERENCE_LEVELS_PER_SIDE`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { splitBySide, collectIndicatorLevels } from '@/domain/analysis/referenceLevels';
import type { ReferenceLevel } from '@/domain/types';

const lvl = (price: number): ReferenceLevel => ({ price, label: `L${price}`, kind: 'ma', distancePercent: 0 });

describe('splitBySide', () => {
    it('puts levels below price into support, above into resistance, nearest-first', () => {
        const out = splitBySide([lvl(90), lvl(80), lvl(110), lvl(120)], 100);
        expect(out.support.map(l => l.price)).toEqual([90, 80]);
        expect(out.resistance.map(l => l.price)).toEqual([110, 120]);
    });
    it('dedupes near-equal prices', () => {
        const out = splitBySide([lvl(90), lvl(90.02)], 100);
        expect(out.support).toHaveLength(1);
    });
});

describe('collectIndicatorLevels', () => {
    it('emits a POC level from the volume profile', () => {
        const ind = { volumeProfile: { poc: 95, vah: 105, val: 92, profile: [] }, ma: {}, ema: {}, bollinger: [], keltnerChannel: [], donchianChannel: [], ichimoku: [], supertrend: [], vwap: [] } as any;
        const levels = collectIndicatorLevels(100, ind);
        expect(levels.some(l => l.kind === 'vp_poc' && l.price === 95)).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `yarn test referenceLevels` → Expected: FAIL.

- [ ] **Step 3: Implement** — append to `referenceLevels.ts`:

```ts
import type { IndicatorResult } from '@/domain/types';
import { MAX_REFERENCE_LEVELS_PER_SIDE } from '@/domain/analysis/marketReferenceConstants';

const DEDUPE_FRACTION = 0.001; // 0.1%

const lastNum = (arr: readonly (number | null)[]): number | null => {
    for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] != null && Number.isFinite(arr[i] as number)) return arr[i] as number;
    }
    return null;
};

const lastField = <T>(arr: readonly T[], pick: (t: T) => number | null | undefined): number | null => {
    for (let i = arr.length - 1; i >= 0; i--) {
        const v = pick(arr[i]);
        if (v != null && Number.isFinite(v)) return v;
    }
    return null;
};

const ref = (price: number, label: string, kind: ReferenceLevel['kind'], currentPrice: number): ReferenceLevel => ({
    price,
    label,
    kind,
    distancePercent: ((price - currentPrice) / currentPrice) * 100,
});

/** Latest-value reference levels from the indicator suite. */
export function collectIndicatorLevels(
    currentPrice: number,
    indicators: IndicatorResult
): ReferenceLevel[] {
    const out: ReferenceLevel[] = [];
    const push = (price: number | null, label: string, kind: ReferenceLevel['kind']) => {
        if (price != null && Number.isFinite(price) && price > 0) out.push(ref(price, label, kind, currentPrice));
    };

    const vp = indicators.volumeProfile;
    if (vp) {
        push(vp.poc, 'POC', 'vp_poc');
        push(vp.vah, 'VAH', 'vp_vah');
        push(vp.val, 'VAL', 'vp_val');
    }
    for (const [period, series] of Object.entries(indicators.ma)) push(lastNum(series), `MA${period}`, 'ma');
    for (const [period, series] of Object.entries(indicators.ema)) push(lastNum(series), `EMA${period}`, 'ema');
    push(lastField(indicators.bollinger, b => b.upper), 'BB upper', 'bollinger');
    push(lastField(indicators.bollinger, b => b.lower), 'BB lower', 'bollinger');
    push(lastField(indicators.keltnerChannel, k => k.upper), 'Keltner upper', 'keltner');
    push(lastField(indicators.keltnerChannel, k => k.lower), 'Keltner lower', 'keltner');
    push(lastField(indicators.donchianChannel, d => d.upper), 'Donchian high', 'donchian');
    push(lastField(indicators.donchianChannel, d => d.lower), 'Donchian low', 'donchian');
    push(lastField(indicators.ichimoku, i => i.senkouA), 'Kumo A', 'ichimoku');
    push(lastField(indicators.ichimoku, i => i.senkouB), 'Kumo B', 'ichimoku');
    push(lastField(indicators.supertrend, s => s.supertrend), 'Supertrend', 'supertrend');
    push(lastNum(indicators.vwap), 'VWAP', 'vwap');
    return out;
}

/** Split levels by side relative to price, dedupe near-equal, cap per side. */
export function splitBySide(levels: readonly ReferenceLevel[], currentPrice: number): ReferenceLevels {
    const dedupe = (sorted: ReferenceLevel[]): ReferenceLevel[] => {
        const kept: ReferenceLevel[] = [];
        for (const l of sorted) {
            if (kept.some(k => Math.abs(k.price - l.price) <= DEDUPE_FRACTION * l.price)) continue;
            kept.push(l);
        }
        return kept.slice(0, MAX_REFERENCE_LEVELS_PER_SIDE);
    };
    const support = levels.filter(l => l.price < currentPrice).toSorted((a, b) => b.price - a.price);
    const resistance = levels.filter(l => l.price > currentPrice).toSorted((a, b) => a.price - b.price);
    return { support: dedupe(support), resistance: dedupe(resistance) };
}
```

> Add `import type { ReferenceLevels } from '@/domain/types';` to the file's imports.

- [ ] **Step 4: Run test to verify it passes** — Run: `yarn test referenceLevels` → Expected: PASS.

- [ ] **Step 5: Commit** — `feat: collect + split indicator reference levels`

---

## Task 8: `computeMarketReference`

**Files:**
- Create: `src/domain/analysis/marketReference.ts`
- Test: `src/__tests__/domain/analysis/marketReference.test.ts`

> Assemble short/medium/long. For each horizon: `window = bars.slice(-N)`; collect `collectIndicatorLevels` + fib (from `computeFibonacciProjection`) + round numbers + standard pivot + camarilla (from the prior bar) into one array, then `splitBySide`. Build `TrendStructure` from `efficiencyRatio` (over the window, period = min(window-1, 20)), `classifyEmaStack` (price, EMA9, EMA20 latest), `classifySwingStructure` (swing-high/low price arrays), `priceVsMA50/200`, `adx` (latest `dmi[].adx`), `regime` (ADX≥25 or ER≥0.3 → trending).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { computeMarketReference } from '@/domain/analysis/marketReference';
import type { Bar, IndicatorResult } from '@/domain/types';

function makeBars(n: number): Bar[] {
    return Array.from({ length: n }, (_, i) => ({
        time: i, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1000,
    }));
}
const emptyInd = (): IndicatorResult => ({
    macd: [], bollinger: [], dmi: [], stochastic: [], stochRsi: [], rsi: [], cci: [], vwap: [],
    ma: {}, ema: {}, volumeProfile: null, ichimoku: [], atr: [], obv: [], parabolicSar: [],
    williamsR: [], supertrend: [], mfi: [], keltnerChannel: [], cmf: [], donchianChannel: [],
    buySellVolume: [], smc: { swingHighs: [], swingLows: [], structureBreaks: [] },
    squeezeMomentum: [],
} as unknown as IndicatorResult);

describe('computeMarketReference', () => {
    it('returns three horizons with windows capped at bars.length', () => {
        const ref = computeMarketReference(makeBars(30), emptyInd(), '1Day');
        expect(ref.short.window.bars).toBe(20);
        expect(ref.medium.window.bars).toBe(30); // capped (only 30 bars < 60)
        expect(ref.long.window.bars).toBe(30);
    });
    it('produces a regime descriptor for every horizon', () => {
        const ref = computeMarketReference(makeBars(250), emptyInd(), '1Day');
        for (const h of [ref.short, ref.medium, ref.long]) {
            expect(['trending', 'ranging']).toContain(h.structure.regime);
        }
    });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `yarn test marketReference` → Expected: FAIL.

- [ ] **Step 3: Implement** `marketReference.ts`:

```ts
import type {
    Bar,
    HorizonKey,
    HorizonReference,
    IndicatorResult,
    MarketReference,
    ReferenceLevel,
    Timeframe,
    TrendStructure,
} from '@/domain/types';
import { HORIZON_WINDOWS_BY_TIMEFRAME, ADX_TRENDING_THRESHOLD, EFFICIENCY_RATIO_TRENDING_THRESHOLD } from '@/domain/analysis/marketReferenceConstants';
import { collectIndicatorLevels, splitBySide, roundNumberLevels } from '@/domain/analysis/referenceLevels';
import { computeFibonacciProjection } from '@/domain/analysis/fibLevels';
import { computeStandardPivot, computeCamarillaPivot } from '@/domain/analysis/pivotLevels';
import { efficiencyRatio, classifyEmaStack, classifySwingStructure } from '@/domain/analysis/trendStructure';

const EFFICIENCY_PERIOD = 20;

const refLevel = (price: number, label: string, kind: ReferenceLevel['kind'], currentPrice: number): ReferenceLevel => ({
    price, label, kind, distancePercent: ((price - currentPrice) / currentPrice) * 100,
});

const lastFiniteNum = (arr: readonly (number | null)[]): number | null => {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null && Number.isFinite(arr[i] as number)) return arr[i] as number;
    return null;
};
const priceVs = (price: number, level: number | null): 'above' | 'below' | 'unknown' =>
    level == null ? 'unknown' : price >= level ? 'above' : 'below';

function buildStructure(window: Bar[], indicators: IndicatorResult, currentPrice: number): TrendStructure {
    const closes = window.map(b => b.close);
    const er = efficiencyRatio(closes, Math.min(EFFICIENCY_PERIOD, Math.max(2, closes.length - 1)));
    const ema9 = lastFiniteNum(indicators.ema[9] ?? []);
    const ema20 = lastFiniteNum(indicators.ema[20] ?? []);
    const ma50 = lastFiniteNum(indicators.ma[50] ?? indicators.ma[60] ?? []);
    const ma200 = lastFiniteNum(indicators.ma[200] ?? indicators.ma[120] ?? []);
    const adx = lastFiniteNum(indicators.dmi.map(d => d.adx));
    const highs = indicators.smc.swingHighs.map(s => s.price);
    const lows = indicators.smc.swingLows.map(s => s.price);
    const trending = (adx != null && adx >= ADX_TRENDING_THRESHOLD) || (er != null && er >= EFFICIENCY_RATIO_TRENDING_THRESHOLD);
    return {
        priceVsMA50: priceVs(currentPrice, ma50),
        priceVsMA200: priceVs(currentPrice, ma200),
        emaStack: ema9 != null && ema20 != null ? classifyEmaStack(currentPrice, ema9, ema20) : 'mixed',
        swingStructure: classifySwingStructure(highs, lows),
        adx,
        efficiencyRatio: er,
        regime: trending ? 'trending' : 'ranging',
    };
}

function buildHorizon(bars: Bar[], indicators: IndicatorResult, windowBars: number): HorizonReference {
    const window = bars.slice(-Math.min(windowBars, bars.length));
    const currentPrice = window.length > 0 ? window[window.length - 1].close : 0;
    const levels: ReferenceLevel[] = [...collectIndicatorLevels(currentPrice, indicators), ...roundNumberLevels(currentPrice)];

    const fib = computeFibonacciProjection(indicators.smc);
    if (fib) {
        for (const r of fib.retracements) levels.push(refLevel(r.price, `Fib ${(r.ratio * 100).toFixed(1)}%`, 'fib_retracement', currentPrice));
        for (const e of fib.extensions) levels.push(refLevel(e.price, `Fib ext ${(e.ratio * 100).toFixed(1)}%`, 'fib_extension', currentPrice));
    }
    const priorBar = window.length >= 2 ? window[window.length - 2] : null;
    if (priorBar) {
        const sp = computeStandardPivot(priorBar);
        if (sp) for (const [k, v] of Object.entries(sp)) levels.push(refLevel(v, `Pivot ${k.toUpperCase()}`, 'pivot_standard', currentPrice));
        const cam = computeCamarillaPivot(priorBar);
        if (cam) for (const k of ['r4', 'r3', 's3', 's4'] as const) levels.push(refLevel(cam[k], `Camarilla ${k.toUpperCase()}`, 'pivot_camarilla', currentPrice));
    }
    for (const s of indicators.smc.swingHighs) levels.push(refLevel(s.price, 'Swing high', 'swing_high', currentPrice));
    for (const s of indicators.smc.swingLows) levels.push(refLevel(s.price, 'Swing low', 'swing_low', currentPrice));

    return {
        window: { bars: window.length, fromTime: window[0]?.time ?? null, toTime: window[window.length - 1]?.time ?? null },
        levels: currentPrice > 0 ? splitBySide(levels, currentPrice) : { support: [], resistance: [] },
        structure: buildStructure(window, indicators, currentPrice),
    };
}

export function computeMarketReference(
    bars: Bar[],
    indicators: IndicatorResult,
    timeframe: Timeframe
): MarketReference {
    const w = HORIZON_WINDOWS_BY_TIMEFRAME[timeframe];
    const horizon = (key: HorizonKey) => buildHorizon(bars, indicators, w[key]);
    return { short: horizon('short'), medium: horizon('medium'), long: horizon('long') };
}
```

> NOTE: standard pivot `pp/r1/r2/r3/s1/s2/s3` all get emitted; `splitBySide` filters/caps. Camarilla restricted to R3/R4/S3/S4. Swing levels feed confluence but are capped by `MAX_REFERENCE_LEVELS_PER_SIDE`.

- [ ] **Step 4: Run test to verify it passes** — Run: `yarn test marketReference` → Expected: PASS.

- [ ] **Step 5: Export** from `src/index.ts` (add near old L107) and `src/index.client.ts`:

```ts
export { computeMarketReference } from './domain/analysis/marketReference';
```

- [ ] **Step 6: Run** `yarn typecheck` → PASS. **Commit** — `feat: add computeMarketReference multi-horizon layer`

---

## Task 9: Prompt — new advisory section formatter + framing

**Files:**
- Modify: `src/domain/analysis/prompt.ts`
- Test: `src/__tests__/domain/analysis/prompt.test.ts` (add cases)

- [ ] **Step 1: Add the formatter + framing** near the old section formatters (above L619; old ones deleted in Task 10):

```ts
const MARKET_REFERENCE_HEADER = '## Market Reference (deterministic · advisory)';

const MARKET_REFERENCE_FRAMING =
    'The values below are a deterministic computation of reference levels and structure that market participants commonly watch. They are NOT validated forward predictors — backtesting shows precise level/trend prediction is near-random. Use them as context to weigh alongside detected patterns, skills, and your own reasoning; never treat them as guarantees. You may identify additional or better support/resistance from patterns, SMC, and volume that these references do not cover.';

const formatReferenceLevelLine = (level: ReferenceLevel): string =>
    `- ${fmt(level.price)} (${level.label}; ${level.distancePercent.toFixed(INDICATOR_DECIMAL_PLACES)}% away)`;

const HORIZON_LABEL: Record<HorizonKey, string> = {
    short: 'Short-term',
    medium: 'Medium-term',
    long: 'Long-term',
};

const formatHorizonBlock = (key: HorizonKey, h: HorizonReference): string => {
    const s = h.structure;
    const structureLine =
        `Structure: price ${s.priceVsMA50} MA50 / ${s.priceVsMA200} MA200; EMA ${s.emaStack}; swings ${s.swingStructure}; ` +
        `ADX ${s.adx != null ? s.adx.toFixed(INDICATOR_DECIMAL_PLACES) : 'n/a'}; efficiency ${s.efficiencyRatio != null ? s.efficiencyRatio.toFixed(2) : 'n/a'}; regime ${s.regime}.`;
    const res = h.levels.resistance.length > 0 ? ['Resistance (above):', ...h.levels.resistance.map(formatReferenceLevelLine)] : [];
    const sup = h.levels.support.length > 0 ? ['Support (below):', ...h.levels.support.map(formatReferenceLevelLine)] : [];
    return [`### ${HORIZON_LABEL[key]} (${h.window.bars} bars)`, structureLine, ...res, ...sup].join('\n');
};

const formatMarketReferenceSection = (reference: MarketReference): string =>
    [
        MARKET_REFERENCE_HEADER,
        MARKET_REFERENCE_FRAMING,
        formatHorizonBlock('short', reference.short),
        formatHorizonBlock('medium', reference.medium),
        formatHorizonBlock('long', reference.long),
    ].join('\n');
```

> Add `MarketReference`, `HorizonReference`, `HorizonKey`, `ReferenceLevel` to the `@/domain/types` import block; add `import { computeMarketReference } from '@/domain/analysis/marketReference';`.

- [ ] **Step 2: Add prompt tests**

```ts
it('renders the advisory market-reference section with honest framing', () => {
    const prompt = buildAnalysisPrompt('AAPL', 'Apple', bars, indicators, [], '1Day');
    expect(prompt).toContain('## Market Reference (deterministic · advisory)');
    expect(prompt).toContain('NOT validated forward predictors');
    expect(prompt).not.toContain('## Support/Resistance Candidates (precomputed)');
    expect(prompt).not.toContain('## Trendline Candidates (precomputed)');
});
```

> Use the test file's existing `bars`/`indicators` fixtures; if none, build minimal ones as in Task 8.

- [ ] **Step 3: Run** `yarn test prompt` → after Task 10 wiring this passes; for now expect the new assertions to FAIL (section not wired yet).

- [ ] **Step 4: Commit** — `feat: add advisory market-reference prompt section`

---

## Task 10: Prompt — wire new section, remove old sections

**Files:**
- Modify: `src/domain/analysis/prompt.ts`

- [ ] **Step 1: Replace the compute calls** at L1199-1207 with:

```ts
    const marketReference = computeMarketReference(bars, indicators, timeframe);
```

(Delete the `levelCandidates`, `pivotFibLevels`, `trendlineCandidates` declarations.)

- [ ] **Step 2: Replace the section entries** at L1220-1224 (`formatLevelCandidatesSection(...)`, `formatPivotFibSection(...)`, the trendline spread) with a single entry:

```ts
        formatMarketReferenceSection(marketReference),
```

- [ ] **Step 3: Delete the old formatters and headers** — remove `SR_CANDIDATES_HEADER`, `formatCandidateLine`, `formatLevelCandidatesSection` (L619-655); `PIVOT_FIB_HEADER` … `formatPivotFibSection` (L657-720); `TRENDLINE_CANDIDATES_HEADER`, `formatTrendlineCandidateLine`, `formatTrendlineCandidatesSection` (L722-736).

- [ ] **Step 4: Remove dead imports** — delete L74-76 (`computeLevelCandidates`, `computePivotFibLevels`, `computeTrendlineCandidates`) and the now-unused type imports among L55-72 (`LevelCandidate`, `LevelCandidates`, `PivotFibLevels`, `FibonacciPivotLevels`, `PivotLevelSet`, `StandardPivotLevels`, `FibonacciLevel`, `FibonacciProjection` — keep any still referenced; `Trendline` stays only if still used elsewhere, otherwise remove).

- [ ] **Step 5: Run** `yarn typecheck && yarn test prompt` → Expected: PASS (including Task 9 assertions). Fix any leftover references.

- [ ] **Step 6: Commit** — `refactor: wire market-reference section, drop S/R+pivot+trendline sections`

---

## Task 11: Prompt — reframe conviction wording

**Files:**
- Modify: `src/domain/analysis/prompt.ts`

- [ ] **Step 1: Reframe `FIELD_GUIDANCE_PREFACE` (L841-842)** — replace with:

```ts
const FIELD_GUIDANCE_PREFACE =
    'Use the exact numbers provided above rather than recomputing arithmetic, but treat the Market Reference as advisory context — not a mandate. Follow the content guidance below for the fields that need it:';
```

- [ ] **Step 2: Reframe the keyLevels guidance (L873)** — replace the bullet that says "Prefer SELECTING keyLevels … Candidates with more confluent sources and more tests are higher-conviction; prefer them …" with:

```ts
    '- For keyLevels, you may reuse exact prices from the ## Market Reference section (to avoid arithmetic error) OR derive your own from patterns, SMC, and volume — neither is mandatory. State a brief reason for each level. Do NOT treat reference levels as higher-conviction merely because they were precomputed; weigh them like any other evidence.',
```

- [ ] **Step 3: Reframe the S/R tool-guide lines (L1086-1090)** — update them to reference the `## Market Reference` section name instead of the deleted `## Pivot & Fibonacci Levels (precomputed)` / `## Support/Resistance Candidates (precomputed)`, keeping "use exact provided numbers; do not recompute pivot/fib arithmetic," but removing any "answer based on these" authority. (Replace the section-name strings; drop the Woodie/Camarilla/DeMark "absent" caveat since Camarilla is now provided.)

- [ ] **Step 4: Run** `yarn test prompt` → Expected: PASS. Add an assertion:

```ts
it('no longer claims more-tested levels are higher conviction', () => {
    const prompt = buildAnalysisPrompt('AAPL', 'Apple', bars, indicators, [], '1Day');
    expect(prompt).not.toContain('higher-conviction');
});
```

- [ ] **Step 5: Commit** — `refactor: honest advisory framing for reference levels`

---

## Task 12: Delete old modules, types, tests, exports

**Files:**
- Delete: `src/domain/analysis/levelCandidates.ts`, `src/domain/analysis/pivotFib.ts`, `src/domain/analysis/trendlineCandidates.ts`, `src/domain/analysis/trendline.ts`
- Delete: matching tests under `src/__tests__/domain/analysis/`
- Modify: `src/index.ts` (L107-108), `src/index.client.ts` (L112), `src/domain/types.ts`

- [ ] **Step 1: Remove exports** — delete `export { computeLevelCandidates } …` (index.ts L107, index.client.ts L112) and `export { computePivotFibLevels } …` (index.ts L108). Confirm `computeTrendlineCandidates`/`extendTrendline` were never exported.

- [ ] **Step 2: Delete the four source files and their test files.**

- [ ] **Step 3: Remove input-only types** from `src/domain/types.ts`: `LevelCandidate`, `LevelCandidates`, `LevelCandidateSource`, `PivotFibLevels`, `FibonacciPivotLevels`, `PivotLevelSet`. KEEP `Trendline`/`TrendlinePoint`/`TrendlineDirection` (response schema), `FibonacciLevel`/`FibonacciProjection` (used by `fibLevels.ts`), `StandardPivotLevels`/`CamarillaPivotLevels` (used by `pivotLevels.ts`), `SwingLegDirection`.

- [ ] **Step 4: Run** `yarn typecheck` → fix any dangling references (search `computeLevelCandidates`, `computePivotFibLevels`, `computeTrendlineCandidates`, `extendTrendline`, `LevelCandidate`, `PivotFibLevels` across `src/`). Expected after fixes: PASS.

- [ ] **Step 5: Run full suite + lint** — `yarn test --coverage && yarn lint` → Expected: PASS, domain ≥90% branch.

- [ ] **Step 6: Commit** — `refactor: delete legacy S/R, pivot, trendline computations`

---

## Task 13: Docs sync

**Files:**
- Modify: `docs/PUBLIC_API.md`, `docs/DOMAIN.md`

- [ ] **Step 1:** In `docs/PUBLIC_API.md`, remove `computeLevelCandidates` / `computePivotFibLevels` from the export inventory; add `computeMarketReference` + `MarketReference`/`HorizonReference`/`ReferenceLevel`/`TrendStructure` types at the appropriate tier.

- [ ] **Step 2:** In `docs/DOMAIN.md`, replace the S/R-candidates / pivot-fib / trendline business-rule sections with the Market Reference Layer description (multi-horizon, advisory, the 3 buckets, "not predictive — see backtest"). Note `classifyTrend` is unchanged and belongs to signals/dashboard.

- [ ] **Step 3: Commit** — `docs: document market-reference layer; drop legacy S/R docs`

---

## PR1 Self-Review Gate

- [ ] `yarn typecheck && yarn lint && yarn test --coverage` all green; domain ≥90% branch.
- [ ] Prompt has one `## Market Reference (deterministic · advisory)` section; no `Support/Resistance Candidates`, `Pivot & Fibonacci`, or `Trendline Candidates` sections; no "higher-conviction" wording.
- [ ] No `BREAKING CHANGE` footer; no `package.json`/`CHANGELOG` edits.
- [ ] `grep -rn "computeLevelCandidates\|computePivotFibLevels\|computeTrendlineCandidates\|extendTrendline" src` returns nothing.
- [ ] Token check: render a sample prompt; confirm the new section is ≤ the three it replaced.

---

## PR2 (separate plan after PR1) — SMC structure + Anchored VWAP

To be detailed in `docs/superpowers/plans/2026-06-xx-market-reference-smc.md`. Scope/algorithms:

- **`src/domain/analysis/smc/marketStructure.ts`** — from confirmed `smc.swingHighs/Lows`: a close beyond the last protected swing in the prevailing direction = **BOS**; beyond the opposite protected swing = **CHoCH**. Output `MarketStructureSignal { lastBos, lastChoch, bias }`.
- **`src/domain/analysis/smc/orderBlocks.ts`** — last opposite-color candle before the impulse that produced a BOS → `OrderBlock { high, low, direction, time, mitigated }`.
- **`src/domain/analysis/smc/fairValueGap.ts`** — 3-bar imbalance (`bar[i-1].high < bar[i+1].low` bullish / mirror bearish) → `FairValueGap { top, bottom, direction, time, filled }`; surface unfilled gaps near price.
- **`src/domain/analysis/anchoredVwap.ts`** — `AVWAP = Σ(typical·vol)/Σ(vol)` from the horizon's most significant swing high and swing low; `typical=(h+l+c)/3`.
- Extend `HorizonReference` with `marketStructure`, `orderBlocks`, `fairValueGaps`, and add the AVWAP + OB/FVG/MS lines to `formatHorizonBlock`. New types in `domain/types.ts`. Tests for BOS/CHoCH/OB/FVG against fixtures (no look-ahead — confirmed swings only). Same honest framing.
