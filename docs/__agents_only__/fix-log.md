# Fix Log

## [PR #26 | feat/18/infrastructure-market-이전 | 2026-04-26]
- Violation: `smc.ts`의 `detectStructureBreaks`에서 `breaks = [...breaks, {...}]` spread append
- Rule: MISTAKES.md Coding Paradigm — append-only local mutable variable에 spread 사용은 O(N²)
- Context: `const breaks: SMCStructureBreak[] = []`로 선언 후 `breaks.push(...)` 사용으로 교체

- Violation: `pollAnalysisAction.ts`의 `as RawAnalysisResponse` 단언에 근거 주석 없음
- Rule: MISTAKES.md TypeScript — 타입 단언 시 근거 주석 필수
- Context: `submitAnalysisAction`이 JSON.stringify(RawAnalysisResponse)로 저장하고 `getJobResult`가 JSON.parse 후 반환한다는 근거 주석 추가

- Violation: `barsApi.ts`의 `fetchBarsWithIndicators`가 `new Date()`를 내부에서 직접 호출해 테스트 불가
- Rule: MISTAKES.md Tests — 테스트 가능성 확보를 위해 시간 의존성은 파라미터로 주입
- Context: `now = new Date()` 파라미터 추가

- Violation: `pollBriefingAction.test.ts`에서 `generatedAt`을 타입/형식만 검증하고 실제 값을 검증하지 않음
- Rule: MISTAKES.md Tests — 시간 의존 값은 `vi.useFakeTimers()` + `vi.setSystemTime()`으로 고정 후 정확한 값 단언
- Context: `vi.useFakeTimers()` + `vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z'))` 추가; `generatedAt === '2025-01-15T12:00:00.000Z'` 단언으로 변경

- Violation: `normalize.ts`의 `normalizeTimeRange` 함수에 테스트 없음
- Rule: MISTAKES.md Tests — 신규 public 함수는 테스트 커버리지 필수
- Context: `normalize.test.ts`에 `normalizeTimeRange` 6개 테스트 케이스 추가

- Violation: `domain/indicators/` 25개 인디케이터 파일 모두 테스트 없음
- Rule: CLAUDE.md Task Execution Rules #3 — 구현 파일과 테스트 파일은 함께 작성
- Context: utils, atr, ema, rsi, bollinger, obv, buySellVolume, cci, cmf, dmi, donchianChannel, macd, mfi, williamsR, vwap, stochastic, stochastic-rsi, parabolicSar, supertrend, keltnerChannel, ichimoku, squeezeMomentum, volume-profile, smc, index 테스트 파일 25개 신규 작성

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


## [PR #23 Round 2 | feat/1/서버-코드-분리-핵심-로직-npm-패키지 | 2026-04-25]
- Violation: `[...arr].reverse().find()` used instead of `findLast` in `lastNonNull` helper in `prompt.ts`
- Rule: Consistency with ES2023 APIs already used in the same PR — `candle-detection.ts` already uses `findLast`; `tsconfig.json` targets ES2023
- Context: `lastNonNull` helper copied an array and reversed it just to find the last non-null value; `findLast` avoids the O(n) array copy entirely

- Violation: Loop in `detectCandlePatternEntries` starts at `0` with `if (i < detectionStartIndex) continue;` instead of starting at `detectionStartIndex`
- Rule: MISTAKES.md Coding Paradigm #2 — avoid redundant computation; set loop start boundary correctly
- Context: `candle-detection.ts` loop over `extendedBars` guarded against the buffer region with an early `continue`; the loop start index should be `detectionStartIndex` directly

## [PR #23 Round 4 | feat/1/서버-코드-분리-핵심-로직-npm-패키지 | 2026-04-25]
- Violation: `1000` 매직 넘버를 `prompt.ts`에서 인라인으로 사용
- Rule: MISTAKES.md Coding Paradigm #13 — 하드코딩된 리터럴은 모듈 레벨 상수로 추출
- Context: `bar.time * 1000`에서 `1000`은 초→밀리초 변환 팩터; `SECONDS_TO_MS` 상수로 추출

## [PR #23 Round 5 | feat/1/서버-코드-분리-핵심-로직-npm-패키지 | 2026-04-25]
- Violation: `countSqueezeDuration`에서 종료 조건이 수렴 predicate인데 `for` 루프 사용
- Rule: CONVENTIONS.md — 루프 조건이 카운터가 아닌 수렴 predicate일 때 `while` 사용
- Context: `prompt.ts`의 `countSqueezeDuration`은 뒤에서부터 `sqzOn === true`가 끊기는 지점을 찾는 수렴 탐색; `while` 루프로 교체

- Violation: DOMAIN.md의 `Timeframe` 타입 및 관련 명세가 실제 코드와 불일치
- Rule: MISTAKES.md Documentation Sync #2 — 구현 변경 시 docs 동기화 필수
- Context: 코드의 `Timeframe = '5Min' | '15Min' | '30Min' | '1Hour' | '4Hour' | '1Day'`인데 DOMAIN.md는 `'1Min' | '5Min' | '15Min' | '1Hour' | '1Day'`로 표기; TIMEFRAMES 상수, EMA 테이블, 인디케이터 설정표, 봉 개수 기준 모두 동기화

## [PR #24 Round 1 | feat/17/infrastructure-cache-jobs-ai-이전 | 2026-04-25]
- Violation: `parseJsonResponse` 테스트에서 `console.error` 스파이 설정 후 에러 로깅을 검증 — 구현에 없는 동작을 테스트
- Rule: MISTAKES.md Tests #6 — 테스트는 실제 구현 동작만 검증; 존재하지 않는 사이드이펙트를 단언하지 않음
- Context: `utils.test.ts`에서 `vi.spyOn(console, 'error')`로 에러 로깅을 검증했으나 `parseJsonResponse`는 `console.error`를 호출하지 않음; consoleSpy 제거

## [PR #24 Round 3 | feat/17/infrastructure-cache-jobs-ai-이전 | 2026-04-25]
- Violation: `parseNumberEnv` 함수명이 "env var 파싱"을 시사해 domain/에서 환경변수를 다루는 듯한 인상을 줌
- Rule: CONVENTIONS.md — 함수 이름은 실제 동작을 정확히 반영해야 함; `parseNumberEnv`는 raw string을 받는 순수 함수이며 env var에 의존하지 않음
- Context: `domain/utils.ts`의 `parseNumberEnv`를 `parseNumberOrDefault`로 이름 변경

- Violation: `AI_SYSTEM_PROMPT` 테스트가 타입/길이만 검증하고 핵심 계약(한국어 출력, JSON 단독 출력, Deterministic) 미검증
- Rule: MISTAKES.md Tests — 핵심 계약 위반을 방어하는 테스트가 필요; 시스템 프롬프트 의도치 않은 변경은 런타임에서만 발견됨
- Context: `utils.test.ts`에 `toContain('Korean')`, `toContain('SINGLE valid JSON object')`, `toContain('Deterministic')` 케이스 추가

## [PR #24 Round 2 | feat/17/infrastructure-cache-jobs-ai-이전 | 2026-04-25]
- Violation: `queue.ts`에 `setJobStatus`, `setJobResult`, `setJobError` 함수 누락
- Rule: API 대칭성 — `getJobStatus`/`getJobResult`/`getJobError`가 있으면 대응하는 set 함수도 있어야 함
- Context: `queue.ts`에 3개 write 함수 추가; 각각 `job:{id}:status/result/error` 키에 TTL 1시간으로 저장

- Violation: `@google/genai`, `@upstash/redis`가 `dependencies`에 포함되어 소비자 프로젝트에 강제 설치
- Rule: npm 라이브러리 패턴 — 선택적 런타임 의존성은 `peerDependencies`(optional) + `devDependencies`로 분리
- Context: `package.json`에서 두 패키지를 `peerDependencies`(optional: true) 및 `devDependencies`로 이동

## [PR #24 Round 6 | feat/17/infrastructure-cache-jobs-ai-이전 | 2026-04-26]
- Violation: `RedisSetOpts` (Upstash 내부 옵션 타입)를 `src/index.ts` 공개 API에 export
- Rule: 라이브러리 공개 API는 소비자가 실제로 사용하는 타입만 노출해야 함; 구현 세부사항 노출은 내부 변경 시 breaking change가 됨
- Context: `jobs/types.ts`의 `RedisSetOpts`는 `JobRedisClient` 인터페이스 내부 구현 옵션으로 소비자가 직접 사용할 일이 없음; `index.ts` export 블록에서 제거

## [PR #24 Round 5 | feat/17/infrastructure-cache-jobs-ai-이전 | 2026-04-25]
- Violation: `jobs/redis.ts`가 `cache/config.ts`에서 `readUpstashConfig`를 직접 import — 인프라 모듈 간 교차 의존
- Rule: MISTAKES.md Architecture #3 — 각 infrastructure 모듈은 하나의 외부 시스템만 담당; 모듈 간 조율은 소비자 레이어에서
- Context: `cache/config.ts`에 배치했던 `readUpstashConfig`를 `infrastructure/upstash/config.ts`로 이동; `cache/redis.ts`와 `jobs/redis.ts` 모두 공유 모듈에서 직접 import하도록 수정

- Violation: `GeminiContents` 타입에 `{ role: string; parts: Array<{ text: string }> }` 중첩 익명 객체 타입 인라인 정의
- Rule: MISTAKES.md TypeScript #5 — 반복되거나 재사용 가능한 타입 패턴은 named type alias로 추출
- Context: `infrastructure/ai/types.ts`에서 `GeminiPart`, `GeminiContent` named interface로 추출

## [PR #26 | feat/18/infrastructure-market-이전 | 2026-04-26]

- Violation: `AcquireReanalyzeCooldownResult` 타입이 `reanalyzeCooldown.ts` 구현 파일 내부에만 정의됨
- Rule: MISTAKES.md Architecture #4 — infrastructure 모듈의 public interface는 `types.ts`에 위치해야 함
- Context: `infrastructure/market/types.ts`로 이동하고 구현 파일에서 import하도록 수정

- Violation: 함수/파일 이름이 `submitAnalysisAction`, `pollAnalysisAction` 등 Next.js 서버 액션 네이밍을 유지
- Rule: MISTAKES.md Coding Paradigm #9 — 아키텍처 변경 후 이름이 정확하지 않으면 업데이트
- Context: Next.js 'use server' 액션에서 일반 infrastructure 함수로 전환되었으나 Action suffix가 남아 있어 misleading
