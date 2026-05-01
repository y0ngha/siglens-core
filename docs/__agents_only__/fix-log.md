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

## [PR #26 | feat/18/infrastructure-market-이전 | 2026-04-26]

- Violation: `AcquireReanalyzeCooldownResult` 타입이 `reanalyzeCooldown.ts` 구현 파일 내부에만 정의됨
- Rule: MISTAKES.md Architecture #4 — infrastructure 모듈의 public interface는 `types.ts`에 위치해야 함
- Context: `infrastructure/market/types.ts`로 이동하고 구현 파일에서 import하도록 수정

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

## [PR #37 | feat/8/user-tier-system | 2026-04-28]
- Violation: `UserTierContext` shared interface defined in `infrastructure/auth/types.ts` though it is consumed across application/tier and infrastructure/auth modules
- Rule: MISTAKES.md Architecture #1 — shared domain types referenced by 2+ files must live in `domain/types.ts`
- Context: moved `UserTierContext` to `domain/types.ts`, dropped the duplicate definition from `infrastructure/auth/types.ts`, and updated `src/index.ts` to re-export it from the domain block

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

## [PR #43 | feat/40-41/auth-helpers-and-delete-account | 2026-04-28]
- Violation: deleteAccount use-case returned `{ ok: true }` without cookie metadata while sibling logoutUser returned an expired AuthSessionCookie, breaking return-shape symmetry within application/auth
- Rule: FF.md — Predictability (consistency with sibling use-cases that share the same lifecycle concept of session termination)
- Context: deleteAccount terminates the same session lifecycle as logoutUser; consumers that previously chained logoutUser had to call createExpiredSessionCookie themselves after deleteAccount, while logoutUser callers did not

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

## [PR #44 | feat/13/timeframe-restrictions | 2026-04-28]
- Violation: `isTimeframeAllowed` duplicated restriction-flag branching and routed through `getAllowedTimeframes`, causing an unnecessary array copy for an internal boolean check
- Rule: FF.md — Readability and cohesion; shared decision logic should live behind one helper while public copy-return APIs should not be reused where readonly access is enough
- Context: Extracted `resolveAllowedTimeframes` so `getAllowedTimeframes` can keep returning a defensive copy while `isTimeframeAllowed` checks the shared readonly list directly


## [PR #45 Round 2 | feat/12/info-depth-filter | 2026-04-28]
- Violation: `lockedInfoDepth` and its helper return type exposed a mutable array type despite deriving from readonly tier configuration
- Rule: CONVENTIONS.md — Functional Programming / immutability
- Context: the filter result now exposes locked info-depth fragments as `readonly TierInfoDepth[]` to match the immutable tier config contract

## [PR #46 | feat/14/ai-model-tier-separation | 2026-04-28]
- Violation: Premium model usage tracking only recorded `member` tier usage and skipped `pro` tier usage
- Rule: FF.md — Predictability; paid-tier analytics must match the tier model access policy so cost tracking is complete
- Context: Updated chat completion usage tracking to record premium model usage for every non-free tier and added branch coverage for anonymous, free, member, pro, and missing usage-log dependencies

## [PR #46 | feat/14/ai-model-tier-separation | 2026-04-29]
- Violation: unrestricted `getAllowedModels` returned a deduplicated model list whose order depended on tier config object insertion order
- Rule: FF.md — Predictability; public helper return ordering should remain stable when configuration structure changes
- Context: Sorted the unrestricted model union with `toSorted()` and updated the tier test expectation to assert the stable order

## [PR #51 | feat/50/oauth-token-revocation | 2026-04-30]
- Violation: OAuth token revocation loaded provider tokens in an unawaited background task immediately before deleting the user row, allowing cascade deletion to remove the tokens before lookup.
- Rule: FF.md — Predictability; destructive dependent writes must not race ahead of prerequisite reads needed for the same use-case.
- Context: `deleteAccount` now awaits OAuth account lookup before deleting the user, while keeping provider revocation calls fire-and-forget after the tokens are captured.

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

## [PR #49 Round 5 | feat/10-11/usage-limit-gates | 2026-04-30]
- Violation: `tier` field accepted from both `AnalysisUsageOptions.tier` and `SubmitAnalysisOptions.tierContext.tier` simultaneously; caller could set conflicting tiers on the same request
- Rule: MISTAKES.md Configuration & State Management #1 — a single configuration option must have exactly one authoritative source; outer/inner divergence creates hidden inconsistencies
- Context: Removed `tier` from `AnalysisUsageOptions`; `tier` is now derived exclusively from `options.tierContext?.tier ?? DEFAULT_TIER` in `submitAnalysis.ts`

## [PR #49 Round 6 | feat/10-11/usage-limit-gates | 2026-04-30]
- Violation: Two sibling repository interfaces in the same test shared a single `vi.fn()` mock for their `recordUsage` method
- Rule: Test isolation — each repository stub must have an independent mock so `toHaveBeenCalledTimes` and `toHaveBeenCalledWith` assertions target exactly the correct dependency
- Context: `usageRepository.recordUsage` and `usageLogs.recordUsage` in `requestChatCompletion.test.ts` shared one `recordUsage` fn; calls from either stub incremented the same counter, potentially causing assertion interference when both stubs are provided to the function under test.

## [PR #49 | feat/10-11/usage-limit-gates | 2026-04-30]
- Violation: `submitAnalysis` used one timestamp for usage-limit checking but could pass an undefined timestamp to usage recording, allowing a second `new Date()` at the repository boundary
- Rule: FF.md — Predictability; one request-scoped decision should use one authoritative timestamp across related limit-check and usage-record operations
- Context: Reused a single `usageOccurredAt` value for `checkAnalysisUsageAllowed` and both cache-hit/submitted `recordAnalysisUsageSafely` paths, with a regression test for the no-`occurredAt` branch

## [Issue #55 | feat/55/email-verification-redis-migration | 2026-05-01]
- Violation: `users.emailVerified` DB column default (`true`) did not match application-layer default (`?? false` in `createEmailUser`)
- Rule: FF.md — Predictability; DB schema defaults must align with application-layer defaults so callers reading the schema get the same behavior as raw SQL inserts and code paths.
- Context: Initial migration 0004 used `DEFAULT true` to backfill existing rows. Added migration 0005 to change the column default to `false` going forward, matching the application-layer fallback. Existing-row backfill (`true`) is preserved per user directive while future inserts default to `false`.

## [PR #56 | feat/55/email-verification-redis-migration | 2026-05-01]
- Violation: `safeCompareTokenHashes` accepted 64-character non-hex strings and could throw during malformed Redis token-state comparison
- Rule: FF.md — Predictability; malformed persisted token state must produce the same invalid-token result as other bad token inputs, not an uncaught runtime exception
- Context: Email verification and password reset compare Redis-stored token hashes with submitted hashes; malformed stored hash strings now fail validation before `timingSafeEqual`

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
