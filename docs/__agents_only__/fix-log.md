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

- Violation: DrizzleUserRepository class-level JSDoc missing @see {@link UserRepository} cross-reference
- Rule: CONVENTIONS.md JSDoc Tier 3 recommended tags — @see is recommended for Tier 3 implementations to link consumers to the interface contract
- Context: DrizzleUserRepository implements UserRepository but the JSDoc did not point to the interface, leaving consumers without a direct link to the contract

## [PR #33 Round 4 | feat/5/email-signup | 2026-04-27]
- Violation: `EMAIL_ALREADY_EXISTS_CODE` and `'email_already_exists'` literal defined in domain/ layer despite being produced only by application-layer duplicate-check logic
- Rule: ARCHITECTURE.md — types and constants must be defined in the layer that produces them; infrastructure-concern error codes must not appear in domain/
- Context: Moved `EMAIL_ALREADY_EXISTS_CODE` from `domain/auth/constants.ts` to new `application/auth/constants.ts`; narrowed `AuthValidationErrorCode` to `'invalid_email' | 'weak_password'`; defined independent `RegisterUserError` interface in `application/auth/types.ts` with `RegisterUserErrorCode = AuthValidationErrorCode | 'email_already_exists'`

- Violation: 26 individual indicator functions (`calculateATR`, `calculateBollinger`, etc.) exported as Tier 2 public API
- Rule: ARCHITECTURE.md / PUBLIC_API.md — individual indicator calculators are classified as internal and must not appear in `src/index.ts`
- Context: Export block for 26 functions removed from Tier 2 section; only the aggregate `calculateIndicators` is exported

## [PR #34 | feat/6/email-login | 2026-04-27]
- Violation: `omitPasswordHash` in `loginUser.ts` manually maps all `AuthUserRecord` fields instead of using destructuring with rest to omit `passwordHash`
- Rule: FF Readability/Predictability — manual field mapping silently drops new fields added to the interface; destructuring rest (`const { passwordHash: _passwordHash, ...safeUser } = user`) is more maintainable and prevents future field omission
- Context: Gemini review identified that if `AuthUserRecord` gains a new field, the manual mapping would silently exclude it from the returned record

## [PR #34 Round 2 | feat/6/email-login | 2026-04-27]
- Violation: Tier 4 public constants (`AUTH_SESSION_COOKIE_NAME`, `DEFAULT_SESSION_TTL_SECONDS`, `DEFAULT_AUTH_COOKIE_PATH`, `DEFAULT_AUTH_COOKIE_SAME_SITE`) missing JSDoc
- Rule: CONVENTIONS.md — every symbol exported from `src/index.ts` must carry JSDoc for IDE hover; constants with non-obvious values (e.g. `2592000` = 30 days) especially require it
- Context: Four session cookie constants were exported without any JSDoc; added single-line descriptions to each

## [PR #34 Round 4 | feat/6/email-login | 2026-04-27]
- Violation: `@internal` JSDoc on `addSeconds` referenced caller (`loginUser session expiry calculation`)
- Rule: CONVENTIONS.md JSDoc Don'ts — "Don't reference the current PR/issue/caller — write timeless docs"
- Context: A pure date utility documented its purpose by naming a specific call site instead of describing the function's role

- Violation: `DrizzleSessionRepository` Tier 3 JSDoc missing `@returns` tag
- Rule: CONVENTIONS.md — Tier 3 (infra factories & config) requires `description`, `@param`, and `@returns`
- Context: Class-as-factory pattern; constructor returns an instance of the repository but `@returns` was omitted

- Violation: `RegisterUserErrorField` defined as inline literal `'email' | 'password'` while sibling `RegisterUserErrorCode` references the domain alias `AuthValidationErrorCode`
- Rule: FF — Predictability & Cohesion — sibling types in the same error shape should share a single source-of-truth strategy (domain alias vs inline literal)
- Context: `RegisterUserErrorField` and `RegisterUserErrorCode` together define the registration error structure; the field type was inlined while the code type referenced domain, creating inconsistency

- Violation: `index.test.ts` "exports database helpers" test mixed DB factories, schema tables, enum values, and auth use-case functions in a single `it()` block with a misleading title
- Rule: CONVENTIONS.md / FF — Cohesion — one test case must cover one concern; the title must describe the actual content
- Context: A single integration smoke test grew to assert across four distinct export categories, hiding the auth-function checks behind a database-helper title

## [PR #35 | feat/7/social-login | 2026-04-27]
- Violation: infrastructure/db imported types from infrastructure/auth, creating cross-module coupling between two infrastructure modules
- Rule: MISTAKES.md Architecture #3 — each infrastructure module handles one external system; cross-module coordination belongs at the consumer level
- Context: merge resolution moved auth interfaces (UserRepository, SessionRepository, OAuthUserRepository, etc.) into infrastructure/auth/types.ts and had db/sessionRepository.ts and db/userRepository.ts import them across the boundary

## [PR #35 | feat/7/social-login | 2026-04-27]
- Violation: module-internal exports (createSessionCookie, createExpiredSessionCookie, addSeconds, createAuthSession) missing `@internal` JSDoc tag
- Rule: MISTAKES.md #9.5 — every function/constant exported from a module but not re-exported in src/index.ts must have `@internal`
- Context: createAuthSession was newly introduced for the social-login flow without the tag; the existing helpers lost their tags during the merge

## [PR #35 | feat/7/social-login | 2026-04-27]
- Violation: Tier 1 application entrypoint `socialLoginUser` shipped without `@param`/`@returns`/`@example` JSDoc tags
- Rule: CONVENTIONS.md JSDoc Rules — Tier 1 requires description, @param, @returns; @example/@see are recommended
- Context: new use-case added during social login implementation only had a description block; sibling Tier 1 functions (loginUser, logoutUser) also lost their tags during merge resolution

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
