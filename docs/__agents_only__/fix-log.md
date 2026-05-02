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

## [PR #24 Round 2 | feat/17/infrastructure-cache-jobs-ai-이전 | 2026-04-25]
- Violation: `queue.ts`에 `setJobStatus`, `setJobResult`, `setJobError` 함수 누락
- Rule: API 대칭성 — `getJobStatus`/`getJobResult`/`getJobError`가 있으면 대응하는 set 함수도 있어야 함
- Context: `queue.ts`에 3개 write 함수 추가; 각각 `job:{id}:status/result/error` 키에 TTL 1시간으로 저장

## [Issue #3 | feat/3/neon-drizzle-db-schema | 2026-04-26]
- Violation: `users.email` had both a unique constraint and a duplicate non-unique index
- Rule: Schema design — avoid duplicate indexes that add storage/write overhead without a new lookup path
- Context: Drizzle `.unique()` already creates a PostgreSQL index for email lookup; removed the extra `users_email_idx`

## [Issue #8 | feat/8/user-tier-system | 2026-04-27]
- Violation: `calculateIchimokuFutureCloud` allowed negative/out-of-range source indexes to produce NaN instead of null
- Rule: Domain indicator warm-up and unavailable values must return null, never NaN
- Context: Short non-empty Ichimoku inputs now keep future cloud values null when the source window is unavailable

## [PR #32 | feat/3/neon-drizzle-db-schema | 2026-04-27]
- Violation: Drizzle migration metadata was not regenerated after changing `assetTranslations.symbol` from table-level primary key metadata to inline primary key metadata
- Rule: Generated migration state must stay synchronized with schema changes to avoid future false-positive migrations
- Context: Updated the initial migration and snapshot to match `schema.ts`, then verified `yarn db:generate` reports no schema changes

## [PR #34 | feat/6/email-login | 2026-04-27]
- Violation: `omitPasswordHash` in `loginUser.ts` manually maps all `AuthUserRecord` fields instead of using destructuring with rest to omit `passwordHash`
- Rule: FF Readability/Predictability — manual field mapping silently drops new fields added to the interface; destructuring rest (`const { passwordHash: _passwordHash, ...safeUser } = user`) is more maintainable and prevents future field omission
- Context: Gemini review identified that if `AuthUserRecord` gains a new field, the manual mapping would silently exclude it from the returned record

## [PR #35 | feat/7/social-login | 2026-04-27]
- Violation: DB environment readers, cached singleton helpers, and raw `DatabaseClient` wrapper were exposed from the package entrypoint without a consumer-facing need
- Rule: PUBLIC_API.md — public API should expose stable consumer contracts and avoid leaking infrastructure lifecycle or adapter details
- Context: kept `createDatabaseClient` as the explicit DB construction entrypoint while removing `getDatabaseClient`, `tryGetDatabaseClient`, `readDatabaseConfig`, `tryReadDatabaseConfig`, and `DatabaseClient` from `src/index.ts`


## [PR #37 Round 2 | feat/8/user-tier-system | 2026-04-28]
- Violation: `application/tier/types.ts` imported `UserTierRepository` from the deep `@/infrastructure/db/types` path while sibling files import via the `@/infrastructure/db` module index
- Rule: FF Coupling — consumers should import from a module's public index, not its internal implementation files, so internal restructuring stays non-breaking
- Context: switched the `UserTierRepository` import in `application/tier/types.ts` to `@/infrastructure/db`

## [PR #39 | refactor/16/redis-to-db-migration | 2026-04-28]
- Violation: Drizzle `onConflictDoUpdate` set clauses referenced target table columns instead of inserted row values
- Rule: DB upsert semantics — conflict updates must use the `excluded` row when replacing existing values
- Context: `DrizzleKoreanTickerRepository.upsertMany` and `DrizzleAssetTranslationRepository.upsert` now update rows from `excluded.*` values instead of preserving existing column values

## [PR #39 | refactor/16/redis-to-db-migration | 2026-04-28]
- Violation: Redis cache update used read-modify-write merge after DB upsert, allowing concurrent writes to overwrite each other
- Rule: Cache consistency for DB-backed data — after authoritative DB writes, invalidate aggregate cache keys instead of merging stale cache snapshots
- Context: `setKoreanTickers` now deletes `korean:tickers` after successful DB upsert so the next read rebuilds cache from the database

## [Issue #10/#11 | feat/10-11/usage-limit-gates | 2026-04-29]
- Violation: Usage-limit failures returned only partial or string error data even though the feature introduced a structured `UsageLimitError` payload
- Rule: Issue completion criteria — limit-exceeded responses must be structured and consistent across analysis and chatbot gates
- Context: Preserved `code`, `message`, `feature`, and `tier` in public analysis/chatbot result types and return values

## [PR #49 | feat/10-11/usage-limit-gates | 2026-04-29]
- Violation: Application usage-limit tests did not directly cover all feature branches
- Rule: application/CLAUDE.md — application use-cases require 100% branch coverage
- Context: Added direct coverage for the analysis error builder branch and the chatbot restrictions-disabled branch

## [PR #49 | feat/10-11/usage-limit-gates | 2026-04-29]
- Violation: Internal Gemini helper accepted the public optional `paidApiKey` type even after the entrypoint had validated the key
- Rule: TypeScript type safety — internal helper signatures should represent narrowed invariants established by the caller instead of reintroducing optionality
- Context: `requestChatCompletion` returned `server_error` when `paidApiKey` was missing, but `requestGeminiChatCompletion` still typed the value as `string | undefined`, causing `CallGeminiWithKeyFallbackOptions.paidApiKey` assignment to fail typecheck

## [PR #45 Round 2 | feat/12/info-depth-filter | 2026-04-28]
- Violation: `lockedInfoDepth` and its helper return type exposed a mutable array type despite deriving from readonly tier configuration
- Rule: CONVENTIONS.md — Functional Programming / immutability
- Context: the filter result now exposes locked info-depth fragments as `readonly TierInfoDepth[]` to match the immutable tier config contract

## [PR #51 | feat/50/oauth-token-revocation | 2026-04-30]
- Violation: password reset requests used broad user lookup and included OAuth-only accounts
- Rule: Auth use-cases must target the credential type they operate on, not any account with a matching email
- Context: `requestPasswordReset` now depends on `EmailAuthUserRepository` and only issues reset tokens for users with an existing password hash

## [PR #49 Round 6 | feat/10-11/usage-limit-gates | 2026-04-30]
- Violation: Two sibling repository interfaces in the same test shared a single `vi.fn()` mock for their `recordUsage` method
- Rule: Test isolation — each repository stub must have an independent mock so `toHaveBeenCalledTimes` and `toHaveBeenCalledWith` assertions target exactly the correct dependency
- Context: `usageRepository.recordUsage` and `usageLogs.recordUsage` in `requestChatCompletion.test.ts` shared one `recordUsage` fn; calls from either stub incremented the same counter, potentially causing assertion interference when both stubs are provided to the function under test.

## [PR #65 | feat/60/AI-모델-티어-확대 | 2026-05-01]
- Violation: 테스트 설명에 PR 번호 참조 포함 (`'places PR #65 free-tier models correctly'`)
- Rule: CONVENTIONS.md JSDoc Don'ts — PR/이슈/콜사이트 참조를 테스트 설명에 포함하지 않음
- Context: `tier.test.ts`의 `isModelAllowed` 관련 3개 it() 설명이 PR #65를 직접 참조; 비즈니스 규칙 중심의 영속적 설명으로 교체

## [Issue #59 | feat/59/분석-캐시-키에-모델-식별자-포함 | 2026-05-01]
- Violation: Module-level `const` declaration placed inside the import block (between two `import` statements)
- Rule: FF 1-G (Readability) — all import statements must precede any declarations; interspersing const inside imports creates a viewpoint shift
- Context: `DEFAULT_ANALYSIS_MODEL_USED` constant was inserted after the first import in `pollAnalysis.ts`; moved to after all import statements

## [PR #65 Round 2 | feat/60/AI-모델-티어-확대 | 2026-05-01]
- Violation: `getAllowedModels`가 `enableTierRestrictions: true`일 때 결과를 정렬하지 않음
- Rule: MISTAKES.md Predictability #7 — Public helper return ordering must be stable; sort with toSorted() before returning
- Context: `tier.ts`의 `getAllowedModels`는 `enableTierRestrictions: false`일 때만 `.toSorted()`를 적용했으나, `true`일 때도 동일한 안정 순서를 보장해야 함

## [PR #68 | feat/58/llm-api-key-storage | 2026-05-01]
- Violation: `onConflictDoUpdate` SET 절에 `updatedAt` 누락
- Rule: Drizzle ORM `$onUpdateFn`은 `db.update().set()` 호출에만 자동 적용됨; `insert().onConflictDoUpdate()`의 conflict resolution SET 절에는 적용되지 않으므로 명시적으로 `updatedAt: sql\`now()\``을 포함해야 함
- Context: `src/infrastructure/db/userApiKeyRepository.ts` `upsert` 메서드의 conflict 경로에서 기존 키 교체 시 `updated_at` 컬럼이 갱신되지 않는 버그

## [PR #65 Round 6 | feat/60/AI-모델-티어-확대 | 2026-05-02]
- Violation: 폴백 경로 호환성 테스트가 호출 사실만 검증하고 새 필드명(`primaryApiKey`/`fallbackApiKey`)이 실제로 전달되는지 검증하지 않음
- Rule: deprecated alias 폴백 테스트는 단순 호출 검증을 넘어 새 인터페이스의 전달값까지 단언해야 회귀를 잡음
- Context: `requestChatCompletion.test.ts`의 `falls back to deprecated callGemini` 케이스에 `expect.objectContaining({ primaryApiKey, fallbackApiKey, model })` 단언 추가

## [PR #70 | refactor/scope-realignment-phase-0 | 2026-05-02]
- Violation: orphaned `types.ts` 파일이 ejection 후에도 `infrastructure/email/`, `infrastructure/oauth/` 디렉토리에 남아 있음
- Rule: FF — Cohesion. consumer가 모두 제거된 모듈은 함께 삭제해야 dead code 누적을 막을 수 있음
- Context: Phase 1에서 `email/{redis,index}.ts`, `oauth/{revoker,google,kakao}.ts`가 모두 ejection되었으나 type 파일만 남아 어떤 코드도 import하지 않는 상태였음

- Violation: 단일 파일 내부에서만 사용되는 헬퍼 `toUtcDateString`이 `export` 되어 모듈 surface area를 불필요하게 넓힘
- Rule: FF — Coupling. file-private helper는 모듈 외부에 노출하지 않아 의도치 않은 의존성을 차단
- Context: `infrastructure/usage/hash.ts`의 `toUtcDateString`은 같은 파일의 `hashUsageIp`만 사용; export 제거 + JSDoc에 file-private 명시

- Violation: schema enum과 손으로 동기화해야 하는 union 타입에 sync 의무 표기가 없음
- Rule: FF — Predictability. consumer가 변경 의무를 추적할 수 있도록 hand-written 동기화 union에는 `@internal-sync` 같은 명시적 contract가 필요
- Context: `infrastructure/db/types.ts`의 `UsageActionType`은 siglens 측 `USAGE_ACTION_TYPE_VALUES` enum과 동기화돼야 하지만 코드에 표시가 없었음

- Violation: BREAKING change PR임에도 `package.json` `version` 및 `CHANGELOG.md`에 0.x 마이너 bump가 누락됨
- Rule: MISTAKES.md "Public API & Module Exports #3" — 0.x semver에서 BREAKING은 minor bump
- Context: 0.4.0 → 0.5.0 미반영, CHANGELOG에 신규 BREAKING/Phase 0~7 섹션 부재 (요약된 새 entry 추가)

