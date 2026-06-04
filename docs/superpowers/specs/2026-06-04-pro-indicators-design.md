# 전문가/기관용 보조지표 확장 — 설계 스펙

- **작성일**: 2026-06-04
- **상태**: 설계 승인 → 구현 계획(writing-plans) 대기
- **범위**: siglens-core(도메인 계산·게이팅·프롬프트) + siglens(소비 레포: 스킬 문서·검증기·UI 카피·백테스트)
- **선행 문서**: `docs/SKILL_GATING.md`, `docs/superpowers/specs/2026-06-01-group-f-skill-gating-design.md`, `docs/superpowers/specs/2026-05-31-honest-market-reference-layer-design.md`, `docs/superpowers/specs/2026-04-20-multi-signal-backtest-design.md`

---

## 1. 배경 & 목표

기존 보편 보조지표 26종(RSI·MACD·Bollinger·DMI·Ichimoku·Supertrend·SMC·Fear&Greed 등)은 이미 구현돼 있다. 4-스트림 리서치(TradingView·인터넷·학술·서적, Opus 4.8 에이전트 병렬)로 **전문 트레이더·기관·퀀트가 신뢰·사용하지만 아직 없는** 지표를 선별했다.

리서치 합의(4/4 소스) 최상위 2종은 **상대강도(벤치마크 대비 RS)** 와 **Kaufman Efficiency Ratio**였고, 둘 다 메모리의 두 약점을 메운다:

- **Group B**: 레벨 계열(S/R·추세·피봇·추세선)은 백테스트상 forward edge ≈ 0 → "레벨 추가"가 아니라 **검증된 edge 지표 + 레짐 게이트**가 정답.
- **Group F**: 차트 프롬프트가 66/67 스킬을 무차별 주입 → 신규 스킬은 전부 **게이팅**해 관련 상태에서만 발화.

### 목표
1. 엄선된 전문가용 보조지표를 siglens-core 도메인에 **순수 함수로 직접 구현**(외부 라이브러리 금지).
2. **실증(forward-edge) 검증**으로 각 지표의 ① 사용가치 ② 구현 로직 정확성을 입증한 뒤에만 통합.
3. 통과 지표를 **기술적분석 프롬프트**에 추가하고, **게이팅 스킬 문서**(`siglens/skills/indicators/`)로 작성.
4. 소비 레포(siglens)의 영향 범위(검증기·UI 카피 등)도 함께 수정.

---

## 2. 확정된 의사결정 (사용자 합의)

| # | 결정 | 내용 |
|---|---|---|
| D1 | 검증 방법론 | **오프라인 per-지표 forward-edge 스크리닝**(LLM 비용 0·결정적). AI 백테스트 재실행 아님 |
| D2 | 실증 목적 | ① 사용가치(edge) ② 구현 로직 정확성(실데이터 sanity → 통합 전 버그 차단) |
| D3 | 테스트 | branch coverage **90%+**, Happy Path + **Worst Case** 필수 |
| D4 | 데이터 | FMP 실데이터(`../siglens/.env.local` 키), ~1년+워밍업, **3 TF: 1Day·1Hour·15Min** |
| D5 | 캐시(검증) | **파일 캐시** — 1회 수집 후 재사용(매 실증 재fetch 금지) |
| D6 | FMP 에러 | 실패 시 **60초 대기 후 재시도**, 그래도 실패하면 해당 (ticker,tf) 스킵+로깅 |
| D7 | RS 범위 | **이번에 포함**(벤치마크 배선 구축) |
| D8 | 벤치마크 | 미국 주식 한정 — **SPY(시장) + 섹터 ETF**. 섹터는 종목 프로필 sector → ETF 매핑 |
| D9 | 벤치마크 캐시 | **Redis Cache 핵심** — 기존 `bars:{SYMBOL}:{TF}` 키 + `computeBarsEffectiveTtl` 그대로 재사용(B1) |
| D10 | 구조 | **A1**(검증 우선·단일 스펙·다단계 플랜) / **B1**(core-side RS·동일 Redis 키) / **C1**(검증 하네스 = siglens-core/scripts) |
| D11 | KAMA | **드롭** — Kaufman ER 이미 구현·프롬프트 노출 중이라 중복 |

---

## 3. 지표 카탈로그 & 범위

### 3.1 이미 구현됨 (재구현 X)
- **Kaufman Efficiency Ratio** — `domain/analysis/trendStructure.ts` 계산 + 프롬프트 `efficiency`·`regime` 노출 중. 재사용.
- **Anchored VWAP(계산)** — `domain/analysis/anchoredVwap.ts` 함수 존재. 이번엔 **프롬프트 노출 + 앵커 자동선택 + 스킬 + 게이팅**만(경량).
- **KAMA** — 드롭(D11).

### 3.2 신규 빌드 목록 (15종) + 잠정 게이팅
> 게이팅 타입은 **잠정** — Phase 2 실증에서 edge가 약하면 *gated signal → advisory*로 강등(Group B 교훈).

| # | 지표 | 분류 | 입력 | 재사용 | 잠정 게이팅 |
|---|---|---|---|---|---|
| 1 | MACD-V | 모멘텀(변동성정규화) | OHLCV | MACD+ATR | state `macdV:level` (±150) |
| 2 | Bollinger %B | 변동성 | OHLCV | Bollinger | **기존** state `bollinger:pctB` 재사용 |
| 3 | Bollinger BandWidth | 변동성 | OHLCV | Bollinger | **기존** event `bollinger_squeeze_*` 재사용 |
| 4 | Connors RSI | 평균회귀 | OHLCV | RSI | state `connorsRsi:level` (10/90) |
| 5 | Elder Force Index | 거래량모멘텀 | OHLCV | EMA | event `force_index_*_flip` (신규) |
| 6 | Elder-Ray (Bull/Bear Power) | 모멘텀 | OHLCV | EMA | event `elder_ray_*` (신규) |
| 7 | Elder Impulse System | 추세/모멘텀 상태 | OHLCV | EMA+MACD | event `elder_impulse_*_flip` (신규) |
| 8 | Chandelier Exit | 변동성 스톱 | OHLCV | ATR | event `chandelier_*_flip` (신규) |
| 9 | Yang-Zhang 변동성 | 변동성 측정 | OHLC | — | advisory (+vol-extreme state 후보) |
| 10 | EWMA 변동성 | 변동성 측정 | OHLC | — | advisory (RiskMetrics λ=0.94) |
| 11 | Hurst (DFA/modified R/S) | 레짐 | close | — | state `hurst:level` (≥0.55/≤0.45) |
| 12 | Variance Ratio (Lo-MacKinlay) | 레짐 | close | — | state `varianceRatio:level` (≥1.2/≤0.8) |
| 13 | 회귀 R²/slope | 추세품질(통계) | close | `linreg` util | advisory |
| 14 | 상대강도 RS (Mansfield·RS Line·IBD스코어·섹터RS) | 상대강도 | OHLCV+벤치마크 | — | advisory (+`rs:level` state 후보) |
| 15 | Anchored VWAP 노출 | 거래량가중 | OHLCV | `anchoredVwap.ts` | state `avwap:bandDistAtr` 후보 |

---

## 4. Phase 0 — 검증 하네스

### 4.1 레이아웃
```
siglens-core/
  scripts/validation/
    fetchData.ts        # FMP fetch(../siglens/.env.local 키) + 파일 캐시 + 60s 재시도
    run.ts              # 러너: 지표별 forward-edge + sanity → 리포트
    .cache/             # {symbol}_{tf}.json  (gitignore)
    reports/            # {indicator}.md / summary.json  (커밋 — 의사결정 근거 보존)
  src/domain/validation/   # 순수 통계(테스트 90%)
    forwardEdge.ts  baseline.ts  sanity.ts
```
**원칙(C1)**: I/O(fetch·파일·env)는 `scripts/`에만. 측정 수학은 `domain/validation/`(순수·테스트).

### 4.2 데이터 수집 + 파일 캐시
- 10티커(AAPL·AMZN·AVGO·GOOGL·LLY·META·NVDA·PLTR·TSLA·WMT) × {1Day,1Hour,15Min} × ~1년(+워밍업) + 벤치마크(SPY·QQQ·11 섹터 ETF)
- 엔드포인트: daily=`historical-price-eod/full`, intraday=`historical-chart/{15min|1hour}`. ET→UTC 변환은 `FmpMarketProvider` 로직 미러.
- 캐시: `{symbol}_{tf}.json` 1회 수집 후 재사용. `--refresh`로 강제 재수집(D5).
- **FMP 에러**: 60s 대기 후 재시도, 재실패 시 (ticker,tf) 스킵+커버리지 로깅(D6). intraday lookback 한도는 가용분만 + 리포트 표기.

### 4.3 순수 forward-edge 통계
신호 트리거 인덱스 + 전방 horizon `h`:
- **hit-rate**: `(close[i+h]−close[i])/close[i]`가 신호 방향(bull→>0)인 비율
- **평균/중앙 전방수익**
- **baseline 대비 excess** ⭐: 무조건 base-rate(전체 봉 전방수익)와 비교 → 상승장 드리프트 제거. `excess = signal − baseline`
- **표본수 n + t-stat**(excess 평균/표준오차)
- **다중 horizon**: daily {5,10,20} / 1h {6,12,24} / 15m {8,16,32}, 방향 대칭(bull/bear)
- **look-ahead 차단**: 지표 인과(causal) 시리즈 **1회 계산** 후 per-bar 스캔으로 트리거 도출(O(n)). 각 값은 ≤i 데이터만 사용.

### 4.4 지표 유형별 검증
| 유형 | 검증 |
|---|---|
| 방향 신호(MACD-V·Connors·Force·Elder·Chandelier·RS) | forward-edge(excess·t-stat) |
| 레짐 게이트(Hurst·VR·ER) | **조건부 edge** — 기존 신호 edge가 레짐 필터로 개선되는지 |
| 측정형(Yang-Zhang·EWMA·R²) | forward-edge 아님 → **정확성/sanity**(범위·NaN·워밍업 + 실현변동성 관계) |

### 4.5 두 갈래 실증 (D2)
1. **사용가치**: 4.3/4.4 edge 지표
2. **로직 정확성**: 실데이터로 NaN/Inf 없음·워밍업 null 정확·값 범위 정상(%B≈0~1, RSI 0~100, Hurst 0~1, ER 0~1) + 스펙 기준치 spot-check → 통합 전 버그 차단

### 4.6 리포트 + 잠정 통과 기준
- `reports/{indicator}.md`: TF×horizon별 excess·n·t-stat·baseline·sanity + 판정(signal / advisory / fix-needed)
- **잠정 통과 규칙(Phase 2에서 사용자와 재확정)**: 최소 1개 TF/horizon에서 excess>0 & |t|≥2 & n 충분(예: n≥30) → *signal*; 그 외 → *advisory*; 측정형은 정확성만으로 통과
- **결정성**: 같은 캐시 → 같은 리포트(통계에 Date.now 미사용)

---

## 5. Phase 1 — 도메인 구현

### 5.1 레이아웃 (domain/CLAUDE.md 준수)
```
src/domain/indicators/
  macdV.ts  bollingerDerived.ts  connorsRsi.ts  forceIndex.ts
  elderRay.ts  elderImpulse.ts  chandelierExit.ts  yangZhang.ts
  ewmaVolatility.ts  hurst.ts  varianceRatio.ts  regression.ts
  constants.ts(확장)  index.ts(export + calculateIndicators 배선)
src/domain/types.ts          # 신규 Result 인터페이스 + IndicatorResult 필드
src/domain/analysis/anchoredVwap.ts  # 앵커 자동선택 추가
```
**규칙**: 순수함수·외부 import 금지·계산 직접 구현·워밍업 `null`·명시적 반환타입·매직리터럴 금지·입력 불변. O(N²) 유발 시 누산기 for-loop 허용.

### 5.2 함수 시그니처 + 공식
| 지표 | 시그니처(개략) | 재사용 | 공식 핵심 |
|---|---|---|---|
| MACD-V | `calculateMacdV(bars,12,26,26)` | MACD+ATR | (EMA₁₂−EMA₂₆)/ATR₂₆×100 |
| %B/BandWidth | `calculateBollingerDerived(bars)` | Bollinger | %B=(C−L)/(U−L); BW=(U−L)/M |
| Connors RSI | `calculateConnorsRsi(closes,3,2,100)` | RSI | avg(RSI₃, RSI(streak)₂, pctRank(ROC₁)) |
| Force Index | `calculateForceIndex(bars,13)` | EMA | EMA₁₃((C−Cₚ)·V) |
| Elder-Ray | `calculateElderRay(bars,13)` | EMA | {bull:H−EMA, bear:L−EMA} |
| Elder Impulse | `calculateElderImpulse(bars,13)` | EMA+MACD | EMA기울기 ∧ MACD-hist기울기 → green/red/blue |
| Chandelier | `calculateChandelierExit(bars,22,3)` | ATR+slidingMax/Min | HH−3·ATR / LL+3·ATR + trend |
| Yang-Zhang | `calculateYangZhang(bars,n)` | — | overnight+open-close+Rogers-Satchell |
| EWMA vol | `calculateEwmaVolatility(closes,0.94)` | — | σ²ₜ=λσ²ₜ₋₁+(1−λ)r²ₜ |
| Hurst | `calculateHurst(closes,window)` | — | DFA / Lo-modified R/S |
| Variance Ratio | `calculateVarianceRatio(closes,q,window)` | — | Var(q-ret)/(q·Var(1-ret)) |
| 회귀 R²/slope | `calculateRegression(closes,n)` | `linreg` 확장 | OLS slope + R² |
| AVWAP 앵커 | `selectAnchor(bars,swings)` | `anchoredVwap`+SMC swing | 최근 유의 swing/기간 고저 |

### 5.3 IndicatorResult 배선
- per-bar 13종 → `IndicatorResult` 필드 추가 + `calculateIndicators(bars)`에서 계산.
- **RS(#14)는 예외** — 벤치마크 필요 → `calculateIndicators` 밖, Phase 4의 `computeRelativeStrength` 별도 경로.
- 신규 Result 인터페이스는 기존 ~20개 지표처럼 `domain/types.ts`에.

### 5.4 테스트 (90% branch, happy + worst)
- 필수 케이스: 빈 배열 / period 미만 / 초기 null 구간 / 유효값 구간 / 첫 계산값 정확도
- **Worst case**: NaN·Inf, 0 거래량, flat 시리즈(분산 0 → 0나눗셈 가드), 단일 봉, 전부 동일가, 극단치, gap, 음수가 방어. division-by-zero·로그 정의역·표준오차 0 분기 전부 커버.
- 위치: `src/__tests__/domain/indicators/*.test.ts`, `src/__tests__/domain/validation/*.test.ts`

---

## 6. Phase 2 — 실증 실행 & 결정 게이트

- Phase 1 계산을 Phase 0 하네스로 돌려 지표×TF×horizon별 리포트 생성.
- **사용자와 함께 포함/프레이밍 확정**(게이트): signal / advisory / fix-needed / drop.
- 약 edge → advisory로 강등(프롬프트엔 "검증된 예측자 아님" 프레이밍으로 잔존). 둘 다(무용+중복)면 drop 검토.

---

## 7. Phase 3 — 게이팅 & 프롬프트 통합

### 7.1 신규 event SignalType (8종, 양방향 미러)
`confirmed.ts` + `SignalType` union + `signals/constants.ts` + `signals/index.ts` 등록. `findCross`/`findThresholdCross` 재사용.

| 지표 | bullish / bearish | 발화 |
|---|---|---|
| Force Index | `force_index_bullish_flip` / `force_index_bearish_flip` | 0선 교차 |
| Elder-Ray | `elder_ray_bullish` / `elder_ray_bearish` | Bull Power 0 상향 / Bear Power 0 하향 |
| Elder Impulse | `elder_impulse_bullish_flip` / `elder_impulse_bearish_flip` | 색 전환(→green/→red) |
| Chandelier | `chandelier_bullish_flip` / `chandelier_bearish_flip` | 스톱 플립 |

### 7.2 신규 state feature (4종, predicate=`level` 재사용)
`SkillStateFeature` union + `isStateNotable` switch + `skillGatingPredicates.ts` 평가자 + IndicatorResult 필드. **신규 predicate kind 안 만듦**.

| feature | 임계(기본 hi/lo) |
|---|---|
| `macdV` | ≥150 / ≤−150 |
| `connorsRsi` | ≥90 / ≤10 |
| `hurst` | ≥0.55 / ≤0.45 |
| `varianceRatio` | ≥1.2 / ≤0.8 |

> 후보 state feature(`avwap`, `rs`, vol-extreme)는 Phase 2 검증 통과 시 추가 — 위 4종에 합류.

### 7.3 기존 게이트 재사용 (신규 코드 ~0)
- %B → `state: {bollinger, pctB}` / BandWidth·스퀴즈 → `bollinger_squeeze_bullish/bearish` event

### 7.4 advisory
Yang-Zhang·EWMA·R²·RS·(AVWAP) → 프롬프트 노출 + "검증된 예측자 아님" 프레이밍(MARKET_REFERENCE_FRAMING 스타일). 스킬 `always_on`(또는 무게 낮춤). Phase 2 강등 지표도 여기로.

### 7.5 프롬프트 렌더링 (prompt.ts)
- `formatIndicatorSection`(`## Indicator Values`)에 오실레이터형 라인 추가(MACD-V·%B·BandWidth·Connors RSI·Force Index·Elder-Ray·Elder Impulse·Chandelier).
- 신규 advisory 블록 `## Volatility & Regime (deterministic · advisory)`: Yang-Zhang·EWMA·Hurst·VR·R².
- `## Relative Strength` 블록 = Phase 4.
- `SkillSelectionContext`는 `indicators`를 이미 넘기므로 state predicate용 신규 ctx 필드 불필요.

### 7.6 스킬 문서 (siglens/skills/indicators/*.md)
지표별 마크다운 + frontmatter(`type: indicator_guide`, `indicators`, `confidence_weight`, `gating`, `token_cost: 0`). event 스킬은 7.1 트리거, state 스킬은 7.2 쌍 참조.

---

## 8. Phase 4 — RS · 벤치마크 아키텍처

### 8.1 섹터 해석 (종목 → 섹터 → ETF)
- core `submitAnalysis`가 주입된 `FundamentalDataProvider.getCompanyProfile(symbol)`로 `sector` 획득(Redis 캐싱).
- 신규 순수 매핑 `FMP_SECTOR_TO_ETF`(domain, 11쌍). 매핑 실패/누락 시 **SPY fallback**.
- 벤치마크 = SPY(시장) + 섹터 ETF. (QQQ 대안 여지만, 기본 SPY.)

### 8.2 벤치마크 bars fetch + Redis 캐시 (B1, D9)
- core `submitAnalysis`가 벤치마크 bars(동일 TF)를 주입된 `marketDataProvider.getBars`로 가져오되, **신규 core 헬퍼 `getCachedBars`**로 감싸 **소비레포와 동일 키 `bars:{SYMBOL}:{TF}` + `computeBarsEffectiveTtl` + shouldCache(len>0)** 사용 → Redis 공유.
- **키/TTL 패리티 테스트** 필수(소비레포 `buildBarsKey`와 동일).
- 실패 시 graceful degrade(RS 섹션 생략, 분석 진행).

### 8.3 RS 계산 (domain 순수) `computeRelativeStrength(stockBars, benchmarkBars, sectorBars?, tf)`
- **RS Line** = 종목/벤치마크 비율(타임스탬프 교집합 정렬, 휴장·gap 처리)
- **Mansfield RS** = ((RS/SMA(RS,n))−1)×100, 제로센터. TF-aware n(일봉 252≈52주 1차).
- **IBD식 가중-ROC 스코어**(63/126/189/252일, 최근분기 2배). ⚠️ 1–99 percentile은 유니버스 필요 → 범위 외(스코어+라인만).
- **섹터 RS** = 종목/섹터ETF + Mansfield(섹터 대비).
- 결과 타입 `RelativeStrengthResult`(domain/types.ts).

### 8.4 프롬프트 통합
- `buildAnalysisPrompt`에 선택 인자 `relativeStrength?` 추가(순수 렌더만). `## Relative Strength` 섹션 + advisory 프레이밍.
- 게이팅: 기본 advisory. 검증 통과 시 `rs:level` state 후보.

### 8.5 캐시 fingerprint
- 벤치마크는 symbol에서 결정적 → 키 신규 차원 불필요. 신규 RS 스킬 추가로 `skillFingerprint` 변경 → 기존 캐시 자연 무효화. (안전 위해 prompt 버전 bump 옵션.)
- `submitAnalysisAction`은 옵션에 `fundamentalDataProvider`만 내부 추가(클라이언트 시그니처 불변).

---

## 9. 소비 레포(siglens) 수정 범위

### 9.1 수동 수정 필요
| 파일 | 수정 |
|---|---|
| `scripts/validate-skills.ts` | `SIGNAL_CATALOG`에 신규 event 8종 + state 유효쌍 4종 (exhaustiveness 가드가 tsc로 강제) |
| `scripts/__tests__/validate-skills.test.ts` | 신규 카탈로그 케이스 |
| `skills/CLAUDE.md` | 시그널 카탈로그 표 + state 유효쌍 표 |
| `skills/indicators/*.md` | 신규 스킬 문서(Phase 3) |
| `widgets/symbol-page/hooks/useAnalysisProgress.ts` | `ANALYSIS_PHASES`·`ANALYSIS_TIPS`의 "20개/60개" → **질적 표현 or 동적화**(레포 컨벤션) |
| `widgets/symbol-page/__tests__/*` | 문구/길이 단언 동기화 |
| `scripts/backtests/generate-backtest.ts` | 벤치마크 fetch + `buildAnalysisPrompt` 신규 인자(Phase 4) |
| 분석 경로 테스트 fixtures(`FakeMarketProvider` 등) | 벤치마크(SPY) bars 제공 |

### 9.2 자동 반영 (검증만)
- `shared/lib/skillStats.ts` 기반 `skillCounts.*` → page.tsx·HowItWorks·[symbol]/page.tsx SEO 카피 자동 갱신.
- `manifest.ts`·`seo.ts` → 의도적 질적 표현, 무변경.
- `submitAnalysisAction` 클라이언트 시그니처 불변(B1).

### 9.3 크로스-레포 머지 규율
core(SignalType·SkillStateFeature·isStateNotable) ↔ 소비레포(validate-skills `SIGNAL_CATALOG`·스킬 문서)는 같은 사이클로. 순서: core 발행/링크 → 소비레포 카탈로그+스킬 → `yarn validate:skills` + `tsc` 통과.
- core 문서 `SKILL_GATING.md` §5/§6 표도 갱신.

---

## 10. 시퀀싱

각 Phase = 독립 구현 → review-agent → mistake-managing-agent → git-agent 사이클.

1. **Phase 0** 검증 하네스 (도메인 통계 + 스크립트)
2. **Phase 1** 지표 계산 + 테스트(90% happy+worst)
3. **Phase 2** 실증·리포트 → **사용자와 포함/프레이밍 확정(게이트)**
4. **Phase 3** 통합(게이팅·프롬프트·스킬 + 소비레포 검증기/UI)
5. **Phase 4** RS(벤치마크 fetch·Redis캐시·섹터매핑·프롬프트)

---

## 11. 테스트 & 결정성

- 도메인/애플리케이션 **90% branch**, happy+worst.
- `yarn validate:skills` CI / 크로스레포 tsc(SignalType 가드).
- **프롬프트 결정성**(바이트 동일) / **bars 캐시 키 패리티**(core↔소비레포) / RS 타임스탬프 정렬 엣지.

---

## 12. 리스크 & 완화

| 리스크 | 완화 |
|---|---|
| FMP intraday lookback 한도 | 가용분만 + 커버리지 리포트 / FMP 실패 시 60s 대기 후 재시도(D6) |
| FMP 섹터명 정규화 불일치 | `FMP_SECTOR_TO_ETF` 표 + SPY fallback |
| SignalType 카탈로그 드리프트 | tsc exhaustiveness 가드가 빌드 차단(자동) |
| 프롬프트 비대화(Group F) | 신규 스킬 전부 게이팅 → 관련 상태에서만 발화 |
| look-ahead(RS·검증) | 벤치마크 as-of 정렬, ≤i 데이터만 |
| 검증이 지표를 강등 | 설계상 의도(advisory 이동). Phase 2에서 사용자 확정 |

---

## 13. 미해결/후속

- **IBD RS percentile rank(1–99)**: 종목 유니버스 필요 → 범위 외(스코어+라인만 제공).
- **QQQ 시장 벤치마크 대안**: 일단 SPY 단일, 필요 시 후속.
- **Phase 2 결정 게이트**: 실증 결과에 따라 §3.2 게이팅·포함 목록이 변동될 수 있음(예상된 동작).
