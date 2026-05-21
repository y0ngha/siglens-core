# Fix Log

## [PR #86 Round 20 audit | options/analysis | 2026-05-21]
- Violation: `infrastructure/options/types.ts` imported `OptionsSnapshot` from `@/domain/options/types` instead of canonical `@/domain/types`
- Rule: canonical-barrel rule documented in `domain/CLAUDE.md` for this PR — consumers must use `@/domain/types`
- Context: R20 B1. Switched to `@/domain/types` so the same import contract applies across every consumer; tests keep their direct subdirectory imports.

- Violation: `domain/types.ts` re-export block referenced a follow-up doc PR ("if the convention needs codifying, do it in a follow-up doc PR rather than here")
- Rule: CONVENTIONS — JSDoc/comments must describe timeless intent, not a specific PR or future task
- Context: R20 S1. Trimmed the trailing parenthetical so the comment only documents the subdirectory-split rationale.

- Violation: `normalizePerExpirationItem` / `normalizeSignalItem` returned complex `{ … } | null` unions inferred by TS without explicit annotations
- Rule: readability — when a non-exported helper's return type is a complex union, annotate it explicitly so the contract is grep-able
- Context: R20 S2. Reused the existing `OptionsPerExpirationCommentary` / `OptionsSignal` domain types as the explicit return annotations; no behavior change.

## [PR #78 | feat/per-stock-fear-greed-index | 2026-05-07]

- Violation: AI-facing prompt section in Korean despite repo convention requiring English (gemini #1)
- Rule: prompt.ts file header convention "All AI-facing prompt strings must be in English"
- Context: New formatFearGreedSection in fearGreedSection.ts had Korean heading + warning text. Translated to English to match other prompt sections.

- Violation: history threshold mismatch with snapshot (gemini #2)
- Rule: spec consistency between snapshot (LIMITED) and history (was NORMAL)
- Context: computeFearGreedHistory used NORMAL=60 warm-up but composeSnapshot returns at LIMITED=10. Removed history-side threshold, relying on composeSnapshot's internal check.

- Violation: dead code FearGreedInput interface (claude B1)
- Rule: MISTAKES.md Design & Cohesion #6 "dead code"
- Context: Defined in types.ts but never imported. Removed.

- Violation: let + if conditional reassignment (claude B4)
- Rule: MISTAKES.md Coding Paradigm #12 "let + if/catch for conditional assignment instead of declarative const"
- Context: factors.ts buySellImb + submitAnalysis.ts/submitOverallAnalysis.ts fearGreed. Refactored to declarative const + .catch chain.

- Violation: Type import path inconsistency (claude S3)
- Rule: cohesion — match neighboring import sources
- Context: 4 files imported FearGreedSnapshot directly from /fearGreed/types. Changed to umbrella @/domain/types.

- Violation: missing zero-guards on financial division (claude S4)
- Rule: MISTAKES.md #16 "financial values require explicit guards before division"
- Context: factors.ts pocDist + ma200Dist divisions added zero-guards.

## [Issue #2 | chore/2/초기-개발-환경-설정 | 2026-04-24]
- Violation: release-it config used `${version}` (JS template literal) instead of `{{version}}` (Handlebars) for commitMessage, tagName, tagAnnotation
- Rule: release-it interpolation uses `{{version}}` syntax — `${version}` is passed as a literal string and breaks tag push trigger matching
- Context: .release-it.json initially written with ES template literal style; corrected to Handlebars style across all three fields

## [PR #23 Round 2 | feat/1/서버-코드-분리-핵심-로직-npm-패키지 | 2026-04-25]
- Violation: `[...arr].reverse().find()` used instead of `findLast` in `lastNonNull` helper in `prompt.ts`
- Rule: Consistency with ES2023 APIs already used in the same PR — `candle-detection.ts` already uses `findLast`; `tsconfig.json` targets ES2023
- Context: `lastNonNull` helper copied an array and reversed it just to find the last non-null value; `findLast` avoids the O(n) array copy entirely

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


## [PR #74 Round 2 | main | 2026-05-02]
- Violation: `isPremiumChatModel(model, tierConfig)` called twice in `requestChatCompletion` — once in the guard block and once in `shouldRecordPremiumUsage`
- Rule: MISTAKES.md Coding Paradigm #2 — identical values computed multiple times must be extracted to a const
- Context: `model` and `tierConfig` are immutable within the function; hoisted to `const isPremium` before the guard block


## [Fundamental & News Analysis Phase 1 | Task Batch 2 | 2026-05-02]
- Violation: Pure domain function placed in infrastructure layer
- Rule: MISTAKES.md Architecture §2 — pure functions with no I/O belong in domain/
- Context: normalizeFundamentalSnapshot moved from infrastructure/ to domain/fundamental/normalizers.ts

- Violation: State/function divergence when adding to a whitelist
- Rule: MISTAKES.md Coding Paradigm §6.5 — functions and state must stay synchronized
- Context: SKILL_CATEGORIES whitelist and countSkillFiles function now both use same pattern


## [Fundamental & News Analysis Phase 1 | Task Batch 4 | 2026-05-02]
- Violation: Fire-and-forget fetch missing AbortSignal.timeout
- Rule: MISTAKES.md Fire-and-Forget §1 — fire-and-forget fetch requests must have timeouts
- Context: Background cancellation requests added 5min AbortSignal.timeout per submitAnalysis pattern

- Violation: Bare new Date() bypasses injected clock parameter
- Rule: MISTAKES.md Domain Functions §4 — all time reads must use passed parameter, never new Date()
- Context: Replaced bare new Date() with occurredAt parameter for clock injection consistency

## [Fundamental & News Analysis Phase 1 | Task Batch 5 | 2026-05-02]
- Violation: .sort() mutable instead of .toSorted()
- Rule: MISTAKES.md Coding Paradigm §10 — .sort() mutates the original array; use .toSorted()
- Context: Replaced .sort() with .toSorted() for immutability

- Violation: DRY violation — duplicated hashing patterns (hashSnapshot vs hashNewsInput)
- Rule: MISTAKES.md Coding Paradigm §6 — identical helper patterns must be extracted to shared utility
- Context: Both hashSnapshot and hashNewsInput use same SHA-256+truncation pattern; extracted to domain/hash/


## [Fundamental & News Analysis Phase 1 | Task Batch 8 | 2026-05-02]
- Violation: Validation logic incomplete — edge cases in shape validation not covered
- Rule: MISTAKES.md Infrastructure Functions §2 — all branches and edge cases must be covered
- Context: Added comprehensive test coverage for validation edge cases (deferred to Task 1.19 completion)

## [PR #75 | feat/fundamental-news-analysis | 2026-05-02]

### Inline Comments & Blockers (16 findings) — Already documented or minor

- Violation: userApiKey undefined passed to submitAnalysis
- Rule: Domain semantic correctness / actionable error messages
- Context: technicalOptions.userApiKey now passed (IC-1)

- Violation: submitAnalysis error coerced silently to pending state
- Rule: Error handling / UX — actionable error exposure
- Context: DependencyState error branch added; submitOverallAnalysis error returns immediately (IC-2)

- Violation: FMP ratios/growth/margins in decimal (0.15) passed to prompt without ×100 conversion
- Rule: INFRASTRUCTURE.md — Unit consistency for third-party API adapters
- Context: ROE/ROA/operatingMargin/netMargin/revenueYoy/epsYoy/debtRatio multiplied by 100 before normalization (IC-3)

- Violation: FileSkillsLoader instantiated per submitNewsAnalysis call
- Rule: MISTAKES.md Coding Paradigm §2 / Performance — avoid repeated resource creation
- Context: loadSkillsCached() helper added; both submitFundamental/submitNews use memoized loader (IC-4)

- Violation: JSON fence regex uses ^ and $ anchors → fails when LLM adds prose before fence
- Rule: LLM robustness — multi-line fence matching must be flexible
- Context: Fence matching + brace fallback two-stage extraction (IC-5)

- Violation: RawEarningsReport.date vs earningsDate field name inconsistency
- Rule: MISTAKES.md §8 — sibling type shape must be consistent
- Context: Renamed date → earningsDate (S-4)

## [PR #75 Round 2 | feat/fundamental-news-analysis | 2026-05-02]

### Blockers (4 findings)

- Violation: resolveOverallDependencies typed public but return/parameter types not exported from src/index.ts
- Rule: MISTAKES.md Architecture §6.5 — public function types must be exported to prevent caller type-safety loss
- Context: OverallDependencyInputs, DependencyState, DependencyStateCached, DependencyStatePending, DependencyStateError added to src/index.ts Tier 4 exports

### Suggestions (4 findings, already-documented patterns)

## [PR #75 Round 3 | feat/fundamental-news-analysis | 2026-05-02]

### Blockers (9 findings)

- Violation: Duplicate `'gemini-2.5-flash-lite'` literal in two locations (infrastructure/cache/config.ts + application/news/submitNewsCardAnalysis.ts)
- Rule: MISTAKES.md Public API & Module Exports §6.5 / Coding Paradigm §13 — hardcoded literals must be extracted to named constants
- Context: NEWS_CARD_MODEL_ID constant exported from cache/config.ts (@internal); submitNewsCardAnalysis.ts imports it

### Suggestions (3 findings, already-documented patterns)

## [PR #75 Round 4 | feat/fundamental-news-analysis | 2026-05-02]

### Blockers (5 findings)

- Violation: Two separate `export type { ... } from './application/overall/types'` blocks in src/index.ts
- Rule: MISTAKES.md Components §0 / ESLint import/no-duplicates — multiple export blocks from the same module must be merged
- Context: SubmitOverallAnalysis*/PollOverallAnalysisResult and DependencyState*/OverallDependencyInputs merged into single block

### Suggestions (5 findings)

## [PR #75 Round 5 | feat/fundamental-news-analysis | 2026-05-02]

### Blockers (5 findings)

### Suggestions (7 findings)

## [PR #75 Round 6 | feat/fundamental-news-analysis | 2026-05-02]

### Blockers (3 findings)

- Violation: TIMEFRAME_LABEL and TIMEFRAME_CONTEXT constants separated but must be updated together
- Rule: MISTAKES.md Design & Cohesion #1 — data that must be updated together should live in a single object/constant
- Context: Unified to single TIMEFRAME_CONFIG object with structure { [Timeframe]: { label, context } }

### Suggestions (3 findings)

- Violation: resolveOverallDependencies exposed in public API (src/index.ts) but is internal implementation detail of submitOverallAnalysis
- Rule: API surface minimization — public API should not expose internal use-case orchestration; only top-level consumer functions should be exported
- Context: resolveOverallDependencies removed from src/index.ts; remains internal infrastructure function

## [PR #75 | feat/fundamental-news-analysis | 2026-05-03]
- Violation: SubmitNewsCardAnalysisOptions/Result and PollNewsCardAnalysisResult missing from src/index.ts despite being parameter/return types of public functions
- Rule: Public API completeness — parameter and return types of public functions must themselves be public exports
- Context: submitNewsCardAnalysis and pollNewsCardAnalysis are public but their option/result types were marked @internal and omitted from src/index.ts; added all 5 types to exports and removed @internal

## [PR #75 R8 | feat/fundamental-news-analysis | 2026-05-03]
- Violation: SubmitOverallAnalysisCached/Submitted/LimitError/FetchError and OverallAxis types missing from src/index.ts exports
- Rule: MISTAKES.md Public API & Module Exports §8 — public union variant types and axis types must be re-exported
- Context: Blockers B-1 and B-2; variants used in public SubmitOverallAnalysisResult union but not exported; OverallAxis used in dependency result types

- Violation: FundamentalAnalysisUsageOptions / NewsAnalysisUsageOptions not exported despite sibling AnalysisUsageOptions being public
- Rule: MISTAKES.md Public API §1 — sibling exports must be consistent
- Context: Suggestion S-1; both usage options exported for API surface consistency

- Violation: FundamentalProfile and FundamentalProfileInput define identical 8-field structure
- Rule: MISTAKES.md TypeScript §6 — duplicate type structures should be unified or cross-referenced
- Context: Suggestion S-2; structures kept separate per domain/input layer semantics, JSDoc added to document intentional separation

- Violation: FundamentalDataProvider returns Raw* types @internal but consumers must import them explicitly
- Rule: MISTAKES.md API Usability — provider interface return types must be importable with clear intent
- Context: Suggestion S-5; 13 provider methods return types changed from Raw* to Fundamental*Input aliases; provider interface now returns domain-neutral input shapes

## [fix/post-210a423-comprehensive | 7-task comprehensive fix cycle | 2026-05-03]
- Violation: Guard and sentinel-check branches lack dedicated test coverage
- Rule: Infrastructure/Domain test coverage (MISTAKES.md Tests §15 + Infrastructure §2)
- Context: Task 2 (analysisUsage helper error paths), Task 7 round 1 (sentinel guard branches in 4 submit modules) — 5 branches across 2 commits; 100% coverage required including guard paths

- Violation: Public function return type variants missing from src/index.ts or wrongly tagged @internal
- Rule: Public API variant type exports (MISTAKES.md Public API §8)
- Context: PR #75 R8 (SubmitFundamentalAnalysis/News/OverallAnalysis variants, OverallAxis type), Task 7 round 3 (14 Raw* types + 8 variant types) — 22+ type instances; all union variants used in public function returns must be exported without @internal

## [PR #76 | fix/post-210a423-comprehensive | 2026-05-03]
- Violation: SubmitOverallAnalysisLimitError shares status:'error' discriminant with SubmitOverallAnalysisError (which has axis field)
- Rule: TypeScript discriminated union — narrowing by status must yield a single shape
- Context: Blocker B2 — consumers narrowing on result.status==='error' to access .axis broke after limit-error variant was added; fixed by giving limit error its own status:'limit_error' discriminant

- Violation: let + .catch() mutation pattern in pollAnalysis skill loading
- Rule: MISTAKES.md Coding Paradigm §12 — replace let+if/catch reassignment with const expressions or .then().catch() chaining
- Context: Blocker B4 — `let pollSkillsDegraded = false; ... .catch(() => { pollSkillsDegraded = true; ... })` rewritten as single .then().catch() returning {skills, skillsDegraded} object

## [PR #85 | feat/skip-enqueue-if-miss | 2026-05-11]
- Violation: skipEnqueueIfMiss option not propagated from top-level to sub-axis submits inside submitOverallAnalysis
- Rule: bot-gating intent — skipEnqueueIfMiss must prevent worker enqueue at every layer it triggers
- Context: Gemini high-priority — resolveOverallDependencies was called BEFORE the existing guard at line 231, and the resolver forwarded options to submitAnalysis / submitFundamentalAnalysis / submitNewsAnalysis WITHOUT the flag. A bot request would have triggered three sub-axis workers before reaching the overall-level guard. Fixed by (1) moving skipEnqueueIfMiss onto OverallDependencyInputs so the resolver sees it, (2) forcing skipEnqueueIfMiss into all three sub-axis option objects in the resolver, and (3) adding a new DependencyStateMissNoTrigger short-circuit so submitOverallAnalysis returns miss_no_trigger directly when any axis returns miss_no_trigger. Added 5 new resolver tests + 1 new submit test (74 → 80 in the overall suite) to lock in propagation behavior.

