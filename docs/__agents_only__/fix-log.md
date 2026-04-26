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

## [PR #26 Round 5 | feat/18/infrastructure-market-이전 | 2026-04-26]
- Violation: `CachedBriefingData` 인터페이스가 `domain/types.ts`에 선언되어 있으나 `briefing: unknown` 필드가 보여주듯 캐시 직렬화 전용 infrastructure 구조체
- Rule: 레이어 분리 원칙 — infrastructure 관심사 타입은 `infrastructure/cache/types.ts`에 위치해야 하며 도메인 레이어에 노출되면 안 됨
- Context: `domain/types.ts`에서 제거하고 `infrastructure/cache/types.ts`로 이동; `application/market/submitBriefing.ts` import 경로 업데이트

## [Issue #3 | feat/3/neon-drizzle-db-schema | 2026-04-26]
- Violation: `users.email` had both a unique constraint and a duplicate non-unique index
- Rule: Schema design — avoid duplicate indexes that add storage/write overhead without a new lookup path
- Context: Drizzle `.unique()` already creates a PostgreSQL index for email lookup; removed the extra `users_email_idx`

## [PR #32 Round 3 | feat/3/neon-drizzle-db-schema | 2026-04-27]
- Violation: `assetTranslations` used table-level `primaryKey({ columns: [...] })` while `koreanTickers` used inline `.primaryKey()` for the same single-column PK pattern
- Rule: MISTAKES.md Coding Paradigm #6.5 — state/code divergence; same pattern in the same module must use a consistent approach
- Context: Unified to inline `.primaryKey()` for both tables; removed `primaryKey` import from `drizzle-orm/pg-core`

## [PR #32 Round 2 | feat/3/neon-drizzle-db-schema | 2026-04-27]
- Violation: `schema.test.ts` index test omitted `koreanTickers` from the multi-table index assertion block
- Rule: Test coverage must be complete for all tables asserted in the same test — partial table coverage creates silent gaps
- Context: `'defines table indexes for lookup paths'` test verified indexes for `users`, `sessions`, `usageLogs`, `oauthAccounts`, `assetTranslations` but skipped `koreanTickers`; added `expect(getTableConfig(koreanTickers).indexes).toEqual([])`

## [PR #32 | feat/3/neon-drizzle-db-schema | 2026-04-27]
- Violation: `@neondatabase/serverless` and `drizzle-orm` were added to `dependencies`, forcing DB packages onto consumers that do not use DB features
- Rule: npm library dependency pattern — optional runtime integrations belong in `peerDependencies` with `optional: true`, and in `devDependencies` for local tests/builds
- Context: Moved Neon and Drizzle packages to optional peer dependencies plus dev dependencies and removed the production `dependencies` block

- Violation: Drizzle migration metadata was not regenerated after changing `assetTranslations.symbol` from table-level primary key metadata to inline primary key metadata
- Rule: Generated migration state must stay synchronized with schema changes to avoid future false-positive migrations
- Context: Updated the initial migration and snapshot to match `schema.ts`, then verified `yarn db:generate` reports no schema changes
