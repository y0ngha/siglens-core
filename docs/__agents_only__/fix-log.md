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
