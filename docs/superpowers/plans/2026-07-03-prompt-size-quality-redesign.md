# Prompt Size & Quality Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 분석 프롬프트 토큰 -60%+ 절감과 동시에 품질 무하락/개선 — 스킬 digest 2계층화, 차트 패턴 프리스크리너, 관련성 선택, stable/dynamic 어셈블리 + 3사 프롬프트 캐싱, 출력 규칙 일원화, 뉴스 본문 캡.

**Spec:** `docs/superpowers/specs/2026-07-03-prompt-size-quality-redesign-design.md` (siglens-core) — 모든 판단 기준의 source of truth.

**Architecture:** siglens-core(프롬프트 빌드·선택·스크리너, 순수 도메인) / siglens(skills `.md` 파일·digest 생성 스크립트) / siglens-worker(dispatch 수용·SDK 캐싱·텔레메트리) 3레포. 페이즈 내 PR 전부 머지 → core 릴리스·dep bump → 다음 페이즈.

**Tech Stack:** TypeScript, vitest(core)/jest(worker), `@anthropic-ai/sdk` 0.92 / `@google/genai` 1.50 / `openai` 6.35 (worker), GitHub Packages 릴리스.

---

## 실행 프로토콜 (모든 페이즈 공통)

메모리 파이프라인(`project_refactor_effort_2026_06_pipeline`, `feedback_pr_review_reflection_workflow`)을 그대로 따른다:

1. **워크트리 분리**: PR마다 `git worktree add`로 master 기준 분리. node_modules는 symlink 금지 — `cp -al` 하드링크 + `rm -rf node_modules/node_modules` 잔여 제거 (`feedback_worktree_node_modules_prod_verify`). 워크트리 core 버전 핀 불일치 시 `rm -rf node_modules && yarn install` (`feedback_worktree_core_version_mismatch`).
2. **구현은 Sonnet sub-agent**, 리뷰·감사는 Opus 4.8 (`feedback_pr_review_fix_model_sonnet`). 구현자 로컬 게이트는 스코프만: tsc + 스코프 테스트 + lint (`feedback_implementer_scoped_gates`).
3. **PR 생성 → 클로드 코드 리뷰 루프**: claude-code-review Action 백그라운드 모니터(60s/20min, `--paginate` 필수, login 필터는 부분매치 또는 생략). CHANGES_REQUESTED = 수정 + Draft→Ready 토글 re-review 루프(APPROVED까지), APPROVED = Suggestion/Question 반영 후 토글 없이 머지. 봇 blocker는 검증 후 반영 (`feedback_verify_review_bot_claims`). 병합은 일반 merge.
4. **페이즈 전환**: 페이즈 내 PR 전부 master 머지 → core 변경이 있으면 릴리스(`yarn release`, v* 태그 → GitHub Packages) + siglens/worker `@y0ngha/siglens-core` bump + `yarn install` + 검증 (`feedback_user_handles_core_publish`) → 다음 페이즈 자동 진행.
5. **버전 bump 정책(스펙 §4)**: 프롬프트 바이트가 바뀌는 모든 core PR에서 `PROMPT_TEMPLATE_VERSION` +1 (p2, p3, …) + 해당 타입별 버전 동반 bump.
6. **커밋·푸시는 git-agent**, `--no-verify` 금지.

---

## Phase 1 — PR1: 차트 패턴 프리스크리너 (siglens-core)

**목적**: 피벗 기하 기반 스케일 불변 후보 선별기. 이 페이즈에서는 **스킬 선택에 미연결, 로깅만** — 실 차트 미탐률 관측 후 Phase 3에서 gated 전환.

**Files:**
- Create: `src/domain/patterns/types.ts`
- Create: `src/domain/patterns/constants.ts`
- Create: `src/domain/patterns/pivots.ts`
- Create: `src/domain/patterns/classifiers.ts`
- Create: `src/domain/patterns/screenChartPatterns.ts`
- Create: `src/domain/patterns/index.ts`
- Modify: `src/application/market/submitAnalysis.ts` (로깅 1줄)
- Test: `src/__tests__/domain/patterns/pivots.test.ts`
- Test: `src/__tests__/domain/patterns/classifiers.test.ts`
- Test: `src/__tests__/domain/patterns/screenChartPatterns.test.ts`
- Test fixtures: `src/__tests__/domain/patterns/fixtures/*.json`

### Task 1.1: 타입·상수 정의

- [ ] **Step 1: `types.ts` 작성**

```ts
// src/domain/patterns/types.ts
/** 스크리너가 식별 가능한 차트 패턴 ID — skills/patterns/*.md 파일명과 1:1. */
export type ChartPatternId =
    | 'head_and_shoulders'
    | 'inverse_head_and_shoulders'
    | 'double_top'
    | 'double_bottom'
    | 'triple_top'
    | 'triple_bottom'
    | 'ascending_triangle'
    | 'descending_triangle'
    | 'symmetrical_triangle'
    | 'ascending_wedge'
    | 'descending_wedge'
    | 'bull_flag'
    | 'bear_flag'
    | 'pennant'
    | 'rectangle'
    | 'cup_and_handle'
    | 'rounding_bottom';

export interface PivotPoint {
    /** bars 배열 인덱스. */
    index: number;
    price: number;
    kind: 'high' | 'low';
}

export interface PatternCandidate {
    id: ChartPatternId;
    /** 판정에 사용된 피벗들의 bar 인덱스 범위. */
    startIndex: number;
    endIndex: number;
}
```

- [ ] **Step 2: `constants.ts` 작성** — 허용 밴드는 전부 여기 집약. 초기값은 재현율 픽스처 튜닝으로 확정하고 각 상수에 근거 주석(스펙 §3.3).

```ts
// src/domain/patterns/constants.ts
/** 피벗 확정 최소 되돌림 — ATR 배수 (스케일 불변의 핵심). */
export const PIVOT_REVERSAL_ATR_MULT = 1.5;
/** 스크리닝 lookback (bars) — TIMEFRAME_BARS_LIMIT(200~500) 내에서 동작. */
export const SCREEN_LOOKBACK_BARS = 120;
/** H&S: 좌우 숄더 높이 차 허용 (머리-넥라인 높이 대비 비율). */
export const HS_SHOULDER_TOLERANCE = 0.35;
/** H&S: 머리가 숄더보다 높아야 하는 최소 폭 (ATR 배수). */
export const HS_HEAD_MIN_ATR = 1.0;
/** 더블/트리플: 극점 간 가격 차 허용 (ATR 배수). */
export const EXTREME_MATCH_ATR_MULT = 1.0;
/** 추세선 계열: 회귀 기울기 "평평" 판정 임계 (bar당 ATR 비율). */
export const FLAT_SLOPE_ATR_PER_BAR = 0.05;
/** 깃발/페넌트: 선행 폴 최소 크기 (ATR 배수). */
export const FLAG_POLE_MIN_ATR = 3.0;
```

- [ ] **Step 3: 커밋** — `feat(patterns): add chart pattern screener types and tolerance constants`

### Task 1.2: 피벗 추출 (TDD)

- [ ] **Step 1: 실패 테스트 작성** (`pivots.test.ts`)

```ts
import { extractPivots } from '@/domain/patterns/pivots';

// 합성 bars: V자 반등 — low 피벗 1개가 잡혀야 한다
const vShape = makeBars([10, 9, 8, 7, 8, 9, 10, 11]); // helper: close만 지정, ATR≈0.5 고정
it('detects a single low pivot in a V shape', () => {
    const pivots = extractPivots(vShape, 0.5);
    expect(pivots.filter(p => p.kind === 'low')).toHaveLength(1);
    expect(pivots.find(p => p.kind === 'low')?.index).toBe(3);
});
it('ignores reversals smaller than PIVOT_REVERSAL_ATR_MULT * atr', () => {
    const noise = makeBars([10, 9.9, 10, 9.9, 10]);
    expect(extractPivots(noise, 0.5)).toHaveLength(0);
});
```

- [ ] **Step 2: 실행해 실패 확인** — `yarn vitest run src/__tests__/domain/patterns/pivots.test.ts` → FAIL (module not found)
- [ ] **Step 3: `pivots.ts` 구현** — zigzag: 마지막 확정 피벗 이후 극값 추적, 반대 방향으로 `PIVOT_REVERSAL_ATR_MULT × atr` 이상 되돌리면 극값을 피벗으로 확정. 입력은 `readonly Bar[]` + 현재 ATR(지표에서 전달). 고점 피벗은 `high`, 저점 피벗은 `low` 사용.

```ts
export function extractPivots(bars: readonly Bar[], atr: number): PivotPoint[] {
    const threshold = PIVOT_REVERSAL_ATR_MULT * atr;
    const pivots: PivotPoint[] = [];
    let extremeIdx = 0;
    let direction: 'up' | 'down' | null = null;
    for (let i = 1; i < bars.length; i++) {
        const extreme = bars[extremeIdx];
        if (direction === null || direction === 'up') {
            if (bars[i].high > (direction === null ? extreme.high : bars[extremeIdx].high)) extremeIdx = i;
            else if (bars[extremeIdx].high - bars[i].low >= threshold) {
                pivots.push({ index: extremeIdx, price: bars[extremeIdx].high, kind: 'high' });
                direction = 'down'; extremeIdx = i;
            }
        }
        if (direction === 'down') {
            if (bars[i].low < bars[extremeIdx].low) extremeIdx = i;
            else if (bars[i].high - bars[extremeIdx].low >= threshold) {
                pivots.push({ index: extremeIdx, price: bars[extremeIdx].low, kind: 'low' });
                direction = 'up'; extremeIdx = i;
            }
        }
        if (direction === null && bars[extremeIdx].high - bars[i].low >= threshold) direction = 'up';
    }
    return pivots;
}
```

(위는 골격 — 구현 시 방향 초기화 분기를 테스트로 몰아붙여 다듬는다. 테스트가 계약이다.)

- [ ] **Step 4: 테스트 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `feat(patterns): ATR-relative zigzag pivot extraction`

### Task 1.3: 패턴 분류기 (TDD, 그룹별)

각 분류기는 `(pivots: readonly PivotPoint[], bars: readonly Bar[], atr: number) => PatternCandidate | null`. **재현율 우선 — 애매하면 후보로 올린다** (스펙 §3.3). 그룹과 판정 규칙:

| 그룹 | 패턴 | 판정 규칙 (피벗 기하) |
|---|---|---|
| 극점 매칭 | double_top/bottom | 마지막 2개 같은 kind 극점이 `EXTREME_MATCH_ATR_MULT×atr` 이내 + 사이 반대 극점 존재 |
| 극점 매칭 | triple_top/bottom | 같은 규칙을 3연속 극점으로 |
| 5피벗 | head_and_shoulders(+inverse) | high-low-higherHigh-low-lowerHigh 시퀀스, 숄더 차 ≤ `HS_SHOULDER_TOLERANCE`×(머리-넥라인), 머리 ≥ 숄더+`HS_HEAD_MIN_ATR`×atr |
| 추세선 쌍 | ascending/descending/symmetrical_triangle, ascending/descending_wedge, rectangle | 피벗 고점열·저점열 각각 최소자승 회귀 → 기울기 부호(+/−/평평 = `FLAT_SLOPE_ATR_PER_BAR`)와 수렴/평행 조합으로 6종 분기 |
| 깃발 | bull_flag/bear_flag/pennant | 선행 `FLAG_POLE_MIN_ATR` 폴 + 후행 좁은 역방향 채널(깃발) 또는 수렴(페넌트) |
| 곡선 | rounding_bottom, cup_and_handle | 저점열 2차 회귀 볼록성 + (cup은 우측 소형 되돌림 handle 존재) |

- [ ] **Step 1: 그룹별 실패 테스트 작성** — 그룹당 최소: 교과서형 합성 케이스 1개(감지), 반례 1개(비감지), 허용 밴드 경계 1개(느슨한 쪽 = 감지). 예:

```ts
it('detects double top with unequal-but-close peaks (tolerance)', () => {
    const bars = makeBars([10, 14, 11, 13.7, 10]); // 두 고점 차 0.3 < 1.0*atr(0.5)... 상수 기준으로 조정
    const pivots = extractPivots(bars, 0.5);
    expect(classifyDoubleTop(pivots, bars, 0.5)?.id).toBe('double_top');
});
```

- [ ] **Step 2: 그룹별 구현 → 테스트 통과 → 커밋** (그룹당 커밋 1개, 5커밋)
  - `feat(patterns): extreme-matching classifiers (double/triple top-bottom)`
  - `feat(patterns): five-pivot H&S classifiers`
  - `feat(patterns): trendline-pair classifiers (triangles/wedges/rectangle)`
  - `feat(patterns): flag/pennant classifiers`
  - `feat(patterns): curvature classifiers (rounding bottom, cup and handle)`

### Task 1.4: 스크리너 파사드 + 재현율 픽스처

- [ ] **Step 1: `screenChartPatterns.ts` 작성** — 전 분류기 실행, 후보 배열 반환(결정적 순서: `ChartPatternId` 사전순). 입력: 페치된 **전체 bars**(직렬화 윈도 아님) + atr.

```ts
export function screenChartPatterns(
    bars: readonly Bar[],
    atr: number
): PatternCandidate[] {
    const window = bars.slice(-SCREEN_LOOKBACK_BARS);
    const pivots = extractPivots(window, atr);
    return CLASSIFIERS.flatMap(c => c(pivots, window, atr) ?? [])
        .toSorted((a, b) => a.id.localeCompare(b.id, 'en'));
}
```

- [ ] **Step 2: 재현율 픽스처 테스트** — 실제 과거 차트에서 패턴이 알려진 구간의 bars JSON을 `fixtures/`에 저장(예: 교과서 H&S/더블탑/삼각형 각 1개 이상). 단언: 해당 패턴이 후보 목록에 **포함**(정확일치 아님 — 재현율 계약).

```ts
it('recalls known head-and-shoulders fixture', () => {
    const { bars, atr } = loadFixture('hs-textbook.json');
    const ids = screenChartPatterns(bars, atr).map(c => c.id);
    expect(ids).toContain('head_and_shoulders');
});
```

- [ ] **Step 3: 미탐 시 constants.ts 허용 밴드 완화 → 재실행** (튜닝 루프). 최종 상수에 근거 주석.
- [ ] **Step 4: 커밋** — `feat(patterns): screener facade with recall fixtures`

### Task 1.5: 관측 배선 (로깅만)

- [ ] **Step 1: `submitAnalysis.ts`에 스크리너 호출 + 구조화 로그 추가** (프롬프트·선택 불변):

```ts
const patternCandidates = screenChartPatterns(bars, lastNonNull(indicators.atr) ?? 0);
console.info('[PatternScreen]', JSON.stringify({ symbol, timeframe, candidates: patternCandidates.map(c => c.id) }));
```

- [ ] **Step 2: 기존 `submitAnalysis.test.ts` 전체 통과 확인** (behavior-preserving)
- [ ] **Step 3: 커밋** — `feat(patterns): observe-only screener logging in submitAnalysis`

### Task 1.6: PR1 생성 → 리뷰 루프 → 머지 → core 릴리스 + siglens bump

- [ ] PR 생성(git-agent), 클로드 리뷰 루프(실행 프로토콜 §3), 머지, `yarn release`, siglens dep bump. **프롬프트 바이트 불변이므로 버전 bump 없음.**

---

## Phase 2 — PR2a/2b: 스킬 Digest 전량 + 로더 + A/B 하네스

**순서 주의**: PR2a(siglens, digest 추가)가 먼저 머지 — 구 로더는 digest 마커를 그냥 본문 일부로 취급하므로 무해. PR2b(core, 로더 전환)가 나중.

### Task 2.1 (PR2a, siglens): digest 생성 스크립트

**Files:** Create: `scripts/skills-digest.ts`, Modify: `package.json` (scripts 2개)

- [ ] **Step 1: 스크립트 작성** — 두 모드:
  - `yarn skills:digest --verify`: 각 `.md`에서 ① `PROMPT_DIGEST` 섹션 존재 ② frontmatter `digest_hash` == SHA-256(원본 본문 부분) ③ `token_cost` == digest 실측 토큰(추정: `Math.ceil(digestChars / 4)`) 검증. 위반 목록 출력 + exit 1. CI에 편입.
  - `yarn skills:digest --update-meta`: digest는 사람이(=Claude가) 쓴 것을 그대로 두고 `digest_hash`·`token_cost`만 재계산해 frontmatter에 기록.
  - 원본 본문 = frontmatter 이후 ~ `<!-- PROMPT_DIGEST:START -->` 이전. 마커: `<!-- PROMPT_DIGEST:START -->` / `<!-- PROMPT_DIGEST:END -->`.
- [ ] **Step 2: 스크립트 자체 테스트** (`scripts/__tests__/skills-digest.test.ts`) — 픽스처 스킬 3개(정상/hash-stale/digest-누락)로 verify 결과 단언.
- [ ] **Step 3: 커밋** — `feat(skills): digest verify/update-meta script`

### Task 2.2 (PR2a, siglens): 81개 스킬 digest 작성

- [ ] **Step 1: 카테고리 단위로 digest 작성** (Claude 직접 작성, 커밋 diff로 리뷰 가능). 작성 원칙(스펙 §3.1): 임계값·수치 기준·신호 판정 규칙·해석 우선순위 전부 보존, 개념 설명·역사·중복 예시 제거. 목표 25~35%, 규칙 밀집 스킬은 초과 허용. 카테고리당 커밋 1개(8커밋: indicators/patterns/strategies/candlesticks/support-resistance/news/fundamental/_core).
- [ ] **Step 2: 각 커밋 전 `yarn skills:digest --update-meta && yarn skills:digest --verify`** → exit 0 확인.
- [ ] **Step 3: 총량 측정** — digest 합계 바이트를 PR 본문에 기록(목표: always_on+미태그 ~218KB → ≤70KB).

### Task 2.3 (PR2a, siglens): PR 생성 → 리뷰 루프 → 머지

- [ ] 이 시점 프로덕션 동작 불변(로더 미전환) — 리뷰 포인트는 digest 내용 충실도.

### Task 2.4 (PR2b, core): 로더 digest 추출 (TDD)

**Files:** Modify: `src/infrastructure/skills/loader.ts`, `src/domain/types.ts`(주석), Test: `src/__tests__/infrastructure/skills/loader.test.ts`, `loader-gating.test.ts`

- [ ] **Step 1: 실패 테스트** — ① digest 섹션 있는 픽스처 → `skill.content`가 digest만 ② 마커 누락 픽스처 → `SkillParseError` throw ③ `token_cost`가 frontmatter 값 그대로 로드.

```ts
it('injects only the PROMPT_DIGEST section as content', async () => {
    const skills = await loadFixtureCatalog('with-digest');
    expect(skills[0].content).toBe('RSI digest body only');
    expect(skills[0].content).not.toContain('사람용 원본');
});
it('throws when PROMPT_DIGEST section is missing', async () => {
    await expect(loadFixtureCatalog('missing-digest')).rejects.toThrow(/PROMPT_DIGEST/);
});
```

- [ ] **Step 2: 구현** — `extractDigest(raw: string): string` 유틸(마커 사이 추출, 누락 시 throw), `toSkill`에서 `content: extractDigest(body)`.
- [ ] **Step 3: fingerprint 테스트 갱신** — `skillFingerprint`/`fingerprintCrossPath` 테스트에 "digest 변경 → token_cost 변경 → fingerprint 변경" 케이스 추가. `hashSkillCatalog` 구현은 불변(이미 tokenCost 포함).
- [ ] **Step 4: 기존 prompt 테스트 갱신** — `toContain` 단언 중 스킬 원문 문구 의존 부분을 digest 문구로 교체.
- [ ] **Step 5: 전체 스코프 테스트 + tsc + lint → 커밋** — `feat(skills): loader injects PROMPT_DIGEST only, hard-fails on missing digest`

### Task 2.5 (core): A/B 품질 하네스

**Files:** Create: `scripts/ab-harness/buildPrompts.ts`, `scripts/ab-harness/runModels.ts`, `scripts/ab-harness/judge.ts`, `scripts/ab-harness/fixtures/*.json`, `scripts/ab-harness/README.md`

- [ ] **Step 1: 픽스처 준비** — 대표 케이스 최소 8개: 심볼×타임프레임 4(추세/횡보/고변동/저유동), 알려진 패턴 2, 뉴스 2. bars/indicators/news를 JSON으로 동결.
- [ ] **Step 2: `buildPrompts.ts`** — 픽스처로 프롬프트 빌더 호출, `{caseId, system, prompt}` JSON 배열 출력. 구/신 비교는 **git ref 2곳에서 각각 실행**: `git stash`/checkout 없이 워크트리 2개(master vs 브랜치)에서 같은 픽스처로 실행해 `prompts-old.json`/`prompts-new.json` 생성.
- [ ] **Step 3: `runModels.ts`** — 각 프롬프트를 기본 분석 모델(Gemini)로 호출(`@google/genai` devDependency — 스크립트 전용, 런타임 export 금지 = core 순수성 유지), `{caseId, variant, result, usage, latencyMs}` 저장.
- [ ] **Step 4: `judge.ts`** — 케이스별 (A,B) 라벨 무작위 블라인드 쌍을 Opus(`@anthropic-ai/sdk` devDependency)에 채점 요청: 데이터 근거성/환각/실행 가능성/패턴 판정 정확도 각 1~5점 + 승자. 리포트 MD 생성. **통과 기준: 신 ≥ 구(평균), 항목별 유의미한 하락 없음** (스펙 §3.6).
- [ ] **Step 5: README에 실행 절차 기록 → 커밋** — `feat(harness): A/B prompt quality harness (build/run/judge)`

### Task 2.6: A/B 게이트 실행 (PR2b 머지 전 필수)

- [ ] **Step 1: 하네스 실행** — master(구) vs PR2b 브랜치(신, digest 주입) 프롬프트로 8케이스 × 2 → judge 리포트.
- [ ] **Step 2: 미달 스킬 digest 재작업 → 재실행** (수렴까지). 리포트를 PR 본문에 첨부.
- [ ] **Step 3: PR2b 리뷰 루프 → 머지 → core 릴리스 + siglens/worker dep bump.** **버전 bump: `PROMPT_TEMPLATE_VERSION` p1→p2** + 타입별 버전(digest는 전 타입 프롬프트에 반영되므로).

---

## Phase 3 — PR3: 선택 엔진 (siglens 태깅 + core 필터/정렬)

### Task 3.1 (siglens): 미태그 12개 스킬 태깅

- [ ] **Step 1: 지표 6개**(ma/ema/atr/adx/obv/volume-profile) — 각 스킬 내용 감사 후 `gating: { tier: gated, signal_kind: state, state: <해당 지표 notable 조건> }` 또는 근거가 있으면 `always_on`. 분류 근거를 PR 본문에 표로.
- [ ] **Step 2: fundamental 3 + news 3** — 내용에 맞는 명시 태그(대부분 `always_on` — 해당 타입 프롬프트에서는 항상 유효한 해석 프레임).
- [ ] **Step 3: `yarn skills:digest --verify` 통과 → 커밋 → PR → 리뷰 루프 → 머지** — `fix(skills): tag 12 untagged skills (kill fail-open)`

### Task 3.2 (core): 카테고리 화이트리스트 + fail-open 제거 (TDD)

**Files:** Create: `src/domain/analysis/skillWhitelist.ts`, Modify: `src/domain/analysis/selectSkills.ts`, `src/infrastructure/skills/loader.ts`, Test: `selectSkills.test.ts`, `loader-gating.test.ts`

- [ ] **Step 1: 실패 테스트**

```ts
it('excludes fundamental/news skills from TECHNICAL selection', () => {
    const result = selectSkills(catalogWithAllCategories, ctx, 'technical');
    const cats = [...result.core, ...result.selected].map(s => s.category);
    expect(cats).not.toContain('fundamental');
    expect(cats).not.toContain('news');
});
it('loader throws on untagged skill (fail-closed)', async () => {
    await expect(loadFixtureCatalog('untagged')).rejects.toThrow(/gating/);
});
```

- [ ] **Step 2: `skillWhitelist.ts`** — 스펙 §3.2 확정 표 그대로:

```ts
export const SKILL_CATEGORY_WHITELIST: Record<PromptSkillContext, readonly SkillCategory[]> = {
    technical: ['_core', 'indicators', 'patterns', 'strategies', 'candlesticks', 'support-resistance'],
    fundamental: ['fundamental'],
    news: ['news'],
};
```

- [ ] **Step 3: `selectSkills` 시그니처 확장** — `(skills, ctx, promptContext)` → `{ core: Skill[], selected: Skill[] }`. `core` = always_on(이름순 고정 — stable prefix 결정성), `selected` = gated 발화분을 **관련성 정렬**(발화 트리거 매치 수 desc → 이름순 tie-break; 결정적). fail-open 분기(`gating === undefined → true`) 삭제 — 로더가 이미 차단하므로 도달 불가, 방어적으로 throw.
- [ ] **Step 4: 로더 fail-closed** — `gating === undefined` → `SkillParseError`.
- [ ] **Step 5: 호출부 갱신** — `buildAnalysisPrompt`/`fundamentalPrompt`/`newsPrompt`의 selectSkills 호출에 promptContext 전달. 기존 단일 배열 소비 지점은 `[...core, ...selected]`로.
- [ ] **Step 6: 스코프 테스트 통과 → 커밋** — `feat(analysis): category whitelist + fail-closed gating + relevance ordering`

### Task 3.3 (core+siglens): 패턴 스킬 gated 전환 (조건부 — 스크리너 검증 통과 시)

**전제 게이트**: Phase 1 관측 로그 + 재현율 픽스처에서 미탐 없음 확인. 미충족 시 이 태스크는 **보류하고 Phase 4로 진행** (스펙 §3.2 2단계 전환).

- [ ] **Step 1 (siglens): `skills/_core/pattern-index.md` 생성** — 17개 패턴 한 줄 인덱스(`always_on`, 총 ~2KB) + digest 마커 포함.
- [ ] **Step 2 (siglens): 패턴 스킬 17개 frontmatter를 `gated`/`signal_kind: event`/`triggers: [<ChartPatternId>]`로 전환.**
- [ ] **Step 3 (core): 스크리너를 선택 컨텍스트에 연결** — `SkillSelectionContext`에 `patternCandidates: readonly ChartPatternId[]` 추가, `buildSkillSelectionContext`에서 `screenChartPatterns` 결과 주입, event 트리거 매칭 대상에 `ctx.patternCandidates` 추가:

```ts
return triggers.some(
    trigger =>
        ctx.signals.some(signal => signal.type === trigger) ||
        ctx.detectedCandles.includes(trigger) ||
        ctx.patternCandidates.includes(trigger as ChartPatternId)
);
```

- [ ] **Step 4: 테스트** — "스크리너 후보 발화 시 해당 패턴 digest 주입 / 미발화 시 인덱스만" 단언.
- [ ] **Step 5: A/B 하네스 재실행(패턴 케이스 필수) → 통과 시 PR → 리뷰 루프 → 머지.** **버전 bump p2→p3.**
- [ ] **Step 6: core 릴리스 + siglens bump.**

---

## Phase 4 — PR4a/4b: 어셈블리 2분할 + Worker 캐싱 + 텔레메트리

**순서**: PR4a(worker, 신필드 수용)가 먼저 배포 — 구 core와 호환. PR4b(core, 신필드 송신)가 나중.

### Task 4.1 (PR4a, worker): dispatch 신필드 수용 + 캐싱 + usage 텔레메트리

**Files:** Modify: `src/index.ts`, `src/claude.ts`, `src/gemini.ts`, `src/chatgpt.ts`, Create: `src/usage.ts`, Test: `src/__tests__/*`

- [ ] **Step 1: 요청 스키마 확장** — body에 `promptStable?: string`, `promptDynamic?: string` 추가. 유효성: 둘 다 있으면 신경로, 아니면 기존 `prompt` (jest 테스트: 신필드만/구필드만/둘 다(신 우선)/둘 다 없음(400)).
- [ ] **Step 2: Claude 경로** — messages user content를 블록 배열로: `[{type:'text', text: promptStable, cache_control:{type:'ephemeral'}}, {type:'text', text: promptDynamic}]` + system도 배열화해 마지막 블록에 `cache_control` (chat 경로 검증 패턴). 구경로(prompt 단일)는 기존 그대로.
- [ ] **Step 3: Gemini/OpenAI 경로** — `promptStable + promptDynamic` 문자열 결합(implicit/자동 캐싱은 정렬만으로 동작). 결합 지점 단위 테스트.
- [ ] **Step 4: `usage.ts`** — 3사 usage 정규화:

```ts
export interface NormalizedUsage {
    promptTokens: number;
    cachedTokens: number; // claude: cache_read_input_tokens / gemini: cachedContentTokenCount / openai: prompt_tokens_details.cached_tokens
    outputTokens: number;
}
```

각 어댑터가 응답에서 추출해 `console.info('[Usage]', JSON.stringify({jobId, model, ...usage, latencyMs}))`.
- [ ] **Step 5: jest 전체 통과 → PR → 리뷰 루프 → 머지 → worker 배포** (`yarn release:*` 절차는 worker 레포 관례 따름).

### Task 4.2 (PR4b, core): AssembledPrompt 2분할 (TDD)

**Files:** Modify: `src/domain/analysis/prompt.ts`(+ overall/fundamental/financials/news/options 빌더 순차), `src/application/*/submit*.ts`, Test: 각 prompt 테스트 + 신규 `promptStability.test.ts`

- [ ] **Step 1: 실패 테스트 — stable 불변식** (스펙 §5 신규 불변식 ①):

```ts
it('stable part is byte-identical across symbols and contains no per-call values', () => {
    const a = buildAnalysisPrompt('AAPL', 'Apple', barsA, indA, skills, '1Day');
    const b = buildAnalysisPrompt('TSLA', 'Tesla', barsB, indB, skills, '1Day');
    expect(a.stable).toBe(b.stable);
    expect(a.stable).not.toContain('AAPL');
});
```

- [ ] **Step 2: `buildAnalysisPrompt` 반환형 전환** — `sections[]`를 stable/dynamic 두 배열로 분리(스펙 §3.4 배치 기준: intent/guidelines/guardrail/출력규칙/always_on digest = stable; 심볼 섹션/티어·타임프레임 노트/gated digest/데이터/요청 = dynamic). 반환 `{ stable, dynamic }`.
- [ ] **Step 3: dispatch 갱신** — `body: { …, prompt: stable + '\n\n' + dynamic, promptStable: stable, promptDynamic: dynamic, seed: analysisSeed(stable + '\n\n' + dynamic) }` — **`seed`는 결합 전문 기준 유지**(구/신 경로 동일 seed 보장, 기존 `analysisSeed(prompt)` 의미 보존). `prompt` 필드는 구 worker 호환용으로 1릴리스 유지 후 제거.
- [ ] **Step 4: 나머지 빌더 동일 전환** — overall/fundamental/financials/news/newsCard/marketNewsDigest/options/congress/briefing/economy 순. 빌더당 커밋 1개.
- [ ] **Step 5: 전체 테스트 + A/B 스모크(어셈블리 재정렬이 품질에 영향 없는지 4케이스) → PR → 리뷰 루프 → 머지.** **버전 bump p3→p4.**
- [ ] **Step 6: core 릴리스 + siglens/worker bump. 배포 후 worker `[Usage]` 로그에서 `cachedTokens > 0` 확인**(2회차 호출) — 스펙 §3.4 관측 게이트.

---

## Phase 5 — PR5a/5b: 출력 규칙 일원화 + 뉴스 본문 제어

### Task 5.1 (PR5a, worker): Claude forced tool_choice

- [ ] **Step 1: `claude.ts`** — responseSchema 지정 시 `tool_choice: { type: 'auto' }` → `{ type: 'tool', name: RESPONSE_TOOL_NAME }` 전환. thinking과의 양립 확인(비양립 시 responseSchema 경로만 thinking off — jest로 계약 고정, 스펙 §3.5 전제조건).
- [ ] **Step 2: jest → PR → 리뷰 루프 → 머지 → 배포.**

### Task 5.2 (PR5b, core): 프로즈 중복 제거 + 스키마 감사

- [ ] **Step 1: `buildAnalysisRequest`(prompt.ts:1354~) 감사** — 필드 존재·타입·enum 반복 서술 삭제, "SINGLE valid JSON object" 삭제(5.1 배포 후에만). 잔류: 존댓말·톤·필드 간 의미 제약·근거 인용 규칙 → stable로 이동. 타 빌더 동일 감사.
- [ ] **Step 2: `responseSchemas.ts` description 압축** — 의미 손실 없는 축약만.
- [ ] **Step 3: 테스트 갱신(toContain) + A/B 4케이스 스모크.**

### Task 5.3 (PR5b, core): 뉴스 정렬·캡

- [ ] **Step 1: 실패 테스트** — "K+1개 기사 입력 시 상위 K만 body, 나머지 summary만" / "body는 N자에서 절단" / "정렬은 결정적".
- [ ] **Step 2: `newsPrompt.ts` 구현** — 관련성 점수(결정적, 스펙 §3.5): `score = recencyWeight(publishedAt) + tickerMentions(bodyKo, symbol) * MENTION_WEIGHT`. 상수: `NEWS_FULL_BODY_TOP_K = 5`, `NEWS_BODY_MAX_CHARS = 3000`, 상수 파일에 근거 주석. 전문 포함 기사는 summaryKo 생략.
- [ ] **Step 3: A/B(뉴스 케이스) → PR → 리뷰 루프 → 머지.** **버전 bump p4→p5** + `FINANCIALS_`/`ECONOMIC_EVENT_` 등 타입별 버전.
- [ ] **Step 4: core 릴리스 + siglens/worker bump.**

---

## Phase 6 — 5종 감사 루프 (findings 0 수렴)

메모리 `project_refactor_effort_2026_06_pipeline` §감사 그대로 — **전부 Opus 4.8, fresh-context**(이 effort의 세션 컨텍스트 없이 진입, 스펙 문서 경로만 전달):

| # | 감사 Agent | 범위 |
|---|---|---|
| ① | review-agent 코드감사 | Phase 1~5 전체 diff (core+siglens+worker) |
| ② | 배포안정성 | 캐시 무효화·롤아웃 순서·fail-closed 경로·worker 하위호환 |
| ③ | "지금 배포 가정" 배포안정성 | 현시점 master 3레포 조합으로 배포 시나리오 |
| ④ | seo-audit | 페이지 변경 없음 — 분석 결과가 ISR 페이지에 실리는 경로 회귀만 확인(빠른 패스 예상) |
| ⑤ | 커버리지 90%+ & worst/edge/integration | 신규 모듈(patterns/, 하네스 제외 스크립트, worker usage) 커버리지 + edge 케이스 |

- [ ] **Step 1: 5종 병렬 spawn → findings 수집.**
- [ ] **Step 2: findings 수정**(Sonnet 구현 + 필요시 PR 루프) → **미통과 Agent만** fresh-context 재감사.
- [ ] **Step 3: findings 0 수렴까지 반복.** 회귀 발견 시 조용히 수정 금지 — 사용자 보고 먼저 (`feedback_regression_notification`).

## Phase 7 — QA 시트 작성 + 실기동 QA

메모리 `feedback_worktree_node_modules_prod_verify` 배포 전 실증 플레이북 + 스펙 §3.6 E2E:

- [ ] **Step 1: QA 시트 생성(Opus)** — 변경 범위 Spec 기반 Test Case 표: curl 케이스(Cxx) + Chrome 케이스(Bxx), P0/P1/P2 우선순위. 포함 필수: 분석 제출→폴링→결과 렌더(타입별), 캐시 웜/콜드 2회차, 스킬 degrade 경로, 뉴스 탭. curl 검증값은 Opus가 grounding 중 실측. 시트는 `docs/qa/`(siglens) 관례 따라 저장.
- [ ] **Step 2: 환경 기동** — siglens: env-shadow prod-like build+start(e2e DB+redis, 별도 포트, 빌드 exit code 직접 캡처 `> log 2>&1; echo $?`). worker: `yarn dev`(.env 키). `.env.local` 스왑 시 종료 후 복원 검증 (`feedback_env_local_restore_after_qa_swap`).
- [ ] **Step 3: E2E 3지표 실측(스펙 §3.6)** — 타입별 최소 1케이스 구/신:
  1. 품질: 결과 쌍 블라인드 Opus 채점 (하네스 judge 재사용)
  2. 속도: E2E 레이턴시+TTFT, 웜업 후 2회차로 캐시 효과 분리
  3. 토큰: worker `[Usage]` 로그 → promptTokens/cachedTokens/output, 절감률 산출
  - **통과: 품질 ≥, 프롬프트 토큰 -60%+, cachedTokens > 0.**
- [ ] **Step 4: curl 검증(Cxx)** — status/헤더/`x-nextjs-cache`/content-type (grep case-sensitive 주의).
- [ ] **Step 5: Chrome 검증(Bxx)** — claude-in-chrome으로 분석 화면 직접 확인: 렌더 정상, 콘솔 하이드레이션 0에러, 분석 결과 필드 충실(patternLines 좌표가 실제 bar에 붙는지 육안), 탭 전환 안정성.
- [ ] **Step 6: 결과 보고서 작성 → 사용자 최종 승인 → 릴리스 태그.**

---

## Self-Review 결과 (스펙 대비 커버리지)

- §3.1 digest+스크립트+token_cost → Task 2.1/2.2/2.4 ✓ · §3.2 화이트리스트/fail-closed/관련성/패턴 2단계 → 3.1/3.2/3.3 ✓ · §3.3 스크리너+인덱스+full-bars → Phase 1 + 3.3 ✓ · §3.4 2분할/하위호환/3사 캐싱/텔레메트리/seed → 4.1/4.2 ✓ · §3.5 프로즈 일원화(Claude forced 전제)/뉴스 캡/결정적 관련성 → 5.1/5.2/5.3 ✓ · §3.6 하네스+E2E 3지표 → 2.5/2.6 + Phase 7 ✓ · §3.7 PR 순서 = Phase 1~5 ✓ · §4 PR별 버전 bump → 각 페이즈 명시 ✓ · §5 불변식 테스트 4종 → 1.4(재현율)/3.2(카테고리·fail-closed)/4.2(바이트 안정) ✓
