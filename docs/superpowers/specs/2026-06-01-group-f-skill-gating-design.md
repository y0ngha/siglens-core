# Group F — 차트 프롬프트 스킬 동적 선택 (Skill Dynamic Gating)

> **상태**: 설계 합의 완료(2026-06-01). 11개 실측·적대감사로 검증. 구현 전.
> **다음 단계**: 이 spec 검토 → `writing-plans`로 PR별 구현 플랜 작성.

## 목표 (Goal)

차트 분석 프롬프트가 매 분석마다 무조건 주입하는 ~66개 스킬을, **차트 상태에 따라 관련 있는 것만 동적으로 선택**해 주입한다. floor 모델(gemini-2.5-flash-lite 등)의 분석 품질을 높이고(무관 스킬의 distraction 제거) 토큰을 줄인다.

## 동기 (측정된 현재 상태)

현재 selector는 `src/domain/analysis/prompt.ts`의 한 줄이다:

```ts
const activeSkills = skills.filter(s => s.confidenceWeight >= MIN_CONFIDENCE_WEIGHT).toSorted(byName);
```

- **per-case 게이팅 0**: 67개 중 1개(wyckoff@0.0)만 빠지고 66개가 *모든* 차트에 무조건 주입된다(종목·타임프레임·지표값 무관, 측정상 스킬블록 byte-identical).
- regime 누수 60/60 케이스(추세장에도 평균 3.9개의 역-regime 전략 주입).
- ~89K 토큰 프롬프트의 **92%가 정적 스킬블록**.

조사1(학술): 무관/과잉 컨텍스트는 floor 모델 추론을 떨어뜨린다("Lost in the Middle", Shi et al. distraction, RAG-MCP). 가지치기는 비용뿐 아니라 품질을 올린다.

## 핵심 원리: **event = signal / state = textbook**

게이팅의 근간 원리(v3 측정으로 확정):

- **이벤트형 신호**(cross·flip·breakout) → 기존 `domain/signals/detectSignals()` 카탈로그로 게이팅
- **상태형 notable**(과매수·추세지속·밴드근처) → textbook *state* 임계값으로 게이팅

이유: `detectSignals`는 *이벤트*(드물고 순간적)를 감지하는데, 실제 분석에 notable한 것은 *상태*(지속적)인 경우가 많다. 이벤트만으로 게이팅하면 지속 상태를 놓친다(예: keltner를 signal로 게이팅 시 FN 105 vs textbook band-position 49).

---

## 아키텍처: 3-Tier

### Tier 0 — Always-on (게이팅 없이 항상 주입)
| 항목 | 비고 |
|---|---|
| 차트패턴 17개 | 감지기 없음 → 상시노출 (사용자 결정). 토큰 비용 수용 |
| 이론전략 4개 | elliott-wave, wyckoff, fibonacci, multi-timeframe. 데이터 게이팅 불가(분석 렌즈) → 상시노출(이론적 해석 보존, 오용 위험 수용) |
| 압축 지표코어 | 계산된 지표마다 ~1줄(이름+임계 의미). **단 Ichimoku·SMC는 풀 유지**(다컴포넌트라 1줄 압축 시 핵심 손실 — 감사 C) |
| 캔들 읽기 primer | 반전·지속·관망 패밀리 + "감지 목록만 해석" |
| Fib + S/R 가이드 | Fib는 메모리상 유일하게 forward-edge 있는 레벨류 |
| 안티-날조 가드레일 | "제공된 레벨만 인용, 발명 금지" |
| ATR-extreme sizing 노트 | ATR%≥6(일)/≥2(intraday)일 때만 조건부 승격 — 고변동 sizing 정보 손실 방지(extreme-ATR retention 100%) |
| 계산 SMC 섹션 | `formatSMCSection` 항상 렌더 = 날조 1차 방어(앵커) |

### Tier 1 — 게이팅 (지표·캔들 풀 가이드)
- **지표 풀 가이드**: 그 지표가 notable일 때만 (event=signal / state=textbook, 아래 §게이팅 메커니즘)
- **캔들 개별 풀 가이드**: 그 캔들이 실제 감지될 때만

### Tier 2 — 게이팅 (전략)
| 전략 부류 | 게이팅 |
|---|---|
| 전술(breakout·divergence·mean-reversion) | `detectSignals` 신호 (breakout⟸`*_breakout` / divergence⟸`*_divergence` / mean-reversion⟸`rsi_oversold|overbought` + bollinger 밴드신호, **단 `bollinger_upper_breakout` 제외** = regime 누수 방지) |
| 대순환(ma-cycle·macd-cycle) | MA/MACD 배열 **스테이지 계산**(또는 golden/death·macd cross) |

### 제거 (dead — 적대감사 logic에서 실데이터상 inert 확인)
MMR(λ) · confluence 보너스 · familyDiversityBoost · regime soft-multiplier · membership-floor 휴리스틱.

---

## 게이팅 메커니즘 상세

### 이벤트형 (signal-driven) — `detectSignals` 카탈로그
지표 풀 가이드가 해당 지표를 named하는 신호가 카탈로그에 있으면 로드:
- RSI ⟸ `rsi_oversold|overbought|*_divergence`
- MACD ⟸ `macd_*_cross | macd_histogram_*_convergence`
- CCI ⟸ `cci_*_cross` · DMI ⟸ `dmi_*_cross` · CMF ⟸ `cmf_*_flip` · MFI ⟸ `mfi_*` · Supertrend/SAR ⟸ flips
- Ichimoku는 Tier-0(풀)

### 상태형 (textbook-driven) — 카탈로그가 under-cover하는 지표
| 지표 | textbook 임계값 |
|---|---|
| Bollinger | %B ≥0.98/≤0.02 (일) · 0.95/0.05 (1h) · **0.92/0.08 (15m)** |
| Keltner | price가 채널 상/하단의 0.5·ATR 이내 또는 이탈 |
| Williams %R | ≥-20/≤-80 |
| Stochastic | %K ≥80/≤20 |
| StochRSI | ≥0.8/≤0.2 |
| Donchian | 채널 고/저 근접·도달 |
| VWAP | \|dist\| ≥1·ATR (intraday only; 0.010/0.012/0.015) |
| **buySellVolume** | buy/sell ratio ≥0.65 또는 ≤0.35, 또는 가격-볼륨 divergence |

> **buySellVolume**: 필드 `IndicatorResult.buySellVolume[last] = {buyVolume, sellVolume}`, `ratio = buyVolume/(buyVolume+sellVolume)`. (v2에서 이 fallback 추가로 FN 230→16, precision 0.982)

### detectSignals 보강 (PR 선행 작업 — v3 측정으로 효과 확정)
현재 `confirmed.ts` 카탈로그는 **bullish 편향**(17개 중 4개만 양방향). signal-driven 지표가 하락장에서 신호가 안 나 FN 발생. 보강:

1. **양방향 대칭화** — bearish 짝 9개 추가:
   `keltner_lower_breakout` · `supertrend_bearish_flip` · `ichimoku_cloud_breakdown` · `cci_bearish_cross` · `dmi_bearish_cross` · `cmf_bearish_flip` · `mfi_overbought_reversal` · `parabolic_sar_bearish_flip` · `squeeze_momentum_bearish` (각각 `confirmed.ts`의 bullish 로직을 반대 방향 미러, `CROSS_LOOKBACK_BARS` 윈도우)
2. **mfi fix** — `detectMfiOversoldBounce`의 1봉 검사를 `findThresholdCross(mfi, MFI_OVERSOLD_LEVEL, CROSS_LOOKBACK_BARS, 'up')`로 일관화(현재 0회 발화) + overbought-reversal 미러

효과(v3): 하락장 FN −23%(388→299), precision 0.471→0.492(과다포함 아님), 회귀 0.
**단 Keltner·Bollinger는 textbook 유지**(대칭화해도 signal FN 105 > textbook 49 — band-proximity는 상태형).

---

## frontmatter 스키마 확장

각 기술 스킬에 게이팅 메타데이터를 추가(수동 작성, 67개 파일):
```yaml
gating:
  tier: always_on | gated          # always_on이면 무조건 주입
  triggers: [rsi_oversold, ...]     # detectSignals 카탈로그 신호명 (event형)
  state: { feature: bollinger, predicate: pctB, hi: 0.98, lo: 0.02 }  # textbook (state형)
  signal_kind: event | state        # 게이팅 경로 선택
token_cost: 850                     # 빌드타임 precompute (tokenizer는 domain 금지)
```
- 새 전략 추가 = frontmatter `triggers`에 카탈로그 신호명 추가(기존 신호면 코드 0). 새 신호 종류가 필요할 때만 `detectSignals`에 코드 추가.

---

## selectSkills — 순수 domain 함수 (레이어 경계)

```ts
// src/domain/analysis/selectSkills.ts  (PURE — no I/O, no Date.now, no process.cwd)
export function selectSkills(skills: Skill[], ctx: SkillSelectionContext): Skill[]
```
- 입력: 이미 로드된 `Skill[]`(frontmatter 메타 포함) + 이미 계산된 features/signals/regime 컨텍스트(둘 다 `buildAnalysisPrompt`에 이미 in-scope).
- I/O는 전부 infrastructure: 파일 읽기·frontmatter 파싱은 `FileSkillsLoader`(loader), `token_cost`용 tokenizer는 **빌드 스크립트로 frontmatter에 baking**(domain에 tokenizer 금지).
- 결정성: id total-order tie-break. loader는 name dedup.
- **스코핑**: selector는 `buildAnalysisPrompt`(차트) 안에서만 호출. `loadSkills`/news/fundamental에 적용 금지(이들은 `category`로 unfiltered 배열을 필터 — 차트 selector가 전역 적용되면 type-less news/fundamental 6개가 사라짐).

## TF-aware 보정
- bandwidth/squeeze percentile 윈도우: 일 60 / 1h 120 / 15m 180 봉
- ADX regime hysteresis(enter/exit): 일 27/23 · 1h 28/22 · 15m 30/22
- 15분 mean-reversion 한 단계 엄격(위 %B 0.92/0.08 포함)

## SMC 처리 (실측3)
- **풀 가이드(13KB) 절대 주입 금지** → 압축 5줄 개념 노트(BOS/CHoCH ≤10봉일 때만)
- 렌더 스킬의 **placeholder 예시 숫자 제거**(예: `$183.00–$184.20` — floor 모델이 실제 레벨로 베끼는 leak 원천)
- 안티-날조 가드레일을 **모든 레벨-인용 스킬(Fib·S·R·pivot)에 전파**

---

## 통합 가드레일 (감사 C — ship 전 필수 blocker)

1. **차트 캐시 fingerprint** — 현재 차트/fundamental 캐시키 = `analysis:sym:tf:model:PROMPT_TEMPLATE_VERSION('p1')`로 **skill 인지가 없다**. news/overall처럼 **skill-frontmatter fingerprint를 차트 키에 fold**(게이팅 로직/frontmatter가 바뀌면 stale 분석 서빙됨). fingerprint는 selector가 읽는 frontmatter 필드(triggers/state/tier/token_cost)를 해시.
2. **스킬 검증 CI**(siglens, `skills/`가 사는 곳) — 스키마 + 빌드 실패 게이트: frontmatter `triggers` ↔ detectSignals 카탈로그 cross-check(오타·없는 신호명), 필수 필드 누락, **도달불가 스킬**(어떤 신호로도 켜질 수 없는 스킬) 검출. 현재 검증 0(wyckoff@0.0이 이미 silent-invisible).
3. **dead-metadata 방지** — `Skill.indicators[]`는 현재 아무 로직도 안 읽는 죽은 메타데이터. 새 `triggers`도 `selectSkills`가 실제로 읽고 테스트하지 않으면 동일하게 theater가 됨.
4. **파서 통합** — core loader와 siglens `entities/skill/api.ts`의 거의 동일한 frontmatter 파서 2벌 → 단일 source.
5. **마이그레이션 fail-open** — `selectSkills`는 미태깅 스킬을 *경고 로그 + 포함*(fail-open)으로 처리(조용히 drop 금지).

---

## 측정 근거 (요약) + 한계

**성능(독립 oracle, 100종목 × 3TF; 매 측정 새 oracle라 *절대값 drift*, 내부 delta만 apples-to-apples):**
- 하이브리드 v2: oracle F1 측정 최고 · must-include 100% · extreme-ATR 100% · 결정성 byte-identical · regime 누수 <1% · buySellVolume FN 230→16
- v3 대칭화: 하락장 FN −23%, precision↑, 회귀 0
- **토큰 절감 ~34%(full-prompt 기준)** — Tier-0 always-on(패턴17+이론4)이 큰 고정 floor = 상시노출 결정의 의도된 비용

**한계(정직):**
1. **selection fidelity ≠ 분석 품질** — 지금까지 측정은 "맞는 스킬 골랐나"(oracle 대비)지 "분석이 좋아졌나"가 아님.
2. state-vs-event FN floor(DMI·SAR 등)는 본질적(이벤트 감지는 sparse, 상태는 지속) — 억지로 더 안 짜냄.
3. mega-cap borderline 약함 — 상당 부분 oracle 관대함 가능(실제 손실 미확정).
4. single snapshot 측정, forward edge 아님(메모리: levels forward-edge ~0).

## 수용 기준 (Acceptance — 구현 후 필수)

- **구현 직후 실측1 방식으로 *실제 분석 품질* A/B**: 전량 주입 vs 게이팅을 floor 모델 분석 LLM + 블라인드 judge로 비교. 게이팅이 품질 ≥ 전량이어야 통과(한계 ①·③ 확정).
- 이론전략 always-on **오용률 모니터링**(엘리어트/와이코프를 무관 차트에 갖다붙이는 비율).
- 결정성: 동일 입력 → byte-identical 프롬프트(CI 테스트).
- 캐시: 서로 다른 스킬 카탈로그 → 다른 차트 캐시키(테스트).

---

## 범위 / PR 분할 (제안)

| PR | 범위 | 레포 |
|---|---|---|
| **PR1** | detectSignals 양방향 대칭화(bearish 9개) + mfi fix + types(`Signal` kind union) + constants + 90% 테스트 | siglens-core |
| **PR2** | `selectSkills`(domain) + frontmatter 스키마 확장(types·loader·파서 통합) + `buildAnalysisPrompt` 게이팅 통합 + SMC 처리(압축노트·가드레일·placeholder 제거) + 차트 캐시 fingerprint | siglens-core |
| **PR3** | 스킬 frontmatter 태깅(67개) + 압축 지표코어/캔들 primer 작성 + 스킬 검증 CI + 마이그레이션 fail-open | siglens |
| **검증** | 구현 후 분석 품질 A/B(수용 기준) | siglens-worker 키 활용 |

- 버전업은 **사용자가 직접**(no bump, release-it 소유).
- 영구 측정 캐시: `/Users/y0ngha/.cache/skilltest-fmp/` (300 봉 파일, 재측정 시 FMP 0).

---

## 의도적으로 *안* 하는 것 (정직)
- **차트패턴 감지기**(토큰 ~26% 더 회수 가능) — 패턴 상시노출 결정 → "토큰 더 필요 시 후속"으로만 명시.
- mega-cap borderline 잔여 짜내기 — oracle 한계와 겹쳐, 구현 후 judge로 확정.
