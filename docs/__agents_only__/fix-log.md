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

## [PR #33 | feat/5/email-signup | 2026-04-27]
- Violation: Missing EOF newline in drizzle/0001_sharp_triathlon.sql
- Rule: CONVENTIONS.md — every file must end with a newline character
- Context: Migration SQL file generated without trailing newline; added manually


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

## [PR #49 Round 2 | feat/10-11/usage-limit-gates | 2026-04-30]
- Violation: Test constant declared twice under different casing — `restrictedTierConfig` (camelCase) and `const RESTRICTED_TIER_CONFIG = restrictedTierConfig` alias (UPPER_CASE), giving the same object two names in the same scope
- Rule: Each test fixture should have exactly one canonical name; aliasing creates ambiguity with no benefit
- Context: `requestChatCompletion.test.ts` originally declared `RESTRICTED_TIER_CONFIG` but a camelCase version was added later without removing the alias; alias removed, all usages unified to `restrictedTierConfig`

## [PR #49 Round 4 | feat/10-11/usage-limit-gates | 2026-04-30]
- Violation: `checkUsageLimit` called `getUsageToday` without try-catch, exposing DB failures to public API callers even though sibling `recordUsage` was already protected
- Rule: MISTAKES.md I/O & Error Handling #1 — all I/O at the same call depth must be equivalently guarded
- Context: Moved the fail-open try-catch into `checkUsageLimit` so both `checkAnalysisLimit` and `checkChatbotLimit` (public Tier 1 exports) consistently fail open on repository errors regardless of whether the caller uses an inner wrapper

## [PR #49 | feat/10-11/usage-limit-gates | 2026-04-30]
## [PR #49 Round 4 | feat/10-11/usage-limit-gates | 2026-04-30]
- Violation: outer try-catch in `checkAnalysisUsageAllowed` / `checkChatbotUsageAllowed` formed a dead branch — `checkUsageLimit` already catches all errors internally and returns `true` (fail-open)
- Rule: MISTAKES.md Coding Paradigm #4 — "Leaving logic that has no effect → catch-all conditions that never execute"
- Context: `src/application/market/submitAnalysis.ts` and `src/application/chat/requestChatCompletion.ts`; outer catch was unreachable because `checkUsageLimit` swallowed all `getUsageToday` errors

- Violation: `'analysis' | 'chatbot'` inline union literal in `FEATURE_COUNT_KEY` type annotation not extracted to a named type
- Rule: CONVENTIONS.md — "Extract union literals with 2+ members into a type alias"; replaced with `keyof UsageCounts` which ties the annotation to the source of truth
- Context: `src/application/usage/limits.ts` FEATURE_COUNT_KEY constant


## [PR #49 Round 6 | feat/10-11/usage-limit-gates | 2026-04-30]
- Violation: Two sibling repository interfaces in the same test shared a single `vi.fn()` mock for their `recordUsage` method
- Rule: Test isolation — each repository stub must have an independent mock so `toHaveBeenCalledTimes` and `toHaveBeenCalledWith` assertions target exactly the correct dependency
- Context: `usageRepository.recordUsage` and `usageLogs.recordUsage` in `requestChatCompletion.test.ts` shared one `recordUsage` fn; calls from either stub incremented the same counter, potentially causing assertion interference when both stubs are provided to the function under test.

## [PR #64 | feat/59/분석-캐시-키에-모델-식별자-포함 | 2026-05-01]
- Violation: `buildAnalysisCacheKey` (Tier 3 public API) added `modelId` as a required parameter, instantly breaking all existing callers that only passed `symbol` + `timeframe`
- Rule: docs/PUBLIC_API.md — parameters added to public API functions must be optional with a default so callers do not need to update; required additions are breaking changes requiring a semver major bump
- Context: `infrastructure/cache/config.ts` — fixed by introducing `DEFAULT_ANALYSIS_MODEL_ID` and assigning it as the parameter default (`modelId = DEFAULT_ANALYSIS_MODEL_ID`), restoring backward compatibility

- Violation: `DEFAULT_ANALYSIS_MODEL_USED` constant duplicated across `submitAnalysis.ts` and `pollAnalysis.ts` even though both files are in the same `application/market/` directory and can freely import each other
- Rule: MISTAKES.md Coding Paradigm #6 — repeating identical values at multiple call sites; MISTAKES.md Rule 17 permits duplication only when import is impossible due to environment constraints (not the case here)
- Context: moved the canonical constant to `infrastructure/cache/config.ts` as `DEFAULT_ANALYSIS_MODEL_ID` (`@internal`), then imported it in both application files and their tests

## [PR #49 | feat/10-11/usage-limit-gates | 2026-04-30]
- Violation: `submitAnalysis` used one timestamp for usage-limit checking but could pass an undefined timestamp to usage recording, allowing a second `new Date()` at the repository boundary
- Rule: FF.md — Predictability; one request-scoped decision should use one authoritative timestamp across related limit-check and usage-record operations
- Context: Reused a single `usageOccurredAt` value for `checkAnalysisUsageAllowed` and both cache-hit/submitted `recordAnalysisUsageSafely` paths, with a regression test for the no-`occurredAt` branch

## [Issue #55 | feat/55/email-verification-redis-migration | 2026-05-01]
- Violation: `users.emailVerified` DB column default (`true`) did not match application-layer default (`?? false` in `createEmailUser`)
- Rule: FF.md — Predictability; DB schema defaults must align with application-layer defaults so callers reading the schema get the same behavior as raw SQL inserts and code paths.
- Context: Initial migration 0004 used `DEFAULT true` to backfill existing rows. Added migration 0005 to change the column default to `false` going forward, matching the application-layer fallback. Existing-row backfill (`true`) is preserved per user directive while future inserts default to `false`.

## [PR #56 | feat/55/email-verification-redis-migration | 2026-05-01]
- Violation: `ConfirmPasswordResetDependencies` named the same `UserRepository` dependency differently from sibling auth dependency objects
- Rule: FF.md — Predictability; dependency field names should stay consistent across related use-cases so consumers can predict contracts
- Context: Renamed `ConfirmPasswordResetDependencies.userRepository` to `users`, matching `RegisterUserDependencies.users` while keeping `emailAuthUsers` for credential lookup.

- Violation: A test-only Redis cache reset helper was exported from production infrastructure code
- Rule: Cohesion — test orchestration should live in test code instead of widening production module exports
- Context: Removed `resetEmailTokenStoreForTests()` from `infrastructure/email/redis.ts`; Redis tests now reset module state with `vi.resetModules()` and dynamically import the subject.

- Violation: Public auth API breaking changes were not reflected in release metadata
- Rule: docs/PUBLIC_API.md — Tier 1 function signature changes require a major version, with 0.x.y applying the change as a minor version bump
- Context: Added `CHANGELOG.md` breaking-change notes and bumped `package.json` from `0.1.14` to `0.2.0`.

## [PR #63 | refactor/52/requestChatCompletion-시간-주입-통일 | 2026-05-01]
- Violation: Optional public API field (`getCurrentDate?`) removed from `RequestChatCompletionDependencies` without `@deprecated` transition period
- Rule: semver — removing a field from a public interface (even optional) is a breaking change; must be marked `@deprecated` first and removed only in the next major version
- Context: `src/application/chat/types.ts`; `getCurrentDate` was a DI hook removed in favour of `params.occurredAt`; field restored with `@deprecated` JSDoc pointing consumers to the params alternative

## [PR #63 Fix | refactor/52/requestChatCompletion-시간-주입-통일 | 2026-05-01]
- Violation: `getCurrentDate` marked `@deprecated` but completely ignored in implementation, silently breaking existing consumers who pass it without `params.occurredAt`
- Rule: semver — a `@deprecated` field must remain functional as a fallback during the deprecation period; ignoring it constitutes a functional breaking change even when the declaration is preserved
- Context: `src/application/chat/requestChatCompletion.ts`; changed `params.occurredAt ?? new Date()` to `params.occurredAt ?? dependencies.getCurrentDate?.() ?? new Date()` so legacy consumers continue to receive their injected date until the next major version

## [Issue #59 | feat/59/분석-캐시-키에-모델-식별자-포함 | 2026-05-01]
- Violation: Module-level `const` declaration placed inside the import block (between two `import` statements)
- Rule: FF 1-G (Readability) — all import statements must precede any declarations; interspersing const inside imports creates a viewpoint shift
- Context: `DEFAULT_ANALYSIS_MODEL_USED` constant was inserted after the first import in `pollAnalysis.ts`; moved to after all import statements
