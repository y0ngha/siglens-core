# Fix Log

## [Issue #2 | chore/2/초기-개발-환경-설정 | 2026-04-24]
- Violation: release-it config used `${version}` (JS template literal) instead of `{{version}}` (Handlebars) for commitMessage, tagName, tagAnnotation
- Rule: release-it interpolation uses `{{version}}` syntax — `${version}` is passed as a literal string and breaks tag push trigger matching
- Context: .release-it.json initially written with ES template literal style; corrected to Handlebars style across all three fields

- Violation: npm publish used instead of yarn npm publish in GitHub Actions workflow
- Rule: CLAUDE.md — yarn must be used for all package operations; npm is prohibited
- Context: publish.yml initially used `npm publish` and NODE_AUTH_TOKEN; corrected to `yarn npm publish` with YARN_NPM_AUTH_TOKEN and added npmScopes config to .yarnrc.yml for yarn 4 registry routing

## [Issue #1 | feat/1/서버-코드-분리-핵심-로직-npm-패키지 | 2026-04-24]
- Violation: `.sort()` used instead of `.toSorted()` in `selectLastCandlePatternEntries`
- Rule: MISTAKES.md Coding Paradigm #10 — `.sort()` mutates the original array; `.toSorted()` must be used
- Context: `candle-detection.ts` line 210 sorted the result array in-place before returning; fixed to `.toSorted()`

## [PR #23 | feat/1/서버-코드-분리-핵심-로직-npm-패키지 | 2026-04-25]
- Violation: `.slice()` inside `.map()` causing O(n × period) complexity in `calculateMA`
- Rule: CONVENTIONS.md sliding window rule — use `for` loop exception when `.slice()` inside `.map()` is O(n²)
- Context: `ma.ts` recomputed window sum for each bar; replaced with O(n) sliding window `for` loop using incremental `windowSum += closes[i] - closes[i - period]`

## [PR #23 Round 2 | feat/1/서버-코드-분리-핵심-로직-npm-패키지 | 2026-04-25]
- Violation: `[...arr].reverse().find()` used instead of `findLast` in `lastNonNull` helper in `prompt.ts`
- Rule: Consistency with ES2023 APIs already used in the same PR — `candle-detection.ts` already uses `findLast`; `tsconfig.json` targets ES2023
- Context: `lastNonNull` helper copied an array and reversed it just to find the last non-null value; `findLast` avoids the O(n) array copy entirely

- Violation: Loop in `detectCandlePatternEntries` starts at `0` with `if (i < detectionStartIndex) continue;` instead of starting at `detectionStartIndex`
- Rule: MISTAKES.md Coding Paradigm #2 — avoid redundant computation; set loop start boundary correctly
- Context: `candle-detection.ts` loop over `extendedBars` guarded against the buffer region with an early `continue`; the loop start index should be `detectionStartIndex` directly

## [PR #23 Round 3 | feat/1/서버-코드-분리-핵심-로직-npm-패키지 | 2026-04-25]
- Violation: `interface PromptConfig` defined locally in `prompt.ts` instead of `domain/types.ts`
- Rule: MISTAKES.md Architecture #1 — all shared domain types must be centralized in `domain/types.ts`; `PROMPT_CONFIG_BY_TIMEFRAME` is public API so consumers need `PromptConfig` to annotate values
- Context: `PromptConfig` was module-private in `prompt.ts`; moved to `domain/types.ts` and added to `src/index.ts` export block

- Violation: `skillGroups` built with `reduce` + spread `[...acc[key], skill]` causing O(N²) per bucket
- Rule: CONVENTIONS.md functional programming exception — use for-loop with local mutable accumulator when reduce + spread causes O(N²)
- Context: `buildAnalysisPrompt` in `prompt.ts` grouped skills with reduce spreading arrays on every iteration; replaced with for-loop + `push`

- Violation: `as const` in `buildChatPrompt.ts` without a guarantee comment
- Rule: MISTAKES.md TypeScript #7 — every safe-cast `as` must have a comment explaining the guarantee
- Context: `{ role: 'user' as const }` in `buildChatPrompt.ts` lacked the required inline comment; added per pattern from `candle-detection.ts`

## [PR #23 Round 4 | feat/1/서버-코드-분리-핵심-로직-npm-패키지 | 2026-04-25]
- Violation: `1000` 매직 넘버를 `prompt.ts`에서 인라인으로 사용
- Rule: MISTAKES.md Coding Paradigm #13 — 하드코딩된 리터럴은 모듈 레벨 상수로 추출
- Context: `bar.time * 1000`에서 `1000`은 초→밀리초 변환 팩터; `SECONDS_TO_MS` 상수로 추출

## [PR #23 Round 5 | feat/1/서버-코드-분리-핵심-로직-npm-패키지 | 2026-04-25]
- Violation: `detectCandlePattern` belt hold 블록 fallthrough 분기(`bodyRatio ≥ 0.6`이지만 belt hold 조건 불충족 → `'bullish'`/`'bearish'` 반환) 테스트 없음
- Rule: MISTAKES.md Tests #15 — 100% branch coverage; domain 함수의 모든 분기 테스트 필요
- Context: `candle.test.ts`에서 `BULLISH_BAR`의 bodyRatio가 0.556이어서 belt hold 블록에 진입하지 않음; fallthrough 케이스를 위한 별도 fixture 추가

- Violation: `countSqueezeDuration`에서 종료 조건이 수렴 predicate인데 `for` 루프 사용
- Rule: CONVENTIONS.md — 루프 조건이 카운터가 아닌 수렴 predicate일 때 `while` 사용
- Context: `prompt.ts`의 `countSqueezeDuration`은 뒤에서부터 `sqzOn === true`가 끊기는 지점을 찾는 수렴 탐색; `while` 루프로 교체

- Violation: DOMAIN.md의 `Timeframe` 타입 및 관련 명세가 실제 코드와 불일치
- Rule: MISTAKES.md Documentation Sync #2 — 구현 변경 시 docs 동기화 필수
- Context: 코드의 `Timeframe = '5Min' | '15Min' | '30Min' | '1Hour' | '4Hour' | '1Day'`인데 DOMAIN.md는 `'1Min' | '5Min' | '15Min' | '1Hour' | '1Day'`로 표기; TIMEFRAMES 상수, EMA 테이블, 인디케이터 설정표, 봉 개수 기준 모두 동기화

## [PR #23 Suggestions | feat/1/서버-코드-분리-핵심-로직-npm-패키지 | 2026-04-25]
- Violation: `!` non-null 단언 주석이 `??` 왼쪽 경로(캐시 배열)에 대한 보장을 설명하지 않음
- Rule: MISTAKES.md TypeScript #7 — 모든 safe-cast(`as`, `!`)에는 런타임 보장을 설명하는 주석 필요
- Context: `detectSupportProximityBullish`/`detectResistanceProximityBearish`의 `[lastIdx]!` 단언 주석이 `calculateMA` 반환 경로만 설명하고 `indicators.ma[period]` 경로(caller contract)에 대한 보장을 누락

## [PR #24 Round 1 | feat/17/infrastructure-cache-jobs-ai-이전 | 2026-04-25]
- Violation: `parseJsonResponse` 테스트에서 `console.error` 스파이 설정 후 에러 로깅을 검증 — 구현에 없는 동작을 테스트
- Rule: MISTAKES.md Tests #6 — 테스트는 실제 구현 동작만 검증; 존재하지 않는 사이드이펙트를 단언하지 않음
- Context: `utils.test.ts`에서 `vi.spyOn(console, 'error')`로 에러 로깅을 검증했으나 `parseJsonResponse`는 `console.error`를 호출하지 않음; consoleSpy 제거

- Violation: re-export 테스트(`parseNumberEnv`, `stripMarkdownCodeBlock`)가 `ai/utils.ts`에 포함되어 있었음
- Rule: MISTAKES.md Architecture — infrastructure 모듈은 domain 유틸리티를 re-export하지 않음; 각 심볼은 원래 정의된 모듈에서 테스트
- Context: `ai/utils.ts`가 domain utils를 re-export하고 있었고 해당 테스트가 `utils.test.ts`에 포함; re-export 제거 및 테스트 삭제

- Violation: 여러 파일(`cache/redis.ts`, `jobs/redis.ts`)에서 `process.env.UPSTASH_REDIS_REST_URL/TOKEN`을 직접 읽음
- Rule: MISTAKES.md Infrastructure §4 — 환경변수는 한 곳에서만 읽어야 함(중앙화)
- Context: `cache/config.ts`에 `readUpstashConfig()` 추가; 두 Redis 팩토리가 해당 함수를 통해 config를 얻도록 변경

- Violation: `JobRedisClient` 인터페이스 없이 `@upstash/redis`의 `Redis` 클래스를 직접 반환 타입으로 사용
- Rule: MISTAKES.md Architecture — 외부 의존성은 인터페이스 뒤에 래핑; 테스트에서 목 교체 가능해야 함
- Context: `jobs/types.ts`에 `JobRedisClient` 인터페이스 추가; `createJobRedis()`가 `JobRedisClient | null` 반환

## [PR #24 Round 2 | feat/17/infrastructure-cache-jobs-ai-이전 | 2026-04-25]
- Violation: `queue.ts`에 `setJobStatus`, `setJobResult`, `setJobError` 함수 누락
- Rule: API 대칭성 — `getJobStatus`/`getJobResult`/`getJobError`가 있으면 대응하는 set 함수도 있어야 함
- Context: `queue.ts`에 3개 write 함수 추가; 각각 `job:{id}:status/result/error` 키에 TTL 1시간으로 저장

- Violation: `@google/genai`, `@upstash/redis`가 `dependencies`에 포함되어 소비자 프로젝트에 강제 설치
- Rule: npm 라이브러리 패턴 — 선택적 런타임 의존성은 `peerDependencies`(optional) + `devDependencies`로 분리
- Context: `package.json`에서 두 패키지를 `peerDependencies`(optional: true) 및 `devDependencies`로 이동
