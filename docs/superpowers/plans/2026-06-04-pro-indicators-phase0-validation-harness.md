# Pro-Indicators Phase 0 — Validation Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Repo flow (CLAUDE.md):** Each Task's "Commit" step is routed through **review-agent → mistake-managing-agent → git-agent** (the main orchestrator never commits directly). The `git commit` shown in steps is the *intent*; the executor delegates the actual commit to git-agent. Work happens in the worktree `.claude/worktrees/feat+pro-indicators` (branch `worktree-feat+pro-indicators`).

**Goal:** Build a deterministic, offline per-indicator forward-edge validation harness (pure stats in `domain/validation/` + a data-fetch/cache/runner script in `scripts/validation/`) that measures whether a signal has predictive edge over an unconditional baseline across the 10 backtest tickers and 3 timeframes.

**Architecture:** Pure measurement math lives in `src/domain/validation/` (no I/O, tested to 90% branch). All I/O (FMP fetch, file cache, env, report writing) lives in `scripts/validation/` (dev-only tsx tooling). The harness derives signal trigger indices via its own causal per-bar scan (NOT `detectSignals`, which returns only the most-recent signal). Phase 0 self-tests on the existing golden-cross signal to prove the methodology before any new indicator exists.

**Tech Stack:** TypeScript (strict), Vitest, tsx (script runner), FMP `/stable` REST (daily `historical-price-eod/full`, intraday `historical-chart/{15min|1hour}`). No new runtime dependencies (dependency-free `.env` parsing).

**Spec:** `docs/superpowers/specs/2026-06-04-pro-indicators-design.md` §4.

---

## File Structure

```
src/domain/types.ts                      # MODIFY: append ForwardReturnStats, ForwardEdgeResult, SanityResult (@internal)
src/domain/validation/
  baseline.ts                            # CREATE: forwardReturn, aggregateForwardReturns, computeBaseline
  forwardEdge.ts                         # CREATE: computeForwardEdge (excess + t-stat)
  sanity.ts                              # CREATE: checkSanity (range/finite/warmup)
  triggerScan.ts                         # CREATE: findCrossIndices (causal crossover scan)
  index.ts                               # CREATE: barrel export
src/__tests__/domain/validation/
  baseline.test.ts  forwardEdge.test.ts  sanity.test.ts  triggerScan.test.ts   # CREATE
scripts/validation/
  loadEnv.ts                             # CREATE: dependency-free .env.local parser
  fetchData.ts                           # CREATE: FMP fetch + file cache + 60s retry
  run.ts                                 # CREATE: orchestrator + golden-cross self-test + report
  .cache/                                # (gitignored) cached bars
  reports/                               # report output
src/__tests__/scripts/validation/
  loadEnv.test.ts                        # CREATE: parser unit test
.gitignore                               # MODIFY: ignore scripts/validation/.cache/
vitest.config.ts                         # VERIFY: coverage includes src/domain/validation, excludes scripts/
```

**Boundary rationale:** `domain/validation/*` is pure and fully unit-tested. `scripts/validation/*` is I/O glue; only its pure helper (`loadEnv`) is unit-tested, the rest is exercised by a smoke run. Trigger derivation is a pure domain concern (`triggerScan.ts`) so it is reusable and tested.

---

## Task 1: Validation result types

**Files:**
- Modify: `src/domain/types.ts` (append near the other indicator result interfaces)

- [ ] **Step 1: Add the three result interfaces**

Append to `src/domain/types.ts`:

```typescript
/**
 * @internal
 * Aggregate of directional forward returns over a set of bar indices.
 * `meanReturn` is a fraction (0.012 = +1.2%); `hitRate` is the fraction of
 * samples whose directional return was positive (moved as the signal predicts).
 */
export interface ForwardReturnStats {
    count: number;
    hitRate: number;
    meanReturn: number;
}

/**
 * @internal
 * Forward-edge of a signal's trigger set vs the unconditional baseline.
 * `excess*` fields are signal − baseline; `tStat` tests whether the signal's
 * mean directional return exceeds the baseline mean (one-sample t over the
 * signal's returns). Positive excess + |tStat| ≥ 2 ⇒ provisional "signal".
 */
export interface ForwardEdgeResult {
    horizon: number;
    direction: 'up' | 'down';
    triggerCount: number;
    signal: ForwardReturnStats;
    baseline: ForwardReturnStats;
    excessHitRate: number;
    excessMeanReturn: number;
    tStat: number;
}

/**
 * @internal
 * Implementation-correctness check for an indicator series: finite non-null
 * values, values within optional [min,max], and a leading-null warmup count.
 */
export interface SanityResult {
    pass: boolean;
    issues: string[];
}
```

- [ ] **Step 2: Verify typecheck**

Run: `yarn typecheck`
Expected: PASS (no usages yet, types compile).

- [ ] **Step 3: Commit** (route via git-agent)

```bash
git add src/domain/types.ts
git commit -m "feat(validation): add forward-edge result types"
```

---

## Task 2: Baseline forward-return math

**Files:**
- Create: `src/domain/validation/baseline.ts`
- Test: `src/__tests__/domain/validation/baseline.test.ts`

- [ ] **Step 1: Write the failing test**

`src/__tests__/domain/validation/baseline.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
    forwardReturn,
    aggregateForwardReturns,
    computeBaseline,
} from '@/domain/validation/baseline';

describe('forwardReturn', () => {
    const closes = [100, 110, 121]; // +10% each step

    it('computes upward fractional return over horizon', () => {
        expect(forwardReturn(closes, 0, 1, 'up')).toBeCloseTo(0.1, 10);
        expect(forwardReturn(closes, 0, 2, 'up')).toBeCloseTo(0.21, 10);
    });

    it('negates the return for a down-direction signal', () => {
        expect(forwardReturn(closes, 0, 1, 'down')).toBeCloseTo(-0.1, 10);
    });

    it('returns null when horizon runs past the end (worst case)', () => {
        expect(forwardReturn(closes, 2, 1, 'up')).toBeNull();
        expect(forwardReturn(closes, 0, 5, 'up')).toBeNull();
    });

    it('returns null for non-positive base price (worst case)', () => {
        expect(forwardReturn([0, 5], 0, 1, 'up')).toBeNull();
        expect(forwardReturn([-1, 5], 0, 1, 'up')).toBeNull();
    });

    it('returns null for a negative index (worst case)', () => {
        expect(forwardReturn(closes, -1, 1, 'up')).toBeNull();
    });
});

describe('aggregateForwardReturns', () => {
    it('aggregates hit-rate and mean over valid indices only', () => {
        const closes = [100, 110, 99]; // idx0: +10%, idx1: -10%
        const stats = aggregateForwardReturns(closes, [0, 1], 1, 'up');
        expect(stats.count).toBe(2);
        expect(stats.hitRate).toBeCloseTo(0.5, 10);
        expect(stats.meanReturn).toBeCloseTo((0.1 - 0.1) / 2, 10);
    });

    it('skips out-of-range indices', () => {
        const closes = [100, 110];
        const stats = aggregateForwardReturns(closes, [0, 1, 5], 1, 'up');
        expect(stats.count).toBe(1);
    });

    it('returns zeroed stats for an empty / all-invalid index set (worst case)', () => {
        expect(aggregateForwardReturns([100, 110], [], 1, 'up')).toEqual({
            count: 0,
            hitRate: 0,
            meanReturn: 0,
        });
        expect(
            aggregateForwardReturns([100], [0], 1, 'up')
        ).toEqual({ count: 0, hitRate: 0, meanReturn: 0 });
    });
});

describe('computeBaseline', () => {
    it('aggregates over every eligible index [0, n-horizon)', () => {
        const closes = [100, 110, 121, 133.1]; // all +10%
        const base = computeBaseline(closes, 1, 'up');
        expect(base.count).toBe(3);
        expect(base.hitRate).toBeCloseTo(1, 10);
    });

    it('returns zeroed stats when series shorter than horizon (worst case)', () => {
        expect(computeBaseline([100], 1, 'up')).toEqual({
            count: 0,
            hitRate: 0,
            meanReturn: 0,
        });
        expect(computeBaseline([], 1, 'up')).toEqual({
            count: 0,
            hitRate: 0,
            meanReturn: 0,
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/__tests__/domain/validation/baseline.test.ts`
Expected: FAIL — cannot resolve `@/domain/validation/baseline`.

- [ ] **Step 3: Implement `baseline.ts`**

`src/domain/validation/baseline.ts`:

```typescript
import type { ForwardReturnStats } from '@/domain/types';

/**
 * @internal Directional forward return at index `i` over `horizon` bars.
 * Returns null when the window runs out of range or the base price is
 * non-positive. For `'down'` signals the sign is flipped so a positive result
 * always means "price moved as the signal predicts".
 */
export function forwardReturn(
    closes: readonly number[],
    i: number,
    horizon: number,
    direction: 'up' | 'down'
): number | null {
    const j = i + horizon;
    if (i < 0 || j >= closes.length) return null;
    const base = closes[i];
    if (!(base > 0)) return null;
    const r = (closes[j] - base) / base;
    return direction === 'up' ? r : -r;
}

/** @internal Aggregate directional forward returns over the given indices. */
export function aggregateForwardReturns(
    closes: readonly number[],
    indices: readonly number[],
    horizon: number,
    direction: 'up' | 'down'
): ForwardReturnStats {
    const returns: number[] = [];
    for (const i of indices) {
        const r = forwardReturn(closes, i, horizon, direction);
        if (r !== null) returns.push(r);
    }
    const count = returns.length;
    if (count === 0) return { count: 0, hitRate: 0, meanReturn: 0 };
    const hits = returns.filter(r => r > 0).length;
    const meanReturn = returns.reduce((sum, r) => sum + r, 0) / count;
    return { count, hitRate: hits / count, meanReturn };
}

/** @internal Unconditional baseline over every eligible index `[0, n - horizon)`. */
export function computeBaseline(
    closes: readonly number[],
    horizon: number,
    direction: 'up' | 'down'
): ForwardReturnStats {
    const eligible: number[] = [];
    for (let i = 0; i + horizon < closes.length; i++) eligible.push(i);
    return aggregateForwardReturns(closes, eligible, horizon, direction);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/__tests__/domain/validation/baseline.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit** (route via git-agent)

```bash
git add src/domain/validation/baseline.ts src/__tests__/domain/validation/baseline.test.ts
git commit -m "feat(validation): add baseline forward-return math"
```

---

## Task 3: Forward-edge (excess + t-stat)

**Files:**
- Create: `src/domain/validation/forwardEdge.ts`
- Test: `src/__tests__/domain/validation/forwardEdge.test.ts`

- [ ] **Step 1: Write the failing test**

`src/__tests__/domain/validation/forwardEdge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeForwardEdge } from '@/domain/validation/forwardEdge';

describe('computeForwardEdge', () => {
    it('reports positive excess when triggers beat the baseline', () => {
        // closes rise +10% only right after even indices; odd indices fall.
        const closes = [100, 110, 99, 109, 98, 108];
        // triggers at even indices (0,2,4) → each +10% over horizon 1.
        const res = computeForwardEdge(closes, [0, 2, 4], 1, 'up');
        expect(res.triggerCount).toBe(3);
        expect(res.signal.hitRate).toBeCloseTo(1, 10);
        expect(res.excessMeanReturn).toBeGreaterThan(0);
        expect(res.excessHitRate).toBeGreaterThan(0);
    });

    it('emits tStat = 0 when fewer than two valid triggers (worst case)', () => {
        const closes = [100, 110, 121];
        const res = computeForwardEdge(closes, [0], 1, 'up');
        expect(res.tStat).toBe(0);
    });

    it('emits tStat = 0 when signal returns have zero variance (worst case)', () => {
        // every +10% → identical returns → sample std 0 → guarded to 0.
        const closes = [100, 110, 121, 133.1, 146.41];
        const res = computeForwardEdge(closes, [0, 1, 2], 1, 'up');
        expect(res.tStat).toBe(0);
    });

    it('handles an empty trigger set (worst case)', () => {
        const res = computeForwardEdge([100, 110, 121], [], 1, 'up');
        expect(res.triggerCount).toBe(0);
        expect(res.tStat).toBe(0);
        expect(res.excessMeanReturn).toBeCloseTo(-res.baseline.meanReturn, 10);
    });

    it('produces a positive finite tStat for a real edge with variance', () => {
        // triggers' returns vary but are all clearly above baseline.
        const closes = [100, 108, 100, 112, 100, 116, 100];
        const res = computeForwardEdge(closes, [0, 2, 4], 1, 'up');
        expect(Number.isFinite(res.tStat)).toBe(true);
        expect(res.tStat).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/__tests__/domain/validation/forwardEdge.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement `forwardEdge.ts`**

`src/domain/validation/forwardEdge.ts`:

```typescript
import type { ForwardEdgeResult } from '@/domain/types';
import {
    aggregateForwardReturns,
    computeBaseline,
    forwardReturn,
} from '@/domain/validation/baseline';

const MIN_SAMPLES_FOR_TSTAT = 2;

/** @internal Sample (n−1) standard deviation. Returns 0 for fewer than 2 points. */
function sampleStd(xs: readonly number[], mean: number): number {
    if (xs.length < MIN_SAMPLES_FOR_TSTAT) return 0;
    const variance =
        xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (xs.length - 1);
    return Math.sqrt(variance);
}

/**
 * @internal Forward-edge of a signal's trigger indices vs the unconditional
 * baseline. `tStat` is a one-sample t of the signal's directional returns
 * against the baseline mean; guarded to 0 when n < 2 or variance is 0.
 */
export function computeForwardEdge(
    closes: readonly number[],
    triggerIndices: readonly number[],
    horizon: number,
    direction: 'up' | 'down'
): ForwardEdgeResult {
    const baseline = computeBaseline(closes, horizon, direction);
    const signal = aggregateForwardReturns(
        closes,
        triggerIndices,
        horizon,
        direction
    );

    const sigReturns: number[] = [];
    for (const i of triggerIndices) {
        const r = forwardReturn(closes, i, horizon, direction);
        if (r !== null) sigReturns.push(r);
    }
    const sd = sampleStd(sigReturns, signal.meanReturn);
    const n = sigReturns.length;
    const tStat =
        n >= MIN_SAMPLES_FOR_TSTAT && sd > 0
            ? (signal.meanReturn - baseline.meanReturn) / (sd / Math.sqrt(n))
            : 0;

    return {
        horizon,
        direction,
        triggerCount: signal.count,
        signal,
        baseline,
        excessHitRate: signal.hitRate - baseline.hitRate,
        excessMeanReturn: signal.meanReturn - baseline.meanReturn,
        tStat,
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/__tests__/domain/validation/forwardEdge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (route via git-agent)

```bash
git add src/domain/validation/forwardEdge.ts src/__tests__/domain/validation/forwardEdge.test.ts
git commit -m "feat(validation): add forward-edge excess + t-stat"
```

---

## Task 4: Indicator sanity checker

**Files:**
- Create: `src/domain/validation/sanity.ts`
- Test: `src/__tests__/domain/validation/sanity.test.ts`

- [ ] **Step 1: Write the failing test**

`src/__tests__/domain/validation/sanity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { checkSanity } from '@/domain/validation/sanity';

describe('checkSanity', () => {
    it('passes a clean series within bounds with expected warmup', () => {
        const res = checkSanity([null, null, 0.2, 0.8, 0.5], {
            min: 0,
            max: 1,
            expectedWarmup: 2,
        });
        expect(res.pass).toBe(true);
        expect(res.issues).toEqual([]);
    });

    it('flags a NaN value (worst case)', () => {
        const res = checkSanity([0.1, Number.NaN, 0.3]);
        expect(res.pass).toBe(false);
        expect(res.issues.some(i => i.includes('non-finite'))).toBe(true);
    });

    it('flags an Infinity value (worst case)', () => {
        const res = checkSanity([0.1, Number.POSITIVE_INFINITY]);
        expect(res.pass).toBe(false);
        expect(res.issues.some(i => i.includes('non-finite'))).toBe(true);
    });

    it('flags out-of-range values', () => {
        const res = checkSanity([1.5, -0.2], { min: 0, max: 1 });
        expect(res.pass).toBe(false);
        expect(res.issues.some(i => i.includes('above max'))).toBe(true);
        expect(res.issues.some(i => i.includes('below min'))).toBe(true);
    });

    it('flags a warmup-count mismatch', () => {
        const res = checkSanity([null, 0.5], { expectedWarmup: 2 });
        expect(res.pass).toBe(false);
        expect(res.issues.some(i => i.includes('warmup'))).toBe(true);
    });

    it('passes an empty series and an all-null series (worst case)', () => {
        expect(checkSanity([]).pass).toBe(true);
        expect(checkSanity([null, null]).pass).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/__tests__/domain/validation/sanity.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement `sanity.ts`**

`src/domain/validation/sanity.ts`:

```typescript
import type { SanityResult } from '@/domain/types';

interface SanityOptions {
    min?: number;
    max?: number;
    /** Expected number of leading `null` warmup entries. */
    expectedWarmup?: number;
    label?: string;
}

/**
 * @internal Validate an indicator series for implementation correctness:
 * leading-null warmup count, finite non-null values, and optional [min,max]
 * bounds. Aggregates every violation into `issues` rather than throwing.
 */
export function checkSanity(
    series: readonly (number | null)[],
    opts: SanityOptions = {}
): SanityResult {
    const issues: string[] = [];
    const label = opts.label ?? 'series';

    let leadingNulls = 0;
    while (leadingNulls < series.length && series[leadingNulls] === null) {
        leadingNulls++;
    }
    if (
        opts.expectedWarmup !== undefined &&
        leadingNulls !== opts.expectedWarmup
    ) {
        issues.push(
            `${label}: warmup nulls ${leadingNulls} != expected ${opts.expectedWarmup}`
        );
    }

    for (let i = 0; i < series.length; i++) {
        const v = series[i];
        if (v === null) continue;
        if (!Number.isFinite(v)) {
            issues.push(`${label}: non-finite value at index ${i} (${v})`);
            continue;
        }
        if (opts.min !== undefined && v < opts.min) {
            issues.push(`${label}: value ${v} at ${i} below min ${opts.min}`);
        }
        if (opts.max !== undefined && v > opts.max) {
            issues.push(`${label}: value ${v} at ${i} above max ${opts.max}`);
        }
    }

    return { pass: issues.length === 0, issues };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/__tests__/domain/validation/sanity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (route via git-agent)

```bash
git add src/domain/validation/sanity.ts src/__tests__/domain/validation/sanity.test.ts
git commit -m "feat(validation): add indicator sanity checker"
```

---

## Task 5: Causal trigger scan (self-test signal source)

**Files:**
- Create: `src/domain/validation/triggerScan.ts`
- Test: `src/__tests__/domain/validation/triggerScan.test.ts`

> Why: `detectSignals` returns only the most-recent signal per detector, so it cannot enumerate historical triggers. `findCrossIndices` is a causal scan (uses only data ≤ i) that yields every crossover index — exactly what forward-edge needs. Phase 0 uses it for the golden-cross self-test; later phases reuse it for new indicators' crossover signals.

- [ ] **Step 1: Write the failing test**

`src/__tests__/domain/validation/triggerScan.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { findCrossIndices } from '@/domain/validation/triggerScan';

describe('findCrossIndices', () => {
    it('finds upward crossover indices', () => {
        const fast = [1, 1, 3, 3];
        const slow = [2, 2, 2, 2];
        // fast crosses above slow at index 2.
        expect(findCrossIndices(fast, slow, 'up')).toEqual([2]);
    });

    it('finds downward crossover indices', () => {
        const fast = [3, 3, 1, 1];
        const slow = [2, 2, 2, 2];
        expect(findCrossIndices(fast, slow, 'down')).toEqual([2]);
    });

    it('skips bars with null on either series (worst case)', () => {
        const fast = [null, 1, 3, null, 5];
        const slow = [2, 2, 2, 2, 2];
        // only index 2 is a valid up-cross (1<=2 && 3>2). index 4 has prev null.
        expect(findCrossIndices(fast, slow, 'up')).toEqual([2]);
    });

    it('returns empty for no crossover / empty / single-element input (worst case)', () => {
        expect(findCrossIndices([1, 1], [2, 2], 'up')).toEqual([]);
        expect(findCrossIndices([], [], 'up')).toEqual([]);
        expect(findCrossIndices([5], [2], 'up')).toEqual([]);
    });

    it('detects multiple crossovers', () => {
        const fast = [1, 3, 1, 3];
        const slow = [2, 2, 2, 2];
        expect(findCrossIndices(fast, slow, 'up')).toEqual([1, 3]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/__tests__/domain/validation/triggerScan.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement `triggerScan.ts`**

`src/domain/validation/triggerScan.ts`:

```typescript
/**
 * @internal Indices where `fast` crosses above (`'up'`) or below (`'down'`)
 * `slow`. Causal: index `i` is emitted using only bars `i-1` and `i`. Bars
 * with a `null` on either series (at `i` or `i-1`) are skipped.
 */
export function findCrossIndices(
    fast: readonly (number | null)[],
    slow: readonly (number | null)[],
    direction: 'up' | 'down'
): number[] {
    const out: number[] = [];
    const n = Math.min(fast.length, slow.length);
    for (let i = 1; i < n; i++) {
        const f = fast[i];
        const s = slow[i];
        const fp = fast[i - 1];
        const sp = slow[i - 1];
        if (f === null || s === null || fp === null || sp === null) continue;
        if (direction === 'up' && fp <= sp && f > s) out.push(i);
        if (direction === 'down' && fp >= sp && f < s) out.push(i);
    }
    return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/__tests__/domain/validation/triggerScan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (route via git-agent)

```bash
git add src/domain/validation/triggerScan.ts src/__tests__/domain/validation/triggerScan.test.ts
git commit -m "feat(validation): add causal crossover trigger scan"
```

---

## Task 6: Barrel export

**Files:**
- Create: `src/domain/validation/index.ts`

- [ ] **Step 1: Create the barrel**

`src/domain/validation/index.ts`:

```typescript
export * from './baseline';
export * from './forwardEdge';
export * from './sanity';
export * from './triggerScan';
```

- [ ] **Step 2: Verify typecheck + full test run**

Run: `yarn typecheck && yarn test src/__tests__/domain/validation`
Expected: PASS.

- [ ] **Step 3: Commit** (route via git-agent)

```bash
git add src/domain/validation/index.ts
git commit -m "feat(validation): add domain/validation barrel"
```

---

## Task 7: Dependency-free `.env.local` loader (script helper)

**Files:**
- Create: `scripts/validation/loadEnv.ts`
- Test: `src/__tests__/scripts/validation/loadEnv.test.ts`

> Why: the harness reads `FMP_API_KEY` from `../siglens/.env.local`. To avoid adding `dotenv` as a dependency, parse the file with a tiny pure function (the parse logic is unit-tested; the file read is a thin wrapper).

- [ ] **Step 1: Write the failing test**

`src/__tests__/scripts/validation/loadEnv.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseEnv } from '../../../../scripts/validation/loadEnv';

describe('parseEnv', () => {
    it('parses KEY=VALUE lines into a record', () => {
        const env = parseEnv('FMP_API_KEY=abc123\nOTHER=hello');
        expect(env.FMP_API_KEY).toBe('abc123');
        expect(env.OTHER).toBe('hello');
    });

    it('ignores blank lines and # comments (worst case)', () => {
        const env = parseEnv('# comment\n\nFMP_API_KEY=k\n  # indented comment');
        expect(env.FMP_API_KEY).toBe('k');
        expect(Object.keys(env)).toEqual(['FMP_API_KEY']);
    });

    it('strips surrounding single/double quotes and trims', () => {
        expect(parseEnv('A="quoted"').A).toBe('quoted');
        expect(parseEnv("B='quoted'").B).toBe('quoted');
        expect(parseEnv('C = spaced ').C).toBe('spaced');
    });

    it('keeps "=" appearing inside the value', () => {
        expect(parseEnv('URL=https://x?a=b&c=d').URL).toBe(
            'https://x?a=b&c=d'
        );
    });

    it('returns an empty record for empty input (worst case)', () => {
        expect(parseEnv('')).toEqual({});
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/__tests__/scripts/validation/loadEnv.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement `loadEnv.ts`**

`scripts/validation/loadEnv.ts`:

```typescript
import { readFileSync, existsSync } from 'node:fs';

/** Parse `KEY=VALUE` env text into a record. Pure (no I/O). */
export function parseEnv(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (line === '' || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (key !== '') out[key] = value;
    }
    return out;
}

/** Read and parse an `.env` file; returns an empty record when absent. */
export function loadEnvFile(path: string): Record<string, string> {
    if (!existsSync(path)) return {};
    return parseEnv(readFileSync(path, 'utf-8'));
}

/**
 * Resolve `FMP_API_KEY` from the sibling siglens app's `.env.local`
 * (or `process.env` as a fallback). Throws a clear error when missing.
 */
export function requireFmpApiKey(): string {
    const fromProcess = process.env.FMP_API_KEY;
    if (fromProcess) return fromProcess;
    const env = loadEnvFile(
        new URL('../../../siglens/.env.local', import.meta.url).pathname
    );
    const key = env.FMP_API_KEY;
    if (!key) {
        throw new Error(
            'FMP_API_KEY not found in process.env or ../siglens/.env.local'
        );
    }
    return key;
}
```

> Note: `requireFmpApiKey`'s relative URL assumes the standard sibling layout `Project/siglens-core` ↔ `Project/siglens`. From the worktree, prefer the explicit `process.env` path or pass the key via `FMP_API_KEY=… yarn …`. The smoke run in Task 10 documents the exact invocation.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/__tests__/scripts/validation/loadEnv.test.ts`
Expected: PASS (the `parseEnv` cases; `loadEnvFile`/`requireFmpApiKey` are exercised in the smoke run).

- [ ] **Step 5: Commit** (route via git-agent)

```bash
git add scripts/validation/loadEnv.ts src/__tests__/scripts/validation/loadEnv.test.ts
git commit -m "feat(validation): add dependency-free env loader"
```

---

## Task 8: FMP fetch + file cache (60s retry)

**Files:**
- Create: `scripts/validation/fetchData.ts`

- [ ] **Step 1: Implement `fetchData.ts`**

`scripts/validation/fetchData.ts`:

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Bar, Timeframe } from '@y0ngha/siglens-core';
import { requireFmpApiKey } from './loadEnv';

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const CACHE_DIR = join(import.meta.dirname, '.cache');
const RETRY_WAIT_MS = 60_000; // D6: wait 1 minute, then retry
const MAX_RETRIES = 3;
const MS_PER_SECOND = 1000;

const INTRADAY_MAP: Partial<Record<Timeframe, string>> = {
    '15Min': '15min',
    '1Hour': '1hour',
    '4Hour': '4hour',
};

interface FmpRow {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

const sleep = (ms: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms));

function cachePath(symbol: string, tf: Timeframe): string {
    return join(CACHE_DIR, `${symbol.toUpperCase()}_${tf}.json`);
}

/** ISO date string (UTC midnight) → unix seconds. */
function dailyToBar(r: FmpRow): Bar {
    return {
        time: Math.floor(new Date(r.date + 'T00:00:00Z').getTime() / MS_PER_SECOND),
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
    };
}

/** FMP intraday "YYYY-MM-DD HH:mm:ss" (ET) → unix seconds (approx UTC). */
function intradayToBar(r: FmpRow): Bar {
    // ET offset is handled coarsely here (validation tolerance); production uses
    // FmpMarketProvider's exact DST conversion. -5h is a safe constant for edge math.
    const EST_OFFSET = 5;
    const utcMs =
        new Date(r.date.replace(' ', 'T') + 'Z').getTime() +
        EST_OFFSET * 3600 * MS_PER_SECOND;
    return {
        time: Math.floor(utcMs / MS_PER_SECOND),
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
    };
}

async function fmpGetWithRetry(url: string): Promise<FmpRow[]> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = (await res.json()) as FmpRow[];
            if (!Array.isArray(json)) throw new Error('non-array response');
            return json;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (attempt === MAX_RETRIES) {
                throw new Error(`FMP fetch failed after ${MAX_RETRIES} tries: ${msg}`);
            }
            console.warn(
                `  [fetch] attempt ${attempt} failed (${msg}) — waiting 60s then retrying`
            );
            await sleep(RETRY_WAIT_MS); // D6
        }
    }
    return [];
}

/**
 * Fetch ~`from`..`to` bars for one symbol/timeframe, caching to
 * `.cache/{SYMBOL}_{TF}.json`. Cached files are reused unless `refresh` is set.
 * On total fetch failure the caller decides to skip (returns []).
 */
export async function fetchBarsCached(
    symbol: string,
    tf: Timeframe,
    from: string,
    to: string,
    refresh = false
): Promise<Bar[]> {
    mkdirSync(CACHE_DIR, { recursive: true });
    const path = cachePath(symbol, tf);
    if (!refresh && existsSync(path)) {
        return JSON.parse(readFileSync(path, 'utf-8')) as Bar[];
    }

    const apikey = requireFmpApiKey();
    let bars: Bar[];
    if (tf === '1Day') {
        const url = `${FMP_BASE}/historical-price-eod/full?symbol=${symbol}&from=${from}&to=${to}&apikey=${apikey}`;
        bars = (await fmpGetWithRetry(url)).map(dailyToBar).reverse();
    } else {
        const interval = INTRADAY_MAP[tf];
        if (!interval) throw new Error(`unsupported timeframe ${tf}`);
        const url = `${FMP_BASE}/historical-chart/${interval}?symbol=${symbol}&from=${from}&to=${to}&apikey=${apikey}`;
        bars = (await fmpGetWithRetry(url)).map(intradayToBar).reverse();
    }

    if (bars.length > 0) {
        writeFileSync(path, JSON.stringify(bars), 'utf-8'); // D5: persist once
    }
    return bars;
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `yarn typecheck`
Expected: PASS.

> Behavior is verified by the smoke run in Task 10 (real I/O). No unit test — this module is pure I/O glue; its only pure dependency (`parseEnv`) is already tested in Task 7.

- [ ] **Step 3: Commit** (route via git-agent)

```bash
git add scripts/validation/fetchData.ts
git commit -m "feat(validation): add FMP fetch with file cache and 60s retry"
```

---

## Task 9: Runner + golden-cross self-test + report

**Files:**
- Create: `scripts/validation/run.ts`

> Phase 0 deliverable: prove the harness end-to-end on a KNOWN signal (50/200 MA golden cross) before any new indicator exists. Later phases add their indicators' trigger scans here.

- [ ] **Step 1: Implement `run.ts`**

`scripts/validation/run.ts`:

```typescript
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Bar, Timeframe } from '@y0ngha/siglens-core';
import { calculateMA } from '@y0ngha/siglens-core';
import {
    computeForwardEdge,
    findCrossIndices,
} from '@/domain/validation';
import { fetchBarsCached } from './fetchData';

const TICKERS = [
    'AAPL', 'AMZN', 'AVGO', 'GOOGL', 'LLY',
    'META', 'NVDA', 'PLTR', 'TSLA', 'WMT',
] as const;
const TIMEFRAMES: Timeframe[] = ['1Day', '1Hour', '15Min'];
const HORIZONS: Record<Timeframe, number[]> = {
    '1Day': [5, 10, 20],
    '1Hour': [6, 12, 24],
    '15Min': [8, 16, 32],
    '5Min': [],
    '30Min': [],
    '4Hour': [],
};
const FROM = '2025-05-01';
const TO = '2026-06-04';
const GC_FAST = 50;
const GC_SLOW = 200;
const REPORTS_DIR = join(import.meta.dirname, 'reports');

interface EdgeRow {
    ticker: string;
    tf: Timeframe;
    horizon: number;
    triggers: number;
    excessHit: number;
    excessRet: number;
    tStat: number;
}

async function run(): Promise<void> {
    const refresh = process.argv.includes('--refresh');
    const rows: EdgeRow[] = [];

    for (const ticker of TICKERS) {
        for (const tf of TIMEFRAMES) {
            let bars: Bar[];
            try {
                bars = await fetchBarsCached(ticker, tf, FROM, TO, refresh);
            } catch (err) {
                console.warn(`  [skip] ${ticker} ${tf}: ${String(err)}`);
                continue; // D6: skip after retries exhausted
            }
            if (bars.length < GC_SLOW + Math.max(...HORIZONS[tf], 1)) {
                console.warn(
                    `  [skip] ${ticker} ${tf}: insufficient bars (${bars.length})`
                );
                continue;
            }
            const closes = bars.map(b => b.close);
            const fast = calculateMA(bars, GC_FAST);
            const slow = calculateMA(bars, GC_SLOW);
            const triggers = findCrossIndices(fast, slow, 'up');

            for (const horizon of HORIZONS[tf]) {
                const edge = computeForwardEdge(closes, triggers, horizon, 'up');
                rows.push({
                    ticker,
                    tf,
                    horizon,
                    triggers: edge.triggerCount,
                    excessHit: edge.excessHitRate,
                    excessRet: edge.excessMeanReturn,
                    tStat: edge.tStat,
                });
            }
        }
    }

    mkdirSync(REPORTS_DIR, { recursive: true });
    const header = '| ticker | tf | h | triggers | excessHit | excessRet | tStat |';
    const sep = '|---|---|---|---|---|---|---|';
    const body = rows
        .map(
            r =>
                `| ${r.ticker} | ${r.tf} | ${r.horizon} | ${r.triggers} | ${(r.excessHit * 100).toFixed(1)}% | ${(r.excessRet * 100).toFixed(2)}% | ${r.tStat.toFixed(2)} |`
        )
        .join('\n');
    const md = `# Golden Cross (50/200) self-test\n\n${header}\n${sep}\n${body}\n`;
    writeFileSync(join(REPORTS_DIR, 'golden-cross-selftest.md'), md, 'utf-8');
    console.log(`\n[done] ${rows.length} rows → reports/golden-cross-selftest.md`);
}

void run();
```

- [ ] **Step 2: Verify typecheck**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 3: Commit** (route via git-agent)

```bash
git add scripts/validation/run.ts
git commit -m "feat(validation): add runner with golden-cross self-test report"
```

---

## Task 10: `.gitignore`, smoke run, coverage verify

**Files:**
- Modify: `.gitignore`
- Verify: `vitest.config.ts` coverage scope

- [ ] **Step 1: Ignore the cache and reports artifacts**

Append to `.gitignore`:

```
# validation harness local artifacts
/scripts/validation/.cache/
/scripts/validation/reports/
```

- [ ] **Step 2: Run the smoke test against real FMP data**

Run (from the worktree root):
```bash
FMP_API_KEY=$(grep '^FMP_API_KEY=' ../../../siglens/.env.local | cut -d= -f2) npx tsx scripts/validation/run.ts
```
Expected: console logs per ticker/tf; `scripts/validation/reports/golden-cross-selftest.md` written with finite `tStat` values. A second run (no `--refresh`) should be fast (cache hit, no FMP calls). Some intraday (15Min/1Hour) rows may be skipped if FMP lookback is short — that is acceptable (logged).

- [ ] **Step 3: Verify domain/validation coverage ≥ 90% branch**

Run: `yarn test --coverage src/__tests__/domain/validation`
Expected: `src/domain/validation/*` ≥ 90% branch coverage. If `vitest.config.ts` does not include `src/domain/validation` or excludes `scripts/`, adjust the coverage `include`/`exclude` globs so domain/validation is measured and `scripts/` is not required to hit 90%.

- [ ] **Step 4: Full gate**

Run: `yarn lint && yarn typecheck && yarn test`
Expected: PASS.

- [ ] **Step 5: Commit** (route via git-agent)

```bash
git add .gitignore vitest.config.ts
git commit -m "chore(validation): ignore harness artifacts; scope coverage"
```

---

## Self-Review (completed by plan author)

- **Spec coverage (§4):** §4.1 layout → Tasks 2–9 + file structure. §4.2 fetch/cache/60s-retry → Tasks 7–8. §4.3 forward-edge/baseline/excess/t-stat/look-ahead → Tasks 2–3, 5 (causal scan). §4.5 sanity (correctness prong) → Task 4. §4.6 report/determinism → Task 9 (no `Date.now` in stats; all math pure). §4.4 regime/measurement-type validation is **deferred to Phase 1+** (no such indicators exist yet); Phase 0 ships the generic engine + a directional self-test. Noted, not a gap.
- **Placeholder scan:** none — every code step contains complete code; every run step has an exact command + expected result.
- **Type consistency:** `ForwardReturnStats`/`ForwardEdgeResult`/`SanityResult` (Task 1) are used verbatim in Tasks 2–4; `forwardReturn`/`aggregateForwardReturns`/`computeBaseline`/`computeForwardEdge`/`checkSanity`/`findCrossIndices` signatures match across tasks and the barrel (Task 6). `Bar`/`Timeframe`/`calculateMA` are imported from the package's existing public surface.
- **Scope:** Self-contained — produces a working, tested validation harness independent of the later phases.

---

## Follow-up plans (written when each phase is reached)

- **Phase 1** — indicator calculations (15 pure functions + 90% happy/worst tests + `IndicatorResult` wiring).
- **Phase 2** — run harness over Phase 1 indicators; per-indicator edge report; **user decides** signal/advisory/drop.
- **Phase 3** — gating (event SignalTypes + state predicates), prompt rendering, skill docs, + consuming-repo (`siglens`) edits.
- **Phase 4** — RS / benchmark (sector mapping, Redis-cached benchmark bars, RS metrics, prompt section).
