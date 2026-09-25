# 2026-09-25 일봉 단기 과매도 눌림 판독 + 컨플루언스 신뢰도 철회

siglens-trader가 2026-09-24에 매매 규칙을 **1시간봉 종합 점수(컨플루언스 포함) → 일봉 RSI(2) 눌림매수**로
바꿨다(trader `docs/specs/2026-09-24-daily-mean-reversion-design.md`). siglens 쪽에서 같은 교체가 분석에도
이로운지 독립 데이터로 다시 쟀고(siglens `docs/superpowers/specs/2026-09-25-mean-reversion-evidence-design.md`),
그 결과 core가 바꿔야 할 부분을 이 문서가 다룬다.

## 0. 결론

| 항목 | 변경 |
|---|---|
| 분석 프롬프트의 컨플루언스 권위 | **철회.** 1Day "treat a met rule as strong evidence" → "descriptive only — 측정된 우위 없음". 모든 intraday 행도 같은 취지 |
| 일봉 눌림 판독 | **추가.** `evaluatePullback` 공개 + `## Deterministic Metrics`에 `### Short-Term Washout` 블록(1Day만) |
| `entryRecommendation` 규칙 | "enter"의 "bullish confluence from 2+ categories" → washout-in-uptrend 판독 허용, "avoid"의 "bearish confluence dominates" 삭제 |
| 챗 도구 설명·에이전트 프롬프트 | `get_bars_indicators`에 `pullback` 필드 명시, 컨플루언스 "측정된 우위 없음", 눌림 판독 전달 규칙 |
| 버전 | `PROMPT_TEMPLATE_VERSION` p15→p16, `AGENT_PROMPT_VERSION` 2026-09-25.1, 패키지 minor |

## 1. 근거 (요약)

데이터: 시점별 S&P 500 편입 615종목 2000-01~2020-11(Qlib/Yahoo, 손상 시계열 24개 제외) + 대형주 9·SPY·QQQ
2024-07~2026-09(Yahoo). 진입은 신호일 종가, 편도 0.1%. 시기: P1 2000~07.06 / P2 2007.07~09.06 / P3 2009.07~14 /
P4 2015~20.11 / P5 2024.07~26.09. 기준선 = MA200 위 모든 날. 지표·컨플루언스는 core 함수 그대로
(`evaluateConfluence` 대조 4,060건 불일치 0).

**컨플루언스(1Day 프롬프트 설정: min 3, expectedWeight 1, HTF 없음), 10일 수익률(%)**

| | P1 | P2 | P3 | P4 | P5 |
|---|---|---|---|---|---|
| 모든 날 | 0.70 | −0.42 | 0.95 | 0.38 | 1.21 |
| 진입 규칙 MET | 0.18 | −1.15 | 0.84 | 0.25 | 0.81 |
| 청산 규칙 MET | 0.69 | −0.95 | 1.32 | 0.46 | 2.17 |

진입 규칙 MET는 5개 시기 모두 기준선 아래. 청산 규칙 MET는 3개 시기에서 기준선 위(P3~P5), P1은 기준선과 같은 수준(−0.01%p), P2는 아래. 점수
구간과 전진 수익률 사이에 양의 단조 관계 없음. trader의 1시간봉 측정(비용 반영 후 기준선 대비 우위 없음,
종합 점수 +1일 수익률과 Spearman −0.23)과 같은 방향이다.

**눌림 판독, 5일 수익률(%) — 괄호는 기준선**

| 규칙 | P1 | P2 | P3 | P4 | P5 |
|---|---|---|---|---|---|
| 종가 > MA200 ∧ Williams %R(14) ≤ −90 | 0.76 (0.27) | 0.20 (−0.54) | 0.79 (0.35) | 0.43 (0.11) | 2.18 (0.24) |
| 종가 > MA200 ∧ RSI(2) < 10 (trader) | 0.61 | −0.22 | 0.67 | 0.21 | 1.69 |

- MA5 청산(또는 10일, 5×ATR 재난 손절) 거래 승률 66~75%, 거래당 +0.05~+1.62% vs 같은 청산의 기준선 −0.26~+0.18%.
- 상대 우위: P2 10일 −0.71%(기준선 −1.03%).
- near(−90 < %R ≤ −80, MA200 위): 5개 시기 모두 기준선 대비 양(+0.29/+0.14/+0.38/+0.18/+0.02%p).
- MA200 아래 washout: 평균 반등은 있지만 10일 −10% 초과 손실이 2.7배(8.8% vs 3.3%, P2 16.5% vs 9.0%).
- 셋업일의 컨플루언스 점수는 68%가 약세(<50). 약세 점수 셋업일은 나머지 셋업일과 같거나 높았다(4/5 시기).

## 2. 설계

### 2.1 `evaluatePullback(bars): PullbackSnapshot | null` (`domain/signals/pullback.ts`)

- 입력: 일봉(오래된 것부터). 200봉 미만·마지막 종가 비유한/0 이하·%R 없음 → `null`(기권).
- 출력: `reading`, `close`, `ma200`, `closeVsMa200Pct`, `ma5`, `williamsR`, `rsi2`.
- 분류(`classifyPullback`): %R ≤ −90 → MA200 위 `washoutInUptrend` / 아니면 `washoutBelowMa200`;
  MA200 위 ∧ −90 < %R ≤ −80 → `nearWashoutInUptrend`; 그 외 `none`. MA200 아래의 −80~−90은 측정상 구분되는
  의미가 없어 `none`.
- Williams %R을 분류 기준으로 쓴 이유: RSI(2)와 같거나 나은 측정 결과, 그리고 분석 프롬프트가 이미 찍는 오실레이터다.
  `rsi2`는 trader와의 대조를 위해 함께 싣는다.
- timeframe을 받지 않는다 — 기저율은 일봉 측정이라 호출자가 거른다(프롬프트는 1Day에서만 렌더).
- `PULLBACK_BASE_RATES`: 판독별 측정 문장. 도구 결과·프롬프트가 그대로 실어 모델이 수치를 인용하게 한다.
  모든 문장은 "Historical base rate, not an instruction."으로 시작한다.

### 2.2 프롬프트 (`analysis/confluenceSection.ts`, `analysis/prompt.ts`)

- `## Deterministic Metrics` 순서: 컨플루언스 → **Short-Term Washout(1Day)** → Risk:Reward. 입력 → 판독 → 기저율 순으로
  찍어 모델이 결론을 숫자와 대조할 수 있게 한다. 200봉 미만이면 "Not measurable"을 명시(조용한 부재 금지).
- 컨플루언스 `Reliability:` 전 행 교체. 1Day 행은 측정 수치를 싣고, intraday 행은 1시간봉 측정을 가리킨다.
- `### Confluence Assessment`: 집계는 서술용 — 단독으로 판정 근거가 되지 않는다; washout 판독이 있으면 집계 옆에
  Measured 줄과 함께 말하고 약세 집계는 그 판독의 정상 상태라고 밝힌다.
- `entryRecommendation`: "enter" = 지지 근처 **또는** washout-in-uptrend + 위험 높지 않음. "avoid"에서
  "bearish confluence dominates" 삭제, "약세 집계 단독은 avoid 근거가 아니다" 추가. R:R < 1.0 → "wait" 규칙은 유지.

### 2.3 에이전트 (`agent/tools.ts`, `agent/buildAgentSystemPrompt.ts`)

- `get_bars_indicators` 설명: `pullback` 필드(1Day, 필드명은 siglens 결과와의 계약), 컨플루언스 "descriptive, with no
  measured forward edge".
- 규칙: pullback 판독이 none이 아니면 컨플루언스 옆에 전한다 — Detailed는 판독·입력·measured 그대로(매수 지시 아님),
  Plain은 말로; washoutInUptrend + 약세 집계 조합은 정상이라고 밝힌다.

## 3. 소비자 배선 (core publish 이후)

1. **siglens** — `get_bars_indicators`의 로컬 판독(siglens PR #876에서 임시로 도구 계층에 둔 임계값)을
   `evaluatePullback` + `PULLBACK_BASE_RATES`로 교체, 필드를 도구 설명과 맞춘다(`rsi2` 포함).
   `skills/strategies/mean-reversion.md`는 siglens 소유 그대로 유지(같은 판독을 서술).
2. **siglens-trader** — core 버전 올림(기술 분석 리뷰 입력이 p16 프롬프트로 바뀜), `skills/`를 siglens에서 재동기화.
   trader의 매매 규칙(`lib/strategy/mean-reversion.ts`, RSI(2) < 10, 백테스트 동등성 테스트로 고정)은 그대로 둔다.

## 4. 한계

- 세트 A는 2020-11에서 끝나고, 세트 B는 11종목·약 2년이다.
- 모델 출력 수준의 효과(A/B)는 미측정 — 측정 환경에서 LLM 호스트가 차단됐다. siglens 설계 문서 §7의 절차로 잴 것.
- `PROMPT_TEMPLATE_VERSION` 상승으로 기술 분석 캐시가 전량 무효화된다.
