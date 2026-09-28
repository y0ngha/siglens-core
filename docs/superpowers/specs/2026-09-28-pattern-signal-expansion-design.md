# 2026-09-28 탐지기 확장 — 캔들 6종 · 차트 패턴 5종 · 신호 4종 (SP2-A)

siglens 스킬 근거 검토(siglens `docs/superpowers/specs/2026-09-28-skills-evidence-refresh-design.md`, SP1)에서
"core 탐지기가 있어야 스킬을 붙일 수 있는" 항목을 core에 추가한다. 스킬 파일(.md)은 siglens SP3에서 붙인다.
매크로 캘린더 뉴스 주입은 별도 PR(SP2-B, `feat/news-macro-calendar`).

## 0. 결론

| 축 | 추가 | 근거 |
|---|---|---|
| 캔들(`MultiCandlePattern`) | `above_the_stomach`, `below_the_stomach`, `rising_three_methods`, `falling_three_methods`, `bullish_three_line_strike`, `bearish_three_line_strike` | Bulkowski — above the stomach는 "8대 캔들" 1위(반전 66%), 3-line strike는 103개 중 성과 1·2위(희귀). three methods는 기존 candle-primer가 언급만 하고 탐지하지 않던 지속형 |
| 차트 패턴(`ChartPatternId`) | `rounding_top`, `high_tight_flag`, `ascending_channel`, `descending_channel`, `broadening_formation` | rounding_bottom만 있던 비대칭 해소, HTF는 Bulkowski 상위 성과, 채널은 쐐기 스킬이 "채널이면 쐐기 아님"으로 이미 걸러내던 형태, broadening은 수렴형의 반대 |
| 신호(`ConfirmedSignalType`) | `new_52w_high`, `new_52w_low`, `gap_up`, `gap_down` | 52주 고가 근접 모멘텀(George & Hwang, JF 2004), 갭(window)은 캔들·패턴 해석의 기본 입력 |
| 캐시 | `PROMPT_TEMPLATE_VERSION` p18 → p19 | 프롬프트의 탐지 목록이 바뀜 |

범위 밖: diamond·island reversal(희귀, 탐지 비용 대비 효용 낮음), 하모닉(근거 없음), 눌림 판독 게이팅(사용자 결정으로 현행 유지),
시간대 기반 스킬 게이팅.

## 1. 캔들

파일: `domain/types.ts`(`MultiCandlePattern`), `domain/analysis/candle.ts`, `candle-detection.ts`, `candle-labels.ts`, `candle-trend.ts`.

### 1.1 정의 (기존 헬퍼 `isBullishBar`/`isBearishBar`/`isLongBody`/`midpoint`/`bodyHigh`/`bodyLow` 재사용)

| 라벨 | 봉 수 | 조건 |
|---|---|---|
| `above_the_stomach` | 2 | prev **장대**(`isLongBody`) 음봉, curr 양봉, `curr.open ≥ midpoint(prev)` ∧ `curr.close ≥ midpoint(prev)` |
| `below_the_stomach` | 2 | prev **장대**(`isLongBody`) 양봉, curr 음봉, `curr.open ≤ midpoint(prev)` ∧ `curr.close ≤ midpoint(prev)` |
| `bullish_three_line_strike` | 4 | b1–b3 양봉·종가 연속 상승, b4 음봉 `b4.open ≥ b3.close` ∧ `b4.close < b1.open` |
| `bearish_three_line_strike` | 4 | b1–b3 음봉·종가 연속 하락, b4 양봉 `b4.open ≤ b3.close` ∧ `b4.close > b1.open` |
| `rising_three_methods` | 5 | b1 장대 양봉(`isLongBody`), b2–b4 장대 아님 ∧ 각 봉의 high ≤ b1.high ∧ low ≥ b1.low, b5 장대 양봉 `b5.close > b1.close` |
| `falling_three_methods` | 5 | 미러: b1 장대 음봉, b2–b4 b1 범위 안, b5 장대 음봉 `b5.close < b1.close` |

### 1.2 탐지 순서·창

- `detectMultiCandlePattern`: 5봉 → 4봉 → 3봉 → 2봉 순. 기존 2봉 패턴 검사 **뒤에** stomach를 폴백으로 둔다(기존 라벨 결과 불변).
- `MULTI_CANDLE_PATTERN_BUFFER` 2 → 4, `detectCandlePatternEntries`의 창 슬라이스를 `i - 4`까지. `getPatternBarCount`는 5/4/3/2봉 집합으로.
- 기존 3봉·2봉 패턴의 탐지 결과가 바뀌지 않음을 회귀 테스트로 고정(긴 패턴이 먼저 잡히는 경우만 예외 — 그 케이스는 테스트에 명시).
- **stomach의 prev 장대봉 조건(리뷰 R1에서 추가)과 실측 영향.** 폴백이라 `detectMultiCandlePattern`의 기존 라벨은 불변이지만,
  `detectCandlePatternEntries`/프롬프트 수준에서는 이전에 아무 다봉 라벨도 없던 쌍을 새로 묶으므로 "최신 다봉 라벨"을 바꾸고
  두 봉의 단봉 라벨(dragonfly_doji 등)을 흡수할 수 있다. 실측(siglens-trader `mr-parity.json`, FMP 일봉 NVDA/TSLA/SPY
  2024-01..2026-09, 봉 2,049개, 끝 봉 기준 롤링 창 1,998개, HEAD 대비):

  | 규칙 | stomach 봉당 적중률 | `detectCandlePatternEntries` 변경 창 | `selectLastCandlePatternEntries` 변경 창 | 최신 다봉 변경 창 | 최신 단봉 변경 창 |
  |---|---|---|---|---|---|
  | 초안(prev 몸통 조건 없음) | 12.4% | 87.1% | 48.8% | 32.2% | 29.7% |
  | 채택(prev `isLongBody`) | **2.0%** | 25.9% | **10.5%** | 6.5% | 5.7% |

  초안은 prev가 짧은 몸통·몸통 0(도지 — `isBullishBar`는 close ≥ open이라 양봉으로 셈)인 평범한 쌍까지 묶었다. 같은 함수의
  harami·piercing·dark cloud·counterattack·on-neck이 모두 prev 장대봉을 요구하므로 그에 맞췄다(`isLongBody`는 몸통 > 0을
  함의해 "prev 색이 엄격함" 조건도 겸한다). 채택 규칙에서 최신 다봉이 바뀐 창 129개 중 127개가 stomach 때문이며, 창이
  15봉 롤링이라 한 번의 stomach가 연속한 여러 창에 잡힌다. 새 4·5봉 패턴은 이 표본에서 three-line strike 2회뿐이다.

### 1.3 방향(`candle-trend.ts`)

- three methods, stomach: 이름대로(rising/above = bullish, falling/below = bearish).
- three-line strike: **측정 방향**으로 매핑 — Bulkowski: bullish three-line strike는 하락 반전으로 65%, bearish three-line strike는 상승 반전으로 84% 작동.
  `bullish_three_line_strike → bearish`, `bearish_three_line_strike → bullish`. JSDoc에 출처와 "이름은 전통 명칭, 방향은 측정값" 명시.

### 1.4 라벨(`candle-labels.ts`)

기존 파일 관례(표시 문자열 언어·형식)를 그대로 따라 6개 추가.

## 2. 차트 패턴

파일: `domain/types.ts`(`ChartPatternId`), `domain/patterns/classifiers.ts`, `constants.ts`, `patternGeometry.ts`, `analysis/patternTargets.ts`(해당 시), `analysis/chartPatternCandidatesSection.ts`(해당 시).

### 2.1 추세선 쌍 (`classifyTrendlinePatterns`)

새 상수 `CHANNEL_PARALLEL_ATR_PER_BAR`(기본 0.02, ATR 정규화 기울기 차 허용치). 분류표(첫 매치 우선, 상호 배타):

| high | low | 조건 | id |
|---|---|---|---|
| flat | rising | — | ascending_triangle (불변) |
| falling | flat | — | descending_triangle (불변) |
| falling | rising | — | symmetrical_triangle (불변) |
| rising | falling | — | **broadening_formation** |
| rising | rising | `|sH − sL| ≤ tol` | **ascending_channel** |
| rising | rising | `sL − sH > tol` | ascending_wedge (조건 강화 — 기존 `sL > sH`) |
| falling | falling | `|sH − sL| ≤ tol` | **descending_channel** |
| falling | falling | `sL − sH > tol` | descending_wedge (조건 강화 — 기존 `sH < sL`) |
| flat | flat | — | rectangle (불변) |

(`sH`/`sL`은 `classifyHighLowSlopes`가 돌려주는 ATR 정규화 기울기. 쐐기 조건 강화는 거의 평행한 경우를 채널로 넘기기 위함 —
siglens 쐐기 스킬이 이미 "convergence < 15%면 채널"이라 판정하던 것과 일치.)

### 2.2 곡률 (`classifyCurvaturePatterns`)

- `fitRoundingTop`: high 피벗 ≥ 4, 오목(`a < 0`) 2차 적합, 꼭짓점이 구간 중앙 절반, 림-정점 깊이 ≥ `ROUNDING_MIN_DEPTH_ATR_MULT × atr`
  (`ROUNDING_BOTTOM_MIN_DEPTH_ATR_MULT`를 공용 이름으로 바꾸고 옛 이름 export가 공개 API면 alias 유지).
- rounding_bottom/cup_and_handle 결과와 **독립적으로** rounding_top을 추가 방출할 수 있다(서로 다른 피벗 집합).

### 2.3 High Tight Flag (`classifyFlagsAndPennants`)

- 상수: `HTF_POLE_MIN_GAIN = 0.9`(90%), `HTF_POLE_MAX_BARS = 40`, `HTF_FLAG_MAX_RETRACE = 0.25`, `HTF_FLAG_MIN_BARS = 3`.
- 폴: 최근 창에서 저점→고점 상승률 ≥ 90%를 40봉 이내에 달성. 깃발: 폴 고점 이후 ≥ 3봉, 고점 대비 최대 하락 ≤ 25%.
- 매치되면 **high_tight_flag만** 방출(같은 구간의 bull_flag/pennant 대신 — cup_and_handle이 rounding_bottom을 대체하는 관례와 동일).
- Bulkowski 정의(두 달 내 90% 이상 상승 후 20~25% 이내 조정)의 봉 단위 근사. 일봉 외 시간대에서는 사실상 발화하지 않는다.

### 2.4 geometry·목표

`patternGeometry.ts`에서 각 id의 `{ breakoutLevel, extremeLevel, direction, invalidationLevel }`를 기존 유사 패턴 규칙으로:
- rounding_top ← rounding_bottom 미러(direction `down`).
- high_tight_flag ← bull_flag와 동일 규칙(폴 기저 = extreme).
- ascending/descending_channel, broadening_formation ← 방향 중립 패턴(rectangle)의 기존 처리 방식을 따른다. 방향이 정해지지 않으면
  rectangle과 같은 방식으로 표현(기존 타입이 허용하는 범위 안에서).

기존 `Record<ChartPatternId, …>`·switch가 있으면 모두 채운다(컴파일러가 강제).

## 3. 신호

파일: `domain/types.ts`(`ConfirmedSignalType`), `domain/signals/confirmed.ts`, `signals/index.ts`, `signals/constants.ts`(상수), `signals/confluence.ts`.

| 타입 | 방향 | 조건 |
|---|---|---|
| `new_52w_high` | bullish | `last.close > max(high)` — 창 = `time ∈ [last.time − 365일, last.time)`. 창 첫 봉이 `last.time − 358일` 이전이어야(커버리지) 발화, 아니면 `null` |
| `new_52w_low` | bearish | `last.close < min(low)`, 같은 창·커버리지 |
| `gap_up` | bullish | `last.low > prev.high` ∧ `(last.low − prev.high) ≥ GAP_MIN_ATR_MULT(0.25) × ATR(14)`(ATR 없으면 첫 조건만) |
| `gap_down` | bearish | `last.high < prev.low` ∧ 같은 크기 조건 |

- `Bar.time`은 초 단위. 52주 창은 **시간 기준**이라 어느 시간대든 1년치 이력이 있을 때만 의미 있게 발화한다.
- `detectedAt`은 기존 탐지기처럼 마지막 봉 인덱스(`bars` 안의 위치 — 모든 탐지기가 인덱스를 돌려준다).
- **컨플루언스 제외**: `SIGNAL_FAMILY` 주석대로 미매핑 타입은 자기 이름이 family가 돼 표가 생긴다. 새 4종은 측정되지 않았으므로
  `evaluateConfluence`의 집계에서 제외(명시적 제외 집합 + 이유 주석). 기존 컨플루언스 결과가 바뀌지 않음을 테스트로 고정.
- `detectSignals` JSDoc의 개수(28 confirmed + 8 anticipation) 갱신.

## 4. 프롬프트·캐시

- `PROMPT_TEMPLATE_VERSION` `p18` → `p19`(주석에 사유 한 줄).
- 프롬프트가 신호/캔들/패턴 목록을 렌더하는 곳에 하드코딩된 목록·설명이 있으면 새 항목 반영.

## 5. 공개 API·문서

- 새 상수를 공개할 필요는 없다(`@internal`). 타입 유니온 확장은 공개 API 변경 → `docs/PUBLIC_API.md`(있다면)와 CHANGELOG 규칙 따름.
- 소비자 영향(siglens SP3): `scripts/validate-skills.ts`의 `SIGNAL_CATALOG`(exhaustive guard)·`PATTERN_TRIGGER_CATALOG` 갱신,
  신호 라벨 UI 맵, 새 스킬 파일(`skills/patterns/rounding-top.md` 등, 파일명 = id의 kebab-case).

## 6. 테스트

- 캔들: 라벨별 양성 1 + 경계 음성 ≥ 1(예: stomach에서 open이 중간값 바로 아래), 긴 패턴 우선순위, 버퍼 확장 후 창 시작 부근 5봉 패턴 탐지.
- 패턴: 합성 피벗으로 채널/쐐기 경계(tol 전후), broadening, rounding_top, HTF(90% 경계, 25% 경계, 40봉 경계), 기존 패턴 회귀.
- 신호: 52주 커버리지 부족 → null, 경계(= max는 미발화), 갭 크기 경계, 컨플루언스 불변.
- 로컬 게이트: `yarn typecheck`, 변경 파일 스코프 테스트, `yarn lint`.
