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

## [PR #26 Round 2 | feat/18/infrastructure-market-이전 | 2026-04-26]
- Violation: `submitAnalysis.ts`와 `pollAnalysis.ts`에서 `Awaited<ReturnType<typeof skillsLoader.loadSkills>>` 복잡한 유틸리티 타입 추론 사용
- Rule: 직접 임포트 가능한 구체 타입이 있을 때 복잡한 `Awaited<ReturnType<...>>` 체인 대신 해당 타입을 명시적으로 사용
- Context: `SkillsProvider.loadSkills()`의 반환 타입은 `Promise<Skill[]>`이므로 `Awaited<...>`는 `Skill[]`; `Skill` 타입을 직접 import해 사용하면 더 명확하고 인터페이스 타입과도 일치

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

## [PR #33 Round 2 | feat/5/email-signup | 2026-04-27]
- Violation: name/avatarUrl trim behavior not tested — success test used name: 'Ada' (no whitespace) so trim() was never exercised
- Rule: MISTAKES.md Tests #15 / coverage requirement — all branches and input normalizations must be verified; optional field trimming is a distinct behavior that requires a dedicated test case
- Context: Added test case passing name: '  Ada  ' and avatarUrl with leading/trailing spaces; verifies createEmailUser is called with trimmed values


## [PR #34 | feat/6/email-login | 2026-04-27]
- Violation: `omitPasswordHash` in `loginUser.ts` manually maps all `AuthUserRecord` fields instead of using destructuring with rest to omit `passwordHash`
- Rule: FF Readability/Predictability — manual field mapping silently drops new fields added to the interface; destructuring rest (`const { passwordHash: _passwordHash, ...safeUser } = user`) is more maintainable and prevents future field omission
- Context: Gemini review identified that if `AuthUserRecord` gains a new field, the manual mapping would silently exclude it from the returned record

## [PR #34 Round 4 | feat/6/email-login | 2026-04-27]
- Violation: `@internal` JSDoc on `addSeconds` referenced caller (`loginUser session expiry calculation`)
- Rule: CONVENTIONS.md JSDoc Don'ts — "Don't reference the current PR/issue/caller — write timeless docs"
- Context: A pure date utility documented its purpose by naming a specific call site instead of describing the function's role

- Violation: `RegisterUserErrorField` defined as inline literal `'email' | 'password'` while sibling `RegisterUserErrorCode` references the domain alias `AuthValidationErrorCode`
- Rule: FF — Predictability & Cohesion — sibling types in the same error shape should share a single source-of-truth strategy (domain alias vs inline literal)
- Context: `RegisterUserErrorField` and `RegisterUserErrorCode` together define the registration error structure; the field type was inlined while the code type referenced domain, creating inconsistency

## [PR #35 | feat/7/social-login | 2026-04-27]
- Violation: infrastructure/db imported types from infrastructure/auth, creating cross-module coupling between two infrastructure modules
- Rule: MISTAKES.md Architecture #3 — each infrastructure module handles one external system; cross-module coordination belongs at the consumer level
- Context: merge resolution moved auth interfaces (UserRepository, SessionRepository, OAuthUserRepository, etc.) into infrastructure/auth/types.ts and had db/sessionRepository.ts and db/userRepository.ts import them across the boundary

## [PR #35 | feat/7/social-login | 2026-04-27]
- Violation: module-internal exports (createSessionCookie, createExpiredSessionCookie, addSeconds, createAuthSession) missing `@internal` JSDoc tag
- Rule: MISTAKES.md #9.5 — every function/constant exported from a module but not re-exported in src/index.ts must have `@internal`
- Context: createAuthSession was newly introduced for the social-login flow without the tag; the existing helpers lost their tags during the merge

## [PR #35 | feat/7/social-login | 2026-04-27]
- Violation: PR removed unrelated public Tier 4 type exports (BacktestCase/BacktestMeta/ChatActionResult/SkillCounts/QuadrantKey and others) creating an undocumented breaking change
- Rule: MISTAKES.md Predictability #1 — unrelated changes must be moved to a separate PR or reverted
- Context: the merge accidentally dropped a large block of `export type { ... }` entries from src/index.ts that have nothing to do with the OAuth feature

## [PR #35 | feat/7/social-login | 2026-04-27]
- Violation: `LoginUserOptions` and `SocialLoginUserOptions` duplicated the same session and cookie option fields instead of sharing a base interface
- Rule: CONVENTIONS.md TypeScript Rules — related interfaces with shared fields must use `extends`
- Context: the social-login use case introduced an options interface identical to the existing email-login options shape; extracted `AuthSessionOptions` and had both use-case options extend it

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


## [PR #43 | feat/40-41/auth-helpers-and-delete-account | 2026-04-28]
- Violation: deleteAccount use-case returned `{ ok: true }` without cookie metadata while sibling logoutUser returned an expired AuthSessionCookie, breaking return-shape symmetry within application/auth
- Rule: FF.md — Predictability (consistency with sibling use-cases that share the same lifecycle concept of session termination)
- Context: deleteAccount terminates the same session lifecycle as logoutUser; consumers that previously chained logoutUser had to call createExpiredSessionCookie themselves after deleteAccount, while logoutUser callers did not

## [Issue #14 | feat/14/ai-model-tier-separation | 2026-04-28]
- Violation: Browser entrypoint did not export the new browser-safe tier model API exposed from the server entrypoint
- Rule: PUBLIC_API.md — package entrypoints must expose intended public symbols consistently for the target runtime
- Context: Added `getAllowedModels`, tier gate helpers, and tier model types to `src/index.client.ts` so browser consumers can render model choices without importing the server entrypoint

## [PR #46 | feat/14/ai-model-tier-separation | 2026-04-28]
- Violation: Premium model usage tracking only recorded `member` tier usage and skipped `pro` tier usage
- Rule: FF.md — Predictability; paid-tier analytics must match the tier model access policy so cost tracking is complete
- Context: Updated chat completion usage tracking to record premium model usage for every non-free tier and added branch coverage for anonymous, free, member, pro, and missing usage-log dependencies

## [PR #46 | feat/14/ai-model-tier-separation | 2026-04-29]
- Violation: `src/index.ts` re-exported `DrizzleUserRepository` from the DB barrel, but `src/infrastructure/db/index.ts` no longer exported that symbol
- Rule: PUBLIC_API.md — public entrypoint exports must stay synchronized with module barrels they depend on
- Context: Restored the DB barrel re-export so the package entrypoint compiles and public repository exports remain available

- Violation: unrestricted `getAllowedModels` returned a deduplicated model list whose order depended on tier config object insertion order
- Rule: FF.md — Predictability; public helper return ordering should remain stable when configuration structure changes
- Context: Sorted the unrestricted model union with `toSorted()` and updated the tier test expectation to assert the stable order
