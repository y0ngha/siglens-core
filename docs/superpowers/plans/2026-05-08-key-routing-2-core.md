# Plan 2/3: siglens-core — Tier + BYOK forwarding for analyses

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 4개 분석 함수(`submitAnalysis`, `submitNewsAnalysis`, `submitFundamentalAnalysis`, `submitOverallAnalysis`)에 tier + userApiKey 옵션을 추가하고, BYOK 게이트를 적용하며, worker POST body에 tier를 포함하도록 변경.

**Architecture:** `domain/tier.ts`에 `isPremiumModel` pure 함수 추가. 4개 submit 함수에 tier+userApiKey 게이트 → non-pro+premium+no userApiKey → `user_api_key_required` 반환. Worker body에 tier 포함. Overall은 dependency resolver가 axes로 전파.

**Tech Stack:** TypeScript, Vitest

**Repo path (worktree):** `/Users/y0ngha/Project/siglens-core-key-routing`

**Spec reference:** `docs/superpowers/specs/2026-05-08-analysis-api-key-routing-design.md` §4.2

**Layer rules:** `domain/`은 외부 import 금지, pure functions only. `application/`은 domain + infrastructure import 가능.

**Required reading before starting:**
- `docs/MISTAKES.md` (Coding Paradigm, TypeScript, Domain Functions, Infrastructure Functions, Tests sections)
- `docs/CONVENTIONS.md`
- `docs/ARCHITECTURE.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/domain/tier.ts` | Modify | `isPremiumModel` 추가 |
| `src/__tests__/domain/tier.test.ts` | Modify | `isPremiumModel` 테스트 |
| `src/application/market/types.ts` | Modify | `tierContext` 이미 있음, 에러 변형 추가 |
| `src/application/market/submitAnalysis.ts` | Modify | BYOK 게이트, worker body에 tier |
| `src/__tests__/application/market/submitAnalysis.test.ts` | Modify | 게이트/tier-forwarding 테스트 |
| `src/application/news/types.ts` | Modify | `tier`, `userApiKey` 추가, 에러 변형 |
| `src/application/news/submitNewsAnalysis.ts` | Modify | BYOK 게이트, X-AI-API-KEY, worker body tier |
| `src/__tests__/application/news/submitNewsAnalysis.test.ts` | Modify | 동일 |
| `src/application/fundamental/types.ts` | Modify | 동일 패턴 |
| `src/application/fundamental/submitFundamentalAnalysis.ts` | Modify | 동일 패턴 |
| `src/__tests__/application/fundamental/submitFundamentalAnalysis.test.ts` | Modify | 동일 패턴 |
| `src/application/overall/types.ts` | Modify | 최상위 + axis Pick에 userApiKey 추가 |
| `src/application/overall/submitOverallAnalysis.ts` | Modify | 게이트, worker body tier |
| `src/application/overall/dependencyResolver.ts` | Modify | userApiKey/tier를 axes로 전파 |
| `src/__tests__/application/overall/submitOverallAnalysis.test.ts` | Modify | 동일 |

---

## Task 1: `domain/tier.ts`에 `isPremiumModel` 추가

**Files:**
- Modify: `src/domain/tier.ts` (마지막 export 다음에 추가)
- Modify: `src/__tests__/domain/tier.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/domain/tier.test.ts`에 다음 describe 블록 추가:

```typescript
import { isPremiumModel } from '@/domain/tier';

describe('isPremiumModel', () => {
    it('returns false for free-tier models', () => {
        expect(isPremiumModel('gemini-2.5-flash')).toBe(false);
        expect(isPremiumModel('gemini-2.5-flash-lite')).toBe(false);
        expect(isPremiumModel('claude-haiku-4-5')).toBe(false);
        expect(isPremiumModel('gpt-5-mini')).toBe(false);
    });

    it('returns true for member-only models', () => {
        expect(isPremiumModel('gemini-2.5-pro')).toBe(true);
        expect(isPremiumModel('claude-sonnet-4-6')).toBe(true);
    });

    it('returns true for pro-only models', () => {
        expect(isPremiumModel('claude-opus-4-7')).toBe(true);
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `yarn test --run src/__tests__/domain/tier.test.ts`
Expected: FAIL — `isPremiumModel`이 export되지 않음.

- [ ] **Step 3: 구현 추가**

`src/domain/tier.ts` 파일 끝(export `isTier` 다음)에 추가:

```typescript
/**
 * Return whether a model is considered premium (not in the free-tier list).
 *
 * @param model - The AI model identifier to check.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns `true` if the model is NOT in `config.models.free`, `false` otherwise.
 */
export function isPremiumModel(
    model: ModelId,
    config: TierConfig = TIER_CONFIG
): boolean {
    const freeModels = config.models.free as readonly string[];
    return !freeModels.includes(model);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `yarn test --run src/__tests__/domain/tier.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/tier.ts src/__tests__/domain/tier.test.ts
git commit -m "feat(domain): add isPremiumModel pure function"
```

---

## Task 2: market 분석 — BYOK 게이트 + tier worker forwarding

**Files:**
- Modify: `src/application/market/types.ts`
- Modify: `src/application/market/submitAnalysis.ts:304-320`
- Modify: `src/__tests__/application/market/submitAnalysis.test.ts`

### Step 1: types.ts — error variant 추가

`src/application/market/types.ts`에 추가/수정:

```typescript
/** Result variant when a user BYOK API key is required for the requested model+tier combo. */
export interface UserApiKeyRequiredError {
    code: 'user_api_key_required';
    message: string;
}

export type SubmitAnalysisErrorResult =
    | { status: 'error'; error: AnalysisLimitError }
    | { status: 'error'; error: UserApiKeyRequiredError }
    | TierGateErrorResult;
```

(기존 `SubmitAnalysisErrorResult` union에 추가)

`SubmitAnalysisOptions`에 `serverApiKey`는 추가하지 않음 — worker가 직접 보유. `userApiKey`는 이미 존재.

- [ ] **Step 2: submitAnalysis.ts — BYOK 게이트 추가**

`src/application/market/submitAnalysis.ts`에서 import 갱신 (파일 상단):

```typescript
import { isPremiumModel } from '@/domain/tier';
```

`submitAnalysis.ts:188` 근처 (timeframe gate 직후, `usage` 체크 직전)에 BYOK 게이트 추가:

```typescript
const tier = options.tierContext?.tier ?? DEFAULT_TIER;
const tierConfig = options.tierConfig ?? TIER_CONFIG;

if (!isTimeframeAllowed(tier, timeframe, tierConfig)) {
    // ... existing block ...
}

const effectiveModelId = options.modelId ?? DEFAULT_ANALYSIS_MODEL_ID;
const premium = isPremiumModel(effectiveModelId, tierConfig);

if (tier !== 'pro' && premium && options.userApiKey === undefined) {
    return {
        status: 'error',
        error: {
            code: 'user_api_key_required',
            message:
                '선택한 모델은 BYOK API 키가 필요합니다. 키를 등록하거나 등급을 업그레이드해 주세요.',
        },
    };
}
```

(기존 `effectiveModelId = options.modelId ?? DEFAULT_ANALYSIS_MODEL_ID;` 위치를 BYOK 게이트보다 앞으로 옮길 것.)

- [ ] **Step 3: submitAnalysis.ts — worker POST body에 tier 추가**

`src/application/market/submitAnalysis.ts:304-320` 영역의 dispatch를 다음으로 변경:

```typescript
const userApiKeyHeader: Record<string, string> =
    options.userApiKey !== undefined
        ? { 'X-AI-API-KEY': options.userApiKey }
        : {};

const dispatch = fetch(`${workerUrl}/analyze`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': workerSecret,
        ...userApiKeyHeader,
    },
    body: JSON.stringify({
        jobId,
        prompt,
        model: effectiveModelId,
        tier,
    }),
    signal: AbortSignal.timeout(SUBMIT_ANALYSIS_TIMEOUT_MS),
}).catch(error => {
    console.error('[Submit] Worker request failed:', error);
});
```

- [ ] **Step 4: 테스트 추가**

`src/__tests__/application/market/submitAnalysis.test.ts`에서 기존 테스트 패턴을 그대로 따르되 다음 케이스 추가:

```typescript
describe('submitAnalysis BYOK gate + tier forwarding', () => {
    it('returns user_api_key_required when non-pro tier requests premium model without BYOK', async () => {
        // tierContext: { tier: 'member' }, modelId: 'gemini-2.5-pro', userApiKey: undefined
        // expected: { status: 'error', error: { code: 'user_api_key_required', ... } }
    });

    it('proceeds when non-pro tier requests premium model with BYOK', async () => {
        // tierContext: { tier: 'member' }, modelId: 'gemini-2.5-pro', userApiKey: 'usr-key'
        // expected: status: 'submitted' + worker POST X-AI-API-KEY: 'usr-key'
    });

    it('proceeds when pro tier requests premium model without BYOK', async () => {
        // tierContext: { tier: 'pro' }, modelId: 'gemini-2.5-pro', userApiKey: undefined
        // expected: status: 'submitted' + worker POST without X-AI-API-KEY
    });

    it('forwards tier in worker POST body', async () => {
        // tierContext: { tier: 'pro' }, modelId: 'gemini-2.5-flash'
        // expected: worker POST body includes tier='pro'
    });

    it('forwards tier "free" when no tierContext provided', async () => {
        // modelId: 'gemini-2.5-flash' (free model)
        // expected: worker POST body includes tier='free'
    });
});
```

기존 fetch mock에서 호출 인자 검증 패턴을 그대로 따라서 body의 `tier` 필드와 헤더의 `X-AI-API-KEY` 유무를 검증.

- [ ] **Step 5: 테스트 실행 및 통과 확인**

Run: `yarn test --run src/__tests__/application/market/submitAnalysis.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/application/market/types.ts src/application/market/submitAnalysis.ts src/__tests__/application/market/submitAnalysis.test.ts
git commit -m "feat(market): BYOK gate + tier forwarding to worker"
```

---

## Task 3: news 분석 — userApiKey 옵션 + BYOK 게이트 + tier forwarding

**Files:**
- Modify: `src/application/news/types.ts`
- Modify: `src/application/news/submitNewsAnalysis.ts`
- Modify: `src/__tests__/application/news/submitNewsAnalysis.test.ts`

- [ ] **Step 1: types.ts — `userApiKey` + 에러 변형 추가**

`SubmitNewsAnalysisOptions`에 추가 (기존 인터페이스 끝부분):

```typescript
/**
 * BYOK API key. non-pro 티어가 프리미엄 모델 사용 시 필수.
 * 제공 시 worker로 X-AI-API-KEY 헤더로 전달됨.
 */
userApiKey?: string;
```

union에 새 변형 추가:

```typescript
/** Result variant when BYOK is required but not provided. */
export interface SubmitNewsAnalysisApiKeyRequiredError {
    status: 'error';
    code: 'user_api_key_required';
    error: string;
}

export type SubmitNewsAnalysisResult =
    | SubmitNewsAnalysisCached
    | SubmitNewsAnalysisSubmitted
    | SubmitNewsAnalysisNoNewsError
    | SubmitNewsAnalysisLimitError
    | SubmitNewsAnalysisApiKeyRequiredError;
```

- [ ] **Step 2: submitNewsAnalysis.ts — BYOK 게이트 + worker body tier**

import 갱신 (파일 상단):

```typescript
import { DEFAULT_TIER, isPremiumModel, TIER_CONFIG } from '@/domain/tier';
```

`submitNewsAnalysis.ts:91-100` (함수 시작 부분, news 빈 배열 가드 다음)에 BYOK 게이트 추가:

```typescript
// ── 0. BYOK gate (tier + premium model + no userApiKey) ──
const tier = options.tier ?? DEFAULT_TIER;
const tierConfig = options.tierConfig ?? TIER_CONFIG;
const premium = isPremiumModel(modelId, tierConfig);

if (tier !== 'pro' && premium && options.userApiKey === undefined) {
    return {
        status: 'error',
        code: 'user_api_key_required',
        error: '선택한 모델은 BYOK API 키가 필요합니다.',
    };
}
```

(news 빈 배열 가드 다음, usage 가드 이전 위치에 배치.)

- [ ] **Step 3: submitNewsAnalysis.ts — worker POST 갱신**

`src/application/news/submitNewsAnalysis.ts:181-191` 영역을 다음으로 변경:

```typescript
const userApiKeyHeader: Record<string, string> =
    options.userApiKey !== undefined
        ? { 'X-AI-API-KEY': options.userApiKey }
        : {};

const dispatch = fetch(`${workerUrl}/analyze`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': workerSecret,
        ...userApiKeyHeader,
    },
    body: JSON.stringify({
        jobId,
        prompt,
        model: modelId,
        tier,
    }),
    signal: AbortSignal.timeout(SUBMIT_NEWS_ANALYSIS_TIMEOUT_MS),
}).catch(error => {
    console.error('[submitNewsAnalysis] Worker request failed:', error);
});
```

- [ ] **Step 4: 테스트 추가** (Task 2 패턴 동일하게 4-5 케이스)

```typescript
describe('submitNewsAnalysis BYOK gate + tier forwarding', () => {
    it('returns user_api_key_required when non-pro premium without BYOK', async () => { ... });
    it('proceeds when non-pro premium with BYOK', async () => { ... });
    it('proceeds when pro premium without BYOK', async () => { ... });
    it('forwards tier in worker POST body', async () => { ... });
    it('treats missing tier as free', async () => { ... });
});
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `yarn test --run src/__tests__/application/news/submitNewsAnalysis.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/application/news/types.ts src/application/news/submitNewsAnalysis.ts src/__tests__/application/news/submitNewsAnalysis.test.ts
git commit -m "feat(news): userApiKey option + BYOK gate + tier forwarding"
```

---

## Task 4: fundamental 분석 — 동일 패턴

**Files:**
- Modify: `src/application/fundamental/types.ts`
- Modify: `src/application/fundamental/submitFundamentalAnalysis.ts`
- Modify: `src/__tests__/application/fundamental/submitFundamentalAnalysis.test.ts`

Task 3과 정확히 동일한 패턴. `SubmitFundamentalAnalysisOptions`에 `userApiKey?: string` 추가, BYOK 게이트(`tier !== 'pro' && premium && !userApiKey`), worker POST에 X-AI-API-KEY 헤더 + body tier, 새 에러 변형.

- [ ] **Step 1: types.ts** — Task 3과 동일하게 `userApiKey` + 에러 변형(`SubmitFundamentalAnalysisApiKeyRequiredError`) 추가
- [ ] **Step 2: submitFundamentalAnalysis.ts** — import + 게이트 추가 (cache 체크 이전, 또는 cache miss 시점에 게이트가 fetch 전에 실행되도록 위치 조정)
- [ ] **Step 3: worker POST 갱신** — `src/application/fundamental/submitFundamentalAnalysis.ts:234-241` 영역에 X-AI-API-KEY 헤더 + body의 tier 필드 추가
- [ ] **Step 4: 테스트 추가** (4-5 케이스)
- [ ] **Step 5: 테스트 통과 확인**

```bash
yarn test --run src/__tests__/application/fundamental/submitFundamentalAnalysis.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/application/fundamental/types.ts src/application/fundamental/submitFundamentalAnalysis.ts src/__tests__/application/fundamental/submitFundamentalAnalysis.test.ts
git commit -m "feat(fundamental): userApiKey option + BYOK gate + tier forwarding"
```

---

## Task 5: overall 분석 — top-level userApiKey + axis 전파

**Files:**
- Modify: `src/application/overall/types.ts`
- Modify: `src/application/overall/dependencyResolver.ts`
- Modify: `src/application/overall/submitOverallAnalysis.ts`
- Modify: `src/__tests__/application/overall/submitOverallAnalysis.test.ts`

- [ ] **Step 1: types.ts — top-level + axis Pick 갱신**

`SubmitOverallAnalysisOptions`에 추가:

```typescript
/**
 * BYOK API key (overall scope). 최상위에서 한 번 전달되며, dependency resolver가
 * 각 axis 옵션으로 전파한다 (이미 axis 옵션에 명시되어 있으면 axis 값 우선).
 */
userApiKey?: string;
```

`OverallDependencyInputs.fundamental` Pick에 추가:

```typescript
fundamental?: Pick<
    SubmitFundamentalAnalysisOptions,
    'tier' | 'tierConfig' | 'usage' | 'now' | 'waitUntil' | 'userApiKey'
>;
```

`OverallDependencyInputs.news` Pick에 추가:

```typescript
news?:
    | Pick<
          SubmitNewsAnalysisOptions,
          'tier' | 'tierConfig' | 'usage' | 'now' | 'waitUntil' | 'userApiKey'
      >
    | ReadonlyArray<EnrichedNewsItem>;
```

`technical` Pick에는 `userApiKey`가 이미 있음.

새 에러 변형 추가:

```typescript
export interface SubmitOverallAnalysisApiKeyRequiredError {
    status: 'key_error';
    code: 'user_api_key_required';
    error: string;
}

export type SubmitOverallAnalysisResult =
    | SubmitOverallAnalysisCached
    | SubmitOverallAnalysisPendingDependencies
    | SubmitOverallAnalysisSubmitted
    | SubmitOverallAnalysisError
    | SubmitOverallAnalysisLimitError
    | SubmitOverallAnalysisApiKeyRequiredError;
```

(기존 `limit_error` 패턴과 일관되게 `key_error` discriminant 사용.)

- [ ] **Step 2: dependencyResolver.ts — top-level userApiKey/tier 전파**

`resolveOverallDependencies` 내부에서 axis 옵션을 구성할 때 top-level `userApiKey`를 axis-level이 명시되지 않은 경우에만 fallback으로 적용:

(`dependencyResolver.ts`의 axis options building 영역 — 정확한 라인은 파일을 열어 확인 후 수정)

```typescript
const technicalUserApiKey =
    options.technical.userApiKey ?? options.userApiKey;
const technicalTier =
    options.technical.tierContext?.tier ?? options.tier ?? DEFAULT_TIER;

const fundamentalUserApiKey =
    options.fundamental?.userApiKey ?? options.userApiKey;
const fundamentalTier =
    options.fundamental?.tier ?? options.tier ?? DEFAULT_TIER;

// (news/technical도 동일 패턴)
```

각 axis submit 호출 시 위 값을 전달.

- [ ] **Step 3: submitOverallAnalysis.ts — BYOK 게이트 + worker POST body tier**

import 갱신:

```typescript
import { DEFAULT_TIER, isPremiumModel, TIER_CONFIG } from '@/domain/tier';
```

`submitOverallAnalysis` 함수 시작 부분(top-level usage 체크 다음)에 게이트 추가:

```typescript
const tier = options.tier ?? DEFAULT_TIER;
const tierConfig = options.tierConfig ?? TIER_CONFIG;
const premium = isPremiumModel(modelId, tierConfig);

if (tier !== 'pro' && premium && options.userApiKey === undefined) {
    return {
        status: 'key_error',
        code: 'user_api_key_required',
        error: '선택한 모델은 BYOK API 키가 필요합니다.',
    };
}
```

(이 게이트는 dependency resolver 호출 이전에 실행되어야 함 — 빠른 실패 위해.)

`src/application/overall/submitOverallAnalysis.ts:220-227` 영역의 dispatch 갱신:

```typescript
const userApiKeyHeader: Record<string, string> =
    options.userApiKey !== undefined
        ? { 'X-AI-API-KEY': options.userApiKey }
        : {};

const dispatch = fetch(`${workerUrl}/analyze`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': workerSecret,
        ...userApiKeyHeader,
    },
    body: JSON.stringify({
        jobId,
        prompt,
        model: modelId,
        tier,
    }),
    signal: AbortSignal.timeout(SUBMIT_OVERALL_ANALYSIS_TIMEOUT_MS),
}).catch(error => {
    console.error('[submitOverallAnalysis] Worker request failed:', error);
});
```

- [ ] **Step 4: 테스트 추가**

`submitOverallAnalysis.test.ts`에 다음 케이스 추가:

```typescript
describe('submitOverallAnalysis BYOK gate + axis propagation', () => {
    it('returns key_error when non-pro premium without top-level userApiKey', async () => { ... });
    it('forwards top-level userApiKey to all axes when axis-level not set', async () => { ... });
    it('keeps axis-level userApiKey when explicitly set (overrides top-level)', async () => { ... });
    it('forwards tier in worker POST body of overall job', async () => { ... });
});
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
yarn test --run src/__tests__/application/overall/submitOverallAnalysis.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/application/overall/types.ts src/application/overall/dependencyResolver.ts src/application/overall/submitOverallAnalysis.ts src/__tests__/application/overall/submitOverallAnalysis.test.ts
git commit -m "feat(overall): top-level userApiKey + axis propagation + BYOK gate + tier forwarding"
```

---

## Task 6: 통합 검증

- [ ] **Step 1: 전체 lint + typecheck + test + build**

```bash
yarn lint
yarn typecheck
yarn test --run
yarn build 2>&1 | tail -20
```

전부 PASS여야 함.

- [ ] **Step 2: MISTAKES.md self-review**

Modified 파일별로 다음 섹션 점검:
- `src/domain/tier.ts` → Domain Functions, TypeScript, Coding Paradigm
- `src/application/*/...` → Infrastructure Functions(application은 infra-like 규칙), TypeScript, Coding Paradigm
- `src/__tests__/...` → Tests

위반 사항 발견 시 수정 후 lint/test 재실행.

- [ ] **Step 3: 변경 요약 확인**

```bash
git log --oneline main..HEAD
git diff main..HEAD --stat
```

- [ ] **Step 4: PR 생성**

```
Title: feat: tier-aware key routing for all analysis APIs

Body:
- 4개 분석 함수에 tier + userApiKey 옵션 추가
- non-pro + 프리미엄 + no BYOK → user_api_key_required 게이트
- worker POST body에 tier 필드 포함
- overall은 top-level → axes 전파
- domain/tier.ts에 isPremiumModel 추가

Spec: docs/superpowers/specs/2026-05-08-analysis-api-key-routing-design.md

Worker (siglens-worker)에 tier 수용이 선행 배포되어야 함.
```

---

## Self-Review

- 모든 step에 구체적 코드 포함 ✓
- TDD: 각 task 첫 step이 실패 테스트 ✓
- placeholder 없음 ✓
- 6개 분석 중 newsCard / briefing은 본 plan 범위 외 (briefing은 server-only, newsCard는 후속 작업) — spec §9에 명시됨 ✓
- worker(plan 1)가 backward-compat이므로 plan 2 단독으로도 안전 (구버전 worker는 tier body 무시) ✓
