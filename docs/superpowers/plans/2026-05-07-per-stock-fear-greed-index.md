# Per-Stock Fear & Greed Index — Core Algorithm Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** siglens-core에 per-stock Fear & Greed Index의 계산 로직과 분석 prompt 컨텍스트 주입을 추가한다. 17종목에서 검증된 알고리즘(self-normalization 5-factor → 0..100 score → 5단계 라벨)을 Tier 1 public API로 노출하여 siglens 앱이 import해서 사용한다.

**Architecture:** `domain/indicators/fearGreed/` 디렉터리에 6개 모듈(types, percentile util, factors, composition, walkForward, barrel). `domain/analysis/prompt.ts`의 `buildAnalysisPrompt`를 옵셔널 `fearGreed` 컨텍스트를 받도록 확장. siglens 레포가 spec §7 시그니처대로 `computeFearGreedIndex`, `computeFearGreedHistory`, 확장된 `buildAnalysisPrompt`를 import한다.

**Tech Stack:** TypeScript 5, vitest (node env), framework-agnostic pure functions only.

**Spec reference:** siglens 레포 `docs/superpowers/specs/2026-05-07-per-stock-fear-greed-index-design.md` (§2 알고리즘, §4.5 warning 룰, §7 타입, §8 테스트 전략, §9 caveats). 본 plan은 그 spec을 *self-contained*로 inline한다.

**Implementation rules:**
- 모든 작업은 worktree `/Users/y0ngha/Project/siglens-core-fear-greed/` (브랜치 `feat/per-stock-fear-greed-index`)에서 진행. main 브랜치는 변경하지 않는다.
- core는 framework-agnostic — React/Next.js import 금지.
- *코드 작성 전*에 명시된 skill을 invoke한다 (`typescript-advanced-types`, `typescript-expert`).
- TDD: 매 task에 *실패 테스트 → 구현 → 통과 → commit*.

---

## Spec Inline (siglens spec §2/§4.5/§7/§9 핵심 발췌)

### Algorithm (§2)

5-factor raw 산출:

| Group | Factor | 식 |
|---|---|---|
| Flow | Volume z (signed) | `z = (volume_t - mean_20_prev) / std_20_prev`, signed = `z × sign(close_t - close_{t-1})` |
| Flow | Buy/Sell 불균형 | `(buy_vol - sell_vol) / (buy_vol + sell_vol)`; 분모 0이면 0 |
| Flow | POC 거리 | `(close_t - POC_60bar_prev) / POC_60bar_prev`; POC는 직전 60-bar `calculateVolumeProfile` |
| Trend | MA200 거리 | `(close_t - MA200_prev) / MA200_prev`; MA는 직전 200 close 평균 |
| Trend | 52w 위치 | `(close_t - low_252) / (high_252 - low_252)` — *현재 bar 포함* 252-bar 윈도우. high == low면 0.5 |

look-ahead bias 방지: 각 rolling 통계는 *현재 t 미포함* (52w 위치만 예외 — factor 정의상 현재 포함).

Self-percentile (각 factor별):
- 표본은 *t 까지의 valid factor 시계열* (현재 t 미포함, walk-forward 기준)
- `percentile(value, sample)` = `(sample 중 value보다 작은 개수 / sample.length) × 100`
- 0..100, GREED 쪽이 100

합성:
```
flow_score  = avg(volume_z_pctl, buysell_imb_pctl, poc_dist_pctl)
trend_score = avg(ma200_dist_pctl, range_position_pctl)
score       = 0.5 × flow_score + 0.5 × trend_score
```

5단계 컷오프:
```
 0 – 25   EXTREME_FEAR
25 – 45   FEAR
45 – 55   NEUTRAL
55 – 75   GREED
75 – 100  EXTREME_GREED
```

신뢰도:
- 표본(walk-forward 분포 size) ≥ 60 → `'normal'`
- 10..59 → `'limited'`
- < 10 → null 반환 (computeFearGreedIndex)

### §4.5 Warning 룰

- `'CHRONIC_WEAKNESS'`: `MA200 거리 < 0` AND `52w 위치 < 0.30` AND `score ≥ 55`
- `'CHRONIC_STRENGTH'`: `MA200 거리 > 0` AND `52w 위치 > 0.70` AND `score ≤ 45`
- 그 외 `null`

### §7 Public types (그대로 export)

```ts
export type FearGreedLabel
    = 'EXTREME_FEAR' | 'FEAR' | 'NEUTRAL' | 'GREED' | 'EXTREME_GREED';
export type FearGreedConfidence = 'normal' | 'limited' | 'insufficient';
export type FearGreedWarning = 'CHRONIC_WEAKNESS' | 'CHRONIC_STRENGTH' | null;
export type FearGreedFactorKey
    = 'volume_z' | 'buysell_imbalance' | 'poc_distance'
    | 'ma200_distance' | 'range_position';

export interface FearGreedFactor {
    key: FearGreedFactorKey;
    rawValue: number;
    /** 0..100, GREED 쪽이 100 */
    percentile: number;
}
export interface FearGreedGroup {
    name: 'Flow' | 'Trend';
    score: number;
    factors: FearGreedFactor[];
}
export interface FearGreedSnapshot {
    score: number;
    label: FearGreedLabel;
    groups: FearGreedGroup[];
    confidence: FearGreedConfidence;
    sampleSize: number;
    warning: FearGreedWarning;
}
export interface FearGreedHistoryPoint {
    date: string;             // 'YYYY-MM-DD'
    score: number | null;     // warm-up 또는 산출 불가 시 null
    label: FearGreedLabel | null;
}
export interface ComputeFearGreedOptions {
    pocWindow?: number;       // default 60
}

export function computeFearGreedIndex(
    bars: Bar[],
    buySellVolume: BuySellVolumeResult[],
    options?: ComputeFearGreedOptions,
): FearGreedSnapshot | null;

export function computeFearGreedHistory(
    bars: Bar[],
    buySellVolume: BuySellVolumeResult[],
    options?: ComputeFearGreedOptions,
): FearGreedHistoryPoint[];
```

### §9 핵심 caveat
- 신규 상장 등 표본 < 10이면 `computeFearGreedIndex` null 반환.
- buySellVolume 빈 일자(분류 미가능)는 그 일자의 buysell factor 계산 시 0으로.
- 거래 정지 같은 outlier는 해당 일자 factor null 처리, 분포에서 제외.

---

## Working Environment

- **Worktree**: `/Users/y0ngha/Project/siglens-core-fear-greed/`
- **Branch**: `feat/per-stock-fear-greed-index` (base `1d6141a`)
- **node_modules**: 메인 폴더 symlink (이미 setup됨)
- **Vitest test 위치**: `src/__tests__/domain/indicators/fearGreed/` (`vitest.config.ts`의 include 패턴 `src/__tests__/**/*.{test,spec}.ts` 기준)
- main 브랜치는 변경 안 함. 모든 commit은 worktree feat 브랜치에.

---

## File Map

| 파일 | 역할 | 변경 |
|---|---|---|
| `src/domain/indicators/fearGreed/types.ts` | 도메인 타입 | **신규** |
| `src/domain/indicators/fearGreed/percentile.ts` | percentile util | **신규** |
| `src/domain/indicators/fearGreed/factors.ts` | 5-factor raw 산출 | **신규** |
| `src/domain/indicators/fearGreed/composition.ts` | group·score·label·warning | **신규** |
| `src/domain/indicators/fearGreed/walkForward.ts` | snapshot·history walk-forward | **신규** |
| `src/domain/indicators/fearGreed/index.ts` | barrel re-export | **신규** |
| `src/__tests__/domain/indicators/fearGreed/percentile.test.ts` | unit | **신규** |
| `src/__tests__/domain/indicators/fearGreed/factors.test.ts` | unit | **신규** |
| `src/__tests__/domain/indicators/fearGreed/composition.test.ts` | unit (cutoffs · warning) | **신규** |
| `src/__tests__/domain/indicators/fearGreed/walkForward.test.ts` | unit (look-ahead 부재) | **신규** |
| `src/domain/types.ts` | FearGreed 타입 re-export | 수정 |
| `src/domain/indicators/index.ts` | calculateFearGreed* re-export | (필요 시 수정 — 보통 우리는 application/ 또는 별도 entry 사용) |
| `src/domain/analysis/prompt.ts` | `buildAnalysisPrompt` fearGreed 컨텍스트 주입 | 수정 |
| `src/__tests__/domain/analysis/prompt.test.ts` | prompt 확장 테스트 | 수정/신규 |
| `src/index.ts` (Tier 1) + `src/index.client.ts` | computeFearGreedIndex / computeFearGreedHistory / FearGreed* 타입 export | 수정 |
| `docs/PUBLIC_API.md` | Tier 1 인벤토리 갱신 | 수정 |

---

## Task 1: 도메인 타입

**Skills**: `typescript-advanced-types`, `typescript-expert`

**Files:**
- Create: `src/domain/indicators/fearGreed/types.ts`

- [ ] **Step 1: 파일 작성**

```ts
import type { Bar, BuySellVolumeResult } from '@/domain/types';

export type FearGreedLabel =
    | 'EXTREME_FEAR'
    | 'FEAR'
    | 'NEUTRAL'
    | 'GREED'
    | 'EXTREME_GREED';

export type FearGreedConfidence = 'normal' | 'limited' | 'insufficient';

export type FearGreedWarning = 'CHRONIC_WEAKNESS' | 'CHRONIC_STRENGTH' | null;

export type FearGreedFactorKey =
    | 'volume_z'
    | 'buysell_imbalance'
    | 'poc_distance'
    | 'ma200_distance'
    | 'range_position';

export interface FearGreedFactor {
    key: FearGreedFactorKey;
    rawValue: number;
    /** 0..100, GREED 쪽이 100 */
    percentile: number;
}

export interface FearGreedGroup {
    name: 'Flow' | 'Trend';
    score: number;
    factors: FearGreedFactor[];
}

export interface FearGreedSnapshot {
    score: number;
    label: FearGreedLabel;
    groups: FearGreedGroup[];
    confidence: FearGreedConfidence;
    sampleSize: number;
    warning: FearGreedWarning;
}

export interface FearGreedHistoryPoint {
    /** ISO 'YYYY-MM-DD' */
    date: string;
    score: number | null;
    label: FearGreedLabel | null;
}

export interface ComputeFearGreedOptions {
    /** Volume Profile POC 산출 윈도우. default 60 */
    pocWindow?: number;
}

/** 내부 5-factor raw 값 묶음 (private; export 안 함) */
export interface FactorValues {
    volumeZ: number;
    buySellImb: number;
    pocDist: number;
    ma200Dist: number;
    rangePosition: number;
}

/** 입력 묶음 — 컨슈머 호출부 단순화에 도움 */
export interface FearGreedInput {
    bars: Bar[];
    buySellVolume: BuySellVolumeResult[];
}
```

- [ ] **Step 2: typecheck**

```bash
cd /Users/y0ngha/Project/siglens-core-fear-greed && yarn typecheck
```

Expected: 에러 없음.

- [ ] **Step 3: commit**

```bash
git add src/domain/indicators/fearGreed/types.ts
git commit -m "feat(fearGreed): add domain types"
```

---

## Task 2: percentile utility

**Skills**: `typescript-expert`

**Files:**
- Create: `src/domain/indicators/fearGreed/percentile.ts`
- Create: `src/__tests__/domain/indicators/fearGreed/percentile.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/__tests__/domain/indicators/fearGreed/percentile.test.ts
import { describe, expect, it } from 'vitest';
import { percentile } from '@/domain/indicators/fearGreed/percentile';

describe('percentile', () => {
    it('returns 50 for empty sample', () => {
        expect(percentile(0, [])).toBe(50);
    });
    it('returns 0 when value is below all samples', () => {
        expect(percentile(-1, [0, 1, 2, 3])).toBe(0);
    });
    it('returns 100 when value is above all samples', () => {
        expect(percentile(100, [0, 1, 2, 3])).toBe(100);
    });
    it('returns proportion strictly below value', () => {
        // sample [0,1,2,3], value=2 → 2개 below(0,1) / 4 = 50
        expect(percentile(2, [0, 1, 2, 3])).toBe(50);
    });
    it('handles unsorted input', () => {
        expect(percentile(2, [3, 1, 0, 2])).toBe(50);
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
yarn test src/__tests__/domain/indicators/fearGreed/percentile.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: 구현**

```ts
// src/domain/indicators/fearGreed/percentile.ts
/**
 * Returns the percentile of `value` within `sample` as a number in [0, 100].
 *
 * Definition: count of elements strictly less than `value`, divided by sample size.
 * Empty sample → 50 (neutral fallback).
 *
 * Pure function. No look-ahead bias mitigation here — caller is responsible for
 * passing a sample that excludes the current observation when walk-forward is desired.
 */
export function percentile(value: number, sample: number[]): number {
    if (sample.length === 0) return 50;
    let below = 0;
    for (const v of sample) {
        if (v < value) below++;
    }
    return (below / sample.length) * 100;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
yarn test src/__tests__/domain/indicators/fearGreed/percentile.test.ts
```

Expected: PASS (5 cases).

- [ ] **Step 5: lint**

```bash
yarn lint
```

- [ ] **Step 6: commit**

```bash
git add src/domain/indicators/fearGreed/percentile.ts src/__tests__/domain/indicators/fearGreed/percentile.test.ts
git commit -m "feat(fearGreed): add percentile utility"
```

---

## Task 3: 5-factor raw 산출

**Skills**: `typescript-expert`, `typescript-advanced-types`

**Files:**
- Create: `src/domain/indicators/fearGreed/factors.ts`
- Create: `src/__tests__/domain/indicators/fearGreed/factors.test.ts`

`computeFactorsAtT(bars, buySellVolume, t, pocWindow)`이 t 시점의 5-factor raw 값을 반환. t < 1 또는 임의 input 부족 시 null.

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/__tests__/domain/indicators/fearGreed/factors.test.ts
import { describe, expect, it } from 'vitest';
import type { Bar, BuySellVolumeResult } from '@/domain/types';
import { computeFactorsAtT } from '@/domain/indicators/fearGreed/factors';

function fakeBar(time: number, close: number, volume = 1_000_000): Bar {
    return { time, open: close, high: close * 1.01, low: close * 0.99, close, volume };
}

describe('computeFactorsAtT', () => {
    it('returns null when t < 1', () => {
        const bars = [fakeBar(1, 100)];
        const bsv: BuySellVolumeResult[] = [{ buyVolume: 0, sellVolume: 0 }];
        expect(computeFactorsAtT(bars, bsv, 0)).toBeNull();
    });

    it('returns null when window has fewer than 5 elements pre-t', () => {
        const bars = [fakeBar(1, 100), fakeBar(2, 101)];
        const bsv: BuySellVolumeResult[] = [
            { buyVolume: 0, sellVolume: 0 },
            { buyVolume: 0, sellVolume: 0 },
        ];
        expect(computeFactorsAtT(bars, bsv, 1)).toBeNull();
    });

    it('returns positive volumeZ when volume spike on up day', () => {
        // 30 bars, last has 5x volume on up day → signed z 양수
        const bars: Bar[] = [];
        for (let i = 0; i < 30; i++) {
            bars.push(fakeBar(i + 1, 100 + i * 0.1, 1_000_000));
        }
        bars[29] = fakeBar(30, 110, 5_000_000);
        const bsv: BuySellVolumeResult[] = bars.map(() => ({
            buyVolume: 600_000,
            sellVolume: 400_000,
        }));
        const result = computeFactorsAtT(bars, bsv, 29);
        expect(result).not.toBeNull();
        expect(result!.volumeZ).toBeGreaterThan(0);
        expect(result!.buySellImb).toBeCloseTo(0.2, 2);
    });

    it('returns range_position 1.0 when current close == 252-window high (현재 포함)', () => {
        const bars: Bar[] = [];
        for (let i = 0; i < 50; i++) {
            bars.push(fakeBar(i + 1, 100, 1_000_000));
        }
        // 마지막 bar에서 close 110, high 110 (윈도우 신고가)
        bars[49] = { time: 50, open: 100, high: 110, low: 99, close: 110, volume: 1_000_000 };
        const bsv: BuySellVolumeResult[] = bars.map(() => ({ buyVolume: 0, sellVolume: 0 }));
        const result = computeFactorsAtT(bars, bsv, 49);
        expect(result).not.toBeNull();
        // close 110 == high 110 → 1.0
        expect(result!.rangePosition).toBeCloseTo(1.0, 5);
    });

    it('handles empty buySellVolume entry → buySellImb = 0', () => {
        const bars: Bar[] = [];
        for (let i = 0; i < 30; i++) {
            bars.push(fakeBar(i + 1, 100 + i, 1_000_000));
        }
        const bsv: BuySellVolumeResult[] = bars.map(() => ({ buyVolume: 0, sellVolume: 0 }));
        const result = computeFactorsAtT(bars, bsv, 29);
        expect(result?.buySellImb).toBe(0);
    });
});
```

- [ ] **Step 2: 실패 확인**

```bash
yarn test src/__tests__/domain/indicators/fearGreed/factors.test.ts
```

Expected: FAIL.

- [ ] **Step 3: 구현**

```ts
// src/domain/indicators/fearGreed/factors.ts
import type { Bar, BuySellVolumeResult } from '@/domain/types';
import { calculateVolumeProfile } from '@/domain/indicators/volume-profile';
import type { FactorValues } from '@/domain/indicators/fearGreed/types';

const VOL_Z_WINDOW = 20;
const POC_WINDOW_DEFAULT = 60;
const MA200_WINDOW = 200;
const RANGE_WINDOW = 252;

/**
 * Compute the 5-factor raw values at index `t`. Returns `null` when:
 * - t < 1
 * - the rolling window for any factor has fewer than its minimum sample size
 * - VolumeProfile fails to produce a POC (e.g. all-zero volumes in window)
 *
 * look-ahead avoidance: rolling stats use bars[wStart..t) (current bar excluded).
 * Exception per spec §2.3: 52w high/low includes the current bar by definition,
 * so the result stays within [0, 1] even on new highs/lows.
 */
export function computeFactorsAtT(
    bars: Bar[],
    buySellVolume: BuySellVolumeResult[],
    t: number,
    pocWindow: number = POC_WINDOW_DEFAULT
): FactorValues | null {
    if (t < 1) return null;
    const bar = bars[t];
    const prev = bars[t - 1];
    if (!bar || !prev) return null;

    // Volume z (signed) — rolling 20, 현재 t 미포함
    const wStart = Math.max(0, t - VOL_Z_WINDOW);
    const window = bars.slice(wStart, t).map(b => b.volume);
    if (window.length < 5) return null;
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance =
        window.reduce((a, v) => a + (v - mean) ** 2, 0) / window.length;
    const std = Math.sqrt(variance);
    if (std === 0) return null;
    const z = (bar.volume - mean) / std;
    const dailyReturn = bar.close - prev.close;
    const sign = dailyReturn === 0 ? 0 : Math.sign(dailyReturn);
    const volumeZ = z * sign;

    // Buy/Sell 불균형 — t bar 자체 분류
    let buySellImb = 0;
    const bsv = buySellVolume[t];
    if (bsv) {
        const total = bsv.buyVolume + bsv.sellVolume;
        if (total > 0) {
            buySellImb = (bsv.buyVolume - bsv.sellVolume) / total;
        }
    }

    // POC 거리 — 60-bar window (현재 미포함)
    const pocStart = Math.max(0, t - pocWindow);
    const pocBars = bars.slice(pocStart, t);
    if (pocBars.length < 5) return null;
    const vp = calculateVolumeProfile(pocBars);
    if (!vp) return null;
    const pocDist = (bar.close - vp.poc) / vp.poc;

    // MA200 거리 — 직전 200 close (현재 미포함). 30 미만이면 null.
    const ma200Start = Math.max(0, t - MA200_WINDOW);
    const ma200Closes = bars.slice(ma200Start, t).map(b => b.close);
    if (ma200Closes.length < 30) return null;
    const ma200 =
        ma200Closes.reduce((a, b) => a + b, 0) / ma200Closes.length;
    const ma200Dist = (bar.close - ma200) / ma200;

    // 52w 위치 — 현재 bar 포함 252 윈도우 (factor 정의상). 30 미만이면 null.
    const rangeStart = Math.max(0, t - RANGE_WINDOW + 1);
    const rangeBars = bars.slice(rangeStart, t + 1);
    if (rangeBars.length < 30) return null;
    const high = Math.max(...rangeBars.map(b => b.high));
    const low = Math.min(...rangeBars.map(b => b.low));
    const rangePosition =
        high === low ? 0.5 : (bar.close - low) / (high - low);

    return { volumeZ, buySellImb, pocDist, ma200Dist, rangePosition };
}
```

- [ ] **Step 4: 통과 확인**

```bash
yarn test src/__tests__/domain/indicators/fearGreed/factors.test.ts
```

Expected: PASS (5 cases).

- [ ] **Step 5: lint, commit**

```bash
yarn lint
git add src/domain/indicators/fearGreed/factors.ts src/__tests__/domain/indicators/fearGreed/factors.test.ts
git commit -m "feat(fearGreed): add 5-factor raw computation"
```

---

## Task 4: composition (group · score · label · warning)

**Skills**: `typescript-expert`

**Files:**
- Create: `src/domain/indicators/fearGreed/composition.ts`
- Create: `src/__tests__/domain/indicators/fearGreed/composition.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/__tests__/domain/indicators/fearGreed/composition.test.ts
import { describe, expect, it } from 'vitest';
import {
    scoreToLabel,
    detectWarning,
    composeSnapshot,
} from '@/domain/indicators/fearGreed/composition';
import type { FactorValues } from '@/domain/indicators/fearGreed/types';

describe('scoreToLabel', () => {
    it.each([
        [0, 'EXTREME_FEAR'],
        [24.99, 'EXTREME_FEAR'],
        [25, 'FEAR'],
        [44.99, 'FEAR'],
        [45, 'NEUTRAL'],
        [54.99, 'NEUTRAL'],
        [55, 'GREED'],
        [74.99, 'GREED'],
        [75, 'EXTREME_GREED'],
        [100, 'EXTREME_GREED'],
    ])('score %f → %s', (score, label) => {
        expect(scoreToLabel(score)).toBe(label);
    });
});

describe('detectWarning', () => {
    const baseRaw: FactorValues = {
        volumeZ: 0,
        buySellImb: 0,
        pocDist: 0,
        ma200Dist: 0,
        rangePosition: 0.5,
    };

    it('returns CHRONIC_WEAKNESS when MA200 < 0 AND 52w < 0.30 AND score >= 55', () => {
        expect(
            detectWarning(60, { ...baseRaw, ma200Dist: -0.05, rangePosition: 0.2 })
        ).toBe('CHRONIC_WEAKNESS');
    });

    it('returns CHRONIC_STRENGTH when MA200 > 0 AND 52w > 0.70 AND score <= 45', () => {
        expect(
            detectWarning(40, { ...baseRaw, ma200Dist: 0.05, rangePosition: 0.85 })
        ).toBe('CHRONIC_STRENGTH');
    });

    it('returns null in NEUTRAL or non-paradox cases', () => {
        expect(
            detectWarning(50, { ...baseRaw, ma200Dist: 0, rangePosition: 0.5 })
        ).toBeNull();
        // MA200 < 0 but score < 55 → null
        expect(
            detectWarning(40, { ...baseRaw, ma200Dist: -0.05, rangePosition: 0.2 })
        ).toBeNull();
        // 52w 0.30 boundary inclusive on the GREED side: 0.30 should NOT trigger
        expect(
            detectWarning(60, { ...baseRaw, ma200Dist: -0.05, rangePosition: 0.30 })
        ).toBeNull();
    });
});

describe('composeSnapshot', () => {
    it('returns null when factors null', () => {
        expect(composeSnapshot(null, [], 0)).toBeNull();
    });

    it('returns confidence "insufficient" when sample < 10', () => {
        const factors: FactorValues = {
            volumeZ: 0,
            buySellImb: 0,
            pocDist: 0,
            ma200Dist: 0,
            rangePosition: 0.5,
        };
        // 5 samples
        const samples: FactorValues[] = Array(5).fill(factors);
        const snap = composeSnapshot(factors, samples, 5);
        expect(snap).toBeNull();
    });

    it('returns confidence "limited" when 10 <= sample < 60', () => {
        const factors: FactorValues = {
            volumeZ: 0,
            buySellImb: 0,
            pocDist: 0,
            ma200Dist: 0,
            rangePosition: 0.5,
        };
        const samples: FactorValues[] = Array(30).fill(factors);
        const snap = composeSnapshot(factors, samples, 30);
        expect(snap?.confidence).toBe('limited');
    });

    it('returns confidence "normal" when sample >= 60 and computes score', () => {
        const factors: FactorValues = {
            volumeZ: 0,
            buySellImb: 0,
            pocDist: 0,
            ma200Dist: 0,
            rangePosition: 0.5,
        };
        const samples: FactorValues[] = Array(60).fill(factors);
        const snap = composeSnapshot(factors, samples, 60);
        expect(snap?.confidence).toBe('normal');
        expect(snap?.score).toBeCloseTo(50, 1);
        expect(snap?.label).toBe('NEUTRAL');
        expect(snap?.groups.length).toBe(2);
        expect(snap?.groups[0].name).toBe('Flow');
        expect(snap?.groups[1].name).toBe('Trend');
    });
});
```

- [ ] **Step 2: 실패 확인**

```bash
yarn test src/__tests__/domain/indicators/fearGreed/composition.test.ts
```

- [ ] **Step 3: 구현**

```ts
// src/domain/indicators/fearGreed/composition.ts
import type {
    FearGreedConfidence,
    FearGreedFactor,
    FearGreedFactorKey,
    FearGreedGroup,
    FearGreedLabel,
    FearGreedSnapshot,
    FearGreedWarning,
    FactorValues,
} from '@/domain/indicators/fearGreed/types';
import { percentile } from '@/domain/indicators/fearGreed/percentile';

export function scoreToLabel(score: number): FearGreedLabel {
    if (score < 25) return 'EXTREME_FEAR';
    if (score < 45) return 'FEAR';
    if (score < 55) return 'NEUTRAL';
    if (score < 75) return 'GREED';
    return 'EXTREME_GREED';
}

/**
 * Spec §4.5 self-norm warning detection. Symmetric chronic weakness/strength.
 */
export function detectWarning(
    score: number,
    raw: FactorValues
): FearGreedWarning {
    if (raw.ma200Dist < 0 && raw.rangePosition < 0.3 && score >= 55) {
        return 'CHRONIC_WEAKNESS';
    }
    if (raw.ma200Dist > 0 && raw.rangePosition > 0.7 && score <= 45) {
        return 'CHRONIC_STRENGTH';
    }
    return null;
}

const FLOW_KEYS = ['volume_z', 'buysell_imbalance', 'poc_distance'] as const;
const TREND_KEYS = ['ma200_distance', 'range_position'] as const;

interface PctlByKey {
    volume_z: number;
    buysell_imbalance: number;
    poc_distance: number;
    ma200_distance: number;
    range_position: number;
}

function computePctls(current: FactorValues, sample: FactorValues[]): PctlByKey {
    return {
        volume_z: percentile(current.volumeZ, sample.map(s => s.volumeZ)),
        buysell_imbalance: percentile(
            current.buySellImb,
            sample.map(s => s.buySellImb)
        ),
        poc_distance: percentile(current.pocDist, sample.map(s => s.pocDist)),
        ma200_distance: percentile(
            current.ma200Dist,
            sample.map(s => s.ma200Dist)
        ),
        range_position: percentile(
            current.rangePosition,
            sample.map(s => s.rangePosition)
        ),
    };
}

function rawValue(current: FactorValues, key: FearGreedFactorKey): number {
    switch (key) {
        case 'volume_z':
            return current.volumeZ;
        case 'buysell_imbalance':
            return current.buySellImb;
        case 'poc_distance':
            return current.pocDist;
        case 'ma200_distance':
            return current.ma200Dist;
        case 'range_position':
            return current.rangePosition;
    }
}

function buildFactors(
    current: FactorValues,
    pctls: PctlByKey,
    keys: ReadonlyArray<FearGreedFactorKey>
): FearGreedFactor[] {
    return keys.map(k => ({
        key: k,
        rawValue: rawValue(current, k),
        percentile: pctls[k],
    }));
}

function classifyConfidence(sampleSize: number): FearGreedConfidence {
    if (sampleSize >= 60) return 'normal';
    if (sampleSize >= 10) return 'limited';
    return 'insufficient';
}

/**
 * Compose a snapshot from current raw factors + walk-forward sample.
 *
 * @param current — t 시점 5-factor raw 값 (null이면 snapshot 생성 불가)
 * @param sample — t 미포함, t 이전 valid factor 시계열
 * @param sampleSize — sample.length (caller가 전달; 명시 인자라 디버깅 용이)
 * @returns FearGreedSnapshot 또는 null (insufficient)
 */
export function composeSnapshot(
    current: FactorValues | null,
    sample: FactorValues[],
    sampleSize: number
): FearGreedSnapshot | null {
    if (!current) return null;
    const confidence = classifyConfidence(sampleSize);
    if (confidence === 'insufficient') return null;

    const pctls = computePctls(current, sample);

    const flowFactors = buildFactors(current, pctls, FLOW_KEYS);
    const trendFactors = buildFactors(current, pctls, TREND_KEYS);

    const flowScore =
        flowFactors.reduce((a, f) => a + f.percentile, 0) / flowFactors.length;
    const trendScore =
        trendFactors.reduce((a, f) => a + f.percentile, 0) /
        trendFactors.length;
    const score = 0.5 * flowScore + 0.5 * trendScore;
    const label = scoreToLabel(score);
    const warning = detectWarning(score, current);

    const groups: FearGreedGroup[] = [
        { name: 'Flow', score: flowScore, factors: flowFactors },
        { name: 'Trend', score: trendScore, factors: trendFactors },
    ];

    return { score, label, groups, confidence, sampleSize, warning };
}
```

- [ ] **Step 4: 통과**

```bash
yarn test src/__tests__/domain/indicators/fearGreed/composition.test.ts
```

- [ ] **Step 5: lint, commit**

```bash
yarn lint
git add src/domain/indicators/fearGreed/composition.ts src/__tests__/domain/indicators/fearGreed/composition.test.ts
git commit -m "feat(fearGreed): add composition (groups, score, label, warning)"
```

---

## Task 5: walk-forward — snapshot · history

**Skills**: `typescript-expert`

**Files:**
- Create: `src/domain/indicators/fearGreed/walkForward.ts`
- Create: `src/__tests__/domain/indicators/fearGreed/walkForward.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/__tests__/domain/indicators/fearGreed/walkForward.test.ts
import { describe, expect, it } from 'vitest';
import type { Bar, BuySellVolumeResult } from '@/domain/types';
import {
    computeFearGreedIndex,
    computeFearGreedHistory,
} from '@/domain/indicators/fearGreed/walkForward';

function genBars(count: number, basePrice = 100): Bar[] {
    const bars: Bar[] = [];
    for (let i = 0; i < count; i++) {
        const close = basePrice + Math.sin(i / 10) * 5;
        bars.push({
            time: 1_700_000_000 + i * 86_400,
            open: close,
            high: close + 1,
            low: close - 1,
            close,
            volume: 1_000_000 + Math.random() * 100_000,
        });
    }
    return bars;
}

function genBsv(count: number): BuySellVolumeResult[] {
    return Array.from({ length: count }, () => ({
        buyVolume: 600_000,
        sellVolume: 400_000,
    }));
}

describe('computeFearGreedIndex', () => {
    it('returns null for too-few bars', () => {
        const bars = genBars(20);
        expect(computeFearGreedIndex(bars, genBsv(20))).toBeNull();
    });
    it('returns snapshot when bars >= warmup + factor windows', () => {
        const bars = genBars(300);
        const snap = computeFearGreedIndex(bars, genBsv(300));
        expect(snap).not.toBeNull();
        expect(snap!.confidence).toBe('normal');
        expect(snap!.score).toBeGreaterThanOrEqual(0);
        expect(snap!.score).toBeLessThanOrEqual(100);
        expect(snap!.groups).toHaveLength(2);
        // 5 factors total
        const factorCount =
            snap!.groups[0].factors.length + snap!.groups[1].factors.length;
        expect(factorCount).toBe(5);
    });
});

describe('computeFearGreedHistory', () => {
    it('returns array length equal to bars.length, with nulls in warm-up', () => {
        const bars = genBars(100);
        const history = computeFearGreedHistory(bars, genBsv(100));
        expect(history).toHaveLength(100);
        // warm-up 60 bars + factor window 가산이라 첫 ~60-90 bar는 score=null
        expect(history[0].score).toBeNull();
        expect(history[history.length - 1].score).not.toBeNull();
    });

    it('does not have look-ahead bias — history at index i unchanged when bars are added beyond i', () => {
        const bars1 = genBars(200);
        const bars2 = [...bars1, ...genBars(100, 110)];
        const h1 = computeFearGreedHistory(bars1, genBsv(200));
        const h2 = computeFearGreedHistory(bars2, genBsv(300));
        // 마지막 인덱스(199)에서 score가 같아야 한다 (해당 시점까지의 분포는 동일)
        expect(h2[199].score).toBeCloseTo(h1[199].score!, 5);
    });
});
```

- [ ] **Step 2: 실패 확인**

```bash
yarn test src/__tests__/domain/indicators/fearGreed/walkForward.test.ts
```

- [ ] **Step 3: 구현**

```ts
// src/domain/indicators/fearGreed/walkForward.ts
import type { Bar, BuySellVolumeResult } from '@/domain/types';
import {
    computeFactorsAtT,
} from '@/domain/indicators/fearGreed/factors';
import { composeSnapshot, scoreToLabel } from '@/domain/indicators/fearGreed/composition';
import type {
    ComputeFearGreedOptions,
    FactorValues,
    FearGreedHistoryPoint,
    FearGreedSnapshot,
} from '@/domain/indicators/fearGreed/types';

const POC_WINDOW_DEFAULT = 60;

function buildFactorTS(
    bars: Bar[],
    buySellVolume: BuySellVolumeResult[],
    pocWindow: number
): Array<FactorValues | null> {
    const out: Array<FactorValues | null> = new Array(bars.length);
    for (let t = 0; t < bars.length; t++) {
        out[t] = computeFactorsAtT(bars, buySellVolume, t, pocWindow);
    }
    return out;
}

function isoDate(unixSec: number): string {
    return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

/**
 * Snapshot at the *latest* bar. Walk-forward distribution = factor TS up to t-1.
 * Returns null if the latest factor or its sample is insufficient.
 */
export function computeFearGreedIndex(
    bars: Bar[],
    buySellVolume: BuySellVolumeResult[],
    options: ComputeFearGreedOptions = {}
): FearGreedSnapshot | null {
    const pocWindow = options.pocWindow ?? POC_WINDOW_DEFAULT;
    if (bars.length === 0) return null;

    const factorTS = buildFactorTS(bars, buySellVolume, pocWindow);
    const t = bars.length - 1;
    const current = factorTS[t];
    if (!current) return null;

    const sample = factorTS
        .slice(0, t)
        .filter((f): f is FactorValues => f !== null);

    return composeSnapshot(current, sample, sample.length);
}

/**
 * Walk-forward history. For each t, distribution = valid factor TS in [0..t).
 * No look-ahead: subsequent bars never affect score at earlier indices.
 */
export function computeFearGreedHistory(
    bars: Bar[],
    buySellVolume: BuySellVolumeResult[],
    options: ComputeFearGreedOptions = {}
): FearGreedHistoryPoint[] {
    const pocWindow = options.pocWindow ?? POC_WINDOW_DEFAULT;
    const factorTS = buildFactorTS(bars, buySellVolume, pocWindow);
    const out: FearGreedHistoryPoint[] = new Array(bars.length);

    // 누적 valid factor list — incremental 갱신
    const sample: FactorValues[] = [];

    for (let t = 0; t < bars.length; t++) {
        const date = isoDate(bars[t].time);
        const current = factorTS[t];
        const sampleSize = sample.length; // t 미포함

        if (!current) {
            out[t] = { date, score: null, label: null };
            continue;
        }

        if (sampleSize < 60) {
            // confidence 'limited' / 'insufficient' both → null in history
            // (history는 reliable 점수만 표시 — limited 점수는 caveat)
            // sample push는 *이번 t의 current가 들어가야 다음 t에서 활용*
            sample.push(current);
            out[t] = { date, score: null, label: null };
            continue;
        }

        const snap = composeSnapshot(current, sample, sampleSize);
        if (!snap) {
            out[t] = { date, score: null, label: null };
        } else {
            out[t] = { date, score: snap.score, label: snap.label };
        }
        sample.push(current);
    }
    return out;
}
```

(주: history는 confidence 'limited' 점수도 null로 처리해 일관된 reliable line만 그린다. 'limited'는 snapshot에서만 노출 — UI가 배지로 별도 처리.)

- [ ] **Step 4: 통과**

```bash
yarn test src/__tests__/domain/indicators/fearGreed/walkForward.test.ts
```

- [ ] **Step 5: lint, commit**

```bash
yarn lint
git add src/domain/indicators/fearGreed/walkForward.ts src/__tests__/domain/indicators/fearGreed/walkForward.test.ts
git commit -m "feat(fearGreed): add walk-forward snapshot and history"
```

---

## Task 6: barrel + types re-export

**Skills**: `typescript-expert`

**Files:**
- Create: `src/domain/indicators/fearGreed/index.ts`
- Modify: `src/domain/types.ts`

- [ ] **Step 1: barrel 작성**

```ts
// src/domain/indicators/fearGreed/index.ts
export type {
    FearGreedLabel,
    FearGreedConfidence,
    FearGreedWarning,
    FearGreedFactorKey,
    FearGreedFactor,
    FearGreedGroup,
    FearGreedSnapshot,
    FearGreedHistoryPoint,
    ComputeFearGreedOptions,
} from '@/domain/indicators/fearGreed/types';
export {
    computeFearGreedIndex,
    computeFearGreedHistory,
} from '@/domain/indicators/fearGreed/walkForward';
```

- [ ] **Step 2: types.ts에 re-export 추가**

`src/domain/types.ts`의 적절한 위치에 다음 한 줄 추가:

```ts
export type {
    FearGreedLabel,
    FearGreedConfidence,
    FearGreedWarning,
    FearGreedFactorKey,
    FearGreedFactor,
    FearGreedGroup,
    FearGreedSnapshot,
    FearGreedHistoryPoint,
    ComputeFearGreedOptions,
} from '@/domain/indicators/fearGreed/types';
```

위치: 다른 indicator types(BuySellVolumeResult, VolumeProfileResult 등) 근처. `grep -n 'BuySellVolumeResult' src/domain/types.ts`로 위치 확인 후 그 근처에 삽입.

- [ ] **Step 3: typecheck**

```bash
yarn typecheck
```

- [ ] **Step 4: commit**

```bash
git add src/domain/indicators/fearGreed/index.ts src/domain/types.ts
git commit -m "feat(fearGreed): add barrel and re-export types in domain/types"
```

---

## Task 7: Tier 1 public API export — `src/index.ts` + `src/index.client.ts`

**Skills**: `typescript-expert`

**Files:**
- Modify: `src/index.ts`
- Modify: `src/index.client.ts`
- Modify: `docs/PUBLIC_API.md`

- [ ] **Step 1: index.ts에 함수 export 추가**

`src/index.ts`에서 `calculateVolumeProfile` 등이 export되는 indicator 묶음 export 라인을 찾는다. 그 라인에 `computeFearGreedIndex`, `computeFearGreedHistory`를 추가한다.

기존:
```ts
export {
    ...,
    calculateVolumeProfile,
    ...,
} from './domain/indicators';
```

변경: `domain/indicators`가 fearGreed barrel을 re-export하지 않으므로, 별도 export 라인을 추가한다:

```ts
export {
    computeFearGreedIndex,
    computeFearGreedHistory,
} from './domain/indicators/fearGreed';
```

타입 export 라인(`./domain/types`에서 시작)에 fearGreed 타입은 이미 task 6에서 re-export됨 — 추가 작업 불필요. (확인을 위해 sanity check.)

- [ ] **Step 2: index.client.ts도 동일 추가**

(`index.client.ts`는 client-safe entry. fearGreed는 pure 함수라 양쪽 모두 export 안전.)

- [ ] **Step 3: PUBLIC_API.md 갱신**

`docs/PUBLIC_API.md`의 Tier 1 인벤토리 섹션에 다음 추가:

```
## Tier 1 — Stable Public API

### Indicators
...
- `computeFearGreedIndex` (snapshot)
- `computeFearGreedHistory` (walk-forward)

### Types
...
- `FearGreedLabel`, `FearGreedConfidence`, `FearGreedWarning`
- `FearGreedFactor`, `FearGreedFactorKey`, `FearGreedGroup`
- `FearGreedSnapshot`, `FearGreedHistoryPoint`
- `ComputeFearGreedOptions`
```

(정확한 표 위치는 파일을 read 후 적절한 영역에 삽입.)

- [ ] **Step 4: 전체 빌드 + 타입 export 확인**

```bash
yarn build
yarn typecheck
```

- [ ] **Step 5: commit**

```bash
git add src/index.ts src/index.client.ts docs/PUBLIC_API.md
git commit -m "feat(fearGreed): export computeFearGreedIndex/History as Tier 1"
```

---

## Task 8: `buildAnalysisPrompt` 확장

**Skills**: `typescript-expert`

**Files:**
- Modify: `src/domain/analysis/prompt.ts`
- Modify or create: `src/__tests__/domain/analysis/prompt.test.ts`

- [ ] **Step 1: 기존 시그니처 read**

```bash
grep -n 'export function buildAnalysisPrompt' src/domain/analysis/prompt.ts
```

위치를 보고 현재 옵션 객체 구조 파악.

- [ ] **Step 2: 옵션 타입에 fearGreed 추가**

`buildAnalysisPrompt`의 옵션 인자(또는 input type)에 옵셔널 필드 추가:

```ts
import type { FearGreedSnapshot } from '@/domain/indicators/fearGreed/types';

interface BuildAnalysisPromptInput {
    // ... 기존 필드
    fearGreed?: FearGreedSnapshot;
}
```

prompt 본문에서 `fearGreed`가 들어오면 종합 분석에 컨텍스트 한 단락을 추가:

```ts
if (input.fearGreed) {
    const fg = input.fearGreed;
    const flowGroup = fg.groups.find(g => g.name === 'Flow');
    const trendGroup = fg.groups.find(g => g.name === 'Trend');
    sections.push(
        `## 공포·탐욕 지수 (참고)\n` +
            `- 점수: ${Math.round(fg.score)} / 100 (${fg.label})\n` +
            `- Flow 그룹: ${Math.round(flowGroup?.score ?? 0)} | Trend 그룹: ${Math.round(trendGroup?.score ?? 0)}\n` +
            (fg.warning === 'CHRONIC_WEAKNESS'
                ? '- 주의: 장기 약세 사이클 종목입니다. 점수는 자기 분포 대비 상대적 위치를 의미합니다.\n'
                : fg.warning === 'CHRONIC_STRENGTH'
                  ? '- 주의: 장기 강세 사이클 종목입니다. 점수는 자기 분포 대비 상대적 위치를 의미합니다.\n'
                  : '') +
            `\n위 sentiment를 위 가격·거래량 분석과 종합해 해석해 주세요.`
    );
}
```

(정확한 sections push 위치와 형식은 기존 prompt 구조에 맞춘다.)

- [ ] **Step 3: 테스트 작성·통과**

```ts
// src/__tests__/domain/analysis/prompt.test.ts (수정 또는 신규)
import { describe, expect, it } from 'vitest';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import type { FearGreedSnapshot } from '@/domain/indicators/fearGreed/types';

describe('buildAnalysisPrompt — fearGreed integration', () => {
    it('omits fear-greed section when not provided', () => {
        const prompt = buildAnalysisPrompt({
            // 기존 minimal input
        } as never);
        expect(prompt).not.toContain('공포·탐욕 지수');
    });

    it('includes fear-greed section when provided', () => {
        const fg: FearGreedSnapshot = {
            score: 18,
            label: 'EXTREME_FEAR',
            groups: [
                { name: 'Flow', score: 30, factors: [] },
                { name: 'Trend', score: 6, factors: [] },
            ],
            confidence: 'normal',
            sampleSize: 412,
            warning: null,
        };
        const prompt = buildAnalysisPrompt({
            fearGreed: fg,
            // ... minimal other fields
        } as never);
        expect(prompt).toContain('공포·탐욕 지수');
        expect(prompt).toContain('18');
        expect(prompt).toContain('EXTREME_FEAR');
    });

    it('mentions chronic-weakness note when warning is CHRONIC_WEAKNESS', () => {
        const fg: FearGreedSnapshot = {
            score: 75,
            label: 'EXTREME_GREED',
            groups: [],
            confidence: 'normal',
            sampleSize: 412,
            warning: 'CHRONIC_WEAKNESS',
        };
        const prompt = buildAnalysisPrompt({ fearGreed: fg } as never);
        expect(prompt).toMatch(/장기 약세 사이클/);
    });
});
```

- [ ] **Step 4: 통과**

```bash
yarn test src/__tests__/domain/analysis/prompt.test.ts
```

- [ ] **Step 5: lint, commit**

```bash
yarn lint
git add src/domain/analysis/prompt.ts src/__tests__/domain/analysis/prompt.test.ts
git commit -m "feat(fearGreed): inject fearGreed context into buildAnalysisPrompt"
```

---

## Task 9: 종합 검증 + PR

**Skills**: —

- [ ] **Step 1: 전체 typecheck + test + lint + build**

```bash
cd /Users/y0ngha/Project/siglens-core-fear-greed
yarn lint
yarn typecheck
yarn test
yarn build
```

모두 통과.

- [ ] **Step 2: validation 시나리오 (선택)**

siglens 측 worktree의 `scripts/validate-fear-greed.ts`를 *core 새 export* 사용으로 가볍게 재구성해 sanity check 가능 (이미 17종목 검증된 알고리즘과 같은 결과 나와야 한다 — Volume Profile POC 기준이 동일하므로). 시간 절약 위해 skip OK — 단위 테스트로 충분.

- [ ] **Step 3: PR 생성 (사용자 승인 후 git-agent에 위임)**

PR title: `feat: add per-stock fear & greed index (Tier 1)`
PR body: spec §1 목표 + 17종목 validation 결과 요약 + spec §11 의사결정 로그 인용 + 새 export 목록.

---

## 머지 순서 / Cross-Phase Sequencing

1. **본 plan의 PR** (siglens-core) → review/머지 → npm publish (semver minor bump 권장)
2. **siglens 측 plan** (siglens repo, 별도 plan 파일) → core 새 버전 import 후 시작

worktree와 별도 브랜치이므로 main 브랜치는 PR 머지 시점까지 unchanged.

---

## 자체 점검 (self-review)

- spec 매핑 ✓
  - §2 algorithm → Task 3 (factors), Task 4 (composition), Task 5 (walk-forward)
  - §4.5 warning → Task 4 (`detectWarning`)
  - §7 types → Task 1
  - §8 test 전략 → 각 task의 inline test
  - §9 caveats → composition `confidence` 분기, factors null path, walkForward warm-up
- placeholder 없음 ✓
- 함수·심볼 이름 일관 ✓ (`computeFearGreedIndex`, `computeFearGreedHistory`, `composeSnapshot`, `scoreToLabel`, `detectWarning`, `computeFactorsAtT`, `percentile`)
- public 경로: index.ts → fearGreed barrel → walkForward (functions) + types
