# Fix Log

## [릴리스 v0.47.1 → v0.47.2 | 2026-08-19] — GitHub Packages 산출물 손상

- Symptom: `yarn install`이 `@y0ngha/siglens-core@npm:0.47.1: All versions satisfying "0.47.1" are quarantined`로 실패
- 실제 원인: 레지스트리 메타데이터는 정상(`dist-tags.latest = 0.47.1`, tarball URL 존재)인데
  tarball 다운로드가 `409 {"error":"Package file checksum mismatch"}`. 같은 레포의 `0.47.0`은 `302` 정상.
  Publish 워크플로는 `Package archive published` / `success`로 끝났다 — **워크플로 성공이 산출물 사용 가능을 뜻하지 않는다.**
- 5분 이상 폴링해도 409 고정이라 전파 지연이 아니었다. GitHub Packages는 동일 버전 재발행을 허용하지 않으므로 버전을 건너뛰고 재발행.
- Rule: 릴리스 후 **소비자 버전을 올리기 전에 tarball을 직접 받아 본다.**
  `curl -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" <dist.tarball>` → 302여야 정상.
  yarn의 "quarantined"는 인증 문제로 오인하기 쉽지만 실제로는 "tarball을 못 받는다"는 뜻이다.


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


## [PR #99 | refactor/skills-domain-ports-migration | 2026-05-22]
- Violation: `@adapter implements {@link Port}` JSDoc tag applied to a factory function (createSkillsProvider) rather than the implementing class
- Rule: Documentation accuracy — `@adapter` marks the class implementing a port; factories create adapters but are not themselves adapters
- Context: Round 2 S1 — createSkillsProvider() JSDoc had `@adapter implements {@link SkillsProvider}` copied from FileSkillsLoader's JSDoc; removed the tag from the factory while keeping it on the class. When introducing a `create<Port>Provider()` factory next to an `@adapter` class, only annotate the class with `@adapter`.

## [PR #96 | worktree-refactor+ports-jobs-slice | 2026-05-22]
- Violation: Multiple JSDoc tags packed on a single line (`@port @internal`) — standard JSDoc/TypeDoc parsers consume `@internal` as `@port`'s description text instead of treating it as an independent tag
- Rule: JSDoc tag declaration — each block tag must be on its own line so parsers (TypeDoc included) recognize them as independent tags
- Context: Round 3 suggestion on src/domain/ports/jobStateStore.ts JobStateStore interface — split `@port @internal` into two separate lines so TypeDoc honors the `@internal` exclusion when generating docs

## [PR #104 | refactor/fear-greed-public-api | 2026-05-28]
- Violation: New public exports added to src/index.ts and src/index.client.ts without smoke test assertions
- Rule: Public API Smoke Tests — when wiring new public symbols through entrypoints, add basic assertions in corresponding .test.ts and .client.test.ts files to verify exports are present and callable
- Context: Round 2 recommended findings — scoreToLabel, FEAR_GREED_LABEL_CUTOFFS, POC_WINDOW_DEFAULT were added to entrypoints but had no entrypoint smoke tests. Added 3 assertions to index.test.ts (scoreToLabel callability, CUTOFFS presence/type) and 3 to index.client.test.ts verifying all three symbols export correctly.

## [PR #160 R4 | feat/chart-pattern-screener | 2026-07-03]
- Violation: `CURVATURE_VERTEX_MID_LO` and `CURVATURE_VERTEX_MID_HI` in `src/domain/patterns/constants.ts` shared a single `/** @internal ... */` JSDoc block above the first declaration
- Rule: MISTAKES.md §Documentation — TypeDoc attaches a JSDoc block only to the immediately-following declaration; a shared comment above two sibling `export const` statements silently leaves the second one undocumented in generated docs, even though the source reads as if both are covered
- Context: PR #160 review round 4 suggestion — the shared block described both constants together ("the fraction-of-span range within which..."), but TypeDoc renders `CURVATURE_VERTEX_MID_HI` with no doc at all. Fixed by giving each constant its own `@internal` JSDoc block, mirroring the per-constant style used by every other constant in the file.

## [PR | refactor/cheap-jobs-back-to-gemini | 2026-08-20] — Cheap jobs model migration R1→R2

- Violation 2 (RECOMMENDED): `docs/PUBLIC_API.md` — new public exports added to inline inventory without dated changelog row
  Rule: MISTAKES.md §Public API 1 — PUBLIC_API.md convention requires a dated changelog row appended for every additive public-API change; inline list alone is insufficient
  Context: When exports are added to public API, the changelog row documents the version/date/reason; omitting it breaks the convention
  Fixed in R2: Added dated changelog row documenting the new public exports

## [Branch fix/prompt-precision-currency R1 | 2026-09-11] — Round 1 hotfix: import, JSON parsing

- Violation 1: `import type` placed after declarations in analysisUtils.ts instead of at top of file
  Rule: CONVENTIONS.md — import-types-at-top
  Context: Import type statements must be grouped at the top of the file before other code and declarations. Fixed in Round 1 hotfix.

- Violation 2: JSON salvage algorithm too broad — scanned for first `{` anywhere in text
  Rule: Infrastructure safety — JSON parsing validation
  Context: JSON salvage function risked false positives from prose containing `{}` stray pairs. Restricted scan to text starting with `{`, reducing false parse attempts. Fixed in Round 1 hotfix.

## [Branch fix/prompt-precision-currency R1 | 2026-09-11] — Round 1 main: overloads

## [Branch fix/prompt-precision-currency | 2026-09-11] — Lesson: Real-data validation required for prompt changes

- Lesson (non-blocker, verification finding): Prompt-number changes must be validated by rendering real data and comparing distributions, not only by unit tests
  Rule: Testing best practice — prompt logic verification scope
  Context: Audit recommendation to floor structural risk:reward leg at one mean bar range passed all 90+ unit tests but, when rendered over real market data (90 charts), flipped 34 verdicts from >= 1.0 to < 1.0 and made verdict sentences false. Recommendation was removed post-R1. Unit test coverage is insufficient for prompt calculations involving conditional defaults or output transformations. Rendering real data distributions before deployment is mandatory.

## [PR #196 | fix/prompt-precision-currency | 2026-09-11] — Round 1 findings

- Violation 1: `PLAIN_NUMBER_SIGNIFICANT_DIGITS` constant changed from 10 to 15 in promptFormat.ts, affecting formatPlainNumber; importers macroBriefingPrompt.ts and economicEventPrompt.ts had cache version constants not updated (MACRO_BRIEFING p1→p2, ECONOMIC_EVENT p4→p5 missed)
  Rule: MISTAKES Infrastructure Functions #6 — cache template version must be bumped when rendered bytes change
  Context: Shared formatter constant change ripples to cache versions of all using prompts. Lesson: for every changed definition in a shared prompt-format module, `git grep -l <name>` its importers and verify each cache version constant reflects the output change. Fixed in R1 by bumping both cache versions.

## [PR #196 | fix/prompt-precision-currency | 2026-09-11] — Round 2 findings

- Violation 4: `callAnalysisAi` rethrow of non-SyntaxError from `normalizeJsonResponse` was untested
  Rule: MISTAKES Infrastructure Functions #2 — unreachable-looking guard/throw branches still need a test
  Context: Guard branches appear dead but handle edge cases; exhaustive test of error branches required. Fixed in R2 by adding test case exercising the rethrow path.

- Violation 5: `meanBarRangePercent` reimplemented bar validity (`close > 0 && high >= low`) instead of reusing `hasUsablePrices` helper introduced by the same PR
  Rule: Single-entry-point helper reuse — shared guard/utility helper must be called from all internal callers, not reimplemented
  Context: Same PR introduced `hasUsablePrices` but one helper in the same module reimplemented the same logic. Fixed in R2 by calling `hasUsablePrices`.

## [Branch fix/agent-answer-hygiene | Round 1→2 | 2026-09-13]

- Violation 1: Prompt citation example showed ET (Eastern Time) while a new adjacent rule mandates KST (Korean Standard Time) for Korean answers
  Rule: Documentation Consistency — when documentation includes examples, all examples must be synchronized when new rules are added
  Context: The instruction for prompt citation was updated in one location but a sibling example showing time format still used ET. Fixed in Round 2 by updating example to show KST to match the new rule.

- Violation 2: Two new prompt rules (web snippet attribution/staleness, disclaimer suppression) added without test assertions
  Rule: Test Coverage for New Rules — when introducing new rules or logic, add test assertions to verify the rule is enforced
  Context: The new rules lacked any test cases verifying their behavior. Fixed in Round 2 by adding assertions for each new rule.


## [PR | feat/deepseek-stall-gemini-fallback | 2026-09-15] — Fallback provider routing & model dispatch R1→R3

- Violation 1 (R1 REQUIRED c/d): Exports DEEPSEEK_STALL_TIMEOUT_MS, DEEPSEEK_STALLED_CODE, DEEPSEEK_FALLBACK_MODEL added to src/index.ts without @internal JSDoc tags
  Rule: MISTAKES.md #9.5 — Module-internal exports missing @internal JSDoc tag
  Context: Three fallback routing internals exported from package entrypoint without @internal marking. Recurring pattern (cited in MISTAKES.md as PR #110, PR #5 R1/R2).

- Violation 2 (R1 REQUIRED b): groundedNumbers epsilon constant scaled by value magnitude (±3500 at 3.5e12) instead of fixed tolerance
  Rule: Infrastructure Functions — numeric parsing tolerance scaling
  Context: Epsilon defense against float rounding in structured LLM output parsing. Depends on asset price order of magnitude; accepted as design.

- Violation 3 (R2 RECOMMENDED): SubmitMarketNewsDigestOptions interface missing new providerFallback option field
  Rule: MISTAKES.md #6.5 — State/function/documentation divergence; related types not synchronized
  Context: providerFallback option added to AnalysisOptions, ChatOptions, and other dispatch option siblings; SubmitMarketNewsDigestOptions omitted. Fixed in R2.




## [PR #210 | feat/peek-market-news-digest-cache | 2026-09-17] — Review findings R1

- Violation 1: Parameter type of public function tagged @internal but not exported from index
  Rule: MISTAKES.md Public API #8 — Public discriminated union variant types wrongly tagged @internal
  Context: Tier 1 public function parameter type was marked @internal despite being part of public contract. Removed @internal tag and ensured type is re-exported from src/index.ts.

- Violation 2: Import members not in alphabetical order
  Rule: MISTAKES.md #13.5 — Import statements not alphabetically sorted
  Context: Imports from same module not alphabetically ordered. Fixed by reordering members alphabetically within import block.

- Violation 3: New helper module without dedicated unit test file
  Rule: Test conventions — new helper module requires dedicated .test.ts file
  Context: New helper module added without corresponding test file. Fixed by adding dedicated test file following module sibling convention.

- Violation 4: Untested conditional branch (undefined case)
  Rule: MISTAKES.md Tests #5.5 — New conditional branches require dedicated test cases
  Context: Branch handling undefined case added but not covered by test. Fixed by adding test case exercising the undefined path explicitly.

