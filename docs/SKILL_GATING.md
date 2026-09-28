# 스킬 동적 게이팅 (Skill Dynamic Gating)

차트 분석 프롬프트(`buildAnalysisPrompt`)에 주입할 스킬을, **그 차트의 현재 상태**
(감지된 시그널·인디케이터 극단·감지된 캔들 패턴)에 따라 동적으로 선별하는 시스템.

floor 모델(예: `gemini-2.5-flash-lite`)에게 67개 스킬을 전부 주입하면 프롬프트가
비대해지고 무관한 스킬이 분석을 흐린다. 게이팅은 **차트와 관련된 스킬만 선별**해
프롬프트를 줄이고 선택 정밀도를 높인다. 단, 이론적 해석의 손실을 막기 위해 일부
스킬은 항상 주입한다(아래 Tier-0).

> 이 문서는 시스템 **동작**을 설명한다. 스킬 파일을 **작성**하는 방법(frontmatter
> 작성 규칙)은 소비 측 레포의 `siglens/skills/CLAUDE.md`를 참고한다.

관련 코드:
- `src/domain/analysis/selectSkills.ts` — 순수 선별 함수
- `src/domain/analysis/skillGatingPredicates.ts` — textbook state 판정
- `src/domain/signals/confirmed.ts` — event 시그널 detectors (`detectSignals`)
- `src/domain/analysis/prompt.ts` — `buildAnalysisPrompt` 통합·SMC·ATR-extreme
- `src/infrastructure/skills/loader.ts` — frontmatter 파싱
- `src/domain/types.ts` — `SkillGating` / `SkillSelectionContext` 타입

---

## 1. 3-Tier 구조

| Tier | 대상 | 동작 |
|---|---|---|
| **Tier-0 (always_on)** | `gating.tier: always_on` 태그 스킬 + **미태깅 스킬(fail-open)** | 차트 상태와 무관하게 **항상 주입** |
| **Tier-1/2 (gated)** | `gating.tier: gated` 태그 스킬 | 게이트 조건이 발화할 때만 주입 |

- **always_on**: 차트 패턴 가이드, 이론 전략(엘리어트·와이코프·피보나치·다중시간대),
  압축 인디케이터 코어, 캔들 primer, 지지/저항(피보 ext/retr·피봇) 등 — 이론적 해석
  보존을 위해 상시 노출.
- **gated**: 개별 인디케이터/캔들 풀가이드, 일부 전술 전략 — 차트 상태에 따라 선별.
- **미태깅(fail-open)**: `gating` 블록이 없는 스킬은 **항상 포함**한다. 마이그레이션
  안전장치 — 태그가 아직 안 붙은 스킬이 누락되지 않도록 보수적으로 동작한다.

> 결과적으로 "항상 주입되는 바닥(floor)"은 always_on 태그 스킬뿐 아니라 **미태깅
> 스킬 전부**를 포함한다(아래 11. 한계 참조).

---

## 2. HYBRID 게이트 — event=signal / state=textbook

gated 스킬은 두 종류의 게이트 중 하나로 발화한다.

| 종류 | `signal_kind` | 발화 조건 | 근거 |
|---|---|---|---|
| **event** | `event` | `triggers` 중 하나가 **감지된 시그널** 또는 **감지된 캔들 패턴**에 존재 | 교차/플립/돌파 같은 **이벤트**는 `detectSignals` 카탈로그가 잘 잡음 |
| **state** | `state` | textbook 임계 판정(`isStateNotable`)이 참 | 과매수/추세/밴드근접 같은 **지속 상태**는 카탈로그가 희소·비대칭이라 교과서 임계로 판정 |

이 분리가 HYBRID의 핵심이다. event-only로 통일하면 밴드 계열(볼린저·켈트너)에서
시그널 카탈로그의 희소성 때문에 회귀가 생겨, 상태형 지표는 textbook fallback을 쓴다.

---

## 3. Frontmatter 스키마

키는 레포 컨벤션에 따라 **snake_case**다(`confidence_weight`와 일관). 로더가
camelCase `Skill` 필드로 매핑한다.

```yaml
# always_on
gating:
  tier: always_on

# event-gated
gating:
  tier: gated
  signal_kind: event
  triggers: [golden_cross, rsi_oversold]   # detectSignals 카탈로그 or 캔들 패턴명

# state-gated
gating:
  tier: gated
  signal_kind: state
  state:
    feature: bollinger
    predicate: pctB
    hi: 0.98    # 선택 — 생략 시 TF별 기본 임계
    lo: 0.02    # 선택

# 최상위(선택)
token_cost: 0          # 예약 placeholder(현재 미사용 — knapsack 제거됨)
smc_full_guide: true   # SMC 풀가이드 스킬 식별 플래그
```

타입은 `SkillGating` discriminated union(`src/domain/types.ts`):
```ts
type SkillGating =
  | { tier: 'always_on' }
  | { tier: 'gated'; signalKind: 'event'; triggers: string[] }
  | { tier: 'gated'; signalKind: 'state'; state: SkillStatePredicate };
```

---

## 4. `selectSkills` 동작

`selectSkills(skills, ctx)` (`src/domain/analysis/selectSkills.ts`)는 **순수 함수**다.
스킬별로 다음 분기를 적용한다.

| 스킬 상태 | 결과 |
|---|---|
| `gating` 없음(미태깅) | **포함** (fail-open) |
| `tier: always_on` | **포함** |
| `tier: gated`, event | `triggers ∩ (ctx.signals ∪ ctx.detectedCandles) ≠ ∅` 이면 포함 |
| `tier: gated`, state | `isStateNotable(state, ctx)` 가 참이면 포함 |
| 로더가 정규화 실패(malformed) | `gating: undefined`로 떨어져 **fail-open 포함** |

- malformed 게이팅은 로더(`loader.ts`)가 `undefined`로 정규화하므로, selectSkills
  단계에는 **반쪽짜리 gated 형태가 도달하지 않는다**(fail-closed 파싱 → fail-open 선택).
- 선택 결과는 **이름 기준 정렬**: `toSorted((a,b)=>a.name.localeCompare(b.name,'en'))`.
  로케일을 `'en'`으로 고정해 환경에 무관한 결정성을 보장한다(11. 결정성).

`SkillSelectionContext`(ctx)는 이미 계산된 값만 읽는 read-only 컨텍스트:
`indicators`, `signals`(= `detectSignals` 결과), `timeframe`, `detectedCandles`,
`price`(마지막 종가), `atrPercent`.

---

## 5. event 게이팅 — `detectSignals` 카탈로그

`triggers`는 `detectSignals`가 내보내는 `SignalType`(또는 캔들 패턴명)이어야 한다.
카탈로그는 **양방향 대칭**으로, 강세/약세 미러가 쌍을 이룬다(`confirmed.ts`).

전체 `SignalType`(40종 — 32 confirmed + 8 expected):
```
rsi_oversold / rsi_overbought
rsi_bullish_divergence / rsi_bearish_divergence
golden_cross / death_cross
macd_bullish_cross / macd_bearish_cross
macd_histogram_bullish_convergence / macd_histogram_bearish_convergence
bollinger_lower_bounce / bollinger_upper_breakout
bollinger_squeeze_bullish / bollinger_squeeze_bearish
bollinger_percentb_oversold / bollinger_percentb_overbought
supertrend_bullish_flip / supertrend_bearish_flip
parabolic_sar_flip / parabolic_sar_bearish_flip
ichimoku_cloud_breakout / ichimoku_cloud_breakdown
cci_bullish_cross / cci_bearish_cross
dmi_bullish_cross / dmi_bearish_cross
cmf_bullish_flip / cmf_bearish_flip
mfi_oversold_bounce / mfi_overbought_reversal
keltner_upper_breakout / keltner_lower_breakout
squeeze_momentum_bullish / squeeze_momentum_bearish
support_proximity_bullish / resistance_proximity_bearish
new_52w_high / new_52w_low
gap_up / gap_down
```

소비 측(`siglens`)의 `validate-skills` CI가 모든 `triggers`를 이 카탈로그(+ 캔들
패턴 카탈로그)와 교차 검증하며, 컴파일타임 exhaustiveness 가드로 카탈로그 드리프트를
차단한다.

---

## 6. state 게이팅 — textbook 임계 (`isStateNotable`)

`isStateNotable(predicate, ctx)` (`skillGatingPredicates.ts`)는 지표의 **마지막 값**이
교과서적 극단에 도달했는지 판정한다. 결측/null/퇴화 입력은 **`false`**를 반환해
워밍업 부족 지표가 스킬을 잘못 발화시키지 않게 한다.

지원하는 `(feature, predicate)` 쌍과 임계:

| feature | predicate | 임계 |
|---|---|---|
| `bollinger` | `pctB` | %B ≥ hi 또는 ≤ lo. **TF-aware**: 1Day 0.98/0.02, 1Hour 0.95/0.05, 15Min 0.92/0.08 (미지정 TF는 daily-strict) |
| `keltner` | `bandDistAtr` | 밴드 돌파 또는 0.5·ATR 이내 근접 |
| `williamsR` | `level` | ≥ −20(과매수) 또는 ≤ −80(과매도) |
| `stochastic` | `level` | %K ≥ 80 또는 ≤ 20 |
| `stochRsi` | `level` | k ≥ 0.8 또는 ≤ 0.2 |
| `donchian` | `channelProximity` | 채널 돌파 또는 범위의 5% 이내 근접 |
| `vwap` | `bandDistAtr` | |price − VWAP| ≥ 1·ATR. **intraday 전용**(1Day는 항상 false) |
| `buySellVolume` | `ratio` | 매수비율 ≥ 0.65 또는 ≤ 0.35 |

위 목록에 없는 쌍(예: `bollinger:channelProximity`)은 `isStateNotable`이 항상
`false`라 도달 불가능하므로, 로더/검증기가 그런 스킬을 fail-open(미태깅 취급)으로
떨군다.

---

## 7. `buildAnalysisPrompt` 통합

```ts
buildAnalysisPrompt(symbol, companyName, bars, indicators, skills, timeframe, fearGreed?)
```

- **차트 분석 전용**으로 게이팅이 작동한다. 내부에서 `selectSkills(skills, ctx)`를
  호출하므로, **호출자는 전체 스킬 카탈로그를 그대로 넘기면 된다**(직접 selectSkills를
  부르지 않는다). 운영 호출부는 `application/market/submitAnalysis.ts`.
- 뉴스·펀더멘털 프롬프트 빌더는 게이팅 영향을 받지 않는다(차트 한정).
- 선택된 스킬은 이름 정렬 후 `type`별(pattern / strategy / indicator_guide /
  candlestick / support_resistance / regular)로 묶여 주입된다.

---

## 8. 특수 처리

### SMC(Smart Money Concepts)
- SMC 풀가이드 스킬은 **게이팅 tier와 무관하게 드롭**된다(`isSmcGuideSkill` —
  `smc_full_guide: true` 플래그 우선, 이름 매칭 fallback). 결정적 SMC 데이터 섹션이
  유일한 출처가 되도록 하기 위함.
- 대신 최근 `SMC_STRUCTURE_BREAK_RECENCY_BARS`(=10)바 이내에 BOS/CHoCH가 있을 때만
  **압축 개념 노트**(`formatSmcConceptNote`)를 붙인다. `SMC_GUIDE_BLOCKED_NOTICE`가
  "기억에서 SMC 레벨을 지어내지 말 것"을 명시한다.

### ATR-extreme 사이징 노트
- 실현 변동성이 극단이면, gated 사이징 가이드가 발화하지 않아도 포지션 사이징
  맥락이 누락되지 않도록 **always-on 노트**를 덧붙인다.
- 임계는 TF-aware: `ATR_EXTREME_PERCENT_DAILY`(6%) / `ATR_EXTREME_PERCENT_INTRADAY`(2%).
  `selectionContext.atrPercent >= threshold`(이상) 일 때 발화.

### Anti-fabrication 가드레일
- 레벨을 인용하는 모든 섹션(피보나치·지지/저항·피봇)에 `ANTI_FABRICATION_GUARDRAIL`을
  전파해, 프롬프트에 없는 가격 레벨을 지어내거나 반올림·기억 인용하는 것을 금지한다.
  floor 모델의 레벨 날조를 억제하기 위한 장치.

---

## 9. 캐시 fingerprint

스킬 카탈로그가 바뀌면 캐시된 분석이 stale해지므로, 차트/펀더멘털 캐시 키에
**스킬 카탈로그 해시**(`hashSkillCatalog`)를 접는다. 쓰기 시점(submit)과 읽기 시점
(peek)이 동일한 메모이즈된 카탈로그를 같은 해시 함수로 계산해, **read == write**
계약을 보장한다(`infrastructure/cache/config.ts`, `analysisInput.ts`).

---

## 10. 결정성

- `selectSkills`와 `hashSkillCatalog` 모두 `localeCompare(b.name, 'en')`로 정렬해
  입력 순서에 무관하게 **바이트 동일** 결과를 낸다.
- 실측: 30케이스 × 5가지 셔플 입력 순서에서 프롬프트가 모두 바이트 동일(PASS).

---

## 11. 한계

1. **always-on 바닥이 절감 상한을 정한다.** 항상 주입되는 floor는 always_on 태그
   스킬 + 미태깅 스킬(차트 패턴 17 + 펀더멘털 6 등) 전부다. 실측상 스킬 블록 토큰의
   약 **61%**가 floor라, 게이팅이 줄일 수 있는 상한은 약 **39%**다. 더 줄이려면
   미태깅 패턴/펀더멘털 스킬에 `gating`을 부여해야 한다.
2. **선택 충실도 ≠ 분석 품질.** 게이팅은 "관련 스킬을 골랐는가"를 개선할 뿐,
   다운스트림 분석 정확도/수익을 직접 보장하지 않는다(그건 백테스트의 몫).
3. **state vs event FN 바닥.** 지속 상태(state)는 교과서 임계로 판정하므로, 임계
   직하의 경계 상태는 구조적으로 놓칠 수 있다(intrinsic FN floor).
4. `token_cost`는 파싱되지만 미사용(knapsack 제거됨) — 향후 빌드타임 토크나이저
   베이킹용 예약 필드.

---

## 12. 측정 결과 (V6, 독립 오라클 + 실측 tiktoken)

shipped 시스템(`@y0ngha/siglens-core@0.19.0`) 기준, 10티커 × 3TF = 30케이스:

| 지표 | ALL(before) | GATED(after) |
|---|---|---|
| 전체 프롬프트 토큰 | 89,623 | **65,369 (−27.1%)** |
| 스킬 블록 토큰 | 82,539 | 58,284 (**−29.4%**) |
| 선택 정밀도(precision) | 0.36 | **0.85** |
| F1 | 0.51 | **0.75** |
| 결정성 | — | 30×5 바이트 동일 PASS |

게이팅은 프롬프트를 약 27% 줄이면서(케이스당 ≈24k 토큰 절감) 선택 정밀도를
0.36→0.85로 끌어올린다. 오라클은 게이팅 결정이 아닌 중립 차트 다이제스트만 보고
판정해, 자기참조 동어반복을 피했다.
