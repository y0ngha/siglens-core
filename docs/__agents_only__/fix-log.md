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


## [PR #96 | worktree-refactor+ports-jobs-slice | 2026-05-22]
- Violation: Multiple JSDoc tags packed on a single line (`@port @internal`) — standard JSDoc/TypeDoc parsers consume `@internal` as `@port`'s description text instead of treating it as an independent tag
- Rule: JSDoc tag declaration — each block tag must be on its own line so parsers (TypeDoc included) recognize them as independent tags
- Context: Round 3 suggestion on src/domain/ports/jobStateStore.ts JobStateStore interface — split `@port @internal` into two separate lines so TypeDoc honors the `@internal` exclusion when generating docs

## [PR #104 | refactor/fear-greed-public-api | 2026-05-28]
- Violation: New public exports added to src/index.ts and src/index.client.ts without smoke test assertions
- Rule: Public API Smoke Tests — when wiring new public symbols through entrypoints, add basic assertions in corresponding .test.ts and .client.test.ts files to verify exports are present and callable
- Context: Round 2 recommended findings — scoreToLabel, FEAR_GREED_LABEL_CUTOFFS, POC_WINDOW_DEFAULT were added to entrypoints but had no entrypoint smoke tests. Added 3 assertions to index.test.ts (scoreToLabel callability, CUTOFFS presence/type) and 3 to index.client.test.ts verifying all three symbols export correctly.

## [Branch fix/prompt-precision-currency R1 | 2026-09-11] — Round 1 hotfix: import, JSON parsing

- Violation 1: `import type` placed after declarations in analysisUtils.ts instead of at top of file
  Rule: CONVENTIONS.md — import-types-at-top
  Context: Import type statements must be grouped at the top of the file before other code and declarations. Fixed in Round 1 hotfix.

- Violation 2: JSON salvage algorithm too broad — scanned for first `{` anywhere in text
  Rule: Infrastructure safety — JSON parsing validation
  Context: JSON salvage function risked false positives from prose containing `{}` stray pairs. Restricted scan to text starting with `{`, reducing false parse attempts. Fixed in Round 1 hotfix.

## [Branch fix/prompt-precision-currency R1 | 2026-09-11] — Round 1 main: overloads

## [Branch fix/agent-answer-hygiene | Round 1→2 | 2026-09-13]

- Violation 1: Prompt citation example showed ET (Eastern Time) while a new adjacent rule mandates KST (Korean Standard Time) for Korean answers
  Rule: Documentation Consistency — when documentation includes examples, all examples must be synchronized when new rules are added
  Context: The instruction for prompt citation was updated in one location but a sibling example showing time format still used ET. Fixed in Round 2 by updating example to show KST to match the new rule.

- Violation 2: Two new prompt rules (web snippet attribution/staleness, disclaimer suppression) added without test assertions
  Rule: Test Coverage for New Rules — when introducing new rules or logic, add test assertions to verify the rule is enforced
  Context: The new rules lacked any test cases verifying their behavior. Fixed in Round 2 by adding assertions for each new rule.


## [PR #210 | feat/peek-market-news-digest-cache | 2026-09-17] — Review findings R1

- Violation 1: Parameter type of public function tagged @internal but not exported from index
  Rule: MISTAKES.md Public API #8 — Public discriminated union variant types wrongly tagged @internal
  Context: Tier 1 public function parameter type was marked @internal despite being part of public contract. Removed @internal tag and ensured type is re-exported from src/index.ts.

- Violation 3: New helper module without dedicated unit test file
  Rule: Test conventions — new helper module requires dedicated .test.ts file
  Context: New helper module added without corresponding test file. Fixed by adding dedicated test file following module sibling convention.

## [Branch feat/precomputed-prompt-data | 2026-09-19] — Precomputed prompt data R1→R6

- Violation 8 (R5 REQUIRED): Geometry defined from wrong pivot kind — cup/rounding-bottom rim calculated from low pivots instead of bounding high pivot
  Rule: Pattern geometry — boundary pivots must use the correct type (high for cup rim, low for valley bottom)
  Context: Cup/rounding-bottom patterns used findMin (low pivots) to define rim, conflating interior low with boundary definition. Fixed by using correct high-pivot bounding logic to define rim position.

## [PR #214 | feat/precomputed-prompt-data | 2026-09-19] — Precomputed prompt data R6 review findings

- Violation 3 (R6 CLEANUP): Internal review-round reference tags left in production comments and test names
  Rule: Production code — internal development/coordination tags must not be committed
  Context: Tags like "review R6", "review round 2", "coordinator item C3" were used during development reviews but left in code. Removed all internal reference tags from comments and test names.


## [feat/agent-adaptive-depth Round 1 | 에이전트 답변 깊이 자동 선택 | 2026-09-19]
- Violation: 프롬프트 규칙을 수준(Plain/Detailed)별로 나누면서 컨플루언스 null 처리를 Detailed에만 남겨, Plain 답에서는 데이터 없이 "지표 의견" 합의를 말하게 되는 분기가 비었다
  - Rule: (new) 프롬프트 규칙을 조건(수준·도구 가용성 등)으로 쪼갤 때는 모든 조건 분기에 null/부재 처리를 남긴다 — 한쪽에만 두면 다른 쪽이 근거 없는 추정으로 채운다
  - Context: 리뷰 라운드 1 지적. 두 수준 모두 "이력이 짧아 집계가 없다"고 말하도록 고치고 테스트로 고정

## [fix/overall-technical-cache-key-parity | 2026-09-20] — Type-surface change, cache-key parity

- Violation 1 (R1 REQUIRED, fixed): PUBLIC_API.md missing dated changelog row for Tier 4 type-surface change
  Rule: CONVENTIONS.md — Every field addition to Tier 4 OverallDependencyInputs / SubmitAnalysisOptions must have dated row in PUBLIC_API.md § 개정 이력 (prior additions of equal or smaller scope all documented)
  Context: OverallDependencyInputs['technical'] widened by Pick<SubmitAnalysisOptions, 'priorAnalyses' | 'marketEvents'> to resolve cache-key parity. R1 finding: PUBLIC_API.md lacked changelog row; prior equal-scope additions all had one. Fixed in R1. R2: approved.

- Verification result (architectural trap, single occurrence): Type narrowing via untyped spread bypasses test coverage
  Pattern: Type widening (Pick<...> field addition) flows through untyped spread (`...technicalRest`); type narrows in callee but runtime behavior unchanged. All 35 vitest tests pass both before and after the widening; only `yarn typecheck` TS2353 catches the type-level change.
  Rule (generalization): Type-only changes through untyped spreads cannot be guarded by runtime tests. When a change's mechanism is pure type narrowing through a spread, typecheck is mandatory. Failure mode: writing runtime test cases believing they protect type changes; tests pass silently through the narrowing.
  Context: Single occurrence. Architectural insight: type narrowing enforcement for spread-based field additions must separate from runtime test coverage. Tests cannot fail when runtime is unchanged.

## [chore/deps-2026-09 Round 1 | 의존성 업그레이드 | 2026-09-24]
- Violation (R1 REQUIRED, fixed): `@anthropic-ai/sdk` 0.114+가 `StopReason`에 `'model_context_window_exceeded'`를 추가했는데 `callClaude`는 이를 재시도 가능한 catch-all로 떨어뜨렸다(같은 입력 재시도는 같은 벽에 부딪힌다)
  - Rule: (new) SDK를 올릴 때는 어댑터가 분기하는 **열거형 응답값**(stop_reason / finishReason 등)의 union을 구·신 `.d.ts`로 diff한다 — 새 값은 목(mock) 테스트로도 실키 스모크로도 드러나지 않고 catch-all로 조용히 흡수된다
  - Context: `truncated`(max_tokens | model_context_window_exceeded) 하나로 구조화 출력 가드와 MAX_TOKENS_CODE 분기를 함께 태움. 되돌리면 실패하는 테스트 2건 추가
- Decision (not a violation): tsc-alias 1.9.x는 dist의 모든 상대 import에 `.js`를 붙인다(359파일). TS 5.9 유지 중엔 이득이 없어 `~1.8.17`로 고정 — dist가 게시된 1.14.0 tarball과 바이트 동일함을 확인. 1.9는 TS 6 전환 때 함께 올릴 것

## [Branch claude/siglens-analysis-technique-review-wvfffz | 2026-09-25] — Analysis techniques review R1→R3

### Round 1 findings (required, all fixed)

### ### Round 2 (recommended, fixed)

Round 3: approved

## [Branch fix/history-window-cache-churn | 2026-09-30] — Round 1 review findings

- Violation 3 (recommended): Pointer key computed on every generation, trade-off not documented
  - Rule: Infrastructure design trade-offs must be documented with comments explaining the choice and upgrade path
  - Context: Optimization to skip pointer key recomputation on cache-hit paths was undocumented. Fixed by adding comment explaining memory/CPU trade-off and when full recomputation would be necessary.

## [Branch fix/strategy-overlay-kind | 2026-10-01] — Strategy overlay kind type export and testing

- Violation 2 (R1 RECOMMENDED, fixed): StrategyOverlayKind literal ('divergence' | 'fibonacci' | 'elliott') duplicated across loader, resolver, and type definitions
  Rule: Code duplication — magic strings should have single source of truth
  Context: Three separate lists of kind variants consolidated into a single Record<StrategyOverlayKind, true>-backed constant in domain/overlays/constants.ts.

- Violation 3 (R1 RECOMMENDED, fixed): strategyNameToKind lookup matched any skill type instead of restricting to type==='strategy'
  Rule: Type-matching precision — restrict name lookups to intended skill type
  Context: Fixed lookup to check type==='strategy' before matching against strategy names, preventing false matches on other skill types.

- Violation 5 (R1 RECOMMENDED, fixed): Changelog lacked note that cached analyses retain old overlayKind pairing until TTL expiration
  Rule: Changelog documentation — runtime behavior must include cache semantics note
  Context: Added changelog note documenting that cached analyses keep old overlayKind pairing until TTL expiration, and consumer must deploy frontmatter changes simultaneously.

Round 2: approved

## [PR #241 claude-review | fix/overlay-resolution-followups | 2026-10-01]

- Violation 2 (APPROVED, fixed): findSkill used for…of loop with early return instead of declarative find()
  Rule: CONVENTIONS.md — loop-avoidance pattern (map/filter/find preferred over for…of)
  Context: Converted for…of with early return to .find((skill) => skill.name === patternName), aligning with codebase declarative style.

- Violation 3 (APPROVED, fixed): TechnicalAssembledPrompt.patternGeometries is a Map that may not be JSON-serializable; JSDoc did not document in-process-only scope
  Rule: MISTAKES.md Type Documentation #4 — Tier 4 public type fields require JSDoc; runtime serialization constraints must be documented
  Context: Added JSDoc note clarifying patternGeometries is a transient in-memory Map used only during prompt generation and not included in serialized analysis results.

## [review-agent | feat/overlay-invalidation-target-levels | 2026-10-02]

- Violation 1 (R1 REQUIRED, fixed): isSpentCount inferred an Elliott level's breach side from its price vs the last pivot; a complete diagonal whose wave 5 edged past the cap (within EW_DIAG_WAVE_TOLERANCE) put the cap below the last high, so a normal pullback "spent" a valid count
  Rule: Encode semantics known at build time instead of re-deriving them from geometry later
  Context: Added @internal ElliottLevel { label, price, breach } and ElliottScoredCandidate.levels; every builder sets breach when it computes the level.

- Violation 3 (R2 REQUIRED, fixed): breach directions of running impulse invalidation and attached A–B–C targets unpinned — flipping them left all tests green
  Rule: A value set per builder needs a test per builder that fails when the sign flips
  Context: End-to-end buildElliottCandidates cases on both sides of each level plus direct ElliottScoredCandidate.levels assertions; mutation-checked.

- Violation 4 (found in live render, fixed): OVERLAY_LEVEL_LABELS exported from src/index.ts but not from the browser entrypoint src/index.client.ts — the siglens chart crashed in the browser
  Rule: A public value consumed by client code must be exported from BOTH entrypoints and asserted in index.client.test.ts
  Context: Added to index.client.ts with a test assertion.

- Violation 5 (R1/R4 RECOMMENDED, fixed): tests that could pass vacuously — pattern family test with `continue` and no count assertion; isSpentPattern covered only direction 'down'; prompt wiring test whose tail made the screener drop the pattern on its own
  Rule: Assert the loop checked something; cover both branches of a sign; mutation-check wiring tests
  Context: checked >= 5 assertion, mirrored double-bottom case, wiring pinned by the fulfilled-target case (mutation-checked).

Round 5: approved

## [PR #245 claude-review | feat/overlay-invalidation-target-levels | 2026-10-02]

- Violation 1 (JSDoc on the wrong function, fixed): abcFacts' original JSDoc (C targets + zigzag invalidation) sat above the new abcLevels, leaving abcFacts undocumented; impulseLevels' JSDoc also described the facts
  Rule: Splitting a function in two means splitting its JSDoc — each function's comment must describe that function
  Context: Gave abcLevels and abcFacts their own JSDoc, rewrote impulseLevels' and added one to impulseFacts; diagonal and triangle Levels/Facts audited, already accurate.

- Violation 2 (untested guard branches, fixed): isSpentPattern's `g === null` and `!(g.measuredTarget > 0)` branches were each hit by no test of their own
  Rule: Every early-return branch needs a test that fails when that branch is inverted
  Context: Pivot-less hand-built candidate in spentPatterns.test.ts; mocked-geometry cases (direction up, target -5) in spentPatterns.noTarget.test.ts. Both mutation-checked.

- Violation 3 (recomputed per count, fixed): buildElliottCandidates called tagAbc(c) twice and impulseLevels three times per count
  Rule: Compute a derived value once per item and pass it through
  Context: tag and levels computed once in the map callback; impulseFacts and toCandidate take `levels` as a parameter. Prompt text unchanged.

- Violation 4 (magic strings, fixed): the prompt wordings 'wave 5 cap' and 'thrust target' were inline literals next to OVERLAY_LEVEL_LABELS keys they differ from
  Rule: Name a wording constant that is deliberately distinct from a similar key
  Context: WAVE_5_CAP_FACT (elliottDiagonal.ts) and THRUST_TARGET_FACT (elliottTriangle.ts), each with a comment that it is prompt wording.

- Violation 5 (open string type, fixed): ElliottLevel.label was `string`, so a typo'd label compiled
  Rule: Close a type whose values are a known finite set
  Context: @internal ElliottLevelLabel = 'invalidation' | 'target' | 'wave5_cap' | `target ${string}%` in types.ts (kept type-only); ratioLabel returns `${number}%`, abcTargetLevels annotates its map callback, test helper typed.

## [Branch fix/ma-spread-facts | Round 1→3 (approved) | 2026-10-02] — MA spread facts and pattern geometry refinement

### Round 1 (required, all fixed in R2/R3)

- Violation 1: PROMPT_TEMPLATE_VERSION not bumped when technical prompt's bytes changed
  Rule: Cache builders' template/prompt versions not bumped when rendered bytes change (see Infrastructure #6)
  Context: New Indicator State lines, Long-term Context/Fib anchor/candle/pattern-candidate format changes and the rewritten guidelines changed the technical prompt's bytes; version incremented from p20 to p21 with history comment. config.test expectation updated to match new version.

- Violation 3: prettier --check failed on the six changed files
  Rule: CONVENTIONS — formatting enforced (`yarn format:check`)
  Context: prettier applied; format:check passes.

### Round 1 (recommended, all fixed in R2/R3)

- Violation 1: Unused test import in spacing line test file
  Rule: Code cleanup — remove unused imports
  Context: Unused import removed.

- Violation 2: Spacing line wiring not tested end-to-end through formatChartPatternCandidatesSection
  Rule: Critical paths must be tested end-to-end through integrating functions
  Context: Added test coverage for spacing line formatting through the full formatting pipeline.

- Violation 3: Rewritten guideline block not asserted; no guard that rendered guideline line names match defined line names
  Rule: New display logic must have matching test assertions and guards for name/label consistency
  Context: Added assertions verifying guideline line names in rendered output match their definitions.

- Violation 4: Vacuous Long-term Context tests — tests guarded with `if (row)` but no assertion on computed percentage
  Rule: Tests must verify logic, not conditionally guard the verification away; each assertion must check the computed value
  Context: Replaced with one test on bars with a known period high/low: asserts the exact dated `Period High/Low` lines and the exact distances (33.33% below / 100.00% above).

- Violation 5: maCycleLine hardcoded label with `as` type casts and magic numbers
  Rule: Magic literals must be extracted to named constants; type assertions should be avoided in favor of proper typing
  Context: MA cycle label built from MA_CYCLE_PERIODS; `as` casts replaced by a type guard; RETRACEMENT_DEPTH_DP constant for the retracement decimals.

- Violation 6: Gap line division logic mismatches engine calculation; ATR-N/A and non-finite ATR branches untested
  Rule: Chart line logic must match engine calculation exactly; all branches (undefined/NaN/infinity cases) must have dedicated tests
  Context: Gap line now compares `size >= GAP_MIN_ATR_MULT * atr` like detectGapUp/Down; tests added for the exact 0.25× ATR boundary, ATR N/A, and a non-finite bar.

### Round 2 (recommended, fixed)

Round 3: approved

## [Branch feat/agent-style-confluence | 2026-10-03] — Round 1 review findings

- Violation 1 (required): AGENT_PROMPT_VERSION bump + prompt text/tool description change without a docs/PUBLIC_API.md revision row
  Rule: Every agent prompt-text or tool-description change records a PUBLIC_API.md revision row (recurred from the earlier agent-analyst-voice review)
  Context: Added the 2026-10-03 row (rule-state references removed, Writing style section, cache-prefix invariant, consumer action).
- Violation 2 (recommended): Tool description claimed 92 or 8 means "every" condition held; the exit (8) side has no HTF/volume gate
  Rule: Model-facing descriptions must match the engine exactly (confluence.ts entry vs exit triggers)
  Context: Reworded to "the bullish or the bearish trigger conditions of the tally all held on the last bar".
- Violation 3 (recommended): Em-dash guard test scanned only "Korean example:" quotes, narrower than its stated purpose
  Rule: A guard test must cover every instance its name promises
  Context: Now scans every quoted string containing Hangul.
- Violation 4 (recommended): Hedge-once style rule could lead the model to drop the Plain not-a-guarantee caveat
  Rule: Style rules must not override Depth/Output requirements
  Context: Hedge bullet now says the caveat is always kept.

Round 2: approved

## [Branch feat/agent-style-confluence | 2026-10-03] — Round 3 review findings (after A/B-driven prompt revision)

- Violation 1 (recommended): A required prompt clause ("rule-based tally, not a forecast") conflicted with the new Writing style contrast ban and hedge-once rule
  Rule: Rules inside one prompt must not give opposite instructions; required wording needs an explicit carve-out
  Context: Wording is pinned by a 2026-09-25 user decision, so the contrast bullet now names the caveat and tally qualifier as required wording.
- Violation 2 (recommended): "Both levels keep ... the invalidation level" stayed unconditional after Plain step 5 allowed no levels for market-wide answers
  Rule: When a rule gains an exception, update every other line that restates the rule
  Context: Now "the invalidation level whenever a tool returned one".
- Violation 3 (recommended): Removed contract text ('| none' in the pullback enum, "still a tally") had no negative assertions
  Rule: A removal that fixes model misbehaviour needs a not.toContain guard so a revert fails the suite
  Context: Added not.toContain assertions in tools.test.ts.

Round 4: approved

## [Branch feat/agent-style-confluence | 2026-10-03] — Round 5 review findings (RSI(2) surfaced in latest indicators)

- Violation 1 (recommended): Tool description promised a new consumer-built field (`rsi2`) but the PUBLIC_API consumer-action note did not tell consumers to add it
  Rule: When a tool description promises a field the consumer builds, the PUBLIC_API consumer-action note must list it
  Context: Note now says to surface RSI(2) as `rsi2` in the 1Day latest-indicator view.

Round 6: approved

## [Branch fix/overall-reuse-latest-technical | 2026-10-04] — Review findings (overall reuses the latest technical via peek)

- Violation 1 (required, R1): Cache-key arguments on the new read path (tier, positionBucket) were not pinned by any test — mutating them left the suite green
  Rule: When a read path rebuilds a cache key, every key argument needs a test where a mismatch on that argument alone misses
  Context: member/profit seeded test; mutation-checked.
- Violation 2 (recommended, R1): New reader of an existing cache entry skipped guards the sibling reader applies (empty-after-normalize, skillsDegraded flag)
  Rule: A second reader of the same cache entry must apply the same validity guards as the existing reader (share the helper)
  Context: isEmptyAnalysis exported @internal from peekAnalysisCache.ts.
- Violation 3 (recommended, R1): Consumer-visible behaviour change of a public function (runOverallAnalysis) had no PUBLIC_API row because the changed function was @internal
  Rule: Changelog by observable behaviour of the public entry point, not by which internal function changed

Round 2: approved

## [PR #251 Claude review | fix/overall-reuse-latest-technical | 2026-10-04]
- Violation (suggestion, fixed): two cache-served paths repeated "record usage + shape result" — drift risk
  Rule: MISTAKES 6 — fold repeated side-effect + return sequences into one helper (`serveCached`)
- Violation (suggestion, fixed): import out of alphabetical order (`byok/gate` after `market/*`)
  Rule: MISTAKES 13.5
