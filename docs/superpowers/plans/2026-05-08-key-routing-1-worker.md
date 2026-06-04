# Plan 1/3: siglens-worker — Tier-aware key routing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Worker가 `/analyze` body의 `tier` 필드를 인식하여 `tier === 'pro'` 또는 siglens-provided 모델인 경우 자체 env 서버 키를 사용하도록 변경. 기존 동작은 `tier` 미전달 시 보존.

**Architecture:** `/analyze` body에 optional `tier?: 'free' | 'member' | 'pro'` 필드 추가. `callAnalysisAI`의 키 결정 로직을 `isSiglensProvided(model) || tier === 'pro'`로 확장. 검증 로직은 기존 4xx 응답 형식 유지.

**Tech Stack:** Express, Vitest

**Repo path (worktree):** `/Users/y0ngha/Project/siglens-worker-key-routing`

**Spec reference:** `/Users/y0ngha/Project/siglens-core/docs/superpowers/specs/2026-05-08-analysis-api-key-routing-design.md` §4.1

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/index.ts` | Modify | `/analyze` body parsing, `callAnalysisAI` 키 결정 |
| `src/__tests__/analyze.test.ts` | Create or extend | 새 라우팅 분기 테스트 |

---

## Task 1: Worker tier 타입 정의 + AnalyzeRequest 확장

**Files:**
- Modify: `src/index.ts:108-113`

- [ ] **Step 1: AnalyzeRequest에 tier 필드 추가**

`src/index.ts`의 `AnalyzeRequest` 인터페이스를 다음으로 변경:

```typescript
type WorkerTier = 'free' | 'member' | 'pro';

interface AnalyzeRequest {
    jobId: string;
    prompt: string;
    model: AIModel;
    thinkingBudget?: number;
    tier?: WorkerTier;
}
```

- [ ] **Step 2: body 파싱에 tier 추가**

`src/index.ts:162-167`의 body 타입을 다음으로 변경:

```typescript
const body = req.body as {
    jobId?: string;
    prompt?: string;
    model?: unknown;
    thinkingBudget?: unknown;
    tier?: unknown;
};
```

- [ ] **Step 3: tier validation helper 추가**

`callAnalysisAI` 함수 위에 추가:

```typescript
function parseTier(value: unknown): WorkerTier | undefined {
    if (value === 'free' || value === 'member' || value === 'pro') {
        return value;
    }
    return undefined;
}
```

- [ ] **Step 4: validatedRequest에 tier 포함**

`src/index.ts:200-203` 영역을 다음으로 변경:

```typescript
const thinkingBudget =
    typeof body.thinkingBudget === 'number' ? body.thinkingBudget : undefined;
const tier = parseTier(body.tier);

const validatedRequest: AnalyzeRequest = {
    jobId,
    prompt,
    model,
    thinkingBudget,
    tier,
};
```

- [ ] **Step 5: TypeScript 빌드 확인**

Run: `cd /Users/y0ngha/Project/siglens-worker-key-routing && yarn typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat: accept optional tier field in /analyze body"
```

---

## Task 2: 키 결정 로직을 tier-aware로 확장

**Files:**
- Modify: `src/index.ts:35-86`

- [ ] **Step 1: callAnalysisAI 시그니처에 tier 파라미터 추가**

`src/index.ts:35-49`를 다음으로 변경:

```typescript
async function callAnalysisAI(
    prompt: string,
    model: AIModel,
    userApiKey: string | undefined,
    tier: WorkerTier | undefined,
    signal?: AbortSignal,
    initialThinkingBudget?: number
): Promise<string> {
    const useServerKey = isSiglensProvided(model) || tier === 'pro';
    const apiKey = useServerKey ? resolveServerApiKey(model) : userApiKey;

    // useServerKey === false 인데 userApiKey 가 없으면 라우터에서 이미 400 반환됨;
    // type narrowing 가드.
    if (apiKey === undefined) {
        throw new Error('User API key required for non-siglens-provided model');
    }

    if (isClaudeModel(model)) {
        return callClaudeWithRetry(prompt, model, apiKey, { signal });
    }
    if (isChatGPTModel(model)) {
        return callChatGPTWithRetry(prompt, model, apiKey, { signal });
    }
    if (isGeminiModel(model)) {
        const budgetRef =
            initialThinkingBudget !== undefined
                ? { current: initialThinkingBudget }
                : undefined;
        // siglens 제공 Gemini 모델 OR pro 티어 → free→paid fallback 사용 (서버 키 보호 목적).
        // user key Gemini 모델은 fallback 없이 직접 호출.
        if (useServerKey) {
            return callGeminiWithKeyFallback(
                prompt,
                model,
                signal,
                ANALYSIS_FREE_KEY_MAX_RETRY_DELAY_MS,
                budgetRef
            );
        }
        return callGeminiWithRetry(prompt, model, apiKey, {
            signal,
            budgetRef,
        });
    }
    /* istanbul ignore next */
    throw new Error(`Unsupported model: ${model}`);
}
```

- [ ] **Step 2: BYOK 검증 분기를 tier-aware로 갱신**

`src/index.ts:187-198`을 다음으로 변경:

```typescript
const tier = parseTier(body.tier);
const requiresUserKey = !isSiglensProvided(model) && tier !== 'pro';

if (requiresUserKey && !userApiKey) {
    console.log(
        '[Worker] /analyze request missing user API key for non-siglens-provided model:',
        {
            jobId,
            model,
            tier,
            thinkingBudget: body.thinkingBudget,
            userApiKeyProvided: userApiKey !== undefined,
        }
    );
    res.status(HTTP_STATUS_BAD_REQUEST).json({
        error: 'X-AI-API-KEY header is required for this model',
    });
    return;
}
```

(주의: 이 시점에서 `tier` 변수는 위에서 한 번만 선언되어야 함. Step 1에서 Task 1의 Step 4를 통해 도입한 tier 선언과 위치 충돌 시, 중복 제거 — 단일 선언만 유지.)

- [ ] **Step 3: processJob에 tier 전달**

`src/index.ts:216` 호출부를 다음으로 변경:

```typescript
void processJob(validatedRequest, userApiKey, controller)
```

→ `processJob`이 `validatedRequest.tier`를 통해 tier에 접근할 수 있으므로 시그니처는 그대로.

`src/index.ts:249-253`의 processJob 함수 시그니처:

```typescript
async function processJob(
    request: AnalyzeRequest,
    userApiKey: string | undefined,
    controller: AbortController
): Promise<void> {
    const { jobId, prompt, model, thinkingBudget, tier } = request;
    // ... rest unchanged
```

- [ ] **Step 4: callAnalysisAI 호출에 tier 전달**

`src/index.ts:268-274` 호출을:

```typescript
const result = await callAnalysisAI(
    prompt,
    model,
    userApiKey,
    tier,
    controller.signal,
    thinkingBudget
);
```

- [ ] **Step 5: TypeScript 빌드 확인**

Run: `yarn typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat: route to server key when tier is pro"
```

---

## Task 3: 라우팅 분기 테스트 추가

**Files:**
- Read: `src/__tests__/` 디렉토리 구조 확인 (기존 테스트 패턴 파악용)
- Modify or Create: `src/__tests__/analyze.test.ts` (기존 파일 있으면 확장)

- [ ] **Step 1: 기존 테스트 구조 파악**

Run: `ls -la src/__tests__/`
Run: `cat src/__tests__/<existing-test>.ts | head -100` (있는 경우)

→ 기존 테스트의 mocking 패턴 (express, axios, 공급자별 호출)을 파악한 뒤 동일 스타일로 신규 테스트 작성.

- [ ] **Step 2: 테스트 케이스 4종 추가**

`src/__tests__/analyze.test.ts`에 다음 케이스를 추가 (기존 mocking 패턴 따라):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 기존 테스트의 모킹 패턴 그대로 재사용 (callAnalysisAI / resolveServerApiKey 모킹)

describe('/analyze key routing', () => {
    it('uses server key when tier=pro for premium model', async () => {
        // request: model = premium (e.g., gemini-2.5-pro), tier='pro', no X-AI-API-KEY
        // expected: callAnalysisAI invoked with apiKey = config.gemini.apiKey, no 400
    });

    it('returns 400 when tier=non-pro and premium model and no X-AI-API-KEY', async () => {
        // request: model = premium, tier='member' or 'free', no header
        // expected: 400 response with error message
    });

    it('uses user key when tier=non-pro and premium model and X-AI-API-KEY provided', async () => {
        // request: model = premium, tier='member', X-AI-API-KEY: 'user-key'
        // expected: callAnalysisAI invoked with apiKey = 'user-key'
    });

    it('uses server key when model is siglens-provided regardless of tier', async () => {
        // request: model = free model, tier='free', no X-AI-API-KEY
        // expected: callAnalysisAI invoked with server key
    });

    it('treats missing tier as non-pro (backward compat)', async () => {
        // request: model = premium, no tier field, no X-AI-API-KEY
        // expected: 400 response
    });
});
```

→ 각 케이스에 대해 expect/assert를 기존 테스트와 동일 스타일로 구체화.

- [ ] **Step 3: 테스트 실행해서 RED 확인 (해당 케이스 없을 때)**

Run: `yarn test --run src/__tests__/analyze.test.ts`

신규 케이스가 처음에는 통과/실패 어느 쪽이든 OK — 핵심은 라우팅 로직이 정확히 동작하는지 확인.

- [ ] **Step 4: 모든 테스트 통과 확인**

Run: `yarn test --run`
Expected: PASS (전체)

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/analyze.test.ts
git commit -m "test: tier-aware key routing in /analyze"
```

---

## Task 4: 통합 검증 + PR 생성

- [ ] **Step 1: lint + typecheck + build**

```bash
yarn lint
yarn typecheck
yarn build 2>&1 | tail -20
```

모두 PASS여야 함.

- [ ] **Step 2: 변경 요약 확인**

```bash
git log --oneline main..HEAD
git diff main..HEAD --stat
```

- [ ] **Step 3: PR 생성**

Branch가 push되지 않았다면 push 후 PR 생성 (git-agent 위임 가능):

```
Title: feat: tier-aware key routing in /analyze

Body:
- /analyze body에 optional tier 필드 추가
- tier === 'pro' 또는 isSiglensProvided(model) 시 자체 서버 키 사용
- 기존 동작 (tier 미전달) 보존
- 4종 라우팅 분기 테스트 추가

Spec: siglens-core/docs/superpowers/specs/2026-05-08-analysis-api-key-routing-design.md
```

---

## Self-Review

- 모든 step에 구체적 코드/명령 포함됨 ✓
- placeholder 없음 ✓
- worker는 변경 후 구버전 siglens-core(tier 미전달)와 호환 — backward compat 유지 ✓
- 다음 plan(siglens-core)이 이 worker 변경을 require함 — 배포 순서 명시됨 ✓
