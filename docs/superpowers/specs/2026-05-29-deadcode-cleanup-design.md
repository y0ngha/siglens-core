# siglens-core dead-code & 미사용 public export 정리 — 설계

- 작성일: 2026-05-29
- 대상 패키지: `@y0ngha/siglens-core` (v0.15.0)
- 컨슈머: `siglens`, `siglens-worker`, `siglens-trader` (총 3개, 고정)

## 1. 배경

`src/index.ts`(server) + `src/index.client.ts`(browser)에서 export하는 **649개** public
심볼 중, 3개 컨슈머 어디에서도 import하지 않는 **미사용 export가 386개**로 확인되었다.

확인 절차:
1. `index.ts`/`index.client.ts`의 export 식별자 전수 추출 (649개).
2. 3개 컨슈머 소스 전체에서 `@y0ngha/siglens-core` import 심볼 추출 (263개 사용).
3. 차집합 386개 도출.
4. 386개를 컨슈머 전체에서 단일-패스 `grep`으로 재검증 → 29건이 걸렸으나 **전부
   컨슈머 자체 `@/domain`·`@/shared`·`@/entities` 재정의이거나 주석/테스트 텍스트**였고,
   siglens-core 패키지 import는 아니었음. 즉 386개 모두 실질 dead 확정.

부수적으로 발견된 정리 대상:
- **`@internal` 누출: 없음.** 두 진입점이 전부 named export라 `@internal` 심볼이 외부로
  새지 않으며, 컨슈머의 deep-import·`@internal` 참조도 0건.
- **중복 코드 / 위치 오류 / dead 파일** (§4의 PR 1 항목).
- knip이 찾은 **완전 dead 4건** + fearGreed barrel 중복 type re-export.

> ⚠️ 근본 원인: `siglens`가 indicators·analysis·types·dashboard config·ai/utils를
> core로 추출해 놓고도 **자체 카피(`@/domain/...`)를 계속 사용**하고 있어, core의 해당
> export가 안 쓰인다. 이번 작업은 core 측 표면을 컨슈머 실사용에 맞춰 축소한다.

## 2. 목표 / 비목표

**목표**
- 미사용 public export 386개를 **구현까지 완전 제거** (내부 참조가 남으면 export 라인만 제거).
- 중복 코드 / 위치 오류 / dead 파일 정리.
- 영향 받는 문서 동기화 (`PUBLIC_API.md` 외).
- 레이어 규칙(domain 순수성) 불변 유지.

**비목표**
- 컨슈머(`siglens` 등) 측 자체 카피를 core로 재통합하는 작업 (별도 과제).
- 새 기능 추가, 동작 변경. (순수 정리 — 외부 동작 동일)

## 3. unreachable 제거 절차 (모든 PR 공통 규칙)

대상 심볼마다:

1. `index.ts` + `index.client.ts`에서 export 라인 제거.
2. `yarn typecheck` + `yarn lint` + `npx knip` 실행.
3. **knip/eslint가 "unused"로 보고** → 구현·타입·파일 + 해당 테스트까지 **완전 삭제**.
4. **여전히 내부 참조됨** (예: `calculateRSI` ← `calculateIndicators` ← `fetchBarsWithIndicators`)
   → **export만 제거하고 구현 유지**.
5. 삭제로 새 unreachable이 발생하면 2~4 반복(연쇄 정리).

`FundamentalGrowth`처럼 "살아있는 타입의 필드 타입"인 경우 tsc가 참조를 보장하므로 4번으로
자동 처리(정의 유지, export만 제거)된다.

> knip 역할 명시: knip은 라이브러리 entry(`index.ts`)의 export를 전부 "사용됨"으로 간주하므로
> 386개 자체는 탐지하지 못한다(외부 npm 컨슈머를 모름). **export를 제거한 *후*** "내부에서도
> 안 쓰이게 된 구현/파일"을 잡는 **삭제 단계의 사후 검증 도구**로 사용한다.

## 4. PR 분할 (7개, 의존 순서)

각 PR은 직전 PR이 main에 머지된 뒤 진행한다(공유 파일 `index.ts`/`index.client.ts` 충돌 회피).

| # | 브랜치/타이틀 | 내용 |
|---|---|---|
| **1** | `refactor: dedup & relocate shared helpers` | JSON-fence 헬퍼 삭제(`domain/utils.ts`), `1000`/`10` 매직넘버 → canonical 상수 통합, `MS_PER_DAY`(pickNearestExpiration)·`formatNullableNumber`(prompt.ts) 통합, `buildOptionsCacheKey` → `infrastructure/cache/config.ts` 이전, `domain/utils/date.ts` 삭제, knip 검출 4건(`TIER_VALUES`·`DEFAULT_EPSILON_PERCENT`·`normalizeReconciledActionLevels`·`TEST_BAR_VOLUME` — 내부 사용 유지, export 키워드만 제거) + fearGreed barrel 중복 type re-export 제거 |
| **2** | `refactor: drop deprecated Gemini aliases` | `GeminiRole`·`GeminiPart`·`GeminiContent` 제거 (양 진입점) |
| **3** | `refactor: prune unused indicators surface` | `calculate*` 미사용분 + indicator 상수 + dead indicator 결과 타입 |
| **4** | `refactor: prune unused signals surface` | `detect*` 미사용분 + signal 상수 + dead signal 타입 |
| **5** | `refactor: prune unused analysis helpers` | `normalize*`·`build*Prompt`·candle/keyLevels/trendline/cache-key/confidence 미사용분 |
| **6** | `refactor: prune unused domain types` | SMC·Fundamental·Submit/Poll/Dependency·기타 dead 타입; `PollResult<T>` 제네릭 도입(살아있는 Poll 타입 통합 + dead Poll 구성요소 제거) |
| **7** | `refactor: prune unused infra surface` | job queue·cache TTL 상수·skills·fmp·market 미사용분 |

PR 1·2는 작고 독립적이라 먼저 빠르게 처리한다. 도메인이 큰 PR 3·6은 서브커밋으로 쪼개 리뷰
가능성을 확보한다. 각 PR의 정확한 심볼 집합은 §부록의 카테고리에서 §3 절차로 확정한다.

> 주의: §부록 카테고리는 심볼 **prefix 기준 자동 분류**이므로 PR 도메인 경계와 1:1이 아니다.
> 일부 심볼은 도메인 기준으로 재배치된다 — 예: `extractJsonWithRepair`는 부록 C에 있으나
> PR 7(infra), `classifyTrend`는 부록 C에 있으나 PR 4(signals), `buildOptionsCacheKey`는
> 부록 C에 있으나 PR 1(위치 이전). PR 배정의 기준은 prefix가 아니라 심볼이 속한 도메인 모듈이다.

## 5. 검증 게이트

- **매 PR**: `yarn typecheck` + `yarn lint` + `yarn test` + `npx knip` 통과
  → `review-agent` → `mistake-managing-agent` → `git-agent`(브랜치·커밋·PR 생성).
- **최종(PR 7 머지 후)**: 로컬 빌드를 3개 컨슈머에 연결(`yarn link` 등)하여 각 레포
  `typecheck` 1회로 실제 호환성 최종 확정.
- **커버리지 기준**: domain 90% branch coverage(운영 기준). 코드 삭제는 커버리지를 낮추지
  않으나, 신규 작성/변경 코드(`PollResult<T>` 제네릭, 이전된 `buildOptionsCacheKey`)는
  90%+ 테스트를 동반한다.

### 선행 의존: PR #106 (test coverage hardening)

PR #106이 main에 먼저 머지될 예정이다. 영향 분석:
- **public 진입점(`index.ts`/`index.client.ts`) 미변경** → 미사용 export 386개 목록 불변.
  비테스트 변경은 `infrastructure/ai/extractJsonWithRepair.ts`(파일 레벨 헬퍼 export, public 아님)와
  `vitest.config.ts`뿐이며, PR 1 정리 대상(`domain/utils.ts`·`domain/utils/date.ts`·`prompt.ts`·
  `pickNearestExpiration.ts`·`options/cacheKey.ts`)은 건드리지 않는다 → PR 1 충돌 없음.
- PR #106이 dead 후보 구현(`normalize*`·`build*Prompt`·`enrichAnalysisWithConfidence`·
  `extractJsonWithRepair`)에 추가한 테스트는, 해당 구현이 **전부 내부(submit/poll use-case)에서
  사용**되어 §3-4에 따라 구현이 유지되므로 **함께 유지된다(무효화 없음)**.
- **대응**: PR #106 머지 후 §1 분석 스크립트를 1회 재실행해 386 목록을 재확인하고, 우리 PR들은
  최신 main 위에서 시작한다.

## 6. 문서 동기화

- **`docs/PUBLIC_API.md`** (export 인벤토리 source-of-truth) — 각 PR에서 제거분 반영,
  tier 카운트 갱신.
- **`docs/SCOPE.md` / `docs/DOMAIN.md`** — 제거된 항목이 언급된 부분만 수정.
- **CHANGELOG / release** — semver: public export 제거는 0.x에서 breaking → **minor bump**
  (`PUBLIC_API.md` semver 정책 + MISTAKES.md Public API #3 준수). 첫 public-제거 PR(PR2)에서
  `package.json`을 `0.15.0`→`0.16.0`으로 올리고, 이후 PR은 `0.16.0` 유지(아직 npm publish 전이라
  같은 미래 릴리스에 누적). 실제 npm publish(release)는 전체 PR 머지 후 일괄.

## 7. 리스크 & 대응

| 리스크 | 대응 |
|---|---|
| 타입 제거가 다른 살아있는 타입의 필드를 깸 | tsc가 차단 (절차 §3-4) |
| 컨슈머 분석 누락 | 386 전수 grep + 최종 컨슈머 typecheck 이중 방어 |
| `index.ts` 공유 파일 PR 간 충돌 | PR 순차 머지 |
| 큰 도메인 PR(3·6) 리뷰 부담 | 서브커밋 분할 |
| `PollResult<T>` 도입이 dead Poll 구성요소(`PollOptionsAnalysisDone` 등) 제거와 한 몸 | PR 6에서 일괄 처리(PR 1에서 제외) |

## 부록 A. 미사용 export 386개 (카테고리별)

> 아래는 §1 분석 시점의 전체 목록. 실제 PR에서 §3 절차로 각 심볼이 "완전 삭제" 대상인지
> "export만 제거" 대상인지 확정한다.
## A. 개별 indicator 계산기 (25개) — aggregate `calculateIndicators`로 충분, 개별 직접호출 0
- calculateATR
- calculateBollinger
- calculateBuySellVolume
- calculateCCI
- calculateCMF
- calculateDMI
- calculateDonchianChannel
- calculateEMA
- calculateIchimoku
- calculateIndicators
- calculateKeltnerChannel
- calculateMA
- calculateMACD
- calculateMFI
- calculateOBV
- calculateParabolicSAR
- calculateRSI
- calculateSmc
- calculateSqueezeMomentum
- calculateStochastic
- calculateStochRSI
- calculateSupertrend
- calculateVolumeProfile
- calculateVWAP
- calculateWilliamsR

## B. 개별 signal detector (28개) — aggregate `detectSignals`/`classifyTrend`로 충분
- detectBollingerLowerBounce
- detectBollingerSqueezeBearish
- detectBollingerSqueezeBullish
- detectBollingerUpperBreakout
- detectCandlePattern
- detectCciBullishCross
- detectCmfBullishFlip
- detectDeathCross
- detectDmiBullishCross
- detectGoldenCross
- detectIchimokuCloudBreakout
- detectKeltnerUpperBreakout
- detectMacdBearishCross
- detectMacdBullishCross
- detectMacdHistogramBearishConvergence
- detectMacdHistogramBullishConvergence
- detectMfiOversoldBounce
- detectMultiCandlePattern
- detectParabolicSarFlip
- detectResistanceProximityBearish
- detectRsiBearishDivergence
- detectRsiBullishDivergence
- detectRsiOverbought
- detectRsiOversold
- detectSignals
- detectSqueezeMomentumBullish
- detectSupertrendBullishFlip
- detectSupportProximityBullish

## C. prompt/normalize/cache-key/validate 헬퍼 (34개)
- buildAnalysisCacheKey
- buildAnalysisPrompt
- buildBriefingCacheKey
- buildChatPrompt
- buildFundamentalAnalysisPrompt
- buildMarketBriefingPrompt
- buildNewsAnalysisPrompt
- buildNewsCardAnalysisPrompt
- buildOptionsAnalysisPrompt
- buildOptionsCacheKey
- buildOverallAnalysisPrompt
- classifyTrend
- enrichAnalysisWithConfidence
- extendTrendline
- extractJsonWithRepair
- filterAnalysisResult
- normalizeActionRecommendation
- normalizeCandlePatternSummary
- normalizeFundamentalAnalysisResponse
- normalizeFundamentalSnapshot
- normalizeIndicatorGuideResult
- normalizeKeyLevels
- normalizeMarketBriefing
- normalizeNewsAnalysisResponse
- normalizeNewsCardAnalysis
- normalizeOptionsAnalysisResponse
- normalizeOverallAnalysisResponse
- normalizePatternSummary
- normalizePriceTargets
- normalizeRiskLevel
- normalizeStrategyResult
- normalizeTrend
- normalizeTrendline
- postProcessAnalysisWithReconcile

## D. job queue 원시 함수 (10개)
- cleanupJob
- getJobError
- getJobMeta
- getJobResult
- getJobStatus
- isJobCancelled
- setJobError
- setJobMeta
- setJobResult
- setJobStatus

## E. indicator/signal/tier 상수 (80개)
- ANALYSIS_CACHE_TTL
- ATR_DEFAULT_PERIOD
- BOLLINGER_DEFAULT_PERIOD
- BOLLINGER_DEFAULT_STD_DEV
- CACHE_EXPIRY_HOUR_KST
- CANDLE_PATTERN_DETECTION_BARS
- CANDLE_PATTERN_LABELS
- CCI_BULLISH_CROSS_LEVEL
- CCI_NORMALIZATION_CONSTANT
- CCI_OVERSOLD_CROSS_LEVEL
- CHAT_TOKEN_LIMIT
- CHAT_TOKEN_TTL_SEC
- CMF_BULLISH_CROSS_LEVEL
- CMF_DEFAULT_PERIOD
- CROSS_LOOKBACK_BARS
- DASHBOARD_TIMEFRAME_LABELS
- DASHBOARD_TIMEFRAMES
- DEFAULT_DASHBOARD_TIMEFRAME
- DIVERGENCE_FRESHNESS_BARS
- DIVERGENCE_LOOKBACK_BARS
- DMI_ADX_TREND_THRESHOLD
- DONCHIAN_DEFAULT_PERIOD
- EMA_SUPPORT_RESISTANCE_LONG_INDEX
- EMA_SUPPORT_RESISTANCE_SHORT_INDEX
- EXCLUDED_SINGLE_PATTERNS
- EXPIRATION_SLOTS
- GEMINI_2_5_PRO_MODEL
- GOLDEN_CROSS_FAST_PERIOD
- GOLDEN_CROSS_SLOW_PERIOD
- HISTOGRAM_CONVERGENCE_BARS
- ICHIMOKU_BASE_PERIOD
- ICHIMOKU_CONVERSION_PERIOD
- ICHIMOKU_DISPLACEMENT
- ICHIMOKU_SPAN_B_PERIOD
- KELTNER_ATR_PERIOD
- KELTNER_EMA_PERIOD
- KELTNER_MULTIPLIER
- LLM_PROVIDER_VALUES
- MARKET_BRIEFING_CACHE_TTL
- MARKET_INDICES
- MARKET_SUMMARY_FMP_SYMBOLS
- MEDIUM_CONFIDENCE_WEIGHT
- MFI_DEFAULT_PERIOD
- MFI_OVERSOLD_LEVEL
- MULTI_CANDLE_PATTERN_LABELS
- PIVOT_WINDOW
- PSAR_AF_INCREMENT
- PSAR_AF_MAX
- PSAR_AF_START
- SECTOR_ETFS
- SECTOR_GROUPS
- SECTOR_STOCKS
- SIGNAL_SECTORS
- SMC_ATR_PERIOD
- SMC_DISCOUNT_RATIO
- SMC_EQUAL_LEVEL_ATR_MULTIPLIER
- SMC_PREMIUM_RATIO
- SMC_SWING_PERIOD
- SQUEEZE_LOOKBACK_BARS
- SQUEEZE_MOMENTUM_BB_LENGTH
- SQUEEZE_MOMENTUM_KC_LENGTH
- SQUEEZE_MOMENTUM_KC_MULT
- SQUEEZE_MOMENTUM_MIN_BARS
- SQUEEZE_MOMENTUM_ZERO_CROSS
- SQUEEZE_PCT_B_THRESHOLD
- SQUEEZE_PERCENTILE
- SR_APPROACH_LOOKBACK
- SR_MA_PERIODS
- SR_PROXIMITY_PCT
- SUPERTREND_ATR_PERIOD
- SUPERTREND_MULTIPLIER
- THINKING_BUDGET_FALLBACK_STEPS
- TREND_EMA_PERIOD
- TREND_SLOPE_LOOKBACK
- TREND_SLOPE_THRESHOLD
- UNMATCHED_SKILL_CONFIDENCE_WEIGHT
- VP_DEFAULT_ROW_SIZE
- VP_MIN_BARS
- VP_VALUE_AREA_PERCENTAGE
- WILLIAMS_R_DEFAULT_PERIOD

## F. 타입 — SMC (16개)
- SMC_ATR_PERIOD
- SMC_DISCOUNT_RATIO
- SMC_EQUAL_LEVEL_ATR_MULTIPLIER
- SMC_PREMIUM_RATIO
- SMC_SWING_PERIOD
- SMCBreakType
- SMCEqualLevel
- SMCFairValueGap
- SMCOrderBlock
- SMCResult
- SMCStructureBreak
- SMCStructureDirection
- SMCSwingPoint
- SMCSwingPointType
- SMCZone
- SMCZoneType

## G. 타입 — Fundamental (11개)
- FundamentalAnalysisUsageOptions
- FundamentalCategoryAssessment
- FundamentalFutureDirection
- FundamentalGrowth
- FundamentalHealth
- FundamentalPeer
- FundamentalProfileInput
- FundamentalProfitability
- FundamentalSectorDirection
- FundamentalSnapshot
- FundamentalValuation

## H. 타입 — Submit*/Poll*/Dependency* result 변형 (40개)
- DependencyState
- DependencyStateCached
- DependencyStateError
- DependencyStateMissNoTrigger
- DependencyStatePending
- PollOptionsAnalysisDone
- PollOptionsAnalysisError
- PollOptionsAnalysisProcessing
- SubmitAnalysisErrorResult
- SubmitAnalysisMissNoTrigger
- SubmitAnalysisOptions
- SubmitFundamentalAnalysisApiKeyRequiredError
- SubmitFundamentalAnalysisCached
- SubmitFundamentalAnalysisFetchError
- SubmitFundamentalAnalysisLimitError
- SubmitFundamentalAnalysisMissNoTrigger
- SubmitFundamentalAnalysisSubmitted
- SubmitNewsAnalysisApiKeyRequiredError
- SubmitNewsAnalysisCached
- SubmitNewsAnalysisLimitError
- SubmitNewsAnalysisMissNoTrigger
- SubmitNewsAnalysisNoNewsError
- SubmitNewsAnalysisSubmitted
- SubmitNewsCardAnalysisCached
- SubmitNewsCardAnalysisOptions
- SubmitNewsCardAnalysisSubmitted
- SubmitOptionsAnalysisApiKeyRequiredError
- SubmitOptionsAnalysisCached
- SubmitOptionsAnalysisLimitError
- SubmitOptionsAnalysisMissNoTrigger
- SubmitOptionsAnalysisNoChainsError
- SubmitOptionsAnalysisOptions
- SubmitOptionsAnalysisSubmitted
- SubmitOverallAnalysisApiKeyRequiredError
- SubmitOverallAnalysisCached
- SubmitOverallAnalysisError
- SubmitOverallAnalysisLimitError
- SubmitOverallAnalysisMissNoTrigger
- SubmitOverallAnalysisPendingDependencies
- SubmitOverallAnalysisSubmitted

## I. deprecated 별칭 (의도적 보유였으나 컨슈머 사용 0 → 제거 안전)
- GeminiContent
- GeminiPart
- GeminiRole

## J. 기타 타입/함수/상수 (위 분류 외)
- AnalysisLimitError
- AnalysisLimitErrorCode
- AnalysisUsageOptions
- asArray
- asString
- BackgroundTaskOptions
- BacktestAiAnalysis
- BacktestAiPriceTarget
- BollingerResult
- bucketedTimestamp
- BuildOptionsAnalysisPromptOptions
- CallAiProvider
- CandlePattern
- CandlePatternSummary
- ChartDisplayType
- ChatbotLimitError
- ChatbotLimitErrorCode
- ChatGPTModelSpec
- ChatModel
- ChatPromptPayload
- ChatTokenStore
- checkAnalysisLimit
- checkChatbotLimit
- ClaudeReasoningModelSpec
- ClaudeSamplingModelSpec
- compact
- computeEffectiveTtl
- computeEMAValues
- ComputeFearGreedOptions
- computeStockSignalResult
- ConfirmedSignalType
- ConversationRole
- createSkillsProvider
- CreateUsageLogInput
- CrossDirection
- DMIResult
- DonchianChannelResult
- EtSessionStatus
- ExpectedSignalType
- ExpirationSlot
- ExpirationSlotKey
- FearGreedFactor
- FearGreedGroupName
- FileSkillsLoader
- FilteredActionRecommendation
- FilteredAnalysisResponse
- FilteredAnalysisResult
- findCandlePatternLabel
- FmpConfig
- GeminiModelSpec
- getAllowedTimeframes
- getMarketSummaryWithBriefing
- getTierLimit
- GradesConsensus
- IchimokuResult
- IndicatorGuideResult
- isAllowed
- isClaudeReasoningModelSpec
- isClaudeSamplingModelSpec
- isInfoDepthAllowed
- isModelAllowed
- isReasoningModelSpec
- isSamplingModelSpec
- isTimeframeAllowed
- JobMeta
- JobStatus
- KeltnerChannelResult
- KeyLevel
- KeyLevels
- KeyPrice
- lastNonNull
- LevelSource
- linreg
- lookbackIsoFromNow
- MACDResult
- MarketBriefingSectorAnalysis
- MarketBriefingVolatilityAnalysis
- MarketSummaryWithBriefing
- MultiCandlePattern
- MultiCandlePatternEntry
- NewsAnalysisUsageOptions
- NewsProvider
- NormalizeFundamentalSnapshotInput
- OptionsExpirationFilter
- OptionsPerExpirationCommentary
- OptionsSignal
- OverallDependencyInputs
- ParabolicSARResult
- PatternLine
- PatternSummary
- PriceTarget
- PriceTargetAvg
- PriceTargetConsensus
- PriceTargets
- PriceTargetSummary
- PriceTrend
- PromptConfig
- RawAnalysisResponse
- ReconciledActionLevels
- ReconciledTpEntry
- ReconcileResult
- RequestChatCompletionDependencies
- RequestChatCompletionParams
- RequestChatCompletionResult
- requiresByokKey
- ResolvedLevel
- rollingHighest
- rollingLowest
- RunAnalysisInput
- SectorHistoricalPoint
- SingleCandlePatternEntry
- SkillsProvider
- slidingMax
- slidingMin
- sma
- SqueezeMomentumResult
- stdDev
- StochasticResult
- StochRSIResult
- StrikeOpenInterest
- StrikeVolumeAggregate
- SupertrendResult
- TierConfig
- TierFeatureFlags
- TierFeatureLimits
- TierGateErrorResult
- TierInfoDepth
- TierLimitedFeature
- TierModel
- TierTimeframeAccessError
- TopOiQuote
- TrendDirection
- TrendlinePoint
- TrendState
- typicalPrice
- UsageLimitDependencies
- UsageLimitError
- UsageLimitErrorCode
- UsageLimitInput
- UsageLogRepository
- UserApiKeyRequiredError
- UserTierRepository
- VolumeProfileResult
- VolumeProfileRow

