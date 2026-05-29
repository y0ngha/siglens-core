# Fix Log

## [PR #102 | feat/bars-cache-ttl | 2026-05-28] — Oscillation resolution
- Symbol: `secondsUntilNextEtRegularOpen` `Math.max(1, ...)` guard
- R1 (review-agent): suggested wrapping in `Math.max(1, ...)` for a defensive min-1s TTL → applied.
- R2 (review-agent): flagged it as provably-unreachable dead code (MISTAKES.md Design & Cohesion #6) → user decided to REMOVE it.
- Resolution: Math.max removed. The guard is mathematically unreachable (dayOffset=0 ⇒ minutesOfDay<570 ⇒ result ≥ 1). If a future round re-suggests adding it, cite this decision and decline.

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


## [PR #85 | feat/skip-enqueue-if-miss | 2026-05-11]
- Violation: skipEnqueueIfMiss option not propagated from top-level to sub-axis submits inside submitOverallAnalysis
- Rule: bot-gating intent — skipEnqueueIfMiss must prevent worker enqueue at every layer it triggers
- Context: Gemini high-priority — resolveOverallDependencies was called BEFORE the existing guard at line 231, and the resolver forwarded options to submitAnalysis / submitFundamentalAnalysis / submitNewsAnalysis WITHOUT the flag. A bot request would have triggered three sub-axis workers before reaching the overall-level guard. Fixed by (1) moving skipEnqueueIfMiss onto OverallDependencyInputs so the resolver sees it, (2) forcing skipEnqueueIfMiss into all three sub-axis option objects in the resolver, and (3) adding a new DependencyStateMissNoTrigger short-circuit so submitOverallAnalysis returns miss_no_trigger directly when any axis returns miss_no_trigger. Added 5 new resolver tests + 1 new submit test (74 → 80 in the overall suite) to lock in propagation behavior.

## [PR #98 | worktree-agent-a72bc4671dbf75a3c | 2026-05-22]
- Violation: Port return DTO (`UsageCounts`) co-located in `domain/ports/usageRepository.ts` instead of `domain/types.ts`
- Rule: `domain/CLAUDE.md` Authoring Rules — "DTOs the port returns or receives stay in `domain/types.ts`. Ports reference them via import."
- Context: Round 3 Blocker B1 — `UsageCounts` is `UsageRepository.getUsageToday`'s return DTO, mirroring `UsageLogRecord` (already moved). Co-location is reserved for option/argument types (`RecordUsageInput`, `CreateUsageLogInput`). Moved interface to `domain/types.ts` Usage Tracking section, updated imports in `usageRepository.ts` + `application/usage/limits.ts`, and synced symbol tables in `domain/CLAUDE.md`, `docs/ARCHITECTURE.md`, and `src/index.ts` re-exports.

## [PR #92 | refactor/ports-ai-module | 2026-05-22]
- Violation: `@deprecated` JSDoc migration hint points to a non-equivalent type (`ConversationTurn['text']` is `string`, but the deprecated alias `GeminiPart` is an object `{ text: string }`)
- Rule: MISTAKES.md Documentation/JSDoc — deprecation notes must accurately describe the migration path; misleading guidance is worse than no guidance
- Context: Suggestion S1 (round 3) — `GeminiPart` deprecation note "Use `ConversationTurn['text']` instead" would mislead consumers into replacing `{ text: string }` with `string`. Rewrote the JSDoc on both `src/index.ts` and `src/index.client.ts` to explain that `parts: GeminiPart[]` was flattened into `text: string` on `ConversationTurn` and that the type has no direct equivalent.

- Violation: alphabetical import order broken — `@/domain/ports/aiProvider` placed AFTER `@/domain/types` even though `'ports'` < `'types'`
- Rule: CONVENTIONS.md import ordering — within the same path-alias group, imports must be alphabetically sorted by full module path
- Context: Suggestion S1 (round 4) — `src/application/chat/types.ts` had the same out-of-order pattern that was fixed in `requestChatCompletion.ts` during round 2 but was missed here. Moved `import type { CallAiProvider } from '@/domain/ports/aiProvider'` to precede the `@/domain/types` block. Lesson: when applying an ordering fix in one file, sweep the entire module/feature for the same pattern instead of relying on the reviewer to flag siblings one round at a time.

- Violation: `@port` tag placed on file-level module JSDoc instead of the actual port interface/type JSDoc
- Rule: domain/CLAUDE.md "Authoring rules" — "Tag the interface JSDoc with `@port` so adapters and reviewers can identify it"; the tag must annotate the port contract, not the module header
- Context: Suggestion S2 (round 4) — `src/domain/ports/aiProvider.ts` had `@port` on the file-leading block comment, but the port contract is `CallAiProvider` at the bottom of the file. Tools / readers scanning for `@port` on type declarations (matching the `CacheProvider` example) would miss it. Moved the tag onto the `CallAiProvider` type JSDoc and kept the module-level prose as a plain header.

## [PR #99 | refactor/skills-domain-ports-migration | 2026-05-22]
- Violation: `@adapter implements {@link Port}` JSDoc tag applied to a factory function (createSkillsProvider) rather than the implementing class
- Rule: Documentation accuracy — `@adapter` marks the class implementing a port; factories create adapters but are not themselves adapters
- Context: Round 2 S1 — createSkillsProvider() JSDoc had `@adapter implements {@link SkillsProvider}` copied from FileSkillsLoader's JSDoc; removed the tag from the factory while keeping it on the class. When introducing a `create<Port>Provider()` factory next to an `@adapter` class, only annotate the class with `@adapter`.

## [PR #96 | worktree-refactor+ports-jobs-slice | 2026-05-22]
- Violation: Multiple JSDoc tags packed on a single line (`@port @internal`) — standard JSDoc/TypeDoc parsers consume `@internal` as `@port`'s description text instead of treating it as an independent tag
- Rule: JSDoc tag declaration — each block tag must be on its own line so parsers (TypeDoc included) recognize them as independent tags
- Context: Round 3 suggestion on src/domain/ports/jobStateStore.ts JobStateStore interface — split `@port @internal` into two separate lines so TypeDoc honors the `@internal` exclusion when generating docs

## [PR #104 | refactor/fear-greed-public-api | 2026-05-28]
- Violation: `scoreToLabel` function promoted from `@internal` to public API (Tier 2) without upgrading JSDoc to Tier 2 standard
- Rule: MISTAKES.md §Documentation 4.5 — Tier 2 public functions require @param and @returns JSDoc tags for IDE hover documentation; @returns type must match actual implementation
- Context: Round 1 required finding — when promoting an `@internal` function to public, its JSDoc must be upgraded from bare description to full Tier 2 format (@param input, @returns type). Applied in Round 2 by adding @param and @returns tags to scoreToLabel JSDoc.
- Pattern note: This violation type is systematic when promoting internal functions. When promoting `@internal` to public, always upgrade JSDoc tags: add missing @param blocks for each parameter and @returns for the function's return type. Easy to miss during refactoring.

- Violation: New public exports added to src/index.ts and src/index.client.ts without smoke test assertions
- Rule: Public API Smoke Tests — when wiring new public symbols through entrypoints, add basic assertions in corresponding .test.ts and .client.test.ts files to verify exports are present and callable
- Context: Round 2 recommended findings — scoreToLabel, FEAR_GREED_LABEL_CUTOFFS, POC_WINDOW_DEFAULT were added to entrypoints but had no entrypoint smoke tests. Added 3 assertions to index.test.ts (scoreToLabel callability, CUTOFFS presence/type) and 3 to index.client.test.ts verifying all three symbols export correctly.

## [Test Coverage Hardening Pass | main | 2026-05-29] — Round 1→2 approved
- Violation: Vacuous/conditional test assertion in extractJsonWithRepair.test.ts wrapped key assertion inside if-guard
- Rule: Test assertions must be deterministic and unconditional — assertions wrapped in if-guards silently skip when input does not match the guard condition, masking incomplete test coverage
- Context: Round 1 required finding — test wrapped `expect(msg).toContain('near:')` in `if (/position\s+\d+/.test(msg))`, so inputs lacking position token silently skipped the assertion. Fixed by making the test deterministic: added separate case for no-position input asserting `near:` is absent, and position-bearing path is asserted by dedicated deterministic case.

- Violation: JSDoc referenced call-site context instead of timeless role description
- Rule: FF Readability — JSDoc must describe a function's stable role and contract, not its call-site context; "Exported for unit testing of X logic" becomes stale when call-sites change
- Context: Round 1 recommended findings — two newly-exported `@internal` helpers had JSDoc reading "Exported for unit testing of the ... logic". Fixed by removing call-site reference and keeping role description only.

- Violation: Untested branch after edge input — OBV NaN-input test stopped at the NaN bar and did not assert recovery on following finite-close bar
- Rule: Edge-case test coverage — when testing edge input (NaN, null, empty), fixture must assert normal accumulation resumes after the edge case passes
- Context: Round 1 recommended findings — OBV accumulator logic must recover after a NaN bar. Extended test fixture to assert normal accumulation continues on the next finite-close bar.

## [PR #106 | test/improve-coverage-hardening | 2026-05-29] — review comment fixes
- Violation: Coverage threshold lowered in vitest.config.ts without updating the docs that mandate the target
- Rule: Documentation Sync — when changing an enforced threshold/policy in config, every doc stating that policy must be updated in the same change, or config and docs silently diverge
- Context: vitest threshold was lowered 100%→90% and `application/` added to coverage.include, but CONVENTIONS.md / MISTAKES.md / layer CLAUDE.md still said "100% (필수)". Per maintainer decision, aligned all docs (CONVENTIONS.md §Coverage Targets, MISTAKES.md rules 15 & Infrastructure 2, domain/infra/application CLAUDE.md, PR_FIX_FLOW.md checklist) to 90%.

- Violation: Test mock generic declared a parameter as `unknown` instead of the real domain type
- Rule: TypeScript — a mock/stub generic signature should use the actual domain type so it is verified against the real function signature at compile time (the test-file `as`-cast exception does not justify widening a typed mock generic to `unknown`)
- Context: sectorSignals.test.ts stubbed computeStockSignalResult with `vi.fn<(stock: unknown, ...)>`; the real first parameter is `SectorStock`. Imported SectorStock and replaced both `unknown` occurrences.

## [PR #114 R2 | refactor/fear-greed-public-api | 2026-05-29] — @internal re-export contradiction
- Violation: `src/application/market/types.ts:17` and `:27` had `@internal` tags on bare `export type { X }` re-export statements (UserApiKeyRequiredError, AnalysisUsageOptions) even though both types are reachable from public exports in src/index.ts (union member of public SubmitAnalysisErrorResult; field of public SubmitAnalysisOptions)
- Rule: MISTAKES.md §Public API & Module Exports Rule 9 — re-export statement contradiction scan must include bare `export type { X }` statements, not just type definitions. Intermediate re-export statements can carry @internal tags that contradict the public export, hidden from plain definition audits.
- Context: Reverted both re-export statements to origin/main form (no @internal, accurate comment). Full contradiction scan (definitions + bare `export type { X }` re-exports vs index exports) now reports 0. Updated MISTAKES.md Rule 9 to explicitly cover re-export-statement scan in the reachability audit procedure.

## [PR #115 | feat/hashClientIp-jsdoc-tokenStore-cancelJob | 2026-05-29] — Whole-file @internal sweep + surviving public export JSDoc audit
- Violation 1: `src/infrastructure/chat/tokenStore.ts` `hashClientIp` — re-exported from src/index.ts (Tier 3) but had NO JSDoc; CONVENTIONS.md Tier 3 requires description + @param + @returns. Root cause: @internal tagging sweep checked that non-public siblings got tagged but did not verify surviving PUBLIC sibling's JSDoc completeness.
- Violation 2: `src/infrastructure/jobs/queue.ts` `cancelJob` — had description + @param but missing @returns JSDoc tag (Tier 3 requirement).
- Rule: MISTAKES.md §9.5 with added facet — when conducting whole-file sweep to tag non-public exports @internal, enumerate ALL surviving public exports in that same file and verify each meets Tier 3 JSDoc requirements (description + @param + @returns per CONVENTIONS.md). The existing rule covers "tag every non-re-exported export @internal" but not "audit surviving public exports' JSDoc completeness during the sweep".
- Context: Both violations fixed by adding/completing JSDoc. Pattern: sweeps that batch-tag exports often miss JSDoc verification on survivors, relying on reviewers to catch missing tags one-by-one in follow-up rounds. Lesson: before considering @internal tagging complete, verify JSDoc completeness on public survivors by reading ALL public functions in touched files.

## [PR #115 | feat/hashClientIp-jsdoc-tokenStore-cancelJob | 2026-05-30] — Round 2: Public JSDoc {@link} reference audit
- Violation 1: `cancelJob` (public Tier 3) JSDoc `{@link isJobCancelled}` referenced a symbol PR7 made @internal. Under TypeDoc `excludeInternal: true`, renders as broken link + points consumers at inaccessible symbol (Documentation Sync #3 — broken public API references).
- Violation 2: `computeBarsEffectiveTtl` (public) JSDoc `{@link computeEffectiveTtl}` similarly broke when target became @internal.
- Violation 3: `NewsTimeRange` kept public but ONLY reachable via @internal `NewsProvider.fetchNews()` (no public call path); resolved by @internal'ing `NewsTimeRange` also, removing from src/index.ts re-exports.
- Violation 4: Scoped proactive scan — ran grep for `{@link}` across codebase scoped to PR7's swept 27 symbols; confirmed zero remaining public-JSDoc references pointing to those specific swept symbols after fixes. (Comprehensive cross-symbol audit completed in R3.)
- Rule: MISTAKES.md §9.5 sub-facet — when a bulk @internal/removal sweep converts symbols to @internal, scan all remaining public exports' JSDoc blocks for `{@link symbol-name}` references pointing to newly-@internal targets. Rewrite references as prose to avoid TypeDoc broken links under excludeInternal mode. Pattern: reachability audits miss JSDoc link validity; bulk sweeps create orphaned `{@link}` references that render broken in generated docs.
- Context: All 4 violations fixed in R2. Root cause: @internal sweep completed without validating public-JSDoc link targets remain public. Lesson: after @internal'ing symbols in a sweep, grep `{@link}` in all non-@internal JSDoc blocks and rewrite references to targets that became @internal.

## [PR #115 | feat/hashClientIp-jsdoc-tokenStore-cancelJob | 2026-05-30] — Round 3: Comprehensive {@link} audit against full non-public symbol set
- Violation 1: `src/application/market/peekAnalysisCache.ts` (PR7-touched file) contained `{@link normalizeCachedAnalysisResponse}` ×2 — target symbol was @internal'd in PR5, not among PR7's 27 swept symbols, breaking public documentation links.
- Violation 2: `src/application/market/peekAnalysisCache.ts` contained `{@link DEFAULT_ANALYSIS_MODEL_ID}` — target symbol never exported public, breaking link.
- Violation 3: `src/application/market/peekAnalysisCache.ts` contained `{@link isEmptyAnalysis}` (module-private) — marked as Suggestion but fixed proactively.
- All 4 fixed by replacing `{@link}` with inline-code prose (e.g., `` `normalizeCachedAnalysisResponse` ``). Comprehensive re-scan of ALL PR7-touched files against the FULL set of non-public symbols (all @internal from any PR + all module-private symbols) now reports zero broken public-JSDoc `{@link}` references.
- Rule: MISTAKES.md §9.5 {@link} facet refined — when conducting a whole-file @internal/removal sweep that touches multiple files, the subsequent {@link} audit must check ALL remaining public-JSDoc references against EVERY non-public symbol in the repo (all @internal, all non-exported module-private), not only symbols swept in the current PR. Touching a file invites review of ALL its public documentation links.
- Context: R2 scoped the scan to PR7's 27 swept symbols only; R3 audited against the complete non-public symbol universe across the entire PR7-touched file set. Lesson: cross-file sweeps require cross-symbol audits, not symbol-scoped audits. A touched file's JSDoc links can reference symbols from any PR's @internal'ing, not just the current change.

