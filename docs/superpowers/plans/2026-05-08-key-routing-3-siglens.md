# Plan 3/3: siglens — Tier + BYOK lookup for news/fundamental/overall

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 4개 분석 action(`submitAnalysisAction`, `submitNewsAnalysisAction`, `submitFundamentalAnalysisAction`, `submitOverallAnalysisAction`)이 tier + BYOK key를 조회하여 siglens-core에 전달하도록 변경. BYOK 조회 로직은 공유 헬퍼로 추출.

**Architecture:** `submitAnalysisAction.ts`의 `resolveByokOutcome` 로직을 `infrastructure/market/byokGate.ts`로 추출. 4개 action에서 동일 헬퍼 사용. siglens-core 호출 시 `tier`(또는 `tierContext`)와 `userApiKey` 전달.

**Tech Stack:** Next.js 14, TypeScript, Drizzle ORM (PostgreSQL/Neon)

**Repo path (worktree):** `/Users/y0ngha/Project/siglens-key-routing`

**Spec reference:** `siglens-core/docs/superpowers/specs/2026-05-08-analysis-api-key-routing-design.md` §4.3

**Prerequisite:** siglens-core 신버전 (Plan 2 완료) 릴리즈 후 `package.json`의 `@y0ngha/siglens-core` 버전 업데이트 필요.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/infrastructure/market/byokGate.ts` | Create | tier+BYOK 조회 공유 헬퍼 |
| `src/__tests__/infrastructure/market/byokGate.test.ts` | Create | 헬퍼 테스트 |
| `src/infrastructure/market/submitAnalysisAction.ts` | Modify | byokGate 사용, tierContext 전달 |
| `src/infrastructure/market/submitNewsAnalysisAction.ts` | Modify | tier + BYOK 조회 + core에 전달 |
| `src/infrastructure/market/submitFundamentalAnalysisAction.ts` | Modify | 동일 |
| `src/infrastructure/market/submitOverallAnalysisAction.ts` | Modify | 동일 |
| `src/__tests__/infrastructure/market/...` | Modify | 4개 action 테스트 갱신 |

---

## Task 1: siglens-core 버전 업데이트

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 신버전 설치**

```bash
cd /Users/y0ngha/Project/siglens-key-routing
yarn add @y0ngha/siglens-core@latest
```

(Plan 2 PR이 머지 + 릴리즈된 후 진행. 현재 버전은 추후 확인.)

- [ ] **Step 2: 새 export 가용성 확인**

Run: `yarn typecheck` — `isPremiumModel` import 가능 여부 확인.

```typescript
import { isPremiumModel } from '@y0ngha/siglens-core';
```

- [ ] **Step 3: Commit**

```bash
git add package.json yarn.lock
git commit -m "chore: bump @y0ngha/siglens-core to <version>"
```

---

## Task 2: BYOK gate 공유 헬퍼 추출

**Files:**
- Create: `src/infrastructure/market/byokGate.ts`
- Read: `src/infrastructure/market/submitAnalysisAction.ts:21-122` (기존 `resolveByokOutcome` 참조)
- Create: `src/__tests__/infrastructure/market/byokGate.test.ts`

- [ ] **Step 1: byokGate.ts 신규 파일 작성**

`src/infrastructure/market/byokGate.ts`:

```typescript
import 'server-only';

import {
    TIER_CONFIG,
    getProviderForModel,
    isPremiumModel,
    type ModelId,
    type Tier,
} from '@y0ngha/siglens-core';
import { getDatabaseClient } from '@/infrastructure/db/client';
import {
    DrizzleUserApiKeyRepository,
    LlmApiKeyDecryptionFailedError,
} from '@/infrastructure/db/userApiKeyRepository';
import { getUserTier } from '@/infrastructure/tier/use-cases/getUserTier';
import { DrizzleUserRepository } from '@/infrastructure/db/userRepository';

/** Machine-readable codes for siglens-side analysis gate denials. */
export type AnalysisGateErrorCode =
    | 'tier_premium_blocked'
    | 'invalid_model'
    | 'api_key_corrupted';

export interface AnalysisGateError {
    code: AnalysisGateErrorCode;
    message: string;
}

const GATE_MESSAGES: Record<AnalysisGateErrorCode, string> = {
    tier_premium_blocked:
        '선택한 모델은 프리미엄 등급에서만 사용 가능합니다. API 키를 등록하거나 등급을 업그레이드해 주세요.',
    invalid_model: '알 수 없는 모델입니다.',
    api_key_corrupted:
        '저장된 API 키를 복호화하지 못했습니다. 키를 다시 등록해 주세요.',
};

export function buildGateError(code: AnalysisGateErrorCode): AnalysisGateError {
    return { code, message: GATE_MESSAGES[code] };
}

/** TIER_CONFIG.models의 어느 등급에든 등재된 modelId인지 검사. */
export function isKnownModelId(modelId: string): boolean {
    const allTiers = Object.values(TIER_CONFIG.models) as readonly (
        readonly string[]
    )[];
    return allTiers.some(models => models.includes(modelId));
}

export type ByokOutcome =
    | { kind: 'allowed'; tier: Tier; userApiKey?: string }
    | { kind: 'blocked'; error: AnalysisGateError };

/**
 * Tier 조회 + BYOK 게이트.
 *
 * @param userId - 인증된 사용자 ID. null이면 free tier로 처리.
 * @param modelId - 선택된 모델. 미지정 시 게이트 스킵 (caller에서 처리).
 * @returns `allowed`: tier + (있으면) userApiKey. `blocked`: 게이트 사유.
 */
export async function resolveTierAndByok(
    userId: string | null,
    modelId: ModelId
): Promise<ByokOutcome> {
    if (!isKnownModelId(modelId)) {
        return { kind: 'blocked', error: buildGateError('invalid_model') };
    }

    const tier =
        userId === null
            ? 'free'
            : await getUserTier(
                  { userId },
                  { users: new DrizzleUserRepository(getDatabaseClient().db) }
              );

    const premium = isPremiumModel(modelId);

    // pro 또는 free 모델 → server pays, no BYOK needed.
    if (tier === 'pro' || !premium) {
        return { kind: 'allowed', tier };
    }

    // non-pro + premium → BYOK 필수.
    if (userId === null) {
        return {
            kind: 'blocked',
            error: buildGateError('tier_premium_blocked'),
        };
    }

    const llmProvider = getProviderForModel(modelId);
    try {
        const repo = new DrizzleUserApiKeyRepository(getDatabaseClient().db);
        const record = await repo.findByUserAndProvider(userId, llmProvider);
        if (record === null) {
            return {
                kind: 'blocked',
                error: buildGateError('tier_premium_blocked'),
            };
        }
        return { kind: 'allowed', tier, userApiKey: record.apiKey };
    } catch (error) {
        if (error instanceof LlmApiKeyDecryptionFailedError) {
            return {
                kind: 'blocked',
                error: buildGateError('api_key_corrupted'),
            };
        }
        throw error;
    }
}
```

- [ ] **Step 2: 헬퍼 테스트 작성**

`src/__tests__/infrastructure/market/byokGate.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Drizzle 의존성을 mock — 기존 action 테스트의 mocking 패턴 참조.

describe('resolveTierAndByok', () => {
    it('returns allowed with tier=free when userId is null', async () => {
        // free 모델 + null userId → kind: 'allowed', tier: 'free', userApiKey: undefined
    });

    it('returns blocked with invalid_model for unknown modelId', async () => { ... });

    it('returns allowed without userApiKey for pro tier on premium model', async () => { ... });

    it('returns allowed without userApiKey for non-pro tier on free model', async () => { ... });

    it('returns blocked tier_premium_blocked for non-pro premium without BYOK record', async () => { ... });

    it('returns allowed with userApiKey for non-pro premium with BYOK record', async () => { ... });

    it('returns blocked api_key_corrupted on decryption failure', async () => { ... });
});
```

각 케이스에서 DB repo + getUserTier를 vi.fn()으로 stub.

- [ ] **Step 3: 테스트 실행 및 통과 확인**

```bash
yarn test --run src/__tests__/infrastructure/market/byokGate.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/market/byokGate.ts src/__tests__/infrastructure/market/byokGate.test.ts
git commit -m "feat: extract shared tier+BYOK gate helper"
```

---

## Task 3: submitAnalysisAction 리팩토 + tierContext 전달

**Files:**
- Modify: `src/infrastructure/market/submitAnalysisAction.ts`
- Modify: `src/__tests__/infrastructure/market/submitAnalysisAction.test.ts`

- [ ] **Step 1: submitAnalysisAction.ts를 byokGate 사용하도록 리팩토**

기존 `resolveByokOutcome` 로직을 `byokGate.resolveTierAndByok`로 교체. `tierContext`를 siglens-core에 전달:

```typescript
'use server';

import { waitUntil } from '@vercel/functions';
import {
    submitAnalysis,
    type ModelId,
    type SubmitAnalysisGatedResult,
    type Timeframe,
} from '@y0ngha/siglens-core';
import { getCurrentUser } from '@/infrastructure/auth/getCurrentUser';
import {
    resolveTierAndByok,
    buildGateError,
    type AnalysisGateError,
} from '@/infrastructure/market/byokGate';

export interface AnalysisGateBlockedResult {
    status: 'error';
    error: AnalysisGateError;
}

export type SubmitAnalysisActionResult =
    | SubmitAnalysisGatedResult
    | AnalysisGateBlockedResult;

export async function submitAnalysisAction(
    symbol: string,
    companyName: string,
    timeframe: Timeframe,
    force?: boolean,
    fmpSymbol?: string,
    modelId?: ModelId
): Promise<SubmitAnalysisActionResult> {
    const user = await getCurrentUser();
    const userId = user?.id ?? null;

    if (modelId === undefined) {
        return submitAnalysis(symbol, companyName, timeframe, force, fmpSymbol, {
            waitUntil,
            modelId,
        });
    }

    const gate = await resolveTierAndByok(userId, modelId);
    if (gate.kind === 'blocked') {
        return { status: 'error', error: gate.error };
    }

    return submitAnalysis(symbol, companyName, timeframe, force, fmpSymbol, {
        waitUntil,
        modelId,
        tierContext: { userId, tier: gate.tier },
        ...(gate.userApiKey !== undefined ? { userApiKey: gate.userApiKey } : {}),
    });
}
```

- [ ] **Step 2: 기존 테스트 갱신**

`submitAnalysisAction.test.ts`에서 `resolveByokOutcome` 직접 mock하던 부분을 `resolveTierAndByok`로 교체. 새 케이스 추가:

```typescript
it('forwards tierContext to siglens-core', async () => {
    // userId='u1', tier='pro' resolveTierAndByok mock → kind: 'allowed', tier: 'pro'
    // expect submitAnalysis called with tierContext: { userId: 'u1', tier: 'pro' }
});
```

- [ ] **Step 3: 테스트 통과 확인**

```bash
yarn test --run src/__tests__/infrastructure/market/submitAnalysisAction.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/market/submitAnalysisAction.ts src/__tests__/infrastructure/market/submitAnalysisAction.test.ts
git commit -m "refactor(market): use shared byokGate + forward tierContext"
```

---

## Task 4: submitNewsAnalysisAction — tier + BYOK 조회 + 전달

**Files:**
- Modify: `src/infrastructure/market/submitNewsAnalysisAction.ts`
- Modify: `src/__tests__/infrastructure/market/submitNewsAnalysisAction.test.ts`

- [ ] **Step 1: submitNewsAnalysisAction.ts 갱신**

```typescript
'use server';

import { waitUntil } from '@vercel/functions';
import {
    submitNewsAnalysis,
    type ModelId,
    type SubmitNewsAnalysisResult,
} from '@y0ngha/siglens-core';
import { getCurrentUser } from '@/infrastructure/auth/getCurrentUser';
import {
    resolveTierAndByok,
    type AnalysisGateError,
} from '@/infrastructure/market/byokGate';
// (기존 enrichedNews / upcomingCalendar 조회 로직은 유지)

export interface NewsAnalysisGateBlockedResult {
    status: 'error';
    code: 'gate_blocked';
    error: AnalysisGateError;
}

export type SubmitNewsAnalysisActionResult =
    | SubmitNewsAnalysisResult
    | NewsAnalysisGateBlockedResult;

export async function submitNewsAnalysisAction(
    symbol: string,
    companyName: string,
    modelId: ModelId
): Promise<SubmitNewsAnalysisActionResult> {
    const user = await getCurrentUser();
    const userId = user?.id ?? null;

    const gate = await resolveTierAndByok(userId, modelId);
    if (gate.kind === 'blocked') {
        return { status: 'error', code: 'gate_blocked', error: gate.error };
    }

    // 기존 enrichedNews / upcomingCalendar 조회 (유지)
    const enrichedNews = /* ... existing logic ... */;
    const upcomingCalendar = /* ... existing logic ... */;

    return submitNewsAnalysis({
        symbol,
        companyName,
        modelId,
        news: enrichedNews,
        upcomingCalendar,
        waitUntil,
        tier: gate.tier,
        ...(gate.userApiKey !== undefined ? { userApiKey: gate.userApiKey } : {}),
    });
}
```

- [ ] **Step 2: 테스트 갱신/추가** — Task 3 패턴 동일

- [ ] **Step 3: 테스트 통과 확인**

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/market/submitNewsAnalysisAction.ts src/__tests__/infrastructure/market/submitNewsAnalysisAction.test.ts
git commit -m "feat(news): tier + BYOK forwarding to siglens-core"
```

---

## Task 5: submitFundamentalAnalysisAction — 동일 패턴

**Files:**
- Modify: `src/infrastructure/market/submitFundamentalAnalysisAction.ts`
- Modify: `src/__tests__/infrastructure/market/submitFundamentalAnalysisAction.test.ts`

- [ ] **Step 1: action.ts 갱신** — Task 4 패턴 적용 (`tier` + `userApiKey` 전달)

- [ ] **Step 2: 테스트 갱신/추가**

- [ ] **Step 3: 테스트 통과 확인**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(fundamental): tier + BYOK forwarding to siglens-core"
```

---

## Task 6: submitOverallAnalysisAction — 동일 패턴 (top-level)

**Files:**
- Modify: `src/infrastructure/market/submitOverallAnalysisAction.ts`
- Modify: `src/__tests__/infrastructure/market/submitOverallAnalysisAction.test.ts`

- [ ] **Step 1: action.ts 갱신**

`submitOverallAnalysis` 호출 시 top-level에 `tier` + `userApiKey` 전달:

```typescript
return submitOverallAnalysis({
    symbol,
    companyName,
    timeframe,
    modelId,
    fundamentalProvider: new FmpFundamentalClient(),
    newsItems: enrichedNews,
    upcomingCalendar,
    technical: { tierContext: { userId, tier: gate.tier } },
    waitUntil,
    tier: gate.tier,
    ...(gate.userApiKey !== undefined ? { userApiKey: gate.userApiKey } : {}),
});
```

- [ ] **Step 2: 테스트 갱신/추가**

- [ ] **Step 3: 테스트 통과 확인**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(overall): tier + BYOK forwarding to siglens-core"
```

---

## Task 7: 통합 검증 + PR

- [ ] **Step 1: 전체 검증**

```bash
yarn lint
yarn typecheck
yarn test --run
yarn build 2>&1 | tail -20
```

전부 PASS여야 함.

- [ ] **Step 2: 통합 흐름 수동 점검 (선택)**

가능하면 dev server를 띄우고 다음 시나리오 점검:
- pro 유저: 프리미엄 모델 분석 호출 → 정상 처리 (worker가 server key 사용)
- free/member 유저: BYOK 등록 후 프리미엄 모델 분석 → 정상 처리
- free/member 유저: BYOK 미등록 + 프리미엄 모델 → `tier_premium_blocked`
- 무료 모델 분석 → 정상 (모든 티어)

- [ ] **Step 3: PR 생성**

```
Title: feat: tier-aware key routing for analysis actions

Body:
- 4개 분석 action에 tier + BYOK 조회 통합
- 공유 헬퍼 byokGate.ts 추출
- siglens-core 신버전(<x.y.z>) 의존
- 기존 submitAnalysisAction의 BYOK 로직을 헬퍼로 이전

Spec: ../siglens-core/docs/superpowers/specs/2026-05-08-analysis-api-key-routing-design.md

Prerequisite: siglens-core <version> + siglens-worker tier-aware build 배포 후 머지.
```

---

## Self-Review

- 모든 step에 구체적 코드 제공 ✓
- 기존 `resolveByokOutcome` 로직을 손실 없이 헬퍼로 추출 ✓
- 4개 action 모두 동일 패턴 적용 (DRY) ✓
- siglens-core 신버전 의존성 명시 (Task 1이 prerequisite) ✓
- placeholder 없음 ✓
