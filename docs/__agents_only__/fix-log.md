# Fix Log

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

- Violation: missing @internal JSDoc on module-internal exports (claude B2)
- Rule: MISTAKES.md Coding Paradigm #9.5 "Module-internal exports missing @internal JSDoc tag"
- Context: 3 threshold constants in composition.ts exported but not in src/index.ts. Added @internal.

- Violation: public-facing JSDoc in Korean (claude B3)
- Rule: CONVENTIONS.md "Public-facing JSDoc is written in English"
- Context: FearGreedFactor.percentile and ComputeFearGreedOptions.pocWindow had Korean. Translated.

- Violation: let + if conditional reassignment (claude B4)
- Rule: MISTAKES.md Coding Paradigm #12 "let + if/catch for conditional assignment instead of declarative const"
- Context: factors.ts buySellImb + submitAnalysis.ts/submitOverallAnalysis.ts fearGreed. Refactored to declarative const + .catch chain.

- Violation: indicator test missing toBeCloseTo deterministic assertion (claude B6)
- Rule: MISTAKES.md Tests #12 "Period-based indicator tests only verify sign without toBeCloseTo reference values"
- Context: walkForward.test.ts only checked score range, not actual value. Added captured-value assertion.

- Violation: Tier 4 public types missing type-level JSDoc (claude B7)
- Rule: CONVENTIONS.md "Tier 4 (types): type-level description, one-line per field"
- Context: 10 public types in fearGreed/types.ts had partial JSDoc. Added complete English descriptions.

- Violation: snapshot confidence type includes runtime-impossible value (claude S1)
- Rule: TypeScript predictability — types should reflect runtime behavior
- Context: FearGreedSnapshot.confidence narrowed to Exclude<FearGreedConfidence, 'insufficient'>.

- Violation: Type import path inconsistency (claude S3)
- Rule: cohesion — match neighboring import sources
- Context: 4 files imported FearGreedSnapshot directly from /fearGreed/types. Changed to umbrella @/domain/types.

- Violation: missing zero-guards on financial division (claude S4)
- Rule: MISTAKES.md #16 "financial values require explicit guards before division"
- Context: factors.ts pocDist + ma200Dist divisions added zero-guards.

- Violation: missing boundary test cases for confidence transitions (claude S5)
- Rule: MISTAKES.md Tests "boundary cases for each branch"
- Context: walkForward.test.ts now tests LIMITED..NORMAL boundary.

## [PR #77 | chore/0/post-bde84f3-cleanup | 2026-05-07] Round 6

- Violation: `pollAnalysis.test.ts`의 `describe('B-5: meta.timeframe undefined 분기')` — describe 이름에 리뷰어 버그 태그 접두사 "B-5:" 포함
- Rule: PR_FIX_FLOW.md Test Layer Checklist — "describe/it text is human-readable, not code expressions"
- Context: 리뷰어 태그는 PR 맥락 한정이므로 테스트 코드에 남기지 않음. "meta.timeframe undefined 분기"로 변경.

## [PR #77 | chore/0/post-bde84f3-cleanup | 2026-05-07] Round 4

- Violation: `pollFundamentalAnalysis`, `pollNewsAnalysis`, `pollNewsCardAnalysis`, `pollOverallAnalysis` 4개 함수에 추가된 빈-응답 감지 `if` 분기(true 경로)에 대한 테스트 케이스 부재
- Rule: application/CLAUDE.md "Coverage target: 100% branch coverage (required)"
- Context: 각 함수의 `console.warn` 경고 분기가 기존 테스트에서 커버되지 않아 각 테스트 파일에 빈 응답 케이스를 추가함.

## [PR #77 | chore/0/post-bde84f3-cleanup | 2026-05-07] Round 3

- Violation: `requestChatCompletion.ts` 내 라우팅 매트릭스 인라인 주석이 함수 JSDoc과 동일한 WHAT 내용을 반복 설명
- Rule: CLAUDE.md — "Don't explain WHAT the code does" / "Only add a comment when the WHY is non-obvious"
- Context: 4줄 주석(1~4번 케이스)이 함수 JSDoc의 API key routing 섹션과 중복. 주석 제거.


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


## [PR #71 round 3 | refactor/model-specs-consolidation | 2026-05-02]
- Violation: Test comment "8192 deduped" did not accurately describe the algorithm — the value is skipped because it is `>=` the previous accepted entry, not because of exact-duplicate deduplication
- Rule: CONVENTIONS.md / FF.md Readability — comments must accurately reflect the underlying logic
- Context: First `getThinkingBudgetSequence` test comment rewrote to "8192 skipped, >= previous" to match the `if (result.length === 0 || budget < result[result.length - 1])` non-decreasing-skip rule.

## [PR #74 Round 2 | main | 2026-05-02]
- Violation: `isPremiumChatModel(model, tierConfig)` called twice in `requestChatCompletion` — once in the guard block and once in `shouldRecordPremiumUsage`
- Rule: MISTAKES.md Coding Paradigm #2 — identical values computed multiple times must be extracted to a const
- Context: `model` and `tierConfig` are immutable within the function; hoisted to `const isPremium` before the guard block

## [PR #74 | feat/73/chat-provider-mapping-user-api-key-error | 2026-05-02]
- Violation: Tier 4 상수 `LLM_PROVIDER_VALUES`가 `src/index.ts`, `src/index.client.ts`의 Tier 2 섹션에 export됨
- Rule: ARCHITECTURE.md — Tier 분리 원칙; 런타임 상수 배열은 Tier 4 섹션에 위치해야 함
- Context: LLM 모듈 추가 시 `getProviderForModel`(Tier 2)과 `LLM_PROVIDER_VALUES`(Tier 4)를 같은 export 블록에 묶어 Tier 2 섹션에 배치함

## [PR #74 Round 4 | feat/73/chat-provider-mapping-user-api-key-error | 2026-05-02]
- Violation: domain 테스트(`src/__tests__/domain/llm/providers.test.ts`)에서 application 레이어 상수(`@/application/chat/constants`) import
- Rule: ARCHITECTURE.md — domain은 application에서 import 금지 (ESLint 강제); 동일 규칙이 domain 테스트에도 적용됨
- Context: S1 Suggestion을 반영하면서 `GEMINI_2_5_FLASH_MODEL`을 application 레이어에서 import했으나, domain 테스트는 application 레이어 심볼에 의존해서는 안 됨


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

## [Fundamental & News Analysis Phase 1 | Task Batch 6 | 2026-05-02]
- Violation: Test fixture duplication across multiple test files
- Rule: MISTAKES.md Tests §8 — repeated test data must be extracted to shared fixtures.ts
- Context: Created __fixtures__/newsFixtures.ts with reusable mock data, imported into all news test files


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

- Violation: JobMeta.timeframe optional but pollAnalysis missing timeframe undefined guard
- Rule: Type change requires test coverage
- Context: Added timeframe undefined test case to pollAnalysis.test.ts (B-5)

- Violation: Identical import/export from infrastructure/fundamental/types.ts
- Rule: DRY / MISTAKES.md TypeScript §3.5 — single import + re-export
- Context: Consolidated (S-1)

- Violation: let result without explicit type annotation in poll files
- Rule: CONVENTIONS.md — explicit type annotations required
- Context: Type annotations added to all poll result variables (S-2)

- Violation: RawEarningsReport.date vs earningsDate field name inconsistency
- Rule: MISTAKES.md §8 — sibling type shape must be consistent
- Context: Renamed date → earningsDate (S-4)

## [PR #75 Round 2 | feat/fundamental-news-analysis | 2026-05-02]

### Blockers (4 findings)

- Violation: resolveOverallDependencies typed public but return/parameter types not exported from src/index.ts
- Rule: MISTAKES.md Architecture §6.5 — public function types must be exported to prevent caller type-safety loss
- Context: OverallDependencyInputs, DependencyState, DependencyStateCached, DependencyStatePending, DependencyStateError added to src/index.ts Tier 4 exports

### Suggestions (4 findings, already-documented patterns)

- Violation: SkillCategory type has inline Korean comments on 'fundamental' and 'news' members
- Rule: FF Principle 2-B Consistency — mixed comment patterns (some members documented, others not) break readability consistency
- Context: Inline Korean comments removed; SkillCategory JSDoc relies on type name for clarity per existing pattern in domain/types.ts

## [PR #75 Round 3 | feat/fundamental-news-analysis | 2026-05-02]

### Blockers (9 findings)

- Violation: Duplicate `'gemini-2.5-flash-lite'` literal in two locations (infrastructure/cache/config.ts + application/news/submitNewsCardAnalysis.ts)
- Rule: MISTAKES.md Public API & Module Exports §6.5 / Coding Paradigm §13 — hardcoded literals must be extracted to named constants
- Context: NEWS_CARD_MODEL_ID constant exported from cache/config.ts (@internal); submitNewsCardAnalysis.ts imports it

- Violation: Inline callback type annotation when TS could infer (application/fundamental/submitFundamentalAnalysis.ts)
- Rule: CONVENTIONS.md / TypeScript best practices — prefer inference over redundant explicit annotations
- Context: Inline callback type annotation removed; TypeScript inference sufficient after type chain settles

### Suggestions (3 findings, already-documented patterns)

- Violation: New function `hashAnalysisInput` lacks unit tests
- Rule: MISTAKES.md Tests §15 — all new infrastructure/domain functions require 100% branch coverage
- Context: 5 test cases added to application/analysisInputHash.test.ts covering empty/null/collision scenarios

- Violation: Module JSDoc references future Phase 4 capability not yet implemented (domain/tier.ts)
- Rule: CONVENTIONS.md / Documentation Sync §3 — JSDoc must describe current behavior, not aspirational future
- Context: Phase 4 reference removed from tier.ts JSDoc

- Violation: 14 input interfaces should live in domain/types.ts for centralization (normalizeFundamentalSnapshot.ts + imports)
- Rule: MISTAKES.md Architecture §1 — shared domain types must be centralized in domain/types.ts
- Context: 14 Fundamental*Input interfaces moved to domain/types.ts; src/index.ts export path updated

## [PR #75 Round 4 | feat/fundamental-news-analysis | 2026-05-02]

### Blockers (5 findings)

- Violation: Two separate `export type { ... } from './application/overall/types'` blocks in src/index.ts
- Rule: MISTAKES.md Components §0 / ESLint import/no-duplicates — multiple export blocks from the same module must be merged
- Context: SubmitOverallAnalysis*/PollOverallAnalysisResult and DependencyState*/OverallDependencyInputs merged into single block

### Suggestions (5 findings)

- Violation: Misleading "existing consumers" comment in dependencyResolver.ts re-export block
- Rule: FF Principle 2-A Predictability / CONVENTIONS.md — comments must reflect current intent, not historical state
- Context: Comment updated to "Re-export types for direct imports from this module" without historical claim

- Violation: Dead `FileSkillsLoader` import and mock in submitNewsAnalysis.test.ts
- Rule: MISTAKES.md Tests §13 / Dead Code — dead test mocks and imports must be removed
- Context: FileSkillsLoader import and (FileSkillsLoader as Mock).mockImplementation calls removed; only loadSkillsCached mock kept

- Violation: Type import from implementation file (`dependencyResolver`) instead of canonical `types.ts`
- Rule: MISTAKES.md Architecture §0.5 — type imports must reference the canonical types.ts, not implementation files
- Context: OverallDependencyInputs import in dependencyResolver.test.ts moved to `@/application/overall/types`

## [PR #75 Round 5 | feat/fundamental-news-analysis | 2026-05-02]

### Blockers (5 findings)

- Violation: `node:crypto` (`createHash`) used inside `application/analysisInputHash.ts`
- Rule: ARCHITECTURE.md — I/O and system modules (node:crypto, node:fs) belong in `infrastructure/`, not `application/`
- Context: hashAnalysisInput moved to src/infrastructure/hash/analysisInput.ts; all callers updated; test mirrored to __tests__/infrastructure/hash/

### Suggestions (7 findings)

- Violation: Re-export block in normalizeFundamentalSnapshot.ts with "existing consumers" comment for types introduced in this PR
- Rule: FF Principle 2-A Predictability — comments must reflect current state; re-exports for non-existent consumers add dead weight
- Context: Entire re-export block removed; imports now come from @/domain/types directly

- Violation: Korean inline comment on public type field (NewsCardAnalysis.summaryKo)
- Rule: CONVENTIONS.md JSDoc Rules — public npm package exports require English documentation
- Context: `// 한 줄 요약` → `// single-line summary`

- Violation: Indexed access types (`FundamentalSnapshot['futureDirection']['gradesConsensus']`) used as parameter types in fundamentalPrompt.ts
- Rule: CONVENTIONS.md — prefer direct named type imports over indexed access in function signatures
- Context: Replaced with direct imports of GradesConsensus and PriceTargetConsensus from @/domain/types

- Violation: Redundant `userApiKey: technicalOptions.userApiKey` after `...technicalOptions` spread in dependencyResolver.ts
- Rule: MISTAKES.md Coding Paradigm §2 — identical values computed/set multiple times must be deduplicated
- Context: Explicit line removed; spread already includes userApiKey

- Violation: Module-level NOTE block in domain/tier.ts describing app-layer runtime behavior
- Rule: FF Principle 1-D / CONVENTIONS.md — implementation notes about the consuming app must not pollute library module headers
- Context: NOTE block removed; operational context belongs in PR description, not module code

- Violation: FundamentalDataProvider.getGrades JSDoc referenced "News page" (UI consumer knowledge)
- Rule: ARCHITECTURE.md / FF Coupling — library interface JSDoc must not reference UI layer consumers
- Context: "Also used by the News page; exposed here to avoid a second provider." replaced with neutral interface description

- Violation: `FundamentalProfileInput.mktCap` used the FMP wire field name instead of a domain-neutral name
- Rule: ARCHITECTURE.md / Domain-Neutral Input Shapes §1 — domain input interfaces must use canonical domain names, not provider wire field names
- Context: FundamentalProfileInput.mktCap renamed to marketCap; normalizeFundamentalSnapshot reads input.profile.marketCap; submitFundamentalAnalysis maps RawProfile.mktCap → marketCap explicitly

## [PR #75 Round 6 | feat/fundamental-news-analysis | 2026-05-02]

### Blockers (3 findings)

- Violation: LoadSkillsCachedResult interface defined in implementation file infrastructure/skills/loader.ts instead of types.ts
- Rule: ARCHITECTURE.md #4 — infrastructure module public interfaces must be defined in types.ts, not implementation files
- Context: LoadSkillsCachedResult moved to infrastructure/skills/types.ts; loader.ts imports and uses it

- Violation: FundamentalDataProvider return type has provider-specific field names (mktCap) while JSDoc claims "no mapping layer" exists; application layer forced to map mktCap → marketCap
- Rule: Layer separation — provider interface should return domain-neutral input types; mapping belongs in infrastructure adapter, not application
- Context: FundamentalProfileInput.mktCap renamed to marketCap; submitFundamentalAnalysis updated to map RawProfile.mktCap → input.marketCap

- Violation: TIMEFRAME_LABEL and TIMEFRAME_CONTEXT constants separated but must be updated together
- Rule: MISTAKES.md Design & Cohesion #1 — data that must be updated together should live in a single object/constant
- Context: Unified to single TIMEFRAME_CONFIG object with structure { [Timeframe]: { label, context } }

### Suggestions (3 findings)

- Violation: buildOverallCacheKey function parameter timeframe typed as string instead of Timeframe enum
- Rule: TypeScript accuracy — type boundaries should match the codebase type system; mismatched types hide errors
- Context: Parameter updated to timeframe: Timeframe; test cases updated to pass Timeframe enum values instead of string literals

- Violation: FundamentalDataProvider.getGrades method is not used but marked as public interface
- Rule: Interface Segregation / unused code — unexposed methods should be either removed or documented as reserved for future phases
- Context: JSDoc added documenting the method as reserved for Phase 4 usage; method retained as interface spec

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

- Violation: reduce accumulator mutated directly via property assignment
- Rule: CONVENTIONS.md Functional Programming — reduce accumulators must be replaced via spread, not mutated
- Context: Suggestion S1 — overallPrompt.formatTechnical trendCounts reduce now returns {...acc, [s.trend]: ...+1} instead of acc[s.trend]=...

- Violation: Explicit parameter type annotation on Array.prototype.find callback when type inference would suffice
- Rule: CONVENTIONS.md Type Inference — prefer inference for callback parameters when surrounding code has sufficient type context
- Context: Inline gemini-bot comment — submitFundamentalAnalysis sectorSnapshot.find callback reverted from explicit (s: FundamentalSectorPerformanceInput) to inferred parameter; FundamentalSectorPerformanceInput import dropped

## [PR #77 | chore/0/post-bde84f3-cleanup | 2026-05-07]
## [PR #77 round 2 | chore/0/post-bde84f3-cleanup | 2026-05-07]
- Violation: Pure helper placed in application/ instead of domain/
- Rule: docs/domain/CLAUDE.md — "If it can be expressed as a pure function, it belongs here"
- Context: Suggestion S-2 (round 2) — isFallbackAnalysis only references AnalysisResponse and EMPTY_ANALYSIS_FALLBACK_SUMMARY (both already in domain/analysis/confidence.ts); moved out of pollAnalysis.ts into confidence.ts so the predicate co-locates with the constant it consumes.

- Violation: Test file used vi.mock(module) auto-mock pattern that masked moved exports
- Rule: MISTAKES.md Tests — auto-mocking a whole module replaces ALL exports with vi.fn()/undefined; when only one export needs to be mocked, use partial mock with vi.importActual
- Context: Side effect of S-2 — pollAnalysis.test.ts had `vi.mock('@/domain/analysis/confidence')` which auto-mocked the newly-moved isFallbackAnalysis (returned undefined → cache write was no longer skipped). Converted to a partial mock that keeps isFallbackAnalysis / EMPTY_ANALYSIS_FALLBACK_SUMMARY as their real implementations and only stubs enrichAnalysisWithConfidence.



## [PR #85 | feat/skip-enqueue-if-miss | 2026-05-11]
- Violation: skipEnqueueIfMiss option not propagated from top-level to sub-axis submits inside submitOverallAnalysis
- Rule: bot-gating intent — skipEnqueueIfMiss must prevent worker enqueue at every layer it triggers
- Context: Gemini high-priority — resolveOverallDependencies was called BEFORE the existing guard at line 231, and the resolver forwarded options to submitAnalysis / submitFundamentalAnalysis / submitNewsAnalysis WITHOUT the flag. A bot request would have triggered three sub-axis workers before reaching the overall-level guard. Fixed by (1) moving skipEnqueueIfMiss onto OverallDependencyInputs so the resolver sees it, (2) forcing skipEnqueueIfMiss into all three sub-axis option objects in the resolver, and (3) adding a new DependencyStateMissNoTrigger short-circuit so submitOverallAnalysis returns miss_no_trigger directly when any axis returns miss_no_trigger. Added 5 new resolver tests + 1 new submit test (74 → 80 in the overall suite) to lock in propagation behavior.
