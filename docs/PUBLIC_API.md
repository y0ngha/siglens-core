# Public API Boundary

> 🆕 **0.6.0 (planned)**: introduces `MODEL_SPECS` to consolidate per-model AI SDK
> parameters previously hardcoded in `siglens-worker` (`models.ts` /
> `thinking-budget.ts`). New Tier 4 exports — `MODEL_SPECS`,
> `THINKING_BUDGET_FALLBACK_STEPS`, `DISABLED_THINKING_BUDGET`, `ModelSpec`,
> `AIProvider`, `ActiveModelId`, `ClaudeModelId`, `GeminiModelId`,
> `ChatGPTModelId` — and Tier 2 helpers — `getProvider`, `isClaudeModel`,
> `isGeminiModel`, `isChatGPTModel`, `getThinkingBudgetSequence`. The three
> `is*Model` helpers are TypeScript type predicates that narrow `ActiveModelId`
> to the provider-specific subset.
> Worker reads this map directly so model additions become a one-row core change.

> 📊 **Post-refactor surface (Phase 0~6 완료)**: Tier 1 = 12, Tier 2 ≈ 80,
> Tier 3 ≈ 30, Tier 4 ≈ 200+ (도메인/인프라 인터페이스, enum union, 상수 일체).
> 인증/OAuth/이메일/문의(contact)/BYOK/Tier CRUD/한국어 티커/Drizzle/Neon/
> Gemini SDK 코드는 모두 consumer 애플리케이션(`siglens`)으로 이전되어
> core에서는 더 이상 export되지 않는다. core는 분석 도메인 + 분석 직결
> infrastructure + Skills + 추상 repository 인터페이스만 보유한다.

> ℹ️ core scope는 "분석 도메인 + 분석 직결 infrastructure + Skills"로
> 좁혀졌으며, 인증/세션/OAuth/이메일/BYOK/문의/한국어 티커/`usage_logs`
> 관련 export는 Phase 1~6에 걸쳐 순차적으로 제거되었다. 단계별 결과는
> `docs/SCOPE.md` §7 ejection 로드맵 참조.
>
> Phase 1 완료: 다음 export가 `src/index.ts`에서 제거되고 siglens 로컬 모듈로 이전됨.
> - Inquiry: `submitInquiry`, `SubmitInquiryDeps`, `DrizzleInquiryRepository`, `InquiryRepository`, `InquiryInput`
> - Email Token Store: `createEmailTokenStore`, `EmailDispatcher`, `EmailMessage`, `EmailTokenPurpose`, `EmailTokenStore`, `EmailTokenValue`
> - OAuth 토큰 폐기: `compositeOAuthRevoker`, `OAuthRevoker`, `RevokeTokenParams`
>
> Phase 2 완료: 다음 auth 관련 export가 `src/index.ts`에서 제거되고 siglens 로컬 모듈로 이전됨.
> - Auth use-cases: `registerUser`, `loginUser`, `socialLoginUser`, `logoutUser`, `deleteAccount`, `findUserBySessionToken`, `requestEmailVerification`, `verifyEmail`, `requestPasswordReset`, `confirmPasswordReset`
> - Cookie 상수/타입: `AUTH_SESSION_COOKIE_NAME`, `DEFAULT_SESSION_TTL_SECONDS`, `DEFAULT_AUTH_COOKIE_PATH`, `DEFAULT_AUTH_COOKIE_SAME_SITE`, `AuthSessionCookie`, `AuthSessionOptions`
> - Password adapters: `bcryptPasswordHasher`, `bcryptPasswordVerifier`, `PasswordHasher`, `PasswordVerifier`
> - DB repositories (auth-side): `DrizzleUserRepository`, `DrizzleSessionRepository`, `DrizzleOAuthAccountRepository`
> - DB types (auth-side): `UserRepository`, `EmailAuthUserRepository`, `OAuthUserRepository`, `SessionRepository`, `OAuthAccountRepository`, `AuthUserRecord`, `EmailAuthUserRecord`, `AuthSessionRecord`, `OAuthAccountRecord`, `CreateEmailUserInput`, `CreateOAuthUserInput`, `CreateSessionInput`
> - Use-case input/result/error types: `RegisterUser*`, `LoginUser*`, `SocialLoginUser*`, `LogoutUser*`, `DeleteAccount*`, `RequestEmailVerification*`, `VerifyEmail*`, `RequestPasswordReset*`, `ConfirmPasswordReset*`, `FindUserBySessionToken*`
>
> Phase 3 완료: BYOK 및 Tier CRUD 관련 export가 `src/index.ts`에서 제거되고 siglens 로컬 모듈로 이전됨.
> - Tier CRUD use-cases: `getUserTier`, `setUserTier`, `createUserTierContext`
> - Tier CRUD types: `CreateUserTierContextInput`, `GetUserTierInput`, `SetUserTierError`, `SetUserTierErrorCode`, `SetUserTierInput`, `SetUserTierResult`, `UserTierDependencies`
> - BYOK domain: `isLlmProvider`, `normalizeLlmApiKey`
> - BYOK repository: `DrizzleUserApiKeyRepository`, `UpsertUserApiKeyInput`, `UserApiKeyMetaRecord`, `UserApiKeyRecord`, `UserApiKeyRepository`
> - 정책(`domain/tier.ts`)과 `UserTierRepository`/`UserTierContext`는 분석 use-case가 옵션으로 받는 인터페이스이므로 core에 잔존.
>
> `users`, `sessions`, `oauthAccounts`, `userApiKeys` 테이블 정의와 `OAUTH_PROVIDER_VALUES`,
> `oauthProviderEnum`, `userTierEnum`, `USER_TIER_VALUES`, `LLM_PROVIDER_VALUES`, `llmProviderEnum`
> 등 enum/schema export는 Phase 6에서 다룰 때까지 유지(siglens DB repo가 schema를 소비).
>
> Phase 4.5 완료: AI provider SDK 어댑터(Gemini)가 siglens 로컬 모듈로 이전됨.
> - `callGeminiWithKeyFallback` export 제거 (`infrastructure/ai/gemini.ts` 삭제).
> - `AI_SYSTEM_PROMPT` export 위치 이동: `infrastructure/ai/utils.ts` → `domain/analysis/systemPrompt.ts`.
> - 폐기 타입 alias 제거: `GeminiContents`, `CallGeminiWithKeyFallbackOptions`. (`AiContents`, `CallAiProviderOptions` 사용)
> - `RequestChatCompletionDependencies`의 `callAiProvider` 필드가 **필수**로 승격되며, 폐기 필드 `callGemini`/`getCurrentDate`가 제거됨. **BREAKING**: 기존 `requestChatCompletion(params)` 호출은 두 번째 인자(deps)에 `callAiProvider`를 명시 전달해야 한다.
> - core의 `peerDependencies`에서 `@google/genai` 제거. siglens가 자체 의존으로 보유.
>
> Phase 4 완료: 티커 검색/자산정보 도메인이 siglens 로컬 모듈로 이전됨.
> - Tier 1 use-cases: `searchTicker`, `getAssetInfo`
> - Tier 2 domain: `deduplicateResults`, `isKoreanInput`, `isValidTickerFormat`
> - Tier 3 cache keys: `TICKER_SEARCH_CACHE_TTL`, `ASSET_INFO_CACHE_TTL_WITH_KOREAN`, `ASSET_INFO_CACHE_TTL_WITHOUT_KOREAN`, `buildTickerSearchCacheKey`, `buildAssetInfoCacheKey`
> - Tier 3 DB: `DrizzleAssetTranslationRepository`, `DrizzleKoreanTickerRepository`
> - Tier 4 types: `KoreanTickerEntry`, `TickerSearchResult`, `AssetInfo`, `TickerCategory`, `CategoryId`, `TickerBase`, `AssetTranslationRecord`, `AssetTranslationRepository`, `KoreanTickerRepository`
> - `koreanTickers`, `assetTranslations` 스키마 테이블은 Phase 6에서 다룰 때까지 유지.
> - `koreanTranslator.ts`는 Phase 4.5에서 siglens 로컬 Gemini 어댑터로 재배선됨.
>
> Phase 5 완료: Drizzle usage repository 구현이 siglens 로컬 모듈로 이전됨.
> - 제거된 export: `DrizzleUsageRepository`, `DrizzleUsageLogRepository` (Tier 3).
> - 인터페이스(`UsageRepository`, `UsageLogRepository`)와 정책 함수(`checkAnalysisLimit`, `checkChatbotLimit`, `buildUsageLimitError`)는 core에 잔존 — 분석/챗봇 use-case가 DI로 인터페이스를 소비.
> - `usageLogs` 테이블 정의, `usageActionTypeEnum`, `USAGE_ACTION_TYPE_VALUES`, `hashUsageIp`는 Phase 6까지 유지(siglens 로컬 repo가 의존).
>
> Phase 6 완료: 모든 Drizzle/Neon DB infrastructure가 siglens 로컬로 이전되며 core surface가 안정화됨.
> - 제거된 export (Tier 3 Database factory): `createDatabaseClient`.
> - 제거된 export (Tier 4 schema 테이블): `users`, `sessions`, `oauthAccounts`, `userApiKeys`, `usageLogs`, `inquiries`, `koreanTickers`, `assetTranslations`.
> - 제거된 export (Tier 4 enum 객체): `userTierEnum`, `usageActionTypeEnum`, `oauthProviderEnum`, `llmProviderEnum`.
> - 제거된 export (Tier 4 enum 값 배열): `USER_TIER_VALUES`, `USAGE_ACTION_TYPE_VALUES`, `OAUTH_PROVIDER_VALUES`, `LLM_PROVIDER_VALUES` — 각 union 타입은 그대로 유지되므로 consumer가 자체 배열을 정의해 `satisfies readonly Tier[]` 등으로 검증한다.
> - 제거된 export (Tier 4 DB 핸들 타입): `SiglensDatabase`, `DatabaseConfig` (`NeonSqlClient`/`DatabaseClient`는 internal).
> - core에 잔존 — 추상 repository 인터페이스 (`UsageRepository`, `UsageLogRepository`, `UserTierRepository`), input/output record 타입 (`RecordUsageInput`, `CreateUsageLogInput`, `UsageLogRecord`, `UsageCounts`), enum union 타입 (`UserTier`, `UsageActionType`), `UserTierContext`, `hashUsageIp`, 정책 함수 (`checkAnalysisLimit`, `checkChatbotLimit`, `buildUsageLimitError`).
> - core `package.json`에서 `@neondatabase/serverless`/`drizzle-orm` peerDependency·devDependency 제거. `drizzle.config.ts`/`drizzle/` 마이그레이션도 siglens로 이전.
> - 의의: core는 더 이상 어떤 DB infrastructure도 알지 못한다. siglens는 schema, client, config, constants, 마이그레이션을 모두 자체 소유한다.

## 개요

`siglens-core`는 npm 패키지(`@y0ngha/siglens-core`)로 다른 프로젝트(현재는 `siglens`)에서 import해 사용하는 라이브러리다. 모든 외부 노출은 `src/index.ts`를 통해서만 이루어지며, deep import(`@y0ngha/siglens-core/src/...`)는 지원하지 않는다.

라이브러리의 함수는 두 부류로 나뉜다.

- **Public** — 외부 consumer가 직접 호출하도록 설계된 진입점. 시그니처가 안정적이며 호환성을 유지한다.
- **Internal** — public 함수의 보조 구현. 라이브러리 내부에서만 호출되며, 자유롭게 변경·삭제·이름 변경될 수 있다.

이 문서는 어떤 함수를 public/internal로 분류할지, 새 함수가 추가될 때 어떻게 결정할지, 그리고 consumer가 internal 함수에 의존하지 못하도록 어떤 신호를 제공할지를 정의한다.

이 정책은 layer dependency 규칙(`docs/ARCHITECTURE.md`)과 **직교한다**. layer는 코드의 의존 방향을 통제하지만, 노출 정책은 어떤 함수가 패키지 외부 경계를 넘는지를 통제한다. 한 layer 안에도 public과 internal이 공존할 수 있다.

---

## Tier 정의

Public 함수는 4개 Tier로 분류한다. Tier는 호출자(누가 부르는가)와 안정성 보장 수준에 따라 나뉜다.

### Tier 1 — Application Entrypoints

**용도**: Server Action, API handler, worker가 직접 호출하는 use-case 함수.

**위치**: `src/application/`

**특징**:
- 도메인 + 인프라를 조합하는 비동기 함수.
- consumer 입장에서 가장 자주 호출되는 함수 그룹.
- 시그니처 변경은 semver major.

### Tier 2 — Domain Building Blocks

**용도**: consumer가 도메인 로직을 직접 호출해야 하는 경우(예: UI에서 캔들 패턴 감지, worker에서 지표 재계산).

**위치**: `src/domain/`의 high-level 진입점만. 개별 지표/신호 함수는 Tier 2가 아니다.

**특징**:
- 동기 순수 함수. 부작용 없음.
- "여러 작은 함수를 묶어 한 번에 호출 가능한 단위"만 Tier 2에 포함.
- 시그니처 변경은 semver major.

### Tier 3 — Infrastructure Factories & Config

**용도**: consumer가 환경별 인프라를 생성/설정/제어할 때 호출하는 factory·config 함수.

**위치**: `src/infrastructure/`의 진입점만.

**특징**:
- 외부 시스템(Redis, AI provider, 시장 데이터 API)과의 연결을 추상화한 factory.
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
- `src/index.ts`에서 export 하지 않는다.
- 함수 정의부에 `/** @internal */` JSDoc 태그를 붙인다(TypeDoc 자동 필터링용).
- 시그니처/이름/파일 위치는 minor 버전에서도 자유롭게 변경 가능하다.

---

## 현재 노출 인벤토리

> 분류 기준: ../siglens(분리 전 코드)에서의 직접 호출 패턴 + 합리적 확장(워커/CLI 등 미래 consumer 고려).

### Tier 1 — Application Entrypoints (22)

| Symbol | Source |
|---|---|
| `submitAnalysis(..., options?)` — `options.marketDataProvider?: MarketDataProvider` added. Required on cache miss (omitting it throws at runtime); optional when `skipEnqueueIfMiss: true` because cache hits return early before the fetch site. | `application/market/submitAnalysis.ts` |
| `peekAnalysisCache(symbol, timeframe, fmpSymbol?, modelId?)` — **read-only**. Reads the same `buildAnalysisCacheKey` the writer uses and the same `normalizeCachedAnalysisResponse` validate path; never enqueues/fetches/generates. Returns `Promise<AnalysisResponse \| null>` (null on miss / no provider / read error / corrupt or content-free payload). For SSR/bot surfacing at zero LLM cost. | `application/market/peekAnalysisCache.ts` |
| `pollAnalysis` | `application/market/pollAnalysis.ts` |
| `cancelAnalysisJob` | `application/market/cancelAnalysisJob.ts` |
| `fetchBarsWithIndicators(provider, symbol, timeframe, ...)` — `provider: MarketDataProvider` is now the first positional argument. **BREAKING**: existing callers must add the provider argument. | `application/market/barsApi.ts` |
| `submitBriefing` | `application/market/submitBriefing.ts` |
| `peekBriefingCache(data, modelId?)` — **read-only**. Reads the same `buildBriefingCacheKey` the writer uses and the same `normalizeMarketBriefing` validate path; never enqueues/dispatches/generates. Returns `Promise<MarketBriefingResponse \| null>` (null on miss / no provider / read error / corrupt payload). For SSR/bot surfacing at zero LLM cost. | `application/market/peekBriefingCache.ts` |
| `pollBriefing` | `application/market/pollBriefing.ts` |
| `getMarketSummary(provider, ...)` — `provider: MarketDataProvider` is now the first positional argument. **BREAKING**: existing callers must add the provider argument. | `application/dashboard/getMarketSummary.ts` |
| `getSectorSignals(provider, ...)` — `provider: MarketDataProvider` is now the first positional argument. **BREAKING**: existing callers must add the provider argument. | `application/dashboard/sectorSignals.ts` |
| `checkAnalysisLimit` | `application/usage/limits.ts` |
| `checkChatbotLimit` | `application/usage/limits.ts` |
| `requestChatCompletion` | `application/chat/requestChatCompletion.ts` |
| `submitFundamentalAnalysis` | `application/fundamental/submitFundamentalAnalysis.ts` |
| `pollFundamentalAnalysis` | `application/fundamental/pollFundamentalAnalysis.ts` |
| `cancelFundamentalAnalysisJob` | `application/fundamental/cancelFundamentalAnalysisJob.ts` |
| `submitNewsAnalysis` | `application/news/submitNewsAnalysis.ts` |
| `pollNewsAnalysis` | `application/news/pollNewsAnalysis.ts` |
| `cancelNewsAnalysisJob` | `application/news/cancelNewsAnalysisJob.ts` |
| `submitNewsCardAnalysis` | `application/news/submitNewsCardAnalysis.ts` |
| `pollNewsCardAnalysis` | `application/news/pollNewsCardAnalysis.ts` |
| `submitOverallAnalysis(options)` — `options.marketDataProvider?: MarketDataProvider` added (via `OverallDependencyInputs`). Required on cache miss when proceeding to fetch daily bars for the fear/greed snapshot; optional when `skipEnqueueIfMiss: true`. | `application/overall/submitOverallAnalysis.ts` |
| `peekOverallAnalysisCache(symbol, companyName, timeframe, modelId?)` — **read-only**. Reads a content-free "overwrite-latest" peek key (`pollOverallAnalysis` writes every result under it in addition to the canonical hashed key). Never resolves dependencies / enqueues / fetches / generates. Returns `Promise<OverallAnalysisResponse \| null>` (null on missing `modelId` / miss / no provider / read error / corrupt or content-free payload). "Latest cached" semantics — a content-free read cannot reproduce the canonical input hash. | `application/overall/peekOverallAnalysisCache.ts` |
| `pollOverallAnalysis` — now writes the normalized result under **two** keys: the canonical hashed key (`meta.cacheKey`) and the content-free `buildOverallPeekCacheKey(symbol, timeframe, modelId)` peek key (only when all three meta fields are present). | `application/overall/pollOverallAnalysis.ts` |
| `cancelOverallAnalysisJob` | `application/overall/cancelOverallAnalysisJob.ts` |
| `submitOptionsAnalysis` | `application/options/submitOptionsAnalysis.ts` |
| `pollOptionsAnalysis` | `application/options/pollOptionsAnalysis.ts` |

### Tier 2 — Domain Building Blocks

**통합 계산기/감지기 (3)**
| Symbol | Source |
|---|---|
| `calculateIndicators` | `domain/indicators/index.ts` |
| `detectSignals` | `domain/signals/index.ts` |
| `classifyTrend` | `domain/signals/index.ts` |

**Fear & Greed Index (per-stock) (3)**
| Symbol | Source |
|---|---|
| `computeFearGreedIndex(bars, buySellVolume, options?)` — per-stock Fear & Greed snapshot. Returns `FearGreedSnapshot \| null`. | `domain/indicators/fearGreed/walkForward.ts` |
| `computeFearGreedHistory(bars, buySellVolume, options?)` — walk-forward 1-year score history. Returns `FearGreedHistoryPoint[]`. | `domain/indicators/fearGreed/walkForward.ts` |
| `scoreToLabel(score)` — map a 0..100 score to its 5-stage `FearGreedLabel`, using `FEAR_GREED_LABEL_CUTOFFS`. | `domain/indicators/fearGreed/composition.ts` |

**프롬프트 빌더 (2 + 1 상수)**
| Symbol | Source |
|---|---|
| `buildOptionsAnalysisPrompt` | `domain/options/optionsPrompt.ts` |
| `buildChatPrompt` | `domain/chat/buildChatPrompt.ts` |
| `AI_SYSTEM_PROMPT` | `domain/analysis/systemPrompt.ts` |

**옵션 분석 헬퍼 (4)**
| Symbol | Source |
|---|---|
| `summarizeChainForLlm` | `domain/options/summarizeChainForLlm.ts` |
| `aggregateOpenInterest` | `domain/options/aggregateOpenInterest.ts` |
| `sanitizeOptionsChain` | `domain/options/sanitizeOptionsChain.ts` |
| `mapExpirationsToSlots` | `domain/options/expirationSlots.ts` |

> **@internal (not exported)**: `calculateMaxPain`, `calculatePutCallRatio`, `calculateImpliedMove` — single-purpose calculators consumed only by `summarizeChainForLlm`. Consumers should call `summarizeChainForLlm` (or read derived fields on `OptionsExpirationMetrics`) instead of recomputing. PR6에서 `EXPIRATION_SLOTS` 상수도 `@internal` 전환 — `mapExpirationsToSlots`가 내부 참조(슬롯 타입 `ExpirationSlot`/`ExpirationSlotKey`/`SlotMapping`은 public 유지).

**응답 정규화** — 모든 `normalize*` 함수와 `enrichAnalysisWithConfidence`는 이제 **internal**이다. submit/poll use-case가 LLM 응답 정규화에 내부적으로 사용하며, consumer는 use-case 결과(`*AnalysisResponse`)를 직접 받으므로 정규화 함수를 직접 호출할 필요가 없다.

**티어 게이트 (Tier gating) (12)**
| Symbol | Source |
|---|---|
| `isAllowed` / `getTierLimit` / `getAllowedTimeframes` / `getAllowedModels` | `domain/tier.ts` |
| `isTimeframeAllowed` / `isInfoDepthAllowed` / `isModelAllowed` | `domain/tier.ts` |
| `isPremiumModel` / `isFreeModel` / `requiresByokKey` | `domain/tier.ts` |
| `isTier` | `domain/tier.ts` |
| `TIER_CONFIG` / `DEFAULT_TIER` | `domain/tier.ts` |

**캔들 패턴 (UI/프롬프트에서 사용) (7)**
| Symbol | Source |
|---|---|
| `detectCandlePatternEntries` | `domain/analysis/candle-detection.ts` |
| `getDetectionBars` | `domain/analysis/candle-detection.ts` |
| `selectLastCandlePatternEntries` | `domain/analysis/candle-detection.ts` |
| `getCandlePatternLabel` | `domain/analysis/candle-labels.ts` |
| `getMultiCandlePatternLabel` | `domain/analysis/candle-labels.ts` |
| `getSinglePatternTrend` | `domain/analysis/candle-trend.ts` |
| `getMultiPatternTrend` | `domain/analysis/candle-trend.ts` |

**마켓 레퍼런스 (Market Reference) (1)**
| Symbol | Source |
|---|---|
| `computeMarketReference(bars, indicators, timeframe)` — 결정론적·다호라이즌(short/medium/long lookback) 어드바이저리 레퍼런스를 산출. 호라이즌별 윈도우 크기는 `timeframe`(bar resolution)으로 결정한다. 호라이즌별로 (a) 검증된 레벨(fib 되돌림/확장·Volume Profile POC/VAH/VAL·스윙 고/저·MA/EMA·라운드 넘버), (b) 널리 주시되는 지표 레벨(Supertrend/Ichimoku/Donchian/Bollinger/Keltner/VWAP/표준·Camarilla 피봇·호라이즌 윈도우의 극단 스윙에 앵커링된 Anchored VWAP), (c) 서술적 추세 구조(가격 vs MA60/MA200·EMA 정렬·스윙 구조·ADX·효율비·레짐)를 모은다. **예측이 아니라 어드바이저리** — 정밀한 S/R·추세 예측은 distance-matched random 대비 forward edge가 ~0이라는 백테스트 결과에 따라 레벨은 참고용 컨텍스트로만 노출한다. AI는 이 레벨을 직접 계산하지 않고 선택·해석한다(price-arithmetic hallucination 제거). Returns `MarketReference`. | `domain/analysis/marketReference.ts` |

**대시보드 헬퍼 (3)**
| Symbol | Source |
|---|---|
| `bucketedTimestamp` | `domain/dashboard.ts` |
| `computeStockSignalResult` | `domain/dashboard.ts` |
| `lookbackIsoFromNow` | `domain/dashboard.ts` |

**시장 세션 (Market session) (2)**
| Symbol | Source |
|---|---|
| `isEtRegularSessionOpen(now)` — DST-safe US 정규장(09:30–16:00 ET, 마감 정각 제외) 개장 여부. | `domain/utils.ts` |
| `getEtSessionStatus(now)` — `'weekend' \| 'open' \| 'closed'` 3-state 세션 분류. | `domain/utils.ts` |

> **@internal (not exported)**: `secondsUntilNextEtRegularOpen` — bars 캐시 TTL 계산 전용으로 cache config 내부에서만 사용.

**모델 스펙 헬퍼 (9)** — `getProvider`, `isClaudeModel`, `isGeminiModel`, `isChatGPTModel`, `getThinkingBudgetSequence` (`domain/analysis/modelSpecs.ts`), `isReasoningModelSpec`, `isSamplingModelSpec`, `isClaudeReasoningModelSpec`, `isClaudeSamplingModelSpec` (`domain/types.ts`). `is*ModelSpec` 가드는 `ModelSpec` union을 effort-bearing 변종 또는 sampling 변종으로 좁히는 데 사용한다.

### Tier 3 — Infrastructure Factories & Config

**캐시 (1 factory + 1 helper)**
| Symbol | Source |
|---|---|
| `createCacheProvider` | `infrastructure/cache/redis.ts` |
| `computeBarsEffectiveTtl` | `infrastructure/cache/config.ts` |

> **PR7에서 `@internal` 전환** (도달 불가 + consumer 미사용, 내부 use-case 전용): `ANALYSIS_CACHE_TTL`, `MARKET_BRIEFING_CACHE_TTL`, `CACHE_EXPIRY_HOUR_KST`, `buildAnalysisCacheKey`, `buildBriefingCacheKey`, `buildOptionsCacheKey`, `computeEffectiveTtl`. 캐시 키/TTL은 submit·poll use-case가 내부적으로만 구성한다.

> **@internal (not exported)**: `FUNDAMENTAL_CACHE_TTL_SECONDS`, `NEWS_CACHE_TTL_SECONDS`,
> `OVERALL_CACHE_TTL_SECONDS`, `buildFundamentalCacheKey`,
> `buildNewsCacheKey`, `buildOverallCacheKey` — consumer cannot
> construct the `inputHash` parameter; these are internal to the submit use-cases.
>
> **Removed in 0.8.0**: `NEWS_CARD_CACHE_TTL_SECONDS`, `buildNewsCardCacheKey` — news-card
> result caching was moved to DB persistence (siglens `analyzedAt` column).

> 티커 관련 캐시 키 — `TICKER_SEARCH_CACHE_TTL`, `ASSET_INFO_CACHE_TTL_WITH_KOREAN`,
> `ASSET_INFO_CACHE_TTL_WITHOUT_KOREAN`, `buildTickerSearchCacheKey`,
> `buildAssetInfoCacheKey`는 Phase 4에서 siglens로 이전 완료.

**채팅 토큰 저장소 (1 factory + 1 helper)**
| Symbol | Source |
|---|---|
| `createChatTokenStore` | `infrastructure/chat/tokenStore.ts` |
| `hashClientIp` | `infrastructure/chat/tokenStore.ts` |

> **PR7에서 `@internal` 전환** (consumer 미사용, tokenStore 내부 전용): `CHAT_TOKEN_LIMIT`, `CHAT_TOKEN_TTL_SEC`.

**시장 데이터**

> **Market provider ejection**: `createMarketDataProvider` is **removed** from
> the public API (was Tier 3). The consumer (siglens app) now owns the market
> data adapter entirely and injects it via the `provider: MarketDataProvider`
> parameter on each call site. Core retains only the `MarketDataProvider` port
> interface (Tier 4) and the `MarketDataProviderType` internal discriminant
> (not exported). No Tier 3 market factory symbols remain in core.

**Skills**

> **PR7에서 public 표면 전부 제거** (`@internal` 전환, 도달 불가 + consumer 미사용): `createSkillsProvider`, `FileSkillsLoader` (factory/loader), 그리고 port `SkillsProvider`. 분석 use-case가 내부적으로 `createSkillsProvider()`를 호출하므로 외부 주입 표면이 필요 없다.

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

**Job queue (worker용) (1)**
| Symbol | Source |
|---|---|
| `cancelJob` | `infrastructure/jobs/queue.ts` |

> **PR7에서 `@internal` 전환** (도달 불가 + consumer 미사용, 워커 내부 전용): `getJobMeta`/`setJobMeta`, `getJobStatus`/`setJobStatus`, `getJobResult`/`setJobResult`, `getJobError`/`setJobError`, `isJobCancelled`, `cleanupJob`, 그리고 그 시그니처 타입 `JobMeta`/`JobStatus`. 공개로 남는 `cancelJob(jobId: string)`은 이들을 재노출하지 않는다.

**쿨다운 (3)**
| Symbol | Source |
|---|---|
| `tryAcquireReanalyzeCooldown` | `infrastructure/market/reanalyzeCooldown.ts` |
| `releaseReanalyzeCooldown` | `infrastructure/market/reanalyzeCooldown.ts` |
| `getReanalyzeCooldownMs` | `infrastructure/market/reanalyzeCooldown.ts` |

### Tier 4 — Types & Constants

**도메인 타입** (대시보드/지표/신호/분석/캔들/추세선/티어 설정 타입 일체 + 펀더멘털/뉴스/종합 분석 타입) — `domain/types.ts`에서 일괄 export. (티커 타입은 Phase 4에서 siglens로 이전)

새로 추가된 도메인 타입:
- `CurrentAnalysisContext` — 챗봇 시스템 프롬프트에 주입되는 현재 분석 컨텍스트 tagged union (Task 1.17).
- 펀더멘털: `FundamentalAnalysisResponse`, `FundamentalCategoryAssessment`, `FundamentalCategory`, `FundamentalSentiment`, `FundamentalProfile`, `GradesEvent`, `GradesAction`. (PR6에서 `@internal` 전환 — 정규화 입력 타입 `FundamentalSnapshot`과 그 하위 `FundamentalValuation`/`FundamentalPeer`/`FundamentalProfitability`/`FundamentalGrowth`/`FundamentalHealth`/`FundamentalFutureDirection`/`FundamentalSectorDirection`/`SectorHistoricalPoint`/`GradesConsensus`/`PriceTargetConsensus`/`PriceTargetSummary`는 public 타입에서 도달 불가하고 consumer 미사용이라 internal화. public 응답 타입 `FundamentalAnalysisResponse`는 유지.)
- 뉴스: `NewsAnalysisResponse`, `NewsCardAnalysis`, `NewsCategory`, `NewsItem`, `NewsSentiment`, `EnrichedNewsItem`, `EarningsCalendarItem`, `EarningsReport`.
- 종합: `OverallAnalysisResponse`, `OverallScenario`, `OverallScenarioName`.
- Fear & Greed Index (per-stock):
    - `FearGreedLabel`, `FearGreedConfidence`, `FearGreedWarning`
    - `FearGreedFactorKey`, `FearGreedGroupName`
    - `FearGreedFactor`, `FearGreedGroup`
    - `FearGreedSnapshot`, `FearGreedHistoryPoint`
    - `ComputeFearGreedOptions`
- 마켓 레퍼런스 (`computeMarketReference`의 반환/요소 타입, `domain/types.ts`):
    - `MarketReference` (`{ short, medium, long }` — 각 `HorizonReference`), `HorizonReference` (`{ window, levels, structure }`), `HorizonWindow` (`bars`/`fromTime`/`toTime` — 호라이즌 lookback 윈도우), `HorizonKey` (`'short'` | `'medium'` | `'long'`).
    - `ReferenceLevels` (`{ support, resistance }` — 현재가 기준 side 분리, nearest-first), `ReferenceLevel` (price/label/kind/distancePercent), `ReferenceLevelKind` (레벨 출처 union — fib/VP/swing/MA/EMA/round/pivot/ichimoku/donchian/bollinger/keltner/supertrend/vwap/avwap; 컨빅션 랭크가 아닌 서술 라벨). `'avwap'`는 호라이즌 윈도우의 극단 스윙(최고가 스윙 고/최저가 스윙 저)에 앵커링한 Anchored VWAP 레벨. 앵커 계산 헬퍼 `anchoredVwap`는 `@internal`로 **public 미노출**.
    - `TrendStructure` (priceVsMA60/priceVsMA200/emaStack/swingStructure/adx/efficiencyRatio/regime — 서술적 추세 구조, 방향 예측 아님), `PriceVsLevel` (`'above'` | `'below'` | `'unknown'`), `EmaStackState` (`'aligned_up'` | `'aligned_down'` | `'mixed'`), `SwingStructureState` (`'HH_HL'` | `'LH_LL'` | `'mixed'`), `MarketRegime` (`'trending'` | `'ranging'`).
- 피봇/피보나치 레벨 (`StandardPivotLevels`/`CamarillaPivotLevels`/`FibonacciProjection`/`FibonacciLevel`/`SwingLegDirection`)은 **public 미노출** — `@internal` 헬퍼(`computeStandardPivot`/`computeCamarillaPivot`/`computeFibonacciProjection`)의 반환/요소 타입일 뿐 `computeMarketReference` 반환 closure에서 도달 불가하며 consumer(siglens/siglens-worker/siglens-trader) 미사용이므로 index 재export에서 제거. `domain/types.ts`에는 도메인 내부 공유용으로 `@internal` 태그를 달고 유지한다.
- 스킬 게이팅 (`Skill.gating`의 transitive closure, `domain/types.ts`):
    - `SkillGating` — 스킬을 차트 프롬프트에 주입할지 제어하는 frontmatter 게이팅 메타데이터. `tier`(그 다음 gated 암에서 `signalKind`)로 분기하는 discriminated union (`{ tier: 'always_on' }` | `{ tier: 'gated'; signalKind: 'event'; triggers }` | `{ tier: 'gated'; signalKind: 'state'; state }`). `signalKind`는 인라인 리터럴(`'event'`/`'state'`)이라 `SignalKind` 타입을 참조하지 않는다.
    - `SkillStatePredicate` (`{ feature, predicate, hi?, lo? }` — textbook *state* 게이팅 술어), `SkillStateFeature` (`SkillStatePredicate.feature` union — 검사 대상 지표 피처: `bollinger`/`keltner`/`williamsR`/`stochastic`/`stochRsi`/`donchian`/`vwap`/`buySellVolume`), `SkillStatePredicateKind` (`SkillStatePredicate.predicate` union — 비교 방식: `pctB`/`bandDistAtr`/`level`/`ratio`/`channelProximity`).
    - `SignalKind` (`'event'` | `'state'`)는 **public 미노출** — `SkillGating`이 인라인 `signalKind` 리터럴로 discriminate하므로 public transitive closure에서 도달 불가. 로더의 frontmatter 검증(`SIGNAL_KINDS`)에서만 참조되어 `@internal` 태그로 `domain/types.ts`에 유지한다.

새로 추가된 Provider 인터페이스:
- `FundamentalDataProvider` — `domain/ports/fundamentalDataProvider.ts`. Core가 의존하는 추상 펀더멘털 데이터 fetcher 인터페이스 (siglens가 FMP로 구현).
- `NewsProvider` — `domain/ports/newsProvider.ts`. 뉴스 + 실적 캘린더 fetcher 인터페이스. **PR7에서 `@internal` 전환** — 유지 public에서 도달 불가, consumer 미사용.
- `NewsTimeRange` — `domain/ports/newsProvider.ts`. 뉴스 조회 기간 union (`'24h'` | `'7d'` | `'30d'`). **public 유지** — consumer(siglens, siglens-trader)가 자체 뉴스 fetch 어댑터의 `range` 인자를 이 union으로 타이핑한다(PR7에서 일시 `@internal`했으나 consumer typecheck 검증에서 breakage가 발견되어 복원). 부모 port `NewsProvider`는 consumer가 이름으로 import하지 않으므로 `@internal` 유지.
- `OptionsDataProvider` — `domain/ports/optionsDataProvider.ts`. 옵션 시세 fetcher 추상화 인터페이스 (siglens가 Yahoo Finance로 구현). `fetchSnapshot`, `hasOptionsMarket` 두 메서드.

새로 추가된 use-case option/result 타입:
- 펀더멘털: `SubmitFundamentalAnalysisOptions`, `SubmitFundamentalAnalysisResult`, `SubmitFundamentalAnalysisApiKeyRequiredError`, `SubmitFundamentalAnalysisMissNoTrigger`, `PollFundamentalAnalysisResult`.
- 뉴스: `SubmitNewsAnalysisOptions`, `SubmitNewsAnalysisResult`, `SubmitNewsAnalysisApiKeyRequiredError`, `SubmitNewsAnalysisMissNoTrigger`, `PollNewsAnalysisResult`.
- 종합: `SubmitOverallAnalysisOptions`, `SubmitOverallAnalysisResult`, `SubmitOverallAnalysisApiKeyRequiredError`, `SubmitOverallAnalysisMissNoTrigger`, `DependencyStateMissNoTrigger`, `PollOverallAnalysisResult`.
- 기술적: `SubmitAnalysisMissNoTrigger` — 0.10.0에서 추가된 봇/크롤러 게이팅용 결과 variant.
- 옵션: `SubmitOptionsAnalysisOptions`, `SubmitOptionsAnalysisResult`, `SubmitOptionsAnalysisCached`, `SubmitOptionsAnalysisSubmitted`, `SubmitOptionsAnalysisMissNoTrigger`, `SubmitOptionsAnalysisLimitError`, `SubmitOptionsAnalysisNoChainsError`, `SubmitOptionsAnalysisApiKeyRequiredError`, `PollOptionsAnalysisResult`, `PollOptionsAnalysisProcessing`, `PollOptionsAnalysisDone`, `PollOptionsAnalysisError`. 도메인 타입(`OptionsContract`, `OptionsChain`, `OptionsSnapshot`, `StrikeOpenInterest`, `StrikeVolumeAggregate`, `TopOiQuote`, `OptionsExpirationMetrics`, `OptionsPerExpirationCommentary`, `OptionsSignal`, `OptionsAnalysisResponse`, `OptionsTone`, `OptionsSignalKind`, `OptionsExpirationFilter`)과 슬롯 매핑(`ExpirationSlot`, `ExpirationSlotKey`, `SlotMapping`), 프롬프트 옵션(`BuildOptionsAnalysisPromptOptions`) 포함.

**인터페이스** — `CacheProvider`, `ChatTokenStore`, `FmpConfig`, Usage repository 인터페이스(`UsageRepository`, `UsageLogRepository`), 관련 record/input 타입(`RecordUsageInput`, `CreateUsageLogInput`, `UsageLogRecord`, `UsageCounts`), enum union 타입(`UsageActionType`, `UserTier`), AI provider 포트 타입(`CallAiProvider`, `CallAiProviderOptions`, `AiContents`, `ConversationRole`, `ConversationTurn` — 모두 `domain/ports/aiProvider.ts`), tier 관련 타입(`Tier*`, `ModelId`, `UserTierContext`), usage limit 타입(`UsageLimit*`, `AnalysisUsageOptions`, `SubmitAnalysisOptions`, `SubmitAnalysisGatedResult`, `SubmitAnalysisErrorResult`, `TierTimeframeAccessError`, `UserApiKeyRequiredError`), `BackgroundTaskOptions`, 채팅 application 타입. (PR7에서 `SkillsProvider`·`JobStatus`·`JobMeta`·`UserTierRepository`는 `@internal` 전환 — 유지 public에서 도달 불가.)

**대시보드 상수** — PR6에서 public 표면 전부 제거. consumer 미사용분(`DASHBOARD_TIMEFRAMES`, `DASHBOARD_TIMEFRAME_LABELS`, `SECTOR_GROUPS`, `SIGNAL_SECTORS`)은 완전 삭제, 내부 use-case가 참조하는 분(`MARKET_INDICES`, `SECTOR_ETFS`, `SECTOR_STOCKS`, `MARKET_SUMMARY_FMP_SYMBOLS`, `DEFAULT_DASHBOARD_TIMEFRAME`)은 `@internal`로 전환(`domain/constants/dashboard-tickers.ts`).

**지표 상수 (consumer 사용분)** — `EMPTY_INDICATOR_RESULT`, `EMPTY_SMC_RESULT`, `RSI_DEFAULT_PERIOD`, `RSI_OVERBOUGHT_LEVEL`, `RSI_OVERSOLD_LEVEL`, `EMA_DEFAULT_PERIODS`, `MA_DEFAULT_PERIODS`, `MACD_FAST_PERIOD`/`MACD_SIGNAL_PERIOD`/`MACD_SLOW_PERIOD`, `CCI_DEFAULT_PERIOD`/`CCI_OVERBOUGHT_LEVEL`/`CCI_OVERSOLD_LEVEL`/`CCI_ZERO_LEVEL`, `DMI_DEFAULT_PERIOD`, `STOCHASTIC_*`/`STOCH_RSI_*`, `HIGH_CONFIDENCE_WEIGHT`, `MIN_CONFIDENCE_WEIGHT` 등 consumer가 실제 사용하는 `constants.ts` 값만 public. 나머지 계산 기본값/임계값(ATR·BOLLINGER·KELTNER·SMC·SQUEEZE·SUPERTREND·VP·ICHIMOKU·PSAR·MFI·CMF·DONCHIAN·EMA_SUPPORT_RESISTANCE·WILLIAMS 등)은 internal.

**Fear & Greed 상수** — `FEAR_GREED_LABEL_CUTOFFS` (5단계 분류 경계 25/45/55/75), `POC_WINDOW_DEFAULT` (= 60, POC 거리 팩터 기본 창) (`domain/indicators/fearGreed/`). siglens 게이지 세그먼트 렌더링·점수→라벨 분류에서 사용.

**티어 제한 상수** — `DEFAULT_TIER`, `TIER_CONFIG` (`domain/tier.ts`).

**시장 세션 상수/타입** — `MARKET_OPEN_HOUR`, `MARKET_OPEN_MINUTE`, `MARKET_CLOSE_HOUR`, `MARKET_CLOSE_MINUTE` (`domain/utils.ts`), `EtSessionStatus` (`domain/types.ts`). US 정규장 개장/마감 시각(ET) 상수와 세션 상태 union. siglens 옵션 UI·캐시·분석 게이팅에서 사용.

**모델 스펙 (단일 source of truth)** — `MODEL_SPECS`, `DISABLED_THINKING_BUDGET`, `ModelSpec`, `ClaudeSamplingModelSpec`, `ClaudeReasoningModelSpec`, `GeminiModelSpec`, `ChatGPTModelSpec`, `EffortLevel`, `AIProvider`, `ActiveModelId`, `ClaudeModelId`, `GeminiModelId`, `ChatGPTModelId` (`domain/analysis/modelSpecs.ts`, types in `domain/types.ts`). AI SDK 호출자(워커, 서버 액션, UI)가 직접 lookup하는 단일 source of truth — provider 라우팅, max output tokens, thinking budget(`ClaudeSamplingModelSpec` / `GeminiModelSpec`) 또는 reasoning effort(`ClaudeReasoningModelSpec` / `ChatGPTModelSpec`), sampling 파라미터를 모델 식별자(`ActiveModelId`) 별로 보관한다. `EffortLevel` (`'low' | 'medium' | 'high'`)은 reasoning 변종에서 effort 필드 타입으로 사용된다. provider-specific subset 타입(`ClaudeModelId` 등)은 `is*Model` 타입 predicate가 narrowing할 때 노출된다. spec 변종 narrowing은 `is*ModelSpec` 가드(Tier 2)를 사용한다. 새 모델 추가는 이 맵에 한 줄 추가 + core publish로 끝난다.

**고급 도메인 헬퍼** — key-level 클러스터링(`clusterKeyLevels`/`validateKeyLevels`)과 action recommendation 검증(`validateActionPrices`/`extractReconciledActionLines`)은 consumer의 세부 검증 흐름을 위해 `src/index.ts`에서 명시적으로 export한다. 그 외 정규화 함수(`normalize*`/`asString`/`asArray`/`compact`)·AI 레벨 보정·추세선·candle 라벨/감지 상수·프롬프트 빌더·개별 신호 감지기는 모두 internal(공개 aggregate·use-case가 내부 호출).

전체 타입 목록은 `src/domain/types.ts`와 `src/index.ts`의 `export type {...}` 블록을 참고한다.

### Internal (export 하지 않음)

다음 함수/상수는 다른 public 함수의 보조 구현이며, **`src/index.ts`에서 export하지 않고** 정의부에 `/** @internal */` 태그를 붙인다.

**개별 지표 계산기** — `calculateRSI`, `calculateMA`, `calculateMACD`, `calculateBollinger`, `calculateStochastic`, `calculateATR`, `calculateOBV`, `calculateSAR`, `calculateWilliamsR`, `calculateSupertrend`, `calculateMFI`, `calculateKeltner`, `calculateCMF`, `calculateDonchian`, `calculateVWAP`, `calculateEMA`, `calculateSMC`, `calculateSqueezeMomentum`, `calculateIchimoku`, `calculateCCI`, `calculateDMI` 등 개별 계산기는 internal — 공개 aggregate `calculateIndicators()` (Tier 2)로 통합 호출한다. (`calculateIchimokuFutureCloud`는 미래 클라우드 시각화용 별도 public 함수.)

**개별 신호 감지기** — `detectRsiOversold`, `detectRsiOverbought`, `detectGoldenCross`, `detectDeathCross`, `detectMacdBullishCross`, `detectMacdBearishCross`, `detectBollingerLowerBounce`, `detectBollingerUpperBreakout`, `detectSupertrendBullishFlip`, `detectIchimokuCloudBreakout`, `detectCciBullishCross`, `detectDmiBullishCross`, `detectCmfBullishFlip`, `detectMfiOversoldBounce`, `detectParabolicSarFlip`, `detectKeltnerUpperBreakout`, `detectSqueezeMomentumBullish`, `detectRsiBullishDivergence`, `detectRsiBearishDivergence`, `detectMacdHistogramBullishConvergence`, `detectMacdHistogramBearishConvergence`, `detectBollingerSqueezeBullish`, `detectBollingerSqueezeBearish`, `detectSupportProximityBullish`, `detectResistanceProximityBearish` → `detectSignals()`로 통합 호출.

**신호 헬퍼** — `findCross`, `findThresholdCross`, `findPivotLows`, `findPivotHighs`, `computeBbWidth`, `computePctB`, `computeEmaSlope`, `percentileRank`.

**캔들 패턴 (internal)** — `detectCandlePattern`, `detectMultiCandlePattern`, `findCandlePatternLabel`, `CANDLE_PATTERN_LABELS`, `MULTI_CANDLE_PATTERN_LABELS`, `CANDLE_PATTERN_DETECTION_BARS`, `EXCLUDED_SINGLE_PATTERNS` → UI/프롬프트는 살아있는 `getCandlePatternLabel`/`getMultiCandlePatternLabel`/`detectCandlePatternEntries` 등(Tier 2)을 사용.

**프롬프트 빌더 (internal)** — `buildAnalysisPrompt`, `buildFundamentalAnalysisPrompt`, `buildMarketBriefingPrompt`, `buildNewsAnalysisPrompt`, `buildNewsCardAnalysisPrompt`, `buildOverallAnalysisPrompt` → submit use-case가 내부 호출. (`buildOptionsAnalysisPrompt`/`buildChatPrompt`는 아직 public.)

**정규화 헬퍼 (internal)** — `asNumber`, `asBoolean`, `asEnum`, `asOptionalEnum`, `asObject`, `asString`, `asArray`, `compact`, `enrichAnalysisWithConfidence` 및 모든 `normalize*` 함수(`normalizeTrend`/`normalizeRiskLevel`/`normalizeKeyLevels`/`normalizePriceTargets`/`normalizeIndicatorGuideResult`/`normalizeKeyLevel`/`normalizePriceTarget`/`normalizePriceScenario`/`normalizeSignal`/`normalizeKeyPrice`/`normalizeTrendlinePoint`/`normalizePatternLine`/`normalizeTimeRange`/`normalizeActionRecommendation`/`normalizeCandlePatternSummary`/`normalizePatternSummary`/`normalizeStrategyResult`/`normalizeTrendline` + `normalize*AnalysisResponse`/`normalizeFundamentalSnapshot`/`normalizeMarketBriefing`). submit/poll use-case가 LLM 응답 정규화에 내부 사용.

**액션/리스크 유틸 (internal)** — `isValidBullishStopLoss`, `isValidBullishTakeProfit`, `deriveFallbackStopLoss`, `deriveFallbackTakeProfit`, `resolveBullishStopLoss`, `resolveBullishTakeProfit`, `buildBullishExitText`, `buildBullishRiskRewardText`, `reconcileBullishActionRecommendation`, `postProcessAnalysisWithReconcile`, `extendTrendline`, `filterAnalysisResult`. (`validateActionPrices`/`extractReconciledActionLines`/`clusterKeyLevels`/`validateKeyLevels`는 public — '고급 도메인 헬퍼' 참조.)

**내부 디테일 상수** — `ISO_DATE_HOUR_PREFIX_LENGTH`, `ISO_DATE_PREFIX_LENGTH`, `PROMPT_CONFIG_BY_TIMEFRAME`, `MULTI_CANDLE_PATTERN_BUFFER` — 모두 public 함수의 동작 디테일이며 consumer가 직접 다루지 않는다.

**외부 LLM 응답 스키마** — `RawAnalysisResponse`. AI worker가 반환하는 원시 응답 구조이며, 외부 LLM 스키마에 직접 결합된다. consumer에 노출하면 LLM 변경 시 호환성이 깨지므로 internal로 유지한다. `enrichAnalysisWithConfidence`는 외부 경계에서 `unknown`을 받아 내부적으로 이 타입으로 cast한다.

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

`0.x.y` 단계에서는 minor를 major로, patch를 minor로 격상해 적용한다(SemVer 0.x 관행).

---

## Internal 함수 사용 금지

Consumer 프로젝트는 `@y0ngha/siglens-core`의 **default export** 또는 **named export of `src/index.ts`**만 사용해야 한다. 다음은 모두 금지한다.

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

단계 2(별도 PR)에서 TypeDoc을 도입한다. `typedoc.json`은 다음을 보장한다.

- `entryPoints`: `src/index.ts`만.
- `excludeInternal: true` — `@internal` 태그가 붙은 심볼은 자동으로 docs에서 제외.
- `excludePrivate: true` — 클래스의 `private` 멤버 제외.

생성된 문서에는 Tier 1~4의 public 함수와 타입만 나타난다. internal 함수는 grep으로만 찾을 수 있고, 자동 문서에서는 보이지 않는다.

---

## 개정 이력

| 일자 | 변경 |
|---|---|
| 2026-04-26 | 최초 작성 — Tier 정의, 인벤토리, 워크플로우, 버전 정책. |
| 2026-05-02 | Phase 0~6 완료. 인증/OAuth/이메일/문의/BYOK/Tier CRUD/한국어 티커/Drizzle·Neon DB/Gemini SDK 어댑터가 모두 siglens로 이전됨. core는 분석 도메인 + 분석 직결 infrastructure + Skills + 추상 repository 인터페이스만 보유. |
| 2026-05-02 | Task 1.17~1.18: 펀더멘털/뉴스/종합 분석 use-case 12종 + 프롬프트 빌더 4종 + 정규화 함수 5종 + 캐시 키/TTL 7종 + Provider 인터페이스 2종 + 도메인 타입 30여종 public export 추가. `buildChatPrompt`에 `currentAnalysisContext` 파라미터 추가 (`CurrentAnalysisContext` tagged union). |
| 2026-05-07 | Tier 2/4 추가 — `computeFearGreedIndex`, `computeFearGreedHistory` (per-stock Fear & Greed Index) 및 관련 도메인 타입 10종(`FearGreedLabel`, `FearGreedConfidence`, `FearGreedWarning`, `FearGreedFactorKey`, `FearGreedGroupName`, `FearGreedFactor`, `FearGreedGroup`, `FearGreedSnapshot`, `FearGreedHistoryPoint`, `ComputeFearGreedOptions`)을 Tier 2/4 인벤토리에 등록. |
| 2026-05-15 | Options analysis 도메인 추가 — Tier 1 use-cases (`submitOptionsAnalysis`, `pollOptionsAnalysis`, `buildOptionsCacheKey`), Tier 2 헬퍼/프롬프트 (`summarizeChainForLlm`, `aggregateOpenInterest`, `sanitizeOptionsChain`, `mapExpirationsToSlots`, `buildOptionsAnalysisPrompt`, `normalizeOptionsAnalysisResponse`, `EXPIRATION_SLOTS`), Tier 3 Provider 인터페이스 (`OptionsDataProvider`), Tier 4 타입(도메인 11종 + 슬롯 2종 + use-case option/result 9종)을 인벤토리에 등록. `calculateMaxPain` / `calculatePutCallRatio` / `calculateImpliedMove`는 `@internal`. |
| 2026-05-22 | Tier 4 `ExpirationSlot` 인터페이스에 선택적 `maxDays?: number` 필드 추가. Tier 4 `ExpirationSlotKey` 유니온이 `'0D' \| '1W' \| '2W' \| '1M' \| '2M' \| '3M' \| '6M'`로 확장(이번 주 만기 위클리 옵션용 0DTE 슬롯). 0.x semver에서 minor bump 대상이며, `ExpirationSlotKey`에 exhaustive switch를 쓰는 소비자는 `'0D'` 케이스를 추가해야 한다. `ZERO_DTE_MAX_DAYS`(`= 6`)는 `domain/options/expirationSlots.ts` 모듈 내부 상수로만 노출(공개 export 아님). `hashOptionsInput`이 캐시 키 입력에서 `underlyingPrice`/`capturedAt`/per-strike OI 합계를 제거해 구조적 식별자(symbol + expirationDate + 만기별 chain length)만 hash — 24h TTL 내 cache hit률 회복. 공개 시그니처 변경은 없다(내부 cache-key 동작만 변경). |
| 2026-05-22 | Tier 4 `StrikeVolumeAggregate`, `TopOiQuote` 신규 타입을 인벤토리에 등록. `OptionsExpirationMetrics`에 `topVolumeStrikes: ReadonlyArray<StrikeVolumeAggregate>`와 `topOiBidAskSummary: ReadonlyArray<TopOiQuote>` 두 필드 추가(additive — 기존 필드 변경 없음, 0.x semver minor bump). 신규 `aggregateVolume` 헬퍼는 내부 모듈로만 노출되며 `summarizeChainForLlm`이 사용. `buildOptionsAnalysisPrompt`의 `== 해석 가이드 ==` 섹션에 두 줄 추가(`topVolumeStrikes`, `topOiBidAskSummary` 해설). Tier 4 `CurrentAnalysisContext` 유니온이 `\| { kind: 'options'; payload: OptionsAnalysisResponse }` variant를 추가해 확장 — 0.x semver minor bump이지만, `CurrentAnalysisContext.kind`에 exhaustive switch를 쓰는 소비자는 `'options'` 케이스를 추가해야 컴파일된다. `buildChatPrompt`의 `formatCurrentAnalysisContext` switch에 `'options'` 분기 추가(symbol-level summary + per-expiration commentary + signals + analyzedAt을 plain `Key: Value` 라인으로 합류). |
| 2026-05-22 | AI provider 포트가 `infrastructure/ai/types.ts` → `domain/ports/aiProvider.ts`로 이전. Tier 4 신규 export(`CallAiProvider` 함수 타입 별칭 — adapters가 직접 구현하는 canonical signature, `ConversationRole`, `ConversationTurn`). 기존 `CallAiProviderOptions`, `AiContents` export는 새 경로(`domain/ports/aiProvider.ts`)에서 재노출되며 호환됨. `AiContents`가 provider-neutral 형태로 재정의됨(`string \| ConversationTurn[]`) — Gemini SDK 스키마 타입(`GeminiRole`, `GeminiPart`, `GeminiContent`)은 도메인에서 제거되어 더 이상 export되지 않는다. `RequestChatCompletionDependencies.callAiProvider` 필드 타입이 인라인 시그니처에서 `CallAiProvider` 별칭 사용으로 전환(MISTAKES.md TypeScript #5 준수). consumer adapters는 `ConversationTurn[]`을 받아 자신의 upstream SDK 스키마(예: Gemini `contents`)로 변환해야 한다. 0.x semver minor bump(BREAKING for adapters — 기존 어댑터가 `GeminiContent[]`를 직접 받았다면 `ConversationTurn[]` → Gemini 스키마 매핑 로직을 추가해야 한다). |
| 2026-05-22 | Market 모듈 domain/ports 마이그레이션 (PR #97). Tier 4 `MarketDataProvider`와 `GetBarsOptions`의 source가 `infrastructure/market/types.ts` → `domain/ports/marketDataProvider.ts`로 이동(port/adapter 분리). `src/index.ts`/`src/index.client.ts`의 `export type` 경로만 갱신되며 공개 시그니처/필드 변경은 없다. `MarketDataProviderType = 'alpaca' \| 'fmp'`는 `MARKET_DATA_PROVIDER` env var로 제어되는 내부 디스패치 식별자이므로 공개 export 하지 않고 `@internal`로 유지(MISTAKES.md §Public API #6.5 — consumer가 import할 필요가 없는 internal 심볼). `createMarketDataProvider`의 반환 타입은 그대로 `MarketDataProvider`. |
| 2026-05-28 | **Market provider ejection (PR #104)**. Tier 3 `createMarketDataProvider` export **제거** — consumer(siglens)가 자체 FMP/Alpaca 어댑터를 소유. Tier 1 시그니처 변경: `fetchBarsWithIndicators`, `getMarketSummary`, `getMarketSummaryWithBriefing`, `getSectorSignals`의 첫 번째 positional 인자가 `provider: MarketDataProvider`로 추가됨(BREAKING). `submitAnalysis`의 `options.marketDataProvider?: MarketDataProvider`와 `submitOverallAnalysis`의 `options.marketDataProvider?: MarketDataProvider`(via `OverallDependencyInputs`) 선택적 필드 추가 — cache miss 경로에서 필수; `skipEnqueueIfMiss: true`일 때만 생략 가능. |
| 2026-05-28 | Tier 2/4 Market session 추가 — `isEtRegularSessionOpen`(기존 `@internal` 제거 후 public화), `getEtSessionStatus`(`'weekend' \| 'open' \| 'closed'` 3-state, 신규) 및 Tier 4 상수 `MARKET_OPEN_HOUR`/`MARKET_OPEN_MINUTE`/`MARKET_CLOSE_HOUR`/`MARKET_CLOSE_MINUTE`와 `EtSessionStatus` union을 인벤토리에 등록. DST-safe(`Intl.DateTimeFormat('America/New_York')`), 마감 정각 16:00은 `'open'`에서 제외(exclusive). siglens가 자체 `shared/lib/marketSession.ts`의 정규장 판정을 제거하고 이 심볼을 import하도록 통합하기 위한 단일 source of truth. `secondsUntilNextEtRegularOpen`은 bars 캐시 TTL 전용이라 `@internal` 유지. 0.x semver minor bump. |
| 2026-05-29 | Tier 2/4 Fear & Greed 분류 상수 공개 — `scoreToLabel`(기존 `@internal` 제거 후 public화, 0..100 score → 5단계 `FearGreedLabel`) 및 Tier 4 상수 `FEAR_GREED_LABEL_CUTOFFS`(경계 25/45/55/75), `POC_WINDOW_DEFAULT`(= 60)를 인벤토리에 등록. siglens가 자체 `entities/fear-greed/lib/classifier.ts`의 복제 분류 로직(`FEAR_GREED_SCORE_BOUNDARIES`/`classifyScore`)을 제거하고 이 심볼을 import하도록 통합하기 위한 단일 source of truth — `computeFearGreedIndex`가 반환하는 최상위 label로는 그룹 점수·history fallback 분류를 커버하지 못해 별도 노출 필요. `FEAR_GREED_WARNING_THRESHOLDS`/`FEAR_GREED_CONFIDENCE_THRESHOLDS`는 consumer 수요가 없어 `@internal` 유지. 함께 `infrastructure/fundamental/types.ts`(미export·미사용 FMP raw payload 타입, fundamental→domain/ports 이전 시 잔존한 고아 파일) 삭제 — 공개 API 영향 없음. 0.x semver minor bump. |
| 2026-05-29 | **Dead-code 정리 시리즈 시작 (PR1~2).** PR1(`refactor: dedup & relocate`): 내부 dead 헬퍼(JSON-fence 파서 `parseJsonResponse`/`stripMarkdownCodeBlock`, `addSeconds`) 삭제, 매직넘버(`1000`/`10`/`MS_PER_DAY`)를 canonical 상수로 통합, `buildOptionsCacheKey`를 `application/options/cacheKey.ts` → `infrastructure/cache/config.ts`로 이전(형제 cache-key 빌더와 병치, 공개 export 시그니처·경로 불변). PR2(`refactor: drop deprecated Gemini aliases`): 폐기 type alias `GeminiRole`/`GeminiPart`/`GeminiContent`를 `src/index.ts`/`src/index.client.ts`에서 **최종 제거**(2026-05-22 provider-neutral rename 후 호환용으로 남겨둔 별칭 — 3개 컨슈머 모두 미사용 확인). 신규 코드는 `ConversationRole`/`ConversationTurn` 사용. 0.x semver minor bump. |
| 2026-05-29 | **Dead-export 정리 PR3 (PR #111, 트래킹 이슈 #110).** `src/index.ts`/`src/index.client.ts`에서 미사용 indicators surface 제거 — 개별 계산기 `calculate*` 24종(`calculateATR`~`calculateWilliamsR`) + barrel 유틸(`computeEMAValues`/`lastNonNull`/`linreg`/`rollingHighest`/`rollingLowest`/`slidingMax`/`slidingMin`/`sma`/`stdDev`/`typicalPrice`) + 지표 상수 36종(ATR·BOLLINGER·KELTNER·SMC·SQUEEZE·SUPERTREND·VP·ICHIMOKU·PSAR·MFI·CMF·DONCHIAN·EMA_SUPPORT_RESISTANCE·WILLIAMS 등) export 제거 + 정의부에 `@internal` 태그 추가(MISTAKES.md #9.5/#9.6). **aggregate `calculateIndicators()`는 MISTAKES.md Architecture #6에 따라 public Tier 2 entry point로 유지** — 개별 계산기 구현은 이것이 내부 호출하여 보존. `calculateIchimokuFutureCloud`·`computeFearGreedIndex`/`computeFearGreedHistory`·`FEAR_GREED_LABEL_CUTOFFS`·`POC_WINDOW_DEFAULT`·`scoreToLabel` 및 consumer 사용 상수(RSI/MACD/STOCHASTIC/STOCH_RSI/CCI/DMI/EMA_DEFAULT/MA_DEFAULT/EMPTY_*/CONFIDENCE_WEIGHT)는 public 유지. 0.x semver minor bump(package.json은 PR2의 0.16.0 유지). |
| 2026-05-29 | **Dead-export 정리 PR4 (트래킹 이슈 #110).** `src/index.ts`/`src/index.client.ts`에서 미사용 signals surface 제거 — 개별 신호 감지기 25종(anticipation 8 + confirmed 17) + 신호 상수 22종(`signals/constants.ts` 전체: CCI/CMF cross level, `GOLDEN_CROSS_*`, `DIVERGENCE_*`, `SQUEEZE_*`, `SR_*`, `TREND_*` 등) export 제거 + 정의부 `@internal` 태그(MISTAKES.md #9.5/#9.6). **aggregate `detectSignals()` / `classifyTrend()`는 Tier 2 public entry point로 유지** — 개별 감지기 구현은 `detectSignals`가 내부 호출하여 보존. 0.x semver minor bump(package.json은 0.16.0 유지). |
| 2026-05-29 | **Dead-export 정리 PR5 (트래킹 이슈 #110).** `domain/analysis/` 미사용 헬퍼 제거 — 프롬프트 빌더 6종(`buildAnalysisPrompt`·`buildFundamentalAnalysisPrompt`·`buildMarketBriefingPrompt`·`buildNewsAnalysisPrompt`·`buildNewsCardAnalysisPrompt`·`buildOverallAnalysisPrompt`), 응답 정규화 전체(`enrichAnalysisWithConfidence` + 모든 `normalize*`: market/fundamental/news/overall/options + action/risk/keyLevels/priceTargets/indicatorGuide/pattern/strategy/candlePattern/trend/trendline), 정규화 프리미티브(`asArray`/`asString`/`compact`), 캔들 `detectCandlePattern`·`detectMultiCandlePattern`·`findCandlePatternLabel`·`CANDLE_PATTERN_DETECTION_BARS`·`CANDLE_PATTERN_LABELS`·`MULTI_CANDLE_PATTERN_LABELS`·`EXCLUDED_SINGLE_PATTERNS`, `extendTrendline`·`postProcessAnalysisWithReconcile`·`filterAnalysisResult` export 제거 + 정의부 `@internal`(22파일/37심볼, MISTAKES.md #9.5/#9.6). 구현은 submit/poll use-case·프롬프트 빌더가 내부 호출하여 보존. 살아있는 candle getter(`getCandlePatternLabel`/`getMultiCandlePatternLabel`/`getSinglePatternTrend`/`getMultiPatternTrend`/`detectCandlePatternEntries`/`getDetectionBars`/`selectLastCandlePatternEntries`)·`clusterKeyLevels`·`validateKeyLevels`·`validateActionPrices`·`extractReconciledActionLines`·`AI_SYSTEM_PROMPT`·`buildOptionsAnalysisPrompt`(options)·`buildChatPrompt`(chat)는 public 유지. 0.x semver minor bump(package.json은 0.16.0 유지). |
| 2026-05-29 | **Dead-export 정리 PR6 (트래킹 이슈 #110).** 도메인/use-case 타입 표면에서 **도달 불가(unreachable) + consumer 미사용** 타입만 제거하고, **public API에서 도달 가능한 타입은 전부 유지**(MISTAKES.md Rule #9 — public 함수의 파라미터/반환 타입과 public 타입의 필드/union/배열/extends 타입은 제거 대상에서 제외). **완전 삭제(dead)**: 타입 `RequestChatCompletionResult`·`FundamentalAnalysisUsageOptions`·`NewsAnalysisUsageOptions`·`SubmitNewsCardAnalysisCached`·`RunAnalysisInput`·`FundamentalProfileInput`·`MarketSummaryWithBriefing`·`SectorGroupDef`(core `SECTOR_GROUPS` 삭제로 고아화 — ⚠️ 단 consumer가 자체 `SECTOR_GROUPS`를 이 타입으로 타이핑하여 후속 fix PR에서 **복원**, 하단 참조), 파일 `domain/llm/constants.ts`(`LLM_PROVIDER_VALUES`), 대시보드 상수 4종(`DASHBOARD_TIMEFRAMES`/`DASHBOARD_TIMEFRAME_LABELS`/`SECTOR_GROUPS`/`SIGNAL_SECTORS`). **Tier 1 `getMarketSummaryWithBriefing` use-case 제거**(consumer 미사용; `getMarketSummary`+`submitBriefing` 직접 조합으로 대체) — 구현·테스트·`MarketSummaryWithBriefing` 반환 타입 삭제. **`@internal` 전환(도달 불가, consumer 미사용)**: 정규화 입력 트리 `FundamentalSnapshot`+하위(`FundamentalValuation`/`FundamentalPeer`/`FundamentalProfitability`/`FundamentalGrowth`/`FundamentalHealth`/`FundamentalFutureDirection`/`FundamentalSectorDirection`/`SectorHistoricalPoint`/`GradesConsensus`/`PriceTargetConsensus`/`PriceTargetSummary`), 리졸버 내부 `DependencyState*`, 마스킹 `Filtered*`, `Raw*`/`Normalize*Input`, `ChatModel`/`LevelSource`/`CrossDirection`/`ResolvedLevel`/`PromptConfig`/`ReconcileResult`/`UsageLimitError`/`UsageLimitErrorCode`, 상수 `THINKING_BUDGET_FALLBACK_STEPS`/`EXPIRATION_SLOTS`/`GEMINI_2_5_PRO_MODEL` 및 대시보드 상수 5종(`MARKET_INDICES`/`SECTOR_ETFS`/`SECTOR_STOCKS`/`MARKET_SUMMARY_FMP_SYMBOLS`/`DEFAULT_DASHBOARD_TIMEFRAME`). 초기 sweep이 reachable한 public 타입 123종(IndicatorResult 하위 결과 타입, `Submit*Result`/`Poll*Result` union 멤버, TierConfig 트리, ModelSpec union 멤버, 옵션 도메인 타입, FearGreed 필드 타입, public 함수 파라미터 타입 등)을 잘못 @internal/제거했으나 GitHub 리뷰 지적으로 전부 main 상태(public)로 복원. `EtSessionStatus` 동일하게 복원. Tier 1 24→23. 0.x semver minor bump(package.json은 0.16.0 유지). |
| 2026-05-29 | **Dead-export 정리 PR7 (트래킹 이슈 #110).** Tier 3 infra 표면에서 **reachability 사전 감사(fixpoint) 통과분만** `@internal` 전환 — 유지되는 public 심볼에서 도달 불가 + consumer 미사용인 27종: 캐시 키/TTL 7종(`ANALYSIS_CACHE_TTL`/`CACHE_EXPIRY_HOUR_KST`/`MARKET_BRIEFING_CACHE_TTL`/`computeEffectiveTtl`/`buildAnalysisCacheKey`/`buildBriefingCacheKey`/`buildOptionsCacheKey`), 채팅 토큰 상수 2종(`CHAT_TOKEN_LIMIT`/`CHAT_TOKEN_TTL_SEC`), `extractJsonWithRepair`, Skills(`createSkillsProvider`/`FileSkillsLoader`/port `SkillsProvider`), ports `NewsProvider`/`UserTierRepository`(+ `NewsTimeRange` — ⚠️ consumer가 자체 뉴스 어댑터에서 직접 사용하여 후속 fix PR에서 **복원**, 하단 참조), job queue 함수 10종(`getJobMeta`/`setJobMeta`/`getJobStatus`/`setJobStatus`/`getJobResult`/`setJobResult`/`getJobError`/`setJobError`/`isJobCancelled`/`cleanupJob`)+시그니처 타입 `JobMeta`/`JobStatus`. 구현·내부 호출은 보존(use-case가 내부적으로만 사용). **reachability로 제거 보류(public 유지)**: `ChatTokenStore`·`CallAiProvider`·`ConversationRole`·`UsageLogRepository`·`CreateUsageLogInput`(공개 `requestChatCompletion`의 `RequestChatCompletionDependencies`에서 도달), `FmpConfig`(공개 `readFmpConfig`/`tryReadFmpConfig` 반환 타입). 유지: `createCacheProvider`·`computeBarsEffectiveTtl`·`createChatTokenStore`·`hashClientIp`·`hashUsageIp`·`cancelJob`·`readFmpConfig`·`tryReadFmpConfig`·reanalyze-cooldown. `SkillsProvider`/`JobMeta`/`JobStatus`는 양 entrypoint에서 제거. `buildOptionsCacheKey`는 Tier 1 인벤토리에서도 제거(Tier 1 23→22). 부수적으로 `cache/config.ts`의 sector-signals 형제 export(`SECTOR_SIGNALS_1HOUR_TTL_MINUTES`/`SECTOR_SIGNALS_15MIN_TTL_MINUTES`/`SECTOR_SIGNALS_TTL_BY_TIMEFRAME`/`buildSectorSignalsCacheKey`)에 누락됐던 `@internal` 태그 보강(MISTAKES.md #9.5 whole-file sweep). 유지 public 함수(`hashClientIp`)의 Tier 3 JSDoc 완결(description+@param+@returns) 및 `cancelJob` `@returns` 보강. public JSDoc이 이제 `@internal`이 된 심볼을 가리키던 `{@link}` 참조 정리(`cancelJob`→`isJobCancelled`, `computeBarsEffectiveTtl`→`computeEffectiveTtl`, `peekAnalysisCache`→`buildAnalysisCacheKey`) — TypeDoc(excludeInternal) broken link 방지. 0.x semver minor bump(package.json은 0.16.0 유지). |
| 2026-05-30 | **지지/저항 후보 사전계산 (Task B2).** Tier 2 `computeLevelCandidates(currentPrice, indicators, bars?)` 신규 — Volume Profile(POC/VAH/VAL)·MA/EMA(최신값)·Bollinger 경계·SMC 스윙에서 결정론적 지지/저항 후보를 도출. 가격이 일치하는 raw 레벨은 confluence cluster로 병합하고 `bars`로 tested-history(touchCount)를 세며, 현재가 기준 side 분리 후 strength(confluence + tested history) DESC·distance tiebreak으로 정렬·side별 상위 N개 cap. `bars`는 optional(생략 시 touchCount 0)이라 기존 2-arg 호출과 backward-compatible. AI는 이 후보에서 keyLevels를 선택해 price-arithmetic hallucination을 제거한다. Tier 4 타입 `LevelCandidate`(price/source(@deprecated)/sources/touchCount/distancePercent)/`LevelCandidateSource`/`LevelCandidates`(`domain/types.ts`) 등록. `source`는 `sources[0]` 별칭으로 backward-compat 유지. `buildAnalysisPrompt`에 `## Support/Resistance Candidates (precomputed)` 섹션 추가(DOMAIN.md 프롬프트 구조 동기화). cap 상수 `MAX_LEVEL_CANDIDATES_PER_SIDE`는 구현 세부라 공개 export하지 않고 `levelCandidates.ts` 모듈 내부 상수로 유지(MISTAKES.md §Public API #6.5). 0.x semver minor bump(package.json은 0.16.0 유지). |
| 2026-05-30 | **컨슈머 검증 후속 복원 (트래킹 이슈 #110).** PR1~7 머지 후 **최종 consumer typecheck 검증**(v0.15.0 대비 제거된 public export 235종 × 3개 consumer의 `@y0ngha/siglens-core` import 전수 교집합)에서 실제 breakage 2건 발견 — siglens-core 단독 리뷰(내부 review-agent + GitHub claude/Gemini)는 consumer 코드를 보지 못해 놓친 케이스. **복원**: (1) `SectorGroupDef`(PR6에서 삭제) — `siglens`가 자체 `SECTOR_GROUPS: readonly SectorGroupDef[]`를 이 타입으로 타이핑(core의 `SECTOR_GROUPS` 상수는 미사용), 인터페이스 정의 + 양 entrypoint export 복원; (2) `NewsTimeRange`(PR7에서 `@internal`) — `siglens`/`siglens-trader`가 자체 뉴스 fetch 어댑터의 `range` 인자를 이 union으로 타이핑, `@internal` 제거 + `src/index.ts` re-export 복원. 부모 port `NewsProvider`는 consumer가 이름으로 import하지 않아 `@internal` 유지. 재검증: 제거 심볼 ∩ consumer import = **0**. 교훈: "consumer가 구현/타이핑하는 port·타입은 core 내부 도달 가능성과 무관하게 public 계약" — `domain/CLAUDE.md` ports 원칙과 일치. 0.x semver minor bump(package.json은 0.16.0 유지). |
| 2026-05-30 | **피봇·피보나치 레벨 사전계산 (Task B3).** Tier 2 `computePivotFibLevels(bars, indicators)` 신규 — 직전 완료 봉(`bars[len-2]`)의 H/L/C에서 표준·피보나치 피봇(PP/R1-R3/S1-S3)을, 최신 SMC 스윙 고/저에서 피보나치 되돌림(23.6%~78.6%)·확장(100%~261.8%) 타깃을 결정론적으로 도출. AI는 이 레벨을 선택·해석해 price-arithmetic hallucination을 제거한다. **피봇 anchor는 `lastOf(bars)`(`bars[len-1]`)가 아닌 직전 완료 기간 `bars[len-2]`** — 스냅샷가(`bars[len-1].close`)가 속한 현재/다음 기간의 레벨을 직전 기간 H/L/C에서 투영하는 정준 정의에 맞춤(B2 리뷰 반영). 따라서 bar가 2개 미만이면 `standardPivot`/`fibonacciPivot`은 `null`(스윙 기반 `fibonacci` projection은 무관하게 유지). 렌더 라벨/JSDoc("prior period")과 일치. Tier 4 타입 `PivotFibLevels`/`StandardPivotLevels`/`FibonacciPivotLevels`/`FibonacciProjection`/`FibonacciLevel`/`SwingLegDirection`(`domain/types.ts`) 등록. `buildAnalysisPrompt`에 `## Pivot & Fibonacci Levels (precomputed)` 섹션 추가. 0.x semver minor bump(package.json은 0.16.0 유지). |
| 2026-06-01 | **스킬 동적 선별 게이팅 타입 public 등록 (Group F PR2).** `Skill.gating?: SkillGating` 필드 추가로 `src/index.ts`가 `Skill`의 transitive closure를 통해 새 게이팅 타입을 노출 — Tier 4 인벤토리에 `SkillGating`(discriminated union: `{ tier: 'always_on' }` | `{ tier: 'gated'; signalKind: 'event'; triggers }` | `{ tier: 'gated'; signalKind: 'state'; state }`), `SkillStatePredicate`, `SkillStateFeature`, `SkillStatePredicateKind`(`domain/types.ts`) 등록. **`SignalKind`(`'event'` | `'state'`)는 public 미노출** — `SkillGating`이 인라인 `signalKind` 리터럴로 discriminate하므로 public closure에서 도달 불가. 로더 frontmatter 검증(`SIGNAL_KINDS`)에서만 쓰여 삭제 대신 `@internal` 태그 유지, `src/index.ts` `export type` 블록에서 제거. `hashSkillCatalog`(`infrastructure/hash/analysisInput.ts`)의 `localeCompare`에 `'en'` 로케일 고정 — 로케일 의존 정렬로 인한 서버별 캐시 키 불일치 방지(`selectSkills`와 동일 수정). 0.x semver minor bump(package.json은 0.16.0 유지). |
| 2026-06-04 | **Tier 1 `peekBriefingCache` 인벤토리 등록 (PR #145).** `submitBriefing`/`pollBriefing`과 같은 캐시 키(`buildBriefingCacheKey`) + 동일 정규화 경로(`normalizeMarketBriefing`)를 read-only로 읽는 SSR/봇 서핑용 peek use-case. Returns `Promise<MarketBriefingResponse \| null>`. MISTAKES.md Public API rule 7 준수 — 동일 커밋에 인벤토리 추가. |
| 2026-05-31 | **마켓 레퍼런스 레이어 도입 + 레거시 S/R·피봇·추세선 사전계산 제거 (Group B).** 백테스트 결과(정밀 S/R·추세·피봇 예측은 distance-matched random 대비 forward edge ~0; fib 되돌림/확장만 유효)에 따라 예측 프레이밍을 **어드바이저리 프레이밍**으로 전환. Tier 2 `computeMarketReference(bars, indicators, timeframe)` 신규 — 결정론적·다호라이즌(short/medium/long lookback) 레퍼런스: 호라이즌별 (a) 검증된 레벨(fib/Volume Profile/스윙/MA·EMA/라운드 넘버), (b) 널리 주시되는 지표 레벨(Supertrend/Ichimoku/Donchian/Bollinger/Keltner/VWAP/표준·Camarilla 피봇), (c) 서술적 추세 구조. Tier 4 타입 `MarketReference`/`HorizonReference`/`HorizonWindow`/`HorizonKey`/`TrendStructure`/`ReferenceLevel`/`ReferenceLevels`/`ReferenceLevelKind`/`PriceVsLevel`/`EmaStackState`/`SwingStructureState`/`MarketRegime`(`domain/types.ts`) 등록. `RoundNumberTier` 및 아래 피봇/피보 헬퍼 타입은 내부 전용(미export). **레거시 제거**: Tier 2 `computeLevelCandidates`(Task B2)·`computePivotFibLevels`(Task B3) export 및 모듈(`levelCandidates.ts`/`pivotFib.ts`/`trendlineCandidates.ts`/`trendline.ts`) 삭제, input-only 타입 `LevelCandidate`/`LevelCandidates`/`LevelCandidateSource`/`PivotFibLevels`/`FibonacciPivotLevels`/`PivotLevelSet` 제거. `StandardPivotLevels`·`CamarillaPivotLevels`·`FibonacciProjection`·`FibonacciLevel`·`SwingLegDirection`은 `@internal` 헬퍼(`fibLevels.ts`/`pivotLevels.ts`) 반환/요소 타입으로 **내부화**(index 재export 제거 — `MarketReference` 공개 closure에 미포함; `StandardPivotLevels`는 폐기된 `PivotLevelSet` 멤버를 인라인). `Trendline`/`TrendlinePoint`/`TrendlineDirection`은 AI 응답 스키마용으로 **유지**(precomputed 후보만 제거; AI 자체 추세선 출력은 보존). 시그널·대시보드용 `classifyTrend`는 별개 관심사로 불변. **컨슈머 cross-check**: 제거·내부화된 모든 심볼(`computeLevelCandidates`·`computePivotFibLevels`·`computeTrendlineCandidates`·`extendTrendline`, input-only 타입, 헬퍼 타입 `StandardPivotLevels`/`CamarillaPivotLevels`/`FibonacciProjection`/`FibonacciLevel`/`SwingLegDirection`)을 siglens/siglens-worker/siglens-trader `src/` 전체 grep → 사용 0건 확인(안전 제거). 0.x semver minor bump(package.json은 0.16.0 유지). |
