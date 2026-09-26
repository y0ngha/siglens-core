# 2026-09-26 눌림 판독의 진입 판정을 룰 엔진으로 옮긴다 (p17)

1.17.0(p16)은 `entryRecommendation`의 "enter"에 상승 추세 속 눌림(washoutInUptrend) 판독을 허용했다
(`2026-09-25-pullback-washout-design.md`). 배포 후 실측해 보니 그 규칙은 한 번도 작동하지 않았다. 이 문서는
원인과 수정을 다룬다.

## 0. 결론

| 항목 | 변경 |
|---|---|
| washout 판정 | **룰 엔진이 결정.** washoutInUptrend 블록에 `Entry verdict (rule engine): enter — washout path` 줄을 싣는다 |
| Step 1 | washout 경로를 맨 앞에: 판정을 복사, 확인 신호 불필요, 동반 현상(약세 집계·R:R<1·Elder 적색·단기 하락)은 위험으로만 서술 |
| R:R < 1.0 → "wait" 규칙 | washout 경로 밖으로 한정(Step 1, `### Risk:Reward` 두 곳) |
| 컨플루언스 진입·청산 규칙 | "어떤 판정의 전제도 거부권도 아니다"를 명시 |
| 기저율 문장 | near: 최근 기간 우위가 통계적으로 불분명하다고 명시. MA200 아래: "약 2.7배" → "거의 모든 시기에 더 잦음, 시기별 1.3–2.8배" |
| 버전 | `PROMPT_TEMPLATE_VERSION` p16 → p17 |

## 1. 문제

- 운영 `analysis_history`(기술 분석, 1Day, p9–p16) **6,070건 중 enter 0건**, avoid 약 1%, 나머지 wait.
- core 1.16.0 대 1.17.0 A/B(DeepSeek v4.1 flash, 운영과 같은 조립 경로, 2025-01~2026-09 대형주 85건 × 2): 170건 모두 wait.
  washout 판독이 켜진 25건에서 평균 회귀 스킬은 25/25 "충족"으로 정확히 판정했지만 최종 판정은 wait였다.

## 2. 원인 (실험으로 확인)

모델이 근거를 적게 한 변형(`entryRecommendationRationale`)으로 washout 15건의 거부 사유를 셌다.

| 사유 | 건수 |
|---|---|
| 구조적 R:R < 1.0(또는 1.0 근처) → "prefer wait" | 14 |
| 확인 신호 요구(반등 캔들, MA5 위 종가, 거래량) | 11 |
| 컨플루언스 "Entry rule not met"을 진입 전제로 취급 | 8 |
| Elder Impulse 적색 = "buying PROHIBITED" | 4 |

- R:R은 피벗·카마릴라·라운드 넘버 같은 촘촘한 레벨 중 가장 가까운 것끼리 재므로 washout 날엔 대개 1.0 근처다.
- 확인을 기다리는 것은 측정이 우위를 잃는다고 본 바로 그 행동이다(%R가 -80 위로 되돌아오길 기다리면 5개 시기 모두 우위 소멸).

단독 제거로는 풀리지 않았다(30건: washout 15 + 대조 15).

| 변형 | washout enter |
|---|---|
| 기준(p16) | 0/15 |
| Elder 금지 문구 제거 | 0/15 |
| R:R wait 규칙 제거 | 0/15 |
| 시스템 서술형 원칙 제거 | 0/15 |
| 세 가지 모두 제거 | 0/15 |
| Step 1 재작성(경로 분리·확인 불필요, riskLevel 조건 유지) | 8/25 |
| 위 + washout 경로에서 riskLevel 조건 제거 | 14/25 |
| **위 + 룰 엔진 판정 줄** | **25/25** (near 20/20은 wait 유지) |

컨플루언스 집계·R:R과 같은 원칙이다: 모델이 틀리게 판정하는 결정론적 사실은 코드가 계산하고 모델은 복사한다.

## 3. 설계

- `confluenceSection.ts` `formatPullback`: reading이 `washoutInUptrend`일 때만 `Reading:` 다음, `Measured:` 앞에
  `WASHOUT_ENTRY_VERDICT`를 싣는다. near·MA200 아래·none·intraday에는 싣지 않는다(near는 5일 우위가 작고 최근엔
  불분명, MA200 아래는 손실 꼬리가 두꺼움 — 판정은 모델 몫으로 둔다).
- riskLevel은 washout 경로를 막지 않는다. riskLevel은 모델이 매기는 값이라 washout 날의 변동성·하락 추세를 그대로
  "high"로 읽는다(p16 A/B washout 25건 중 11건 high). 측정된 우위는 riskLevel 조건 없이 잰 것이다.
- 산문은 판정을 설명한다: 진입 참조=분석 시점 종가 부근, 청산 참조=MA5(또는 약 10거래일), 무효화=MA200 아래 종가.
- 지지 경로("price near support")는 문구만 분리하고 조건은 그대로 둔다 — 측정 근거가 없어 강제하지 않는다.

## 4. 기저율 재측정 (FMP 대형주 101종목, 2000–2026, 생존 편향 있음)

| 시기 | near 5일 초과(%p, t) | near 10일 초과 | MA200 아래 10일 −10% 손실 vs 상승 추세 washout |
|---|---|---|---|
| 2000–07.06 | +0.36 (4.3) | +0.39 | 8.0% vs 2.9% |
| 2007.07–09.06 | +0.46 (2.7) | +0.47 | 12.7% vs 6.2% |
| 2009.07–14 | +0.09 (1.6) | +0.13 | 3.1% vs 2.3% |
| 2015–20.11 | +0.11 (1.7) | +0.05 | 5.1% vs 3.6% |
| 2020.12–24.06 | +0.05 (0.6) | +0.11 | 3.4% vs 2.3% |
| 2024.07–26.09 | +0.14 (1.3) | +0.11 | 5.1% vs 3.9% |

초과는 같은 날 기준선(MA200 위 모든 날) 대비, t는 날짜 군집. 시점별 S&P 500(615종목) 표본의 2024–26 near 5일
초과는 +0.01%p, MA200 아래 손실 꼬리는 역전(5.3% vs 7.3%, 표본 작음)이었다. 두 표본을 합쳐 문장을 "모든 시기
기준선 위, 2020 이후 통계적으로 불분명" / "거의 모든 시기에 더 잦음, 시기별 1.3–2.8배"로 낮췄다.

## 5. 검증

- 단위 테스트: washout 판정 줄 위치(Reading 뒤, Measured 앞), near·MA200 아래·none에는 없음, Step 1 순서·문구, R:R 규칙 한정,
  기저율 문장.
- 실측(A/B 하네스, 85건): §6에 결과.

## 6. 실측 결과

같은 85건, 같은 모델. old = core 1.16.0 + PR #876 이전 스킬, p16 = core 1.17.0 + 현재 스킬,
p17 = 이 변경 + 평균 회귀 스킬 digest 수정(siglens).

| 판독 | entryRecommendation old / p16 / p17 | 평균 회귀 전략 trend(p17) |
|---|---|---|
| washout in uptrend (25) | wait 25 / wait 25 / **enter 23**, null 2 | bullish 24 |
| near (20) | wait 20 / wait 20 / wait 20 | neutral 18, bullish 2 (p16: bullish 19) |
| MA200 아래 washout (20) | wait 20 / wait 17·null 3 / wait 18·null 2 | neutral 18 |
| 판독 없음, MA200 위 (20) | wait 20 / wait 20 / wait 20 | — |

- enter는 washout 판독에서만 나왔고, 23건 모두 진입 구간·손절·목표가가 채워졌다.
- null은 모델이 `actionRecommendation`이나 그 enum을 통째로 빠뜨린 경우로, p16과 운영(약 1%)에도 있던 현상이다.
- washout 날 전체 trend가 bearish인 비율: 88% → 52% → 36%.

## 7. 한계

- 표본 85건은 판정 준수 여부를 보기엔 충분하지만 "enter가 난 날의 수익률"을 판단하기엔 작다. 우위 자체는 §4와
  `2026-09-25-pullback-washout-design.md`의 백테스트가 근거다.
- 지지 경로의 enter는 여전히 드물다. 측정 근거가 없는 경로라 이번 범위에서 강제하지 않았다.

## 8. 후속 (p18): 뉴스성 급락이면 판정 보류

p17 배포 직후 enter 23건을 한 건씩 검토했다. 규칙 적용은 23/23 맞았지만(%R ≤ −90, MA200 위, 진입 구간은 종가 ±1.4%,
손절 종가 아래, 1차 목표 종가 위), **3건이 실적 발표 ±3일 안의 급락**이었다(CSCO −12.3% 당일, JPM, LMT —
LMT는 MA5 청산 −9.64%). 스킬과 측정은 뉴스성 급락을 "이력이 다루지 않는, 이 셋업의 큰 실패"로 제외한다. A/B 입력엔
뉴스가 없어 모델이 알 수 없었지만, 운영 프롬프트엔 `## Market Events`가 들어가는데 판정 줄이 "재판단 금지"라 그것을
덮어쓴다 — 설계 구멍.

- `newsDrivenWashoutEvent(events, bars)`: 최근 3세션(마지막 봉 포함) ~ 마지막 봉 스탬프 +1일 사이에 게시된
  earnings·guidance·regulation 이벤트, 영향 high/medium, 방향이 bullish가 아닌 것을 찾는다. +1일인 이유: 일봉은 UTC 자정에
  찍혀 같은 세션 기사가 스탬프보다 늦고, `## Market Events` 선택은 스탬프에서 끊어 그 기사를 놓친다.
- 찾으면 판정 줄이 `Entry verdict (rule engine): none — a {impact}-impact {category} event ({sentiment}, published … UTC) …`로
  바뀌고(이벤트를 줄 안에 직접 적는다 — `## Market Events`는 스탬프에서 끊기고 건수 상한이 있어 그 기사가 빠질 수 있다), Step 1이 모델에게
  직접 판단하고 기저율을 근거로 쓰지 말라고 지시한다. M&A·product·macro는 제외(눌림을 거의 만들지 않고 실패 사례에도
  없었다).
- 이벤트를 넘기지 않는 소비자(예: siglens-trader 기술 분석)는 1.17.1과 같은 판정을 받는다.

실적 3건을 뺀 20건의 MA5 청산: 평균 +0.48%, 승률 60%(23건: +0.09%, 57%). 표본이 작아 백테스트 승률(66–75%)과의 차이는
판단하지 않는다.

운영 뉴스 테이블(2025-11 이후)로 대조: CSCO(2026-02-12, earnings bearish/neutral medium 다수)·LMT(2026-04-21, earnings
neutral medium)는 게이트가 걸리고, ADI(other bullish)·SBUX·HON(이벤트 없음)은 판정이 유지된다. JPM(2026-01-14)은 그 기간
기사가 0건이라 게이트가 걸리지 않는다 — 뉴스 수집 공백은 이 게이트의 한계다.

### 8.1 이전 분석(`## Prior Analyses`)은 판정에 쓰지 않는다

운영 프롬프트에는 이전 분석(방향·위험도·계획·이후 가격 경로)이 참고용으로 들어간다. 판정 근거로 쓰지 않는 이유:
p9–p16 이전 분석 자체가 이번에 고친 편향(washout 날 enter 0, bearish 88%)을 담고 있고, 판정은 봉만으로 정해지는 사실이라
추가 정보가 없다. 대신 방해하지 않는지 쟀다 — p18 빌드로 washout 25건에 bearish 이전 분석 2건(5봉 전 high risk, 1봉 전
medium)을 넣어도 25/25 enter(넣지 않았을 때도 25/25). 섹션의 "현재 데이터가 우선" 가드레일이 판정 줄과 충돌하지 않는다.
