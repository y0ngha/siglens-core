# 차트 작도(Chart Overlays) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 분석이 다룬 차트 패턴·추세선·다이버전스·피보나치·엘리어트 파동을, 로직이 만든 좌표로 차트에 그린다.

**Architecture:** core가 bars에서 후보(`OverlayCandidate`, id + time/price 좌표)를 만들어 프롬프트에 id와 함께 싣는다. AI는 결과 항목에 id만 적는다. `runAnalysis` 후처리가 id를 후보와 조인해 `chartOverlays[]`를 만들고 캐시한다. siglens는 헤더 띠의 `차트 작도` 드롭다운으로 카테고리를 켜고 끄며 `LineSeries`로 그린다.

**Tech Stack:** TypeScript, vitest (core/siglens), lightweight-charts v5, Next.js 16 / React 19, next-intl.

**Spec:** `docs/superpowers/specs/2026-09-28-chart-overlays-design.md`

---

## 0. 실행 규칙

- core 워크트리: `/Users/y0ngha/Project/siglens-core-wt-overlays`, 브랜치 `feat/chart-overlays` (base `main`).
- siglens 워크트리: `/Users/y0ngha/Project/siglens-wt-overlays`, 브랜치 `feat/chart-overlays` (base `origin/master` — PR #885 헤더 띠 머지됨).
- 커밋은 git-agent만 한다(두 레포 CLAUDE.md). 아래 "Commit" 단계는 git-agent 호출 시점 표시다.
- 로컬 게이트: `yarn typecheck` + 변경 파일 스코프 테스트(`yarn test <path>`) + `yarn lint`. 전체 스위트·build는 pre-push/CI에 맡긴다.
- core 테스트 위치: `src/__tests__/domain/<sub>/<file>.test.ts`. 순수 함수, mock 없음.
- core 규칙: 타입은 `domain/types.ts`, 리터럴 상수는 constants 파일, exported 함수는 명시적 반환 타입, 입력 불변(`toSorted` 등).

## 1. 파일 구조

### core (`src/`)

| 파일 | 책임 |
|---|---|
| `domain/types.ts` (수정) | 오버레이 타입, `PatternSummary.candidateId`, `StrategyResult.candidateIds`, `AnalysisResponse.chartOverlays`, `TechnicalAssembledPrompt`, `RsiDivergencePair`, fib index 필드. `PatternLine`·`patternLines`·`timeRange` 삭제 |
| `domain/overlays/constants.ts` (신규) | 추세선·피보·엘리어트 임계값·상한 |
| `domain/overlays/format.ts` (신규) | `formatOverlayPoint` — 프롬프트 한 줄용 날짜·가격 |
| `domain/overlays/patternOverlays.ts` (신규) | 스크리너 후보 → 패턴 오버레이 후보, `patternOverlayId` |
| `domain/overlays/trendlineCandidates.ts` (신규) | 피벗 쌍 추세선 후보 |
| `domain/overlays/divergenceCandidates.ts` (신규) | RSI 다이버전스 후보 |
| `domain/overlays/fibonacciCandidates.ts` (신규) | horizon fib + ABC 후보 |
| `domain/overlays/elliottCandidates.ts` (신규) | 엘리어트 충격파(+ABC) 후보 |
| `domain/overlays/buildOverlayCandidates.ts` (신규) | 위 빌더 합성(각각 try/catch) |
| `domain/overlays/resolveChartOverlays.ts` (신규) | AI id ↔ 후보 조인, trendlines 파생 |
| `domain/overlays/index.ts` (신규) | 배럴 |
| `domain/analysis/chartOverlayCandidatesSection.ts` (신규) | `## Chart Overlay Candidates (computed)` 렌더 |
| `domain/analysis/chartPatternCandidatesSection.ts` (수정) | 후보 블록에 `- Candidate id:` 줄 |
| `domain/analysis/promptFormat.ts` (수정) | `formatBarDate` 이동·export(기존 `barDate`) |
| `domain/analysis/fibLevels.ts` (수정) | 앵커 index 반환 |
| `domain/signals/anticipation.ts` (수정) | `findRegularDivergencePair` 추출 |
| `domain/analysis/responseSchemas.ts` (수정) | `candidateId`, `candidateIds`, `trendlineIds`; `patternLines`/`timeRange`/`trendlines` 제거 |
| `domain/analysis/normalize.ts` (수정) | 새 필드 정규화, `normalizeIdList`, `normalizeChartOverlay` |
| `domain/analysis/confidence.ts` (수정) | 캐시 정규화에 `chartOverlays` |
| `domain/analysis/filterAnalysisResult.ts` (수정) | tier별 오버레이 제거 |
| `domain/analysis/prompt.ts` (수정) | 후보 생성·섹션 삽입·작성 규칙·반환 타입 |
| `application/market/runAnalysis.ts` (수정) | resolve 호출·로그 |
| `infrastructure/cache/config.ts` (수정) | `PROMPT_TEMPLATE_VERSION` p18→p19 |
| `index.ts`, `index.client.ts` (수정) | 타입 export 추가, `PatternLine` 제거 |

### siglens (`src/`)

| 파일 | 책임 |
|---|---|
| `widgets/chart/model/chartOverlayCategories.ts` (신규) | 카테고리 순서·기본값·색 |
| `widgets/chart/utils/chartOverlayUtils.ts` (신규) | 순수 변환: overlay → 라인 스펙, 정렬 가드, 카운트 |
| `widgets/chart/hooks/useChartOverlayVisibility.ts` (신규) | 카테고리 on/off 영속 |
| `widgets/chart/hooks/useChartOverlays.ts` (신규) | LineSeries 생성/정리 |
| `widgets/chart/ui/ChartOverlayMenu.tsx` (신규) | `차트 작도 · N ▾` + 체크리스트 |
| `widgets/chart/StockChart.tsx` (수정) | 프롭·훅·헤더 버튼 |
| `widgets/chart/constants.ts` (수정) | `STORAGE_KEYS.chartOverlays`, 고아 `REGION_*` 제거 |
| `widgets/chart/utils/patternOverlayUtils.ts` (삭제) | 고아 |
| `views/symbol/ChartContent.tsx` (수정) | overlays·강조 상태 배선 |
| `widgets/analysis/AnalysisPanel.tsx` (수정) | '원본' 카드 클릭 강조 |
| `messages/*.json` (수정) | i18n |
| `package.json` (수정) | core 버전 bump |

---

## Part A — core

### Task A1: 워크트리

- [ ] **Step 1:** 
```bash
cd /Users/y0ngha/Project/siglens-core && git fetch origin && git worktree add ../siglens-core-wt-overlays -b feat/chart-overlays origin/main
cd ../siglens-core-wt-overlays && cp -al ../siglens-core/node_modules ./node_modules
ls -d node_modules/node_modules 2>/dev/null && rm -rf node_modules/node_modules
```
- [ ] **Step 2:** 스펙·계획 파일을 워크트리로 복사(메인 체크아웃에 미추적으로 있음):
```bash
cp ../siglens-core/docs/superpowers/specs/2026-09-28-chart-overlays-design.md docs/superpowers/specs/
mkdir -p docs/superpowers/plans && cp ../siglens-core/docs/superpowers/plans/2026-09-28-chart-overlays.md docs/superpowers/plans/
```
- [ ] **Step 3:** `yarn typecheck` 통과 확인(기준선).

### Task A2: 타입

**Files:** Modify `src/domain/types.ts`

- [ ] **Step 1:** `PatternLine` 인터페이스(1468 부근) 삭제. `PatternSummary`에서 `patternLines?`, `timeRange?` 삭제하고 추가:
```ts
    /**
     * Id of the `OverlayCandidate` this pattern was confirmed from (spec
     * 2026-09-28 §2.3). Set by the model from `## Chart Pattern Candidates
     * (computed)`; absent for a pattern the pre-screener did not list.
     */
    candidateId?: string;
```
- [ ] **Step 2:** `StrategyResult`에 추가:
```ts
    /**
     * Ids of the `OverlayCandidate`s this verdict relies on (divergence /
     * fibonacci / elliott). For elliott, index 0 is the primary count and
     * index 1 the alternate.
     */
    candidateIds?: string[];
```
- [ ] **Step 3:** `AnalysisResponse`와 `FilteredAnalysisResponse` 둘 다 `trendlines` 아래에 추가:
```ts
    /** Logic-drawn overlays the model referenced (spec 2026-09-28). Absent on pre-p19 cache entries. */
    chartOverlays?: ChartOverlay[];
```
- [ ] **Step 4:** `RawAnalysisResponse`에 `trendlineIds?: unknown; chartOverlays?: unknown;` 추가.
- [ ] **Step 5:** `FibonacciProjection`에 `highIndex: number; lowIndex: number;`(각각 앵커 swing의 bars index, JSDoc 포함), `AbcExtensionProjection`에 `aIndex: number; bIndex: number; cIndex: number;` 추가.
- [ ] **Step 6:** `AssembledPrompt` 아래에 추가:
```ts
/** {@link buildAnalysisPrompt}'s result: the prompt halves plus the overlay candidates it printed, so the caller resolves the model's ids against the exact same list. */
export interface TechnicalAssembledPrompt extends AssembledPrompt {
    overlayCandidates: readonly OverlayCandidate[];
}
```
- [ ] **Step 7:** 파일 끝(Chart-pattern screener 블록 뒤)에 오버레이 블록 추가:
```ts
// =============================================================================
// Chart overlays (spec 2026-09-28) — logic-drawn coordinates the model only
// selects by id. Times are bar Unix seconds, never array indices, so a stored
// overlay stays put when newer bars arrive.
// =============================================================================

export type OverlayKind =
    | 'pattern'
    | 'trendline'
    | 'divergence'
    | 'fibonacci'
    | 'elliott';

/** Which chart pane a segment belongs to — only a divergence's oscillator line is off the price pane. */
export type OverlayPane = 'price' | 'rsi';

export type OverlayLineStyle = 'solid' | 'dashed';

export type OverlayLabelPosition = 'above' | 'below';

/** `alternate` only for an elliott count the model listed second. */
export type OverlayVariant = 'primary' | 'alternate';

export interface OverlayPoint {
    /** Bar Unix seconds. */
    time: number;
    price: number;
}

export interface OverlaySegment {
    from: OverlayPoint;
    to: OverlayPoint;
    /** e.g. `pattern`, `boundary_upper`, `pole`, `support`, `anchor`, `wave_3`, `price`, `rsi`. */
    role: string;
    style: OverlayLineStyle;
    pane: OverlayPane;
}

/** Horizontal line from `fromTime` to the chart's right edge. */
export interface OverlayLevel {
    price: number;
    fromTime: number;
    label: string;
}

export interface OverlayLabel {
    at: OverlayPoint;
    text: string;
    position: OverlayLabelPosition;
}

/** A drawable candidate offered to the model in the prompt. */
export interface OverlayCandidate {
    /** Deterministic id, e.g. `pattern:double_bottom:1714521600`. */
    id: string;
    kind: OverlayKind;
    /** Skill this candidate illustrates (skill file stem, `ChartPatternId`, or `trendline`). */
    skill: string;
    /** One prompt line describing the candidate (dates, prices, score). */
    promptLine: string;
    segments: OverlaySegment[];
    levels: OverlayLevel[];
    labels: OverlayLabel[];
}

/** A candidate the model referenced, ready to render. */
export interface ChartOverlay extends Omit<OverlayCandidate, 'promptLine'> {
    /** Result item that referenced it: `patternSummaries[].id`, `strategyResults[].id`, or `'trendlines'`. */
    sourceRef: string;
    variant: OverlayVariant;
}

/** Formatting context for candidate prompt lines. */
export interface OverlayFormat {
    timeframe: Timeframe;
    priceDp: number;
}

/** Both pivots of a regular RSI divergence, as bars indices (first < second). */
export interface RsiDivergencePair {
    first: number;
    second: number;
}

export type RsiDivergenceKind = 'bullish' | 'bearish';

/** {@link resolveChartOverlays} output. */
export interface ResolvedChartOverlays {
    chartOverlays: ChartOverlay[];
    /** Trendlines derived from resolved trendline overlays (legacy `trendlines` field). */
    trendlines: Trendline[];
    /** Referenced ids with no matching candidate (model invented them). */
    unknownIds: string[];
}
```
- [ ] **Step 8:** `src/domain/signals/anticipation.ts`의 로컬 `type DivergenceKind`를 지우고 `RsiDivergenceKind`를 import해 쓴다.
- [ ] **Step 9:** `yarn typecheck` — 이 시점에선 `patternLines`/`timeRange`/`PatternLine`/fib index 사용처가 깨진다. 에러 목록을 적어 두고 Task A3·A7·A9에서 해소한다(여기서 고치지 않음).

### Task A3: 상수·포맷 헬퍼

**Files:** Create `src/domain/overlays/constants.ts`, `src/domain/overlays/format.ts`; Modify `src/domain/analysis/promptFormat.ts`, `src/domain/analysis/chartPatternCandidatesSection.ts`; Test `src/__tests__/domain/overlays/format.test.ts`

- [ ] **Step 1:** `chartPatternCandidatesSection.ts`의 `barDate`를 `promptFormat.ts`로 옮겨 `export function formatBarDate(unixSeconds: number, timeframe: Timeframe): string`로 공개(JSDoc 그대로 이동). `chartPatternCandidatesSection.ts`는 import해서 쓴다. `MS_PER_SECOND` import도 같이 옮긴다.
- [ ] **Step 2:** `constants.ts`:
```ts
// ─── Trendlines ─────────────────────────────────────────────────────────────
/** @internal A same-kind pivot within this many ATR of the line counts as a touch. */
export const TRENDLINE_TOUCH_ATR_MULT = 0.25;
/** @internal A close beyond the line by more than this many ATR counts as a break bar. */
export const TRENDLINE_BREAK_ATR_MULT = 0.5;
/** @internal Break bars at or above this count invalidate the line. */
export const TRENDLINE_MAX_BREAK_BARS = 2;
/** @internal Best lines kept per side (support / resistance). */
export const TRENDLINE_CANDIDATES_PER_SIDE = 3;

// ─── Fibonacci ──────────────────────────────────────────────────────────────
/** @internal Retracement + extension ratios drawn; 2.0/2.618 are left off — they sit far off-chart. */
export const FIB_OVERLAY_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.272, 1.618] as const;
/** @internal ABC projections draw only the near extensions. */
export const FIB_ABC_OVERLAY_RATIOS = [1.0, 1.272, 1.618] as const;
/** @internal Upper bound on fibonacci candidates in one prompt. */
export const FIB_CANDIDATE_LIMIT = 4;

// ─── Elliott ────────────────────────────────────────────────────────────────
/** @internal Upper bound on elliott candidates in one prompt. */
export const ELLIOTT_CANDIDATE_LIMIT = 3;
/** @internal Guideline band for wave 2's retracement of wave 1. */
export const EW_WAVE2_RETRACE_MIN = 0.382;
export const EW_WAVE2_RETRACE_MAX = 0.786;
/** @internal Wave 3 at or beyond this multiple of wave 1 scores full marks. */
export const EW_WAVE3_EXTENSION = 1.618;
/** @internal Guideline band for wave 4's retracement of wave 3. */
export const EW_WAVE4_RETRACE_MIN = 0.236;
export const EW_WAVE4_RETRACE_MAX = 0.5;
/** @internal Wave 5 within this relative distance of a target ratio counts as a match. */
export const EW_WAVE5_TOLERANCE = 0.2;
/** @internal Wave 5 target as a fraction of the 0→3 span. */
export const EW_WAVE5_OF_ZERO_TO_THREE = 0.618;
/** @internal Minimum |retrace2 − retrace4| to count as alternation. */
export const EW_ALTERNATION_MIN_DIFF = 0.15;
/** @internal Neutral score for a guideline that cannot be judged yet (wave not formed). */
export const EW_UNJUDGED_SCORE = 0.5;
/** @internal Bonus when wave C runs past wave A's end. */
export const EW_ABC_C_BEYOND_A_BONUS = 0.1;
/** @internal Pivot count of a complete impulse (0–5). */
export const EW_IMPULSE_PIVOTS = 6;
/** @internal Smallest in-progress impulse: 0–3 with wave 3 forming. */
export const EW_MIN_PARTIAL_PIVOTS = 4;
/** @internal Pivots after wave 5 that close an A–B–C correction. */
export const EW_ABC_PIVOTS = 3;
```
- [ ] **Step 3:** `format.ts`:
```ts
import { formatBarDate } from '@/domain/analysis/promptFormat';
import { formatNullableNumber } from '@/domain/analysis/promptFormat';
import type { OverlayFormat, OverlayPoint } from '@/domain/types';

/** @internal `2026-01-05 101.20` — the one point format every candidate prompt line uses. */
export function formatOverlayPoint(point: OverlayPoint, fmt: OverlayFormat): string {
    return `${formatBarDate(point.time, fmt.timeframe)} ${formatNullableNumber(point.price, fmt.priceDp)}`;
}
```
(`formatNullableNumber`가 promptFormat에 없으면 `chartPatternCandidatesSection.ts`가 import하는 위치를 그대로 따른다.)
- [ ] **Step 4:** 테스트 `format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatOverlayPoint } from '@/domain/overlays/format';

describe('formatOverlayPoint', () => {
    it('daily prints date only', () => {
        expect(formatOverlayPoint({ time: 1767571200, price: 101.2 }, { timeframe: '1Day', priceDp: 2 }))
            .toBe('2026-01-05 101.20');
    });
    it('intraday prints UTC time', () => {
        expect(formatOverlayPoint({ time: 1767571200 + 3600 * 14, price: 5 }, { timeframe: '1Hour', priceDp: 1 }))
            .toMatch(/^2026-01-05 14:00 UTC 5\.0$/);
    });
});
```
- [ ] **Step 5:** `yarn test src/__tests__/domain/overlays/format.test.ts src/__tests__/domain/analysis/chartPatternCandidatesSection.test.ts` PASS.

### Task A4: 패턴 오버레이

**Files:** Create `src/domain/overlays/patternOverlays.ts`; Modify `src/domain/patterns/patternGeometry.ts` (export `evaluateTrendlineAt` as `@internal`); Test `src/__tests__/domain/overlays/patternOverlays.test.ts`

- [ ] **Step 1: 실패 테스트** — 실제 픽스처로:
```ts
import { describe, expect, it } from 'vitest';
import type { Bar } from '@/domain/types';
import { screenChartPatterns } from '@/domain/patterns/screenChartPatterns';
import { buildPatternOverlayCandidates, patternOverlayId } from '@/domain/overlays/patternOverlays';
import hsTextbook from '@/__tests__/domain/patterns/fixtures/hs-textbook.json';
import doubleTop from '@/__tests__/domain/patterns/fixtures/double-top.json';
import ascendingTriangle from '@/__tests__/domain/patterns/fixtures/ascending-triangle.json';
import bullFlag from '@/__tests__/domain/patterns/fixtures/bull-flag.json';
import cupAndHandle from '@/__tests__/domain/patterns/fixtures/cup-and-handle.json';

interface Fixture { atr: number; bars: Bar[] }
const FMT = { timeframe: '1Day' as const, priceDp: 2 };
const build = (f: Fixture) =>
    buildPatternOverlayCandidates(screenChartPatterns(f.bars, f.atr), f.bars, f.atr);
const barTimes = (f: Fixture) => new Set(f.bars.map(b => b.time));

describe('buildPatternOverlayCandidates', () => {
    it('head & shoulders: 5-pivot polyline, breakout level, LS/H/RS labels', () => {
        const f = hsTextbook as Fixture;
        const hs = build(f).find(c => c.id.startsWith('pattern:head_and_shoulders:'))!;
        expect(hs.kind).toBe('pattern');
        expect(hs.skill).toBe('head_and_shoulders');
        expect(hs.segments).toHaveLength(4);
        expect(hs.levels).toHaveLength(1);
        expect(hs.labels.map(l => l.text)).toEqual(['LS', 'H', 'RS']);
    });

    it('double top: polyline through the matched window and a neckline level', () => {
        const dt = build(doubleTop as Fixture).find(c => c.id.startsWith('pattern:double_top:'))!;
        expect(dt.segments.length).toBeGreaterThanOrEqual(2);
        expect(dt.levels[0].label).toBe('breakout');
    });

    it('triangle: exactly an upper and a lower boundary', () => {
        const tri = build(ascendingTriangle as Fixture).find(c => c.id.includes('ascending_triangle'))!;
        expect(tri.segments.map(s => s.role).toSorted()).toEqual(['boundary_lower', 'boundary_upper']);
    });

    it('flag: pole plus two channel edges from geometry', () => {
        const flag = build(bullFlag as Fixture).find(c => c.id.includes('bull_flag'))!;
        expect(flag.segments.map(s => s.role).toSorted()).toEqual(['channel_lower', 'channel_upper', 'pole']);
    });

    it('every point sits on a real bar time and segments run forward in time', () => {
        for (const f of [hsTextbook, doubleTop, ascendingTriangle, bullFlag, cupAndHandle] as Fixture[]) {
            const times = barTimes(f);
            for (const c of build(f)) {
                for (const s of c.segments) {
                    expect(times.has(s.from.time)).toBe(true);
                    expect(times.has(s.to.time)).toBe(true);
                    expect(s.to.time).toBeGreaterThan(s.from.time);
                }
                for (const l of c.levels) expect(times.has(l.fromTime)).toBe(true);
            }
        }
    });

    it('id is deterministic and matches patternOverlayId', () => {
        const f = doubleTop as Fixture;
        const screened = screenChartPatterns(f.bars, f.atr);
        const out = buildPatternOverlayCandidates(screened, f.bars, f.atr);
        expect(out.map(c => c.id)).toEqual(
            screened.filter(s => out.some(o => o.id === patternOverlayId(s, f.bars))).map(s => patternOverlayId(s, f.bars))
        );
    });

    it('skips a candidate with no geometry (hand-built, no pivots)', () => {
        const f = doubleTop as Fixture;
        expect(buildPatternOverlayCandidates([{ id: 'double_top', startIndex: 1, endIndex: 5 }], f.bars, f.atr)).toEqual([]);
    });
});
```
(`FMT`가 쓰이지 않으면 지운다 — 패턴은 promptLine을 섹션이 따로 그린다.)
- [ ] **Step 2:** `yarn test src/__tests__/domain/overlays/patternOverlays.test.ts` → FAIL(모듈 없음).
- [ ] **Step 3:** `patternGeometry.ts`의 `evaluateTrendlineAt` 앞에 `/** @internal */ export`를 붙인다.
- [ ] **Step 4:** 구현 `patternOverlays.ts`:
```ts
import type {
    Bar,
    OverlayCandidate,
    OverlayLabel,
    OverlaySegment,
    PatternCandidate,
    PatternGeometry,
    PivotPoint,
} from '@/domain/types';
import { computeCandidateGeometry, evaluateTrendlineAt } from '@/domain/patterns/patternGeometry';

const TRENDLINE_FAMILY = new Set([
    'ascending_triangle', 'descending_triangle', 'symmetrical_triangle',
    'ascending_wedge', 'descending_wedge', 'rectangle',
]);
const FLAG_FAMILY = new Set(['bull_flag', 'bear_flag', 'pennant']);
const HS_FAMILY = new Set(['head_and_shoulders', 'inverse_head_and_shoulders']);
const HS_LABELS = ['LS', 'H', 'RS'] as const;
const HS_LABEL_PIVOT_INDICES = [0, 2, 4] as const;

/** @internal Deterministic overlay id for one screener hit. */
export function patternOverlayId(candidate: PatternCandidate, bars: readonly Bar[]): string {
    return `pattern:${candidate.id}:${bars[candidate.startIndex].time}`;
}

const at = (bars: readonly Bar[], index: number, price: number) => ({ time: bars[index].time, price });

function seg(
    bars: readonly Bar[],
    fromIndex: number, fromPrice: number,
    toIndex: number, toPrice: number,
    role: string,
): OverlaySegment {
    return { from: at(bars, fromIndex, fromPrice), to: at(bars, toIndex, toPrice), role, style: 'solid', pane: 'price' };
}

function polyline(bars: readonly Bar[], pivots: readonly PivotPoint[]): OverlaySegment[] {
    return pivots.slice(1).map((p, i) => seg(bars, pivots[i].index, pivots[i].price, p.index, p.price, 'pattern'));
}

function trendlineSegments(bars: readonly Bar[], pivots: readonly PivotPoint[]): OverlaySegment[] {
    const highs = pivots.filter(p => p.kind === 'high');
    const lows = pivots.filter(p => p.kind === 'low');
    const start = Math.min(...pivots.map(p => p.index));
    const end = Math.max(...pivots.map(p => p.index));
    return [
        seg(bars, start, evaluateTrendlineAt(highs, start), end, evaluateTrendlineAt(highs, end), 'boundary_upper'),
        seg(bars, start, evaluateTrendlineAt(lows, start), end, evaluateTrendlineAt(lows, end), 'boundary_lower'),
    ];
}

function flagSegments(bars: readonly Bar[], c: PatternCandidate, g: PatternGeometry): OverlaySegment[] {
    const [base, top, upper, lower] = g.keyPoints;
    return [
        seg(bars, base.index, base.price, top.index, top.price, 'pole'),
        seg(bars, c.startIndex, upper.price, c.endIndex, upper.price, 'channel_upper'),
        seg(bars, c.startIndex, lower.price, c.endIndex, lower.price, 'channel_lower'),
    ];
}

function hsLabels(bars: readonly Bar[], pivots: readonly PivotPoint[]): OverlayLabel[] {
    return HS_LABEL_PIVOT_INDICES.map((pi, i) => ({
        at: at(bars, pivots[pi].index, pivots[pi].price),
        text: HS_LABELS[i],
        position: pivots[pi].kind === 'high' ? 'above' : 'below',
    }));
}

function toOverlay(c: PatternCandidate, g: PatternGeometry, bars: readonly Bar[]): OverlayCandidate | null {
    const inRange = (c.pivots ?? []).filter(p => p.index >= c.startIndex && p.index <= c.endIndex);
    const base = { id: patternOverlayId(c, bars), kind: 'pattern' as const, skill: c.id, promptLine: '' };

    if (FLAG_FAMILY.has(c.id)) {
        if (c.endIndex <= c.startIndex) return null;
        return { ...base, segments: flagSegments(bars, c, g), levels: [], labels: [] };
    }
    if (TRENDLINE_FAMILY.has(c.id)) {
        return { ...base, segments: trendlineSegments(bars, inRange), levels: [], labels: [] };
    }
    if (inRange.length < 2) return null;
    return {
        ...base,
        segments: polyline(bars, inRange),
        levels: [{ price: g.breakoutLevel, fromTime: bars[inRange[0].index].time, label: 'breakout' }],
        labels: HS_FAMILY.has(c.id) && inRange.length === 5 ? hsLabels(bars, inRange) : [],
    };
}

/**
 * @internal
 * Screener hits → drawable pattern candidates (spec 2026-09-28 §3.1). A hit
 * with no geometry is skipped — the prompt section still lists it, but there
 * is nothing trustworthy to draw.
 */
export function buildPatternOverlayCandidates(
    candidates: readonly PatternCandidate[],
    bars: readonly Bar[],
    atr: number,
): OverlayCandidate[] {
    return candidates.flatMap(c => {
        const g = computeCandidateGeometry(c, bars, atr);
        const overlay = g ? toOverlay(c, g, bars) : null;
        return overlay ? [overlay] : [];
    });
}
```
- [ ] **Step 5:** 테스트 PASS. 실패하면 픽스처의 실제 pivots를 출력해 기대값(세그먼트 수)을 실데이터에 맞춘다 — 구현을 테스트에 끼워 맞추지 말 것.
- [ ] **Step 6:** Commit(git-agent 단계 표시): `feat(overlays): pattern overlay candidates from screener pivots`

### Task A5: 추세선 후보

**Files:** Create `src/domain/overlays/trendlineCandidates.ts`; Test `src/__tests__/domain/overlays/trendlineCandidates.test.ts`

- [ ] **Step 1: 실패 테스트**:
```ts
import { describe, expect, it } from 'vitest';
import { buildTrendlineCandidates } from '@/domain/overlays/trendlineCandidates';
import { makeHLBars } from '@/__tests__/domain/patterns/helpers';

const FMT = { timeframe: '1Day' as const, priceDp: 2 };
// Rising lows 100 → 104 → 108 with highs in between; ATR 1, reversal 1.5.
const risingBars = () => makeHLBars([
    [104, 103], [101, 100], [106, 105], [104, 104], [110, 109], [108, 108], [114, 113], [111, 111], [116, 115],
]);

describe('buildTrendlineCandidates', () => {
    it('finds an ascending support through the rising lows', () => {
        const out = buildTrendlineCandidates(risingBars(), 1, FMT);
        const support = out.filter(c => c.id.startsWith('tl:support:'));
        expect(support.length).toBeGreaterThan(0);
        expect(support[0].kind).toBe('trendline');
        expect(support[0].segments[0].role).toBe('support');
        expect(support[0].segments[0].to.time).toBe(8); // extends to last bar
    });

    it('rejects a support line the closes have broken through', () => {
        const bars = [...risingBars(), ...makeHLBars([[100, 99], [99, 98], [98, 97]]).map((b, i) => ({ ...b, time: 9 + i }))];
        const out = buildTrendlineCandidates(bars, 1, FMT);
        expect(out.filter(c => c.id.startsWith('tl:support:'))).toEqual([]);
    });

    it('drops flat lines', () => {
        const flat = makeHLBars([[102, 101], [100, 100], [102, 102], [100, 100], [102, 102], [100, 100], [102, 102]]);
        expect(buildTrendlineCandidates(flat, 1, FMT).filter(c => c.id.startsWith('tl:support:'))).toEqual([]);
    });

    it('caps each side and returns [] for atr <= 0', () => {
        expect(buildTrendlineCandidates(risingBars(), 0, FMT)).toEqual([]);
        const out = buildTrendlineCandidates(risingBars(), 1, FMT);
        expect(out.filter(c => c.segments[0].role === 'support').length).toBeLessThanOrEqual(3);
    });

    it('prompt line names both anchors and the touch count', () => {
        const [c] = buildTrendlineCandidates(risingBars(), 1, FMT);
        expect(c.promptLine).toMatch(/touches \d+/);
    });
});
```
(픽스처 피벗이 기대와 다르면 `extractPivots(bars, 1)` 결과를 출력해 막대 값을 조정한다.)
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현:
```ts
import type { Bar, OverlayCandidate, OverlayFormat, PivotKind, PivotPoint } from '@/domain/types';
import { extractPivots } from '@/domain/patterns/pivots';
import { FLAT_SLOPE_ATR_PER_BAR, SCREEN_LOOKBACK_BARS } from '@/domain/patterns/constants';
import {
    TRENDLINE_BREAK_ATR_MULT, TRENDLINE_CANDIDATES_PER_SIDE,
    TRENDLINE_MAX_BREAK_BARS, TRENDLINE_TOUCH_ATR_MULT,
} from '@/domain/overlays/constants';
import { formatOverlayPoint } from '@/domain/overlays/format';

type Side = 'support' | 'resistance';
const SIDE_KIND: Record<Side, PivotKind> = { support: 'low', resistance: 'high' };

interface ScoredLine { p1: PivotPoint; p2: PivotPoint; slope: number; touches: number }

function scoreLine(side: Side, p1: PivotPoint, p2: PivotPoint, pivots: readonly PivotPoint[], bars: readonly Bar[], atr: number): ScoredLine | null {
    const slope = (p2.price - p1.price) / (p2.index - p1.index);
    const normalized = slope / atr;
    if (side === 'support' ? normalized <= FLAT_SLOPE_ATR_PER_BAR : normalized >= -FLAT_SLOPE_ATR_PER_BAR) return null;
    const lineAt = (x: number) => p1.price + slope * (x - p1.index);

    let breaks = 0;
    for (let i = p1.index; i < bars.length; i++) {
        const gap = bars[i].close - lineAt(i);
        if (side === 'support' ? gap < -TRENDLINE_BREAK_ATR_MULT * atr : gap > TRENDLINE_BREAK_ATR_MULT * atr) breaks++;
    }
    if (breaks >= TRENDLINE_MAX_BREAK_BARS) return null;

    const touches = pivots.filter(
        p => p.index >= p1.index && Math.abs(p.price - lineAt(p.index)) <= TRENDLINE_TOUCH_ATR_MULT * atr,
    ).length;
    return { p1, p2, slope, touches };
}

function toCandidate(side: Side, line: ScoredLine, bars: readonly Bar[], fmt: OverlayFormat): OverlayCandidate {
    const last = bars.length - 1;
    const from = { time: bars[line.p1.index].time, price: line.p1.price };
    const to = { time: bars[last].time, price: line.p1.price + line.slope * (last - line.p1.index) };
    const through = { time: bars[line.p2.index].time, price: line.p2.price };
    return {
        id: `tl:${side}:${from.time}:${through.time}`,
        kind: 'trendline',
        skill: 'trendline',
        promptLine: `${side} (${side === 'support' ? 'ascending' : 'descending'}) from ${formatOverlayPoint(from, fmt)} through ${formatOverlayPoint(through, fmt)}, at last bar ${formatOverlayPoint(to, fmt)}; touches ${line.touches}`,
        segments: [{ from, to, role: side, style: 'solid', pane: 'price' }],
        levels: [],
        labels: [],
    };
}

/**
 * @internal
 * Two-pivot trendline candidates over the screener window (spec 2026-09-28 §3.2):
 * rising support through lows, falling resistance through highs, invalidated
 * by repeated closes through the line, ranked by touches then recency.
 */
export function buildTrendlineCandidates(bars: readonly Bar[], atr: number, fmt: OverlayFormat): OverlayCandidate[] {
    if (atr <= 0 || bars.length < 2) return [];
    const offset = Math.max(0, bars.length - SCREEN_LOOKBACK_BARS);
    const pivots = extractPivots(bars.slice(offset), atr).map(p => ({ ...p, index: p.index + offset }));

    return (['support', 'resistance'] as const).flatMap(side => {
        const same = pivots.filter(p => p.kind === SIDE_KIND[side]);
        const lines: ScoredLine[] = [];
        for (let i = 0; i < same.length; i++) {
            for (let j = i + 1; j < same.length; j++) {
                const line = scoreLine(side, same[i], same[j], same, bars, atr);
                if (line) lines.push(line);
            }
        }
        return lines
            .toSorted((a, b) => b.touches - a.touches || b.p2.index - a.p2.index)
            .slice(0, TRENDLINE_CANDIDATES_PER_SIDE)
            .map(line => toCandidate(side, line, bars, fmt));
    });
}
```
- [ ] **Step 4:** PASS 확인.
- [ ] **Step 5:** Commit 표시: `feat(overlays): pivot-pair trendline candidates`

### Task A6: 다이버전스 후보

**Files:** Modify `src/domain/signals/anticipation.ts`; Create `src/domain/overlays/divergenceCandidates.ts`; Test `src/__tests__/domain/overlays/divergenceCandidates.test.ts`, 기존 `src/__tests__/domain/signals/anticipation*.test.ts` 회귀 확인

- [ ] **Step 1:** `anticipation.ts` 리팩터 — 기존 `detectRegularDivergence` 본문을 `findRegularDivergencePair`로 옮기고 `{ first: p1, second: p2 }`를 반환:
```ts
/** @internal Both pivots of the latest regular RSI divergence of `kind`, or `null`. */
export function findRegularDivergencePair(
    bars: readonly Bar[],
    rsi: readonly (number | null)[],
    kind: RsiDivergenceKind
): RsiDivergencePair | null {
    // (기존 detectRegularDivergence 본문 그대로, 마지막 `return p2;` → `return { first: p1, second: p2 };`)
}

function detectRegularDivergence(bars: Bar[], rsi: (number | null)[], kind: RsiDivergenceKind): number | null {
    return findRegularDivergencePair(bars, rsi, kind)?.second ?? null;
}
```
- [ ] **Step 2:** `yarn test src/__tests__/domain/signals` — 기존 다이버전스 신호 테스트가 그대로 PASS(동작 불변).
- [ ] **Step 3: 실패 테스트** `divergenceCandidates.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Bar } from '@/domain/types';
import { buildDivergenceCandidates } from '@/domain/overlays/divergenceCandidates';
import { findRegularDivergencePair } from '@/domain/signals/anticipation';
import { DIVERGENCE_LOOKBACK_BARS } from '@/domain/signals/constants';

const FMT = { timeframe: '1Day' as const, priceDp: 2 };

/** 20+ bars: two swing lows, the second lower in price but higher in RSI. */
function bullishSetup(): { bars: Bar[]; rsi: (number | null)[] } {
    const lows = [110, 109, 108, 107, 105, 107, 108, 109, 110, 109, 108, 107, 106, 104, 106, 107, 108, 109, 110, 111];
    const bars = lows.map((low, i) => ({ time: 1000 + i, open: low + 1, high: low + 2, low, close: low + 1, volume: 1 }));
    const rsi = lows.map((_, i) => (i === 4 ? 25 : i === 13 ? 32 : 50));
    return { bars, rsi };
}

describe('buildDivergenceCandidates', () => {
    it('emits one bullish candidate with a price and an rsi segment', () => {
        const { bars, rsi } = bullishSetup();
        expect(bars.length).toBeGreaterThanOrEqual(DIVERGENCE_LOOKBACK_BARS);
        const pair = findRegularDivergencePair(bars, rsi, 'bullish');
        expect(pair).not.toBeNull();
        const [c] = buildDivergenceCandidates(bars, rsi, FMT);
        expect(c.id).toBe(`div:rsi_bullish:${bars[pair!.second].time}`);
        expect(c.skill).toBe('divergence');
        expect(c.segments.map(s => s.pane)).toEqual(['price', 'rsi']);
        expect(c.segments[1].from.price).toBe(25);
        expect(c.segments[1].to.price).toBe(32);
    });

    it('emits nothing when no divergence fired', () => {
        const { bars } = bullishSetup();
        expect(buildDivergenceCandidates(bars, bars.map(() => 50), FMT)).toEqual([]);
    });
});
```
(신선도(`DIVERGENCE_FRESHNESS_BARS`=5) 조건 때문에 두 번째 저점이 마지막 5봉 안에 있어야 한다 — 실패하면 배열 끝을 줄여 맞춘다.)
- [ ] **Step 4:** 구현 `divergenceCandidates.ts`:
```ts
import type { Bar, OverlayCandidate, OverlayFormat, RsiDivergenceKind } from '@/domain/types';
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
    fmt: OverlayFormat,
): OverlayCandidate[] {
    return KINDS.flatMap(kind => {
        const pair = findRegularDivergencePair(bars, rsi, kind);
        if (!pair) return [];
        const r1 = rsi[pair.first];
        const r2 = rsi[pair.second];
        if (r1 == null || r2 == null) return [];
        const priceOf = (i: number) => (kind === 'bullish' ? bars[i].low : bars[i].high);
        const from = { time: bars[pair.first].time, price: priceOf(pair.first) };
        const to = { time: bars[pair.second].time, price: priceOf(pair.second) };
        return [{
            id: `div:rsi_${kind}:${to.time}`,
            kind: 'divergence' as const,
            skill: 'divergence',
            promptLine: `RSI ${kind} divergence: price ${formatOverlayPoint(from, fmt)} → ${formatOverlayPoint(to, fmt)}, RSI ${r1.toFixed(1)} → ${r2.toFixed(1)}`,
            segments: [
                { from, to, role: 'price', style: 'solid' as const, pane: 'price' as const },
                { from: { time: from.time, price: r1 }, to: { time: to.time, price: r2 }, role: 'rsi', style: 'solid' as const, pane: 'rsi' as const },
            ],
            levels: [],
            labels: [],
        }];
    });
}
```
- [ ] **Step 5:** PASS. Commit 표시: `feat(overlays): rsi divergence candidates`

### Task A7: 피보나치 후보

**Files:** Modify `src/domain/analysis/fibLevels.ts`; Create `src/domain/overlays/fibonacciCandidates.ts`; Test `src/__tests__/domain/overlays/fibonacciCandidates.test.ts`, 기존 `fibLevels.test.ts`·`marketReference.test.ts` 갱신

- [ ] **Step 1:** `computeFibonacciProjection` 반환에 `highIndex: swingHigh.index, lowIndex: swingLow.index` 추가. `computeAbcExtension` 반환에 `aIndex: a.index, bIndex: b.index, cIndex: c.index` 추가.
- [ ] **Step 2:** `yarn typecheck` — `FibonacciProjection`/`AbcExtensionProjection` 리터럴을 만드는 테스트·프롬프트 픽스처가 깨지면 index 필드를 채운다. `yarn test src/__tests__/domain/analysis/fibLevels.test.ts src/__tests__/domain/analysis/marketReference.test.ts` — 스냅샷/`toEqual` 기대값에 새 필드를 추가한다(값은 swing point index).
- [ ] **Step 3: 실패 테스트** `fibonacciCandidates.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Bar, FibonacciProjection, MarketReference } from '@/domain/types';
import { buildFibonacciCandidates } from '@/domain/overlays/fibonacciCandidates';

const FMT = { timeframe: '1Day' as const, priceDp: 2 };
const bars: Bar[] = Array.from({ length: 30 }, (_, i) => ({ time: 5000 + i * 86400, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
const fib = (lowIndex: number, highIndex: number): FibonacciProjection => ({
    high: 120, low: 100, highIndex, lowIndex, direction: lowIndex < highIndex ? 'up' : 'down',
    retracements: [{ ratio: 0.618, price: 107.64 }], extensions: [{ ratio: 1.618, price: 132.36 }],
});
const horizon = (f: FibonacciProjection | null) => ({ fibProjection: f, abcExtension: null }) as unknown as MarketReference['short'];

describe('buildFibonacciCandidates', () => {
    it('one candidate per distinct anchor leg; horizons sharing a leg collapse', () => {
        const ref = { short: horizon(fib(10, 20)), medium: horizon(fib(10, 20)), long: horizon(fib(2, 20)) } as MarketReference;
        const out = buildFibonacciCandidates(ref, bars, FMT);
        expect(out.map(c => c.id)).toEqual([`fib:short:${bars[20].time}`, `fib:long:${bars[20].time}`]);
    });

    it('anchor segment runs forward in time; levels start at the later anchor', () => {
        const ref = { short: horizon(fib(20, 10)), medium: horizon(null), long: horizon(null) } as MarketReference;
        const [c] = buildFibonacciCandidates(ref, bars, FMT);
        expect(c.segments[0].from.time).toBe(bars[10].time);
        expect(c.segments[0].to.time).toBe(bars[20].time);
        expect(c.levels.every(l => l.fromTime === bars[20].time)).toBe(true);
        expect(c.levels.map(l => l.label)).toContain('61.8%');
    });

    it('never exceeds the candidate limit', () => {
        const ref = { short: horizon(fib(1, 2)), medium: horizon(fib(3, 4)), long: horizon(fib(5, 6)) } as MarketReference;
        expect(buildFibonacciCandidates(ref, bars, FMT).length).toBeLessThanOrEqual(4);
    });
});
```
- [ ] **Step 4:** 구현:
```ts
import type { AbcExtensionProjection, Bar, FibonacciProjection, HorizonKey, MarketReference, OverlayCandidate, OverlayFormat } from '@/domain/types';
import { formatFibRatio } from '@/domain/analysis/marketReference';
import { FIB_ABC_OVERLAY_RATIOS, FIB_CANDIDATE_LIMIT, FIB_OVERLAY_RATIOS } from '@/domain/overlays/constants';
import { formatOverlayPoint } from '@/domain/overlays/format';

const HORIZONS: readonly HorizonKey[] = ['short', 'medium', 'long'];

function legCandidate(key: HorizonKey, fib: FibonacciProjection, bars: readonly Bar[], fmt: OverlayFormat): OverlayCandidate {
    const [startIndex, endIndex] = fib.lowIndex < fib.highIndex ? [fib.lowIndex, fib.highIndex] : [fib.highIndex, fib.lowIndex];
    const priceAt = (i: number) => (i === fib.lowIndex ? fib.low : fib.high);
    const from = { time: bars[startIndex].time, price: priceAt(startIndex) };
    const to = { time: bars[endIndex].time, price: priceAt(endIndex) };
    const range = fib.high - fib.low;
    // Retracements measure back from the leg's end; extensions project from its start.
    const levelPrice = (ratio: number) =>
        ratio < 1
            ? fib.direction === 'up' ? fib.high - ratio * range : fib.low + ratio * range
            : fib.direction === 'up' ? fib.low + ratio * range : fib.high - ratio * range;
    return {
        id: `fib:${key}:${to.time}`,
        kind: 'fibonacci',
        skill: 'fibonacci-retracement',
        promptLine: `${key} leg ${fib.direction} ${formatOverlayPoint(from, fmt)} → ${formatOverlayPoint(to, fmt)}`,
        segments: [{ from, to, role: 'anchor', style: 'dashed', pane: 'price' }],
        levels: FIB_OVERLAY_RATIOS.map(ratio => ({ price: levelPrice(ratio), fromTime: to.time, label: formatFibRatio(ratio) })),
        labels: [],
    };
}

function abcCandidate(abc: AbcExtensionProjection, bars: readonly Bar[], fmt: OverlayFormat): OverlayCandidate {
    const a = { time: bars[abc.aIndex].time, price: abc.a };
    const b = { time: bars[abc.bIndex].time, price: abc.b };
    const c = { time: bars[abc.cIndex].time, price: abc.c };
    const range = Math.abs(abc.b - abc.a);
    const sign = abc.direction === 'up' ? 1 : -1;
    return {
        id: `fib:abc:${c.time}`,
        kind: 'fibonacci',
        skill: 'fibonacci-extension',
        promptLine: `ABC ${abc.direction}: A ${formatOverlayPoint(a, fmt)}, B ${formatOverlayPoint(b, fmt)}, C ${formatOverlayPoint(c, fmt)}`,
        segments: [
            { from: a, to: b, role: 'anchor', style: 'dashed', pane: 'price' },
            { from: b, to: c, role: 'anchor', style: 'dashed', pane: 'price' },
        ],
        levels: FIB_ABC_OVERLAY_RATIOS.map(ratio => ({ price: abc.c + sign * ratio * range, fromTime: c.time, label: `ABC ${formatFibRatio(ratio)}` })),
        labels: [
            { at: a, text: 'A', position: abc.direction === 'up' ? 'below' : 'above' },
            { at: b, text: 'B', position: abc.direction === 'up' ? 'above' : 'below' },
            { at: c, text: 'C', position: abc.direction === 'up' ? 'below' : 'above' },
        ],
    };
}

/**
 * @internal
 * Horizon fib legs (deduped by anchor pair) plus the first ABC projection
 * (spec 2026-09-28 §3.4). Level prices use the same formulas as
 * `fibLevels.ts` so the drawn lines equal the `Fib table:` rows.
 */
export function buildFibonacciCandidates(ref: MarketReference, bars: readonly Bar[], fmt: OverlayFormat): OverlayCandidate[] {
    const seenLegs = new Set<string>();
    const legs = HORIZONS.flatMap(key => {
        const fib = ref[key].fibProjection;
        if (!fib) return [];
        const legKey = `${fib.lowIndex}-${fib.highIndex}`;
        if (seenLegs.has(legKey)) return [];
        seenLegs.add(legKey);
        return [legCandidate(key, fib, bars, fmt)];
    });
    const abc = HORIZONS.map(key => ref[key].abcExtension).find(x => x != null);
    return [...legs, ...(abc ? [abcCandidate(abc, bars, fmt)] : [])].slice(0, FIB_CANDIDATE_LIMIT);
}
```
구현 후 `fibLevels.ts`의 `buildRetracements`/`buildExtensions` 공식과 한 번 더 대조한다(`levelPrice`가 두 함수와 같은 값이어야 함 — 다르면 두 함수를 export해 재사용한다. 그쪽이 더 낫다).
- [ ] **Step 5:** PASS. Commit 표시: `feat(overlays): fibonacci leg and ABC candidates`

### Task A8: 엘리어트 후보

**Files:** Create `src/domain/overlays/elliottCandidates.ts`; Test `src/__tests__/domain/overlays/elliottCandidates.test.ts`

- [ ] **Step 1: 실패 테스트** (피벗 사다리 헬퍼 사용: `makeAlternatingPivotBars(seed, targets, closer)`는 seed 다음부터 high/low 교대 피벗을 만든다. 상승 충격파는 저점에서 시작하므로 seed를 높게 두고 첫 target을 저점이 아닌 고점으로 시작하는 헬퍼 특성에 맞춰, 필요한 경우 테스트 로컬 헬퍼 `pivotLadder(prices)`를 `makeHLBars(prices.map(v => [v, v]))`로 만든다):
```ts
import { describe, expect, it } from 'vitest';
import { buildElliottCandidates } from '@/domain/overlays/elliottCandidates';
import { makeHLBars } from '@/__tests__/domain/patterns/helpers';

const FMT = { timeframe: '1Day' as const, priceDp: 2 };
/** Flat bars at each price — with ATR 1 every move ≥ 1.5 becomes a pivot. */
const ladder = (prices: number[]) => makeHLBars(prices.map(v => [v, v] as [number, number]));

// Textbook up impulse: 0=100, 1=110, 2=104 (60% retrace), 3=126 (w3 = 2.2×w1),
// 4=120 (27% of w3), 5=131 (w5 = 1.1×w1), then a closing drop to confirm 5.
const TEXTBOOK = [105, 100, 110, 104, 126, 120, 131, 125];

describe('buildElliottCandidates', () => {
    it('finds the textbook impulse with labels 1–5', () => {
        const out = buildElliottCandidates(ladder(TEXTBOOK), 1, FMT);
        const best = out[0];
        expect(best.id).toMatch(/^ew:up:\d+:6$/);
        expect(best.labels.map(l => l.text)).toEqual(['1', '2', '3', '4', '5']);
        expect(best.segments).toHaveLength(5);
    });

    it('rule 1: wave 2 below wave 0 invalidates', () => {
        const out = buildElliottCandidates(ladder([105, 100, 110, 99, 126, 120, 131, 125]), 1, FMT);
        expect(out.some(c => c.id.endsWith(':6') && c.id.startsWith('ew:up:1'))).toBe(false);
    });

    it('rule 2: wave 3 shortest invalidates', () => {
        // w1 = 10, w3 = 6, w5 = 12
        const out = buildElliottCandidates(ladder([105, 100, 110, 104, 110.5, 108, 120, 114]), 1, FMT);
        expect(out.filter(c => c.id.endsWith(':6'))).toEqual([]);
    });

    it('rule 3: wave 4 into wave 1 territory invalidates', () => {
        const out = buildElliottCandidates(ladder([105, 100, 110, 104, 126, 109, 131, 125]), 1, FMT);
        expect(out.filter(c => c.id.endsWith(':6'))).toEqual([]);
    });

    it('in-progress count ends at the last pivot', () => {
        // 0..3 then still falling into wave 4: last pivot is provisional
        const out = buildElliottCandidates(ladder([105, 100, 110, 104, 126, 121]), 1, FMT);
        expect(out.some(c => /:(4|5)$/.test(c.id))).toBe(true);
    });

    it('ABC after a complete impulse is attached', () => {
        const out = buildElliottCandidates(ladder([...TEXTBOOK.slice(0, -1), 122, 127, 118, 121]), 1, FMT);
        const abc = out.find(c => c.id.endsWith(':abc'));
        expect(abc?.labels.map(l => l.text)).toEqual(['1', '2', '3', '4', '5', 'A', 'B', 'C']);
    });

    it('caps at 3 and sorts by score', () => {
        const out = buildElliottCandidates(ladder(TEXTBOOK), 1, FMT);
        expect(out.length).toBeLessThanOrEqual(3);
        expect(out[0].promptLine).toMatch(/score \d\.\d{2}/);
    });

    it('[] for atr <= 0 or too few pivots', () => {
        expect(buildElliottCandidates(ladder(TEXTBOOK), 0, FMT)).toEqual([]);
        expect(buildElliottCandidates(ladder([100, 101]), 1, FMT)).toEqual([]);
    });
});
```
(`extractPivots`는 첫 극값을 피벗으로 내지 않는다 — seed 105가 방향만 정하고, 100이 첫 피벗(0 지점)이 된다. 결과가 다르면 `extractPivots(ladder(TEXTBOOK), 1, { includeProvisional: true })`를 출력해 사다리를 맞춘다.)
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** 구현:
```ts
import type { Bar, OverlayCandidate, OverlayFormat, OverlayLabel, OverlaySegment, PivotPoint } from '@/domain/types';
import { extractPivots } from '@/domain/patterns/pivots';
import { SCREEN_LOOKBACK_BARS } from '@/domain/patterns/constants';
import {
    ELLIOTT_CANDIDATE_LIMIT, EW_ABC_C_BEYOND_A_BONUS, EW_ABC_PIVOTS, EW_ALTERNATION_MIN_DIFF,
    EW_IMPULSE_PIVOTS, EW_MIN_PARTIAL_PIVOTS, EW_UNJUDGED_SCORE, EW_WAVE2_RETRACE_MAX,
    EW_WAVE2_RETRACE_MIN, EW_WAVE3_EXTENSION, EW_WAVE4_RETRACE_MAX, EW_WAVE4_RETRACE_MIN,
    EW_WAVE5_OF_ZERO_TO_THREE, EW_WAVE5_TOLERANCE,
} from '@/domain/overlays/constants';
import { formatOverlayPoint } from '@/domain/overlays/format';

const ABC_LABELS = ['A', 'B', 'C'] as const;

interface Count { seq: PivotPoint[]; abc: PivotPoint[]; up: boolean; score: number }

const within = (x: number, lo: number, hi: number): number => (x >= lo && x <= hi ? 1 : 0);
const alternates = (seq: readonly PivotPoint[]): boolean => seq.every((p, i) => i === 0 || p.kind !== seq[i - 1].kind);

/** Absolute rules on however many waves `seq` has. `P(i)` is price signed so "up" is always positive. */
function passesRules(seq: readonly PivotPoint[], up: boolean): boolean {
    const P = (i: number) => (up ? seq[i].price : -seq[i].price);
    const w = (i: number) => Math.abs(seq[i + 1].price - seq[i].price);
    const n = seq.length;
    if (n >= 3 && !(P(2) > P(0))) return false;                  // rule 1
    if (n >= 5 && !(P(3) > P(1))) return false;                  // wave 3 clears wave 1
    if (n >= 5 && w(2) < w(0) && n < EW_IMPULSE_PIVOTS) return false; // rule 2, wave 5 unformed
    if (n >= EW_IMPULSE_PIVOTS && w(2) < w(0) && w(2) < w(4)) return false; // rule 2
    if (n >= 5 && !(P(4) > P(1))) return false;                  // rule 3
    return true;
}

function score(seq: readonly PivotPoint[], lastBarIndex: number): number {
    const w = (i: number) => Math.abs(seq[i + 1].price - seq[i].price);
    const n = seq.length;
    const r2 = w(1) / w(0);
    const g2 = within(r2, EW_WAVE2_RETRACE_MIN, EW_WAVE2_RETRACE_MAX);
    const g3 = n >= 5 ? Math.min(1, w(2) / w(0) / EW_WAVE3_EXTENSION) : EW_UNJUDGED_SCORE;
    const r4 = n >= 5 ? w(3) / w(2) : null;
    const g4 = r4 === null ? EW_UNJUDGED_SCORE : within(r4, EW_WAVE4_RETRACE_MIN, EW_WAVE4_RETRACE_MAX);
    const g5 = n >= EW_IMPULSE_PIVOTS
        ? (Math.abs(w(4) / w(0) - 1) <= EW_WAVE5_TOLERANCE ||
           Math.abs(w(4) / Math.abs(seq[3].price - seq[0].price) - EW_WAVE5_OF_ZERO_TO_THREE) <= EW_WAVE5_TOLERANCE ? 1 : 0)
        : EW_UNJUDGED_SCORE;
    const alt = r4 === null ? EW_UNJUDGED_SCORE : Math.abs(r2 - r4) >= EW_ALTERNATION_MIN_DIFF ? 1 : 0;
    const recency = Math.max(0, 1 - (lastBarIndex - seq[n - 1].index) / SCREEN_LOOKBACK_BARS);
    return (g2 + g3 + g4 + g5 + alt + recency) / 6;
}

/** A–B–C after wave 5: B must not retrace past wave 5's end. */
function abcAfter(pivots: readonly PivotPoint[], endPos: number, up: boolean): PivotPoint[] {
    const abc = pivots.slice(endPos + 1, endPos + 1 + EW_ABC_PIVOTS);
    if (abc.length < EW_ABC_PIVOTS || !alternates([pivots[endPos], ...abc])) return [];
    const five = pivots[endPos].price;
    const bBeyondFive = up ? abc[1].price >= five : abc[1].price <= five;
    return bBeyondFive ? [] : abc;
}

function enumerate(pivots: readonly PivotPoint[], lastBarIndex: number): Count[] {
    const counts: Count[] = [];
    for (let s = 0; s < pivots.length; s++) {
        const up = pivots[s].kind === 'low';
        for (let n = EW_IMPULSE_PIVOTS; n >= EW_MIN_PARTIAL_PIVOTS; n--) {
            if (s + n > pivots.length) continue;
            // A partial count only makes sense when it is still running at the right edge.
            if (n < EW_IMPULSE_PIVOTS && s + n !== pivots.length) continue;
            const seq = pivots.slice(s, s + n);
            if (!alternates(seq) || !passesRules(seq, up)) continue;
            const abc = n === EW_IMPULSE_PIVOTS ? abcAfter(pivots, s + n - 1, up) : [];
            const aEnd = abc[0]?.price;
            const cBeyondA = abc.length > 0 && (up ? abc[2].price < aEnd : abc[2].price > aEnd);
            counts.push({ seq, abc, up, score: Math.min(1, score(seq, lastBarIndex) + (cBeyondA ? EW_ABC_C_BEYOND_A_BONUS : 0)) });
        }
    }
    return counts;
}

function toCandidate(count: Count, bars: readonly Bar[], fmt: OverlayFormat): OverlayCandidate {
    const pt = (p: PivotPoint) => ({ time: bars[p.index].time, price: p.price });
    const all = [...count.seq, ...count.abc];
    const segments: OverlaySegment[] = all.slice(1).map((p, i) => ({
        from: pt(all[i]), to: pt(p),
        role: i < count.seq.length - 1 ? `wave_${i + 1}` : `wave_${ABC_LABELS[i - (count.seq.length - 1)]}`,
        style: i < count.seq.length - 1 ? 'solid' : 'dashed',
        pane: 'price',
    }));
    const labels: OverlayLabel[] = all.slice(1).map((p, i) => ({
        at: pt(p),
        text: i < count.seq.length - 1 ? String(i + 1) : ABC_LABELS[i - (count.seq.length - 1)],
        position: p.kind === 'high' ? 'above' : 'below',
    }));
    const n = count.seq.length;
    const dir = count.up ? 'up' : 'down';
    const state = n < EW_IMPULSE_PIVOTS ? `wave ${n} in progress` : count.abc.length > 0 ? 'impulse complete, A–B–C done' : 'impulse complete';
    const points = all.map((p, i) => `${i < n ? i : ABC_LABELS[i - n]} ${formatOverlayPoint(pt(p), fmt)}`).join(', ');
    return {
        id: `ew:${dir}:${bars[count.seq[0].index].time}:${n}${count.abc.length > 0 ? ':abc' : ''}`,
        kind: 'elliott',
        skill: 'elliott-wave',
        promptLine: `impulse ${dir}; ${state}; ${points}; score ${count.score.toFixed(2)}`,
        segments,
        levels: [],
        labels,
    };
}

/**
 * @internal
 * Elliott impulse counts (complete or still running at the right edge) that
 * pass the three absolute rules, scored on the textbook guidelines, with an
 * A–B–C attached when one follows a complete impulse (spec 2026-09-28 §3.5).
 * Pivot sensitivity is the screener's (1.5 ATR); counts are hypotheses, and
 * the model picks among them rather than drawing its own.
 */
export function buildElliottCandidates(bars: readonly Bar[], atr: number, fmt: OverlayFormat): OverlayCandidate[] {
    if (atr <= 0 || bars.length < 2) return [];
    const offset = Math.max(0, bars.length - SCREEN_LOOKBACK_BARS);
    const pivots = extractPivots(bars.slice(offset), atr, { includeProvisional: true })
        .map(p => ({ ...p, index: p.index + offset }));
    if (pivots.length < EW_MIN_PARTIAL_PIVOTS) return [];
    const seen = new Set<string>();
    return enumerate(pivots, bars.length - 1)
        .toSorted((a, b) => b.score - a.score)
        .map(c => toCandidate(c, bars, fmt))
        .filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)))
        .slice(0, ELLIOTT_CANDIDATE_LIMIT);
}
```
- [ ] **Step 4:** PASS. 실패 시 사다리 가격을 조정하되 규칙 코드를 테스트에 맞춰 느슨하게 만들지 않는다.
- [ ] **Step 5:** Commit 표시: `feat(overlays): elliott impulse and ABC candidates`

### Task A9: 합성·resolve·섹션

**Files:** Create `src/domain/overlays/buildOverlayCandidates.ts`, `src/domain/overlays/resolveChartOverlays.ts`, `src/domain/overlays/index.ts`, `src/domain/analysis/chartOverlayCandidatesSection.ts`; Modify `src/domain/analysis/chartPatternCandidatesSection.ts`; Tests `src/__tests__/domain/overlays/resolveChartOverlays.test.ts`, `src/__tests__/domain/overlays/buildOverlayCandidates.test.ts`, `src/__tests__/domain/analysis/chartOverlayCandidatesSection.test.ts`, 기존 `chartPatternCandidatesSection.test.ts` 갱신

- [ ] **Step 1:** `buildOverlayCandidates.ts`:
```ts
import type { Bar, MarketReference, OverlayCandidate, OverlayFormat, PatternCandidate } from '@/domain/types';
import { buildPatternOverlayCandidates } from '@/domain/overlays/patternOverlays';
import { buildTrendlineCandidates } from '@/domain/overlays/trendlineCandidates';
import { buildDivergenceCandidates } from '@/domain/overlays/divergenceCandidates';
import { buildFibonacciCandidates } from '@/domain/overlays/fibonacciCandidates';
import { buildElliottCandidates } from '@/domain/overlays/elliottCandidates';

/** @internal Inputs {@link buildAnalysisPrompt} already has in scope. */
export interface OverlayCandidateInput {
    bars: readonly Bar[];
    atr: number | null;
    rsi: readonly (number | null)[];
    patternCandidates: readonly PatternCandidate[];
    marketReference: MarketReference;
    fmt: OverlayFormat;
}

const safely = (build: () => OverlayCandidate[]): OverlayCandidate[] => {
    try {
        return build();
    } catch {
        return [];
    }
};

/**
 * @internal
 * Every overlay candidate for one prompt (spec 2026-09-28 §2.1). Each builder
 * is isolated: one throwing never costs the others or the analysis.
 */
export function buildOverlayCandidates(input: OverlayCandidateInput): OverlayCandidate[] {
    const { bars, rsi, patternCandidates, marketReference, fmt } = input;
    const atr = input.atr ?? 0;
    return [
        ...safely(() => buildPatternOverlayCandidates(patternCandidates, bars, atr)),
        ...safely(() => buildTrendlineCandidates(bars, atr, fmt)),
        ...safely(() => buildDivergenceCandidates(bars, rsi, fmt)),
        ...safely(() => buildFibonacciCandidates(marketReference, bars, fmt)),
        ...safely(() => buildElliottCandidates(bars, atr, fmt)),
    ];
}
```
`TechnicalAssembledPrompt`이 `domain/types.ts`에 있으니 `OverlayCandidateInput`도 규칙대로 `types.ts`로 옮긴다(`@internal` JSDoc).
- [ ] **Step 2: resolve 실패 테스트** `resolveChartOverlays.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { AnalysisResponse, OverlayCandidate } from '@/domain/types';
import { resolveChartOverlays } from '@/domain/overlays/resolveChartOverlays';

const cand = (id: string, kind: OverlayCandidate['kind'], role = 'x'): OverlayCandidate => ({
    id, kind, skill: 's', promptLine: 'p',
    segments: [{ from: { time: 1, price: 10 }, to: { time: 5, price: 12 }, role, style: 'solid', pane: 'price' }],
    levels: [], labels: [],
});
const CANDIDATES = [
    cand('pattern:double_bottom:1', 'pattern'),
    cand('tl:support:1:3', 'trendline', 'support'),
    cand('tl:resistance:2:4', 'trendline', 'resistance'),
    cand('ew:up:1:6', 'elliott'),
    cand('ew:up:2:5', 'elliott'),
    cand('fib:short:5', 'fibonacci'),
];
const analysis = (over: Partial<AnalysisResponse>): AnalysisResponse => ({
    summary: '', trend: 'neutral', indicatorResults: [], riskLevel: 'low',
    keyLevels: { support: [], resistance: [] }, priceTargets: { bullish: null, bearish: null },
    patternSummaries: [], strategyResults: [], candlePatterns: [], trendlines: [], ...over,
}) as AnalysisResponse;

describe('resolveChartOverlays', () => {
    it('keeps only referenced candidates, tagging their source', () => {
        const r = resolveChartOverlays(CANDIDATES, analysis({
            patternSummaries: [{ id: 'double_bottom_0', patternName: 'double_bottom', skillName: '이중바닥', detected: true, trend: 'bullish', summary: '', confidenceWeight: 1, candidateId: 'pattern:double_bottom:1' }],
            strategyResults: [{ id: 'ew_0', strategyName: '엘리어트 파동', trend: 'bullish', summary: '', confidenceWeight: 1, candidateIds: ['ew:up:1:6', 'ew:up:2:5'] }],
        }), ['tl:support:1:3']);
        expect(r.chartOverlays.map(o => [o.id, o.sourceRef, o.variant])).toEqual([
            ['pattern:double_bottom:1', 'double_bottom_0', 'primary'],
            ['ew:up:1:6', 'ew_0', 'primary'],
            ['ew:up:2:5', 'ew_0', 'alternate'],
            ['tl:support:1:3', 'trendlines', 'primary'],
        ]);
        expect(r.chartOverlays[0]).not.toHaveProperty('promptLine');
    });

    it('ignores detected:false patterns and drops invented ids', () => {
        const r = resolveChartOverlays(CANDIDATES, analysis({
            patternSummaries: [{ id: 'p', patternName: 'x', skillName: 'x', detected: false, trend: 'neutral', summary: '', confidenceWeight: 1, candidateId: 'pattern:double_bottom:1' }],
        }), ['tl:made:up']);
        expect(r.chartOverlays).toEqual([]);
        expect(r.unknownIds).toEqual(['tl:made:up']);
    });

    it('first reference wins; trendlines are derived from resolved trendline overlays (max 3)', () => {
        const r = resolveChartOverlays(CANDIDATES, analysis({}), ['tl:support:1:3', 'tl:resistance:2:4', 'tl:support:1:3']);
        expect(r.chartOverlays).toHaveLength(2);
        expect(r.trendlines).toEqual([
            { direction: 'ascending', start: { time: 1, price: 10 }, end: { time: 5, price: 12 } },
            { direction: 'descending', start: { time: 1, price: 10 }, end: { time: 5, price: 12 } },
        ]);
    });

    it('only the first two elliott ids of one strategy are used', () => {
        const r = resolveChartOverlays([...CANDIDATES, cand('ew:down:3:4', 'elliott')], analysis({
            strategyResults: [{ id: 'ew_0', strategyName: 'e', trend: 'neutral', summary: '', confidenceWeight: 1, candidateIds: ['ew:up:1:6', 'ew:up:2:5', 'ew:down:3:4'] }],
        }), []);
        expect(r.chartOverlays.map(o => o.id)).toEqual(['ew:up:1:6', 'ew:up:2:5']);
    });
});
```
- [ ] **Step 3:** 구현 `resolveChartOverlays.ts`:
```ts
import type { AnalysisResponse, ChartOverlay, OverlayCandidate, OverlayVariant, ResolvedChartOverlays, Trendline } from '@/domain/types';

const TRENDLINE_SOURCE_REF = 'trendlines';
const MAX_TRENDLINES = 3;
const MAX_ELLIOTT_PER_STRATEGY = 2;

interface Ref { id: string; sourceRef: string; variant: OverlayVariant }

function collectRefs(analysis: AnalysisResponse, trendlineIds: readonly string[], byId: ReadonlyMap<string, OverlayCandidate>): Ref[] {
    const patternRefs = analysis.patternSummaries.flatMap(p =>
        p.detected && p.candidateId ? [{ id: p.candidateId, sourceRef: p.id, variant: 'primary' as const }] : []);
    const strategyRefs = analysis.strategyResults.flatMap(s => {
        let elliottSeen = 0;
        return (s.candidateIds ?? []).flatMap(id => {
            if (byId.get(id)?.kind !== 'elliott') return [{ id, sourceRef: s.id, variant: 'primary' as const }];
            elliottSeen++;
            if (elliottSeen > MAX_ELLIOTT_PER_STRATEGY) return [];
            return [{ id, sourceRef: s.id, variant: elliottSeen === 1 ? ('primary' as const) : ('alternate' as const) }];
        });
    });
    const trendRefs = trendlineIds.slice(0, MAX_TRENDLINES).map(id => ({ id, sourceRef: TRENDLINE_SOURCE_REF, variant: 'primary' as const }));
    return [...patternRefs, ...strategyRefs, ...trendRefs];
}

function toTrendline(o: ChartOverlay): Trendline {
    const [s] = o.segments;
    return { direction: s.role === 'support' ? 'ascending' : 'descending', start: s.from, end: s.to };
}

/**
 * @internal
 * Joins the model's candidate ids to the candidates the prompt offered
 * (spec 2026-09-28 §2.5). Pure; an id the prompt never offered is returned in
 * `unknownIds` for logging and otherwise ignored.
 */
export function resolveChartOverlays(
    candidates: readonly OverlayCandidate[],
    analysis: AnalysisResponse,
    trendlineIds: readonly string[],
): ResolvedChartOverlays {
    const byId = new Map(candidates.map(c => [c.id, c]));
    const seen = new Set<string>();
    const unknownIds: string[] = [];
    const chartOverlays: ChartOverlay[] = [];
    for (const ref of collectRefs(analysis, trendlineIds, byId)) {
        const candidate = byId.get(ref.id);
        if (!candidate) {
            unknownIds.push(ref.id);
            continue;
        }
        if (seen.has(ref.id)) continue;
        seen.add(ref.id);
        const { promptLine: _promptLine, ...drawable } = candidate;
        chartOverlays.push({ ...drawable, sourceRef: ref.sourceRef, variant: ref.variant });
    }
    return {
        chartOverlays,
        trendlines: chartOverlays.filter(o => o.kind === 'trendline').map(toTrendline),
        unknownIds,
    };
}
```
- [ ] **Step 4:** `chartOverlayCandidatesSection.ts`:
```ts
import type { OverlayCandidate, OverlayKind } from '@/domain/types';

/** @internal Section header — referenced verbatim by the writing rules in prompt.ts. */
export const CHART_OVERLAY_CANDIDATES_SECTION_HEADER = '## Chart Overlay Candidates (computed)';

/** @internal */
export const CHART_OVERLAY_CANDIDATES_SECTION_INTRO =
    'Logic-computed drawings. When a result item relies on one, copy its id into that item (trendlineIds / strategyResults[].candidateIds). Never invent an id and never write coordinates — the app draws from these ids.';

const GROUPS: ReadonlyArray<[Exclude<OverlayKind, 'pattern'>, string]> = [
    ['trendline', '### Trendlines'],
    ['divergence', '### Divergences'],
    ['fibonacci', '### Fibonacci'],
    ['elliott', '### Elliott waves'],
];

/**
 * @internal
 * Renders the non-pattern overlay candidates (patterns carry their id inside
 * `## Chart Pattern Candidates (computed)`). `''` when there are none, so the
 * caller can skip the section entirely.
 */
export function formatChartOverlayCandidatesSection(candidates: readonly OverlayCandidate[]): string {
    const blocks = GROUPS.flatMap(([kind, title]) => {
        const lines = candidates.filter(c => c.kind === kind).map(c => `- id: ${c.id} | skill: ${c.skill} | ${c.promptLine}`);
        return lines.length > 0 ? [[title, ...lines].join('\n')] : [];
    });
    if (blocks.length === 0) return '';
    return [CHART_OVERLAY_CANDIDATES_SECTION_HEADER, CHART_OVERLAY_CANDIDATES_SECTION_INTRO, ...blocks].join('\n');
}
```
테스트: 빈 입력 → `''`; kind별 그룹 제목과 `- id: … | skill: … |` 줄; pattern kind는 출력 안 됨.
- [ ] **Step 5:** `chartPatternCandidatesSection.ts` — `formatCandidate`에 `overlayId: string | null` 인자 추가, geometry가 있는 블록의 제목 다음 줄에 `- Candidate id: ${overlayId}`를 넣는다(null이면 줄 생략). `formatChartPatternCandidatesSection`은 `patternOverlayId(candidate, bars)`를 넘긴다(geometry null이면 null). 인트로 문장 끝에 `" For a candidate you confirm, set that pattern's candidateId to its Candidate id."`를 덧붙인다. 기존 테스트 기대 문자열 갱신.
- [ ] **Step 6:** `index.ts` 배럴: `buildOverlayCandidates`, `resolveChartOverlays`, `patternOverlayId` re-export.
- [ ] **Step 7:** `buildOverlayCandidates.test.ts` — 실제 픽스처(`double-top.json`) + 빈 marketReference(각 horizon `fibProjection: null, abcExtension: null`) + rsi 전부 50으로 호출해 pattern 후보가 포함되고 예외가 없는지; 한 빌더가 throw해도 나머지가 나오는지는 `marketReference`에 `null`을 넣어(`buildFibonacciCandidates`가 throw) 확인.
- [ ] **Step 8:** 스코프 테스트 PASS. Commit 표시: `feat(overlays): compose candidates, resolve model ids, prompt sections`

### Task A10: 응답 스키마·정규화·캐시·tier

**Files:** Modify `responseSchemas.ts`, `normalize.ts`, `confidence.ts`, `filterAnalysisResult.ts`; Tests 해당 테스트 파일 갱신

- [ ] **Step 1:** `responseSchemas.ts` — `patternSummaries.items.properties`에서 `patternLines`, `timeRange` 삭제, `candidateId: { type: ['string', 'null'] }` 추가, `required`에서 두 필드 빼고 `'candidateId'` 추가. `strategyResults.items`에 `candidateIds: { type: 'array', items: { type: 'string' } }` + required. 최상위 `trendlines` 속성·required를 `trendlineIds: { type: 'array', items: { type: 'string' } }`로 교체. 파일 상단 JSDoc(309, 389 부근)의 `patternLines`·`trendlines` 언급을 새 필드로 고친다. `TRENDLINE_POINT_SCHEMA`가 더 안 쓰이면 삭제.
- [ ] **Step 2:** `normalize.ts`:
```ts
/** @internal A string[] of non-empty strings; anything else → []. */
export function normalizeIdList(v: unknown): string[] {
    return asArray(v).filter((x): x is string => typeof x === 'string' && x !== '');
}
```
`normalizePatternSummary`: `patternLines`/`timeRange` 제거, `...(typeof o.candidateId === 'string' && o.candidateId !== '' ? { candidateId: o.candidateId } : {})` 추가. `normalizeStrategyResult`: `...(Array.isArray(o.candidateIds) ? { candidateIds: normalizeIdList(o.candidateIds) } : {})`. `normalizePatternLine`, `normalizeTimeRange` 삭제(다른 사용처 없음을 grep으로 확인).
오버레이 캐시 검증:
```ts
const OVERLAY_KINDS = new Set(['pattern', 'trendline', 'divergence', 'fibonacci', 'elliott']);
const isPoint = (v: unknown): boolean => {
    const o = asObject(v);
    return !!o && Number.isFinite(o.time) && Number.isFinite(o.price);
};
/** @internal Cached `chartOverlays` entry → `ChartOverlay`, or `null` when malformed. */
export function normalizeChartOverlay(v: unknown): ChartOverlay | null {
    const o = asObject(v);
    if (!o || typeof o.id !== 'string' || !OVERLAY_KINDS.has(o.kind as string)) return null;
    const segments = asArray(o.segments).filter(s => isPoint(asObject(s)?.from) && isPoint(asObject(s)?.to));
    const levels = asArray(o.levels).filter(l => Number.isFinite(asObject(l)?.price) && Number.isFinite(asObject(l)?.fromTime));
    if (segments.length === 0 && levels.length === 0) return null;
    return {
        id: o.id,
        kind: o.kind as ChartOverlay['kind'],
        skill: asString(o.skill),
        sourceRef: asString(o.sourceRef),
        variant: o.variant === 'alternate' ? 'alternate' : 'primary',
        segments: segments as ChartOverlay['segments'],
        levels: levels as ChartOverlay['levels'],
        labels: asArray(o.labels).filter(l => isPoint(asObject(l)?.at)) as ChartOverlay['labels'],
    };
}
```
(`Number.isFinite(o.time)`은 unknown이라 타입 에러가 나면 `typeof x === 'number' && Number.isFinite(x)` 헬퍼로.) 테스트: 정상 1건 통과, kind 오류·세그먼트 없음 → null, `patternLines`가 남은 옛 캐시 패턴 → 에러 없이 필드 무시.
- [ ] **Step 3:** `confidence.ts` `normalizeCachedAnalysisResponse` 반환에 `chartOverlays: compact(asArray(raw.chartOverlays).map(normalizeChartOverlay))` 추가. `enrichAnalysisWithConfidence`는 `chartOverlays`를 넣지 않는다(runAnalysis가 채움).
- [ ] **Step 4:** `filterAnalysisResult.ts` filtered 객체에:
```ts
        chartOverlays: (result.chartOverlays ?? []).filter(o =>
            o.kind === 'trendline' ? allowFullDetail : allowSkillDetection
        ),
```
테스트: free tier(`skill_detection` 없음) → 패턴 오버레이 제거; `full_detail` 없는 tier → 추세선만 제거.
- [ ] **Step 5:** `yarn test src/__tests__/domain/analysis/normalize.test.ts src/__tests__/domain/analysis/confidence.test.ts src/__tests__/domain/analysis/filterAnalysisResult.test.ts` + 스키마 테스트(있으면 `grep -rl TECHNICAL_RESPONSE_SCHEMA src/__tests__`) PASS. Commit 표시: `feat(analysis): id-based overlay fields in the response schema`

### Task A11: 프롬프트 배선

**Files:** Modify `src/domain/analysis/prompt.ts`; Tests `prompt.test.ts`, 스냅샷

- [ ] **Step 1:** `buildAnalysisPrompt` 반환 타입을 `TechnicalAssembledPrompt`로. `marketReference` 계산 직후:
```ts
    const overlayCandidates = buildOverlayCandidates({
        bars,
        atr: atrForPatternGeometry,
        rsi: indicators.rsi,
        patternCandidates,
        marketReference,
        fmt: { timeframe, priceDp },
    });
```
dynamic 섹션 배열에서 `formatChartPatternCandidatesSection(...)` 바로 뒤에:
```ts
        ...nonEmpty(formatChartOverlayCandidatesSection(overlayCandidates)),
```
(`nonEmpty = (s: string) => (s ? [s] : [])` — 이미 비슷한 헬퍼가 있으면 그것을 쓴다.) 반환 객체에 `overlayCandidates` 추가.
- [ ] **Step 2:** `buildAnalysisRequest`의 `### patternLines Writing Rules` 블록 전체를 교체:
```ts
                  '### candidateId Writing Rules',
                  `- For a detected: true pattern that matches a candidate in ${CHART_PATTERN_CANDIDATES_SECTION_HEADER}, set candidateId to that candidate's "Candidate id" verbatim.`,
                  '- Otherwise (detected: false, or a pattern that section does not list) set candidateId to null. Never invent an id.',
```
- [ ] **Step 3:** 전략 지시(`strategyInstruction`)의 규칙 목록 끝에 추가:
```ts
                  `- candidateIds: the ids from ${CHART_OVERLAY_CANDIDATES_SECTION_HEADER} this verdict actually relies on — divergence strategy → Divergences, fibonacci strategy → Fibonacci, Elliott wave → Elliott waves (first id = your primary count, optional second id = an alternate count). Copy ids verbatim; [] when none applies.`,
```
- [ ] **Step 4:** `### Trendline Detection`(1620 부근)와 `### trendlines vs patternLines` 블록을 교체:
```ts
        '### trendlineIds',
        `- Pick 0 to 3 ids from the Trendlines group of ${CHART_OVERLAY_CANDIDATES_SECTION_HEADER} that best describe the chart now (more touches and a recent second anchor weigh more). Copy ids verbatim; never invent one.`,
        '- Return [] when that group is absent or no listed line matters.',
        '- Pattern boundaries (wedge edges, necklines) are drawn from the pattern candidate itself — do not look for them here.',
        '',
```
`grep -n "trendlines" src/domain/analysis/prompt.ts src/domain/analysis/systemPrompt.ts`로 나머지 언급(필드 설명 등)을 찾아 `trendlineIds`로 맞춘다. 주석 속 `trendlines`(tier fragment 설명)는 그대로 둔다.
- [ ] **Step 5:** `yarn test src/__tests__/domain/analysis/prompt.test.ts src/__tests__/domain/analysis/prompt-gating.test.ts src/__tests__/domain/analysis/prompt-smc.test.ts src/__tests__/domain/analysisPromptAssetClass.test.ts` — 실패한 문자열 단언은 새 문구로 고치고, 스냅샷은 `yarn test <file> -u` 후 diff를 읽어 의도한 변화(새 섹션·규칙·후보 id 줄)만 있는지 확인한다.
- [ ] **Step 6:** 새 테스트(prompt.test.ts에 추가): 실제 픽스처 bars로 `buildAnalysisPrompt`를 돌려 `overlayCandidates`의 모든 비패턴 id가 `dynamic`에 문자열로 들어 있고, 패턴 id는 `- Candidate id: ` 줄로 들어 있는지.
- [ ] **Step 7:** Commit 표시: `feat(prompt): offer overlay candidate ids to the model`

### Task A12: runAnalysis·버전·export

**Files:** Modify `src/application/market/runAnalysis.ts`, `src/infrastructure/cache/config.ts`, `src/index.ts`, `src/index.client.ts`; Tests runAnalysis 테스트, `index.test.ts`, `index.client.test.ts`

- [ ] **Step 1:** runAnalysis — `const { stable, dynamic, overlayCandidates } = buildAnalysisPrompt(...)`. `reconciled` 다음:
```ts
    const resolvedOverlays = resolveChartOverlays(
        overlayCandidates,
        reconciled,
        normalizeIdList(asObject(rawResult)?.trendlineIds)
    );
    if (resolvedOverlays.unknownIds.length > 0) {
        console.warn('[ChartOverlays] unknown candidate id', {
            symbol,
            timeframe,
            unknownIds: resolvedOverlays.unknownIds,
        });
    }
    console.info('[ChartOverlays] resolved', {
        symbol,
        timeframe,
        offered: overlayCandidates.length,
        referenced: resolvedOverlays.chartOverlays.length,
    });

    const now = new Date();
    const analyzedAt = now.toISOString();
    const result = {
        ...reconciled,
        trendlines: resolvedOverlays.trendlines,
        chartOverlays: resolvedOverlays.chartOverlays,
        analyzedAt,
    };
```
(application 레이어의 기존 로그 방식이 `console.info`를 안 쓰면 `console.log`로 맞춘다 — grep으로 확인.)
- [ ] **Step 2:** runAnalysis 테스트: LLM 목 응답에 `patternSummaries[0].candidateId`로 실제 후보 id(목 bars에서 나온 것)를 넣었을 때 `result.chartOverlays`가 1건, 없는 id를 넣으면 0건 + `console.warn` 호출(`vi.spyOn`) — 목 bars에서 후보가 안 나오면 `buildAnalysisPrompt`를 부분 목킹하지 말고 bars를 `double-top.json` 픽스처로 바꾼다.
- [ ] **Step 3:** `config.ts`: `PROMPT_TEMPLATE_VERSION = 'p19'`, 바로 위 변경 이력 주석 관례가 있으면 한 줄 추가(“p19: chart overlay candidate ids”).
- [ ] **Step 4:** `index.ts`/`index.client.ts`: 타입 export에서 `PatternLine` 삭제, `ChartOverlay`, `OverlayKind`, `OverlayPane`, `OverlayPoint`, `OverlaySegment`, `OverlayLevel`, `OverlayLabel`, `OverlayLineStyle`, `OverlayLabelPosition`, `OverlayVariant` 추가(기존 알파벳/그룹 순서 따름). `index.test.ts`류가 export 목록을 단언하면 갱신.
- [ ] **Step 5:** 게이트: `yarn typecheck && yarn lint && yarn test src/__tests__/domain/overlays src/__tests__/domain/analysis src/__tests__/domain/signals src/__tests__/application/market src/__tests__/index.test.ts src/__tests__/index.client.test.ts`.
- [ ] **Step 6:** Commit 표시: `feat(analysis): resolve chart overlays after the model call (p19)`

### Task A13: core 리뷰·PR·릴리스

- [ ] review-agent(core) → 지적 수정 루프 → mistake-managing-agent → git-agent(push + PR).
- [ ] PR 리뷰 모니터 루프(claude-review, CI). APPROVED 후 main 머지 → `yarn release`(minor, 1.18.0) → tarball 확인.

---

## Part B — siglens

### Task B1: 워크트리·core 오버레이

- [ ] **Step 1:**
```bash
cd /Users/y0ngha/Project/siglens && git fetch origin
git worktree add ../siglens-wt-overlays -b feat/chart-overlays origin/master
cd ../siglens-wt-overlays && cp -al ../siglens/node_modules ./node_modules
ls -d node_modules/node_modules 2>/dev/null && rm -rf node_modules/node_modules
```
- [ ] **Step 2:** core 릴리스 전 로컬 검증용 오버레이: core 워크트리에서 `yarn build` → `rm -rf node_modules/@y0ngha/siglens-core/dist && cp -R ../siglens-core-wt-overlays/dist node_modules/@y0ngha/siglens-core/dist`(하드링크 공유 inode를 건드리지 않도록 **삭제 후 복사**). 오버레이는 커밋하지 않는다. 릴리스 후 `package.json` 핀을 올리고 `yarn install`로 교체.

### Task B2: 카테고리 모델·순수 변환

**Files:** Create `src/widgets/chart/model/chartOverlayCategories.ts`, `src/widgets/chart/utils/chartOverlayUtils.ts`; Test `src/widgets/chart/__tests__/utils/chartOverlayUtils.test.ts`

- [ ] **Step 1:** `chartOverlayCategories.ts`:
```ts
import type { OverlayKind } from '@y0ngha/siglens-core';

/** 드롭다운 표시 순서. */
export const CHART_OVERLAY_KINDS: readonly OverlayKind[] = ['pattern', 'trendline', 'divergence', 'fibonacci', 'elliott'];

/** 처음 방문 시 켜 둘 카테고리 — 패턴·추세선만(선이 많아지면 가격이 안 보인다). */
export const DEFAULT_CHART_OVERLAY_VISIBILITY: Readonly<Record<OverlayKind, boolean>> = {
    pattern: true, trendline: true, divergence: false, fibonacci: false, elliott: false,
};

/** 패턴 외 kind 고정 색. 패턴은 스킬 frontmatter 색(`renderConfig.color`)을 쓴다 — 여기선 폴백. */
export const CHART_OVERLAY_COLORS = {
    pattern: '#42a5f5',
    support: '#26a69a',
    resistance: '#ef5350',
    divergence: '#ffb300',
    fibonacci: '#ab47bc',
    elliott: '#ffa726',
} as const;

export const ALTERNATE_OVERLAY_OPACITY = 0.5;
export const DIMMED_OVERLAY_OPACITY = 0.3;
export const HIGHLIGHT_LINE_WIDTH_MULT = 2;
```
(색은 기존 `chartColors`/테마 토큰이 있으면 그것을 재사용하도록 확인 — `grep -rn "26a69a\|ef5350" src/shared src/widgets/chart | head`.)
- [ ] **Step 2: 실패 테스트** `chartOverlayUtils.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { ChartOverlay } from '@y0ngha/siglens-core';
import { buildOverlayLineSpecs, countOverlaysByKind, isOverlayAlignedToBars } from '../../utils/chartOverlayUtils';

const overlay = (over: Partial<ChartOverlay>): ChartOverlay => ({
    id: 'pattern:double_bottom:1', kind: 'pattern', skill: 'double_bottom', sourceRef: 'double_bottom_0', variant: 'primary',
    segments: [{ from: { time: 1, price: 10 }, to: { time: 3, price: 12 }, role: 'pattern', style: 'solid', pane: 'price' }],
    levels: [{ price: 11, fromTime: 1, label: 'breakout' }],
    labels: [],
    ...over,
});
const BAR_TIMES = new Set([1, 2, 3, 4, 5]);

describe('isOverlayAlignedToBars', () => {
    it('true only when every anchor time is a loaded bar', () => {
        expect(isOverlayAlignedToBars(overlay({}), BAR_TIMES)).toBe(true);
        expect(isOverlayAlignedToBars(overlay({ levels: [{ price: 1, fromTime: 99, label: '' }] }), BAR_TIMES)).toBe(false);
    });
});

describe('buildOverlayLineSpecs', () => {
    const base = { visible: { pattern: true, trendline: true, divergence: true, fibonacci: true, elliott: true }, highlightedSourceRef: null, lastBarTime: 5, rsiPaneIndex: 2, colorFor: () => '#000' };

    it('segment → 2-point price series; level → fromTime to last bar', () => {
        const specs = buildOverlayLineSpecs([overlay({})], { ...base, barTimes: BAR_TIMES });
        expect(specs.map(s => s.points)).toEqual([
            [{ time: 1, value: 10 }, { time: 3, value: 12 }],
            [{ time: 1, value: 11 }, { time: 5, value: 11 }],
        ]);
        expect(specs.every(s => s.paneIndex === 0)).toBe(true);
    });

    it('hidden kind, misaligned overlay, and zero-length segment produce nothing', () => {
        expect(buildOverlayLineSpecs([overlay({})], { ...base, barTimes: BAR_TIMES, visible: { ...base.visible, pattern: false } })).toEqual([]);
        expect(buildOverlayLineSpecs([overlay({ levels: [{ price: 1, fromTime: 99, label: '' }] })], { ...base, barTimes: BAR_TIMES })).toEqual([]);
        const flat = overlay({ segments: [{ from: { time: 2, price: 1 }, to: { time: 2, price: 2 }, role: 'x', style: 'solid', pane: 'price' }], levels: [] });
        expect(buildOverlayLineSpecs([flat], { ...base, barTimes: BAR_TIMES })).toEqual([]);
    });

    it('rsi segments go to the rsi pane, or are dropped when that pane is off', () => {
        const div = overlay({ kind: 'divergence', levels: [], segments: [
            { from: { time: 1, price: 10 }, to: { time: 4, price: 9 }, role: 'price', style: 'solid', pane: 'price' },
            { from: { time: 1, price: 30 }, to: { time: 4, price: 40 }, role: 'rsi', style: 'solid', pane: 'rsi' },
        ] });
        expect(buildOverlayLineSpecs([div], { ...base, barTimes: BAR_TIMES }).map(s => s.paneIndex)).toEqual([0, 2]);
        expect(buildOverlayLineSpecs([div], { ...base, barTimes: BAR_TIMES, rsiPaneIndex: null })).toHaveLength(1);
    });

    it('highlight widens the matching overlay and dims the rest; alternate is faded', () => {
        const a = overlay({});
        const b = overlay({ id: 'x', sourceRef: 'other', levels: [] });
        const specs = buildOverlayLineSpecs([a, b], { ...base, barTimes: BAR_TIMES, highlightedSourceRef: 'double_bottom_0' });
        expect(specs.find(s => s.overlayId === a.id)!.lineWidthMult).toBe(2);
        expect(specs.find(s => s.overlayId === 'x')!.opacity).toBe(0.3);
        const alt = buildOverlayLineSpecs([overlay({ variant: 'alternate' })], { ...base, barTimes: BAR_TIMES });
        expect(alt[0].opacity).toBe(0.5);
    });

    it('labels ride on the first spec of their overlay as markers', () => {
        const withLabels = overlay({ labels: [{ at: { time: 3, price: 12 }, text: 'H', position: 'above' }] });
        const [first] = buildOverlayLineSpecs([withLabels], { ...base, barTimes: BAR_TIMES });
        expect(first.markers).toEqual([{ time: 3, position: 'aboveBar', text: 'H' }]);
    });
});

describe('countOverlaysByKind', () => {
    it('counts aligned overlays per kind', () => {
        expect(countOverlaysByKind([overlay({}), overlay({ id: 'y' })], BAR_TIMES).pattern).toBe(2);
    });
});
```
- [ ] **Step 3:** 구현 `chartOverlayUtils.ts`:
```ts
import type { ChartOverlay, OverlayKind, OverlayLabel } from '@y0ngha/siglens-core';
import { ALTERNATE_OVERLAY_OPACITY, DIMMED_OVERLAY_OPACITY, HIGHLIGHT_LINE_WIDTH_MULT } from '../model/chartOverlayCategories';

const PRICE_PANE_INDEX = 0;

export interface OverlayLinePoint { time: number; value: number }
export interface OverlayMarker { time: number; position: 'aboveBar' | 'belowBar'; text: string }

/** LineSeries 하나 = 선분 하나(2점) 또는 수평 레벨 하나. */
export interface OverlayLineSpec {
    key: string;
    overlayId: string;
    paneIndex: number;
    points: [OverlayLinePoint, OverlayLinePoint];
    color: string;
    dashed: boolean;
    opacity: number;
    lineWidthMult: number;
    /** 레벨 라벨(가격축 옆 title). */
    title: string;
    markers: OverlayMarker[];
}

export interface OverlayLineSpecOptions {
    visible: Readonly<Record<OverlayKind, boolean>>;
    highlightedSourceRef: string | null;
    barTimes: ReadonlySet<number>;
    lastBarTime: number;
    /** RSI 패인이 꺼져 있으면 null. */
    rsiPaneIndex: number | null;
    colorFor: (overlay: ChartOverlay, role: string) => string;
}

/**
 * 오버레이의 모든 기준 시각이 지금 로드된 봉에 있는지. 다른 timeframe의
 * 분석이 잠깐 남아 있거나 봉 창이 좁아졌을 때 엉뚱한 위치에 그리지 않게 한다.
 */
export function isOverlayAlignedToBars(overlay: ChartOverlay, barTimes: ReadonlySet<number>): boolean {
    const times = [
        ...overlay.segments.flatMap(s => [s.from.time, s.to.time]),
        ...overlay.levels.map(l => l.fromTime),
        ...overlay.labels.map(l => l.at.time),
    ];
    return times.every(t => barTimes.has(t));
}

export function countOverlaysByKind(overlays: readonly ChartOverlay[], barTimes: ReadonlySet<number>): Record<OverlayKind, number> {
    const counts: Record<OverlayKind, number> = { pattern: 0, trendline: 0, divergence: 0, fibonacci: 0, elliott: 0 };
    for (const o of overlays) if (isOverlayAlignedToBars(o, barTimes)) counts[o.kind]++;
    return counts;
}

const toMarker = (l: OverlayLabel): OverlayMarker => ({ time: l.at.time, position: l.position === 'above' ? 'aboveBar' : 'belowBar', text: l.text });

export function buildOverlayLineSpecs(overlays: readonly ChartOverlay[], opts: OverlayLineSpecOptions): OverlayLineSpec[] {
    return overlays.flatMap(overlay => {
        if (!opts.visible[overlay.kind] || !isOverlayAlignedToBars(overlay, opts.barTimes)) return [];
        const highlighted = opts.highlightedSourceRef !== null && overlay.sourceRef === opts.highlightedSourceRef;
        const dimmed = opts.highlightedSourceRef !== null && !highlighted;
        const opacity = dimmed ? DIMMED_OVERLAY_OPACITY : overlay.variant === 'alternate' ? ALTERNATE_OVERLAY_OPACITY : 1;
        const lineWidthMult = highlighted ? HIGHLIGHT_LINE_WIDTH_MULT : 1;

        const segmentSpecs = overlay.segments.flatMap((s, i): OverlayLineSpec[] => {
            if (s.to.time <= s.from.time) return [];
            const paneIndex = s.pane === 'rsi' ? opts.rsiPaneIndex : PRICE_PANE_INDEX;
            if (paneIndex === null) return [];
            return [{
                key: `${overlay.id}:s${i}`, overlayId: overlay.id, paneIndex,
                points: [{ time: s.from.time, value: s.from.price }, { time: s.to.time, value: s.to.price }],
                color: opts.colorFor(overlay, s.role), dashed: s.style === 'dashed',
                opacity, lineWidthMult, title: '', markers: [],
            }];
        });
        const levelSpecs = overlay.levels.flatMap((l, i): OverlayLineSpec[] =>
            l.fromTime >= opts.lastBarTime ? [] : [{
                key: `${overlay.id}:l${i}`, overlayId: overlay.id, paneIndex: PRICE_PANE_INDEX,
                points: [{ time: l.fromTime, value: l.price }, { time: opts.lastBarTime, value: l.price }],
                color: opts.colorFor(overlay, 'level'), dashed: true,
                opacity, lineWidthMult, title: l.label, markers: [],
            }]);
        const specs = [...segmentSpecs, ...levelSpecs];
        if (specs.length > 0 && overlay.labels.length > 0) {
            specs[0] = { ...specs[0], markers: overlay.labels.map(toMarker).toSorted((a, b) => a.time - b.time) };
        }
        return specs;
    });
}
```
라벨 마커를 첫 스펙 시리즈에 붙이는데, lightweight-charts 마커는 시리즈 데이터에 있는 시각에만 표시된다. 첫 스펙이 2점 선분이라 라벨 시각이 그 2점 밖이면 안 보인다 → 훅에서 **라벨 전용 투명 LineSeries**(라벨 시각들을 점으로 가진 시리즈, `visible: true`, `color: 'transparent'`, lineVisible false)를 만들어 거기에 마커를 붙인다. 그래서 순수 함수는 `markers`를 오버레이별로 한 번 계산만 하고, 훅이 라벨 시리즈를 따로 만든다(아래 B4). 테스트의 마지막 `labels ride on the first spec` 단언은 그대로 둔다(데이터 전달 경로 검증).
- [ ] **Step 4:** `yarn test src/widgets/chart/__tests__/utils/chartOverlayUtils.test.ts` PASS.

### Task B3: 카테고리 on/off 영속

**Files:** Modify `src/widgets/chart/constants.ts`; Create `src/widgets/chart/hooks/useChartOverlayVisibility.ts`; Test `src/widgets/chart/__tests__/hooks/useChartOverlayVisibility.test.ts`

- [ ] **Step 1:** `STORAGE_KEYS`에 `chartOverlays: \`${STORAGE_PREFIX}.chartOverlays\`,` 추가. 고아 상수 `REGION_LOWER_PRICE_INDEX`, `REGION_UPPER_PRICE_INDEX`, `REGION_KEY_PRICE_MIN_LENGTH` 삭제(다른 사용처 grep 0 확인, `MARKER_*`/`LABEL_SERIES_INDEX`도 grep 후 0이면 삭제).
- [ ] **Step 2:** 훅:
```ts
'use client';

import { useCallback, useMemo } from 'react';
import type { OverlayKind } from '@y0ngha/siglens-core';
import { usePersistentState } from '@/shared/hooks/usePersistentState';
import { STORAGE_KEYS } from '../constants';
import { DEFAULT_CHART_OVERLAY_VISIBILITY } from '../model/chartOverlayCategories';

export function useChartOverlayVisibility() {
    const [persisted, setPersisted] = usePersistentState<Partial<Record<OverlayKind, boolean>>>(
        STORAGE_KEYS.chartOverlays,
        DEFAULT_CHART_OVERLAY_VISIBILITY
    );
    // 저장본에 없는 kind(새 카테고리)는 기본값으로 채운다.
    const visible = useMemo<Record<OverlayKind, boolean>>(
        () => ({ ...DEFAULT_CHART_OVERLAY_VISIBILITY, ...persisted }),
        [persisted]
    );
    const toggle = useCallback(
        (kind: OverlayKind) => setPersisted(prev => ({ ...DEFAULT_CHART_OVERLAY_VISIBILITY, ...prev, [kind]: !({ ...DEFAULT_CHART_OVERLAY_VISIBILITY, ...prev })[kind] })),
        [setPersisted]
    );
    return { visible, toggle };
}
```
(`usePersistentState`의 setter가 함수형 업데이트를 지원하는지 확인 — 안 하면 `visible`을 클로저로 써서 `setPersisted({ ...visible, [kind]: !visible[kind] })`.) 명시적 반환 타입 인터페이스를 둔다(레포 관례).
- [ ] **Step 3:** 테스트: 기본값(pattern/trendline true), toggle 후 반전, 저장본 누락 키 기본값 채움. `useIndicatorVisibility` 테스트 파일이 있으면 그 패턴(localStorage 초기화 방식)을 따른다.

### Task B4: 렌더 훅

**Files:** Create `src/widgets/chart/hooks/useChartOverlays.ts`; Test `src/widgets/chart/__tests__/hooks/useChartOverlays.test.ts`

- [ ] **Step 1:** 훅(기존 `useSmcZones`·`useCandlePatternMarkers`의 ref/cleanup 패턴을 그대로 따른다):
```ts
'use client';

import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';
import { createSeriesMarkers, LineSeries, LineStyle, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';
import type { OverlayLineSpec } from '../utils/chartOverlayUtils';
import { DEFAULT_LINE_WIDTH } from '../constants';

const OVERLAY_SERIES_OPTIONS = {
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    // 오버레이가 가격축 범위를 넓히면 캔들이 납작해진다 — 자동 스케일에서 뺀다.
    autoscaleInfoProvider: () => null,
} as const;

function withOpacity(hex: string, opacity: number): string {
    if (opacity >= 1 || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
    return `${hex}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`;
}

interface UseChartOverlaysParams {
    chartRef: RefObject<IChartApi | null>;
    specs: readonly OverlayLineSpec[];
    lineWidth?: number;
}

export function useChartOverlays({ chartRef, specs, lineWidth = DEFAULT_LINE_WIDTH }: UseChartOverlaysParams): void {
    const seriesRef = useRef<ISeriesApi<'Line'>[]>([]);

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        const created = specs.map(spec => {
            const series = chart.addSeries(LineSeries, {
                ...OVERLAY_SERIES_OPTIONS,
                color: withOpacity(spec.color, spec.opacity),
                lineWidth: Math.max(1, Math.round(lineWidth * spec.lineWidthMult)) as 1 | 2 | 3 | 4,
                lineStyle: spec.dashed ? LineStyle.Dashed : LineStyle.Solid,
                title: spec.title,
            }, spec.paneIndex);
            series.setData(spec.points.map(p => ({ time: p.time as Time, value: p.value })));
            if (spec.markers.length > 0) {
                // 라벨 시각이 선분 2점 밖일 수 있어 라벨 전용 투명 시리즈에 마커를 단다.
                const labelSeries = chart.addSeries(LineSeries, { ...OVERLAY_SERIES_OPTIONS, color: 'transparent', lineVisible: false }, spec.paneIndex);
                labelSeries.setData(spec.markers.map(m => ({ time: m.time as Time, value: 0 })));
                createSeriesMarkers(labelSeries, spec.markers.map(m => ({
                    time: m.time as Time, position: m.position, shape: 'circle', size: 0, color: withOpacity(spec.color, spec.opacity), text: m.text,
                })));
                return [series, labelSeries];
            }
            return [series];
        }).flat();
        seriesRef.current = created;
        return () => {
            for (const s of seriesRef.current) {
                try { chart.removeSeries(s); } catch { /* 차트가 먼저 제거된 경우 */ }
            }
            seriesRef.current = [];
        };
    }, [chartRef, specs, lineWidth]);
}
```
주의: 라벨 시리즈의 `value: 0`은 `autoscaleInfoProvider: () => null`이라 축에 영향 없지만, 마커 위치(aboveBar/belowBar)는 **그 시리즈의 값** 기준이라 0이면 바닥에 찍힌다 → 라벨 시리즈 값은 라벨의 가격을 써야 한다. 그래서 `OverlayMarker`에 `price`를 추가해(`B2`의 `toMarker`에서 `l.at.price`) `value: m.price`로 넣는다. B2 테스트의 마커 기대값에 `price`를 추가한다.
lightweight-charts v5 `LineSeries`에 `lineVisible` 옵션이 없으면 `lineWidth: 1` + `color: 'transparent'`로 대체한다(타입 에러로 확인).
- [ ] **Step 2:** 테스트: 기존 훅 테스트(`src/widgets/chart/__tests__/hooks/useSmcZones.test.ts` 등)의 차트 목 방식 재사용 — specs 2개 → `addSeries` 2회·`setData` 2회, 언마운트 시 `removeSeries` 2회, markers 있는 spec → 라벨 시리즈 추가 + `createSeriesMarkers` 호출, specs 변경 시 이전 시리즈 제거 후 재생성.

### Task B5: 드롭다운 UI

**Files:** Create `src/widgets/chart/ui/ChartOverlayMenu.tsx`; Test `src/widgets/chart/__tests__/ui/ChartOverlayMenu.test.tsx`

- [ ] **Step 1:** 기존 헤더 팝오버(`PopoverSurface` + `AnalysisSettingsMenu` 또는 `IndicatorSettingsModal`)의 열기/닫기·포커스·바깥 클릭·Esc 처리 패턴을 먼저 읽고 그대로 따른다. 컴포넌트 계약:
```tsx
interface ChartOverlayMenuProps {
    counts: Readonly<Record<OverlayKind, number>>;
    visible: Readonly<Record<OverlayKind, boolean>>;
    onToggle: (kind: OverlayKind) => void;
}
```
- 전체 개수 0이면 `null` 렌더.
- 트리거: `h-7` 버튼(PR #885 톱니와 같은 높이·테두리 토큰), 텍스트 `차트 작도 · {켜진 카테고리 개수 합}`, `▾` 아이콘, `aria-haspopup="menu"`, `aria-expanded`.
- 패널: `CHART_OVERLAY_KINDS` 순서로, `counts[kind] > 0`인 kind만 `role="menuitemcheckbox"` + `aria-checked`, 라벨 `차트 패턴`/`추세선`/`다이버전스`/`피보나치`/`엘리어트 파동` + `(N)`.
- 한국어 리터럴로 작성한 뒤 Task B8에서 i18n codemod로 치환.
- [ ] **Step 2:** 테스트: 카운트 0이면 렌더 없음; 켜진 kind 개수 합이 트리거에 표시; 클릭 시 열림, 항목 클릭 시 `onToggle(kind)`; count 0 kind는 목록에 없음; Esc로 닫힘.

### Task B6: StockChart·ChartContent 배선

**Files:** Modify `src/widgets/chart/StockChart.tsx`, `src/views/symbol/ChartContent.tsx`, `src/widgets/chart/index.ts`(필요 시); Tests `StockChart.test.tsx`, `ChartContent` 테스트

- [ ] **Step 1:** `StockChartProps`에 추가:
```ts
    /** AI가 참조한 로직 작도(차트 작도). */
    chartOverlays?: ChartOverlay[];
    /** '원본' 패널 카드 클릭으로 강조할 결과 항목 id(sourceRef). */
    highlightedOverlayRef?: string | null;
```
본문:
```ts
    const { visible: overlayVisible, toggle: toggleOverlay } = useChartOverlayVisibility();
    const barTimes = useMemo(() => new Set(bars.map(b => b.time)), [bars]);
    const overlayCounts = useMemo(() => countOverlaysByKind(chartOverlays ?? EMPTY_OVERLAYS, barTimes), [chartOverlays, barTimes]);
    const overlaySpecs = useMemo(() => buildOverlayLineSpecs(chartOverlays ?? EMPTY_OVERLAYS, {
        // 강조 중인 항목의 카테고리가 꺼져 있으면 잠깐 켜서 보여준다(스펙 §4.3).
        visible: highlightedKind ? { ...overlayVisible, [highlightedKind]: true } : overlayVisible,
        highlightedSourceRef: highlightedOverlayRef ?? null,
        barTimes,
        lastBarTime: bars[bars.length - 1]?.time ?? 0,
        rsiPaneIndex: visible.rsi ? paneIndices.rsi : null,
        colorFor: overlayColorFor,
    }), [...]);
    useChartOverlays({ chartRef, specs: overlaySpecs, lineWidth });
```
`highlightedKind` = `chartOverlays.find(o => o.sourceRef === highlightedOverlayRef)?.kind`. `overlayColorFor`(모듈 레벨 순수 함수, `chartOverlayUtils.ts`에 둔다): pattern → 해당 패턴의 `renderConfig.color`를 알 수 없으므로 `CHART_OVERLAY_COLORS.pattern`; trendline → role별 support/resistance; 나머지 kind 색. (패턴 스킬 색을 쓰려면 ChartContent가 `patternSummaries`에서 `sourceRef → renderConfig.color` 맵을 만들어 넘긴다 — 1회 계산이라 비용 없음. 그렇게 한다: 프롭 `overlayColors?: Record<string, string>`.)
`rsi` 가시성·`paneIndices`는 StockChart 안의 `useIndicatorVisibility()` 결과를 쓴다(이미 있음). `bars`의 time 타입이 `number`가 아니면(`Time`) 변환.
- [ ] **Step 2:** 헤더 띠(#885): `justify-end` 컨테이너 안, `<IndicatorSettingsModal>` 앞에 `<ChartOverlayMenu counts={overlayCounts} visible={overlayVisible} onToggle={toggleOverlay} />`, 둘 사이 `gap-1`.
- [ ] **Step 3:** ChartContent: `chartOverlays={analysis.chartOverlays}`, `overlayColors`(patternSummaries의 `id → renderConfig?.color`), `highlightedOverlayRef` 전달. 분석이 폴백(`isFallbackAnalysis`)이면 넘기지 않는다.
- [ ] **Step 4:** 테스트: StockChart에 `chartOverlays` 1건 주면 헤더에 `차트 작도` 버튼 렌더(테스트는 i18n 키/목 방식을 기존 StockChart 테스트와 맞춘다), 없으면 미렌더. 기존 StockChart 테스트 전부 PASS.

### Task B7: '원본' 패널 카드 강조

**Files:** Modify `src/widgets/analysis/AnalysisPanel.tsx`, `src/views/symbol/ChartContent.tsx`; Test `AnalysisPanel` 테스트

- [ ] **Step 1:** ChartContent에 `const [highlightedOverlayRef, setHighlightedOverlayRef] = useState<string | null>(null);` — 분석이 바뀌면(`analysis` 참조 변경) null로 리셋(`useEffect` 대신 "key로 리셋" 또는 렌더 중 이전값 비교 패턴 — 레포 관례를 따른다). 토글 콜백: 같은 ref면 null, 아니면 ref.
- [ ] **Step 2:** AnalysisPanel 프롭 `overlaySourceRefs?: ReadonlySet<string>`(chartOverlays의 sourceRef 집합), `highlightedOverlayRef?: string | null`, `onToggleOverlayHighlight?: (ref: string) => void`. '원본'(raw) 보기에서 패턴 카드와 전략 카드 중 `overlaySourceRefs.has(item.id)`인 카드에 `차트에서 보기` 토글 버튼(`aria-pressed`)을 단다. 카드 전체를 클릭 영역으로 만들지 않는다(카드 안 텍스트 선택·기존 인터랙션 보존). '쉽게' 보기는 변경 없음.
- [ ] **Step 3:** 테스트: raw 보기에서 해당 카드에만 버튼, 클릭 시 콜백 인자 = 카드 id, `aria-pressed` 반영; plain 보기에는 버튼 없음.

### Task B8: 고아 코드·i18n·버전

- [ ] **Step 1:** `src/widgets/chart/utils/patternOverlayUtils.ts`(와 테스트가 있으면 함께) 삭제. `grep -rn "patternOverlayUtils\|isDetectedAndVisible\|REGION_" src` → 0.
- [ ] **Step 2:** i18n: `yarn i18n:extract --apply --only src/widgets/chart/ui/ChartOverlayMenu.tsx`, 같은 방식으로 `AnalysisPanel.tsx`·`StockChart.tsx`의 새 리터럴. 그 뒤 `yarn i18n:extract --write` → `git diff --exit-code -- messages/`가 비지 않으면 산출물을 같은 커밋에. `yarn i18n:translate --locale en`, `ja`, `zh` → `yarn i18n:verify && yarn i18n:lint`.
- [ ] **Step 3:** core 1.18.0 릴리스 확인 후: `package.json` `"@y0ngha/siglens-core": "1.18.0"` → `yarn install` → `node -p "require('@y0ngha/siglens-core/package.json').version"` = 1.18.0.
- [ ] **Step 4:** 게이트: `yarn typecheck && yarn lint && yarn test src/widgets/chart src/views/symbol src/widgets/analysis src/entities/analysis`.

### Task B9: 개발 서버 실측

- [ ] **Step 1:** dev 서버를 별도 포트로(`PORT=3100 yarn dev` — 기존 dev 서버를 죽이지 않게). 실제 분석은 LLM 비용·쿨다운이 있으므로, 브라우저에서 분석 결과 응답을 가로채거나(서버 액션 응답) 개발용 목을 쓴다: `useAnalysis`가 받는 분석에 `chartOverlays`가 없으면 확인할 수 없으니, **로컬 전용** 방법으로 — 분석 캐시(Redis)에 p19 키로 오버레이가 든 결과를 심거나, core 오버레이로 실제 분석 1회 실행(BYOK/기본 키, 1Day 한 종목).
- [ ] **Step 2:** Chrome(claude-in-chrome)으로: 헤더에 `차트 작도 · N` 표시, 드롭다운 체크 토글 시 선 표시/숨김, 새로고침 후 체크 상태 유지, 다이버전스 켜고 RSI 패인 켰을 때 RSI 선, 엘리어트 라벨 1–5, '원본' 카드 `차트에서 보기` 강조, 모바일 폭(390px)에서 헤더 넘침 없음, 콘솔 에러 0.
- [ ] **Step 3:** 이상 시 수정 → 스코프 게이트 → 재확인.

### Task B10: siglens 리뷰·PR

- [ ] review-agent → 수정 루프 → mistake-managing-agent → git-agent(PR, base master).
- [ ] PR 리뷰 모니터 루프(claude-review + CI) — APPROVED까지.

---

## 스펙 대조(자체 검토)

| 스펙 | 태스크 |
|---|---|
| §2.1 흐름·try/catch·같은 배열 | A9 Step1, A11 Step1, A12 Step1 |
| §2.2 타입 | A2 |
| §2.3 스키마(candidateId, candidateIds, trendlineIds, patternLines/timeRange 삭제, trendlines 하위호환) | A10, A12 Step1 |
| §2.4 프롬프트(후보 id 줄, 새 섹션, 규칙 교체, 상한) | A9 Step4–5, A11, 상수 A3 |
| §2.5 resolve 규칙(detected만, 첫 참조, 환각 로그, referenced/offered) | A9 Step2–3, A12 Step1 |
| §2.6 tier | A10 Step4 |
| §3.1–3.5 모듈 | A4–A8 |
| §4.1 드롭다운·기본값·영속·숨김 조건 | B3, B5, B6 (timeframe 불일치는 `isOverlayAlignedToBars`로 대체 — 기준 시각이 로드된 봉에 없으면 안 그린다) |
| §4.2 렌더(2점 LineSeries, 레벨, 라벨 마커, RSI 패인, 고아 삭제, 색) | B2, B4, B6, B8 |
| §4.3 원본 카드 강조·일시 켜기 | B6 Step1, B7 |
| §5 단계 | 한 PR 쌍으로 묶음(사용자 지시: 전 단계 진행). core PR 1 + siglens PR 1 |
| §6 테스트 | 각 태스크 |
| §7 위험(참조율 로그, 토큰) | A12 Step1 로그. 토큰 측정은 B9 실측 때 프롬프트 길이 before/after 기록 |
