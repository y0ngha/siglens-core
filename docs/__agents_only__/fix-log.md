# Fix Log

## [Issue #2 | chore/2/초기-개발-환경-설정 | 2026-04-24]
- Violation: release-it config used `${version}` (JS template literal) instead of `{{version}}` (Handlebars) for commitMessage, tagName, tagAnnotation
- Rule: release-it interpolation uses `{{version}}` syntax — `${version}` is passed as a literal string and breaks tag push trigger matching
- Context: .release-it.json initially written with ES template literal style; corrected to Handlebars style across all three fields

- Violation: npm publish used instead of yarn npm publish in GitHub Actions workflow
- Rule: CLAUDE.md — yarn must be used for all package operations; npm is prohibited
- Context: publish.yml initially used `npm publish` and NODE_AUTH_TOKEN; corrected to `yarn npm publish` with YARN_NPM_AUTH_TOKEN and added npmScopes config to .yarnrc.yml for yarn 4 registry routing


## [PR #23 Round 2 | feat/1/서버-코드-분리-핵심-로직-npm-패키지 | 2026-04-25]
- Violation: `[...arr].reverse().find()` used instead of `findLast` in `lastNonNull` helper in `prompt.ts`
- Rule: Consistency with ES2023 APIs already used in the same PR — `candle-detection.ts` already uses `findLast`; `tsconfig.json` targets ES2023
- Context: `lastNonNull` helper copied an array and reversed it just to find the last non-null value; `findLast` avoids the O(n) array copy entirely

## [PR #23 Round 5 | feat/1/서버-코드-분리-핵심-로직-npm-패키지 | 2026-04-25]
- Violation: `countSqueezeDuration`에서 종료 조건이 수렴 predicate인데 `for` 루프 사용
- Rule: CONVENTIONS.md — 루프 조건이 카운터가 아닌 수렴 predicate일 때 `while` 사용
- Context: `prompt.ts`의 `countSqueezeDuration`은 뒤에서부터 `sqzOn === true`가 끊기는 지점을 찾는 수렴 탐색; `while` 루프로 교체

- Violation: DOMAIN.md의 `Timeframe` 타입 및 관련 명세가 실제 코드와 불일치
- Rule: MISTAKES.md Documentation Sync #2 — 구현 변경 시 docs 동기화 필수
- Context: 코드의 `Timeframe = '5Min' | '15Min' | '30Min' | '1Hour' | '4Hour' | '1Day'`인데 DOMAIN.md는 `'1Min' | '5Min' | '15Min' | '1Hour' | '1Day'`로 표기; TIMEFRAMES 상수, EMA 테이블, 인디케이터 설정표, 봉 개수 기준 모두 동기화

## [PR #24 Round 3 | feat/17/infrastructure-cache-jobs-ai-이전 | 2026-04-25]
- Violation: `parseNumberEnv` 함수명이 "env var 파싱"을 시사해 domain/에서 환경변수를 다루는 듯한 인상을 줌
- Rule: CONVENTIONS.md — 함수 이름은 실제 동작을 정확히 반영해야 함; `parseNumberEnv`는 raw string을 받는 순수 함수이며 env var에 의존하지 않음
- Context: `domain/utils.ts`의 `parseNumberEnv`를 `parseNumberOrDefault`로 이름 변경

## [PR #24 Round 2 | feat/17/infrastructure-cache-jobs-ai-이전 | 2026-04-25]
- Violation: `queue.ts`에 `setJobStatus`, `setJobResult`, `setJobError` 함수 누락
- Rule: API 대칭성 — `getJobStatus`/`getJobResult`/`getJobError`가 있으면 대응하는 set 함수도 있어야 함
- Context: `queue.ts`에 3개 write 함수 추가; 각각 `job:{id}:status/result/error` 키에 TTL 1시간으로 저장

- Violation: `@google/genai`, `@upstash/redis`가 `dependencies`에 포함되어 소비자 프로젝트에 강제 설치
- Rule: npm 라이브러리 패턴 — 선택적 런타임 의존성은 `peerDependencies`(optional) + `devDependencies`로 분리
- Context: `package.json`에서 두 패키지를 `peerDependencies`(optional: true) 및 `devDependencies`로 이동

## [PR #24 Round 5 | feat/17/infrastructure-cache-jobs-ai-이전 | 2026-04-25]
- Violation: `GeminiContents` 타입에 `{ role: string; parts: Array<{ text: string }> }` 중첩 익명 객체 타입 인라인 정의
- Rule: MISTAKES.md TypeScript #5 — 반복되거나 재사용 가능한 타입 패턴은 named type alias로 추출
- Context: `infrastructure/ai/types.ts`에서 `GeminiPart`, `GeminiContent` named interface로 추출

## [PR #26 | feat/18/infrastructure-market-이전 | 2026-04-26]

- Violation: `AcquireReanalyzeCooldownResult` 타입이 `reanalyzeCooldown.ts` 구현 파일 내부에만 정의됨
- Rule: MISTAKES.md Architecture #4 — infrastructure 모듈의 public interface는 `types.ts`에 위치해야 함
- Context: `infrastructure/market/types.ts`로 이동하고 구현 파일에서 import하도록 수정

- Violation: 함수/파일 이름이 `submitAnalysisAction`, `pollAnalysisAction` 등 Next.js 서버 액션 네이밍을 유지
- Rule: MISTAKES.md Coding Paradigm #9 — 아키텍처 변경 후 이름이 정확하지 않으면 업데이트
- Context: Next.js 'use server' 액션에서 일반 infrastructure 함수로 전환되었으나 Action suffix가 남아 있어 misleading

## [PR #26 Round 2 | feat/18/infrastructure-market-이전 | 2026-04-26]
- Violation: `submitAnalysis.ts`와 `pollAnalysis.ts`에서 `Awaited<ReturnType<typeof skillsLoader.loadSkills>>` 복잡한 유틸리티 타입 추론 사용
- Rule: 직접 임포트 가능한 구체 타입이 있을 때 복잡한 `Awaited<ReturnType<...>>` 체인 대신 해당 타입을 명시적으로 사용
- Context: `SkillsProvider.loadSkills()`의 반환 타입은 `Promise<Skill[]>`이므로 `Awaited<...>`는 `Skill[]`; `Skill` 타입을 직접 import해 사용하면 더 명확하고 인터페이스 타입과도 일치

## [PR #26 Round 3 | feat/18/infrastructure-market-이전 | 2026-04-26]
- Violation: `reanalyzeCooldown.ts`의 `getRedis()`가 호출마다 `new Redis(...)` 인스턴스 생성
- Rule: MISTAKES.md Design #2 — 동일 외부 자원에 대한 클라이언트는 모듈 스코프 싱글턴으로 관리
- Context: config key 기반 싱글턴으로 전환; config 미설정 시 null 반환, config 동일 시 캐시된 인스턴스 반환

## [PR #26 Round 5 | feat/18/infrastructure-market-이전 | 2026-04-26]
- Violation: `CachedBriefingData` 인터페이스가 `domain/types.ts`에 선언되어 있으나 `briefing: unknown` 필드가 보여주듯 캐시 직렬화 전용 infrastructure 구조체
- Rule: 레이어 분리 원칙 — infrastructure 관심사 타입은 `infrastructure/cache/types.ts`에 위치해야 하며 도메인 레이어에 노출되면 안 됨
- Context: `domain/types.ts`에서 제거하고 `infrastructure/cache/types.ts`로 이동; `application/market/submitBriefing.ts` import 경로 업데이트

## [PR #26 Round 4 | feat/18/infrastructure-market-이전 | 2026-04-26]
- Violation: `submitAnalysis.ts`, `submitBriefing.ts`에서 `readWorkerConfig()`를 캐시 조회 전에 호출
- Rule: CONVENTIONS.md — Graceful degradation; missing env vars must not crash the library when an alternative path exists
- Context: WORKER_URL 미설정 환경에서도 캐시에 유효한 데이터가 있으면 반환 가능한데, readWorkerConfig()가 캐시 체크 앞에 있어 항상 throw됐음; readWorkerConfig() 호출을 캐시 미스 이후로 이동

## [Issue #3 | feat/3/neon-drizzle-db-schema | 2026-04-26]
- Violation: `tryGetDatabaseClient()` created a new Neon/Drizzle client on each optional call
- Rule: docs/API.md — DB connections must be reused at module level; avoid per-call connection creation
- Context: Optional DB client path bypassed `cachedClient`; corrected to share the same module-level cache as `getDatabaseClient()`

- Violation: `users.email` had both a unique constraint and a duplicate non-unique index
- Rule: Schema design — avoid duplicate indexes that add storage/write overhead without a new lookup path
- Context: Drizzle `.unique()` already creates a PostgreSQL index for email lookup; removed the extra `users_email_idx`

## [Issue #5 Round 1 | feat/5/email-signup | 2026-04-26]
- Violation: Email signup orchestration was implemented under `infrastructure/auth`
- Rule: docs/ARCHITECTURE.md — use-case orchestration that coordinates validation, hashing, lookup, and persistence belongs in `application/`
- Context: Moved `registerUser` and its request/result types to `application/auth`; kept DB repository and external dependency interfaces under `infrastructure/auth`

## [Issue #5 Round 2 | feat/5/email-signup | 2026-04-26]
- Violation: `infrastructure/auth/types.ts` imported `UserTier` from `infrastructure/db/types`
- Rule: docs/ARCHITECTURE.md — infrastructure submodules should not depend on each other; keep external-system boundaries independent
- Context: Replaced the cross-module type import with an auth-local `AuthUserTier` union and a sync note pointing to the DB enum source
