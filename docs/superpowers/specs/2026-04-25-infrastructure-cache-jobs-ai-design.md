# Design: infrastructure/cache + jobs + ai 이전 (Issue #17)

**Date:** 2026-04-25
**Status:** Approved

---

## Overview

`siglens` 레포에서 운영 중인 기반 인프라(cache, jobs, ai)를 `siglens-core` 순수 TypeScript 라이브러리로 이전한다.
이전 후에도 일부 함수는 siglens에서 아직 사용될 수 있으므로, siglens 측 원본 파일에 "이후 이슈에서 제거 예정" 주석을 달도록 별도 이슈를 생성한다.

---

## Files to Create

### `src/domain/constants/time.ts`
시간 단위 상수. 순수 값만 포함 — 외부 의존성 없음.

```
KST_OFFSET_HOURS = 9
MS_PER_SECOND = 1_000
MS_PER_MINUTE = 60_000
MS_PER_HOUR = 3_600_000
MS_PER_DAY = 86_400_000
SECONDS_PER_MINUTE = 60
SECONDS_PER_HOUR = 3_600
SECONDS_PER_DAY = 86_400
SECONDS_PER_YEAR = 31_536_000
```

### `src/infrastructure/cache/types.ts`
`CacheProvider` 인터페이스 — `get<T>`, `set`, `del`, `keys` 메서드.

### `src/infrastructure/cache/config.ts`
캐시 TTL 상수, 캐시 키 빌더, `computeSecondsUntilCacheExpiry`, `computeEffectiveTtl`.

Ticker/Asset/Briefing 관련 함수는 아직 siglens-core에서 직접 사용되지 않지만,
향후 이슈에서 ticker 검색·자산 정보 조회 기능 이전 시 사용될 예정 — 주석으로 명시.

### `src/infrastructure/cache/redis.ts`
`createCacheProvider(): CacheProvider | null` — env vars 없으면 null 반환.
`@upstash/redis` 의존.

### `src/infrastructure/jobs/types.ts`
`JobStatus` union type, `JobMeta` interface.

### `src/infrastructure/jobs/redis.ts`
`createJobRedis(): Redis | null` — env vars 없으면 null 반환.

### `src/infrastructure/jobs/queue.ts`
job lifecycle 함수 8개 (`enqueueJob`, `getJobMeta`, `setJobProcessing`, `setJobDone`, `setJobFailed`, `isJobEnqueued`, `getJobResult`, `deleteJob`).

### `src/infrastructure/ai/utils.ts`
`AI_SYSTEM_PROMPT`, `parseNumberEnv`, `stripMarkdownCodeBlock`, `parseJsonResponse<T>`.

### `src/infrastructure/ai/gemini.ts`
`callGeminiWithKeyFallback` — free key 우선, 실패 시 paid key로 fallback.
`@google/genai` 의존.

---

## Architecture

```
domain/constants/time.ts
    ↑
infrastructure/cache/config.ts   (imports time constants)
infrastructure/cache/redis.ts    (imports @upstash/redis, CacheProvider)
infrastructure/jobs/queue.ts     (imports time constants for TTL)
infrastructure/jobs/redis.ts     (imports @upstash/redis)
infrastructure/ai/utils.ts       (no imports)
infrastructure/ai/gemini.ts      (imports @google/genai, parseJsonResponse)
```

Layer rule: `domain/` ← no external imports. `infrastructure/` ← domain only + external packages.

---

## New Dependencies

```json
"@upstash/redis": "^1.x"
"@google/genai": "^1.x"
```

Both added as regular `dependencies` (runtime, not devDependencies).

---

## Testing Strategy

- **100% branch coverage** required (vitest.config.ts threshold enforced)
- `vi.mock('@upstash/redis')`, `vi.mock('@google/genai')` for external packages
- All env var branches (present / missing) tested
- `computeSecondsUntilCacheExpiry`: before/after KST 17:00 branches + boundary
- `computeEffectiveTtl`: TTL < expiry and TTL > expiry branches
- `callGeminiWithKeyFallback`: success on free key, fallback to paid key, both fail

---

## Scope Notes

- `src/index.ts` — no new public exports added (infrastructure internals, not API surface)
- `docs/API.md` — env var table updated with new vars (`GEMINI_FREE_API_KEY`, job Redis vars)
- After implementation: create GitHub issue in `y0ngha/siglens` for cleanup of migrated files
