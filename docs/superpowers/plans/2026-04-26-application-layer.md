# Application Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `infrastructure/market/`에서 오케스트레이션 함수 5개를 분리해 새 `src/application/` 레이어를 만든다.

**Architecture:** `application` 레이어는 여러 `infrastructure` 모듈을 조합해 use-case를 완성하는 함수들의 홈이다. 의존성 방향은 `application → infrastructure, domain` 단방향이며, `domain`·`infrastructure`에서는 `application`을 import하지 못한다. ESLint 규칙으로 강제한다.

**Tech Stack:** TypeScript, Vitest, typescript-eslint (flat config)

---

## 파일 맵

| 작업 | 파일 |
|---|---|
| 생성 | `src/application/market/submitAnalysis.ts` |
| 생성 | `src/application/market/pollAnalysis.ts` |
| 생성 | `src/application/market/cancelAnalysisJob.ts` |
| 생성 | `src/application/market/submitBriefing.ts` |
| 생성 | `src/application/market/pollBriefing.ts` |
| 생성 | `src/__tests__/application/market/submitAnalysis.test.ts` |
| 생성 | `src/__tests__/application/market/pollAnalysis.test.ts` |
| 생성 | `src/__tests__/application/market/cancelAnalysisJob.test.ts` |
| 생성 | `src/__tests__/application/market/submitBriefing.test.ts` |
| 생성 | `src/__tests__/application/market/pollBriefing.test.ts` |
| 삭제 | `src/infrastructure/market/submitAnalysis.ts` |
| 삭제 | `src/infrastructure/market/pollAnalysis.ts` |
| 삭제 | `src/infrastructure/market/cancelAnalysisJob.ts` |
| 삭제 | `src/infrastructure/market/submitBriefing.ts` |
| 삭제 | `src/infrastructure/market/pollBriefing.ts` |
| 삭제 | `src/__tests__/infrastructure/market/submitAnalysis.test.ts` |
| 삭제 | `src/__tests__/infrastructure/market/pollAnalysis.test.ts` |
| 삭제 | `src/__tests__/infrastructure/market/cancelAnalysisJob.test.ts` |
| 삭제 | `src/__tests__/infrastructure/market/submitBriefing.test.ts` |
| 삭제 | `src/__tests__/infrastructure/market/pollBriefing.test.ts` |
| 수정 | `src/index.ts` |
| 수정 | `eslint.config.mjs` |
| 수정 | `docs/ARCHITECTURE.md` |

---

## Task 1: application/market 소스 파일 생성 및 구 파일 삭제

**Files:**
- Create: `src/application/market/submitAnalysis.ts`
- Create: `src/application/market/pollAnalysis.ts`
- Create: `src/application/market/cancelAnalysisJob.ts`
- Create: `src/application/market/submitBriefing.ts`
- Create: `src/application/market/pollBriefing.ts`
- Delete: `src/infrastructure/market/submitAnalysis.ts`
- Delete: `src/infrastructure/market/pollAnalysis.ts`
- Delete: `src/infrastructure/market/cancelAnalysisJob.ts`
- Delete: `src/infrastructure/market/submitBriefing.ts`
- Delete: `src/infrastructure/market/pollBriefing.ts`

- [ ] **Step 1: `src/application/market/submitAnalysis.ts` 생성**

내용은 기존 `src/infrastructure/market/submitAnalysis.ts`와 동일하다. import 경로는 변경 없음 (`@/infrastructure/*`, `@/domain/*` 모두 유효).

```typescript
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { lastNonNull } from '@/domain/indicators/utils';
import type {
    AnalysisResponse,
    Skill,
    SubmitAnalysisResult,
    Timeframe,
} from '@/domain/types';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { buildAnalysisCacheKey } from '@/infrastructure/cache/config';
import { fetchBarsWithIndicators } from '@/infrastructure/market/barsApi';
import { readWorkerConfig } from '@/infrastructure/market/config';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { FileSkillsLoader } from '@/infrastructure/skills/loader';

export async function submitAnalysis(
    symbol: string,
    timeframe: Timeframe,
    force: boolean = false,
    fmpSymbol?: string
): Promise<SubmitAnalysisResult> {
    const { workerUrl, workerSecret } = readWorkerConfig();

    const cache = createCacheProvider();
    const cacheKey = buildAnalysisCacheKey(symbol, timeframe);

    if (!force && cache !== null) {
        try {
            const cached = await cache.get<AnalysisResponse>(cacheKey);
            if (cached !== null) {
                return { status: 'cached', result: cached };
            }
        } catch (error) {
            console.error('[Submit] Cache read failed:', error);
        }
    }

    const { bars, indicators } = await fetchBarsWithIndicators(
        symbol,
        timeframe,
        fmpSymbol
    );

    const skillsLoader = new FileSkillsLoader();
    let skills: Skill[] = [];
    let skillsDegraded = false;
    try {
        skills = await skillsLoader.loadSkills();
    } catch (error) {
        console.error(
            '[Submit] Skills loading failed, proceeding without skills:',
            error
        );
        skillsDegraded = true;
    }

    const prompt = buildAnalysisPrompt(
        symbol,
        bars,
        indicators,
        skills,
        timeframe
    );

    const jobId = crypto.randomUUID();
    const lastClose = bars[bars.length - 1]?.close;
    const atr = lastNonNull(indicators.atr) ?? undefined;
    await setJobMeta(jobId, {
        symbol,
        timeframe,
        skillsDegraded,
        lastClose,
        atr,
    });

    // fire-and-forget: 에러는 무시하고 caller에게 jobId만 반환한다.
    fetch(`${workerUrl}/analyze`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Worker-Secret': workerSecret,
        },
        body: JSON.stringify({ jobId, prompt }),
        signal: AbortSignal.timeout(300_000),
    }).catch(error => {
        console.error('[Submit] Worker request failed:', error);
    });

    return { status: 'submitted', jobId };
}
```

- [ ] **Step 2: `src/application/market/pollAnalysis.ts` 생성**

```typescript
import { enrichAnalysisWithConfidence } from '@/domain/analysis/confidence';
import { postProcessAnalysisWithReconcile } from '@/domain/analysis/ai-levels';
import type {
    PollAnalysisResult,
    RawAnalysisResponse,
    Skill,
} from '@/domain/types';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    buildAnalysisCacheKey,
    computeEffectiveTtl,
} from '@/infrastructure/cache/config';
import {
    cleanupJob,
    getJobError,
    getJobMeta,
    getJobResult,
    getJobStatus,
} from '@/infrastructure/jobs/queue';
import { FileSkillsLoader } from '@/infrastructure/skills/loader';

export async function pollAnalysis(jobId: string): Promise<PollAnalysisResult> {
    const status = await getJobStatus(jobId);

    if (status === null || status === 'processing') {
        return { status: 'processing' };
    }

    if (status === 'error') {
        const error = await getJobError(jobId);
        cleanupJob(jobId).catch(e =>
            console.warn('[Poll] cleanupJob failed:', e)
        );
        return { status: 'error', error: error ?? 'Unknown error' };
    }

    // status === 'done'
    const [rawResult, meta] = await Promise.all([
        getJobResult(jobId),
        getJobMeta(jobId),
    ]);

    if (!rawResult) {
        console.error('[Poll] Result not found', {
            jobId,
            rawResultType: typeof rawResult,
            rawResultValue: rawResult,
            hasMeta: meta !== null,
            symbol: meta?.symbol,
            timeframe: meta?.timeframe,
        });
        cleanupJob(jobId).catch(e =>
            console.warn('[Poll] cleanupJob failed:', e)
        );
        return { status: 'error', error: 'Result not found' };
    }

    // submitAnalysis가 JSON.stringify(RawAnalysisResponse)로 저장하고
    // getJobResult가 JSON.parse 후 반환하므로, 구조가 RawAnalysisResponse와 일치한다고 보장된다.
    const parsed = rawResult as RawAnalysisResponse;
    if (!parsed.summary || !parsed.trend || !parsed.riskLevel) {
        cleanupJob(jobId).catch(e =>
            console.warn('[Poll] cleanupJob failed:', e)
        );
        return { status: 'error', error: 'Invalid response from worker' };
    }

    const skillsLoader = new FileSkillsLoader();
    let skills: Skill[] = [];
    try {
        skills = await skillsLoader.loadSkills();
    } catch (error) {
        console.error(
            '[Poll] Skills loading failed, proceeding without skills:',
            error
        );
    }
    const skillsDegraded = meta?.skillsDegraded ?? false;

    const enriched = enrichAnalysisWithConfidence(parsed, skills);

    const reconciled = postProcessAnalysisWithReconcile(
        enriched,
        meta?.lastClose,
        meta?.atr
    );

    const now = new Date();
    const analyzedAt = now.toISOString();
    const result = { ...reconciled, analyzedAt };

    if (meta) {
        const cache = createCacheProvider();
        if (cache !== null) {
            const cacheKey = buildAnalysisCacheKey(meta.symbol, meta.timeframe);
            const ttl = computeEffectiveTtl(meta.timeframe, now);
            cache
                .set(cacheKey, { ...result, skillsDegraded }, ttl)
                .catch(error =>
                    console.error('[Poll] Cache write failed:', error)
                );
        }
    }

    cleanupJob(jobId).catch(e => console.warn('[Poll] cleanupJob failed:', e));

    return { status: 'done', result };
}
```

- [ ] **Step 3: `src/application/market/cancelAnalysisJob.ts` 생성**

```typescript
import { cancelJob } from '@/infrastructure/jobs/queue';
import { tryReadWorkerConfig } from '@/infrastructure/market/config';

export async function cancelAnalysisJob(jobId: string): Promise<void> {
    const workerConfig = tryReadWorkerConfig();

    const tasks: Promise<unknown>[] = [cancelJob(jobId)];

    // 워커가 설정된 경우 /cancel 엔드포인트에도 신호를 보내 진행 중인 AI 호출을 즉시 중단한다.
    // AbortSignal.timeout으로 5초 제한 — 취소 요청이 클라이언트 흐름을 오래 잡지 않도록 한다.
    if (workerConfig !== null) {
        tasks.push(
            fetch(`${workerConfig.workerUrl}/cancel`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Worker-Secret': workerConfig.workerSecret,
                },
                body: JSON.stringify({ jobId }),
                signal: AbortSignal.timeout(5000),
            })
        );
    }

    // 취소는 fire-and-forget — Redis 장애나 워커 에러 시 클라이언트 흐름을 막지 않는다.
    // HTTP 4xx/5xx도 무시한다 — 워커 작업은 TTL 만료 후 자연 정리된다.
    const results = await Promise.allSettled(tasks);
    results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .forEach(r =>
            console.warn(
                '[cancelAnalysisJob] Failed to signal cancellation:',
                jobId,
                r.reason
            )
        );
}
```

- [ ] **Step 4: `src/application/market/submitBriefing.ts` 생성**

```typescript
import { buildMarketBriefingPrompt } from '@/domain/analysis/marketBriefingPrompt';
import type { MarketSummaryData, SubmitBriefingResult } from '@/domain/types';
import { normalizeMarketBriefing } from '@/domain/analysis/normalizeMarketBriefing';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    buildBriefingCacheKey,
    ISO_DATE_HOUR_PREFIX_LENGTH,
} from '@/infrastructure/cache/config';
import { readWorkerConfig } from '@/infrastructure/market/config';

export async function submitBriefing(
    data: MarketSummaryData
): Promise<SubmitBriefingResult> {
    const { workerUrl, workerSecret } = readWorkerConfig();

    const now = new Date();
    const dateHour = now.toISOString().slice(0, ISO_DATE_HOUR_PREFIX_LENGTH);
    const cacheKey = buildBriefingCacheKey(dateHour);

    const cache = createCacheProvider();
    if (cache !== null) {
        try {
            const cached = await cache.get<{
                briefing: unknown;
                generatedAt: string;
            }>(cacheKey);
            if (cached !== null) {
                return {
                    status: 'cached',
                    briefing: normalizeMarketBriefing(cached.briefing),
                    generatedAt: cached.generatedAt,
                };
            }
        } catch (error) {
            console.error('[Briefing/Submit] Cache read failed:', error);
        }
    }

    const prompt = buildMarketBriefingPrompt(data.indices, data.sectors);
    const jobId = crypto.randomUUID();

    // fire-and-forget: 에러는 무시하고 caller에게 jobId만 반환한다.
    fetch(`${workerUrl}/briefing`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Worker-Secret': workerSecret,
        },
        body: JSON.stringify({ jobId, prompt }),
        signal: AbortSignal.timeout(10_000),
    }).catch(error => {
        console.error('[Briefing/Submit] Worker request failed:', error);
    });

    return { status: 'submitted', jobId };
}
```

- [ ] **Step 5: `src/application/market/pollBriefing.ts` 생성**

```typescript
import type {
    MarketBriefingResponse,
    PollBriefingResult,
} from '@/domain/types';
import { normalizeMarketBriefing } from '@/domain/analysis/normalizeMarketBriefing';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    buildBriefingCacheKey,
    ISO_DATE_HOUR_PREFIX_LENGTH,
    MARKET_BRIEFING_CACHE_TTL,
} from '@/infrastructure/cache/config';
import {
    cleanupJob,
    getJobError,
    getJobResult,
    getJobStatus,
} from '@/infrastructure/jobs/queue';

export async function pollBriefing(jobId: string): Promise<PollBriefingResult> {
    const status = await getJobStatus(jobId);

    if (status === null || status === 'processing') {
        return { status: 'processing' };
    }

    if (status === 'error') {
        const error = await getJobError(jobId);
        cleanupJob(jobId).catch(e =>
            console.warn('[Briefing/Poll] cleanupJob failed:', e)
        );
        return { status: 'error', error: error ?? 'Unknown error' };
    }

    // status === 'done'
    const raw = await getJobResult(jobId);
    if (!raw) {
        cleanupJob(jobId).catch(e =>
            console.warn('[Briefing/Poll] cleanupJob failed:', e)
        );
        return { status: 'error', error: 'Result not found' };
    }

    const briefing: MarketBriefingResponse = normalizeMarketBriefing(raw);

    if (!briefing.summary) {
        cleanupJob(jobId).catch(e =>
            console.warn('[Briefing/Poll] cleanupJob failed:', e)
        );
        return { status: 'error', error: 'Invalid briefing result' };
    }

    const now = new Date();
    const generatedAt = now.toISOString();
    const dateHour = generatedAt.slice(0, ISO_DATE_HOUR_PREFIX_LENGTH);
    const cacheKey = buildBriefingCacheKey(dateHour);
    const cache = createCacheProvider();
    if (cache !== null) {
        cache
            .set(cacheKey, { briefing, generatedAt }, MARKET_BRIEFING_CACHE_TTL)
            .catch(err =>
                console.error('[Briefing/Poll] Cache write failed:', err)
            );
    }

    cleanupJob(jobId).catch(e =>
        console.warn('[Briefing/Poll] cleanupJob failed:', e)
    );
    return { status: 'done', briefing, generatedAt };
}
```

- [ ] **Step 6: 구 infrastructure 소스 파일 5개 삭제**

```bash
rm src/infrastructure/market/submitAnalysis.ts
rm src/infrastructure/market/pollAnalysis.ts
rm src/infrastructure/market/cancelAnalysisJob.ts
rm src/infrastructure/market/submitBriefing.ts
rm src/infrastructure/market/pollBriefing.ts
```

- [ ] **Step 7: typecheck 통과 확인**

```bash
yarn typecheck
```

Expected: 에러 없음 (index.ts가 아직 구 경로를 참조하므로 이 시점에는 에러 발생 — Task 3에서 수정)

---

## Task 2: 테스트 파일 이동

**Files:**
- Create: `src/__tests__/application/market/submitAnalysis.test.ts`
- Create: `src/__tests__/application/market/pollAnalysis.test.ts`
- Create: `src/__tests__/application/market/cancelAnalysisJob.test.ts`
- Create: `src/__tests__/application/market/submitBriefing.test.ts`
- Create: `src/__tests__/application/market/pollBriefing.test.ts`
- Delete: `src/__tests__/infrastructure/market/submitAnalysis.test.ts`
- Delete: `src/__tests__/infrastructure/market/pollAnalysis.test.ts`
- Delete: `src/__tests__/infrastructure/market/cancelAnalysisJob.test.ts`
- Delete: `src/__tests__/infrastructure/market/submitBriefing.test.ts`
- Delete: `src/__tests__/infrastructure/market/pollBriefing.test.ts`

- [ ] **Step 1: 테스트 파일 이동 (import 경로 수정 포함)**

각 테스트 파일을 새 위치로 복사하고, 테스트 대상 모듈의 import 경로만 변경한다.
`vi.mock(...)` 경로는 여전히 `@/infrastructure/*`를 가리키므로 변경하지 않는다.

`submitAnalysis.test.ts`에서 변경할 줄:
```typescript
// 변경 전
import { submitAnalysis } from '@/infrastructure/market/submitAnalysis';
// 변경 후
import { submitAnalysis } from '@/application/market/submitAnalysis';
```

`pollAnalysis.test.ts`에서 변경할 줄:
```typescript
// 변경 전
import { pollAnalysis } from '@/infrastructure/market/pollAnalysis';
// 변경 후
import { pollAnalysis } from '@/application/market/pollAnalysis';
```

`cancelAnalysisJob.test.ts`에서 변경할 줄:
```typescript
// 변경 전
import { cancelAnalysisJob } from '@/infrastructure/market/cancelAnalysisJob';
// 변경 후
import { cancelAnalysisJob } from '@/application/market/cancelAnalysisJob';
```

`submitBriefing.test.ts`에서 변경할 줄:
```typescript
// 변경 전
import { submitBriefing } from '@/infrastructure/market/submitBriefing';
// 변경 후
import { submitBriefing } from '@/application/market/submitBriefing';
```

`pollBriefing.test.ts`에서 변경할 줄:
```typescript
// 변경 전
import { pollBriefing } from '@/infrastructure/market/pollBriefing';
// 변경 후
import { pollBriefing } from '@/application/market/pollBriefing';
```

- [ ] **Step 2: 구 테스트 파일 5개 삭제**

```bash
rm src/__tests__/infrastructure/market/submitAnalysis.test.ts
rm src/__tests__/infrastructure/market/pollAnalysis.test.ts
rm src/__tests__/infrastructure/market/cancelAnalysisJob.test.ts
rm src/__tests__/infrastructure/market/submitBriefing.test.ts
rm src/__tests__/infrastructure/market/pollBriefing.test.ts
```

- [ ] **Step 3: 테스트 전체 실행**

```bash
yarn test --run
```

Expected: 모든 테스트 통과 (Task 3 전이라도 테스트는 `@/application/*` 경로로 직접 import하므로 통과해야 함)

---

## Task 3: src/index.ts re-export 경로 업데이트

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: 5개 export 경로 수정**

```typescript
// 변경 전
export { submitAnalysis } from './infrastructure/market/submitAnalysis';
export { pollAnalysis } from './infrastructure/market/pollAnalysis';
export { cancelAnalysisJob } from './infrastructure/market/cancelAnalysisJob';
export { submitBriefing } from './infrastructure/market/submitBriefing';
export { pollBriefing } from './infrastructure/market/pollBriefing';

// 변경 후
export { submitAnalysis } from './application/market/submitAnalysis';
export { pollAnalysis } from './application/market/pollAnalysis';
export { cancelAnalysisJob } from './application/market/cancelAnalysisJob';
export { submitBriefing } from './application/market/submitBriefing';
export { pollBriefing } from './application/market/pollBriefing';
```

- [ ] **Step 2: typecheck + build 확인**

```bash
yarn typecheck && yarn build 2>&1 | tail -20
```

Expected: 에러 없음, `dist/` 생성 완료

- [ ] **Step 3: 전체 테스트 재확인**

```bash
yarn test --run
```

Expected: 전체 통과

- [ ] **Step 4: 커밋**

```bash
git add src/application/ src/__tests__/application/ src/index.ts
git rm src/infrastructure/market/submitAnalysis.ts src/infrastructure/market/pollAnalysis.ts src/infrastructure/market/cancelAnalysisJob.ts src/infrastructure/market/submitBriefing.ts src/infrastructure/market/pollBriefing.ts
git rm src/__tests__/infrastructure/market/submitAnalysis.test.ts src/__tests__/infrastructure/market/pollAnalysis.test.ts src/__tests__/infrastructure/market/cancelAnalysisJob.test.ts src/__tests__/infrastructure/market/submitBriefing.test.ts src/__tests__/infrastructure/market/pollBriefing.test.ts
git commit -m "feat: add application layer — move orchestration functions from infrastructure/market"
```

---

## Task 4: ESLint 레이어 경계 규칙 추가

**Files:**
- Modify: `eslint.config.mjs`

레이어 위반 시 ESLint 에러가 발생하도록 `no-restricted-imports` 규칙을 추가한다.

- [ ] **Step 1: `eslint.config.mjs` 수정**

```typescript
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'coverage/**',
            '.yarn/**',
            '.pnp.*',
            '.claude/**',
            '.gemini/**',
            '.husky/**',
            '.vscode/**',
            '*.tsbuildinfo',
            '.agents/**',
        ],
    },
    ...tseslint.configs.recommended,
    {
        files: ['**/*.ts'],
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                    destructuredArrayIgnorePattern: '^_',
                },
            ],
        },
    },
    // domain은 infrastructure, application을 import할 수 없다
    {
        files: ['src/domain/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: ['@/infrastructure/*', '@/application/*'],
                },
            ],
        },
    },
    // infrastructure는 application을 import할 수 없다
    {
        files: ['src/infrastructure/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: ['@/application/*'],
                },
            ],
        },
    }
);
```

- [ ] **Step 2: lint 통과 확인**

```bash
yarn lint
```

Expected: 에러 없음

- [ ] **Step 3: 위반 시 에러 발생 확인 (선택적 smoke test)**

`src/infrastructure/market/barsApi.ts` 상단에 임시로 다음 줄을 추가하고 lint를 실행한다:
```typescript
import {} from '@/application/market/submitAnalysis'; // 임시 테스트용
```

```bash
yarn lint 2>&1 | grep "no-restricted-imports"
```

Expected: `error  '@/application/market/submitAnalysis' import is restricted` 출력 확인 후 해당 줄 제거.

- [ ] **Step 4: 커밋**

```bash
git add eslint.config.mjs
git commit -m "feat: enforce application layer boundary via ESLint no-restricted-imports"
```

---

## Task 5: ARCHITECTURE.md 업데이트

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: 레이어 다이어그램 업데이트**

`docs/ARCHITECTURE.md`의 레이어 구조 섹션을 다음으로 교체한다:

```
## 레이어 구조

┌─────────────────────────────────────────┐
│         application (오케스트레이션)     │  여러 infrastructure를 조합하는
│           market/, …                   │  use-case 단위 함수
├─────────────────────────────────────────┤
│          infrastructure (외부)          │  AI Provider, Skills Loader,
│                                         │  Upstash Redis, Neon DB,
│                                         │  Market Data Providers
├─────────────────────────────────────────┤
│             domain (순수)              │  인디케이터, 캔들 패턴,
│                                         │  차트 패턴, 분석 프롬프트
└─────────────────────────────────────────┘
                    │
                    ▼
              src/index.ts
         (public entry of the package)
```

- [ ] **Step 2: 의존성 방향 규칙 섹션에 application 추가**

기존 `domain`, `infrastructure` 설명 아래에 추가:

```
application    ← domain, infrastructure import 가능
                 여러 infrastructure 모듈을 조합해 use-case를 완성
                 domain, infrastructure에서 application import 금지 (ESLint 강제)
                 현재: market/ (submitAnalysis, pollAnalysis, cancelAnalysisJob,
                                submitBriefing, pollBriefing)
```

- [ ] **Step 3: 폴더 구조 섹션에 application 추가**

```
src
├── __tests__
│   ├── application
│   │   └── market
│   ├── domain
│   └── infrastructure
├── application
│   └── market
├── domain
│   ├── analysis
│   ├── constants
│   ├── indicators
│   └── signals
├── infrastructure
│   ├── ai
│   ├── cache
│   ├── db
│   ├── jobs
│   ├── market
│   └── skills
└── index.ts
```

- [ ] **Step 4: 커밋**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: update ARCHITECTURE.md with application layer"
```
