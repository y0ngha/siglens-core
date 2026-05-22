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

### Tier 1 — Application Entrypoints (24)

| Symbol | Source |
|---|---|
| `submitAnalysis` | `application/market/submitAnalysis.ts` |
| `pollAnalysis` | `application/market/pollAnalysis.ts` |
| `cancelAnalysisJob` | `application/market/cancelAnalysisJob.ts` |
| `fetchBarsWithIndicators` | `application/market/barsApi.ts` |
| `submitBriefing` | `application/market/submitBriefing.ts` |
| `pollBriefing` | `application/market/pollBriefing.ts` |
| `getMarketSummary` | `application/dashboard/getMarketSummary.ts` |
| `getMarketSummaryWithBriefing` | `application/dashboard/getMarketSummaryWithBriefing.ts` |
| `getSectorSignals` | `application/dashboard/sectorSignals.ts` |
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
| `submitOverallAnalysis` | `application/overall/submitOverallAnalysis.ts` |
| `pollOverallAnalysis` | `application/overall/pollOverallAnalysis.ts` |
| `cancelOverallAnalysisJob` | `application/overall/cancelOverallAnalysisJob.ts` |
| `submitOptionsAnalysis` | `application/options/submitOptionsAnalysis.ts` |
| `pollOptionsAnalysis` | `application/options/pollOptionsAnalysis.ts` |
| `buildOptionsCacheKey` | `application/options/cacheKey.ts` |

### Tier 2 — Domain Building Blocks

**통합 계산기/감지기 (3)**
| Symbol | Source |
|---|---|
| `calculateIndicators` | `domain/indicators/index.ts` |
| `detectSignals` | `domain/signals/index.ts` |
| `classifyTrend` | `domain/signals/index.ts` |

**Fear & Greed Index (per-stock) (2)**
| Symbol | Source |
|---|---|
| `computeFearGreedIndex(bars, buySellVolume, options?)` — per-stock Fear & Greed snapshot. Returns `FearGreedSnapshot \| null`. | `domain/indicators/fearGreed/walkForward.ts` |
| `computeFearGreedHistory(bars, buySellVolume, options?)` — walk-forward 1-year score history. Returns `FearGreedHistoryPoint[]`. | `domain/indicators/fearGreed/walkForward.ts` |

**프롬프트 빌더 (8 + 1 상수)**
| Symbol | Source |
|---|---|
| `buildAnalysisPrompt` | `domain/analysis/prompt.ts` |
| `buildFundamentalAnalysisPrompt` | `domain/analysis/fundamentalPrompt.ts` |
| `buildMarketBriefingPrompt` | `domain/analysis/marketBriefingPrompt.ts` |
| `buildNewsAnalysisPrompt` | `domain/analysis/newsPrompt.ts` |
| `buildNewsCardAnalysisPrompt` | `domain/analysis/newsCardPrompt.ts` |
| `buildOverallAnalysisPrompt` | `domain/analysis/overallPrompt.ts` |
| `buildOptionsAnalysisPrompt` | `domain/options/optionsPrompt.ts` |
| `buildChatPrompt` | `domain/chat/buildChatPrompt.ts` |
| `AI_SYSTEM_PROMPT` | `domain/analysis/systemPrompt.ts` |

**옵션 분석 헬퍼 (4 + 1 상수)**
| Symbol | Source |
|---|---|
| `summarizeChainForLlm` | `domain/options/summarizeChainForLlm.ts` |
| `aggregateOpenInterest` | `domain/options/aggregateOpenInterest.ts` |
| `sanitizeOptionsChain` | `domain/options/sanitizeOptionsChain.ts` |
| `mapExpirationsToSlots` | `domain/options/expirationSlots.ts` |
| `EXPIRATION_SLOTS` | `domain/options/expirationSlots.ts` |

> **@internal (not exported)**: `calculateMaxPain`, `calculatePutCallRatio`, `calculateImpliedMove` — single-purpose calculators consumed only by `summarizeChainForLlm`. Consumers should call `summarizeChainForLlm` (or read derived fields on `OptionsExpirationMetrics`) instead of recomputing.

**응답 정규화 (6)**
| Symbol | Source |
|---|---|
| `enrichAnalysisWithConfidence` | `domain/analysis/confidence.ts` |
| `normalizeMarketBriefing` | `domain/analysis/normalizeMarketBriefing.ts` |
| `normalizeFundamentalAnalysisResponse` | `domain/analysis/normalizeFundamental.ts` |
| `normalizeFundamentalSnapshot` | `domain/analysis/normalizeFundamentalSnapshot.ts` |
| `normalizeNewsAnalysisResponse` | `domain/analysis/normalizeNews.ts` |
| `normalizeNewsCardAnalysis` | `domain/analysis/normalizeNews.ts` |
| `normalizeOverallAnalysisResponse` | `domain/analysis/normalizeOverall.ts` |
| `normalizeOptionsAnalysisResponse` | `domain/analysis/normalizeOptions.ts` |

**티어 게이트 (Tier gating) (13)**
| Symbol | Source |
|---|---|
| `filterAnalysisResult` | `domain/analysis/filterAnalysisResult.ts` |
| `isAllowed` / `getTierLimit` / `getAllowedTimeframes` / `getAllowedModels` | `domain/tier.ts` |
| `isTimeframeAllowed` / `isInfoDepthAllowed` / `isModelAllowed` | `domain/tier.ts` |
| `isPremiumModel` / `isFreeModel` / `requiresByokKey` | `domain/tier.ts` |
| `isTier` | `domain/tier.ts` |
| `TIER_CONFIG` / `DEFAULT_TIER` | `domain/tier.ts` |

**캔들 패턴 (UI/프롬프트에서 사용) (10)**
| Symbol | Source |
|---|---|
| `detectCandlePattern` | `domain/analysis/candle.ts` |
| `detectMultiCandlePattern` | `domain/analysis/candle.ts` |
| `detectCandlePatternEntries` | `domain/analysis/candle-detection.ts` |
| `getDetectionBars` | `domain/analysis/candle-detection.ts` |
| `selectLastCandlePatternEntries` | `domain/analysis/candle-detection.ts` |
| `getCandlePatternLabel` | `domain/analysis/candle-labels.ts` |
| `getMultiCandlePatternLabel` | `domain/analysis/candle-labels.ts` |
| `findCandlePatternLabel` | `domain/analysis/candle-labels.ts` |
| `getSinglePatternTrend` | `domain/analysis/candle-trend.ts` |
| `getMultiPatternTrend` | `domain/analysis/candle-trend.ts` |

**대시보드 헬퍼 (3)**
| Symbol | Source |
|---|---|
| `bucketedTimestamp` | `domain/dashboard.ts` |
| `computeStockSignalResult` | `domain/dashboard.ts` |
| `lookbackIsoFromNow` | `domain/dashboard.ts` |

**모델 스펙 헬퍼 (9)** — `getProvider`, `isClaudeModel`, `isGeminiModel`, `isChatGPTModel`, `getThinkingBudgetSequence` (`domain/analysis/modelSpecs.ts`), `isReasoningModelSpec`, `isSamplingModelSpec`, `isClaudeReasoningModelSpec`, `isClaudeSamplingModelSpec` (`domain/types.ts`). `is*ModelSpec` 가드는 `ModelSpec` union을 effort-bearing 변종 또는 sampling 변종으로 좁히는 데 사용한다.

### Tier 3 — Infrastructure Factories & Config

**캐시 (1 factory + 13 helper/const)**
| Symbol | Source |
|---|---|
| `createCacheProvider` | `infrastructure/cache/redis.ts` |
| `ANALYSIS_CACHE_TTL` | `infrastructure/cache/config.ts` |
| `MARKET_BRIEFING_CACHE_TTL` | `infrastructure/cache/config.ts` |
| `CACHE_EXPIRY_HOUR_KST` | `infrastructure/cache/config.ts` |
| `buildAnalysisCacheKey` | `infrastructure/cache/config.ts` |
| `buildBriefingCacheKey` | `infrastructure/cache/config.ts` |
| `computeEffectiveTtl` | `infrastructure/cache/config.ts` |

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

**채팅 토큰 저장소 (1 factory + 3 helper/const)**
| Symbol | Source |
|---|---|
| `createChatTokenStore` | `infrastructure/chat/tokenStore.ts` |
| `hashClientIp` | `infrastructure/chat/tokenStore.ts` |
| `CHAT_TOKEN_LIMIT` | `infrastructure/chat/tokenStore.ts` |
| `CHAT_TOKEN_TTL_SEC` | `infrastructure/chat/tokenStore.ts` |

**시장 데이터 (1)**
| Symbol | Source |
|---|---|
| `createMarketDataProvider` | `infrastructure/market/factory.ts` |

**Skills (1)**
| Symbol | Source |
|---|---|
| `FileSkillsLoader` | `infrastructure/skills/loader.ts` |

**Config readers (2)**
| Symbol | Source |
|---|---|
| `readFmpConfig` | `infrastructure/fmp/config.ts` |
| `tryReadFmpConfig` | `infrastructure/fmp/config.ts` |

**Database (usage helpers only)**
| Symbol | Source |
|---|---|
| `hashUsageIp` | `infrastructure/usage/hash.ts` |
| (참고) `UsageRepository` / `UsageLogRepository` / `UserTierRepository` 인터페이스는 `infrastructure/db/types.ts`에 정의되어 분석 use-case가 DI로 소비. Drizzle/Neon 의존성은 Phase 6에서 모두 siglens로 이전됨. |

**Job queue (worker용) (11)**
| Symbol | Source |
|---|---|
| `setJobMeta` / `getJobMeta` | `infrastructure/jobs/queue.ts` |
| `getJobStatus` / `setJobStatus` | `infrastructure/jobs/queue.ts` |
| `getJobResult` / `setJobResult` | `infrastructure/jobs/queue.ts` |
| `getJobError` / `setJobError` | `infrastructure/jobs/queue.ts` |
| `cancelJob` / `isJobCancelled` / `cleanupJob` | `infrastructure/jobs/queue.ts` |

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
- 펀더멘털: `FundamentalAnalysisResponse`, `FundamentalCategoryAssessment`, `FundamentalCategory`, `FundamentalSentiment`, `FundamentalSnapshot`, `FundamentalProfile`, `FundamentalValuation`, `FundamentalPeer`, `FundamentalProfitability`, `FundamentalGrowth`, `FundamentalHealth`, `FundamentalFutureDirection`, `GradesConsensus`, `GradesEvent`, `GradesAction`, `PriceTargetConsensus`, `PriceTargetSummary`, `FundamentalSectorDirection`, `SectorHistoricalPoint`.
- 뉴스: `NewsAnalysisResponse`, `NewsCardAnalysis`, `NewsCategory`, `NewsItem`, `NewsSentiment`, `EnrichedNewsItem`, `EarningsCalendarItem`, `EarningsReport`.
- 종합: `OverallAnalysisResponse`, `OverallScenario`, `OverallScenarioName`.
- Fear & Greed Index (per-stock):
    - `FearGreedLabel`, `FearGreedConfidence`, `FearGreedWarning`
    - `FearGreedFactorKey`, `FearGreedGroupName`
    - `FearGreedFactor`, `FearGreedGroup`
    - `FearGreedSnapshot`, `FearGreedHistoryPoint`
    - `ComputeFearGreedOptions`

새로 추가된 Provider 인터페이스:
- `FundamentalDataProvider` — `infrastructure/fundamental/types.ts`. Core가 의존하는 추상 펀더멘털 데이터 fetcher 인터페이스 (siglens가 FMP로 구현).
- `NewsProvider` — `domain/ports/newsProvider.ts`. 뉴스 + 실적 캘린더 fetcher 인터페이스.
- `NewsTimeRange` — `domain/ports/newsProvider.ts`. 뉴스 조회 기간 union (`'24h'` | `'7d'` | `'30d'`).
- `OptionsDataProvider` — `domain/ports/optionsDataProvider.ts`. 옵션 시세 fetcher 추상화 인터페이스 (siglens가 Yahoo Finance로 구현). `fetchSnapshot`, `hasOptionsMarket` 두 메서드.

새로 추가된 use-case option/result 타입:
- 펀더멘털: `SubmitFundamentalAnalysisOptions`, `SubmitFundamentalAnalysisResult`, `SubmitFundamentalAnalysisApiKeyRequiredError`, `SubmitFundamentalAnalysisMissNoTrigger`, `PollFundamentalAnalysisResult`.
- 뉴스: `SubmitNewsAnalysisOptions`, `SubmitNewsAnalysisResult`, `SubmitNewsAnalysisApiKeyRequiredError`, `SubmitNewsAnalysisMissNoTrigger`, `PollNewsAnalysisResult`.
- 종합: `SubmitOverallAnalysisOptions`, `SubmitOverallAnalysisResult`, `SubmitOverallAnalysisApiKeyRequiredError`, `SubmitOverallAnalysisMissNoTrigger`, `DependencyStateMissNoTrigger`, `PollOverallAnalysisResult`.
- 기술적: `SubmitAnalysisMissNoTrigger` — 0.10.0에서 추가된 봇/크롤러 게이팅용 결과 variant.
- 옵션: `SubmitOptionsAnalysisOptions`, `SubmitOptionsAnalysisResult`, `SubmitOptionsAnalysisCached`, `SubmitOptionsAnalysisSubmitted`, `SubmitOptionsAnalysisMissNoTrigger`, `SubmitOptionsAnalysisLimitError`, `SubmitOptionsAnalysisNoChainsError`, `SubmitOptionsAnalysisApiKeyRequiredError`, `PollOptionsAnalysisResult`, `PollOptionsAnalysisProcessing`, `PollOptionsAnalysisDone`, `PollOptionsAnalysisError`. 도메인 타입(`OptionsContract`, `OptionsChain`, `OptionsSnapshot`, `StrikeOpenInterest`, `StrikeVolumeAggregate`, `TopOiQuote`, `OptionsExpirationMetrics`, `OptionsPerExpirationCommentary`, `OptionsSignal`, `OptionsAnalysisResponse`, `OptionsTone`, `OptionsSignalKind`, `OptionsExpirationFilter`)과 슬롯 매핑(`ExpirationSlot`, `ExpirationSlotKey`, `SlotMapping`), 프롬프트 옵션(`BuildOptionsAnalysisPromptOptions`) 포함.

**인터페이스** — `CacheProvider`, `ChatTokenStore`, `SkillsProvider`, `FmpConfig`, `JobStatus`, `JobMeta`, Usage repository 인터페이스(`UsageRepository`, `UsageLogRepository`, `UserTierRepository`), 관련 record/input 타입(`RecordUsageInput`, `CreateUsageLogInput`, `UsageLogRecord`, `UsageCounts`), enum union 타입(`UsageActionType`, `UserTier`), AI provider 타입, tier 관련 타입(`Tier*`, `ModelId`, `UserTierContext`), usage limit 타입(`UsageLimit*`, `AnalysisUsageOptions`, `SubmitAnalysisOptions`, `SubmitAnalysisGatedResult`, `SubmitAnalysisErrorResult`, `TierTimeframeAccessError`, `UserApiKeyRequiredError`), `BackgroundTaskOptions`, 채팅 application 타입.

**대시보드 상수** — `DASHBOARD_TIMEFRAMES`, `DASHBOARD_TIMEFRAME_LABELS`, `DEFAULT_DASHBOARD_TIMEFRAME`, `MARKET_INDICES`, `MARKET_SUMMARY_FMP_SYMBOLS`, `SECTOR_ETFS`, `SECTOR_GROUPS`, `SECTOR_STOCKS`, `SIGNAL_SECTORS`.

**캔들 라벨 맵** — `CANDLE_PATTERN_LABELS`, `MULTI_CANDLE_PATTERN_LABELS`.

**캔들 패턴 감지 상수** — `CANDLE_PATTERN_DETECTION_BARS`, `EXCLUDED_SINGLE_PATTERNS` (`domain/candles/`).

**지표 상수** — `EMPTY_INDICATOR_RESULT`, `EMPTY_SMC_RESULT`, `RSI_DEFAULT_PERIOD`, `EMA_DEFAULT_PERIODS` 등 `src/domain/indicators/constants.ts`의 지표 계산 기본값과 임계값.

**티어 제한 상수** — `DEFAULT_TIER`, `TIER_CONFIG` (`domain/tier.ts`).

**모델 스펙 (단일 source of truth)** — `MODEL_SPECS`, `THINKING_BUDGET_FALLBACK_STEPS`, `DISABLED_THINKING_BUDGET`, `ModelSpec`, `ClaudeSamplingModelSpec`, `ClaudeReasoningModelSpec`, `GeminiModelSpec`, `ChatGPTModelSpec`, `EffortLevel`, `AIProvider`, `ActiveModelId`, `ClaudeModelId`, `GeminiModelId`, `ChatGPTModelId` (`domain/analysis/modelSpecs.ts`, types in `domain/types.ts`). AI SDK 호출자(워커, 서버 액션, UI)가 직접 lookup하는 단일 source of truth — provider 라우팅, max output tokens, thinking budget(`ClaudeSamplingModelSpec` / `GeminiModelSpec`) 또는 reasoning effort(`ClaudeReasoningModelSpec` / `ChatGPTModelSpec`), sampling 파라미터를 모델 식별자(`ActiveModelId`) 별로 보관한다. `EffortLevel` (`'low' | 'medium' | 'high'`)은 reasoning 변종에서 effort 필드 타입으로 사용된다. provider-specific subset 타입(`ClaudeModelId` 등)은 `is*Model` 타입 predicate가 narrowing할 때 노출된다. spec 변종 narrowing은 `is*ModelSpec` 가드(Tier 2)를 사용한다. 새 모델 추가는 이 맵에 한 줄 추가 + core publish로 끝난다.

**고급 도메인 헬퍼** — 개별 신호 감지기, 신호 상수, 정규화 함수, AI 레벨 보정, 추세선/키레벨/action recommendation 보조 함수는 외부 consumer의 세부 렌더링·검증 흐름을 위해 `src/index.ts`에서 명시적으로 export한다. 공개 정규화 헬퍼: `asString`, `asArray`, `compact`, `normalizeTrend`, `normalizeRiskLevel`, `normalizeKeyLevels`, `normalizePriceTargets`, `normalizeIndicatorGuideResult`.

전체 타입 목록은 `src/domain/types.ts`와 `src/index.ts`의 `export type {...}` 블록을 참고한다.

### Internal (export 하지 않음)

다음 함수/상수는 다른 public 함수의 보조 구현이며, **`src/index.ts`에서 export하지 않고** 정의부에 `/** @internal */` 태그를 붙인다.

**개별 지표 계산기** — `calculateRSI`, `calculateMA`, `calculateMACD`, `calculateBollinger`, `calculateStochastic`, `calculateATR`, `calculateOBV`, `calculateSAR`, `calculateWilliamsR`, `calculateSupertrend`, `calculateMFI`, `calculateKeltner`, `calculateCMF`, `calculateDonchian`, `calculateVWAP`, `calculateEMA`, `calculateSMC`, `calculateSqueezeMomentum`, `calculateIchimoku`, `calculateCCI`, `calculateDMI` 등 → `calculateIndicators()`로 통합 호출.

**개별 신호 감지기** — `detectRsiOversold`, `detectRsiOverbought`, `detectGoldenCross`, `detectDeathCross`, `detectMacdBullishCross`, `detectMacdBearishCross`, `detectBollingerLowerBounce`, `detectBollingerUpperBreakout`, `detectSupertrendBullishFlip`, `detectIchimokuCloudBreakout`, `detectCciBullishCross`, `detectDmiBullishCross`, `detectCmfBullishFlip`, `detectMfiOversoldBounce`, `detectParabolicSarFlip`, `detectKeltnerUpperBreakout`, `detectSqueezeMomentumBullish`, `detectRsiBullishDivergence`, `detectRsiBearishDivergence`, `detectMacdHistogramBullishConvergence`, `detectMacdHistogramBearishConvergence`, `detectBollingerSqueezeBullish`, `detectBollingerSqueezeBearish`, `detectSupportProximityBullish`, `detectResistanceProximityBearish` → `detectSignals()`로 통합 호출.

**신호 헬퍼** — `findCross`, `findThresholdCross`, `findPivotLows`, `findPivotHighs`, `computeBbWidth`, `computePctB`, `computeEmaSlope`, `percentileRank`.

**정규화 헬퍼 (internal)** — `asNumber`, `asBoolean`, `asEnum`, `asObject`, `normalizeKeyLevel`, `normalizePriceTarget`, `normalizeSignal`. (`asString`, `asArray`, `compact`, `normalizeTrend`, `normalizeRiskLevel`, `normalizeKeyLevels`, `normalizePriceTargets`, `normalizeIndicatorGuideResult`는 public export — 아래 "고급 도메인 헬퍼" 참조)

**액션/리스크 유틸** — `validateActionPrices`, `extractReconciledActionLines`, `isValidBullishStopLoss`, `isValidBullishTakeProfit`, `deriveFallbackStopLoss`, `deriveFallbackTakeProfit`, `resolveBullishStopLoss`, `resolveBullishTakeProfit`, `buildBullishExitText`, `buildBullishRiskRewardText`, `reconcileBullishActionRecommendation`.

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
