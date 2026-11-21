# Public API Boundary

> Public API boundary for `@y0ngha/siglens-core`: which exports are stable (Tier 1–4), which are `@internal`, and how semver applies.

## 개요

`siglens-core`는 npm 패키지(`@y0ngha/siglens-core`)로 SIGLENS 웹 앱과 ai.siglens.io 에이전트 등에서 import해 사용하는 라이브러리다. 외부 노출은 두 entry point를 통해서만 이루어진다.

- **`src/index.ts`** — 서버(기본) entry point. `package.json` `exports`의 `default` 조건(`dist/index.js`)이다. application·infrastructure 런타임 export(use-case 함수, factory)를 포함한 전체 공개 표면이다.
- **`src/index.client.ts`** — 브라우저 entry point. `package.json` `exports`의 `browser` 조건(`dist/index.client.js`)으로 번들러가 고른다. Node API나 서버 전용 SDK에 의존할 수 있는 application·infrastructure 런타임 export는 두지 않고, 순수 도메인 함수·상수·타입만 노출한다.

두 entry point의 심볼 집합은 다르다. 어느 쪽에 있는지는 아래 인벤토리 행과 `src/index*.ts`에서 확인한다. `package.json`의 `exports` 맵은 `.` 하나만 선언하며, deep import(`@y0ngha/siglens-core/dist/...`)는 지원하지 않는다.

라이브러리의 함수는 두 부류로 나뉜다.

- **Public** — 외부 consumer가 직접 호출하도록 설계된 진입점. 시그니처가 안정적이며 호환성을 유지한다.
- **Internal** — public 함수의 보조 구현. 라이브러리 내부에서만 호출되며, 자유롭게 변경·삭제·이름 변경될 수 있다.

이 문서는 어떤 함수를 public/internal로 분류할지, 새 함수가 추가될 때 어떻게 결정할지, 그리고 consumer가 internal 함수에 의존하지 못하도록 어떤 신호를 제공할지를 정의한다.

이 정책은 layer dependency 규칙(`docs/ARCHITECTURE.md`)과 **직교한다**. layer는 코드의 의존 방향을 통제하지만, 노출 정책은 어떤 함수가 패키지 외부 경계를 넘는지를 통제한다. 한 layer 안에도 public과 internal이 공존할 수 있다.

---

## Tier 정의

Public 함수는 4개 Tier로 분류한다. Tier는 호출자(누가 부르는가)와 안정성 보장 수준에 따라 나뉜다.

이 문서의 Tier는 API 안정성 등급이며, 제품 구독 티어(`Tier`/`TIER_CONFIG`의 `free`/`member`/`pro`)와는 관계가 없다.

### Tier 1 — Application Entrypoints

**용도**: Server Action, route handler 등 서버 코드가 직접 호출하는 use-case 함수.

**위치**: `src/application/`

**특징**:
- 도메인 + 인프라를 조합하는 비동기 함수.
- consumer 입장에서 가장 자주 호출되는 함수 그룹.
- 시그니처 변경은 semver major.

### Tier 2 — Domain Building Blocks

**용도**: consumer가 도메인 로직을 직접 호출해야 하는 경우(예: UI에서 캔들 패턴 감지, 서버에서 지표 재계산).

**위치**: `src/domain/`의 high-level 진입점만. 개별 지표/신호 함수는 Tier 2가 아니다.

**특징**:
- 동기 순수 함수. 부작용 없음.
- "여러 작은 함수를 묶어 한 번에 호출 가능한 단위"만 Tier 2에 포함.
- 시그니처 변경은 semver major.

### Tier 3 — Infrastructure Factories & Config

**용도**: consumer가 환경별 인프라를 생성/설정/제어할 때 호출하는 factory·config 함수.

**위치**: `src/infrastructure/`의 진입점만.

**특징**:
- Redis 기반 캐시·카운터·쿨다운처럼 core가 직접 연결하는 외부 시스템의 factory·config. 시장 데이터와 AI provider SDK 호출은 factory로 노출하지 않는다(시장 데이터는 소비자가 `MarketDataProvider` port를 구현해 주입한다).
- env 누락 시 graceful degradation 또는 명시적 throw.
- 시그니처 변경은 semver major.

### Tier 4 — Public Types & Constants

**용도**: 모든 데이터 타입과 공개 상수.

**위치**: `src/domain/types.ts`, `src/infrastructure/<sub>/types.ts`, 그리고 일부 `constants/` 파일.

**특징**:
- consumer는 함수 시그니처 매칭을 위해 항상 타입을 import해야 한다 — 모든 export 타입은 Tier 4.
- 인터페이스 변경(필드 추가/삭제/이름 변경)은 semver major.
- 단순 값 추가(예: `Timeframe` union에 새 멤버)는 semver minor.

### Internal

**용도**: public 함수의 보조 구현. 라이브러리 외부에 노출되지 않는다.

**특징**:
- 두 entry point(`src/index.ts`·`src/index.client.ts`) 어디에서도 export하지 않는다.
- 함수 정의부에 `/** @internal */` JSDoc 태그를 붙인다(TypeDoc 자동 필터링용).
- 시그니처/이름/파일 위치는 minor 버전에서도 자유롭게 변경 가능하다.

---

## 현재 노출 인벤토리

### Tier 1 — Application Entrypoints

Tier 1 함수는 모두 `src/index.ts`(서버) 전용이다. `src/index.client.ts`는 application 레이어에서 채팅 모델 상수(`DEEPSEEK_V4_1_FLASH_MODEL`·`DEEPSEEK_V4_1_PRO_MODEL`·`GEMINI_FLASH_LITE_MODEL`·`VALID_CHAT_MODELS`)와 일부 타입만 노출한다.

생성형 `run*` use-case의 공통 계약(`runNewsCardAnalysis`는 캐시가 없어 첫 두 항목이 다르고, `runAgentTurn`은 아래 행의 별도 계약을 따른다):

- 한 번의 호출이 cache lookup → (miss면) 생성 → cache write까지 끝내고 결과를 돌려준다. 호출자는 promise 하나만 await한다.
- 같은 in-flight key의 동시 호출은 `dedupeGeneration`으로 LLM 호출 한 번을 공유한다(프로세스 내, 그리고 `CacheProvider.setIfAbsent`가 있으면 인스턴스 간). `keyPolicy: 'byok-only'`에서는 같은 `userApiKey`(해시로 구분)끼리만 합류한다.
- `options.signal`은 진행 중인 LLM 호출을 중단한다. `skipEnqueueIfMiss: true`를 받는 use-case는 캐시 미스에서 생성하지 않고 `miss_no_trigger`를 돌려준다.
- 게이트 거부(티어·사용량·BYOK·데이터 없음)는 결과 variant로 돌려주고, LLM 레벨 실패(provider 오류·네트워크·abort)는 throw한다.
- `keyPolicy: 'byok-only'`에서 `userApiKey`가 없으면 `key_error` variant가 있는 use-case는 그것을 돌려주고, 없는 use-case는 `UserApiKeyMissingError`를 throw한다.

| Symbol | Source |
|---|---|
| `runAnalysis(symbol, companyName, timeframe, force?, fmpSymbol?, options?: SubmitAnalysisOptions)` — technical analysis end-to-end: tier gate → cache lookup → bars fetch via `options.marketDataProvider` → LLM → post-processing → cache write → tier-filtered result. `marketDataProvider` is required on a cache miss (omitting it throws) and may be omitted with `skipEnqueueIfMiss: true`. Returns `Promise<RunAnalysisResult>`: `cached` / `done` (also carries `unfilteredResult`, the pre-filter analysis for callers that persist history) / `miss_no_trigger` / `error` (usage limit, timeframe gate) / `key_error` (BYOK). A fresh generation is written under the exact key and under the peek pointer `peekAnalysisCache` reads. | `application/market/runAnalysis.ts` |
| `peekAnalysisCache(symbol, timeframe, _fmpSymbol?, modelId?, reasoning?, tier?, tierConfig?, positionBucket?, locale?)` — **read-only**. Reads the technical-analysis peek pointer (the latest fresh generation for symbol/timeframe/model/tier, plus the reasoning/position-bucket/locale variants) and validates it through the same normalizer the writer's cache-hit path uses; never fetches market data, calls the LLM, or writes. A timeframe the caller `tier` may not access resolves to `null` before the read. Returns `Promise<FilteredAnalysisResult \| null>` — tier-filtered via `filterAnalysisResult`; `null` on miss / no cache provider / read error / corrupt or content-free payload. `_fmpSymbol` is unused (the key is not scoped by it). `reasoning`, `positionBucket` and `locale` must match the writer's (omitted = reasoning-OFF / no bucket / `'ko'`). For SSR at zero LLM cost. | `application/market/peekAnalysisCache.ts` |
| `fetchBarsWithIndicators(provider, symbol, timeframe, ...)` — `provider: MarketDataProvider` 첫 인자로 시장 데이터 어댑터를 받는다. | `application/market/barsApi.ts` |
| `runBriefing(data, context, options?)` — market briefing end-to-end: cache lookup → LLM (`callBriefingAi`, server key, no tier/BYOK) → normalize → cache write. Cache key = ISO date+hour, briefing model, and a hash of the index/sector moves bucketed on a coarse grid plus `context` (`MarketBriefingContext`). Returns `Promise<RunBriefingResult>` (`cached` / `done`, both with `briefing` and `generatedAt`). Throws if the AI provider call fails. | `application/market/runBriefing.ts` |
| `peekBriefingCache(data, context, modelId?)` — **read-only**. Reads the same `buildBriefingCacheKey` key `runBriefing` writes (date+hour + model + input hash) and the same `normalizeMarketBriefing` path; never calls the LLM or writes. `context` must match what `runBriefing` was called with, or the peek reads a key nothing wrote. Returns `Promise<MarketBriefingResponse \| null>` (null on miss / no provider / read error / corrupt payload). | `application/market/peekBriefingCache.ts` |
| `runNewsAnalysis(options: SubmitNewsAnalysisOptions)` — per-symbol news analysis end-to-end: gate checks → cache lookup → LLM → normalize → cache write. Usage is recorded after the LLM resolves, so an aborted or failed call does not consume quota. Returns `Promise<RunNewsAnalysisResult>`: `cached` / `done` / `miss_no_trigger` / `error` (`no_news`, `usage_limit_exceeded`) / `key_error`. | `application/news/runNewsAnalysis.ts` |
| `runNewsCardAnalysis(options: SubmitNewsCardAnalysisOptions)` — per-card news analysis: prompt → LLM → normalize. **No cache read or write** — the caller filters already-analyzed items and persists the result. No tier or usage gate; server key by default, `userApiKey` under `keyPolicy: 'byok-only'` (missing key throws `UserApiKeyMissingError`). Concurrent calls for the same `item.id` + locale share one in-process call. Returns `Promise<RunNewsCardAnalysisResult>` (`{ status: 'done', result: NewsCardAnalysis }`). | `application/news/runNewsCardAnalysis.ts` |
| `runMarketNewsDigest(options: SubmitMarketNewsDigestOptions)` — market-news category digest: empty-news guard → cache lookup → LLM → normalize → cache write. No tier gate, usage limit or BYOK check; skills are passed in via `options.skills`. Returns `Promise<RunMarketNewsDigestResult>`: `cached` / `done` / `miss_no_trigger` / `no_news`. | `application/news/runMarketNewsDigest.ts` |
| `peekMarketNewsDigestCache(options)` — **read-only**. Derives the same cache key `runMarketNewsDigest` reads/writes (shared `resolveMarketNewsDigestCacheKey`, `@internal`) and applies the same `normalizeNewsAnalysisResponse` path; never calls the LLM, registers in-flight dedupe, or writes the cache. Takes `options: MarketNewsDigestCacheKeyOptions` — the key-participating subset of `SubmitMarketNewsDigestOptions` (`category`, `modelId`, `news`, `skills?`, `tier?`, `reasoning?`, `locale?`). Returns `Promise<NewsAnalysisResponse \| null>` (null on empty `news` / no provider / miss / read error). For SSR seeding of `/news/[category]` at zero LLM cost. | `application/news/peekMarketNewsDigestCache.ts` |
| `MarketNewsDigestCacheKeyOptions` — parameter type of `peekMarketNewsDigestCache`; the cache-key-participating subset of `SubmitMarketNewsDigestOptions` (`category`, `modelId`, `news`, `locale?`, `reasoning?`, `skills?`, `tier?`). Not `@internal` — it is a public function's parameter type and must be importable for type annotations. | `application/news/marketNewsDigestTypes.ts` |
| `runOverallAnalysis(options)` — overall (technical + fundamental + news + options) analysis end-to-end. Options are `SubmitOverallAnalysisOptions` plus `signal?`, `providerFallback?` and `keyPolicy?`. The four axes run server-side in parallel through their own `run*` use-cases, then the overall LLM call runs. `options.marketDataProvider` (via `OverallDependencyInputs`) is passed to the technical axis and is required when the overall cache misses and generation proceeds (daily Fear & Greed snapshot fetch; omitting it throws). `signal` aborts the axes and the overall call together. One overall call records one analysis usage, after the overall LLM returns. A fresh result is written under the canonical input-hashed key and under the content-free peek key `peekOverallAnalysisCache` reads. Returns `Promise<RunOverallAnalysisResult>`: `cached` / `done` / `miss_no_trigger` / `error` (timeframe gate or a failed dependency axis; carries `axis`) / `limit_error` / `key_error`. | `application/overall/runOverallAnalysis.ts` |
| `peekOverallAnalysisCache(symbol, companyName, timeframe, modelId?, reasoning?, tier?, tierConfig?, locale?)` — **read-only**. Reads the content-free "overwrite-latest" peek key that `runOverallAnalysis` writes next to the canonical hashed key. Never resolves dependencies, fetches, calls the LLM, or writes. Returns `Promise<OverallAnalysisResponse \| null>` (null on missing `modelId` / timeframe the caller `tier` may not access / miss / no provider / read error / corrupt or content-free payload). "Latest cached" semantics — a content-free read cannot reproduce the canonical input hash. `companyName` does not affect the lookup. `reasoning` and `locale` must match the writer's (omitted = reasoning-OFF / `'ko'` pointer). | `application/overall/peekOverallAnalysisCache.ts` |
| `runFundamentalAnalysis(options: SubmitFundamentalAnalysisOptions)` — fundamental analysis end-to-end: tier gate → cache lookup → `options.dataProvider` (`FundamentalDataProvider`) fetch → LLM → normalize → cache write. Returns `Promise<RunFundamentalAnalysisResult>`: `cached` / `done` / `miss_no_trigger` / `error` (`usage_limit_exceeded`, `fetch_failed`) / `key_error`. | `application/fundamental/runFundamentalAnalysis.ts` |
| `runFinancialsAnalysis(options: SubmitFinancialsAnalysisOptions)` — multi-year financial-statement analysis end-to-end: tier gate → cache lookup → `options.dataProvider` (`FinancialStatementsProvider`) fetch → scorecard (`computeFinancialsScorecard`) → LLM → normalize → cache write. Returns `Promise<RunFinancialsAnalysisResult>`: `cached` / `done` / `miss_no_trigger` / `error` (`usage_limit_exceeded`, `fetch_failed`) / `key_error`. | `application/financials/runFinancialsAnalysis.ts` |
| `runOptionsAnalysis(options: SubmitOptionsAnalysisOptions)` — options-chain analysis end-to-end, in this order: no-chains guard on `options.snapshot` → cache lookup (a hit skips the BYOK and usage gates) → `skipEnqueueIfMiss` → BYOK gate → usage limit → LLM → normalize → cache write. Returns `Promise<RunOptionsAnalysisResult>`: `cached` / `done` / `miss_no_trigger` / `no_chains_error` / `limit_error` (`usage_limit_exceeded`) / `key_error`. | `application/options/runOptionsAnalysis.ts` |
| `runCongressTrend(options: SubmitCongressTrendOptions)` — congressional-trade trend analysis end-to-end: cache lookup → `options.dataProvider` (`CongressTradesProvider`) fetch → LLM → normalize → cache write. No usage-limit gate and no BYOK-required check (model tier gating is the caller's); `options.userApiKey` is forwarded unchanged. Returns `Promise<RunCongressTrendResult>`: `cached` / `done` / `miss_no_trigger` / `no_trades` / `error` (`fetch_failed`). There is no `key_error` variant: a call that needs a user key and has none throws `UserApiKeyMissingError` (under `keyPolicy: 'byok-only'`, after the cache read and before the trade fetch). | `application/congress/runCongressTrend.ts` |
| `runInvestorFlowsAnalysis(options)` — 수급(investor flows: 13F 기관 · Form 4 내부자 · 13D/G · FINRA 공매도) AI 해석. cache → `skipEnqueueIfMiss` → `dataProvider.getInvestorFlowsSnapshot` → 데이터 없음 가드(`no_data`) → `dedupeGeneration` → LLM → normalize → cache(12h). 스코어카드는 코드가 계산해 프롬프트에 주입하고 모델은 해석만 한다. `done`은 해석한 `scorecard`를 함께 돌려주고 `cached`에는 스코어카드가 없다. 스킬 카탈로그를 쓰지 않는다(prompt-only). 사용량·BYOK 게이트 없음(모델 등급 게이트는 호출자 몫). | `application/investorFlows/runInvestorFlowsAnalysis.ts` |
| `runMacroBriefing(data, options?)` — per-market macro briefing for the `/economy` page: cache lookup → LLM (`callBriefingAi`, server key, no tier/BYOK) → normalize → cache write. Cache key = UTC date bucket, briefing model, and a hash of the indicator/treasury/calendar snapshot. Returns `Promise<RunMacroBriefingResult>` (`cached` / `done`, both with `briefing` and `generatedAt`). **`briefing.regime` is recomputed from `data` on every return** (fresh and cached) and may differ from what the model wrote; the prose is untouched. Throws if the AI provider call fails. | `application/economy/runMacroBriefing.ts` |
| `peekMacroBriefingCache(data, modelId?)` — **read-only**. Reads the same `buildMacroBriefingCacheKey` key `runMacroBriefing` writes and the same `normalizeMacroBriefing` validate path; never calls the LLM or writes. `data` may be `null`/`undefined` (resolves to `null`). Returns `Promise<MacroBriefingResponse \| null>` (null on miss / no provider / read error / corrupt payload). **`briefing.regime` is recomputed from `data` on every read (cache hits and entries stored without it alike) and may differ from the stored value** — the prose is untouched. | `application/economy/peekMacroBriefingCache.ts` |
| `peekMacroBriefingCacheEntry(data, modelId?)` — **read-only**, same lookup as `peekMacroBriefingCache` (UTC-day-bucketed key) but returns `Promise<MacroBriefingCacheEntry \| null>` (`{ briefing: MacroBriefingResponse; generatedAt: string \| null }`) so the UI can show when a day-cached briefing was generated (`generatedAt` is `null` only for an entry stored without it). **`briefing.regime` is recomputed from `data` on every read (cache hits and entries stored without it alike) and may differ from the stored value** — the prose is untouched. | `application/economy/peekMacroBriefingCache.ts` |
| `runEconomicEventAnalysis(input, options?)` — per-event economic-calendar AI analysis: cache lookup → LLM (`callAnalysisAi`, fixed model `GEMINI_FLASH_LITE_MODEL`, reasoning off) → `normalizeEconomicEventAnalysis` → cache write (24h). Cache key folds a hash of the `EconomicEventAnalysisInput` fields in a fixed order plus a prompt version. No tier gate, quota check or usage record; server key unless `keyPolicy: 'byok-only'`. Returns `Promise<RunEconomicEventAnalysisResult>` (`cached` / `done`, both with a typed `EconomicEventAnalysis`). | `application/economy/runEconomicEventAnalysis.ts` |
| `runIndicatorTranslation(normalizedName, options?)` — AI translation of an English economic-indicator name to Korean: cache lookup → LLM (`callAnalysisAi`, fixed model `GEMINI_FLASH_LITE_MODEL`, reasoning off) → `normalizeIndicatorTranslation` → cache write (30 days). No tier gate or quota check; server key unless `keyPolicy: 'byok-only'`. Returns `Promise<RunIndicatorTranslationResult>` (`cached` / `done`, both with `nameKo`). An empty `nameKo` is cached and returned — fall back to the English name. | `application/economy/runIndicatorTranslation.ts` |
| `getMarketSummary(provider, marketIndices, sectorEtfs)` — the provider and consumer-owned dashboard definitions are required positional arguments; consumers own the market summary universe and pass it explicitly. | `application/dashboard/getMarketSummary.ts` |
| `getSectorSignals(provider, sectorStocks, ...)` — `provider: MarketDataProvider` and the consumer-owned `sectorStocks: readonly SectorStock[]` are required positional arguments; consumers own the scanner universe and pass it explicitly. | `application/dashboard/sectorSignals.ts` |
| `requestChatCompletion(params, dependencies)` — one chat completion for an existing analysis: model tier gating, IP hashing, daily usage-limit check (when `usageRepository` is injected), token consumption, prompt construction, API-key routing (server key vs. `userApiKey`), provider call via the injected `callAiProvider`, best-effort usage recording. `params.model` defaults to `DEEPSEEK_V4_1_FLASH_MODEL`. **Never throws** — returns `ChatActionResult` (`{ ok: true, message, remainingTokens }` or `{ ok: false, error }` with a typed error code); a `server_busy`/`server_error` result refunds the consumed token. | `application/chat/requestChatCompletion.ts` |
| `checkAnalysisLimit(input, dependencies)` — whether an IP/tier pair may make another analysis request today. `input: UsageLimitInput`, `dependencies: UsageLimitDependencies` (repository that reads today's usage). Returns `Promise<boolean>` (`false` = daily limit reached). | `application/usage/limits.ts` |
| `checkChatbotLimit(input, dependencies)` — same as `checkAnalysisLimit` for chatbot requests. Returns `Promise<boolean>`. | `application/usage/limits.ts` |
| `callAnalysisAi(options: CallAnalysisAiOptions)` — the analysis LLM call the `run*` use-cases use: chooses the server key or `userApiKey` (`keyPolicy`, `tier`), resolves the model spec's reasoning config (`reasoning: false` → `reasoning.off`, `true` → `reasoning.on`, omitted → the spec default; `off` is not always zero thinking — see `supportsHardOff`), calls the provider with retries, and returns `Promise<string>` — the JSON-normalized response text (one regeneration when the text cannot be parsed as JSON). Throws `UserApiKeyMissingError` before any provider call when a required user key is missing. Throws a plain `Error` (`[callAnalysisAi] Unknown model: <id>`) before any provider call, under every `keyPolicy`, when `model` is not in `MODEL_SPECS` (for example a retired id passed type-erased); there is no successor mapping in core. `fallbackOnProviderFailure: true` retries a failed server-key DeepSeek call once on the Gemini fallback (ignored under `'byok-only'`). No cache. | `application/analysis/callAnalysisAi.ts` |
| `callBriefingAi(options: CallBriefingAiOptions)` — the briefing LLM call: always the provider's server key (no tier/BYOK). The model is `resolveBriefingModel(options.requestedModel, options.fallbackModel)` (Gemini or DeepSeek only). Returns `Promise<string>`. | `application/analysis/callBriefingAi.ts` |
| `resolveBriefingModel(requestedModel, fallback)` — returns `requestedModel` when it is a Gemini or DeepSeek model in `MODEL_SPECS`, otherwise `fallback`. Returns `BriefingModelId` (`GeminiModelId \| DeepSeekModelId`). | `application/analysis/briefingModel.ts` |
| `runAgentTurn(params, deps)` — 에이전트 대화 한 턴: 사용량 차감 → 프롬프트·히스토리 창 구성 → `maxSteps`까지 provider ⇄ 툴 루프 → 최종 답변과 소비자가 저장할 중간 메시지 반환. provider·툴·카운터 실패는 throw하지 않고 `AgentErrorCode`로 돌려준다. 서버 전용(`index.client.ts` 미노출). **소비자 조치**: ① `RunAgentTurnResult.turnAt`(성공과, 프롬프트가 만들어진 뒤의 실패 variant에 실린다. 게이트 거절 `turn_limit`·`premium_turn_limit`·`server_busy`에는 없다)를 그 턴 user 메시지의 UTC 시각(행 생성 시각 같은 평범한 타임스탬프)으로 저장하고 다음 턴 history의 `AgentMessage.turnAt`으로 되돌려 준다 — 루프가 그 시각으로 실시간 턴과 같은 빌더를 불러 노트를 다시 만들어 붙이므로 요청 prefix가 이전 턴과 바이트 단위로 같아진다. 노트는 (시각, 시간대, 로캘, `krSession`)만의 순수 함수이고 노트 텍스트 자체는 저장하지 않는다. 없거나 형식이 틀린 `turnAt`은 노트 없이 재생되고(예외 없음), 어댑터에는 `turnAt` 키가 전달되지 않는다. 사용자 시간대·로캘·`krSession`이 바뀌거나 코어가 노트 형식을 바꾸면 그 메시지의 재생 노트가 달라져 캐시를 한 번 놓칠 뿐 오류는 아니다. ② `RunAgentTurnParams.krSession`에 KRX 세션 스펙(시간·휴장일)을 넘긴다 — 코어에는 KRX 달력이 없어 없으면 노트에 KRX 줄이 빠진다. ③ `get_bars_indicators` 실행기는 `latest.oscillatorZones`·`latest.oscillatorSummary`(`classifyOscillatorZones`)를 반환한다(프롬프트 규칙이 이 필드를 인용하라고 하며, 없으면 `latest.rsiZone`으로 degrade). ④ `get_fundamentals` 실행기는 `earningsReactionTally`(`tallyEarningsReactions(earningsReactions)`, `earningsReactions`가 `null`이면 `null`)를 `earningsReactions` 바로 뒤에 실어 준다 — 설명이 이 필드로 건수를 인용하라고 한다. ⑤ `get_options_summary` 실행기는 `metrics.putCallReading`(화면에 찍는 반올림 뒤 `putCallRatio`로 `readPutCallRatio(ratio, 'open_interest')`, 비율이 없으면 `null`)을, `get_investor_flows` 실행기는 13F 풋/콜 블록의 `reading`(`readPutCallRatio(ratio, 'notional')`)을 반환한다. ⑥ `get_cached_analysis` 실행기는 `sinceAnalysis.nearestSupport`·`nearestResistance`를 **더 이상 반환하지 않고** `sinceAnalysis.levelLadder`(`buildLevelLadder(priceNow, 후보)`; 후보는 분석 key level·목표가·손절과, 일봉 분석이면 52주·20일 고저와 20/50/200일 이동평균; 후보가 없으면 키 생략)를 반환한다 — 설명과 프롬프트의 레벨 규칙이 이 필드를 전제한다. ⑦ `get_news` 실행기는 심볼 요청에서 기사마다 `session`(`null` = 마지막 마감 뒤 발행)과 봉투의 `priceMoves`(`alignNewsWithPriceMoves` 결과: `window`, `medianAbsDailyChangePct`, `moveDays[{date, changePct, headlines, moreHeadlines}]`, `afterLastClose`; 봉을 못 읽으면 `null`)를 반환하고, 페이지를 잘라 맞췄으면 `itemsTrimmed`(맞추려고 뺀 가장 오래된 기사 수)를 싣는다 — 맞춤은 요약을 줄인 뒤에도 넘치면 가장 오래된 기사부터 뺀다. `priceMoves`가 `null`이면 기사에 `session` 키가 없다. 창 시작은 `since` 필터와 같은 시각의 세션 시간대 날짜라서 창보다 앞선 기사는 없다. `since`가 없을 때 기본 창은 심볼 30일·카테고리 14일(최대 30일)이며, 결과 상한을 4,000자보다 크게 잡아 절단 봉투(`truncated`)가 돌아가지 않게 한다. ⑧ `get_investor_flows` 실행기는 입력 `holder`(문자열)를 읽고, 넘어왔을 때만 `holderLookup`(`query`, `period`, `status`, `matches`, `matchedFilers`, `note`)을 반환한다(없으면 키 없음). ⑨ `get_price_stats` 실행기(서버 전용, `computePriceStats`)는 입력 `symbols`(1~`AGENT_PRICE_STATS_MAX_SUBJECTS`개)·`index`(`AGENT_HISTORY_INDICES`)·`period`·`year`·`from`·`to`·`dates`를 읽는다. 종목과 지수를 합쳐 `AGENT_PRICE_STATS_MAX_SUBJECTS`개, `dates`는 `AGENT_PRICE_STATS_MAX_DATES`개를 넘거나 날짜가 `isIsoDate`가 아니거나 `from`이 `to`보다 늦거나 주체가 없으면 잘라서 처리하지 말고 `{ error: 'invalid_args', argument, reason }`로 거절한다. 창 인자는 `from` > `year` > `period` 순으로 하나만 쓰고(`PriceStatsRequest.ignored`에 나머지를 싣는다), 인자가 `dates`뿐이면 `window.kind`가 `none`이다. 창 인자도 `dates`도 없으면 `{ kind: 'period', period: AGENT_PRICE_STATS_DEFAULT_PERIOD }`다. `to`만 있고 `from`이 없으면 `{ error: 'invalid_args', argument: 'to' }`, `year`가 주체 거래소 현지 기준 올해보다 뒤이거나 `from`이 그 현지 날짜보다 뒤면 각각 `argument: 'year'`·`'from'`으로 거절한다. `dates`는 중복을 뺀 뒤 개수를 센다. 종가는 **마감된 세션만**, 가격만(분할 보정, 배당 제외) 날짜 오름차순·거래소 현지 날짜·로더가 돌려준 행을 실행기에서 더 거르지 않고 `PriceStatsSubjectInput.closes`에 넘기고(가격이 유한한 양수가 아닌 행은 core `normalizeCloses`가 빼고 `unusable_price`·`rowsUnusable` note로 알린다. 실행기가 미리 거르면 그 날짜가 `previous_session`, 즉 '세션 없음'으로 읽힌다. 상류 로더가 이미 뺀 행도 같은 이유로 `previous_session`이 되므로, 데이터 경로가 둘 이상이면 같은 기준으로 걸러 같은 날짜가 경로마다 다르게 읽히지 않게 한다), 진행 중인 세션의 봉은 빼고 `sessionInProgress: true`로 알린다(마감 뒤 데이터 게시 지연 구간에도 그날 마감 봉은 포함해 `calendarChange`·compare와 같은 날짜에서 끝난다). `today`는 **주체별** 거래소 현지 날짜(코인은 UTC)이며 모델 인자가 아니다: 실행기가 `now`에서 계산해 넘기며, 이 값이 `ytd`가 가리키는 해와 마지막 종가 뒤 날짜의 판정(`previous_session`/`after_last_close`)을 정한다. `market`은 달력 id(`us`·`kr`·`crypto`), 코인은 `alwaysOpen: true`다. 창의 시작은 항상 "시작일 당일 또는 그 직전 세션의 종가"다. 조회 실패는 입력 위치를 유지한 채 `{ subject, found: false }`(이력 없음), `{ subject, found: false, error: 'stale_listing', lastTradeDate }`(앱의 상장 폐지 의심 검사에 걸린 KR 종목), `{ subject, available: false, reason: 'provider_failed' }`로 돌려주고 `computePriceStats` 입력에서는 뺀다(설명이 이 세 형태를 말한다). 결과의 `notes`는 `PRICE_STATS_NOTE_TEMPLATES`가 만든 문구 그대로 전달한다(재작성·번역·생략 금지: 모델 규칙이 notes를 따르라고 한다). `get_bars_indicators`의 `calendarChange`와 `show_chart` compare 요약은 같은 기준(`calendarPeriodChange`·`minusCalendarMonths`·`closeOnOrBefore`)으로 맞춰야 한다 — 설명이 "세션이 진행 중이지 않을 때 1·3·12개월 수익률은 `calendarChange`와 같다"고 말한다(진행 중이면 `calendarChange`는 실시간 가격까지, 이 도구는 마지막 마감 종가까지다). 결과 크기는 소비자의 결과 상한 안에 들어가야 하며(절단 봉투가 돌아가면 안 된다. 주체 3개·날짜 5개·모든 note가 붙는 최악의 경우가 약 9.4K자다), E2E 가짜 제공자와 공개 API에서는 이 도구를 제외한다(스윙 통계와 같다). ⑩ `get_bars_indicators`와 `get_fundamentals` 실행기는 필드가 null일 때만 결과의 최상위 `notes: string[]`에 `BARS_RESULT_NOTES`·`FUNDAMENTALS_RESULT_NOTES`의 문구를 **그대로**(재작성·번역·생략·결합 금지) 붙인다 — 설명에서 null 처리 절을 걷어냈으므로 notes가 없으면 모델은 그 규칙을 보지 못한다. 붙는 조건은 아래와 같고, 조건이 하나도 맞지 않으면 `notes` 키 자체를 두지 않는다(빈 배열 금지). 이유를 실행기가 모르는 null에는 붙이지 않는다(null이라는 사실만으로 원인을 지어내지 않는다, DOM-12). 문구 안의 행동(검색·호출·언급)은 질문이 그 필드를 물을 때만 실행하라고 문구가 직접 말하므로, 실행기는 질문을 보지 않고 null이면 붙인다. `get_bars_indicators`: `dailyOnlyFields(timeframe)`는 요청 timeframe이 `1Day`가 아닐 때(1Week·1Month 포함) 항상, 요청한 timeframe 문자열로 한 번; 아래 셋은 `1Day`일 때만이고 `dailyOnlyFields`와 함께 붙지 않는다 — `closeStreakUnavailable`은 `derived.closeStreak`가 null일 때, `maCrossShortHistory`는 `findMaCrosses`의 `complete`가 false라서 `derived.maCross50_200`이 null일 때, `fearGreedUnavailable`은 `fearGreed`가 null일 때(이 둘은 원인을 말하지 않는다: 이력 부족이든 계산 실패든 같은 문구). `get_fundamentals`: `earningsSessionUnknown`은 `nextEarningsDate`가 있고 `earningsSession`이 null이거나 없고 `earningsDateAlt`가 없고 `earningsDateConfirmed`가 false가 아닐 때(앱의 timing note가 `not_provided`인 경우와 같다. `earningsDateAlt`가 있으면 설명의 날짜 불일치 규칙이 적용되므로 붙이지 않는다); `secFieldMissing`은 `recentQuarters`의 한 행에서 `sec`가 있고 그 숫자 필드(`epsDiluted`·`revenue`·`revenueYoYPct`) 중 하나라도 null일 때(10-K에서 만든 4분기 `epsDiluted` 포함, 행이 여럿이어도 한 번; `form`·`filed`·`accn` 같은 비숫자 필드는 보지 않는다); `dividendsNonPayer`는 `dividends`가 확정 비배당 형태(`latestExDate`·`latestAmount` null, `trailing12mAmount` 0, `trailingYieldPct` 0)일 때; `dividendsUnknown`은 `available: true`인 모든 결과(ETF 포함)에서 `dividends`가 null이거나 없을 때; `dividendsTrailingUnknown`은 `dividends.latestExDate`가 있고 `trailing12mAmount`와 `trailingYieldPct`가 **둘 다** null일 때만(`trailing12mAmount`는 있는데 `trailingYieldPct`만 null — 가격이 없을 때 — 이면 금액을 가리는 note를 붙이지 않는다); `krYieldOnLastCloseNull`은 `dividends.annualReported`가 있고 `yieldOnLastClosePct`가 null이고 `dpsCommon`이 null이 아닐 때만(`dpsCommon`도 null이면 `krDpsUnknown`만 붙여 두 note의 조언이 엇갈리지 않게 한다); `krDpsUnknown`은 `annualReported.dpsCommon`이 null일 때; `indexMembershipUnknown`은 미국 주식 결과에서 `indexMemberships`가 null이거나 없을 때(한국 주식·코인에는 붙이지 않는다); `peUntrusted`는 `valuation`이 null이거나 `valuation.pe`가 null일 때. 한 결과에 여러 조건이 맞으면 위 순서대로 모두 붙이고 같은 문구를 두 번 붙이지 않는다. 모델 규칙(시스템 프롬프트의 "Result notes" 줄과 두 설명의 `notes` 문장)이 notes를 따르라고 하므로, 이 조치를 하지 않은 소비자는 모델이 null 필드를 기억이나 자기 계산으로 채우지 않게 할 안전장치를 잃는다. | `application/agent/runAgentTurn.ts` |
| `agentLimit(tier, feature)` — reads one per-tier daily agent quota from `AGENT_LIMITS` (`feature: AgentPerTierLimit`). Related policy constants exported alongside it: `AGENT_LIMITS` (per-tier daily quotas), `AGENT_GLOBAL_LIMITS` (default service-wide `web_search` caps; a consumer may pass its own via `RunAgentTurnDependencies.globalLimits`), `AGENT_TURN_CAPS` (per-turn caps such as `maxSteps` and `turnDeadlineMs`), `TOOL_TIMEOUT_MS` (per-tool timeout by `AgentToolCostClass`). | `application/agent/limits.ts` |
| `classifyProviderError(error)` — maps an upstream provider SDK error to the UI-facing code shared by chat and agent: `'rate_limited'` (HTTP 429), `'server_busy'` (503), otherwise `'server_error'`. Returns `ProviderErrorCode`. | `application/shared/providerError.ts` |

### Tier 2 — Domain Building Blocks

**통합 계산기/감지기 (3)**
| Symbol | Source |
|---|---|
| `calculateIndicators` | `domain/indicators/index.ts` |
| `detectSignals` | `domain/signals/index.ts` |
| `classifyTrend` | `domain/signals/index.ts` |

**개별 지표 단독 export (2)** — 통합 계산기와 별개로 소비자가 직접 쓰도록 노출한 순수 함수. `calculateMA`는 서버 entry 전용, `calculateIchimokuFutureCloud`는 양 entrypoint.
| Symbol | Source |
|---|---|
| `calculateMA(bars, period)` — 종가 단순 이동평균. 봉이 없거나 `period <= 0`이면 `[]`, 봉이 `period`보다 적으면 전부 `null`인 배열(봉과 같은 길이)을 돌려준다. 소비자가 이동평균을 재구현하지 않도록 노출한다. | `domain/indicators/ma.ts` |
| `calculateIchimokuFutureCloud(bars, conversionPeriod?, basePeriod?, spanBPeriod?, displacement?)` — 표준 일목균형표 규격대로 `displacement`봉 앞선 미래 구름(senkou A/B)을 `IchimokuFuturePoint[]`로 돌려준다. 봉이 없으면 `[]`. | `domain/indicators/ichimoku.ts` |

**SMA 교차 이력 (1)** — `src/index.ts`에만 export(순수 함수). **`index.client.ts` 의도적 비공개**: 소비자는 서버의 에이전트 도구 실행기(`get_bars_indicators`)뿐이라 클라이언트 번들에 넣을 이유가 없다. 결과 타입 `MaCross`·`MaCrossScan`은 Tier 4.
| Symbol | Source |
|---|---|
| `findMaCrosses(bars, fastPeriod = 50, slowPeriod = 200, lookbackBars = 252)` — 최근 lookback 봉 안의 SMA 골든·데드 교차를 `MaCrossScan { crosses, evaluatedBars, complete }`로 돌려준다(`crosses`는 오래된 순). 엄격한 위·아래가 뒤집힐 때만 교차로 세고 같은 값인 봉은 건너뛴다. `complete`가 false면(`lookbackBars + slowPeriod`봉 미만) 빈 `crosses`를 "교차 없음"으로 읽으면 안 된다. | `domain/indicators/maCrosses.ts` |

**RSI·오실레이터 구간 판정 (2)** — `src/index.ts`·`src/index.client.ts` 양 entrypoint에 export (순수 함수)
| Symbol | Source |
|---|---|
| `rsiZone(rsi)` — RSI 값을 `RsiZone`(`'overbought'` ≥ `RSI_OVERBOUGHT_LEVEL`(70), `'oversold'` ≤ `RSI_OVERSOLD_LEVEL`(30), 그 사이 `'neutral'`)으로 분류. 분석 프롬프트의 `- RSI zone:` 줄과 소비자(차트 탭 라벨, 에이전트 툴 결과의 `latest.rsiZone`)가 같은 경계를 쓰도록 단일 구현을 공개한다. | `domain/indicators/rsiZone.ts` |
| `classifyOscillatorZones(readings)` — 최신 RSI·스토캐스틱 %K·Williams %R·CCI·MFI(`OscillatorReadings`, `null`·비유한 값은 "없음")를 코어의 기존 경계(RSI 70/30, 스토캐스틱 80/20, Williams %R −20/−80, CCI ±100, MFI 80/20, 모두 경계 포함)로 분류해 `OscillatorZonesView { zones, summary }`를 돌려준다. `zones`는 `OscillatorKey`(`rsi`·`stochastic`·`williamsR`·`cci`·`mfi`)별 `OscillatorZone | null`이고 `zones.rsi`는 항상 `rsiZone`과 같다. `summary`는 한 줄 집계("3 of 5 oscillators oversold (…); 0 overbought; neutral: …")이며 읽을 수 있는 값이 하나도 없으면 `null`. 일부만 읽히면 분모를 "available oscillators"로 적고 끝에 `not available: …`으로 빠진 지표를 나열한다(1개면 단수 "oscillator"). 경계에서 0.5점 안인 neutral 값만 "just above/below its … line" 꼬리표를 받는다(`OSCILLATOR_AT_LINE_POINTS`, `@internal`; 범위가 정해진 RSI·스토캐스틱·MFI·Williams %R에만 적용하고 스케일이 다른 CCI에는 적용하지 않는다). 에이전트 프롬프트의 과매수·과매도 규칙이 `latest.oscillatorSummary`·`latest.oscillatorZones`를 인용하라고 하므로 **소비자 조치: `get_bars_indicators` 실행기가 이미 반올림한 최신값으로 이 함수를 한 번 호출해 `latest.oscillatorZones`(`zones`)와 `latest.oscillatorSummary`(`summary`)를 반환한다**(`latest.rsiZone`은 유지). | `domain/indicators/oscillatorZones.ts` |

**단기 과매도 눌림 판독 (2)**
| Symbol | Source |
|---|---|
| `evaluatePullback(bars)` — 마지막 봉의 short-term washout 판독(종가 vs MA200, Williams %R(14), RSI(2), MA5 청산 기준). 200봉 미만·비유한 종가면 `null`. 일봉 측정값이므로 호출자가 timeframe을 거른다. Returns `PullbackSnapshot \| null`. | `domain/signals/pullback.ts` |
| `classifyPullback(aboveMa200, williamsR)` — 판독 분류만(경계: %R ≤ −90 washout, −90 < %R ≤ −80이고 MA200 위면 near). | `domain/signals/pullback.ts` |

**Fear & Greed Index (per-stock) (7)**
| Symbol | Source |
|---|---|
| `computeFearGreedIndex(bars, buySellVolume, options?)` — per-stock Fear & Greed snapshot. Returns `FearGreedSnapshot \| null`. | `domain/indicators/fearGreed/walkForward.ts` |
| `computeFearGreedHistory(bars, buySellVolume, options?)` — walk-forward 1-year score history. Returns `FearGreedHistoryPoint[]`. | `domain/indicators/fearGreed/walkForward.ts` |
| `scoreToLabel(score)` — map a 0..100 score to its 5-stage `FearGreedLabel`, using `FEAR_GREED_LABEL_CUTOFFS`. | `domain/indicators/fearGreed/composition.ts` |
| `computeLabelTransitions(history, limit)` — 인접한 두 세션의 라벨이 바뀐 지점 목록(최신순, 최대 `limit`개). 라벨 공백(`null`)은 사슬을 끊는다. Returns `FearGreedLabelTransition[]`. | `domain/indicators/fearGreed/regimeStats.ts` |
| `summarizeExtremeZoneOutcomes(history, bars, options?)` — **@deprecated**: `summarizeExtremeZoneEpisodes`를 쓴다. 하위 호환을 위해 남기며 다음 major에서 제거한다. 극단 구간(`EXTREME_FEAR`·`EXTREME_GREED`)별 진입 횟수와 진입 후 N거래일(기본 5·20·60) 종가 변화율의 **중앙값·표본 수**. 표본이 `minSample`(기본 5) 미만이면 중앙값을 `null`로 숨기고, 같은 구간에 `reentryGap`(기본 20)세션 안에 다시 들어오면 같은 국면으로 보고 새 진입으로 세지 않으며, 진입 수가 모자라면 `status: 'insufficient_sample'`. `history`와 `bars`의 길이가 다르면 `[]`. **과거 사후 집계이며 예측이 아니다** — 숫자와 상태값만 돌려주고 문장·권유성 라벨·평균·승률은 만들지 않는다. 표시 문구와 "미래 보장 아님" 고지는 consumer 몫. Returns `ExtremeZoneOutcome[]`. | `domain/indicators/fearGreed/regimeStats.ts` |
| `summarizeExtremeZoneEpisodes(history, options?)` — 극단 구간(`EXTREME_FEAR`·`EXTREME_GREED`)별 **머문 기록**. 구간마다 `entryCount`, `medianSessionsInZone`(기록이 없으면 `null`), 최신순 `episodes`(`startDate`·`endDate`·`sessionsInZone`·`peakScore`·`ongoing`)를 돌려준다. 진입 규칙은 `summarizeExtremeZoneOutcomes`와 같고(`reentryGap` 기본 20 안의 재진입은 같은 기록), `sessionsInZone`은 구간 라벨이었던 세션만 센다. 워밍업 공백(`label: null`) 바로 뒤의 구간 세션은 진입이 아니며, 앞 기록에서 `reentryGap`보다 멀면 어느 기록에도 속하지 않는다(횟수에서 빠지고, 히스토리가 그 세션으로 끝나도 `ongoing`은 `false`). `peakScore`는 공포면 최저·탐욕이면 최고 점수(점수 없는 비정상 입력만 `null`). 날짜·횟수·점수 같은 기록만 돌려주고 수익률·평균·승률은 계산하지 않는다. 표시 문구는 consumer 몫. Returns `ExtremeZoneEpisodeSummary[]`. | `domain/indicators/fearGreed/regimeStats.ts` |
| `computeMarketScoreGap(symbolHistory, market)` — 같은 날짜의 종목 점수 − 시장 점수. 같은 날짜 쌍이 없거나 한쪽 점수가 `null`이면 `null`(다른 날끼리 비교하지 않는다). Returns `FearGreedScoreGap \| null`. | `domain/indicators/fearGreed/regimeStats.ts` |
| `fearGreedInputs(data)` — 종목 공포·탐욕 계산에 쓸 일봉과 매수·매도 거래량. `BarsData.fearGreedBars`(5년)가 있으면 그것을, 없으면 `bars`·`indicators.buySellVolume`을 돌려준다. **종목 점수를 계산하는 모든 지점이 이 헬퍼를 거쳐야** 같은 날 점수가 표면마다 갈리지 않는다. Returns `FearGreedInputs`. | `domain/indicators/fearGreed/inputs.ts` |

**Fear & Greed Index (market-wide) (2)**
| Symbol | Source |
|---|---|
| `computeMarketFearGreedIndex(input)` — CNN-style market-wide snapshot from six daily-close series. Returns `MarketFearGreedSnapshot \| null`. | `domain/indicators/marketFearGreed/walkForward.ts` |
| `computeMarketFearGreedHistory(input)` — walk-forward score history, one point per common session. Returns `MarketFearGreedHistoryPoint[]`. | `domain/indicators/marketFearGreed/walkForward.ts` |

**Fear & Greed Index (crypto market) (3)**
| Symbol | Source |
|---|---|
| `computeCryptoFearGreedIndex(input)` — crypto-market snapshot from a benchmark coin (BTC), a safe-haven close series (gold, forward-filled onto the 7-day calendar), and a universe of ≥ 5 coins. Six factors (momentum, downside volatility, safe haven, breadth, alt season, volume flow), same scale/labels/confidence as the market index. Returns `CryptoFearGreedSnapshot \| null`. | `domain/indicators/cryptoFearGreed/walkForward.ts` |
| `computeCryptoFearGreedHistory(input)` — walk-forward score history, one point per common session. Returns `FearGreedHistoryPoint[]`. | `domain/indicators/cryptoFearGreed/walkForward.ts` |
| `CRYPTO_FEAR_GREED_FACTOR_KEYS` — the six factor keys, in display order. | `domain/indicators/cryptoFearGreed/types.ts` |

**재무제표 분석 헬퍼 (3)**
| Symbol | Source |
|---|---|
| `computeFinancialsScorecard` | `domain/analysis/financialsScorecard.ts` |
| `normalizeFinancialsAnalysisResponse` | `domain/analysis/normalizeFinancials.ts` |
| `normalizeFinancialsSnapshot` | `domain/analysis/normalizeFinancialsSnapshot.ts` |

> **@internal (not exported)**: `buildFinancialsAnalysisPrompt` — `runFinancialsAnalysis` use-case 내부에서만 호출되며 외부 consumer가 프롬프트 문자열을 직접 조합할 진입점이 없다.

**포지션 버킷 (Position Bucket) (1)** — `src/index.ts`에만 export. **`index.client.ts` 의도적 비공개**: `buildMacroBriefingPrompt`/`normalizeMacroBriefing`과 같은 "documented exclusion" 원칙을 따르되 사유는 다르다 — 저 둘은 "consumer가 부분 조합할 진입점이 없어서"(no partial-consumption entry point)이고, `bucketizePosition`은 **신뢰 경계** 문제다: 입력 `avgPrice`는 개인화 분석 설계상 서버에서만 읽어야 하는 값이며(클라이언트가 값을 조작해 보내면 스푸핑), 버킷화 함수 자체를 브라우저 진입점에 노출하면 consumer가 클라이언트 측에서 버킷을 계산해 공유 분석 캐시(`buildAnalysisCacheKey`)를 오염시킬 수 있는 도구를 쥐어주는 셈이 된다. 이 함수와 `PositionBucket` 타입은 그래서 pure function임에도 `index.client.ts`에 미러링하지 않는다(정의부 `src/index.ts` 주석 참고).
| Symbol | Source |
|---|---|
| `bucketizePosition(avgPrice, currentPrice)` — 순수 함수. 평단가 대비 현재가의 미실현 수익률(`r = (currentPrice - avgPrice) / avgPrice`)로 5단계 `PositionBucket`(`'deep-profit'`/`'profit'`/`'near-breakeven'`/`'loss'`/`'deep-loss'`)을 도출. `avgPrice`/`currentPrice`가 non-finite이거나 0 이하면 `null`(버킷을 도출할 수 없다는 신호 — 호출자는 버킷이 없는 캐시 키/프롬프트로 폴백해야 한다). | `domain/analysis/positionBucket.ts` |

**수급(investor flows) 헬퍼 (2)**
| Symbol | Source |
|---|---|
| `evaluateInvestorFlows(snapshot, options?)` — 순수 함수. `InvestorFlowsSnapshot` → `InvestorFlowsScorecard`(기관·내부자·5% 대량보유·공매도·희석 5축, 축별 -100~100 점수·라벨·충분성 플래그·신호, 종합 점수, 신선도 메타). 데이터가 없으면 축은 0점이 아니라 `insufficient`(점수 `null`)이고 종합에서 기권한다. `options.includeFinraData: false`는 FINRA 공매도 데이터를, `includeExchangeLists: false`는 Reg SHO 과열 목록을 무시한다. `squeezeContext`(일봉)를 주면 `scorecard.squeezeRisk`에 숏스퀴즈 점수가 붙고 `short_squeeze_risk` 신호가 그 점수를 따른다. `snapshot.market === 'kr'`이면 DART 보고로 `largeHolders`·`insider` 슬롯을 채우고(`kr_*` 신호) 나머지 3축은 `insufficient`. 임계값은 `domain/investorFlows/constants.ts`의 이름 붙은 상수(측정이 아니라 판단 — 재보정 대상). | `domain/investorFlows/evaluateInvestorFlows.ts` |
| `evaluateSqueezeRisk(snapshot, context, options?)` — 순수 함수. 숏스퀴즈 위험 0~100 점수(`low`/`elevated`/`high`/`extreme`)와 구성요소(공매도 잔고 %·days to cover·잔고 추세·장외 공매도 z·FTD %·과열 목록 연속일·20일 등락·거래량 배수). 기준일 **이전** 일봉만 쓴다(장중 봉 제외). 빠진 구성요소는 가중치를 재정규화(`partial`), 공매도 측 입력이 없으면 `insufficient`, FINRA 포지셔닝 입력이 없으면 level 상한 `elevated`. | `domain/investorFlows/squeezeRisk.ts` |
| `normalizeInvestorFlowsAnalysisResponse` | `domain/analysis/normalizeInvestorFlows.ts` |

**의회 거래 동향 분석 헬퍼 (3)**
| Symbol | Source |
|---|---|
| `normalizeCongressTrades` | `domain/analysis/normalizeCongressTrades.ts` |
| `summarizeCongressTrades` | `domain/analysis/summarizeCongressTrades.ts` |
| `normalizeCongressTrendResponse` | `domain/analysis/normalizeCongressTrend.ts` |

> **@internal (not exported)**: `buildCongressTrendPrompt` — `runCongressTrend` use-case 내부에서만 호출되며 외부 consumer가 프롬프트 문자열을 직접 조합할 진입점이 없다.

**거시경제 (economy) 헬퍼 (8)** — `/economy` 페이지가 FMP wire 응답을 도메인 타입으로 변환할 때 사용. 모두 pure하므로 `index.client.ts`에도 노출. (의도적 비공개: `buildMacroBriefingPrompt`와 `normalizeMacroBriefing`은 `@internal`로 유지 — financials와 달리 macro는 prompt/normalize 단계가 `runMacroBriefing`/`peekMacroBriefingCache`/`peekMacroBriefingCacheEntry` use-case 내부에서만 호출되며 consumer가 부분 조합할 진입점이 없다. 향후 partial 사용처가 생기면 그때 노출 검토.)
| Symbol | Source |
|---|---|
| `normalizeEconomicIndicatorSeries(name, raw, trendLength)` | `domain/economy/normalizeEconomicIndicators.ts` |
| `normalizeTreasuryRates(raw)` | `domain/economy/normalizeTreasuryRates.ts` |
| `computeYieldSpread(snap)` — 2s10s 스프레드(%p, 음수=역전). | `domain/economy/normalizeTreasuryRates.ts` |
| `normalizeEconomicCalendar(raw)` — US 필터 + impact enum 강제 + 날짜 오름차순. | `domain/economy/normalizeEconomicCalendar.ts` |
| `selectCalendarEvents(events, { max, notBefore? })` — 프롬프트·도구 결과에 넣을 캘린더 행을 고른다. 금리 결정 행이 앞자리를 먼저 차지하고(가까운 순) 나머지는 중요도(High → Medium → Low)·가까운 순으로 채운 뒤 날짜 오름차순으로 돌려준다. 금리 결정 행도 `max` 안에 든다. `omitted`는 상한에 밀려 빠진 건수(중요도별). 타입 `CalendarSelection`·`SelectCalendarEventsOptions`. | `domain/economy/selectCalendarEvents.ts` |
| `isRateDecisionEvent(event)` — 정책금리 결정 행인지(`/interest rate decision/i`). | `domain/economy/selectCalendarEvents.ts` |
| `normalizeEconomicEventAnalysis(raw)` — defensively normalizes a raw LLM string/object into a typed `EconomicEventAnalysis`. Returns a neutral default on any parse or normalization failure; never throws. Pure function; safe for browser consumers (`index.client.ts`). | `domain/economy/normalizeEconomicEventAnalysis.ts` |
| `normalizeIndicatorTranslation(raw)` — defensively normalizes a raw LLM string/object into a trimmed Korean name string. Returns `''` on any failure; never throws. Pure function; safe for browser consumers (`index.client.ts`). | `domain/economy/normalizeIndicatorTranslation.ts` |

> **@internal (not exported)**: `buildEconomicEventAnalysisPrompt`, `buildIndicatorTranslationPrompt` — 각각 `runEconomicEventAnalysis`/`runIndicatorTranslation` use-case 내부에서만 호출되며 외부 consumer가 프롬프트 문자열을 직접 조합할 진입점이 없다.

**프롬프트 빌더 (1 + 1 상수)**
| Symbol | Source |
|---|---|
| `buildChatPrompt` | `domain/chat/buildChatPrompt.ts` |
| `AI_SYSTEM_PROMPT` | `domain/analysis/systemPrompt.ts` |

> **@internal (not exported)**: `buildOptionsAnalysisPrompt` — `runOptionsAnalysis` use-case 내부에서만 호출되며 외부 consumer가 프롬프트 문자열을 직접 조합할 진입점이 없다.

**옵션 분석 헬퍼 (4)**
| Symbol | Source |
|---|---|
| `summarizeChainForLlm` | `domain/options/summarizeChainForLlm.ts` |
| `aggregateOpenInterest` | `domain/options/aggregateOpenInterest.ts` |
| `sanitizeOptionsChain` | `domain/options/sanitizeOptionsChain.ts` |
| `mapExpirationsToSlots` | `domain/options/expirationSlots.ts` |

> **@internal (not exported)**: `calculateMaxPain`, `calculatePutCallRatio`, `calculateImpliedMove` — single-purpose calculators consumed only by `summarizeChainForLlm`. Consumers should call `summarizeChainForLlm` (or read derived fields on `OptionsExpirationMetrics`) instead of recomputing. `EXPIRATION_SLOTS` 상수도 `@internal` — `mapExpirationsToSlots`가 내부 참조(슬롯 타입 `ExpirationSlot`/`ExpirationSlotKey`/`SlotMapping`은 public 유지).

**응답 정규화** — 위 표에 나열된 `normalize*`(재무·수급·의회·거시경제 헬퍼)를 제외한 `normalize*` 함수와 `enrichAnalysisWithConfidence`는 **internal**이다. use-case가 LLM 응답 정규화에 내부적으로 사용하며, consumer는 use-case 결과(`*AnalysisResponse`)를 직접 받으므로 정규화 함수를 직접 호출할 필요가 없다.

**티어 게이트 (Tier gating) (17)**
| Symbol | Source |
|---|---|
| `isAllowed` / `getTierLimit` / `getAllowedTimeframes` / `getAllowedModels` | `domain/tier.ts` |
| `getMeteredRevealPolicy` / `buildRevealedTierConfig` — 하루 미터형 전체 공개 정책 조회와, 공개 요청용 `tierConfig`(해당 티어 `infoDepth`만 `revealAs` 티어 값으로 바꾼 사본) 생성. 방문자별 카운트는 소비자 몫. 두 함수 모두 서버·클라이언트 엔트리에서 export | `domain/tier.ts` |
| `isTimeframeAllowed` / `isInfoDepthAllowed` / `isModelAllowed` | `domain/tier.ts` |
| `isPremiumModel` / `isFreeModel` / `requiresByokKey` | `domain/tier.ts` |
| `getModelAccess` / `requiresAuth` — 모델의 접근 등급(`ModelAccess`)과 익명 호출 차단 여부 | `domain/tier.ts` |
| `isTier` | `domain/tier.ts` |
| `TIER_CONFIG` / `DEFAULT_TIER` | `domain/tier.ts` |

**캔들 패턴 (UI/프롬프트에서 사용) (7)**
| Symbol | Source |
|---|---|
| `detectCandlePatternEntries(bars, options?: { atr?: readonly (number \| null)[] })` — candle patterns inside the trailing 15-bar window, context-aware: hammer / hanging man and inverted hammer / shooting star are named by the 10-bar move before the bar (at least 1 ATR), not by body colour; dragonfly / gravestone doji and belt holds need that move; every multi-bar pattern needs the move its definition requires, a first-bar body of at least 0.25 ATR (two- and three-bar reversals) and, for tweezers, a confirming close. A pattern needs at least 15 bars before its first bar (the ATR(14) warm-up), so a short series returns fewer entries. `options.atr` is the ATR(14) series aligned with `bars`; it is used only when its length equals `bars.length`, otherwise the ATR is calculated from `bars`. Returns `CandlePatternEntry[]` in ascending `barIndex`. | `domain/analysis/candle-detection.ts` |
| `getDetectionBars` | `domain/analysis/candle-detection.ts` |
| `selectLastCandlePatternEntries` | `domain/analysis/candle-detection.ts` |
| `getCandlePatternLabel` | `domain/analysis/candle-labels.ts` |
| `getMultiCandlePatternLabel` | `domain/analysis/candle-labels.ts` |
| `getSinglePatternTrend` | `domain/analysis/candle-trend.ts` |
| `getMultiPatternTrend` | `domain/analysis/candle-trend.ts` |

**봉 집계 (1)** — siglens `get_bars_indicators` 에이전트 툴이 `1Day` 봉의 `higherTimeframe`(주봉) 롤업을 만드는 데 쓴다.
| Symbol | Source |
|---|---|
| `aggregateBarsToWeekly(bars)` — ISO 주(월요일 시작, UTC) 집계. open=첫 open, close=마지막 close, high/low=주간 최댓값/최솟값, volume=합. OHLC가 비정상(비유한·0·음수)인 봉은 건너뛴다. 마지막 미완성 주도 포함. | `domain/analysis/aggregateBarsToWeekly.ts` |
| `barPeriodStartSeconds(period, unixSeconds)` — `'week'`(ISO 월요일, UTC)·`'month'`(UTC 달력 월) 기간 시작 시각(초). 주봉·월봉 집계가 그 기간 봉에 찍는 `time`과 같다. 소비자가 "이 날짜가 마지막 주봉·월봉과 같은 기간인가"를 경계 재구현 없이 판정할 때 쓴다(타입 `BarPeriod`). | `domain/analysis/barPeriods.ts` |
| `hasUsablePrices(bar)` — 봉의 OHLC가 모두 유한한 양수인지. 주봉·월봉 집계가 건너뛰는 봉과 같은 판정이다. | `domain/analysis/analysisUtils.ts` |
| `aggregateBarsToMonthly(bars)` — 달력 월(UTC) 집계. 각 봉의 `time`은 그달 1일 00:00 UTC. 나머지 규칙은 `aggregateBarsToWeekly`와 같다(비정상 OHLC 건너뜀, 마지막 미완성 월 포함). | `domain/analysis/aggregateBarsToMonthly.ts` |

**플랜 점검 (2)** — siglens `get_cached_analysis` 에이전트 툴이 분석 당시 플랜을 **지금 가격** 기준으로 다시 재는 데(`sinceAnalysis.planNow`) 쓴다 — 분석 파이프라인과 같은 진입 기준가·같은 계산.
| Symbol | Source |
|---|---|
| `buildPlanCheck(rec, currentPrice, entryPrice)` — 플랜(보정값 우선) 대비 `currentPrice`의 손익비(진입 기준/현재 기준)·진입 구간 이탈·손절 이탈을 결정적으로 계산. `currentPrice`가 유한 양수가 아니면 `null`. `reconciledLevels.stopLossRejected === true`(모델의 손절가가 진입 구간 아래가 아니고 대체할 ATR 기준도 없어 core가 제외함)이면 손절이 없는 플랜으로 계산한다 — 소비자도 `[reconciledLevels.stopLoss, stopLoss]`로 폴백하지 말고 이 표식이 있으면 모델의 `stopLoss`를 건너뛴다. `reconciledLevels.takeProfitPrices`는 항상 오름차순·중복 없음이다(새로 생성한 분석은 보정 단계가, 이전에 캐시된 분석은 캐시 읽기 정규화(`normalizeCachedAnalysisResponse`)가 정렬·중복 제거한다. 이미 정렬된 항목은 그대로이고 캐시 키는 바뀌지 않는다). | `domain/analysis/planCheck.ts` |
| `planEntryPrice(rec, fallback)` — 분석 파이프라인이 쓰는 진입 기준가(유한 양수 `entryPrices`의 평균, 없으면 `fallback`). `buildPlanCheck`의 `entryPrice` 인자로 넘긴다. | `domain/analysis/ai-levels.ts` |

**분석 결과 라벨러 (Outcome labels) (8) — 서버 전용 (index.client 미노출, API-1 비대칭)** — 저장된 분석이 말한 것(판정·플랜·핵심 레벨·시나리오 목표가·패턴 기하)이 이후 봉에서 어떻게 됐는지를 **LLM·네트워크 없이 봉만으로** 재는 측정기. 라벨러는 크론 잡에서 돌아가므로 함수와 버전 상수는 `src/index.ts`에만 있고, 소비자가 저장하고 다시 넘기는 타입은 두 entrypoint 모두에서 export한다(API-3). 라벨은 측정값이지 성과 주장이 아니다 — 항상 `n`(표본 수)과 함께 저장하고, "측정 불가" 상태(`no_plan`·`skipped`·`not_triggered`·`insufficient_forward`, `null` 필드)를 0이나 통과로 바꾸지 않는다. 정의나 상수가 바뀌면 `OUTCOME_LABEL_VERSION`을 올린다(소비자는 저장한 `subject`·`window`로 공급자 호출 없이 재계산). 롱 전용 플랜을 읽는다. 플랜은 기존 공유 helper(`effectiveStopLoss`, 보정 레벨, `stopLossRejected`)로 읽으며, 손절이 없거나 core가 제외한 플랜은 `no_plan`/`no_stop`이다(추측한 손절을 쓰지 않는다).
| Symbol | Source |
|---|---|
| `extractOutcomeSubject(result, promptDynamic)` — 저장된 jsonb 분석(`tab='technical'`의 필터 전 정규화 `AnalysisResponse`)을 방어적으로 읽어 `OutcomeSubject`(`v`, `anchor`(`dataAsOf`), `trend`, `riskLevel`, `plan`(`recommendation`·`entryLow`·`entryHigh`·유효 `stop`·`targets`(구간 고점 초과·중복 제거·오름차순)·`reconciled`), `levels`(`role`·`price`·`refLabels`), `scenarioTargets`, `patterns`)로 복사한다. `trend`·`riskLevel`이 유효하지 않으면 `null`. 손절은 플랜 점검과 같은 규칙으로 읽는다: `reconciledLevels.stopLossRejected`이거나 `reconciledLevels.stopLoss` 키가 있는데 유효하지 않으면(null·0·음수·비유한) **손절 없음**(`stop: null`)이고 모델의 손절로 되돌아가지 않는다. 모델의 손절은 `reconciledLevels`가 없거나 `stopLoss` 키가 아예 없을 때만 쓴다. `promptDynamic`(`null` 허용)은 레벨에 Market Reference 라벨(`refLabels`)을 붙이는 데만 쓴다. 분석 행이 90일 뒤 삭제돼도 라벨을 낼 수 있도록 생성 시점에 저장하는 값이다. | `domain/outcomes/extractOutcomeSubject.ts` |
| `buildOutcomeWindow(closedBars, anchor)` — 닫힌 봉(진행 중 봉 없음, 오래된 순)에서 라벨 계산용 `OutcomeWindow`(`referencePrice`, `adjFactor`, `anchorForming`, `anchorSource`, `anchorBar`(앵커 봉의 현재 최종 범위·종가), `atr`(앵커 포함 직전 60봉만으로 계산한 ATR(14)), `preCloses`(최대 60), `forward`(앵커 이후 20봉 `[time, open, high, low, close]`))를 자른다. 결과는 `{ status: 'ok', window }` \| `anchor_missing` \| `anchor_mismatch`(`factor`) \| `insufficient_forward`(`have`·`need`). 일봉은 소급 조정되므로 분석 시점에 닫혀 있던 앵커 봉은 `현재 종가 / 분석 시점 종가`로 조정 계수를 구한다(`5e-4` 이내는 `1`, `[0.02, 50]` 밖이면 `anchor_mismatch`). 분석 시점에 진행 중이던 봉은 정확한 계수를 잴 수 없어 계수 `1`·`anchorForming: true`이지만, 종가 비율이 `[0.67, 1.5]` 밖이면(가격 기준이 바뀐 분할 등) 그대로 `anchor_mismatch`다(약 0.6% 배당 조정은 대역 안이라 보정하지 않는다). 진행 중이던 앵커 봉은 분석이 본 종가가 그 봉의 최종 `[low, high]`를 양쪽 1% 넓힌 범위 안에 있어야 하고(`low × 0.99 ≤ 종가 ≤ high × 1.01`) 아니면 역시 `anchor_mismatch`다(봉이 찍을 수 없는 가격 = 가격 기준 점프). `anchor_mismatch.factor`는 비율이 유한하지 않으면 `null`. 창이 실제로 읽는 봉만 검증한다: 앵커 포함 직전 60봉(종가와 ATR; ATR은 이 60봉만으로 계산)과 앵커 이후 봉. 이 봉들은 유효 가격(`low ≤ open, close ≤ high`)에 시간이 엄격 증가해야 하고(앵커 쪽을 어기면 `anchor_missing`, 앵커 이후는 거기서 유효 구간이 끝나 `insufficient_forward`), 그보다 오래된 봉은 무시한다. 앵커 앞에 60봉이 안 되면 앞의 봉 전부를 읽고 검증한다. `{ generatedAtMs }` 앵커는 프롬프트가 사라진 옛 행을 위한 대체 경로로, `OutcomeWindow.anchorSource`가 `'generated_at'`이고 기준가는 분석이 본 가격이 아니라 그 봉의 **최종** 종가다 — 통계에서 제외하거나 따로 집계한다(`'prompt_bar'`가 정상 경로). `OutcomeWindow`는 JSON 직렬화 가능하며 저장해 두고 재계산에 쓴다. | `domain/outcomes/buildOutcomeWindow.ts` |
| `labelAnalysisOutcome(subject, window)` — `subject`의 모든 가격에 `window.adjFactor`를 곱한 뒤 라벨을 계산해 `AnalysisOutcomeLabels`(`anchorSource` 포함)를 돌려준다: 수평선별 전진 수익률과 같은 종목 기준선(`forward`), 롱 플랜 결과(`plan`; 판정은 `recommendation`으로 항상 함께 실리며 `wait` 플랜도 평가한다. 체결은 항상 진입 구간 안이고 봉이 열린 위치로 판정하며(구간 아래에서 열린 봉은 직전 종가(첫 봉은 앵커 봉의 최종 종가)가 구간 하단 이상이면 무조건 `void_at_entry`이고 시가가 손절 이하면 `gap_below_stop`, 아니면 `gap_below_zone`이다. 직전 종가가 구간 하단 아래면 무효가 아니며 고가가 구간 하단에 닿을 때 하단에서 체결한다. 손절이 현재가보다 위인 돌파형 플랜은 정상이다). 체결 봉에서 체결가가 시가가 아니면 한쪽 극값이 체결보다 앞섰을 수 있어 불확실성은 플랜에 유리하게 쓰지 않는다 — 위에서 내려온 경우: 저가·고가가 손절·목표를 모두 건드리면 `ambiguous`, 저가가 손절을 건드리면 `stop_first`, 종가가 목표 이상이면 `target_first`, 고가만 목표를 넘고 종가가 아래면 세지 않고 계속; 아래에서 올라온 경우: 둘 다 건드리면 `ambiguous`, 고가가 목표 이상이고 저가가 손절 위면 `target_first`, 종가가 손절 이하면 `stop_first`, 저가가 손절을 건드렸는데 종가가 손절 위면 `ambiguous`(저가가 체결 뒤에 나왔을 수 있다), 그 밖은 계속. 이후 봉은 시가가 손절·목표를 넘어 열리면 그 시가에서 청산한다(지정가처럼 양방향) — 그래서 수익률이 목표 수익률보다 크거나 손절 수익률보다 나쁠 수 있다. `target`은 판정에 쓴 목표가(체결가 위 가장 가까운 목표, 체결 없으면 `null`)이고, `anchorBarUnobserved`는 앵커 봉이 진행 중이었고 그 최종 범위가 진입 구간과 겹칠 때(`low ≤ 구간 상단`이고 `high ≥ 구간 하단`) `true`(라벨러가 못 본 앵커 봉 구간에서 체결됐을 수 있다. 손절만 닿고 체결이 없으면 무관해 손절은 보지 않는다). `target`은 체결은 있었지만 체결가 위 목표가 없는 `no_target_above_fill` 행에서도 `null` — 통계에서 제외하거나 따로 집계한다, `approach`는 기준가 위치로 층화용일 뿐이다. `rwNullTargetFirst`는 수평선 없는 무표류 귀무확률이라 손절·모호·구간 종료 포함 **체결된 모든 플랜**의 `target_first` 비율과만 비교한다), 레벨별 결과와 플라시보(`levels`; 실제 레벨과 플라시보가 모두 평가된 행(`skipped` 아님)에서만 비교한다), 시나리오 목표가 터치(`scenarioTargets`), 패턴 결과(`patterns`; 배열은 subject 순서). 순수·결정적이라 같은 `subject`·`window`는 같은 라벨을 낸다. | `domain/outcomes/labelAnalysisOutcome.ts` |
| `labelLevelOutcome(level, window)` — 지지·저항 하나를 라벨링한다(`LevelOutcomeLabel`). `level.price`는 window와 같은 가격 기준이어야 한다(저장된 subject 가격에는 `window.adjFactor`를 먼저 곱한다). 건너뜀(`no_atr`·`wrong_side`·`at_price`; 기준가와 정확히 같은 레벨은 `at_price`), `untouched`, 터치 뒤 10봉 안에 종가 ±0.5 ATR 장벽으로 `respected`/`broken`(시가 갭이면 `gap`), `inconclusive`, `touched_late`. `placebo`는 같은 함수를 ±0.5 ATR 옮긴 레벨에 돌린 결과다. | `domain/outcomes/labelLevelOutcome.ts` |
| `computeForwardReturns(window)` — 수평선 `[1, 5, 10, 20]`봉의 종가 수익률(%)과 같은 종목·같은 구간의 평균 `h`봉 수익률(`baselinePct`, 표본 20개 미만이면 `null`, 표본 수 `baselineN`)을 돌려준다(`ForwardReturnLabel[]`). window가 닿지 않는 수평선의 `returnPct`는 `null`이다. | `domain/outcomes/computeForwardReturns.ts` |
| `outcomeEarliestLabelTime(generatedAt, timeframe)` — 라벨 창이 채워질 수 있는 가장 이른 시각(생성 시각 + 20봉 × 봉 길이(분), 새 `Date`). 세션 간격 때문에 하한일 뿐이다(일봉은 최소 20일, 보통 약 28일 뒤) — 그 시각에 물어도 `insufficient_forward`가 나올 수 있으므로 `have`/`need`로 다시 시도한다. | `domain/outcomes/outcomeEarliestLabelTime.ts` |
| `OUTCOME_LABEL_VERSION` (`1`) · `OUTCOME_SUBJECT_VERSION` (`1`) — 라벨 정의 버전과 `OutcomeSubject` 형태 버전. 라벨과 함께 저장해 두었다가 `OUTCOME_LABEL_VERSION`이 올라가면 저장한 `subject`+`window`에서 다시 계산한다. | `domain/outcomes/constants.ts` |

**마켓 레퍼런스 (Market Reference) (1)**
| Symbol | Source |
|---|---|
| `computeMarketReference(bars, indicators, timeframe, options?)` — 결정론적·다호라이즌(short/medium/long lookback) 어드바이저리 레퍼런스를 산출. 호라이즌별 윈도우 크기는 `timeframe`(bar resolution)으로 결정한다. 호라이즌별로 (a) 검증된 레벨(fib 되돌림/확장·Volume Profile POC/VAH/VAL·스윙 고/저·MA/EMA·라운드 넘버), (b) 널리 주시되는 지표 레벨(Supertrend/Ichimoku/Donchian/Bollinger/Keltner/VWAP/표준·Camarilla 피봇·호라이즌 윈도우의 극단 스윙에 앵커링된 Anchored VWAP), (c) 서술적 추세 구조(가격 vs MA60/MA200·EMA 정렬·스윙 구조·ADX·효율비·레짐)를 모은다. **예측이 아니라 어드바이저리** — 정밀한 S/R·추세 예측은 distance-matched random 대비 forward edge가 ~0이라는 백테스트 결과에 따라 레벨은 참고용 컨텍스트로만 노출한다. AI는 이 레벨을 직접 계산하지 않고 선택·해석한다(price-arithmetic hallucination 제거). `options`는 `{ assetClass?, currency?, clock? }`다. `assetClass`/`currency`는 피봇 세션 달력(crypto=UTC일, `KRW`=KST, 그 외 미국 동부)을 고르고, `clock?: MarketReferenceClock`(`{ session: MarketSessionSpec; now: Date }`)은 일봉에서 마지막 봉이 마감된 세션인지 판정해 마감 뒤에는 마지막 봉, 진행 중에는 그 이전 봉으로 피봇을 계산하게 한다(생략하면 이전 봉). 일봉에서는 VWAP을 레벨로 싣지 않는다. Returns `MarketReference`. | `domain/analysis/marketReference.ts` |
| `isCompanyEarningsEvent(eventDate, earningsDates)` — `eventDate`(`Date` 또는 `YYYY-MM-DD`)가 이 회사 실제 보고일(`earningsDates`, 과거·예정) 보고일 −1일 ~ +3일(UTC 달력일, 양 끝 포함) 안이면 `true`. 뉴스 카드 `earnings` 범주는 테마 라벨(경쟁사 실적·프리뷰·실적 시즌 기사)이라 보고일 증거가 아니다. 보고는 장 마감 후라 기사는 당일~다음 세션이고 주말이 끼면 +3일이다. 하루 전보다 이른 기사(프리뷰)는 제외한다. 세션 달력이 없어 달력일로 센다. **서버 전용**(index.client 미노출 — 에이전트 툴/분석 서버 경로에서만 쓴다, API-1 비대칭). | `domain/analysis/earningsEvents.ts` |
| `pullbackEventCaveat({ events, earningsDates?, bars })` — 최근 3세션 안에 회사 이벤트(실적 보고일 근처 earnings·guidance·regulation, 영향 high/medium, 비강세)가 있으면 짧은 영어 caveat 문자열, 없으면 `null`. consumer는 에이전트 툴 결과의 `pullback.caveat`에 붙인다. 분석 프롬프트의 washout 판정 보류와 같은 게이트. `earningsDates` 생략 또는 `[]`이면 earnings 행도 (안전한 쪽으로) 잡되 "earnings-related news"로만 표기한다. 입력 타입 `PullbackEventCaveatInput`. **서버 전용**. | `domain/analysis/confluenceSection.ts` |
| `krxTickSize(price, table?)` / `roundToKrxTick(price, table?)` — KRX 호가가격단위. `table`은 `KrxTickTable`(`'share'` 기본 \| `'etp'`)이다. 주식(코스피·코스닥) 표(2023-01-25 개편: 2,000원 미만 1원 · 5,000원 미만 5원 · 20,000원 미만 10원 · 50,000원 미만 50원 · 200,000원 미만 100원 · 500,000원 미만 500원 · 이상 1,000원)와, 가장 가까운 호가로의 반올림(반올림 half up; 비유한·0 이하 값은 그대로). core가 KRW 프롬프트·캐시 결과에 쓰는 규칙과 같은 것이라 소비자 표시도 이것으로 맞춘다. ETF·ETN은 `'etp'` 표(2,000원 미만 1원, 이상 5원)다 — core는 통화만 알아 종목 유형을 모르므로 소비자가 상장 유형으로 고르고 `krxTickTable` 옵션으로 넘긴다(기본은 주식 표). ELW(전 구간 5원)는 모델링하지 않는다. 브라우저 진입점에도 export. | `domain/analysis/krxTick.ts` |

**MA 스택 분류 (1)** — siglens `get_bars_indicators` 에이전트 툴의 `derived.maStack`(계약은 core `domain/agent/tools.ts`) 분류기. 순수 함수 — `index.ts`/`index.client.ts` 양쪽 노출.
| Symbol | Source |
|---|---|
| `classifyMaStack(indicators, periods = MA_DEFAULT_PERIODS)` — 각 MA 시리즈의 **마지막 원소**(최신 봉)를 기간 순서대로 비교. 기간이 커질수록 엄격히 감소하면 `'bullish'`(MA5 > MA20 > MA60 …), 엄격히 증가하면 `'bearish'`, 그 외(동률 포함) `'mixed'`. 마지막 원소가 없거나 `null`/비유한인 기간은 제외하며 이전 값으로 대체하지 않는다. 유효 값이 2개 미만이면 `null`. Returns `MaStackDirection \| null`. 내부 `classifyEmaStack`(가격 + EMA 2개 → `EmaStackState`, `null` 없음)과 달리 가격을 제외하고 설정된 MA 기간 전부를 본다. | `domain/analysis/trendStructure.ts` |

**대시보드 헬퍼 (3)**
| Symbol | Source |
|---|---|
| `bucketedTimestamp` | `domain/dashboard.ts` |
| `computeStockSignalResult` | `domain/dashboard.ts` |
| `lookbackIsoFromNow` | `domain/dashboard.ts` |

**시장 세션 (Market session) (4)**
| Symbol | Source |
|---|---|
| `isEtRegularSessionOpen(now)` — DST-safe US 정규장(09:30–16:00 ET, 마감 정각 제외) 개장 여부. | `domain/utils.ts` |
| `getEtSessionStatus(now)` — `'weekend' \| 'open' \| 'closed'` 3-state 세션 분류. | `domain/utils.ts` |
| `getSessionStatus(spec, now)` — 임의의 `MarketSessionSpec`에 대해 `MarketSessionStatus`를 반환하는 spec-driven 버전. DST-safe. (`MarketSessionStatus`는 `EtSessionStatus`의 별칭으로 동일한 타입.) | `domain/session.ts` |
| `isRegularSessionOpen(spec, now)` — `getSessionStatus`를 boolean으로 래핑한 편의 함수. `boolean`을 반환한다 (`getSessionStatus(...) === 'open'`). | `domain/session.ts` |

> **@internal (not exported)**: `secondsUntilNextRegularOpen`·`secondsUntilNextRegularClose`·`secondsUntilNextUtcMidnight` (`domain/utils.ts`) — bars·analysis 캐시 TTL 계산 전용으로 cache config 내부에서만 사용. `nextRegularSessionBoundaryMs`·`localSessionParts` (`domain/session.ts`) — 세션 스펙 기반 다음 개장/마감 계산과 `getSessionStatus` 내부 헬퍼.

**모델 스펙 헬퍼 (8 + 가드 5)** — `getProvider`, `isClaudeModel`, `isGeminiModel`, `isChatGPTModel`, `isDeepSeekModel`, `isReasoningToggleable`, `supportsHardOff`, `getThinkingLevelSequence` (`domain/analysis/modelSpecs.ts`), `isClaudeAdaptiveModelSpec`, `isClaudeBudgetModelSpec`, `isClaudeModelSpec`, `isTemperatureModelSpec`, `resolveReasoningConfig` (`domain/types.ts`). `is*Model(model)`은 `ActiveModelId`를 provider별 서브셋(`ClaudeModelId`·`GeminiModelId`·`ChatGPTModelId`·`DeepSeekModelId`)으로 좁히는 타입 predicate이며 `MODEL_SPECS[model].provider`로 판정한다. `isReasoningToggleable(model)` — 추론 토글이 요청을 실제로 바꾸는지(`off`와 `on` 설정이 다른지). `false`면 소비자 UI는 토글을 비활성화해야 한다. `supportsHardOff(model)` — 추론을 끄면 정말로 사고 토큰이 0이 되는지(spec의 실측 `hardOff`, 전 provider 공통). `getThinkingLevelSequence(initial, floor)` — Gemini 사고 수준 재시도 순서(`initial`에서 `floor`까지 내림차순; `floor`는 `MODEL_SPECS[model].reasoning.off.level`). `is*ModelSpec` 가드는 `ModelSpec` union을 Claude adaptive/budget 변종 또는 temperature를 싣는 변종으로 좁힌다. ⚠️ `isTemperatureModelSpec`이 `true`여도 DeepSeek은 추론이 켜져 있으면 `temperature`를 무시하므로, 보내기 전에 `resolveReasoningConfig`로 얻은 설정의 `thinking`을 함께 확인한다. `resolveReasoningConfig(modes, reasoning)` — spec의 `ReasoningModes`(`off`/`on`/`default`)에서 실제 호출에 쓸 provider별 추론 설정을 고른다.

**에이전트 턴 컨텍스트 (2)**
| Symbol | Source |
|---|---|
| `buildAgentTurnContext(input: AgentTurnContextInput): string` — 턴별 `## Now` 노트를 만든다: 사용자 현지 시각(요일·월~일 주 포함), 요일이 붙은 UTC·ET·KST 한 줄, US 줄(NYSE/Nasdaq: `open`·`closed`·`pre-market hours`·`after-hours` + 다음 개장/마감 시각과 남은 시간, 휴장일·반장 반영), `krSession`이 `scheduled`이면 KRX 줄. 각 개장/마감 시각은 그 시장의 시간대로 적고, 사용자의 시간대에서 시계가 다르게 보이면 요일을 붙여 사용자 시간대로도 함께 적는다(예: `09:30 ET (Fri 2026-11-20 23:30 KST)`) — 모델이 시간대를 직접 환산하지 않게 하기 위해서다. 상태 이름은 시계 구간(04:00 ET~개장, 마감~+4시간)만 가리키며 SIGLENS가 어떤 가격을 싣는지는 주장하지 않는다. `etSessionStatus`는 `@deprecated`(무시), `krSession?: MarketSessionSpec`은 소비자가 넘긴다(KRX 달력은 소비자 소유). | `domain/agent/buildAgentSystemPrompt.ts` |
| `composeAgentUserMessage(context, userMessage): string` — 그 노트를 최신 사용자 메시지 앞에 붙인다(`## Now … ## Message <text>`). 영속화는 이 결과가 아니라 평문 `userMessage`로 한다. | `domain/agent/buildAgentSystemPrompt.ts` |

의도적으로 서버 전용이다. 두 함수(그리고 `buildAgentSystemPrompt`)는 `index.client.ts`에서 re-export하지 않는다 — provider 요청을 조립하는 일은 서버만 하기 때문이다. `splitAgentFollowUps`는 브라우저가 스트리밍된 답변 텍스트에서 follow-up 마커를 파싱하므로 client entry에 있다. 브라우저에서 프롬프트를 조립하는 코드는 없다.

`HistoryWindowOptions.stride?: number`(기본 `1`): `selectHistoryWindow`는 오래된 턴을 `stride` 단위 블록으로 버리며 `turns`…`turns + stride − 1`개 턴을 유지한다. 그래서 히스토리 prefix가 `stride`턴 동안 바이트 단위로 동일하게 유지된다. `runAgentTurn`은 `stride: 4`를 쓴다.

`HistoryWindowOptions.toolResultStride?: number`(기본 `1`): 툴 결과가 `omitted`로 바뀌는 경계를 한 턴씩이 아니라 `toolResultStride`턴 단위로 옮긴다 — `toolResultTurns`…`toolResultTurns + toolResultStride − 1`개 최근 턴이 원문으로 남아, 경계가 움직이지 않는 턴 동안 요청 prefix가 바이트 단위로 유지된다. 예산을 넘기면 정확히 `toolResultTurns`턴으로 되돌아가고, 예산 초과 탈락은 `stride`가 1보다 크면 `stride` 블록 단위다. `runAgentTurn`은 `toolResultStride: 2`를 쓴다.

**지표 합류 (confluence) — 서버 entry 전용 (6 functions + 11 constants)**

여러 지표 패밀리가 같은 방향을 가리키는지 점수화하는 순수 함수. 소비자가 봉(고차 타임프레임 봉 포함)을 직접 가져와 넘기며, 이 계층은 I/O를 하지 않는다. 타입은 Tier 4 색인(`ConfluenceSnapshot`, `ConfluenceParams`, `EvaluateConfluenceOptions`, `ConfluenceHtfMode`)을 본다.
| Symbol | Source |
|---|---|
| `evaluateConfluence(bars, options)` — 마지막 봉 기준 종목의 지표 합류 상태. 진입 규칙: 가중 지표 패밀리 수가 `min` 이상 강세이고 그중 하나는 직전 봉 대비 새로 켜졌으며, 종가가 같은 타임프레임 SMA 위, 고차 타임프레임이 `htfMode`가 요구하는 상태, `requireVolume`이면 거래량 패밀리 신호 1개 이상. 청산 규칙은 앞 세 조건의 약세 반전이며 자체 임계값(`exitMin`)을 쓴다. `ConfluenceSnapshot \| null`을 반환하고 `null`은 기권(봉 부족·비유한 종가)이다. | `domain/signals/confluence.ts` |
| `scoreConfluence(snapshot)` — 스냅샷을 0..100 점수로 변환. 연속 구간은 50 ± `span`(기본 35..65), 진입 트리거는 `CONFLUENCE_TRIGGER_SCORE`(92), 청산 트리거는 `CONFLUENCE_EXIT_SCORE`(8)로 고정된다. `null`은 중립 50. | `domain/signals/confluence.ts` |
| `isConfluenceExit(snapshot)` — 약세 반전(청산) 트리거가 성립했는지. 트리거만 센다. | `domain/signals/confluence.ts` |
| `confluenceFamilyWeight(types)` — 신호 타입 목록의 가중 고유 지표 패밀리 수. 패밀리는 가장 큰 멤버 가중치를 한 번만 기여하므로 결과가 소수일 수 있다(확정 패밀리 2 + 예상 패밀리 1 = 2.5). | `domain/signals/confluence.ts` |
| `signalFamily(type)` — 신호가 속한 지표 패밀리. 매핑이 없으면 타입 이름 자체. | `domain/signals/confluence.ts` |
| `isExpectedSignal(type)` — 완료된 이벤트가 아니라 예상·위치 조건을 서술하는 신호인지(절반 가중). 소수 패밀리 수에 라벨을 붙일 때 쓴다. | `domain/signals/confluence.ts` |
| `CONFLUENCE_MIN` / `CONFLUENCE_EXIT_MIN` — 진입·청산 트리거의 가중 패밀리 수 기본 임계값(둘 다 2.5, 의도적으로 분리). | `domain/signals/confluence.ts` |
| `CONFLUENCE_SPAN` / `CONFLUENCE_SHRINK` — 연속 점수 구간의 반폭(15)과 단독 신호가 구간 끝으로 붙지 않게 분모에 더하는 의사 개수(1). | `domain/signals/confluence.ts` |
| `CONFLUENCE_TRIGGER_SCORE` / `CONFLUENCE_EXIT_SCORE` — 진입·청산 규칙이 정확히 성립할 때 스냅샷이 받는 점수(92 / 8). | `domain/signals/confluence.ts` |
| `CONFLUENCE_EXPECTED_WEIGHT` — `expected` 단계 신호의 표 가중치(0.5, `confirmed`는 1). | `domain/signals/confluence.ts` |
| `CONFLUENCE_MIN_BARS` / `CONFLUENCE_TREND_MA_PERIOD` — 판독에 필요한 최소 봉 수(120)와 같은 타임프레임 추세 필터 SMA 기간(50). | `domain/signals/confluence.ts` |
| `CONFLUENCE_HTF_MODE` / `VOLUME_FAMILIES` — 고차 타임프레임 게이트 기본 모드(`'uptrend'`, `ConfluenceHtfMode`)와 거래량에서 파생되는 지표 패밀리 집합(`cmf`, `mfi`). | `domain/signals/confluence.ts` |

**미국 시장 달력 — 양 entrypoint (5 functions + 2 constants)**

NYSE 휴장일·조기 마감일을 ET 달력일 기준으로 판정하는 순수 함수. 주말은 휴장일 판정에 포함되지 않는다.
| Symbol | Source |
|---|---|
| `isUsMarketHoliday(now)` — `now`가 속한 ET 달력일이 NYSE 전일 휴장일인지(주말 제외). | `domain/marketCalendar.ts` |
| `isUsTradingDay(now)` — 평일이면서 휴장일이 아니어서 거래소가 여는 날인지(조기 마감일 포함). | `domain/marketCalendar.ts` |
| `isUsMarketEarlyClose(now)` — 13:00 ET 조기 마감일인지. 전일 휴장일에는 항상 `false`. | `domain/marketCalendar.ts` |
| `usMarketCloseMinute(now)` — 그날의 마감 시각(ET 자정 기준 분). 전일 휴장이면 `0`, 조기 마감이면 `EARLY_CLOSE_MINUTE`, 아니면 `REGULAR_CLOSE_MINUTE`. | `domain/marketCalendar.ts` |
| `minutesUntilUsMarketClose(now, minutesOfDay)` — 마감까지 남은 분. 마감 이후나 전일 휴장이면 `0`. | `domain/marketCalendar.ts` |
| `REGULAR_CLOSE_MINUTE` / `EARLY_CLOSE_MINUTE` — 정규 마감(16:00 ET)과 조기 마감(13:00 ET)의 ET 자정 기준 분. | `domain/marketCalendar.ts` |

**분석 출력 언어 — 양 entrypoint (2 constants + 1 guard)**
| Symbol | Source |
|---|---|
| `ANALYSIS_LOCALES` / `DEFAULT_ANALYSIS_LOCALE` — 지원하는 출력 언어 목록(`AnalysisLocale`: `'ko' \| 'en' \| 'ja' \| 'zh'`)과, 소비자가 생략했을 때 쓰는 기본값 `'ko'`(생략 시 바이트·캐시 키가 기존과 같다). | `domain/analysis/outputLocale.ts` |
| `isValidAnalysisLocale(value)` — 신뢰할 수 없는 문자열(URL 세그먼트 등)을 `AnalysisLocale`로 좁히는 가드. | `domain/analysis/outputLocale.ts` |

**모델 정책 가드 — 서버 entry 전용 (1)**
| Symbol | Source |
|---|---|
| `isModelAllowedForTier(model, tier)` — `tier`가 `undefined`면 검사를 생략(`true`), 있으면 `isModelAllowed`가 참조하는 모델 roster에 등록된 모델인지 확인한다. 비용 안전장치가 아니다 — 그건 `shouldUseServerKey`/`requiresUserApiKey`가 맡는다. | `domain/keyRouting.ts` |

**스토캐스틱 지표 상수 — 양 entrypoint (11)**
| Symbol | Source |
|---|---|
| `STOCHASTIC_K_PERIOD` / `STOCHASTIC_D_PERIOD` / `STOCHASTIC_SMOOTHING` — 스토캐스틱 기본 기간(14 / 3 / 3). | `domain/indicators/constants.ts` |
| `STOCHASTIC_OVERBOUGHT_LEVEL` / `STOCHASTIC_OVERSOLD_LEVEL` — 과매수·과매도 기준선(80 / 20). | `domain/indicators/constants.ts` |
| `STOCH_RSI_RSI_PERIOD` / `STOCH_RSI_STOCH_PERIOD` / `STOCH_RSI_K_PERIOD` / `STOCH_RSI_D_PERIOD` — Stochastic RSI 기본 기간(14 / 14 / 3 / 3). | `domain/indicators/constants.ts` |
| `STOCH_RSI_OVERBOUGHT_LEVEL` / `STOCH_RSI_OVERSOLD_LEVEL` — Stochastic RSI 과매수·과매도 기준선(0.8 / 0.2, 0..1 스케일). | `domain/indicators/constants.ts` |

**에이전트 도구 카탈로그·가드 — 서버 entry 전용 (7 functions + 6 constants)**

ai.siglens.io 에이전트가 쓰는 도구 계약. 실행기는 소비자가 구현하고, core는 카탈로그·인자 검증·답변 근거 검사·프롬프트 조립만 맡는다.
| Symbol | Source |
|---|---|
| `AGENT_TOOL_SPECS` / `AGENT_TOOL_NAMES` — 도구 카탈로그(`AgentToolSpec[]`)와 그 이름 목록. 설명은 모델이 읽는 유일한 정보라 "언제 호출하는가"를 말한다. **소비자 조치**: `get_economy` 실행기는 선택 인자 `from`/`to`(YYYY-MM-DD, 최대 88일)를 받아 그 기간의 캘린더만 돌려주고, 결과의 `calendar`를 `{ coverage: { from, to }, events, omitted }`(`selectCalendarEvents`로 선별)로 낸다. 선택 인자 `country`(`'us'` 기본, `'kr'`)가 `'kr'`이면 `indicators[]`를 `{ name, label, unit, latest: { date, value }, change }`(발표 이력 기반, `date`는 그 발표일)로, 한국 캘린더를 같은 `calendar` 모양으로 내고 `treasury`·`briefing`은 내지 않는다. `country: 'kr'`과 `from`/`to`를 함께 주면 그 기간의 한국 캘린더만 낸다. 설명과 라우팅 규칙이 이 필드를 가리키므로 **core를 이 버전으로 올리는 변경에 실행기 구현을 함께 넣는다** — 실행기가 `country`를 무시하면 모델이 미국 값을 한국 값으로 읽는다. 아래 필드도 설명이 "있을 때"로 가리키며, **소비자 조치**로 실행기가 채운다(siglens `y0ngha/siglens#1100`, `#1101`, `#1102`와 종목 지수 편입 PR): `get_bars_indicators` — `derived.closeStreak`(`{ direction, days, sinceDate, truncated }`, 1Day), `range`/`ranges`의 `highClose`·`highCloseDate`·`fromHighClosePct`와 저가 대응 필드(종가 기준); `get_investor_flows` — `proposedSalesCounts`(`{ last30d, last90d, windowTo, last30dFrom, last90dFrom, excludesAmendments }`)와 행별 `formType`, 한국 종목의 `krInvestorTrend`(`{ asOf, rows, sum5d, sum20d \| null, unit: 'shares', source: 'naver' }`); `get_fundamentals` — `recentQuarters[]`의 `form`(미국 국내 상장사만, 그 외 null)과 `revenueYoYPct`, 행별 `sec`(`{ form, epsDiluted, revenue, revenueYoYPct, filed, accn } \| null`, SEC XBRL 원문 기준·미국 국내 상장사만, 한국·외국 상장사·미매칭은 null; siglens `feat/agent-sec-xbrl-quarters` — 있으면 모델이 EPS·매출을 `sec`에서 제출 서식·제출일과 함께 인용하고, 없으면 행 필드로 폴백하며, 4분기 EPS(`sec.epsDiluted` null)는 계산하지 않고 "공시에 분기 EPS 없음"으로 답한다), `dividends`(`{ latestExDate, latestAmount, currency, payDate, trailing12mAmount, trailingYieldPct, source }`; 한국 종목은 `annualReported`(`{ fiscalYear, dpsCommon, dartYieldPct, yieldOnLastClosePct, source: 'DART' }`, siglens KR DART 배당 PR `feat/agent-kr-dividend-dart`(번호 미정))도 — 우선주·DART 보고서 없음·비한국이면 생략, `yieldOnLastClosePct`는 null일 수 있다. 모델은 이를 헤드라인으로 쓰고 null이면 `dartYieldPct`(기록일 가격 기준)를, 생략이면 trailing 필드를 쓴다), 미국 종목의 `indexMemberships`(`{ sp500, nasdaq100, dowJones, asOf, source: 'wikipedia' }`), 한국 종목 시가총액의 `sharesBasis`(`'krx_listed' \| 'provider'`); `get_market_overview` — 지수의 `lastClose`/`lastCloseDate`(공식 일봉 종가, `price`는 실시간·최종 체결). 실행기가 이 필드를 빼면 모델은 폴백한다: `closeStreak`은 일봉에서 직접 세고, 배당·지수 편입·한국 순매수는 `web_search`가 있으면 출처와 함께 검색하고 없으면 "확인하지 못했다"고 답하며, 행 `form`도 `sec.form`도 없으면 가장 최근 Q1–Q3 행을 쓰되 서식은 확인되지 않았다고 말한다(둘 다 있고 다르면 실제 제출 서식인 `sec.form`이 우선, 10-Q/A는 해당 분기의 10-Q로 본다. `sec`의 null 필드는 "공시에 없음"으로 답하며 행 값을 쓰거나 계산하지 않는다). | `domain/agent/tools.ts` |
| `findToolSpec(name)` — 이름으로 도구 스펙을 찾는다. 없으면 `undefined`. | `domain/agent/tools.ts` |
| `selectTools(available)` — 소비자가 지금 실행할 수 있는 도구 이름 집합(`ReadonlySet<string>`)으로 카탈로그를 거른다. core는 환경 변수를 읽지 않는다. | `domain/agent/tools.ts` |
| `FRESH_ANALYSIS_KINDS` — `run_fresh_analysis` 도구가 만들 수 있는 분석 종류(`FreshAnalysisKind`). | `domain/agent/tools.ts` |
| `AGENT_BARS_TIMEFRAMES` — `get_bars_indicators`가 받는 타임프레임(`AgentBarsTimeframe`): 제공자 타임프레임 전부 + `'1Week'`·`'1Month'`. 다른 도구(`get_cached_analysis`·`run_fresh_analysis`)는 그대로 `TIMEFRAMES`다. **소비자 조치**: `get_bars_indicators` 실행기가 `1Week`/`1Month`를 받으면 일봉(가능하면 5년치 `fearGreedBars`)을 `aggregateBarsToWeekly`/`aggregateBarsToMonthly`로 묶어 지표를 계산하고, 도구 설명이 약속한 대로 `t`=기간 첫날, `asOf`=마지막 일봉 날짜, `higherTimeframe`=1Week에서 월봉·1Month에서 null, `pullback`·`fearGreed`·`calendarChange`·`maCross50_200`·`closeStreak`·`lastCompletedClose`=null로 낸다. **core를 이 버전으로 올리는 변경에 실행기 구현을 함께 넣는다** — 실행기가 모르면 `1Week` 요청이 실패한다. | `domain/agent/tools.ts` |
| `AGENT_MACRO_INSTRUMENTS`·`AGENT_MACRO_QUOTES_MAX` — `get_macro_quotes`가 받는 닫힌 종목 목록(`AgentMacroInstrument`: 원자재, 지수 선물, 달러 인덱스, 환율)과 한 번에 받는 최대 개수. 최대 개수를 넘는 목록은 실행기가 자르지 않고 `{ error: 'too_many_instruments' }`로 거절한다. SIGLENS 심볼이 아니라서 자유 심볼 대신 이 목록에서 고른다. **소비자 조치**: `get_analyst_views`·`get_macro_quotes` 실행기를 등록해야 두 도구가 모델에 노출된다(`selectTools`). `get_macro_quotes` 실행기는 각 키를 자기 시세 제공자 심볼로 옮기고, 도구 설명이 약속한 필드(`contract`, `quoteDelayMinutes`, `changes`, `range52w`, 못 받은 항목의 `found: false`)를 낸다. `get_analyst_views` 실행기의 출력 계약: 변경 이력을 읽을 수 없으면 `actions.available: false`와 함께 `actions.tally`를 `null`로 낸다(0으로 채우지 않는다). 이력이 이번에 로드에 실패한 경우에는 `degraded`에 `'yahoo'`를 싣고, 원래 없는 종목(한국 종목)은 싣지 않는다 — 도구 설명이 이 차이로 "불러오지 못했다"와 "이력이 없다"를 가른다. 목표가·의견 분포·이력이 모두 없을 때는 로드 실패면 `{ available: false, reason: 'provider_failed' }`, 커버리지가 없는 종목·ETF면 `{ available: false, reason: 'no_analyst_data' }`, 주식이 아니면 `{ available: false, reason: 'not_a_stock' }`다. `get_analyst_views` 실행기는 있을 때 `estimates`(최대 4기간 `{period: '0q'|'+1q'|'0y'|'+1y', endDate, eps {avg, analysts, ago7d, ago30d, ago60d, ago90d, change30d, change90d}, revisions {up7d, down7d, up30d, down30d}, revenue {avg, analysts, growthPct}}`, `change*`는 현재 − N일 전 절대값, 못 읽었으면 `null`)를 싣는다. `get_investor_flows` 실행기는 미국 종목에 `ownershipShares`(`{institutionsPct, institutionsFloatPct, insidersPct, institutionCount, source}`, 못 읽었거나 한국 종목이면 `null`)를 싣는다. `get_fundamentals` 실행기는 있을 때 `earningsSession`·`earningsCallAt`·`earningsDateAlt`·`priceTargetSource`·`priceTargetYahoo`·`targetSourcesDisagree`·`consensusAnalysts`·`consensusSource`를 싣는다(없어도 동작한다). | `domain/agent/tools.ts` |
| `AGENT_THEMES`·`AGENT_THEME_IDS`·`findAgentTheme`·`AgentTheme`·`AgentThemeId`·`THEME_CHANGE_WINDOWS`·`summarizeTheme`·`ThemeChangeWindow`·`ThemeMemberCloses`·`ThemeMemberStats`·`ThemeSnapshot`·`ThemeWindowSummary` — `get_theme_snapshot`의 테마 목록(SIGLENS가 고른 대표 종목 묶음, 미국 7개·한국 4개)과 집계 순수 함수. `summarizeTheme(theme, members)`는 종목별 완결 일봉 종가(오래된→최신)로 1·5·20거래일 등락률과 52주 종가 고점 대비를 구하고, 기간별 동일가중 평균·중앙값·상승/하락/보합 수·최고·최저를 낸다. 종가가 없는 종목은 `missing`에, 기간에 필요한 종가가 모자란 종목은 그 기간 집계에서만 빠진다. **소비자 조치**: `get_theme_snapshot` 실행기를 등록해야 도구가 노출된다. 실행기는 `theme`의 종목 일봉을 읽어 `summarizeTheme`에 넘기고 결과에 `asOf`를 붙인다. 진행 중인 봉은 넘기지 않는다. 모든 종목을 못 읽었으면 `{ available: false, reason: 'provider_failed' }`. | `domain/agent/themes.ts`, `domain/agent/themeSnapshot.ts` |
| `AGENT_HISTORY_INDICES`·`computeIndexHistoryStats`·`AgentHistoryIndex`·`AnnualReturn`·`IndexHistoryStats`·`MonthEndClose`·`PresidentialCyclePosition`·`ReturnStats` — `get_index_history_stats`의 지수 목록(sp500, nasdaq, kospi, kosdaq)과 통계 순수 함수. `computeIndexHistoryStats(monthEnds, { usCycle, currentMonth })`는 월말 종가로 연간 수익률·연중 월말 기준 최대 낙폭, 월별 계절성, (미국만) 대통령 임기 주기별 통계와 중간선거 해 10월 말부터 12개월 수익률을 낸다. `currentMonth` 이후(진행 중인 달)와 잘못된 값은 버리고, 한 해는 그 해와 전년 12월 종가가 모두 있어야 센다. 월말 종가가 하나도 없으면 `null`. **소비자 조치**: 실행기는 지수의 월말 종가(가격 지수, 배당 제외)를 넘기고 `usCycle`은 미국 지수에서만 `true`로 한다. 결과가 `null`이거나 로드에 실패하면 `{ available: false, reason: 'provider_failed' }`. | `domain/agent/indexHistoryStats.ts` |
| `SWING_MIN_PCT`·`SWING_LOOKBACK_YEARS`·`SWING_EPISODES_LISTED_MAX`·`computeSwingHistory`·`AgeConditional`·`ChangeStats`·`DayStats`·`DeclineBand`·`DeclineEpisode`·`DeclineHistory`·`DeclineSummary`·`ExtraDayStats`·`RallyBand`·`RallyEpisode`·`RallyHistory`·`RallySummary`·`SizeBandBounds`·`SwingBand`·`SwingCurrent`·`SwingHistory`·`SwingHistoryOptions`·`SwingOpenLeg`·`SwingSummary`·`WindowHigh` — `get_swing_history`의 인자 범위(`minSwingPct` 3~50 정수, 기본 10; `lookbackYears` 1~60 정수)와 스윙 통계 순수 함수. **서버 진입점(`index.ts`) 전용**이다 — 도구 실행기만 계산하고 브라우저 번들은 쓰지 않는다. `computeSwingHistory(closes, { minSwingPct, lookbackYears? })`는 일봉 종가(`MarketDailyClose`)를 한 기준의 지그재그로 나눠 완결된 하락 구간(고점·저점·낙폭·고점→저점 달력일·거래일·고점 회복일)과 완결된 상승 구간(저점·고점·상승률·일수), 방향별 요약·크기 구간표·최근 목록(방향별 최신순 최대 20개), 기간 최고 종가(`windowHigh`), 현재 구간(`in_decline`·`in_rally`·`no_confirmed_swing`, 과거 대비 개수)을 낸다. 창 첫 종가는 확정된 스윙점이 아니라서 첫 상승(첫 종가→첫 고점)은 세지 않고, 첫 고점의 하락도 확정 저점에서 시작하지 않아 뺀다. 그래서 하락·상승 개수는 열린 구간만큼 하나 차이 날 수 있다. 가격은 1 이상이면 소수 둘째 자리, 1 미만이면 유효숫자 5자리로 내고, 비율은 원래 종가로 계산한다. `pastLongerThanNow`는 `@deprecated`(더 이상 채우지 않음) — `daysToExtreme` 기준이라 `daysSinceStart` 기준인 `afterThisAge`의 개수와 거의 같은 두 숫자가 한 문장에 섞였다. `afterThisAge`(`unendedAtThisAge`·`extremeAlreadyIn`·`extraDaysToExtreme`)를 쓴다. 열린 구간의 `afterThisAge`는 같은 방향 과거 구간 중 지금 나이(`daysSinceStart`)에 시작은 이미 확정됐고 끝(반전)은 아직이던 구간 수(`unendedAtThisAge`), 그중 이미 극값이 나와 있던 수(`extremeAlreadyIn`), 나머지가 이 나이에서 극값까지 더 걸린 달력일의 중앙값·사분위(최근접 순위, 표본 5개 미만이면 `null`)·최대(`extraDaysToExtreme`)다. 열린 구간도 '시작은 확정, 끝은 아직'인 상태라 과거 구간을 같은 조건으로 고른다 — 과거 분포이지 예측이 아니다. `endsAtClose`는 이 도구 규칙으로 열린 구간을 끝내는 종가(하락은 지금까지 저점의 `minSwingPct` 위로 올림, 상승은 고점의 `minSwingPct` 아래로 내림 — 보이는 가격의 종가가 실제로 구간을 끝낸다)다. 2.39.0 대비 `SwingOpenLeg`에 필수 필드 두 개가 늘고 `pastLongerThanNow`가 선택 필드가 되어 채워지지 않는다 — 유일한 소비자(siglens 실행기)는 결과를 그대로 넘기고 이 필드를 읽거나 타입 리터럴을 만들지 않아 조치가 없다(minor로 낸다). 범위 밖 옵션이나 유효한 종가가 둘 미만이면 `null`. **소비자 조치**: 실행기는 인자가 없으면 `SWING_MIN_PCT.default`를 넘기고, 완결된 일봉 종가(진행 중인 세션 제외, 거래소 현지 날짜, 가격 기준·배당 제외)를 가능한 한 긴 이력으로 넘긴다. 결과에 `asOf`(마지막 완결 종가 날짜)와 `symbol`을 붙인다. 결과가 `null`이면 `{ symbol, found: false }`, 로드 실패는 `{ symbol, available: false, reason: 'provider_failed' }`. | `domain/agent/swingHistory.ts` |
| `tallyEarningsReactions`·`EarningsReactionInput`·`EarningsReactionExtreme`·`EarningsReactionTally` — 지난 실적 반응(`{date, movePct}[]`)을 센다. `tallyEarningsReactions(reactions)`는 `movePct`가 유한한 항목만 `measured`로 세고(`null`·`NaN`은 보합이 아니라 측정 안 됨), 그중 상승(`up`, > 0)·하락(`down`, < 0)·보합(`flat`, = 0) 수, 최대 상승·최대 하락(`largestRise`·`largestFall`, 동률이면 더 늦은 날짜, 없으면 `null`), `|movePct|` 중앙값(`medianAbsMovePct`, 소수 둘째 자리)과 한 줄 영어 `summary`를 돌려준다. 값은 받은 그대로 찍는다(반올림은 호출자 몫). `measured`가 0이면 `summary`와 중앙값은 `null`. **서버 진입점(`index.ts`) 전용** — 도구 실행기만 계산하고 브라우저 번들은 쓰지 않는다(API-1 비대칭). **소비자 조치**: 없음(새 export). | `domain/agent/earningsReactionTally.ts` |
| `readPutCallRatio`·`PutCallBasis`·`PutCallReading`·`PutCallSide` — 풋/콜 비율(콜 1개당 풋)을 쪽으로 읽는다. `readPutCallRatio(ratio, basis)`는 `< 1`이면 `more_calls`, `> 1`이면 `more_puts`, `=== 1`이면 `even`과 한 줄 문장(`'0.58 puts per call by open interest: more call contracts open than put contracts'`)을 돌려준다. 쪽은 **받은 값 그대로**로 정하므로 호출자는 화면에 찍는 값(반올림 뒤)을 넘긴다. `basis`는 `'open_interest'`(옵션 체인)와 `'notional'`(13F 기초자산 명목가치) 중 문구만 고른다. 심리 단어(강세·약세)는 쓰지 않는다 — 풋은 헤지일 때가 많다. `null`·비유한·음수 비율은 `null`. **서버 진입점(`index.ts`) 전용**(API-1 비대칭). **소비자 조치**: 없음(새 export). `summarizeChainForLlm` 출력은 바뀌지 않는다. | `domain/options/putCallReading.ts` |
| `buildLevelLadder`·`LevelCandidate`·`LevelLadder`·`LevelLadderCloser`·`LevelRung`·`LevelSourceKind` — 후보 가격을 기준가의 위·아래로 놓은 사다리. `buildLevelLadder(referencePrice, candidates)`는 후보(`{ price, kind }`, 유한하고 양수인 것만)를 **가격으로만** 나눠 기준가보다 엄격히 큰 것을 `above`(가까운 순), 엄격히 작은 것을 `below`(가까운 순)에 넣는다(쪽당 최대 4개). 분석이 지지선이라 불렀어도 기준가 위면 `above`다. 군집·평균을 하지 않으므로 모든 rung 가격은 출처가 찍은 값이고, 정확히 같은 가격만 `sources`(표시 라벨, 고정 순서)를 합친다. 기준가와 정확히 같은 가격은 `atPrice`에 따로 둔다("근처" 구간 없음). `distancePct`는 (가격 − 기준가) / 기준가 × 100, 소수 둘째 자리. `closer`는 `above[0]`과 `below[0]` 중 찍힌 `|distancePct|`가 작은 쪽(`above`·`below`)이고, 찍힌 값이 같으면 반올림 전 간격으로 가리며 그것까지 같을 때만 `equal`이다(한쪽이 비면 `null`). 반올림하면 0%가 되는 rung은 `summary`에서 쪽을 지켜 `+<0.01%`·`-<0.01%`로 찍고, 기준가와 같은 가격만 `0%`다. 기준가는 호출자가 넘기는 값(마지막 종가 또는 실시간 시세)이다. `summary`는 한 줄 영어. 기준가가 유한한 양수가 아니거나 쓸 후보가 없으면 `null`. `LevelSourceKind`는 `analysis_support`·`analysis_resistance`·`analysis_poc`·`analysis_target`·`analysis_stop`·`high_52w`·`low_52w`·`high_20`·`low_20`·`sma20`·`sma50`·`sma200`; 일(day) 라벨이라 호출자는 차트 출처를 일봉에서만 넘긴다. **서버 진입점(`index.ts`) 전용**(API-1 비대칭). **소비자 조치**: 없음(새 export). | `domain/analysis/levelLadder.ts` |
| `alignNewsWithPriceMoves`·`NewsMoveDay`·`NewsPriceMoves`·`NewsPriceMovesInput` — 뉴스를 완결 세션과 그 기간의 큰 등락일에 엮는다. `alignNewsWithPriceMoves({ closes, publishedAt, session, windowStart })`는 `windowStart` 이후 첫 세션부터의 창에서 종가 대비 등락(`changePct`, 소수 둘째 자리)이 큰 순으로 최대 3일(`moveDays`, 동률이면 더 늦은 날짜)과 그날에 속한 기사 인덱스(최신순 최대 3개, 전체는 `itemCount`), 등락 절대값 중앙값, 기사별 세션(`itemSessions`)을 돌려준다. 기사는 **발행 뒤에 마감하는 첫 세션**에 속한다(장 전·장 마감 후 기사 모두 그 기사가 움직일 수 있는 세션). 마지막 세션 마감 뒤에 발행된 기사는 `null`이고 `afterLastCloseCount`로 센다. 현지 날짜가 `windowStart`보다 이른 기사도 세션이 없는 `null`이고 `beforeWindowCount`로 센다(창 첫 세션의 등락을 설명하는 것으로 읽히지 않게 한다). 파싱할 수 없는 시각은 `null`이지만 두 수 모두에 세지 않는다(늦거나 이른 것이 아니라 모르는 것). 스케줄 세션은 `localSessionParts`로 현지 날짜·분을 읽고 마감은 `closeMinuteFor`(반장 포함)를 쓰되 봉이 있는 날짜에 `0`(휴장)이 오면 스펙의 정규 마감으로 읽는다 — 주말·휴장은 봉 날짜가 곧 달력이라 표가 필요 없다. 상시 개장 세션은 UTC 날짜다. `closes`는 `windowStart` 이전 세션을 하나 이상 포함해야 첫 세션의 등락을 잰다(없으면 그 세션은 등락일 후보에서 빠진다). 창이 2세션 미만이거나 `windowStart`가 날짜가 아니면 `null`. **서버 진입점(`index.ts`) 전용**(API-1 비대칭). **소비자 조치**: 없음(새 export). | `domain/agent/newsPriceMoves.ts` |
| `isIsoDate`·`minusCalendarMonths`·`closeOnOrBefore`·`calendarPeriodChange`·`CalendarPeriodChange` — 기간 시작 날짜 규칙 helper. `isIsoDate(value)`는 `YYYY-MM-DD`이면서 `Date.UTC`로 되돌려도 같은 날짜일 때만 `true`(`2026-02-30` 거부). `minusCalendarMonths(isoDate, months)`는 날짜에서 달력 `months`개월을 빼고 일을 그 달 길이로 맞춘다(03-31 −1개월 = 02-28/29, 윤일 −12개월 = 02-28; 유효한 날짜를 넘겨야 한다). `closeOnOrBefore(closes, date)`는 날짜순 종가에서 `date` 이전(포함) 마지막 종가의 인덱스(없거나 빈 배열이면 `-1`, 이분 탐색). 이것이 **기간의 시작 규칙 하나**다: 창의 기준 종가는 시작일 **이전(포함) 마지막 세션**의 종가라서 주말·휴장 시작일은 그 앞 세션으로 풀린다. `calendarPeriodChange(closes, months)`는 마지막 종가를 (마지막 날짜 − `months`개월) 이전(포함) 마지막 세션 종가와 비교해 `{ baseDate, baseClose, pct }`(`pct`는 숫자, 소수 둘째 자리)를 돌려준다. 시리즈가 거기까지 거슬러 오르지 못하거나 비었거나, `months`가 양의 정수가 아니면 `null`. 입력은 `computePriceStats`와 같은 정리 규칙을 거친다(날짜가 틀렸거나 가격이 유한한 양수가 아닌 행은 빼고, 날짜순으로 정렬하며, 같은 날짜는 첫 행만 쓴다) — 두 함수가 어떤 행을 셀지 서로 다르지 않다. **서버 진입점(`index.ts`) 전용**(API-1 비대칭). **소비자 조치**: 없음(새 export). | `domain/agent/calendarPeriods.ts` |
| `computePriceStats`·`priceStatsEarliestDate`·`AGENT_PRICE_STATS_PERIODS`·`AGENT_PRICE_STATS_DEFAULT_PERIOD`·`AGENT_PRICE_STATS_MAX_SUBJECTS`·`AGENT_PRICE_STATS_MAX_DATES`·`PRICE_STATS_NOTE_TEMPLATES`·`AgentPriceStatsPeriod`·`PriceStatsWindowRequest`·`PriceStatsRequest`·`PriceStatsSubjectInput`·`PriceStatsClose`·`PriceStatsWindow`·`PriceStatsDrawdown`·`PriceStatsDateStatus`·`PriceStatsDateClose`·`PriceStatsSubjectView`·`PriceStatsCorrelationLeg`·`PriceStatsCorrelation`·`PriceStatsResult` — 완결 세션 일봉 종가로 기간 통계를 계산한다. `computePriceStats(subjects, request)`는 대상마다 창(`baseDate`·`baseClose`·`endDate`·`endClose`·`sessions`·`calendarDays`), `returnPct`, 연환산율 `cagrPct`(**1년보다 긴 창에서만**: 달력 일수가 366일을 넘고 이름 붙은 기간 `ytd`·`1m`·`3m`·`6m`·`1y`와 달력 연도가 아닐 때. 그 밖에는 `null` — 기준 세션이 시작일보다 며칠 앞서 일수가 늘어도 `1y`는 연율을 내지 않는다), 기준 이후 세션 중 최고·최저 종가(동률이면 더 이른 날짜; 창이 이력의 첫 종가에서 시작할 때(`max`, 이력보다 앞선 시작일)는 그 기준 종가도 창 안의 종가라서 세고, 창 시작 전의 종가가 기준이면 세지 않는다), `fromHighestClosePct`, 기준 종가부터 센 최대 낙폭 `maxDrawdown`(`recoveredDate`는 창 안에서 낙폭 전 고점 종가 이상이 된 첫 날, 아직이면 `null`; 낙폭이 없거나 반올림하면 0.00%이면 `null`이고 `summary`는 "no fall of 0.01% or more from an earlier close"라 말한다), 요청한 날짜별 종가 `closes`(`exact`·`previous_session`·`before_history`·`after_last_close`·`unusable_price`)와 한 줄 영어 `summary`를 돌려준다. 마지막 종가보다 뒤인 날짜는 `today`보다 앞선 **토·일요일**(주말에 쉬는 시장만)이면서 마지막 종가 날짜와 그 주말 사이에 **평일이 하나도 없을 때**(마지막 종가가 그 주 금요일일 때) `previous_session`(그 이전 마지막 종가)이고, 그 밖에는 모두 `after_last_close`다 — `today` 당일과 그 뒤, 평일과 사이에 평일이 낀 주말(수요일이 마지막 종가인 뒤의 토요일, 성금요일 앞 목요일이 마지막 종가인 뒤의 토요일; 거래소가 아직 종가를 게시하지 않았을 수 있어 "세션이 없었다"로 읽지 않는다), 상시 개장 시장의 모든 날짜. `after_last_close`의 노트는 "데이터에 그 날짜 종가가 아직 없다"와 가장 최근 종가 날짜를 말하고, 세션이 없었다거나 시장에 대한 사실로 "종가가 아직 없다"고 말하지 않는다. 입력 정리에서 빠진 행은 대상별 노트로 알린다 — 잘못된 날짜·가격이면 `rowsUnusable`(날짜를 최대 5개까지 이름으로 싣고 "and N more"), 같은 날짜가 반복돼 첫 행만 남겼으면 `duplicateRowsRemoved`(쓸 수 없는 행이 아니다) — 창의 시작일이나 끝 뒤의 행이 빠졌으면 창이 이웃 세션(날짜를 이름으로 싣는다)에서 시작·끝난다고 `windowStartRowUnusable`·`windowEndRowUnusable`이 말한다(시작 쪽 `windowStartRowUnusable`은 기준 세션 뒤 ~ 시작일(포함) 사이에서 빠진 행이 있어 창이 "이웃한 앞 세션"에서 시작할 때만 나온다. 이력의 첫 행들이 빠져 기준이 시작일보다 뒤로 밀리면 `historyStart`만 나오고, 그 문구는 "이력이 시작한다" 대신 첫 *쓸 수 있는* 행의 날짜와 그 앞에서 빠진 날짜들(최대 5개, 나머지는 "and N more")을 말한다. 날짜 형식이 아닌 문자열은 이 검사에 끼지 않는다). 쓸 수 있는 행이 하나도 없는 대상도 요청 날짜마다 항목을 돌려준다 — 빠진 행의 날짜는 `unusable_price`, 나머지는 행이 있었다고 주장하지 않는 `no_price_data`(입력이 아예 비어 있어도 같다). 요청 날짜의 행이 그래서 빠졌으면 "세션이 없었다"가 아니라 `unusable_price`(그 날짜 가격을 쓸 수 없음)다. 대상이 둘 이상이면 쌍마다 `correlation`(일간: 공유 날짜 사이 단순수익률의 피어슨, 관측 20쌍 미만이면 `null`; 주간: 월요일 시작 주의 마지막 공유 날짜, 12쌍 미만이면 `null`; 상수열도 `null`이며 `NaN`은 없다. 계수가 `null`인 이유는 관측 부족(`correlationTooFew`)과 수익률이 변하지 않음(`correlationFlat`)을 노트가 따로 말한다)을 싣는다. 창은 `period`(`ytd`·`1m`·`3m`·`6m`·`1y`·`3y`·`5y`·`10y`·`max`)·`year`·`range`(`from`, 선택 `to`) 중 하나이고 `none`은 `dates`만 조회한다. **시작 규칙 하나**(`closeOnOrBefore`): 창은 시작일 이전(포함) 마지막 세션 종가에서 시작하고(`ytd`·달력 연도는 전년 마지막 종가), 끝은 끝 날짜 이전(포함) 마지막 종가다. 시작일이 이력보다 앞서면 첫 종가에서 시작하며 `historyStart` 노트("SIGLENS's price history starts on", 상장일이 아니다), 끝이 마지막 종가 뒤면 마지막 종가에서 끝내며 `windowEndsAtLastClose` 노트(진행 중인 달력 연도 포함), 끝이 이력보다 앞서면 `window: null`이다. 종가는 받은 그대로 찍고 파생값만 소수 둘째 자리다. 값은 가격만(분할 보정, 배당 제외)이고, 호출자는 완결 세션만 넘기며(진행 중인 세션은 뺀 뒤 `sessionInProgress: true`), 대상마다 시장 현지 날짜 `today`(거래소 시간대의 오늘 달력 날짜, 암호화폐는 UTC)를 넘긴다 — 시장마다 같은 순간에도 날짜가 달라 요청이 아니라 **대상 입력**이다. `ytd`의 연도는 마지막 종가가 아니라 `today`에서 정해져서, 1월 1일부터 그 해 첫 세션 전까지 `ytd`는 올해 달력 연도(`year`)와 같은 결과(0세션과 `windowEndsAtLastClose`·`noSessionInWindow` 노트)를 낸다. `today`는 마지막 종가 날짜보다 이르면 그 날짜로 올려 읽고, 날짜가 아니면 마지막 종가 날짜로 읽되 `todayIgnored` 노트가 그 사실과 `ytd`가 그 종가의 해를 뜻할 수 있음을 말한다(조용한 대체 없음). 상시 개장(`alwaysOpen`) 종가는 날짜 D의 종가가 그 UTC 날짜의 끝(다음 날 00:00 UTC) 가격이다. 대상 수·날짜 수 상한(`AGENT_PRICE_STATS_MAX_SUBJECTS` 3, `AGENT_PRICE_STATS_MAX_DATES` 5)은 호출자가 거절로 지킨다(계산 함수는 자르지 않는다). 모델이 읽어야 하는 한계는 `notes`에 닫힌 영어 문구 집합(`PRICE_STATS_NOTE_TEMPLATES`: 대상과 날짜를 이름으로 싣는다)으로 실리고, 없으면 키가 없다. `priceStatsEarliestDate(request, lastCloseDate, today)`는 요청이 종가를 이전(포함)으로 찾아야 하는 가장 이른 날짜(`max`면 `null` = 전체 이력; `ytd`의 연도는 `today`에서 정한다)를 돌려줘 호출자가 짧은 캐시 시리즈와 전체 이력 중 고르게 한다. 연도·`calendarDays`는 날짜 성분으로 센다. **서버 진입점(`index.ts`) 전용**(API-1 비대칭). **소비자 조치**: 없음(새 export). 임계값 상수(`PRICE_STATS_MIN_*`·`PRICE_STATS_CAGR_ABOVE_DAYS`)는 API-2에 따라 `@internal`. | `domain/agent/priceStats.ts` |
| `BARS_RESULT_NOTES`·`FUNDAMENTALS_RESULT_NOTES` — `get_bars_indicators`·`get_fundamentals` 결과의 `notes`에 붙이는 닫힌 영어 문구 집합. 두 설명에서 걷어낸 null 처리 절(봉: 일봉 전용 필드·연속 상승/하락(`closeStreakUnavailable`)·50/200 교차·공포탐욕(`fearGreedUnavailable`) null, 재무: 실적 발표 시간대·`sec` null 필드·배당 null 분기와 한국 연 배당·지수 편입·P/E null)을 "이 결과에서" 일어난 일로 다시 쓴 것이며 인용·검색(web_search가 있을 때)·기억 금지·직접 계산 금지 의무를 그대로 지닌다. `BARS_RESULT_NOTES.dailyOnlyFields(timeframe)`만 함수고 나머지는 문자열이다. 문구는 코드가 아는 사실만 말한다(데이터 공백을 시장 사실로 말하지 않는다). **서버 진입점(`index.ts`) 전용**(API-1 비대칭: 결과를 만드는 도구 실행기는 서버에만 있다). **소비자 조치**: `runAgentTurn` 행의 ⑩. | `domain/agent/resultNotes.ts` |
| `AGENT_FILINGS_LIST_MAX`·`AGENT_FILINGS_WINDOW_DAYS`·`AGENT_FILING_TEXT_MAX_CHARS` — `get_company_filings`의 출력 계약 숫자(목록 최대 10건, 최근 120일, 본문 12,000자). 도구 설명이 이 값을 인용하므로 실행기도 같은 상수를 쓴다. **소비자 조치**: `get_company_filings` 실행기를 등록해야 도구가 모델에 노출된다. 실행기는 `accession`이 없거나 빈 문자열이면 8-K·8-K/A·6-K 목록(`filings`: `accession`, `form`, `filedAt`, `items[{code,label}]`, `headline`, `hasPressRelease`, `url`, 최신순)을, 있으면 그 공시의 본문(`filing`: 같은 필드 + `document`, `text`, `truncated`, `totalChars`)을 낸다. `accession`은 대시가 없어도 받는다. 미국에 공시하지 않는 종목은 `{ available: false, reason: 'no_sec_filer' }`, 목록에 없는 접수번호는 `{ error: 'unknown_filing' }`다. 한 턴의 본문 읽기 상한(`AGENT_TURN_CAPS.maxFilingReads`)은 core의 턴 예산이 세어 `{ error: 'quota', scope: 'per_turn' }`로 거절하므로 실행기는 세지 않는다(실패한 읽기도 한 번으로 센다). | `domain/agent/tools.ts` |
| `AGENT_X_POSTS_MAX`·`AGENT_X_POSTS_WINDOW_DAYS`·`AGENT_X_POSTS_PAGE_SIZE`·`AGENT_X_POST_TEXT_MAX_CHARS` — `get_x_posts`의 출력 계약 숫자(최대 12건, 최근 14일, 계정당 한 페이지 10건, 본문 600자). **소비자 조치**: `get_x_posts` 실행기를 등록해야 도구가 모델에 노출된다(X API 키가 없으면 등록하지 않는다 — 과금되는 외부 호출이다). 실행기는 `{ asOf, accounts: [{handle,name,role,followers,loaded,postsInWindow,moreInWindow}], posts: [{handle,role,postedAt,text,truncated,url,likes,reposts}] }`(최신순, 답글·리포스트 제외)를 낸다. `text`는 `AGENT_X_POST_TEXT_MAX_CHARS`자에서 자르고 잘랐으면 `truncated: true`다. `loaded`는 그 계정의 타임라인을 이번에 읽었는지(읽기 실패면 `false`, 그 계정의 글은 `posts`에 없다), `postsInWindow`는 읽은 한 페이지(`AGENT_X_POSTS_PAGE_SIZE`건 요청)에 든 기간 안 원글 수이고, `moreInWindow`는 기간 안에 읽지 않은 더 오래된 항목이 남았는지다(X 응답의 다음 페이지 토큰 유무). X는 읽은 글 수로 과금하므로 실행기는 계정당 한 페이지만 읽고 전체 수를 세지 않는다 — 모델은 이 세 값으로 "못 읽음"과 "기간 안에 글 없음"과 "최근 글만 읽음"을 구분한다. 공식 계정을 모르면 `{ available: false, reason: 'no_known_account' }`, 모든 계정 읽기가 실패하면 `{ available: false, reason: 'provider_failed' }`, 하루 전역 상한을 넘으면 `{ error: 'quota', scope: 'global_day' }`다. **필수 소비자 조치**: (1) 하루 전역 상한은 실행기가 직접 세고 강제한다(core에는 X 전역 한도가 없다 — `AGENT_GLOBAL_LIMITS`는 `web_search`만 다룬다). 상한에 걸리면 로그 마커를 남겨 운영에서 셀 수 있게 한다. (2) 실행기 전체가 `TOOL_TIMEOUT_MS.external`(15초) 안에 끝나야 한다 — 계정을 두 개까지 읽으므로 요청별 타임아웃 합이 이 값을 넘지 않게 잡는다. 턴당 호출 상한(`AGENT_TURN_CAPS.maxXPostCalls`, 3회)은 core의 턴 예산이 세므로 실행기는 세지 않는다. 예산은 실행 전에 차감되므로 계정 없음·실패로 끝난 호출도 1회로 센다. | `domain/agent/tools.ts` |
| `AGENT_CHART_KINDS`·`AGENT_CHART_PERIODS`·`AGENT_COMPARE_SYMBOLS_MIN`·`AGENT_COMPARE_SYMBOLS_MAX` (타입 `AgentChartKind`·`AgentChartPeriod`) — `show_chart` 도구의 인자 계약(그릴 차트 종류 7개, `compare` 기간 `1M`·`3M`·`6M`·`1Y`, 비교 종목 2~5개). **소비자 조치**: `show_chart` 실행기를 등록해야 도구가 모델에 노출된다. 실행기는 데이터를 직접 읽어 표시 전용 블록을 만들고 모델에는 `{ rendered: true, kind, summary }`(그림과 같은 수치)를, 그릴 데이터가 없으면 `{ error: 'no_data', reason }`을 돌려준다. `compare`의 종목 수 범위와 기간 기본값(`6M`)은 스키마가 강제하지 않으므로 실행기가 검사한다. `portfolio`는 로그인 사용자 전용으로 다룬다. kind별 필수 인자(`compare`의 종목 수, `financials` 등의 `symbol`, `heatmap`의 `market`·`theme` 중 하나)는 스키마가 강제하지 않으므로 실행기가 검사하고 어긋나면 오류를 돌려준다. 턴당 호출 상한(`AGENT_TURN_CAPS.maxCharts`, 3회)은 core의 턴 예산이 센다. **서버 entry 전용**이다(`index.client.ts`에 없다): 도구 인자를 다루는 곳은 서버 실행기뿐이다. | `domain/agent/tools.ts` |
| `AGENT_IMAGES_PER_MESSAGE_MAX`·`formatAttachedImagesMarker` — user 메시지 한 건의 첨부 이미지 상한(4장)과 이전 턴 이미지 표식 줄(`[attached images: N]`). `runAgentTurn`은 `RunAgentTurnParams.userImages`를 이번 턴 user 메시지의 `AgentMessage.images`로 싣는다. 형식이 목록 밖이거나 `data`가 빈 이미지는 버리고, 상한을 넘는 이미지도 버린다. 기록 메시지에 남은 `images`는 보내지 않고, 표식 줄이 없으면 붙인다. 이미지 턴도 첫 스텝 도구 호출 강제(`requireToolFirst`) 규칙은 그대로다. **서버 entry 전용**이다(`index.client.ts`에 없다): 이미지 검증과 상한 판정은 서버의 요청 파싱이 하고, 브라우저 UI는 core를 import하지 않는 SiglensAI 클라이언트라 자기 상수를 쓴다. **소비자 조치**: (1) 프로바이더 어댑터가 `AgentMessage.images`를 자기 이미지 파트로 옮긴다. (2) 기록(`history`)에는 이미지를 넣지 않고, 이미지가 있던 user 메시지 끝에 `formatAttachedImagesMarker(n)` 줄을 붙인다 — 시스템 프롬프트가 이 표식을 "지금은 볼 수 없는 이전 이미지"로 설명한다. | `domain/agent/attachedImages.ts` |
| `validateArgs(schema, args)` — 모델이 준 도구 인자를 도구의 JSON Schema 부분집합으로 검증한다. 위반을 모두 모아 `ValidateArgsResult`(`{ ok: true, value }` \| `{ ok: false, issues }`)로 돌려준다. | `domain/agent/validateArgs.ts` |
| `findUngroundedNumbers(answer, toolResults)` — 최종 답변의 숫자 토큰 중 같은 턴의 도구 결과 문자열에서 근거를 찾지 못한 것(중복 제거, 등장 순). 잘린 도구 결과는 판별할 수 없으므로 호출자가 JSON 경계에서 자른다. | `domain/agent/groundedNumbers.ts` |
| `estimateTokens(text)` — 보수적 토큰 추정(ASCII 약 3자/토큰, 비ASCII는 글자당 약 1.2토큰). `selectHistoryWindow` 예산에 쓴다. | `domain/agent/selectHistoryWindow.ts` |
| `AGENT_PROMPT_VERSION` — 에이전트 시스템 프롬프트나 도구 설명 문구가 바뀔 때 올리는 버전 문자열. 턴마다 로그에 남긴다. | `domain/agent/buildAgentSystemPrompt.ts` |
| `AGENT_FOLLOW_UP_MARKER` — 에이전트가 후속 질문을 제안하는 마지막 줄을 여는 마커(`[[followups]]`). 양 entrypoint. | `domain/agent/agentFollowUps.ts` |

**에이전트 추천 질문 프롬프트 — 서버 entry 전용 (2 functions + 3 constants)**
| Symbol | Source |
|---|---|
| `buildSuggestionsPrompt(input)` — 빈 화면의 "추천 질문"용 시스템·유저 프롬프트 쌍(도구 없는 단발 chat completion). 로케일·현재 시각·ET 세션 상태·최근 헤드라인·보유 종목을 받아 `SuggestionsPrompt`를 돌려준다. provider 중립. | `domain/agent/buildSuggestionsPrompt.ts` |
| `parseSuggestions(raw, options?)` — 모델 응답에서 JSON 문자열 배열을 꺼낸다. 산문·코드펜스는 허용하고, 배열이 없으면 `[]`. 대소문자 무시 중복 제거, 개수·글자 수 상한 적용. | `domain/agent/buildSuggestionsPrompt.ts` |
| `SUGGESTIONS_PROMPT_VERSION` — 추천 질문 프롬프트 문구가 바뀔 때 올리는 버전. 소비자가 캐시 키에 접는다. | `domain/agent/buildSuggestionsPrompt.ts` |
| `SUGGESTION_COUNT` / `SUGGESTION_MAX_CHARS` — 추천 질문 개수(6)와 항목당 글자 상한(60, UTF-16 단위). | `domain/agent/buildSuggestionsPrompt.ts` |

### Tier 3 — Infrastructure Factories & Config

**캐시 (1 factory + 1 helper)**
| Symbol | Source |
|---|---|
| `createCacheProvider` | `infrastructure/cache/redis.ts` |
| `computeBarsEffectiveTtl(_timeframe, now, session?)` — 선택적 `session?: MarketSessionSpec` 파라미터(default: `US_EQUITY_SESSION`). `CRYPTO_SESSION` 전달 시 항상 `BARS_OPEN_TTL_SECONDS` 반환(always-open). off-hours fallback은 `session` 스펙의 시간대·주말·`closeMinuteFor` 휴장일을 따라 다음 정규장 개장까지로 자른다. | `infrastructure/cache/config.ts` |
| `analysisHistoryQuery(timeframe)` — Sizes a consumer's own history-table query (`{ limit, sinceMs }`) BEFORE fetching, for `options.priorAnalyses` on `runAnalysis`/`runOverallAnalysis`. `limit` = `PRIOR_ANALYSIS_LIMIT * PRIOR_ANALYSIS_SLACK` (21, both `@internal`); `sinceMs` = calendar days per bar (`TIMEFRAME_LOOKBACK_DAYS / TIMEFRAME_BARS_LIMIT`) scaled to those 21 bars — deliberately NOT a cache-TTL multiple, since bars skip nights/weekends and a TTL-derived window would exclude the prior session's analyses from the consumer's SQL before core ever sees them. Purely a coarse pre-filter: core narrows the result twice more, internally, after the consumer hands it back (`narrowPriorAnalysesForCacheKey` for the cache key, `selectPriorAnalyses` for the bar-anchored prompt) — neither narrowing function is exported. Full signature `analysisHistoryQuery(timeframe, axis = 'technical', now = new Date(), session?: MarketSessionSpec)`. With `session`, a window of a day or more (`1Day` technical, the overall axis) returns `generatedBeforeMs` = the last session boundary (regular close + 30 min; crypto: last 00:00 UTC) — the same boundary core's internal `narrowPriorAnalysesForCacheKey(…, session)` cuts at when `runAnalysis` gets `options.session` / `runOverallAnalysis` gets `technical.session`. Pass the same spec here or the SQL bound and the key cut disagree. Omitted → KST 05:00 anchor. | `infrastructure/cache/config.ts` |

> **@internal (not exported)** (도달 불가 + consumer 미사용, 내부 use-case 전용): `ANALYSIS_CACHE_TTL`, `MARKET_BRIEFING_CACHE_TTL`, `CACHE_EXPIRY_HOUR_KST`, `buildAnalysisCacheKey`, `buildBriefingCacheKey`, `buildOptionsCacheKey`, `computeEffectiveTtl`. 캐시 키/TTL은 `run*`·`peek*` use-case가 내부적으로만 구성한다.

> **@internal (not exported)**: `FUNDAMENTAL_CACHE_TTL_SECONDS`, `NEWS_CACHE_TTL_SECONDS`,
> `OVERALL_CACHE_TTL_SECONDS`, `buildFundamentalCacheKey`,
> `buildNewsCacheKey`, `buildOverallCacheKey` — consumer cannot
> construct the `inputHash` parameter; these are internal to the `run*` use-cases.

**채팅 토큰 저장소 (1 factory + 1 helper)**
| Symbol | Source |
|---|---|
| `createChatTokenStore` | `infrastructure/chat/tokenStore.ts` |
| `hashClientIp` | `infrastructure/chat/tokenStore.ts` |

> **@internal (not exported)** (consumer 미사용, tokenStore 내부 전용): `CHAT_TOKEN_LIMIT`, `CHAT_TOKEN_TTL_SEC`.

**시장 데이터**

> Core exposes no market-data factory. The consumer owns the market data
> adapter entirely and injects it per call: the `provider: MarketDataProvider`
> argument of `fetchBarsWithIndicators`/`getMarketSummary`/`getSectorSignals`,
> or `options.marketDataProvider` on `runAnalysis`/`runOverallAnalysis`. Core
> exposes only the `MarketDataProvider` port interface and `GetBarsOptions`
> (Tier 4). No Tier 3 market factory symbols exist.

**Skills**

> **public 표면 없음** (`@internal`, 도달 불가 + consumer 미사용): `createSkillsProvider`, `FileSkillsLoader` (factory/loader), 그리고 port `SkillsProvider`. 분석 use-case가 내부적으로 `createSkillsProvider()`를 호출하므로 외부 주입 표면이 필요 없다.

**Config readers (2)**
| Symbol | Source |
|---|---|
| `readFmpConfig` | `infrastructure/fmp/config.ts` |
| `tryReadFmpConfig` | `infrastructure/fmp/config.ts` |

**Database (usage helpers only)**
| Symbol | Source |
|---|---|
| `hashUsageIp` | `infrastructure/usage/hash.ts` |
| (참고) `UsageRepository` / `UsageLogRepository` / `UserTierRepository` 인터페이스는 각각 `domain/ports/usageRepository.ts`, `domain/ports/usageLogRepository.ts`, `domain/ports/userTierRepository.ts`에 정의된 도메인 port로, 분석 use-case가 DI로 소비. 공유 도메인 타입(`UsageActionType`, `UsageLogRecord`)은 `domain/types.ts`에서 정의되어 port 간 순환 import를 방지. Drizzle/Neon 어댑터는 siglens consumer가 소유. |

**에이전트 카운터 저장소 (1 factory + 1 error class)**
| Symbol | Source |
|---|---|
| `createCounterStore(options: CounterStoreOptions)` — Upstash-backed `CounterStore` (per-subject, per-period counters keyed by `options.prefix`, UTC buckets). With `failurePolicy: 'closed'`, an outage (no config or a Redis error) makes `consume` throw `CounterStoreUnavailableError`. | `infrastructure/usage/counterStore.ts` |
| `CounterStoreUnavailableError` — thrown by fail-closed stores when the backing store is unreachable, so callers answer `server_busy` rather than a quota refusal. | `domain/ports/counterStore.ts` |

**쿨다운 (3)**
| Symbol | Source |
|---|---|
| `tryAcquireReanalyzeCooldown` | `infrastructure/market/reanalyzeCooldown.ts` |
| `releaseReanalyzeCooldown` | `infrastructure/market/reanalyzeCooldown.ts` |
| `getReanalyzeCooldownMs` | `infrastructure/market/reanalyzeCooldown.ts` |

### Tier 4 — Types & Constants

**도메인 타입** (대시보드/지표/신호/분석/캔들/추세선/티어 설정 타입 일체 + 펀더멘털/뉴스/종합 분석 타입) — `domain/types.ts`에서 일괄 export.

그 밖의 도메인 타입:
- 무료 티어 정보-깊이 게이팅: `FilteredAnalysisResponse`(`AnalysisResponse`의 정보-깊이 마스킹 변형; 허용되지 않은 필드는 `null`로 대체, `domain/types.ts`), `FilteredAnalysisResult`(`{ result: FilteredAnalysisResponse; lockedInfoDepth: readonly TierInfoDepth[] }`, `filterAnalysisResult`의 반환 타입). `runAnalysis`의 `RunAnalysisResult`(`cached`/`done` variant의 `result: AnalysisResponse | FilteredAnalysisResponse`)와 `peekAnalysisCache`의 반환 타입(`FilteredAnalysisResult | null`)으로 도달 가능하다.
- `CurrentAnalysisContext` — 챗봇 시스템 프롬프트에 주입되는 현재 분석 컨텍스트 tagged union.
- 펀더멘털: `FundamentalAnalysisResponse`, `FundamentalCategoryAssessment`, `FundamentalCategory`, `FundamentalSentiment`, `FundamentalProfile`, `GradesEvent`, `GradesAction`. (정규화 입력 타입 `FundamentalSnapshot`과 그 하위 `FundamentalValuation`/`FundamentalPeer`/`FundamentalProfitability`/`FundamentalGrowth`/`FundamentalHealth`/`FundamentalFutureDirection`/`FundamentalSectorDirection`/`SectorHistoricalPoint`/`GradesConsensus`/`PriceTargetConsensus`/`PriceTargetSummary`는 public 타입에서 도달 불가하고 consumer 미사용이라 `@internal`. public 응답 타입 `FundamentalAnalysisResponse`는 유지.)
- 뉴스: `NewsAnalysisResponse`, `NewsCardAnalysis`, `NewsCategory`, `NewsFeedCategory`, `NewsItem`, `NewsSentiment`, `EnrichedNewsItem`, `EarningsCalendarItem`, `EarningsReport`.
- 종합: `OverallAnalysisResponse`, `OverallScenario`, `OverallScenarioName`.
- 패턴 목표 기하: `PatternTargetGeometry` (`{ breakoutLevel, extremeLevel, direction, invalidationLevel? }` — `PatternSummary.geometry`, 모델이 식별한 패턴 기하; 측정·보수 목표가는 core가 이 값으로 계산), `PatternBreakoutDirection` (`'up'` \| `'down'`).
- 차트 패턴 프리스크리너: `ChartPatternId` (`skills/patterns/*.md` 파일명과 1:1인 스크리너 식별 차트 패턴 ID union), `PatternCandidate` (`{ id, startIndex, endIndex, pivots? }` — 프리스크리너가 방출하는 coarse recall-biased 후보 매치; `pivots`는 분류기가 실제로 매칭한 피벗 — 후보 기하 계산의 입력), `PivotPoint` (`{ index, price, kind }`), `PivotKind` (`'high'` \| `'low'`). `domain/types.ts`에 정의. siglens 쪽 validator가 `ChartPatternId`에 대해 `satisfies` 타입 검증을 강화하기 위해 의도적으로 공개.
- 포지션 버킷: `PositionBucket` (`'deep-profit' | 'profit' | 'near-breakeven' | 'loss' | 'deep-loss'` — 회원 보유종목의 미실현 손익 구간을 나타내는 5단계 union, `bucketizePosition`의 반환 타입이자 `peekAnalysisCache`의 `positionBucket` 인자·`SubmitAnalysisOptions.positionBucket`(`runAnalysis`)로 캐시 키에 들어가는 입력). `domain/types.ts`에 정의.
- Prior-analysis context: `PriorAnalysis` (`{ generatedAt: Date; trend: Trend; riskLevel: RiskLevel; entryPrices?: readonly number[]; stopLoss?: number; takeProfitPrices?: readonly number[] }` — the flat, language-neutral projection of a past analysis the consumer reads out of its own database and passes back in via `options.priorAnalyses`). `domain/types.ts`에 정의 (다른 공유 도메인 타입과 동일). 관련 narrowing/rendering 함수(`selectPriorAnalyses`, `formatPriorAnalysisSection`, `narrowPriorAnalysesForCacheKey`, `barTimeMs`, `findAnchorBarIndex`)는 전부 `@internal` — consumer는 `PriorAnalysis[]`를 만들어 넘기고 `analysisHistoryQuery`로 자기 쿼리 크기만 잡으면 된다.
- 차트 오버레이: `ChartOverlay`(모델이 참조한 후보를 렌더 가능한 형태로 해석한 결과 — `AnalysisResponse`/`FilteredAnalysisResponse.chartOverlays`의 원소 타입), `OverlayKind`(`'pattern'|'trendline'|'divergence'|'fibonacci'|'elliott'`), `StrategyOverlayKind`(`'divergence'|'fibonacci'|'elliott'` — 전략 카드가 그릴 수 있는 종류, `Skill.overlayKind`의 타입), `OverlayPane`(`'price'|'rsi'`), `OverlayPoint`(`{ time, price }`), `OverlaySegment`, `OverlayLevel`, `OverlayLabel`, `OverlayLineStyle`(`'solid'|'dashed'`), `OverlayLabelPosition`(`'above'|'below'`), `OverlayVariant`(`'primary'|'alternate'`). 전부 `domain/types.ts`, 양 entrypoint. `PatternSummary.candidateId`/`StrategyResult.candidateIds`가 이 후보들을 id로 참조한다.
- SMA 교차 이력 (`src/index.ts`만 `export type`): `MaCross` (`{ time, kind: 'golden' | 'dead', fast, slow }`), `MaCrossScan` (`{ crosses, evaluatedBars, complete }` — `findMaCrosses`의 반환 타입, `domain/indicators/maCrosses.ts`).
- RSI 구간 (양 entrypoint `export type`): `RsiZone` (`'overbought' | 'neutral' | 'oversold'` — `rsiZone`의 반환 타입, `domain/indicators/rsiZone.ts`).
- 오실레이터 구간 (양 entrypoint `export type`): `OscillatorZone` (`RsiZone`과 같은 세 값), `OscillatorKey` (`'rsi' | 'stochastic' | 'williamsR' | 'cci' | 'mfi'`), `OscillatorReadings` (`{ rsi, stochasticK, williamsR, cci, mfi }`, 각 `number | null`), `OscillatorZonesView` (`{ zones, summary }` — `classifyOscillatorZones`의 반환 타입, `domain/indicators/oscillatorZones.ts`).
- 분석 결과 라벨러 타입 (양 entrypoint `export type`, 함수·버전 상수는 `src/index.ts`만): `OutcomeSubject`·`OutcomeLevelRole`(저장하는 분석 사본), `OutcomeWindow`·`OutcomeBarTuple`·`OutcomeAnchor`·`OutcomeAnchorSource`(`'prompt_bar' | 'generated_at'`)·`OutcomeWindowResult`(봉 창과 앵커·결과 variant 4종), `AnalysisOutcomeLabels`(`labelAnalysisOutcome` 반환), `ForwardReturnLabel`, `PlanOutcomeLabel`(+`PlanOutcome` `'no_plan' | 'not_triggered' | 'void_at_entry' | 'target_first' | 'stop_first' | 'ambiguous' | 'open_at_horizon'`, `PlanReason`, `PlanApproach`), `LevelSide`(`'support' | 'resistance'`, `labelLevelOutcome`의 `level.side`)·`LevelOutcomeLabel`·`LevelOutcomeEntry`(+`LevelOutcome` `'skipped' | 'untouched' | 'broken' | 'respected' | 'inconclusive' | 'touched_late'`, `LevelSkipReason`, `LevelPlaceboLabel`), `ScenarioTargetLabel`, `PatternOutcomeLabel`(+`PatternOutcome`; 기준가가 이미 목표가 이상이면 `skipped`/`target_reached`, 돌파 봉 종가가 목표가 이상이면 `skipped`/`target_reached_on_breakout`(서로 다른 모집단이라 따로 센다)) — `domain/outcomes/types.ts`. 라벨 상수(창·수평선·장벽 등)는 API-2에 따라 `@internal`.
- 오버레이 레벨 라벨 상수: `OVERLAY_LEVEL_LABELS` (`{ breakout: 'breakout', invalidation: 'invalidation', target: 'target', wave5Cap: 'wave5_cap' }` as const — core가 `OverlayLevel.label`에 쓰는 언어 중립 키. 비율이 붙은 목표는 `target 161.8%` 꼴(A–B–C의 C 투영)이고, 피보나치 사다리 라벨(`61.8%`·`ext 127.2%`·`ABC 161.8%`)은 여기 없다. consumer는 이 값으로 화면 문구를 고른다). `domain/overlays/constants.ts`에 정의, 양 entrypoint export.
- 전략 오버레이 종류 출처 상수: `STRATEGY_KIND_SOURCE_REF` (`Readonly<Record<StrategyOverlayKind, string>>` — `{ divergence: 'kind:divergence', fibonacci: 'kind:fibonacci', elliott: 'kind:elliott' }`. 어느 카드도 소유하지 않는 전략 종류 작도의 `ChartOverlay.sourceRef` — consumer는 종류 이름으로 표시). `domain/overlays/constants.ts`에 정의, 양 entrypoint export.
- 전략 오버레이 종류 상수: `STRATEGY_OVERLAY_KINDS` (`readonly StrategyOverlayKind[]` — `StrategyOverlayKind` 유니온의 런타임 값. 스킬 frontmatter를 직접 파싱하는 consumer(siglens 로더·검증 스크립트)가 목록 사본 대신 쓰는 단일 소스). `domain/overlays/constants.ts`에 정의, 양 entrypoint export.
- KRX 호가 표 선택: `KrxTickTable` (`'share' \| 'etp'` — 주식 / ETF·ETN. `krxTickSize`·`roundToKrxTick`·`buildAnalysisPrompt`·`SubmitAnalysisOptions.krxTickTable`·`RequestChatCompletionParams.krxTickTable`이 받는다). `domain/analysis/krxTick.ts`에 정의, 양 entrypoint export.
- Prompt-capture hook: `AssembledPromptRecord` (`{ readonly system: string; readonly stable: string; readonly dynamic: string; readonly promptVersion: string }` — a verbatim copy of the prompt actually sent to the model for one fresh generation). `domain/types.ts`에 정의. `SubmitAnalysisOptions.onPromptAssembled` (`application/market/types.ts`)와 `OverallDependencyInputs.onPromptAssembled` (`application/overall/types.ts`)로 두 축 모두에서 옵션으로 받는다 — 콜백은 프롬프트 조립 직후·provider 호출 직전에, 캐시 미스일 때만, **실제 생성 1회당 한 번** 호출된다(in-flight dedup 팩토리 **안**에서 발화하므로 같은 캐시 키 동시 호출이 N건이어도 1회다 — 밖에서 부르면 진 호출자에게 전송된 적 없는 프롬프트가 전달된다). 반환 타입은 `void | Promise<void>`이고, **동기 throw와 비동기 rejection 양쪽 모두** core가 잡아 로그만 남기고 삼킨다(consumer의 영속화 실패가 분석 자체를 실패시키면 안 됨). 생략 시 프롬프트/캐시 키/결과 바이트 완전 동일.
- Fear & Greed Index (per-stock):
    - `FearGreedLabel`, `FearGreedConfidence`, `FearGreedWarning`
    - `FearGreedFactorKey`, `FearGreedGroupName`
    - `FearGreedFactor`, `FearGreedGroup`
    - `FearGreedSnapshot`, `FearGreedHistoryPoint` (`FearGreedSnapshot.ma200DistancePct`는 의도적 TS-3 예외로 optional — 외부 소비자 픽스처·옛 페이로드 호환; `computeFearGreedIndex`는 항상 채운다)
    - `ComputeFearGreedOptions`
    - `FearGreedInputs` (`fearGreedInputs` 반환 타입)
    - `FearGreedReading`, `FearGreedLabelTransition`, `FearGreedScoreGap` (`FearGreedHistoryPoint`와 `MarketFearGreedHistoryPoint`는 `FearGreedReading`의 타입 별칭이다)
    - `ExtremeFearGreedZone`, `ForwardChangeStat`, `ExtremeZoneOutcome`, `ExtremeZoneOutcomeOptions` (과거 사후 집계, 예측 아님)
    - `ExtremeZoneEpisode`, `ExtremeZoneEpisodeSummary`, `ExtremeZoneEpisodeOptions` (극단 구간 머문 기록)
- Fear & Greed Index (market-wide):
    - `MarketFearGreedSeriesKey`, `MarketFearGreedFactorKey`
    - `MarketDailyClose`, `MarketFearGreedInput`
    - `MarketFearGreedFactor`, `MarketFearGreedSnapshot`, `MarketFearGreedHistoryPoint`
- Fear & Greed Index (crypto market):
    - `CryptoDailyBar`, `CryptoFearGreedInput`
    - `CryptoFearGreedFactorKey`, `CryptoFearGreedFactor`, `CryptoFearGreedSnapshot`
    - History points reuse `FearGreedHistoryPoint` (the generic per-stock point type — structurally identical to `MarketFearGreedHistoryPoint`); `safeHaven` reuses `MarketDailyClose`.
- 마켓 레퍼런스 (`computeMarketReference`의 반환/요소 타입, `domain/types.ts`):
    - `MarketReferenceClock` (`{ session: MarketSessionSpec; now: Date }` — `computeMarketReference`의 `options.clock` 파라미터 타입, `domain/analysis/marketReference.ts`에서 export).
    - `MarketReference` (`{ short, medium, long }` — 각 `HorizonReference`), `HorizonReference` (`{ window, levels, structure }`), `HorizonWindow` (`bars`/`fromTime`/`toTime` — 호라이즌 lookback 윈도우), `HorizonKey` (`'short'` | `'medium'` | `'long'`).
    - `ReferenceLevels` (`{ support, resistance }` — 현재가 기준 side 분리, nearest-first), `ReferenceLevel` (price/label/kind/distancePercent), `ReferenceLevelKind` (레벨 출처 union — fib/VP/swing/MA/EMA/round/pivot/ichimoku/donchian/bollinger/keltner/supertrend/vwap/avwap; 컨빅션 랭크가 아닌 서술 라벨). `'avwap'`는 호라이즌 윈도우의 극단 스윙(최고가 스윙 고/최저가 스윙 저)에 앵커링한 Anchored VWAP 레벨. 앵커 계산 헬퍼 `anchoredVwap`는 `@internal`로 **public 미노출**.
    - `TrendStructure` (priceVsMA60/priceVsMA200/emaStack/swingStructure/adx/efficiencyRatio/regime — 서술적 추세 구조, 방향 예측 아님), `PriceVsLevel` (`'above'` | `'below'` | `'unknown'`), `EmaStackState` (`'aligned_up'` | `'aligned_down'` | `'mixed'`), `MaStackDirection` (`'bullish'` | `'bearish'` | `'mixed'` — `classifyMaStack` 반환 타입), `SwingStructureState` (`'HH_HL'` | `'LH_LL'` | `'mixed'`), `MarketRegime` (`'trending'` | `'ranging'`).
- 피봇/피보나치 레벨: `HorizonReference.fibProjection?`/`.abcExtension?`와 `MarketReference.pivots?: PivotTables`를 통해 아래 타입들이 `computeMarketReference` 반환 closure에서 도달 가능하다 — public:
    - `PivotTables` (`{ standard, camarilla, fibonacci, woodie, demark }` — 공유 pivot bar의 완전한 피봇 세트, 프롬프트의 `Pivot table:` 한 줄로 렌더). `StandardPivotLevels`, `CamarillaPivotLevels`, `FibonacciPivotLevels`, `WoodiePivotLevels`, `DeMarkPivotLevels` — 각 패밀리의 pp/r*/s* 필드.
    - `FibonacciProjection` (`{ high, low, direction, retracements, extensions }`), `FibonacciLevel` (`{ ratio, price }`), `SwingLegDirection` (`'up'` \| `'down'`), `AbcExtensionProjection` (`{ a, b, c, direction, extensions }`).
    - `index.client.ts`도 같은 집합을 노출한다 — `PivotTables`와 그 필드 타입(`StandardPivotLevels`/`CamarillaPivotLevels`/`FibonacciPivotLevels`/`WoodiePivotLevels`/`DeMarkPivotLevels`), `FibonacciProjection`/`FibonacciLevel`/`AbcExtensionProjection`/`SwingLegDirection`, 그리고 `PatternResult.geometry`의 `PatternTargetGeometry`/`PatternBreakoutDirection` (두 엔트리포인트의 공개 범위 일치).
- 스킬 게이팅 (`Skill.gating`의 transitive closure, `domain/types.ts`):
    - `SkillGating` — 스킬을 차트 프롬프트에 주입할지 제어하는 frontmatter 게이팅 메타데이터. `tier`(그 다음 gated 암에서 `signalKind`)로 분기하는 discriminated union (`{ tier: 'always_on' }` | `{ tier: 'gated'; signalKind: 'event'; triggers }` | `{ tier: 'gated'; signalKind: 'state'; state }`). `signalKind`는 인라인 리터럴(`'event'`/`'state'`)이라 `SignalKind` 타입을 참조하지 않는다.
    - `SkillStatePredicate` (`{ feature, predicate, hi?, lo? }` — textbook *state* 게이팅 술어), `SkillStateFeature` (`SkillStatePredicate.feature` union — 검사 대상 지표 피처: `bollinger`/`keltner`/`williamsR`/`stochastic`/`stochRsi`/`donchian`/`vwap`/`buySellVolume`), `SkillStatePredicateKind` (`SkillStatePredicate.predicate` union — 비교 방식: `pctB`/`bandDistAtr`/`level`/`ratio`/`channelProximity`).
    - `SignalKind` (`'event'` | `'state'`)는 **public 미노출** — `SkillGating`이 인라인 `signalKind` 리터럴로 discriminate하므로 public transitive closure에서 도달 불가. 로더의 frontmatter 검증(`SIGNAL_KINDS`)에서만 참조되어 `@internal` 태그로 `domain/types.ts`에 유지한다.

Provider 인터페이스:
- `FundamentalDataProvider` — `domain/ports/fundamentalDataProvider.ts`. Core가 의존하는 추상 펀더멘털 데이터 fetcher 인터페이스 (siglens가 FMP로 구현).
- `NewsProvider` — `domain/ports/newsProvider.ts`. 뉴스 + 실적 캘린더 fetcher 인터페이스. `@internal` — public에서 도달 불가, consumer 미사용.
- `NewsTimeRange` — `domain/ports/newsProvider.ts`. 뉴스 조회 기간 union (`'24h'` | `'7d'` | `'30d'`). **public** — consumer가 자체 뉴스 fetch 어댑터의 `range` 인자를 이 union으로 타이핑한다. 부모 port `NewsProvider`는 consumer가 이름으로 import하지 않으므로 `@internal` 유지.
- `OptionsDataProvider` — `domain/ports/optionsDataProvider.ts`. 옵션 시세 fetcher 추상화 인터페이스 (siglens가 Yahoo Finance로 구현). `fetchSnapshot`, `hasOptionsMarket` 두 메서드.
- `FinancialStatementsProvider` — `domain/ports/financialStatementsProvider.ts`. Core가 의존하는 추상 재무제표 fetcher 인터페이스 (siglens가 FMP로 구현). `runFinancialsAnalysis`에 `options.dataProvider`로 주입한다.
- `InvestorFlowsDataProvider` — `domain/ports/investorFlowsDataProvider.ts`. 수급 스냅샷 fetcher 인터페이스 (`getInvestorFlowsSnapshot(symbol) → InvestorFlowsSnapshot | null`; siglens가 SEC 13F 집계·옵션 포지션·FMP Form 4/13D-G·SEC Form 144/증자 공시/FTD·거래소 Reg SHO 목록·FINRA, 한국은 DART로 구현). FINRA 플래그가 꺼지면 `shortInterest`/`shortVolume`을, 거래소 목록 플래그가 꺼지면 `thresholdList`를 `null`로 돌려준다. 한국 종목은 `market: 'kr'`과 `kr` 블록을 채운다. `runInvestorFlowsAnalysis`에 주입한다.
- `CongressTradesProvider` — `domain/ports/congressTradesProvider.ts`. Core가 의존하는 추상 의회 거래 데이터 fetcher 인터페이스 (siglens가 FMP로 구현). `runCongressTrend`에 `options.dataProvider`로 주입한다.

use-case option/result 타입 (모두 `src/index.ts`에서 export. `src/index.client.ts`에도 있는 것은 따로 적는다):
- 이름 규칙: `run*` use-case의 옵션 타입은 `Submit*Options` 이름을 쓰고(예: `runNewsAnalysis(options: SubmitNewsAnalysisOptions)`), 반환 타입은 `Run*Result`다. `Run*Result`의 variant 일부는 `Submit*Cached`·`Submit*MissNoTrigger`처럼 `Submit*` 이름의 타입이다.
- 아래에서 "(공개 함수 미사용)"으로 묶은 `Submit*Result`·`*Submitted`·`Poll*` 타입은 `submitted`/`processing` variant나 poll-time 옵션을 담은 타입이다. export는 유지되지만 이를 반환하거나 인자로 받는 공개 함수는 없다.
- 기술적: `SubmitAnalysisOptions`(`runAnalysis` 옵션), `RunAnalysisResult`, `SubmitAnalysisMissNoTrigger`(봇/크롤러 게이팅용 `miss_no_trigger` variant), `SubmitAnalysisErrorResult`, `TierGateErrorResult`, `TierTimeframeAccessError`, `UserApiKeyRequiredError`(`key_error` variant), `AnalysisUsageOptions`. 브리핑: `RunBriefingResult`. (공개 함수 미사용: `SubmitAnalysisGatedResult`, `PollAnalysisOptions`, `PollAnalysisResult`, `SubmitBriefingResult`, `PollBriefingResult`.) `index.client.ts`에는 이 중 `SubmitAnalysisMissNoTrigger`, `UserApiKeyRequiredError`, `SubmitAnalysisGatedResult`, `PollAnalysisOptions`, `PollAnalysisResult`, `SubmitBriefingResult`, `PollBriefingResult`가 있다.
- 펀더멘털: `SubmitFundamentalAnalysisOptions`(`runFundamentalAnalysis` 옵션), `RunFundamentalAnalysisResult`(variants `SubmitFundamentalAnalysisCached`, `SubmitFundamentalAnalysisMissNoTrigger`, `SubmitFundamentalAnalysisLimitError`, `SubmitFundamentalAnalysisFetchError`, `SubmitFundamentalAnalysisApiKeyRequiredError` + `done`). (공개 함수 미사용: `SubmitFundamentalAnalysisResult`, `SubmitFundamentalAnalysisSubmitted`, `PollFundamentalAnalysisResult`.)
- 뉴스: `SubmitNewsAnalysisOptions`(`runNewsAnalysis` 옵션), `RunNewsAnalysisResult`(variants `SubmitNewsAnalysisCached`, `SubmitNewsAnalysisMissNoTrigger`, `SubmitNewsAnalysisNoNewsError`, `SubmitNewsAnalysisLimitError`, `SubmitNewsAnalysisApiKeyRequiredError` + `done`), `SubmitNewsCardAnalysisOptions`(`runNewsCardAnalysis` 옵션), `RunNewsCardAnalysisResult`. (공개 함수 미사용: `SubmitNewsAnalysisResult`, `SubmitNewsAnalysisSubmitted`, `PollNewsAnalysisResult`, `SubmitNewsCardAnalysisResult`, `SubmitNewsCardAnalysisSubmitted`, `PollNewsCardAnalysisResult`.)
- 뉴스 카테고리 다이제스트: `SubmitMarketNewsDigestOptions`(`runMarketNewsDigest` 옵션), `MarketNewsDigestCacheKeyOptions`(`peekMarketNewsDigestCache` 옵션), `RunMarketNewsDigestResult`(variants `SubmitMarketNewsDigestCached`, `SubmitMarketNewsDigestMissNoTrigger`, `SubmitMarketNewsDigestNoNewsError` + `done`). (공개 함수 미사용: `SubmitMarketNewsDigestResult`, `SubmitMarketNewsDigestSubmitted`, `PollMarketNewsDigestResult`, `PollMarketNewsDigestProcessing`, `PollMarketNewsDigestDone`, `PollMarketNewsDigestError`.)
- 종합: `OverallDependencyInputs`, `SubmitOverallAnalysisOptions`(`OverallDependencyInputs`를 extends. `runOverallAnalysis`는 여기에 `signal?`·`providerFallback?`·`keyPolicy?`를 더한 옵션을 받는다), `OverallAxis`, `RunOverallAnalysisResult`(variants `SubmitOverallAnalysisCached`, `SubmitOverallAnalysisMissNoTrigger`, `SubmitOverallAnalysisError`, `SubmitOverallAnalysisLimitError`, `SubmitOverallAnalysisApiKeyRequiredError` + `done`). (공개 함수 미사용: `SubmitOverallAnalysisResult`, `SubmitOverallAnalysisSubmitted`, `SubmitOverallAnalysisPendingDependencies`, `PollOverallAnalysisResult`, `PollOverallAnalysisOptions`.) `index.client.ts`에는 이 중 `PollOverallAnalysisOptions`만 있다.
- 옵션: `SubmitOptionsAnalysisOptions`(`runOptionsAnalysis` 옵션), `RunOptionsAnalysisResult`(variants `SubmitOptionsAnalysisCached`, `SubmitOptionsAnalysisMissNoTrigger`, `SubmitOptionsAnalysisNoChainsError`, `SubmitOptionsAnalysisLimitError`, `SubmitOptionsAnalysisApiKeyRequiredError` + `done`). (공개 함수 미사용: `SubmitOptionsAnalysisResult`.) 도메인 타입(`OptionsContract`, `OptionsChain`, `OptionsSnapshot`, `StrikeOpenInterest`, `LlmStrikeOpenInterest`(`StrikeOpenInterest` + `distancePct`/`side`, `OptionsExpirationMetrics.topOpenInterestStrikes`의 원소 타입), `StrikeVolumeAggregate`, `TopOiQuote`, `OptionsExpirationMetrics`, `ImpliedMoveRange`(`{ low, high }` — `OptionsExpirationMetrics.impliedMoveRange`의 named 타입), `OptionsPerExpirationCommentary`, `OptionsSignal`, `OptionsAnalysisResponse`, `OptionsTone`, `OptionsSignalKind`, `OptionsExpirationFilter`)과 슬롯 매핑(`ExpirationSlot`, `ExpirationSlotKey`, `SlotMapping`), 프롬프트 옵션(`BuildOptionsAnalysisPromptOptions`) 포함.
- 재무: `SubmitFinancialsAnalysisOptions`(`runFinancialsAnalysis` 옵션), `RunFinancialsAnalysisResult`(variants `SubmitFinancialsAnalysisCached`, `SubmitFinancialsAnalysisMissNoTrigger`, `SubmitFinancialsAnalysisLimitError`, `SubmitFinancialsAnalysisFetchError`, `SubmitFinancialsAnalysisApiKeyRequiredError` + `done`). (공개 함수 미사용: `SubmitFinancialsAnalysisResult`, `SubmitFinancialsAnalysisSubmitted`, `PollFinancialsAnalysisResult`.) 도메인 타입(`FinancialsAnalysisResponse`, `FinancialsAxisAssessment`, `FinancialsAxis`, `FinancialsSentiment`, `FinancialsScorecard`, `FinancialsCompositeScore`, `AxisScore`, `FinancialSignalType`, `FinancialSignal`, `FinancialSignalDirection`, `ScoreMetric`, `ScoreMetricUnit`, `FinancialsGrade`, `FinancialsSnapshot`, `IncomeStatementRow`, `BalanceSheetRow`, `CashFlowRow`, `IncomeGrowthRow`, `FinancialGrowthRow`, `CashFlowGrowthRow`, `NormalizeFinancialsSnapshotInput`, `StatementPeriod`) 포함. `FinancialSignalType` — `computeFinancialsScorecard`가 방출하는 시그널 타입 literal union. `FinancialSignalDirection`(`'positive'|'negative'|'neutral'`)·`ScoreMetricUnit`(`'pct'|'ratio'|'usd'|'score'`)는 named/export type; `FinancialsCompositeScore`는 `FinancialsScorecard.composite`의 named 타입.
- 의회 거래 동향: `SubmitCongressTrendOptions`(`runCongressTrend` 옵션), `RunCongressTrendResult`(variants `SubmitCongressTrendCached`, `SubmitCongressTrendMissNoTrigger`, `SubmitCongressTrendNoTrades`, `SubmitCongressTrendFetchError` + `done`) — `application/congress/types.ts`. (공개 함수 미사용: `SubmitCongressTrendResult`, `SubmitCongressTrendSubmitted`, `PollCongressTrendResult`.) 도메인 타입(`Chamber`, `CongressTradeSide`, `CongressOwner`, `CongressSentiment`, `CongressTrendDirection`, `CongressAmountRange`, `CongressTrade`, `RawCongressTrade`, `CongressTradeStats`, `CongressTrendResponse`) 및 Provider 인터페이스(`CongressTradesProvider`) 포함. Congress 데이터는 공개 정보이므로 usage limit 게이팅 없음 — `SubmitCongressTrendOptions`에 `usage` 필드 없음. `userApiKey?: string` 필드는 있고 `callAnalysisAi`로 그대로 전달된다 — 회원이 congress 분석에도 자신의 프로바이더 키로 프리미엄 모델을 쓸 수 있다. 결과로 돌려주는 BYOK 게이트(`key_error` variant)는 없다. 사용자 키가 필요한 호출에 키가 없으면 `callAnalysisAi`의 `UserApiKeyMissingError`가 throw된다.
- 수급(investor flows): `RunInvestorFlowsAnalysisOptions`, `RunInvestorFlowsAnalysisResult`(`RunInvestorFlowsAnalysisCached`/`Done`/`MissNoTrigger`/`NoData`/`FetchError` 5 variants) — `application/investorFlows/types.ts`. 도메인 타입 `InvestorFlowsSnapshot`(+`InstitutionalSnapshot`/`InstitutionalQuarter`/`InstitutionalHolderChange`/`InsiderSnapshot`/`InsiderTransaction`/`InsiderStatistics`/`LargeHolderFiling`/`ShortInterestPoint`/`ShortVolumePoint`/`InstitutionalOptionsQuarter`/`FailsToDeliverPoint`/`ProposedSale`/`OfferingFiling`/`OfferingKind`/`ThresholdListStatus`/`InvestorFlowsMarket`/`KrDisclosureSnapshot`/`KrMajorHolderReport`/`KrMajorHolderReportForm`/`KrInsiderReport`/`KrTradingPlan`), 숏스퀴즈 `SqueezeRiskScore`/`SqueezeRiskComponent`/`SqueezeRiskComponentId`/`SqueezeRiskLevel`/`SqueezeRiskSufficiency`/`SqueezeRiskContext`/`SqueezeRiskBar`/`EvaluateSqueezeRiskOptions`, `InvestorFlowsScorecard`(+5개 축 `InstitutionalAxis`/`InsiderAxis`/`LargeHolderAxis`/`ShortAxis`/`DilutionAxis`, KR 지표 `KrMajorHolderMetrics`/`KrInsiderMetrics`, `DilutionMetrics`, `InvestorFlowsAxisBase`, 축별 metrics, `InvestorFlowsComposite`, `InvestorFlowsFreshness`, `InvestorFlowsWindow`, 신호 타입), `EvaluateInvestorFlowsOptions`, `InvestorFlowsAnalysisResponse`/`InvestorFlowsAxisInterpretation`와 상수 `INVESTOR_FLOWS_AXES` — `domain/investorFlows/types.ts`(`domain/types.ts`가 재노출). `index.client.ts`에는 순수 함수(`evaluateInvestorFlows`·`evaluateSqueezeRisk`·normalize)·타입·`INVESTOR_FLOWS_AXES`만 노출하고 `runInvestorFlowsAnalysis`는 서버 전용이다. 프롬프트·스키마·캐시 키·템플릿 버전은 API-2에 따라 `@internal`.
- 거시경제(economy): 결과 타입 `RunMacroBriefingResult`(`runMacroBriefing`)와 `MacroBriefingCacheEntry`(`peekMacroBriefingCacheEntry` 반환)는 `application/economy/types.ts`에 정의되며 `index.ts` 전용이다. (공개 함수 미사용, `index.ts`/`index.client.ts` 양쪽: `SubmitMacroBriefingResult`, `SubmitMacroBriefingCached`, `SubmitMacroBriefingSubmitted`, `PollMacroBriefingResult`, `PollMacroBriefingProcessing`, `PollMacroBriefingError`, `PollMacroBriefingDone`.) 도메인 타입(`EconomySnapshot`, `EconomicIndicatorSeries`, `EconomicIndicatorPoint`, `TreasuryRateSnapshot`, `EconomicCalendarEvent`, `CalendarImpact`, `MacroBriefingResponse`, `MacroRegime`)은 `domain/economy/types.ts`에 정의되고 `domain/types.ts`가 re-export하며 `index.ts`/`index.client.ts` 양쪽으로 노출. 캐시 envelope `CachedMacroBriefingData`는 infrastructure concern이라 `infrastructure/cache/types.ts`에 `@internal`로 두고 public export 제외(`CachedBriefingData`와 동일 패턴).
- 경제 캘린더 이벤트 AI 분석: 도메인 타입 `EconomicEventAnalysisInput`(**region**/이벤트명/impact/actual/estimate/previous/unit 입력 구조체 — `region`은 **필수** 필드로, `Interest Rate Decision`처럼 국가가 이름에 없는 발표가 미국 맥락으로 해석되는 것을 막는다. 캐시 키 해시에도 들어간다), `EconomicEventAnalysis`(sentiment/summaryKo/interpretationKo 결과 구조체 — `normalizeEconomicEventAnalysis` 반환 타입)는 `domain/economy/types.ts`에 정의되며 양쪽 entry point로 노출. 결과 타입 `RunEconomicEventAnalysisResult`(`runEconomicEventAnalysis`)는 `application/economy/types.ts`에 정의되며 `index.ts` 전용이다. (공개 함수 미사용, `index.ts`/`index.client.ts` 양쪽: `SubmitEconomicEventAnalysisResult`, `SubmitEconomicEventAnalysisCached`, `SubmitEconomicEventAnalysisSubmitted`, `PollEconomicEventAnalysisResult`, `PollEconomicEventAnalysisProcessing`, `PollEconomicEventAnalysisError`, `PollEconomicEventAnalysisDone`.)
- 경제 지표 이름 번역: 결과 타입 `RunIndicatorTranslationResult`(`runIndicatorTranslation`)는 `application/economy/types.ts`에 정의되며 `index.ts` 전용이다. 번역 결과의 payload 타입은 단순 `string`(`nameKo`)이므로 별도 도메인 타입 없음. (공개 함수 미사용, `index.ts`/`index.client.ts` 양쪽: `SubmitIndicatorTranslationResult`, `SubmitIndicatorTranslationCached`, `SubmitIndicatorTranslationSubmitted`, `PollIndicatorTranslationResult`, `PollIndicatorTranslationProcessing`, `PollIndicatorTranslationError`, `PollIndicatorTranslationDone`.)
- **Reasoning 토글**: `SubmitAnalysisOptions`, `SubmitFundamentalAnalysisOptions`, `SubmitFinancialsAnalysisOptions`, `SubmitOptionsAnalysisOptions`, `SubmitNewsAnalysisOptions`, `SubmitCongressTrendOptions`에 선택적 `reasoning?: boolean` 필드가 있다. `OverallDependencyInputs`에도 동일 필드가 있어 `SubmitOverallAnalysisOptions`(`OverallDependencyInputs`를 extends)와 `runOverallAnalysis`의 옵션이 상속한다. `true`는 모델의 기본/스펙 reasoning depth를 요청하고, `false`/omitted는 provider-minimized 설정을 요청한다. 각 축의 use-case가 자신의 캐시 키 빌더(`buildAnalysisCacheKey`/`buildAnalysisPeekCacheKey`/`buildOverallCacheKey`/`buildOverallPeekCacheKey`/`buildFundamentalCacheKey`/`buildFinancialsCacheKey`/`buildOptionsCacheKey`/`buildNewsCacheKey`/`buildCongressTrendCacheKey` — 모두 `@internal`)에 이를 접어 넣어 reasoning ON/OFF 결과가 절대 같은 키로 충돌하지 않는다. `runOverallAnalysis`는 top-level `reasoning`을 네 축(technical/fundamental/news/options) 모두에 균일 전파하되, 축별 옵션에 `reasoning`이 명시돼 있으면 그 축에서는 axis-level 값이 우선한다(`userApiKey`와 동일한 override 우선순위). 티어 게이팅(예: 무료 티어에 `true` 미허용)은 caller 책임 — core는 전달받은 값을 그대로 전달·저장할 뿐 자체 검증하지 않는다. `peekAnalysisCache`/`peekOverallAnalysisCache`의 `reasoning?: boolean` 파라미터(위 Tier 1 항목 참조)가 동일한 reasoning-scoped 키를 읽는다.
- **매크로 캘린더 주입**: `SubmitNewsAnalysisOptions`(`application/news/types.ts`)에 선택적 `macroCalendar?: readonly EconomicCalendarEvent[]` 필드가 있다 — `runNewsAnalysis`가 읽는다. `OverallDependencyInputs`(`application/overall/types.ts`, `runOverallAnalysis` 옵션이 상속)에도 top-level `macroCalendar?: readonly EconomicCalendarEvent[]`가 있어(`upcomingCalendar`와 동일 위치 패턴) `runOverallAnalysis`가 변형 없이 news 축의 `runNewsAnalysis` 호출로 그대로 전달한다 — `news` per-axis 옵션 객체가 아니라 top-level에 둔 것은, 독립 `runNewsAnalysis` 호출과 이 overall 호출이 같은 top-level 입력에서 같은 news 입력·같은 캐시 키를 내야 하기 때문. `buildNewsAnalysisPrompt`(`@internal`, `domain/analysis/newsPrompt.ts`)의 9-인자 오버로드는 10번째 선택적 인자 `macroCalendar: readonly EconomicCalendarEvent[] = []`를 받아, 비어있지 않으면 `## Macro Calendar` 섹션(날짜 오름차순, 최대 12행, 결측값은 `—`, naive 타임스탬프는 `UTC` 명시)을 렌더하고 도입 문장·Data Boundary 규칙에도 매크로 캘린더를 언급한다. **매크로 캘린더 관련 출력은 `macroCalendar`가 비어있을 때 모두 조건부로 생략**되므로 이 옵션을 생략하거나 빈 배열로 두면 프롬프트 바이트·캐시 키·스킬 샘플링 시드가 이 필드가 없을 때와 같다. 캐시 입력 해시(`hashNewsInput`, `application/news/runNewsAnalysis.ts`)와 스킬 샘플링 시드(`createSkillSamplingPlan` seed parts)에는 `@internal` 헬퍼 `macroCalendarFingerprintParts`(`infrastructure/hash/analysisInput.ts`)가 만드는 이벤트별 지문이 접혀 들어간다 — `JSON.stringify([date, event, impact, actual, estimate, previous, unit])`로 직렬화(단순 `|`-join은 `event`/`unit`에 `|`가 섞이면 서로 다른 행이 같은 문자열로 충돌할 수 있어 JSON 배열 인코딩을 쓴다), `domain/analysis/newsPrompt.ts`의 `@internal` export `selectMacroCalendarRows`(날짜 오름차순 + 12행 상한 — 프롬프트 렌더링과 동일한 선택 로직)로 고른 행만 지문화해 12행을 넘는 행의 변경은 캐시를 무효화하지 않는다. 프롬프트가 실제로 렌더하는 필드 전체(`estimate`/`previous`가 재추정·재작성되거나 `actual`이 발표로 채워지면 캐시가 자동 무효화된다). 필터링(국가·중요도·날짜창)은 전적으로 caller 책임 — core는 정렬·상한만 적용한다.

**시장 브리핑 컨텍스트** — `MarketBriefingContext`(`domain/types.ts`, `index.ts`/`index.client.ts` 양쪽 노출). `runBriefing(data, context, options?)`의 두 번째 인자로 시장 이름과 변동성 지수 판독값을 받는다. `volatility: null`이면 프롬프트에서 변동성 블록을 통째로 제거한다. 섹터는 프롬프트 입력 행이 `한국어명 (티커)` 형태이며 **괄호 앞 이름을 "복사"로만** 답한다 — `leadingSectors`/`laggingSectors`는 티커가 아니라 표시용 한국어명이다.

**인터페이스**: `CacheProvider` (optional `setIfAbsent?(key, value, ttlSeconds): Promise<boolean>` — atomic `SET NX EX` — and optional `deleteIfEquals?(key, value): Promise<boolean>` — atomic compare-and-delete; `createCacheProvider` implements both on Upstash, the latter with a Lua `EVAL`. A consumer-built provider without `setIfAbsent` gets **in-process generation dedupe only**; one without `deleteIfEquals` never has its locks released explicitly — they expire by TTL), `ChatTokenStore`, `FmpConfig`, `AnalysisHistoryQuery`(`infrastructure/cache/types.ts` — `analysisHistoryQuery`의 named 반환 타입 `{ limit: number; sinceMs: number }`), Usage repository 인터페이스(`UsageRepository`, `UsageLogRepository`), 관련 record/input 타입(`RecordUsageInput`, `CreateUsageLogInput`, `UsageLogRecord`, `UsageCounts`), enum union 타입(`UsageActionType`, `UserTier`), AI provider 포트 타입(`CallAiProvider`, `CallAiProviderOptions`, `AiContents`, `ConversationRole`, `ConversationTurn`; 모두 `domain/ports/aiProvider.ts`), LLM 키 저장 provider 타입(`LlmProvider`; `domain/llm/providers.ts`가 소비하는 `getProviderForModel`의 반환 타입; `'anthropic' | 'google' | 'openai' | 'deepseek'`; 지원 모델 id 목록은 `TierModel`/`ModelId` union(`domain/types.ts`)이 정본이다), tier 관련 타입(`Tier*`, `ModelId`, `UserTierContext`), usage limit 타입(`UsageLimit*`, `AnalysisUsageOptions`, `SubmitAnalysisOptions`, `SubmitAnalysisGatedResult`, `SubmitAnalysisErrorResult`, `TierTimeframeAccessError`, `UserApiKeyRequiredError`), `BackgroundTaskOptions`, `CacheOptions`(`application/types.ts` — `{ cache?: CacheProvider \| null }`; `run*` 옵션 타입이 모두 확장하고, `peek*`·`getSectorSignals`는 마지막 인자로 받는다. 생략 = env의 Upstash, `CacheProvider` = 그 캐시, `null` = 캐시 없음. `runOverallAnalysis`는 같은 캐시를 하위 축에 전달), 채팅 application 타입. (`SkillsProvider`·`UserTierRepository`는 `@internal` — public에서 도달 불가.) `RunAnalysisResult`의 `cached`/`done` variant는 `result: AnalysisResponse | FilteredAnalysisResponse`와 `lockedInfoDepth: readonly TierInfoDepth[]` 필드를 가진다(`application/market/types.ts`). `PollAnalysisOptions`/`PollOverallAnalysisOptions`(`tier?`/`tierConfig?`)는 export되지만 이를 받는 공개 함수는 없다(위 "공개 함수 미사용" 참고).

**대시보드 상수** — public 표면 없음. `DEFAULT_DASHBOARD_TIMEFRAME`은 core 내부 기본값이며 export하지 않는다. 시장 지수·섹터 ETF·스캔 종목 목록은 consumer-owned 입력이다.

**지표 상수 (consumer 사용분)** — `EMPTY_INDICATOR_RESULT`, `EMPTY_SMC_RESULT`, `RSI_DEFAULT_PERIOD`, `RSI_OVERBOUGHT_LEVEL`, `RSI_OVERSOLD_LEVEL`, `EMA_DEFAULT_PERIODS`, `MA_DEFAULT_PERIODS`, `MACD_FAST_PERIOD`/`MACD_SIGNAL_PERIOD`/`MACD_SLOW_PERIOD`, `CCI_DEFAULT_PERIOD`/`CCI_OVERBOUGHT_LEVEL`/`CCI_OVERSOLD_LEVEL`/`CCI_ZERO_LEVEL`, `DMI_DEFAULT_PERIOD`, `STOCHASTIC_*`/`STOCH_RSI_*`, `HIGH_CONFIDENCE_WEIGHT` 등 consumer가 실제 사용하는 `constants.ts` 값만 public. 나머지 계산 기본값/임계값(ATR·BOLLINGER·KELTNER·SMC·SQUEEZE·SUPERTREND·VP·ICHIMOKU·PSAR·MFI·CMF·DONCHIAN·EMA_SUPPORT_RESISTANCE·WILLIAMS 등)은 internal.

**눌림 판독 상수·타입** — `PULLBACK_TREND_MA_PERIOD`(200), `PULLBACK_EXIT_MA_PERIOD`(5), `PULLBACK_WILLIAMS_R_PERIOD`(14), `PULLBACK_RSI_PERIOD`(2), `PULLBACK_WASHOUT_WILLIAMS_R`(−90), `PULLBACK_NEAR_WILLIAMS_R`(−80), `PULLBACK_BASE_RATES`(판독별 측정 기저율 문장 — 모델이 인용할 수 있게 도구 결과·프롬프트에 싣는다), 타입 `PullbackReading`(`'washoutInUptrend' \| 'nearWashoutInUptrend' \| 'washoutBelowMa200' \| 'none'`)·`PullbackSnapshot` (`domain/signals/pullback.ts`). siglens `get_bars_indicators` 등 소비자가 임계값을 복제하지 않고 이 심볼을 쓰도록 공개.

**Fear & Greed 상수** — `FEAR_GREED_LABEL_CUTOFFS` (5단계 분류 경계 25/45/55/75), `POC_WINDOW_DEFAULT` (= 60, POC 거리 팩터 기본 창), `EXTREME_FEAR_GREED_ZONES` (`['EXTREME_FEAR', 'EXTREME_GREED']`, 표시 순서), `EXTREME_ZONE_FORWARD_HORIZONS` (`[5, 20, 60]` 거래일), `EXTREME_ZONE_MIN_SAMPLE` (= 5, 중앙값을 보이는 최소 표본), `EXTREME_ZONE_REENTRY_GAP` (= 20, 같은 구간 재진입을 새 진입으로 세기까지의 최소 간격), `FEAR_GREED_LOOKBACK_DAYS` (= 1,830, 약 5년 — 종목·시장 공포·탐욕 계산에 쓰는 일봉 기간. consumer의 시장 공포·탐욕 조회 기간도 이 값을 쓴다) (`domain/indicators/fearGreed/`). siglens 게이지 세그먼트 렌더링·점수→라벨 분류에서 사용. 시장 전체 지수는 `MARKET_FEAR_GREED_SERIES_KEYS`(6종 입력 시리즈 키), `MARKET_FEAR_GREED_FACTOR_KEYS`(5종 팩터 키, 표시 순서) (`domain/indicators/marketFearGreed/`) — consumer가 시리즈 fetch·팩터 렌더링을 순회할 때 사용.

**티어 제한 상수** — `DEFAULT_TIER`, `TIER_CONFIG` (`domain/tier.ts`).

**시장 세션 상수/타입** — `MARKET_OPEN_HOUR`, `MARKET_OPEN_MINUTE`, `MARKET_CLOSE_HOUR`, `MARKET_CLOSE_MINUTE` (`domain/utils.ts`), `EtSessionStatus` (`domain/types.ts`). US 정규장 개장/마감 시각(ET) 상수와 세션 상태 union. siglens 옵션 UI·캐시·분석 게이팅에서 사용.

**`MarketSessionStatus` (Tier 4)** — `EtSessionStatus`의 의미 중립적 별칭(`type MarketSessionStatus = EtSessionStatus`). `getSessionStatus`의 반환 타입으로 사용되며, spec-driven generic 세션 함수의 소비자가 보다 중립적인 이름으로 타입을 참조할 수 있다. (`isRegularSessionOpen`은 `boolean`을 반환하므로 이 타입을 사용하지 않는다.) `EtSessionStatus`도 계속 export된다. `src/index.ts`, `src/index.client.ts` 양 진입점에서 export.

**시장 세션 스펙/상수** — `MarketSessionSpec` (discriminated union: `{ kind: 'always-open' }` | `{ kind: 'scheduled'; timeZone; openMinute; closeMinute; weekendDays: readonly number[] }`), `US_EQUITY_SESSION` (NYSE 09:30–16:00 ET Mon–Fri 기본값), `CRYPTO_SESSION` (24/7 always-open 기본값). `MarketSessionSpec` 타입 정의는 `domain/types.ts`, 값 상수 `US_EQUITY_SESSION`/`CRYPTO_SESSION`은 `domain/session.ts`. `dst` 필드는 `Intl.DateTimeFormat` IANA zone이 DST를 자동 처리하므로 포함되지 않는다.

**자산 클래스** — `AssetClass` (`'equity' \| 'crypto'`) — `domain/types.ts`, `index.client.ts`에도 노출. `buildChatPrompt` 8번째 인자(`assetClass?: AssetClass`)와 `SubmitAnalysisOptions`(`runAnalysis`)·`OverallDependencyInputs`(`runOverallAnalysis`)·`SubmitNewsAnalysisOptions`(`runNewsAnalysis`)의 `assetClass?: AssetClass` 선택적 필드가 이 타입을 사용한다.

**뉴스 상품 종류** — `NewsInstrumentKind` (`'company' \| 'fund'`) — `domain/types.ts`. `SubmitNewsAnalysisOptions`(`runNewsAnalysis`)·`OverallDependencyInputs`(`runOverallAnalysis`, 뉴스 축에 그대로 전달)의 `instrumentKind?` 선택적 필드. `'fund'`(ETF·ETN·지수 상품)는 다가오는 일정에 펀드 고유 일정을 먼저 두고 매크로 발표를 2개까지 허용한다. 기본값 `'company'`, 크립토에서는 무시. `'fund'`는 입력 해시·스킬 샘플링 시드에 접혀 회사·펀드 프레이밍이 한 캐시 엔트리를 나누지 않는다(`'company'`는 기존 키 그대로). `EarningsCalendarItem.dateConfirmed?: boolean`(`false` = 공급자 추정일)은 뉴스 프롬프트에 추정일 표식으로 실리고 입력 해시에 반영된다.

**모델 스펙 (단일 source of truth)** — `MODEL_SPECS`, `ModelSpec`, `ClaudeModelSpec`(= `ClaudeAdaptiveModelSpec` \| `ClaudeBudgetModelSpec`), `GeminiModelSpec`, `ChatGPTModelSpec`, `DeepSeekModelSpec`, `ReasoningModes`, provider별 추론 설정 타입(`ClaudeAdaptiveReasoningConfig`, `ClaudeBudgetReasoningConfig`, `GeminiReasoningConfig`, `ChatGptReasoningConfig`, `DeepSeekReasoningConfig`), `ClaudeEffortLevel`, `ChatGptEffortLevel`, `GeminiThinkingLevel`, `EffortLevel`(**@deprecated** — `ClaudeEffortLevel`/`ChatGptEffortLevel`을 쓴다), `AIProvider`, `ActiveModelId`, `ClaudeModelId`, `GeminiModelId`, `ChatGPTModelId`, `DeepSeekModelId` (`domain/analysis/modelSpecs.ts`, 타입은 `domain/types.ts`). AI SDK 호출자(서버 액션, UI 등)가 직접 lookup하는 단일 source of truth — provider 라우팅, max output tokens, 추론 모드(`reasoning: ReasoningModes` — `off`/`on`/`default`와 `hardOff`/`toggleable`), sampling 파라미터를 모델 식별자(`ActiveModelId`)별로 보관한다. Claude spec은 `thinkingApi`(`'adaptive' | 'budget'`)로 갈린다. `AIProvider`는 `'claude' | 'gemini' | 'chatgpt' | 'deepseek'`. `ChatGPTModelSpec.systemPlacement`(선택)는 system 프롬프트를 최상위 `instructions`로 보낼지(생략 시), `input` 맨 앞의 `developer` 메시지로 보낼지(`'developer_message'`)를 정한다. `developer_message` 경로는 `gpt-6.2-sol`에서 `/v1/responses`로 2026-11-21 02:57 KST에 실측했고 같은 접두사 반복 호출에서 캐시 적중이 관찰됐다. 새 모델 추가는 이 맵, `TierModel` union, `TIER_CONFIG.models` 티어 배치를 함께 갱신해야 consumer에 노출된다(배치가 빠지면 `getModelAccess`가 throw한다). 지원 모델 목록은 `TierModel`에서 확인한다. 퇴역한 id와 후속 id: `claude-fable-5-1` → `claude-fable-5-2`, `gpt-6.1-sol` → `gpt-6.2-sol`, `gpt-6-astra` → `gpt-6.2-astra`(core는 매핑을 제공하지 않으므로 저장된 id는 소비자가 옮긴다).

**모델 접근 등급** — `ModelAccess`(`'free' | 'member' | 'byok'`), `getModelAccess(model)`, `requiresAuth(model, config?)`, `requiresByokKey`(`'byok'` 등급에만 `true`), `isPremiumModel`(free가 아닌 모든 모델 — BYOK 필요 여부 판정에 쓰지 않는다) (`domain/tier.ts`). member 모델은 서버 키로 호출되므로 회원에게 키를 요구하지 않는다.

**키 정책** — `KeyPolicy`(`'tier' | 'byok-only'`)·`DEFAULT_KEY_POLICY`(= `'tier'`) (`domain/keyRouting.ts`), `UserApiKeyMissingError`(`application/byok/errors.ts`). `shouldUseServerKey`/`requiresUserApiKey`는 선택 3번째 인자 `keyPolicy`를 받는다(생략 = `'tier'`). `callAnalysisAi`와 모든 생성 use-case 옵션에 선택 필드 `keyPolicy?: KeyPolicy`가 있다.

**채팅 모델 상수** — `DEEPSEEK_V4_1_FLASH_MODEL` (= `'deepseek-v4.1-flash'`), `DEEPSEEK_V4_1_PRO_MODEL` (= `'deepseek-v4.1-pro'`) (`application/chat/constants.ts`). `requestChatCompletion`이 `params.model`을 생략한 호출에 적용하는 기본 모델과, market/economy 브리핑이 사용하는 `BRIEFING_MODEL_ID`(`infrastructure/cache/config.ts`, `@internal`)는 모두 `DEEPSEEK_V4_1_FLASH_MODEL`이다. `model`을 명시하지 않는 caller는 이 기본 모델의 provider(DeepSeek)로 응답을 생성한다.

**고급 도메인 헬퍼**: key-level 클러스터링(`clusterKeyLevels`/`validateKeyLevels`)과 action recommendation 검증(`validateActionPrices`/`extractReconciledActionLines`)은 consumer의 세부 검증 흐름을 위해 `src/index.ts`에서 명시적으로 export한다. **`filterAnalysisResult(result, tier, config?)`**(`domain/analysis/filterAnalysisResult.ts`): `AnalysisResponse`를 `tier`의 허용 정보-깊이로 필터링해 `FilteredAnalysisResult`(`{ result, lockedInfoDepth }`)를 반환하는 순수 함수. `runAnalysis`와 `peekAnalysisCache`가 caller tier로 내부 호출하지만, consumer가 캐시된 원본 `AnalysisResponse`를 직접 재필터링(예: tier 변경 후 재렌더링)해야 하는 경우를 위해 public이다. **`buildPlanCheck(rec, currentPrice, entryPrice)`**(`domain/analysis/planCheck.ts`): `ActionRecommendation`을 주어진 가격과 대조해 `PlanCheck | null`(risk:reward, `belowStopLoss`, `exceedsEntryZone`)을 계산하는 순수 함수. `runAnalysis`가 분석 시점 종가로 이미 내부 호출하지만, siglens의 `get_cached_analysis` 에이전트 툴이 **라이브 시세**로 다시 돌려 `sinceAnalysis.planNow`를 만들어야 해서 public이다. 입출력 타입(`ActionRecommendation`/`PlanCheck`)은 이미 Tier 4 public. **`planEntryPrice(rec, fallback)`**(`domain/analysis/ai-levels.ts`): `buildPlanCheck`/`postProcessAnalysisWithReconcile`가 쓰는 것과 **동일한** entry 기준가(엔트리 구간의 유효 양수 평균, 없으면 `fallback`)를 반환하는 순수 함수 — consumer가 `sinceAnalysis.planNow`용으로 같은 계산을 중복 구현하지 않도록 단일 구현을 공개한다. 그 외 정규화 함수(`normalize*`/`asString`/`asArray`/`compact`)·AI 레벨 보정(`postProcessAnalysisWithReconcile` 등)·추세선·candle 라벨/감지 상수·프롬프트 빌더·개별 신호 감지기는 여전히 internal(공개 aggregate·use-case가 내부 호출).

**그 밖의 export 타입 색인** — 위에서 개별로 설명하지 않은 export 타입의 이름 색인이다. 정의 파일별로 묶었고, 괄호는 노출되는 entrypoint를 뜻한다.

- `application/agent/limits.ts` (서버 entry 전용): `AgentPerTierLimit`, `AgentGlobalLimits`.
- `application/agent/types.ts` (서버 entry 전용): `RunAgentTurnParams`, `RunAgentTurnDependencies`, `RunAgentTurnResult`, `AgentCounters`, `AgentTurnEvent`, `AgentTurnUsage`, `AgentRemaining`, `ExecuteTool`, `ToolExecutionContext`.
- `application/analysis/types.ts` (서버 entry 전용): `CallAnalysisAiOptions`, `CallBriefingAiOptions`.
- `application/chat/types.ts` (양 entrypoint): `ChatErrorCode`, `RequestChatCompletionDependencies`, `RequestChatCompletionParams`.
- `application/congress/types.ts` (서버 entry 전용): `RunCongressTrendDone`.
- `application/economy/types.ts` (서버 entry 전용): `RunEconomicEventAnalysisOptions`, `RunIndicatorTranslationOptions`, `RunMacroBriefingOptions`.
- `application/investorFlows/types.ts` (서버 entry 전용): `RunInvestorFlowsAnalysisDone`, `RunInvestorFlowsAnalysisFetchError`, `RunInvestorFlowsAnalysisMissNoTrigger`, `RunInvestorFlowsAnalysisNoData`.
- `application/market/types.ts` (서버 entry 전용): `RunBriefingOptions`.
- `application/news/marketNewsDigestTypes.ts` (서버 entry 전용): `RunMarketNewsDigestDone`.
- `application/news/types.ts` (서버 entry 전용): `RunNewsAnalysisDone`.
- `application/options/types.ts` (서버 entry 전용): `SubmitOptionsAnalysisSubmitted`.
- `application/overall/types.ts` (서버 entry 전용): `RunOverallAnalysisDone`, `RunOverallAnalysisOptions`.
- `application/usage/types.ts` (양 entrypoint): `AnalysisLimitError`, `AnalysisLimitErrorCode`, `ChatbotLimitError`, `ChatbotLimitErrorCode`.
- `application/usage/types.ts` (서버 entry 전용): `UsageLimitDependencies`, `UsageLimitInput`.
- `domain/agent/agentFollowUps.ts` (양 entrypoint): `SplitAgentFollowUps`.
- `domain/agent/buildAgentSystemPrompt.ts` (서버 entry 전용): `AgentTurnContextInput`, `BuildAgentSystemPromptInput`.
- `domain/agent/buildSuggestionsPrompt.ts` (서버 entry 전용): `SuggestionHeadline`, `BuildSuggestionsPromptInput`, `ParseSuggestionsOptions`.
- `domain/agent/promptShared.ts` (서버 entry 전용): `AgentLocale`.
- `domain/agent/selectHistoryWindow.ts` (서버 entry 전용): `HistoryWindowOptions`.
- `domain/agent/validateArgs.ts` (서버 entry 전용): `ArgIssue`.
- `domain/analysis/candle-trend.ts` (양 entrypoint): `PatternTrend`.
- `domain/investorFlows/types.ts` (양 entrypoint): `InstitutionalHolderChangeKind`, `InsiderTransactionType`, `InvestorFlowsAxisId`, `InvestorFlowsSignalDirection`, `InvestorFlowsSignalStrength`, `InvestorFlowsSignalId`, `InvestorFlowsEvidence`, `InvestorFlowsSignal`, `InvestorFlowsLabel`, `InvestorFlowsSufficiency`, `NetShareChangeBasis`, `PartialInstitutionalQuarter`, `InstitutionalMetrics`, `InsiderMetrics`, `LargeHolderMetrics`, `ShortInterestTrend`, `ShortMetrics`.
- `domain/ports/agentProvider.ts` (서버 entry 전용): `AgentRole`, `AgentToolCall`, `AgentImage`, `AgentImageMediaType`, `AgentMessage`, `JsonSchemaProperty`, `JsonSchemaObject`, `AgentToolSpec`, `AgentStopReason`, `AgentStreamEvent`, `CallAgentProviderOptions`, `AgentProviderResult`, `CallAgentProvider`. `AgentMessage.turnAt?`(user 메시지 전용: 그 메시지를 보낸 UTC 시각, `toISOString()` 형식 — `runAgentTurn`이 이 시각으로 노트를 다시 만들어 붙이며 provider에는 전달되지 않는다).
- `domain/types.ts` (양 entrypoint): `CurrencyCode`, `AnalysisDataAsOf`, `AnalysisSignal`, `AnalysisSignalType`, `BacktestEntryType`, `BacktestLegExitReason`, `BacktestRunData`, `BacktestRunInfo`, `BacktestTickerBaseline`, `BacktestTrade`, `BacktestTradeLeg`, `BacktestTradePlan`, `BacktestTrendLabelStat`, `BacktestTrendRecognition`, `BacktestAiAnalysis`, `BacktestAiEntryRecommendation`, `BacktestAiPriceTarget`, `BacktestAiResult`, `BacktestCase`, `BacktestData`, `BacktestExitReason`, `BacktestMeta`, `BacktestRiskLevel`, `BacktestSignalResult` (deprecated), `Bar`, `BarsData`, `BollingerResult`, `BuySellVolumeResult`, `BollingerDerivedResult`, `ChandelierResult`, `ChandelierTrend`, `ElderRayResult`, `ImpulseColor`, `RegressionResult`, `CandlePattern`, `CandlePatternEntry`, `CandlePatternSummary`, `ChartDisplayType`, `ChatLoadingPhase`, `ChatMessage`, `ChatPromptPayload`, `ChatSession`, `ClusteredKeyLevel`, `ClusteredKeyLevels`, `ConfirmedSignalType`, `ConflictInfo`, `ConflictResolution`, `DashboardTimeframe`, `DMIResult`, `DonchianChannelResult`, `FundamentalAnalystEstimateInput`, `FundamentalCashFlowInput`, `FundamentalFinancialScoresInput`, `FundamentalGradesConsensusInput`, `FundamentalGrowthInput`, `FundamentalPeerInput`, `FundamentalPriceTargetConsensusInput`, `FundamentalPriceTargetSummaryInput`, `FundamentalRatiosInput`, `FundamentalSectorHistoricalInput`, `FundamentalSectorPerformanceInput`, `FundamentalValuationMetrics`, `PriceTargetAvg`, `EntryRecommendation`, `ExpectedSignalType`, `IchimokuFuturePoint`, `IchimokuResult`, `IndexTicker`, `IndicatorGuideResult`, `IndicatorResult`, `KeltnerChannelResult`, `KeyLevel`, `KeyLevels`, `KeyPrice`, `MACDResult`, `MarketBriefingResponse`, `NewsImpact`, `MarketBriefingSectorAnalysis`, `MarketBriefingVolatilityAnalysis`, `MarketIndexData`, `MarketQuote`, `MarketSectorData`, `MarketSummaryData`, `MultiCandlePattern`, `MultiCandlePatternEntry`, `ParabolicSARResult`, `PatternResult`, `PatternSummary`, `PriceScenario`, `PriceTarget`, `PriceTargets`, `PriceTrend`, `QuadrantKey`, `ReconciledActionLevels`, `ReconciledActionLineData`, `ReconciledTpEntry`, `RiskLevel`, `SectorEtf`, `SectorGroupDef`, `SectorSignalsResult`, `SectorStock`, `Signal`, `SignalDirection`, `SignalPhase`, `SignalStrength`, `SignalType`, `SingleCandlePatternEntry`, `Skill`, `SkillCategory`, `SkillChartDisplay`, `SkillCounts`, `SkillDisplay`, `SkillShowcaseItem`, `SkillType`, `SkillUsageRole`, `SMCBreakType`, `SMCEqualLevel`, `SMCFairValueGap`, `SMCOrderBlock`, `SMCResult`, `SMCStructureBreak`, `SMCStructureDirection`, `SMCSwingPoint`, `SMCSwingPointType`, `SMCZone`, `SMCZoneType`, `SqueezeMomentumResult`, `StochasticResult`, `StochRSIResult`, `StockSignalResult`, `StockWithConflict`, `StrategyResult`, `SupertrendResult`, `Tier`, `MeteredRevealPolicy`, `TierConfig`, `TierFeatureFlags`, `TierFeatureLimits`, `TierInfoDepth`, `TierLimitedFeature`, `Timeframe`, `Trend`, `TrendDirection`, `Trendline`, `TrendlineDirection`, `TrendlinePoint`, `TrendState`, `ValidatedActionPrices`, `VolumeProfileResult`, `VolumeProfileRow`, `WaitUntil`, `BaseModelSpec`, `FilteredActionRecommendation`, `NewsSourceLanguage`, `OverlayCandidate`.
- `domain/types.ts` (서버 entry 전용): `NormalizedUsage`, `AnalysisType`, `AssembledPrompt`, `MarketEvent`.
- `infrastructure/cache/types.ts` (서버 entry 전용): `AnalysisHistoryAxis`.
- `infrastructure/market/types.ts` (양 entrypoint): `AcquireReanalyzeCooldownResult`.
- `infrastructure/usage/counterStore.ts` (서버 entry 전용): `CounterStoreOptions`, `CounterPeriod`, `CounterFailurePolicy`.

`NormalizedUsage`의 `promptTokens + cachedTokens + cacheWriteTokens`는 provider가 보고한 입력과 같다. 단 provider가 cached와 cache-write의 합을 입력보다 크게 보고하면 `promptTokens`는 0으로 바닥 처리된다. `cacheWriteTokens`는 Claude와 OpenAI Responses 경로(`input_tokens_details.cache_write_tokens`)에서 채워지고 Gemini와 DeepSeek에서는 항상 0이다.

전체 타입 목록은 `src/domain/types.ts`와 `src/index.ts`의 `export type {...}` 블록을 참고한다.

### Internal (export 하지 않음)

다음 함수/상수는 다른 public 함수의 보조 구현이며, **`src/index.ts`에서 export하지 않고** 정의부에 `/** @internal */` 태그를 붙인다.

**개별 지표 계산기** — `calculateRSI`, `calculateMACD`, `calculateBollinger`, `calculateStochastic`, `calculateATR`, `calculateOBV`, `calculateSAR`, `calculateWilliamsR`, `calculateSupertrend`, `calculateMFI`, `calculateKeltner`, `calculateCMF`, `calculateDonchian`, `calculateVWAP`, `calculateEMA`, `calculateSMC`, `calculateSqueezeMomentum`, `calculateIchimoku`, `calculateCCI`, `calculateDMI` 등 개별 계산기는 internal — 공개 aggregate `calculateIndicators()` (Tier 2)로 통합 호출한다. (`calculateIchimokuFutureCloud`는 미래 클라우드 시각화용 별도 public 함수. `calculateMA`도 consumer가 이동평균을 재구현하지 않도록 `src/index.ts`에서 export한다.)

**개별 신호 감지기** — `detectRsiOversold`, `detectRsiOverbought`, `detectGoldenCross`, `detectDeathCross`, `detectMacdBullishCross`, `detectMacdBearishCross`, `detectBollingerLowerBounce`, `detectBollingerUpperBreakout`, `detectSupertrendBullishFlip`, `detectIchimokuCloudBreakout`, `detectCciBullishCross`, `detectDmiBullishCross`, `detectCmfBullishFlip`, `detectMfiOversoldBounce`, `detectParabolicSarFlip`, `detectKeltnerUpperBreakout`, `detectSqueezeMomentumBullish`, `detectRsiBullishDivergence`, `detectRsiBearishDivergence`, `detectMacdHistogramBullishConvergence`, `detectMacdHistogramBearishConvergence`, `detectBollingerSqueezeBullish`, `detectBollingerSqueezeBearish`, `detectSupportProximityBullish`, `detectResistanceProximityBearish` → `detectSignals()`로 통합 호출.

**신호 헬퍼** — `findCross`, `findThresholdCross`, `findPivotLows`, `findPivotHighs`, `computeBbWidth`, `computePctB`, `computeEmaSlope`, `percentileRank`.

**캔들 패턴 (internal)** — `detectCandlePattern`, `detectMultiCandlePattern`, `findCandlePatternLabel`, `CANDLE_PATTERN_LABELS`, `MULTI_CANDLE_PATTERN_LABELS`, `CANDLE_PATTERN_DETECTION_BARS`, `EXCLUDED_SINGLE_PATTERNS` → UI/프롬프트는 살아있는 `getCandlePatternLabel`/`getMultiCandlePatternLabel`/`detectCandlePatternEntries` 등(Tier 2)을 사용.

**프롬프트 빌더 (internal)** — `buildAnalysisPrompt`, `buildFundamentalAnalysisPrompt`, `buildMarketBriefingPrompt`, `buildNewsAnalysisPrompt`, `buildNewsCardAnalysisPrompt`, `buildOverallAnalysisPrompt` → `run*` use-case가 내부 호출. (`buildChatPrompt`는 public.)

**정규화 헬퍼 (internal)** — `asNumber`, `asBoolean`, `asEnum`, `asOptionalEnum`, `asObject`, `asString`, `asArray`, `compact`, `enrichAnalysisWithConfidence` 및 모든 `normalize*` 함수(`normalizeTrend`/`normalizeRiskLevel`/`normalizeKeyLevels`/`normalizePriceTargets`/`normalizeIndicatorGuideResult`/`normalizeKeyLevel`/`normalizePriceTarget`/`normalizePriceScenario`(`{ targets, condition }` 대신 bare `targets` 배열도 받아 `condition: ''`로 감쌈 — LLM 형식 이탈 시 목표가 유실 방지)/`normalizeSignal`/`normalizeKeyPrice`/`normalizeTrendlinePoint`/`normalizePatternGeometry`/`normalizeIdList`/`normalizeChartOverlay`/`normalizeActionRecommendation`/`normalizeCandlePatternSummary`/`normalizePatternSummary`/`normalizeStrategyResult`/`normalizeTrendline` + `normalize*AnalysisResponse`/`normalizeFundamentalSnapshot`/`normalizeMarketBriefing`). use-case가 LLM 응답 정규화에 내부 사용.

**액션/리스크 유틸 (internal)**: `isValidBullishStopLoss`, `isValidBullishTakeProfit`, `deriveFallbackStopLoss`, `deriveFallbackTakeProfit`, `resolveBullishStopLoss`, `resolveBullishTakeProfit`, `buildBullishExitText`, `buildBullishRiskRewardText`, `reconcileBullishActionRecommendation`, `postProcessAnalysisWithReconcile`, `extendTrendline`. (`validateActionPrices`/`extractReconciledActionLines`/`clusterKeyLevels`/`validateKeyLevels`/`filterAnalysisResult`는 public; '고급 도메인 헬퍼' 참조.)

**내부 디테일 상수** — `ISO_DATE_HOUR_PREFIX_LENGTH`, `ISO_DATE_PREFIX_LENGTH`, `PROMPT_CONFIG_BY_TIMEFRAME`, `MULTI_CANDLE_PATTERN_BUFFER` — 모두 public 함수의 동작 디테일이며 consumer가 직접 다루지 않는다.

**외부 LLM 응답 스키마** — `RawAnalysisResponse`. LLM이 반환하는 원시 응답 구조이며, 외부 LLM 스키마에 직접 결합된다. consumer에 노출하면 LLM 변경 시 호환성이 깨지므로 internal로 유지한다. `enrichAnalysisWithConfidence`는 외부 경계에서 `unknown`을 받아 내부적으로 이 타입으로 cast한다.

---

## 새 함수 추가 시 결정 워크플로우

새 함수를 추가하면 다음 순서로 분류한다.

1. **`application/`에 새 use-case 함수를 추가했는가?** → Tier 1.
2. **`domain/`에서 여러 작은 함수를 묶는 high-level 진입점인가?** (예: 새 통합 계산기, 새 프롬프트 빌더) → Tier 2. 단, 작은 헬퍼 함수는 internal.
3. **`infrastructure/`에 새 외부 시스템 연결 factory 또는 config reader를 추가했는가?** → Tier 3.
4. **새 타입/인터페이스/상수인가?** → Tier 4.
5. **위 어디에도 해당하지 않거나, 다른 public 함수의 보조인가?** → Internal.

**판정 보조 질문**:
- "이 함수를 호출하지 못하면 consumer가 라이브러리를 사용할 수 없는가?" → **YES**면 Tier 1~3 중 하나.
- "이 함수가 사라지거나 이름이 바뀌어도 다른 public 함수가 정상 동작하는가?" → **YES**면 internal로 묶어도 안전.

---

## Optional peer dependency (AI provider SDK, `@upstash/redis`)

`@anthropic-ai/sdk`, `@google/genai`, `openai`, `@upstash/redis`는 **optional peerDependencies**다. 패키지
진입점(`index.ts`·`index.client.ts`)을 import하는 것만으로는 어떤 SDK도 로드되지 않으며,
provider 어댑터가 처음 호출될 때 해당 SDK를 지연 로드한다. 소비자는 실제로 쓰는 모델의
SDK만 설치한다(Claude → `@anthropic-ai/sdk`, Gemini → `@google/genai`, ChatGPT·DeepSeek →
`openai`, Redis 캐시·카운터 → `@upstash/redis`). Redis 어댑터는 Upstash env가 설정된 상태에서 첫
작업을 할 때 `@upstash/redis`를 로드한다. 패키지가 없으면 각 어댑터는 Redis 장애와 같은 경로로
처리한다(캐시는 `MissingSdkError`를 던지고, 토큰·쿨다운은 통과시키고, `failurePolicy: 'closed'`
카운터는 `CounterStoreUnavailableError`를 던진다). 설치되지 않은 SDK의 모델을 호출하면 설치 안내 메시지를 담은 에러(`name === 'MissingSdkError'`)로
실패하며, 재시도 대상이 아니다.

---

## 버전 관리 정책

`siglens-core`는 [Semver](https://semver.org)를 따른다.

| 변경 종류 | 버전 |
|---|---|
| Tier 1~4 함수의 시그니처 변경(파라미터/반환 타입) | major |
| Tier 1~4 함수 삭제 또는 이름 변경 | major |
| Tier 4 인터페이스 필드 삭제/이름 변경 | major |
| Tier 1~3 새 함수 추가 | minor |
| Tier 4 새 타입/필드 추가 (optional 필드) | minor |
| Internal 함수의 어떤 변경이든 | patch (또는 minor) |
| 버그 수정만 | patch |


---

## Internal 함수 사용 금지

Consumer 프로젝트는 `@y0ngha/siglens-core`의 두 entry point(`src/index.ts`, `src/index.client.ts`)가 내보내는 **named export**만 사용해야 한다. 패키지에 default export는 없다. 다음은 모두 금지한다.

```typescript
// ❌ 금지 — deep import
import { calculateRSI } from '@y0ngha/siglens-core/dist/domain/indicators/rsi';

// ❌ 금지 — internal 함수의 우회 import
import { detectRsiOversold } from '@y0ngha/siglens-core/dist/domain/signals/confirmed';

// ✅ OK — public 진입점만 사용
import { calculateIndicators, detectSignals } from '@y0ngha/siglens-core';
```

만약 consumer가 internal 함수의 동작이 필요하다면, **`siglens-core`에 새 public 함수를 추가하는 PR을 올려라**. 우회 import는 다음 minor 버전에서 깨질 수 있다.

---

## `@internal` 태그 사용 규칙

Internal 함수의 정의부에는 JSDoc `@internal` 태그를 붙인다.

```typescript
/**
 * @internal
 * 내부 헬퍼 — calculateIndicators()에서만 사용.
 */
export function calculateRSI(closes: number[], period: number): (number | null)[] {
    // ...
}
```

이렇게 표시하면:

- **TypeDoc**이 자동 생성 문서에서 해당 함수를 제외한다(`typedoc.json`의 `excludeInternal: true`).
- **IDE**(VSCode 등)가 hover 시 "@internal" 표시를 보여 consumer에게 경고한다.
- **검색 grep**으로 internal 함수만 한 번에 찾을 수 있다.

`/** @internal */` 한 줄짜리 태그도 허용하지만, 권장 형태는 한 줄 설명을 함께 넣는 것이다. 자세한 작성 규칙은 `docs/CONVENTIONS.md`의 "JSDoc Rules" 섹션 참고.

---

## TypeDoc 통합

공개 API 문서는 TypeDoc(`yarn doc`)으로 생성한다. `typedoc.json`은 다음을 보장한다.

- `entryPoints`: `src/index.ts`만.
- `excludeInternal: true` — `@internal` 태그가 붙은 심볼은 자동으로 docs에서 제외.
- `excludePrivate: true` — 클래스의 `private` 멤버 제외.

생성된 문서에는 Tier 1~4의 public 함수와 타입만 나타난다. internal 함수는 grep으로만 찾을 수 있고, 자동 문서에서는 보이지 않는다.

---

## Export 변경 체크리스트 (메인테이너용)

`src/index.ts`·`src/index.client.ts`를 바꾸거나 export를 추가·삭제·`@internal` 전환할 때
확인한다. 규칙 ID는 고정이며 번호를 다시 매기지 않는다. 다른 문서와 코드 주석에서는
`PUBLIC_API.md#API-5` 형태로 인용한다.

<a id="API-1"></a>
#### API-1 — 두 entrypoint의 정합

- 브라우저가 쓰는 값(상수·함수)은 `src/index.ts`와 `src/index.client.ts` **양쪽**에서
  export하고, `index.test.ts`·`index.client.test.ts`에 존재·호출 가능 단언을 둔다.
  한쪽에만 있으면 서버는 통과하고 브라우저 번들이 런타임에 `undefined`로 깨진다.
  서버 전용으로 의도한 순수 helper는 한쪽에만 두되, 그 비대칭과 이유를 JSDoc 또는 인벤토리
  행에 적는다.
- 함수가 실제로 반환하는 타입을 export한다. 일부 variant만 담은 좁은 타입
  (`SubmitAnalysisResult`)이 아니라 실제 반환 타입(`SubmitAnalysisGatedResult`)이다.
- barrel을 정리한 뒤에는 `src/index*.ts`의 re-export 대상이 아직 존재하는지 확인한다.

<a id="API-2"></a>
#### API-2 — 소비자 계약만 export한다

캐시 키·TTL 상수, Redis 옵션, 클라이언트 수명주기 헬퍼(`getDatabaseClient`류), 개별
지표 계산기(`calculateATR` 등 — Tier 2 진입점은 `calculateIndicators`뿐), 내부 구현
상수는 export하지 않는다. 이름이 공개되면 내부 리팩터링이 곧 breaking change가 된다.
소비자가 import해야 하는 이유가 생기면 그때 Tier를 정해 추가한다.

<a id="API-3"></a>
#### API-3 — 공개 시그니처의 폐포는 모두 공개다

공개 함수의 파라미터·반환 타입, 공개 타입의 필드·union 멤버·`extends`·배열 원소,
discriminated union의 모든 variant는 export되어야 하고 `@internal`을 달 수 없다.
`export type { X }` 같은 중간 re-export 줄에 붙은 `@internal`도 모순이므로 함께
확인한다. Provider 인터페이스는 `@internal`인 `Raw*` 대신 도메인 중립 `*Input` 별칭을
반환한다.

<a id="API-4"></a>
#### API-4 — 제거·`@internal` 전환 스윕 절차

심볼을 일괄 제거하거나 `@internal`로 돌리기 전에:

1. 두 entrypoint에서 시작해 도달 가능성 폐포를 계산한다: 공개 함수의 파라미터·반환
   타입, 공개 타입의 필드·union 멤버·`extends`·배열 원소·variant. 폐포 안의 타입은
   제거·`@internal` 대상에서 뺀다.
2. 건드린 파일의 `export`를 **전부** 나열한다(`export ` grep). 제거 목록 순서대로
   태그를 달면 형제 심볼이 빠진다.
3. 새로 `@internal`이 된 심볼이나 export되지 않는 상수를 가리키는 `{@link}`를 공개
   JSDoc에서 찾아 산문으로 바꾼다(상수라면 값을 산문에 직접 적는다).
   TypeDoc(`excludeInternal`)이 깨진 링크로 렌더한다.
4. 이 패키지를 쓰는 소비자 레포 전부에서 심볼 이름과
   `@y0ngha/siglens-core` import를 grep한다. 소비자가 import하거나 구현(`implements
   <Port>`)하거나 자기 상수의 타입으로 쓰는 심볼(`SectorGroupDef`)은 코어 안에서
   쓰이지 않아도 공개 계약이다. 제거·전환된 공개 심볼과 소비자 import의 교집합이 비어
   있어야 릴리스한다.

마지막에 `yarn typecheck`가 "is not exported" 오류 없이 통과하는지 확인한다.

<a id="API-5"></a>
#### API-5 — Tier 4 개명·삭제는 `@deprecated`로 이행한다

Tier 4 타입·인터페이스 필드·union 멤버·port 메서드의 개명이나 삭제는 소비자의 컴파일을
깨뜨린다. 옛 이름을 `@deprecated`로 남기고(타입 alias, 선택적 필드와
`deps.callAiProvider ?? deps.callGemini` 같은 fallback, 삭제하려던 union 멤버 복원,
제거한 port 메서드는 선택적 멤버로 유지), semver를 올리고 `CHANGELOG.md`에 기록한다.
이행이 불가능한 예외는 해당 커밋 본문에 근거와 함께 남기고, `BREAKING CHANGE:` 꼬리말을
달아 `CHANGELOG.md`에도 실리게 한다.
공개로 승격하는 타입은 `@internal`을 떼고, 옛 이름이 있으면 보존한다.

<a id="API-6"></a>
#### API-6 — 인벤토리를 같은 커밋에서 갱신하고, 동작 변경은 커밋 본문에 남긴다

export가 바뀌면 `현재 노출 인벤토리`를 **같은 커밋**에서 고친다. 삭제한 심볼의 행도 같이
지운다. 인벤토리 행은 현재 계약만 적는다 — 언제·어느 PR에서 바뀌었는지 같은 이력은 적지
않는다.

`src/__tests__/guards/publicApiInventory.test.ts`가 두 entrypoint의 export 이름이 이 문서에 백틱 식별자로 등장하는지, 그리고 인벤토리 표 행의 첫 셀 머리 식별자가 실제로 export되는지 검사한다. 실패하면 허용 목록을 만들지 말고 문서(또는 export)를 고친다.

변경 이력은 커밋 메시지(git 이력)로 남긴다. 릴리스 때 `CHANGELOG.md`에는 커밋 제목과
`BREAKING CHANGE:` 꼬리말만 모이므로, 소비자 조치가 필요한 변경은 그 꼬리말에 적는다. 공개
진입점의 동작이 바뀌는 커밋 본문은:

- 바뀐 내부 함수가 아니라 **공개 진입점의 관찰 가능한 동작**을 기준으로 쓴다
  (`@internal` 함수가 바뀌었어도 `runOverallAnalysis`의 동작이 달라지면 적는다).
- 의도한 문구 변경을 빠짐없이 나열한다("text only moved"라고 쓰고 한 문장을 바꾸지
  않는다).
- 소비자 조치(없으면 "없음")와 semver 영향을 적는다. 툴 설명이 약속하는 소비자 생성
  필드(`rsi2` 등)는 소비자 조치에 이름을 적는다. 설명이 실행기 출력에 기대는 계약점(null이
되는 필드, `degraded`의 의미, 새 `reason` 코드)도 인벤토리 행의 소비자 조치에 같은 이름으로
적는다.
- 캐시 의미를 적는다(이전 엔트리는 TTL까지 옛 동작을 유지한다). 소비자가 캐시·직렬화하는
  타입에 필드를 더하면 크기, 캐시 키 bump 여부, 서버 전용 여부를 적는다.

<a id="API-7"></a>
#### API-7 — Tier 3와 Tier 4는 별도 export 블록으로 둔다

`src/index.ts`에서 팩토리·설정(Tier 3)과 스키마 객체·상수 배열(Tier 4)은 서로 다른
`export { … }` 블록에 둔다. Tier 3 심볼을 기존 블록에 추가할 때 그 블록에 Tier 4
심볼이 섞여 있으면 다시 나눈다.

```typescript
// Tier 3: Factories & Config
export { createCacheProvider } from './infrastructure/cache/redis';
export { createChatTokenStore } from './infrastructure/chat/tokenStore';
// Tier 4: Constants
export { MODEL_SPECS } from './domain/analysis/modelSpecs';
```

<a id="API-8"></a>
#### API-8 — 공개 helper가 반환하는 목록은 순서가 안정적이다

공개 helper가 돌려주는 목록은 설정 컨테이너(`Record`의 삽입 순서)에 의존하지 않도록
`toSorted()`로 정렬해서 반환한다.
