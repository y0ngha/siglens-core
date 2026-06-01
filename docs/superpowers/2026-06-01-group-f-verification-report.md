# Group F (스킬 동적 게이팅) — 통합 검증 리포트 (V1~V8)

구현 완료 후 수행한 7개 독립 검증(V1~V7)을 단일 리포트로 통합한다. 모든 검증은
**fresh-context 에이전트**(이전 구현 맥락 없이) 또는 **독립 오라클/실측 도구**로
수행해 자기참조 편향을 배제했다.

> **V7(forward 품질)은 두 갈래다**: pro 백테스트(7a)는 인프라 제약으로 보류, production
> floor 모델 flash-lite A/B(7b)는 실시 완료. 본 리포트 결론은 V1~V6 + 7b 기준이다.

| 검증 | 항목 | 결과 |
|---|---|---|
| V1 | 설계 적합성 | ✅ |
| V2 | worst-case 테스트 | ✅ |
| V3 | edge-case 테스트 | ✅ (+ 경계 동일점 보강 #143) |
| V4 | 분기 커버리지 ≥90% | ✅ |
| V5 | 신규 로직 정합성 | ✅ (결함 없음) |
| V6 | 프롬프트 개선 측정 | ✅ (토큰 −27%, precision 0.36→0.85) |
| V7 | forward 품질 (pro 백테스트 / floor A/B) | ⏸️ pro 보류 / ✅ flash-lite A/B 실시 |

게이트 상태(검증 시점): siglens-core `main` v0.19.0 — typecheck ✅ / lint ✅ /
test ✅ **2426 pass**. siglens `master` — typecheck ✅ / validate:skills ✅ /
test ✅ **4647 pass**.

---

## V1 — 설계 적합성

| 설계 항목 | 상태 | 근거 |
|---|---|---|
| HYBRID 게이트 (event=signal / state=textbook) | ✅ | `selectSkills.ts` event→`ctx.signals`/`detectedCandles`, state→`isStateNotable` |
| 양방향 카탈로그 (bearish 9 + mfi fix) | ✅ | `confirmed.ts` 9개 미러 + `detectMfiOversoldBounce` 재작성, 26 confirmed detectors |
| 3-tier (always_on / gated / 미태깅 fail-open) | ✅ | always_on 28 + event-gated 22 + state-gated 9, 미태깅 fail-open |
| 가드레일 5종 | ✅ | 캐시 fingerprint / validate-skills CI / dead-metadata 회피 / 파서 계약 / fail-open 마이그레이션 |
| 명시된 한계 준수 | ✅ | `token_cost` 미사용(knapsack 제거), SMC 풀가이드 드롭 + 압축노트, 차트 한정 |

**유일한 설계 발산**: 파서 "단일화"가 문자 그대로의 단일 source가 아니라 **두 개의
동기화된 복제본**(core `loader.ts` `parseGating` + siglens `api.ts` `parseGating`).
컴파일타임 exhaustiveness 가드(`satisfies` + `Exclude<...> extends never`)가 양 레포에서
드리프트를 빌드 실패로 차단하므로 기능적으로는 안전하나, 코드 재사용은 아니다.

---

## V2 — worst-case 테스트

커버됨: 빈 스킬 리스트, 전부 always_on, 전부 미태깅(fail-open), 시그널/상태 무발화
(gated 전부 드롭), always_on+event+state+미태깅 혼합, 빈 `triggers` 드롭, malformed
gating→undefined, gated-무경로→undefined, 비숫자 token_cost 무시, name 기준 dedup,
8개 predicate 쌍 전부 빈 시리즈 무throw, 비문자열 trigger 거부(siglens validator),
도달불가 (feature,predicate) 쌍 거부.

---

## V3 — edge-case 테스트

커버됨: TF별 %B 경계(15Min 0.91/0.93), 1Day 0.93 미발화/0.99 발화, ATR-extreme
임계(daily 6 / intraday 2), BOS/CHoCH 4바 발화 vs 19바 생략, null/zero-width 밴드,
ATR 미가용, ≤2바/단일원소 가드, byte-identical 결정성.

**보강(PR #143, 머지 `6c77522`)**: 감사가 짚은 경계 **동일점** 3종을 소스 상수에서
파생해 고정 — %B가 각 TF hi 임계(0.98/0.95/0.92)에서 발화, ATR%가 daily 임계(6%)에서
발화, BOS/CHoCH가 정확히 recency window(10바)에서 발화·+1바에서 생략. 상수를
`@internal` export해 테스트가 리터럴 대신 소스 값을 읽도록 했다(false-positive 방지).

---

## V4 — 분기 커버리지 ≥90%

| 파일 | 분기 % |
|---|---|
| `selectSkills.ts` | 100% |
| `skillGatingPredicates.ts` | 100% |
| `confirmed.ts` | 99.61% |
| `analysisInput.ts` (hashSkillCatalog) | 100% |
| `loader.ts` | 91.6% |
| `prompt.ts` | 96.5% |
| siglens `api.ts` | 94.96% |

Group F 신규 파일 전부 ≥90% 충족.

---

## V5 — 신규 로직 정합성 (독립 재유도)

**실제 결함 없음.** 검증: bearish 미러 부등호(Keltner/Ichimoku breakdown/Supertrend/
SAR/CCI/**DMI bearish**=`findCross(diMinus,diPlus,'up')`+ADX≥20/CMF/squeeze/MFI),
fail-open vs malformed-fail-closed, TF-aware %B 기본값 fallback, VWAP intraday-only,
결정적 tie-break(`localeCompare 'en'`), 캐시 fingerprint read==write, validate-skills
교차검증 + exhaustiveness, (feature,predicate) 쌍 도달성.

---

## V6 — 프롬프트 개선 측정 (독립 오라클 + 실측 tiktoken)

shipped 시스템(`@y0ngha/siglens-core@0.19.0`), 10티커 × 3TF = 30케이스, 실제 태깅 스킬.
ALL 베이스라인은 각 스킬의 `gating`을 제거해 fail-open 전량 주입으로 재현.

| 지표 | ALL(before) | GATED(after) |
|---|---|---|
| 전체 프롬프트 토큰 (cl100k 평균) | 89,623 | **65,369 (−27.1%)** |
| 스킬 블록 토큰 | 82,539 | 58,284 (**−29.4%**) |
| 선택 정밀도(precision, macro) | 0.36 | **0.85** |
| F1 | 0.51 | **0.75** |
| 결정성 | — | 30×5 셔플 byte-identical PASS |

- 게이팅이 프롬프트를 ~27% 줄이며(케이스당 ≈24k 토큰) 선택 정밀도를 2.4배로 끌어올림.
  오라클은 게이팅 결정이 아닌 중립 차트 다이제스트만 보고 판정(동어반복 배제).
- **floor 보정**: 항상 주입되는 바닥은 39개(미태깅 패턴 17 + 펀더멘털 6 + 인디케이터 8 +
  always_on 이론/SR 8)로 스킬 블록 토큰의 **61%**. 즉 절감 상한은 ~39%이고, 게이팅은 그
  여유의 ~3/4을 실현했다. 더 줄이려면 미태깅 패턴/펀더멘털에 `gating` 부여 필요.
- 캐비엇: 오라클이 다소 liberal(10.3/29 notable)해 GATED recall(0.70)을 낮추고 precision을
  과소평가했을 수 있음. in-sample·단일 시점 스냅샷. 선택 충실도이지 분석 품질이 아님(→ V7).

---

## V7 — forward 품질 검증

### 7a. pro 백테스트 (보류 — 인프라 제약)

**목적**: 게이팅을 적용한 프롬프트가 forward 분석 품질(winRate/aiWinRate/aiTrendHitRate)에
미치는 영향을 baseline과 동일 조건(동일 티커·기간·`gemini-2.5-pro`·thinkingBudget 32768)으로
비교.

**완료된 준비 작업** (재개 시 그대로 사용 가능):
- `generate-backtest.ts`를 core 분리 이후 구조로 마이그레이션 — `@/domain/*`(삭제됨) →
  `@y0ngha/siglens-core` + `@/entities/*`, `buildAnalysisPrompt` 7-인자 시그니처, 실제
  태깅 스킬 주입(게이팅 발동), TICKERS를 `data.json`에서 파생, fearGreed=undefined(시점
  재현성), 출력은 baseline 보존 위해 `_v7/data-gated.json`로 분리.
- 단일 100요청 배치가 Gemini batch **enqueue 토큰 한도(429)**를 넘겨, 티커
  `TICKERS_PER_BATCH`(=5)개씩 묶어 순차 제출하도록 변경(50요청/배치는 통과). RECOVER /
  STATUS / CANCEL 모드로 타임아웃 복구·상태조회·취소를 지원.

**보류 사유**: `gemini-2.5-pro` + thinkingBudget 32768 + 케이스당 ~65k 토큰 조합에서 batch
처리가 비현실적으로 느림 — Batch 1(50요청)이 **3h20m+ RUNNING(responses 0)**으로 2h 폴링
한도를 두 번 초과. baseline과 동일 모델·thinkingBudget을 유지하면 시간 비용이 과도하고,
thinkingBudget을 낮추면 모델 추론 깊이 차이로 비교가 오염되므로, **forward 품질 검증은
미완으로 남긴다**(현재 batch는 취소함).

**비교 기준 (baseline 5티커, 50케이스)** — 재개 시 대조군: winRate 66.0% /
aiWinRate 57.1%(4/7 decisive) / aiTrendHitRate 36.0% / entryRec wait 43·enter 4·avoid 3.

> pro 백테스트 재개 시 이 부분(7a)을 채운다.

### 7b. floor 모델(flash-lite) 게이팅 전/후 A/B — 실시 완료

**목적**: pro forward가 보류된 동안, **production floor 모델 `gemini-2.5-flash-lite`**로 동일
차트에 게이팅 전(전체 스킬 fail-open)/후(선별) 프롬프트를 넣어 **실제 분석을 생성·비교**.
V6(선택 정밀도)·7a(pro forward)가 못 본 "floor 모델 분석 품질의 직접 효과"를 측정한다.

**설정**: V6 persistent 캐시(FMP 호출 없음) · 8종목(AAPL,AMZN,GOOGL,LLY,META,PLTR,TSLA,WMT)
× 3TF(1Day/1Hour/15Min) · entry 후보당 flash-lite 전/후 분석 + `gemini-2.5-flash` 오라클
판정(A/B 순서 무작위화로 위치편향 보정) · 동시성 2 · **235/236 case**(503으로 1 skip).
운영 경로(`submitAnalysis`)와 동일한 `buildAnalysisPrompt`→decode→resolve 파이프라인을 사용.

**결과 ① forward 수익 — 차이 없음(측정 한계)**: before/after avgReturn 0.32% 동일, aiTrendHit
둘 다 0%, decisive 0~1개. flash-lite가 게이팅 전/후 모두 거의 `neutral`(wait)을 내고 SL/TP가
ATR fallback으로 수렴 → exit·수익이 완전히 동일. forward로는 게이팅 효과를 가를 수 없음
(flash-lite의 극단적 보수성 + decisive 표본 부족).

**결과 ② 오라클 판정 — 게이팅 후 소폭 우세** (위치편향 보정, tie 0):

| TF | before 선호 | after 선호 |
|---|---|---|
| 전체 (n=235) | 108 (46%) | **127 (54%)** |
| 1Day (79) | 39 | 40 (동률) |
| 1Hour (76) | 32 | **44** |
| 15Min (80) | 37 | **43** |

오라클(`gemini-2.5-flash`)은 게이팅된(선별) 분석을 약간 더 정확·유용하다고 판정. intraday
(1Hour/15Min)에서 더 뚜렷, 일봉은 동률.

**해석**: 게이팅이 floor 모델 분석 품질을 **떨어뜨리지 않음**(forward 동일 + 오라클 소폭 우세).
단 효과 크기는 작고(54:46), forward는 flash-lite 보수성으로 무효. 산출물:
`siglens/scripts/backtests/_v7/flashlite-ab.json`(235 case 상세).

---

## 후속 보강 (감사 non-blocking 해소)

V1·V5 감사가 짚은 non-blocking 항목 처리:

| 항목 | 처리 |
|---|---|
| 경계 동일점 테스트 3종 누락 | ✅ core PR #143 (머지 `6c77522`) |
| siglens `api.ts` loadSkills에 `dedupeByName` 없음 | ✅ siglens PR #542 (머지 `2b99b582`) |
| 파서 "단일 source"가 두 동기화 복제본 | 미해소(의도) — 컴파일타임 exhaustiveness 가드로 드리프트 차단, 기능적 안전 |

---

## 종합 결론

Group F는 설계대로 구현됐고(V1), worst/edge 테스트가 충실하며(V2·V3), 신규 파일이
≥90% 분기 커버리지를 충족하고(V4), 독립 재유도에서 결함이 없으며(V5), 독립 오라클·실측
기준 프롬프트를 ~27% 줄이면서 선택 정밀도를 0.36→0.85로 끌어올렸다(V6). 양 레포 모두
typecheck/lint/test를 통과한다.

**한계(정직하게)**:
1. 절감 상한은 always-on floor 때문에 ~39%로 제한(미태깅 패턴/펀더멘털이 floor를 키움).
2. 선택 충실도 ≠ 분석 품질 — pro forward 백테스트(7a)는 보류이나, floor 모델 flash-lite
   A/B(7b)로 **"게이팅이 분석 품질을 저하시키지 않음"을 확인**(forward 동일 + 오라클 54:46
   소폭 우세). 단 효과 크기는 작고, forward는 flash-lite의 극단적 보수성으로 무효다.
3. state(지속 상태)는 교과서 임계로 판정하므로 임계 직하 경계 상태를 구조적으로 놓칠 수
   있다(intrinsic FN floor).

문서: 시스템 동작은 `docs/SKILL_GATING.md`, 스킬 작성법은 소비 측 `siglens/skills/CLAUDE.md`.
