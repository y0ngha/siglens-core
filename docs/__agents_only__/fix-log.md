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

## [Branch fix/prompt-precision-currency | 2026-09-11] — Lesson: Real-data validation required for prompt changes

- Lesson (non-blocker, verification finding): Prompt-number changes must be validated by rendering real data and comparing distributions, not only by unit tests
  Rule: Testing best practice — prompt logic verification scope
  Context: Audit recommendation to floor structural risk:reward leg at one mean bar range passed all 90+ unit tests but, when rendered over real market data (90 charts), flipped 34 verdicts from >= 1.0 to < 1.0 and made verdict sentences false. Recommendation was removed post-R1. Unit test coverage is insufficient for prompt calculations involving conditional defaults or output transformations. Rendering real data distributions before deployment is mandatory.

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

### Round 3: approved

## [PR #234 | feat/classify-ma-stack | 2026-09-28] — Tier 2 public export JSDoc missing @returns

- Violation: classifyMaStack public export lacked required @returns JSDoc tag
  - Rule: MISTAKES.md TypeScript 4.5 — Tier 2 public functions must have @param and @returns JSDoc tags
  - Context: New Tier 2 function added to src/domain/analysis/trendStructure.ts without @returns documentation. Fixed by adding @returns tag.

## [Branch fix/history-window-cache-churn | 2026-09-30] — Round 1 review findings

- Violation 1 (required): Orphaned JSDoc after inserting new function between JSDoc block and declaration
  - Rule: JSDoc blocks must immediately precede target declarations; inserting code between JSDoc and declaration orphans the JSDoc to misapply
  - Context: New function inserted between existing JSDoc and its target declaration. JSDoc still documented old rolling-window formula, now applying to wrong function. Fixed by relocating JSDoc or function to restore proper association.

- Violation 3 (recommended): Pointer key computed on every generation, trade-off not documented
  - Rule: Infrastructure design trade-offs must be documented with comments explaining the choice and upgrade path
  - Context: Optimization to skip pointer key recomputation on cache-hit paths was undocumented. Fixed by adding comment explaining memory/CPU trade-off and when full recomputation would be necessary.

## [Branch fix/strategy-overlay-kind | 2026-10-01] — Strategy overlay kind type export and testing

- Violation 1 (R1 REQUIRED, fixed): StrategyOverlayKind export added to public API but PUBLIC_API.md type inventory not updated
  Rule: MISTAKES.md Public API & Module Exports #7 — new public exports must be documented in changelog
  Context: New StrategyOverlayKind type export added during Round 1. PUBLIC_API.md updated with dated changelog row documenting the addition.

- Violation 2 (R1 RECOMMENDED, fixed): StrategyOverlayKind literal ('divergence' | 'fibonacci' | 'elliott') duplicated across loader, resolver, and type definitions
  Rule: Code duplication — magic strings should have single source of truth
  Context: Three separate lists of kind variants consolidated into a single Record<StrategyOverlayKind, true>-backed constant in domain/overlays/constants.ts.

- Violation 3 (R1 RECOMMENDED, fixed): strategyNameToKind lookup matched any skill type instead of restricting to type==='strategy'
  Rule: Type-matching precision — restrict name lookups to intended skill type
  Context: Fixed lookup to check type==='strategy' before matching against strategy names, preventing false matches on other skill types.

- Violation 4 (R1 RECOMMENDED, fixed): Missing test coverage for skills-omitted branch, divergence/fibonacci kinds, and elliott primary/alternate variants with overlayKind
  Rule: Test coverage — new overlayKind parameter branches need assertions
  Context: Added test cases covering skills-omitted branch, divergence/fibonacci kinds, and elliott primary/alternate with overlayKind parameter.

- Violation 5 (R1 RECOMMENDED, fixed): Changelog lacked note that cached analyses retain old overlayKind pairing until TTL expiration
  Rule: Changelog documentation — runtime behavior must include cache semantics note
  Context: Added changelog note documenting that cached analyses keep old overlayKind pairing until TTL expiration, and consumer must deploy frontmatter changes simultaneously.

Round 2: approved

