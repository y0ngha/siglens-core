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

## [PR #32 | feat/3/neon-drizzle-db-schema | 2026-04-27]
- Violation: `client.ts`, `config.ts`, `schema.ts`, `types.ts` all used `@/infrastructure/db/...` absolute paths to import siblings within the same module folder
- Rule: CONVENTIONS.md Import Path Rules — relative imports inside a single module folder are correct; absolute `@/...` paths are for cross-layer references
- Context: All four files replaced absolute sibling imports with `./types`, `./constants`, `./schema` relative imports

## [Issue #3 | feat/3/neon-drizzle-db-schema | 2026-04-26]
- Violation: `users.email` had both a unique constraint and a duplicate non-unique index
- Rule: Schema design — avoid duplicate indexes that add storage/write overhead without a new lookup path
- Context: Drizzle `.unique()` already creates a PostgreSQL index for email lookup; removed the extra `users_email_idx`

## [PR #32 | feat/3/neon-drizzle-db-schema | 2026-04-27]
- Violation: Drizzle migration metadata was not regenerated after changing `assetTranslations.symbol` from table-level primary key metadata to inline primary key metadata
- Rule: Generated migration state must stay synchronized with schema changes to avoid future false-positive migrations
- Context: Updated the initial migration and snapshot to match `schema.ts`, then verified `yarn db:generate` reports no schema changes

## [PR #33 | feat/5/email-signup | 2026-04-27]
- Violation: Missing EOF newline in drizzle/0001_sharp_triathlon.sql
- Rule: CONVENTIONS.md — every file must end with a newline character
- Context: Migration SQL file generated without trailing newline; added manually

- Violation: Missing @example and @see JSDoc tags on Tier 1 export registerUser in application/auth/registerUser.ts
- Rule: CONVENTIONS.md Tier 1 recommended JSDoc tags — @example and @see are recommended for Tier 1 exports to aid IDE hover documentation for library consumers
- Context: registerUser had @param and @returns but no usage example or cross-references to its dependency injection interfaces

- Violation: JSDoc @param for createDatabaseClient duplicated the parameter type name without adding information beyond what the type signature already conveys
- Rule: CONVENTIONS.md JSDoc Rules — do not duplicate type info the parameter type already conveys; explain the why, edge cases, or side effects the type cannot express
- Context: @param config described as "Database connection configuration" which merely restates the type; updated to reference readDatabaseConfig as the canonical constructor
