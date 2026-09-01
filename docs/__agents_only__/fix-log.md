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


## [feat/prompt-region-context | 2026-08-19] — 프롬프트 지역 전제 제거 (R1~R6, approved)

- Violation 1: 프로그래밍 치환을 **확인 없이 완료 보고** — 6라운드에 걸쳐 5회
  Rule: MISTAKES.md §Documentation Sync 3 / §Coding Paradigm 6.5 — 편집 후 grep 카운트로 적용 여부를 확인하기 전에는 완료로 보고하지 않는다
  Context: 매번 같은 메커니즘이었다. prettier가 대상 문자열을 여러 줄로 재포맷한 뒤, 한 줄짜리 옛 문자열로 치환을 시도해 조용히 0건 매치. 대상: `config.ts` 해시 필드목록, `@see submitEconomicEventAnalysis`(2회), 중복 테스트 제거, malformed 분기 단언 추가. 전부 리뷰어가 잡았고, 그중 한 번은 리뷰어가 스크래치패드에 직접 변이를 주입해 "당신의 변이 검증 주장은 성립하지 않는다"고 반박했다 — 맞았다.
  Fixed: R6까지 전부 적용 + 이후 편집은 grep 카운트로 확인

- Violation 2: 부재 단언을 **그것이 들어갈 수 없는 앵커**에 걸어 항상 참
  Rule: MISTAKES.md §Tests 13.5 — 무언가의 부재를 단언하기 전에 그 앵커가 그것을 담을 수 있음을 먼저 증명한다
  Context: few-shot 가드가 `Input:` 줄에 `not.toContain('한국은행')`을 걸었는데, `Input:` 줄에는 구조상 `interpretationKo`가 없다. 예시 내용과 무관하게 통과.
  Fixed: `fewShotOutputFor()`로 그 예시 자신의 `Output:` 줄에 단언

- Violation 3: 위치 조회 헬퍼가 **앞으로 훑어** 삭제된 대상이 이웃으로 조용히 해석됨
  Rule: MISTAKES.md §Tests 13.5 — 위치 기반 조회는 기대 위치만 읽고 아니면 throw
  Context: `lines.slice(i+1).find(l => l.startsWith('Output: '))`는 그 예시의 Output만 지워졌을 때 다음 예시의 Output을 돌려줬다. 없애려던 "항상 참" 단언이 되살아난다.
  Fixed: `lines[i + 1]`만 읽고 형식이 아니면 throw

- Violation 4: 프롬프트가 **자기 few-shot과 모순**
  Rule: MISTAKES.md §Coding Paradigm 6.5 — 지시문과 예시가 어긋나면 예시가 이긴다. LLM은 산문 규칙보다 시연을 따르므로 규칙이 무력화된다
  Context: `interpretationKo` 규칙이 "통화정책 발표일 때만 중앙은행 명시"라고 했는데 미국·한국 CPI few-shot이 둘 다 연준/한국은행을 명시했다. CPI는 통계청 발표다.
  Fixed: 게이트를 "정책 경로에 닿는 발표(정책 결정·물가·고용)"로 넓혀 예시와 정합

- Violation 5: 프롬프트가 **거짓을 사실로 단정**
  Rule: 프롬프트는 모델에게 사실 주장을 한다 — 코드처럼 검증할 것
  Context: "설문 데이터는 중앙은행 발표가 아니다"라고 썼는데 한국은행이 소비자심리지수(CCSI)·기업경기실사지수(BSI)를 발표한다. 비-미국 귀속을 바로잡으려는 프롬프트가 정작 그 시장의 참인 귀속을 막고 있었다.
  Fixed: 소유권 단정 삭제, "전달 경로가 발행 주체보다 독자에게 중요하다"로

- Violation 6: 규칙의 **불리언 구조가 의도를 뒤집음**
  Rule: 두 분기가 서로 다른 접속사를 쓰면 실제 입력을 양쪽에 통과시켜 볼 것
  Context: `bullish: beats estimate AND …` / `bearish: misses estimate OR …`. `AND`가 거른 것을 `OR`가 전부 삼켜, 금리 인하 서프라이즈와 예상보다 낮은 CPI가 bearish로 분류됐다. 프로덕션 입력(한국은행 금리 결정, KR CPI, GDP)으로 확인.
  Fixed: 부호가 아니라 경제적 의미로 판단하도록 재작성 + 반전 지표군 명시


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


## [PR #98 | worktree-agent-a72bc4671dbf75a3c | 2026-05-22]
- Violation: Port return DTO (`UsageCounts`) co-located in `domain/ports/usageRepository.ts` instead of `domain/types.ts`
- Rule: `domain/CLAUDE.md` Authoring Rules — "DTOs the port returns or receives stay in `domain/types.ts`. Ports reference them via import."
- Context: Round 3 Blocker B1 — `UsageCounts` is `UsageRepository.getUsageToday`'s return DTO, mirroring `UsageLogRecord` (already moved). Co-location is reserved for option/argument types (`RecordUsageInput`, `CreateUsageLogInput`). Moved interface to `domain/types.ts` Usage Tracking section, updated imports in `usageRepository.ts` + `application/usage/limits.ts`, and synced symbol tables in `domain/CLAUDE.md`, `docs/ARCHITECTURE.md`, and `src/index.ts` re-exports.

## [PR #92 | refactor/ports-ai-module | 2026-05-22]
- Violation: `@deprecated` JSDoc migration hint points to a non-equivalent type (`ConversationTurn['text']` is `string`, but the deprecated alias `GeminiPart` is an object `{ text: string }`)
- Rule: MISTAKES.md Documentation/JSDoc — deprecation notes must accurately describe the migration path; misleading guidance is worse than no guidance
- Context: Suggestion S1 (round 3) — `GeminiPart` deprecation note "Use `ConversationTurn['text']` instead" would mislead consumers into replacing `{ text: string }` with `string`. Rewrote the JSDoc on both `src/index.ts` and `src/index.client.ts` to explain that `parts: GeminiPart[]` was flattened into `text: string` on `ConversationTurn` and that the type has no direct equivalent.

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

## [Consumer typecheck validation post-merge | main | 2026-05-30] — Cross-repo reachability audit gap
- Violation: Bulk dead-export cleanup (PR6+PR7) deleted `SectorGroupDef` and @internal'd `NewsTimeRange` despite both being public contract for consumer-instantiated/implemented code
- Context: Post-merge validation (removed-since-0.15.0 public symbols ∩ all consumer imports == 0) found 2 breakages all reviewers missed (core-only reachability audit + review-agent + GitHub claude-review + Gemini):
  - `SectorGroupDef`: core's `src/index.ts` exported it, but deleted as "unused". siglens types its own `export const SECTOR_GROUPS: readonly SectorGroupDef[]` — consumer instantiates config with the type.
  - `NewsTimeRange`: core's `src/index.ts` exported it but PR7 @internal'd as "only NewsProvider.fetchNews uses it" — siglens + siglens-trader implement NewsProvider adapters that take `range: NewsTimeRange` param. Consumers implement the port, so port param types are public contract.
- Rule: MISTAKES.md §9 reachability audit — NEW REQUIRED STEP before export removal/demotion: Cross-check all 3 consumer repos (../siglens, ../siglens-worker, ../siglens-trader) for `grep` matches of the symbol and for `import ... from '@y0ngha/siglens-core'`. A symbol imported or implemented by any consumer is public contract regardless of core-internal reachability. Core-only reachability audit is necessary but NOT sufficient — consumer-import cross-check is mandatory before merge, and a final post-merge intersection check (removed-symbols ∩ consumer-imports == 0) is the gate.
  - Sub-principle: Consumer-implemented ports — domain port param/return types are public contract because consumers provide the adapter implementations (consumers are the "users" of the port interface, even if core never calls them by name).
  - Sub-principle: Consumer-instantiated config types — a type can be unused inside core yet consumers type their own constants/config exports with it (SectorGroupDef in consumer's SECTOR_GROUPS).
- Promoted: YES — extend MISTAKES.md §9 with mandatory consumer cross-check procedure before removal/demotion of any public export.

## [PR #160 R4 | feat/chart-pattern-screener | 2026-07-03]
- Violation: `CURVATURE_VERTEX_MID_LO` and `CURVATURE_VERTEX_MID_HI` in `src/domain/patterns/constants.ts` shared a single `/** @internal ... */` JSDoc block above the first declaration
- Rule: MISTAKES.md §Documentation — TypeDoc attaches a JSDoc block only to the immediately-following declaration; a shared comment above two sibling `export const` statements silently leaves the second one undocumented in generated docs, even though the source reads as if both are covered
- Context: PR #160 review round 4 suggestion — the shared block described both constants together ("the fraction-of-span range within which..."), but TypeDoc renders `CURVATURE_VERTEX_MID_HI` with no doc at all. Fixed by giving each constant its own `@internal` JSDoc block, mirroring the per-constant style used by every other constant in the file.

## [PR (feat/market-fear-greed) R1 | Market-wide Fear & Greed domain module | 2026-08-15]
- Violation 1: `src/domain/indicators/marketFearGreed/composition.ts` — `export interface MarketComposition` exported without `/** @internal */` tag, not re-exported in `src/index.ts`
  Rule: MISTAKES.md §9.5 — intermediate interfaces must carry `@internal` tag if not re-exported
  Fixed in R2: deleted intermediate interface, returned `Omit<MarketFearGreedSnapshot, 'asOf'>` instead

- Violation 2: `src/domain/indicators/marketFearGreed/align.ts` — three `as` casts with no comment explaining safety: `{} as Record<...>` ×2, `map.get(date) as number` ×1
  Rule: MISTAKES.md §TypeScript 7 — `as` casts must include invariant comments at cast site
  Fixed in R2: added invariant comments at each cast site

- Violation 3: `src/domain/indicators/marketFearGreed/align.ts` — `input[key] ?? []` guard branch had no dedicated test
  Rule: MISTAKES.md §Tests 5.5 — guard branches need dedicated test coverage
  Fixed in R2: added test deleting one series key, asserts empty join; now 100% coverage

- Violation 4 (RECOMMENDED): `types.ts` — inline `'normal' | 'limited'` union duplicated sibling's `Exclude<FearGreedConfidence, 'insufficient'>`
  Rule: MISTAKES.md §TypeScript 6 — avoid duplicating named types; reuse instead
  Fixed in R2: replaced with reuse of named type

- Violation 5 (RECOMMENDED): `factors.ts` — `sma(closes.slice(0, t + 1), window)` allocated O(t) prefix copy per session → O(n²) history computation
  Rule: Performance — avoid redundant allocations in hot loops
  Fixed in R2: slice only the window, not prefix

- Violation 6 (RECOMMENDED): `walkForward.ts` — `.map()` callback mutating outer `sample` array via `push`
  Rule: CONVENTIONS.md array-mutation rule + FF 1-G viewpoint shift
  Fixed in R2: rewrote as explicit `for` loop over pre-allocated array

## [PR | refactor/cheap-jobs-back-to-gemini | 2026-08-20] — Cheap jobs model migration R1→R2

- Violation 1 (RECOMMENDED): `src/domain/analysis/modelSpecs.ts` — `ReadonlySet<string>` used for constant with restricted values when precise literal union `GeminiModelId` already existed in same file
  Rule: TypeScript — use precise literal unions (not generic string) for constants with a closed set of valid values; repo precedent uses `ReadonlySet<CandlePattern>` etc.
  Context: Imprecise type lost compile-time protection; test required `as ActiveModelId` cast to accommodate string type
  Fixed in R2: Changed to `ReadonlySet<GeminiModelId>` for type precision and eliminated cast

- Violation 2 (RECOMMENDED): `docs/PUBLIC_API.md` — new public exports added to inline inventory without dated changelog row
  Rule: MISTAKES.md §Public API 1 — PUBLIC_API.md convention requires a dated changelog row appended for every additive public-API change; inline list alone is insufficient
  Context: When exports are added to public API, the changelog row documents the version/date/reason; omitting it breaks the convention
  Fixed in R2: Added dated changelog row documenting the new public exports

## [Consumer typecheck validation | uncommitted (2 rounds, approved) | 2026-09-01]

- Violation 1 (RECOMMENDED): `src/domain/analysis/ai-levels.ts` — optional parameter given same `= 'USD'` default at three stacked layers, making inner two defaults dead code
  Rule: MISTAKES.md §Coding Paradigm 6.5 — when function implementation changes, all related functions in the same module must use a consistent approach; defaults must resolve at exactly one boundary
  Context: Module pattern (`locale` parameter) resolves default exactly once at outermost boundary. New `currency` parameter repeated the default at three nesting layers (inner two unreachable on real call path). Each layer added defensive default thinking independently without recognizing the stacking.
  Fixed: Made inner two `currency` parameters required, resolving default only at outermost boundary per module convention

- Violation 2 (RECOMMENDED): Output-affecting option (`currency`) deliberately excluded from analysis cache key, relying on a consumer-side invariant core cannot enforce
  Rule: Cache key contracts must either include all output-affecting parameters or document the invariant constraint explicitly in the type/function JSDoc
  Context: Core cannot enforce `currency` parity on all analysis callers; consumer repo (`siglens`) must guarantee the invariant. Mitigated by adding explicit invariant tests in consumer confirming `currency` is identical across re-used cached results.
  Fixed: Mitigated in consumer-side (siglens) tests; core cache function JSDoc does not require changes per core-consumer contract

