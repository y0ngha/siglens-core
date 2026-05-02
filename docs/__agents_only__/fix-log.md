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


## [Issue #59 | feat/59/분석-캐시-키에-모델-식별자-포함 | 2026-05-01]
- Violation: Module-level `const` declaration placed inside the import block (between two `import` statements)
- Rule: FF 1-G (Readability) — all import statements must precede any declarations; interspersing const inside imports creates a viewpoint shift
- Context: `DEFAULT_ANALYSIS_MODEL_USED` constant was inserted after the first import in `pollAnalysis.ts`; moved to after all import statements




## [PR #71 | refactor/model-specs-consolidation | 2026-05-02]
- Violation: Shared domain types (`ModelSpec`, `AIProvider`, `ActiveModelId`) were defined inside `domain/analysis/modelSpecs.ts` instead of `domain/types.ts`
- Rule: ARCHITECTURE Mistake #1 / domain/CLAUDE.md — shared domain types must live in `domain/types.ts`
- Context: Initial implementation co-located the new `ModelSpec` type with the spec map; review caught it and the types were moved to `domain/types.ts` with `modelSpecs.ts` importing them via `@/domain/types`.

- Violation: `getThinkingBudgetSequence` used `reduce + spread` accumulator pattern (O(N²))
- Rule: MISTAKES.md #14.5 — `[...acc, x]` inside reduce/flatMap causes O(N²); use `for + push` into a local mutable array
- Context: Fallback-budget de-duplication loop replaced with `const result: number[] = []; for (...) result.push(...)` per the documented domain-layer performance exception.

- Violation: Provider predicates returned plain `boolean` instead of TypeScript type predicates
- Rule: CONVENTIONS.md / typescript-advanced-types — narrow when the runtime check carries type information
- Context: `isClaudeModel` / `isGeminiModel` / `isChatGPTModel` converted to `model is ClaudeModelId` etc. with derived subset types so callers can narrow `ActiveModelId` at the type level.


## [Issue #69 | feat/69/submitAnalysis-model-userApiKey | 2026-05-02]
- Violation: `userApiKey?: string` 필드의 JSDoc에 "Required when..." 표현 사용 — 타입은 optional인데 required로 오해할 소지
- Rule: FF Predictability — optional 필드의 JSDoc은 조건부 의무를 명확히 기술해야 하며 "Required"는 non-optional 필드에만 사용
- Context: `SubmitAnalysisOptions.userApiKey` JSDoc을 "Must be provided when..." 형식으로 수정해 user-managed 모델 사용 시의 책임을 명확화

## [PR #71 round 3 | refactor/model-specs-consolidation | 2026-05-02]
- Violation: Test comment "8192 deduped" did not accurately describe the algorithm — the value is skipped because it is `>=` the previous accepted entry, not because of exact-duplicate deduplication
- Rule: CONVENTIONS.md / FF.md Readability — comments must accurately reflect the underlying logic
- Context: First `getThinkingBudgetSequence` test comment rewrote to "8192 skipped, >= previous" to match the `if (result.length === 0 || budget < result[result.length - 1])` non-decreasing-skip rule.

## [PR #74 Round 2 | main | 2026-05-02]
- Violation: Two separate import blocks from the same `@/domain/types` specifier in `domain/llm/providers.ts`
- Rule: MISTAKES.md TypeScript #3.5 — multiple import blocks from the same module must be merged into one
- Context: `LlmProvider` was added in a separate import block from the existing `AIProvider, ActiveModelId, ModelId` block after the B3 fix moved the type to `domain/types`

- Violation: `isPremiumChatModel(model, tierConfig)` called twice in `requestChatCompletion` — once in the guard block and once in `shouldRecordPremiumUsage`
- Rule: MISTAKES.md Coding Paradigm #2 — identical values computed multiple times must be extracted to a const
- Context: `model` and `tierConfig` are immutable within the function; hoisted to `const isPremium` before the guard block
