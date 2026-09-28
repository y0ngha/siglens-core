# 2026-09-28 차트 작도: 로직이 좌표를 만들고 AI는 고르기만 한다

AI 분석이 다룬 차트 패턴·추세선·다이버전스·피보나치·엘리어트 파동을 차트 위에 그린다.
예전 `usePatternOverlay`(AI가 `patternLines` 좌표를 직접 반환)는 좌표가 엉뚱한 곳에 찍혀 4/6 `cc5f6ce81`에서
비활성, 이후 FSD 정리에서 삭제됐다. 이 문서는 같은 실패를 구조적으로 막는 방식을 정한다.

대상 레포: siglens-core(후보 생성·프롬프트·resolve·스키마), siglens(렌더링·UI).

## 0. 결론

| 항목 | 결정 |
|---|---|
| 좌표 출처 | **로직만.** core가 피벗 기반 후보(id + 좌표)를 만든다. AI는 좌표를 쓰지 않는다 |
| AI 역할 | 후보 id를 결과 항목에 적는 것(확정)과 해석 |
| 표시 조건 | **패널에 없는 것은 차트에도 없다.** AI 결과가 참조한 후보 id만 그린다 |
| 조인 위치 | core `runAnalysis` 후처리. 결과 `chartOverlays[]`(time/price 좌표)를 분석 결과와 함께 캐시 |
| 노출 UI | 차트 헤더 띠(PR #885) 우측, 톱니 옆 `차트 작도 · N ▾` 드롭다운. 카테고리별 체크. 기본 on: 차트 패턴·추세선 |
| 패널 연동 | '원본' 보기에서 카드 클릭 시 해당 오버레이 강조(보조). '쉽게' 보기는 드롭다운만 |
| 버전 | `PROMPT_TEMPLATE_VERSION` bump(단계마다) |

## 1. 현황

| 대상 | 현재 |
|---|---|
| 차트 패턴 17종 | `screenChartPatterns`(분류기 7개)가 후보 + `pivots[]` 생성. 프롬프트에 힌트로만 들어가고 결과에는 안 실림. AI가 `patternLines`/`timeRange` 좌표를 반환하지만 차트에 안 그림 |
| 추세선 | AI가 SMC 스윙을 보고 끝점을 직접 적음(`trendlines`). 패널 텍스트에서만 사용 |
| 다이버전스 | `detectRegularDivergence`가 두 번째 피벗 index 하나만 반환(신호용) |
| 피보나치 | `computeFibonacciProjection`(horizon별) + ABC 투영. 앵커 index를 버리고 가격만 반환. 프롬프트 `Fib table`로만 사용 |
| 엘리어트 | 로직 없음. `always_on` 스킬 문서만 있음 |

## 2. 공통 구조

### 2.1 흐름 (core `runAnalysis`)

```
bars 조회
 → buildOverlayCandidates(bars, indicators, timeframe) : OverlayCandidate[]   (신규, 순수)
 → 프롬프트 조립: 각 후보를 id와 함께 해당 섹션에 싣는다
 → LLM 호출: 결과 항목에 후보 id만 적는다
 → resolveChartOverlays(candidates, aiResult) : ChartOverlay[]               (신규, 순수)
 → 캐시 저장 → filterAnalysisResult(tier) → 반환
```

- 후보 생성은 `screenPatternCandidatesSafely`와 같이 try/catch → `[]`. 오버레이 실패가 분석 전체를 죽이지 않는다.
- 합성 결과에서 시간이 앞으로 가지 않는 선분(`to.time <= from.time`)을 가진 후보는 통째로 버린다(`runsForward`). 그릴 수 없는 후보를 모델에 제시하지 않기 위한 마지막 안전망이다.
- 후보는 프롬프트 조립과 resolve에 같은 배열을 쓴다(재계산 금지. 재계산하면 id가 어긋날 수 있다).

### 2.2 타입 (`domain/types.ts`)

```ts
export type OverlayKind = 'pattern' | 'trendline' | 'divergence' | 'fibonacci' | 'elliott';

/** bars 배열 index가 아니라 봉 시각. 분석 이후 새 봉이 들어와도 위치가 안 밀린다. */
export interface OverlayPoint { time: number; price: number }   // time: unix seconds

export interface OverlaySegment {
    from: OverlayPoint;
    to: OverlayPoint;
    role: string;          // 'neckline' | 'boundary_upper' | 'wave' | 'pole' | 'anchor' | 'price' | 'rsi' ...
    style: 'solid' | 'dashed';
    pane: 'price' | 'rsi';   // 다이버전스의 RSI 쪽 선만 'rsi'
}

export interface OverlayLevel { price: number; fromTime: number; label: string }  // 우측 끝까지 수평선

export interface OverlayLabel { at: OverlayPoint; text: string; position: 'above' | 'below' }

/** 후보(프롬프트에 싣는 것). resolve 전. */
export interface OverlayCandidate {
    id: string;                 // 결정적. 형식은 §3 각 모듈
    kind: OverlayKind;
    skill: string;              // 연결 스킬 파일명(예: 'double-bottom', 'elliott-wave'). 추세선은 'trendline'
    promptLine: string;         // 프롬프트용 한 줄 설명(날짜·가격)
    segments: OverlaySegment[];
    levels: OverlayLevel[];
    labels: OverlayLabel[];
}

/** AI가 확정한 후보. 결과에 실린다. */
export interface ChartOverlay extends Omit<OverlayCandidate, 'promptLine'> {
    sourceRef: string;          // 참조한 결과 항목: patternSummaries[].id | strategyResults[].id | 'trendlines'
    variant: 'primary' | 'alternate';   // 엘리어트 대안 카운트만 'alternate'
}
```

`AnalysisResponse.chartOverlays: ChartOverlay[]` 추가. 필드 없는 옛 캐시는 `normalizeCachedAnalysisResponse`에서 `[]`.

### 2.3 AI 응답 스키마

| 위치 | 변경 |
|---|---|
| `patternSummaries[]` | `patternLines`, `timeRange` **삭제**(좌표). `candidateId: string \| null` 추가. `keyPrices`·`renderConfig`·`geometry`는 유지(패널이 씀) |
| `strategyResults[]` | `candidateIds: string[]` 추가(다이버전스·피보나치·엘리어트). 엘리어트는 순서가 의미: 0번 primary, 1번 alternate |
| 최상위 `trendlines` | AI 응답에서는 `trendlineIds: string[]`(0~3개)로 대체. `AnalysisResponse.trendlines`는 resolve 결과로 채워 하위 호환(챗 툴 `projectTechnicalAnalysis`, 스냅샷 렌더러가 사용) |

`siglens`의 `normalizeAnalysisResponse`, `buildExpertAnalysisReport`(`patternLines` 사용처)는 같이 정리.

### 2.4 프롬프트

- 기존 `## Chart Pattern Candidates (computed)` 각 후보 줄에 `id:` 추가.
- 신규 `## Chart Overlay Candidates (computed)` 섹션: 추세선·다이버전스·피보나치·엘리어트 후보를 kind별로, 각 줄 `id: … | skill: … | <promptLine>`.
- 규칙 문구(요지): "결과 항목이 이 후보를 근거로 삼았다면 그 id를 `candidateId`/`candidateIds`/`trendlineIds`에 적는다.
  목록에 없는 id를 만들지 않는다. 좌표는 적지 않는다."
- `### Trendline Detection` / `### trendlines vs patternLines` / `patternLines Writing Rules` 블록은 id 선택 규칙으로 교체.
- 토큰 상한: 추세선 후보 ≤ 6, 피보나치 ≤ 4, 엘리어트 ≤ 3, 다이버전스는 발생한 것만(≤ 2).

### 2.5 resolve 규칙 (`resolveChartOverlays`)

1. AI 결과의 모든 참조 id를 모은다: `patternSummaries[].candidateId`(`detected: true`만), `strategyResults[].candidateIds`, `trendlineIds`.
2. 후보 목록에 있는 id만 `ChartOverlay`로 변환. `sourceRef` = 참조한 항목의 id. 같은 id를 여러 항목이 참조하면 첫 항목.
3. 목록에 없는 id(환각)는 버리고 개수만 로그(`[ChartOverlays] unknown candidate id`). 아무 항목도 후보를 참조하지 않으면 `[ChartOverlays] no candidate referenced`도 로그. 런타임 로그는 이 두 이상 신호만 남긴다 — kind별 참조율(`referenced/offered`)은 런타임에서 계산하지 않고, 저장된 프롬프트(`onPromptAssembled`)와 저장된 결과의 `chartOverlays`를 소비자 DB에서 오프라인으로 대조해 측정한다.
4. 후보가 없는 패턴을 AI가 보고(`candidateId: null`)하면 패널에만 나오고 차트에는 없다.
5. 순수 함수, 예외 없음.

### 2.6 tier

`filterAnalysisResult`가 결과 항목을 가리면, 그 항목을 `sourceRef`로 가진 오버레이도 제거한다. `trendlines`가 가려지면 추세선 오버레이도 제거.

## 3. 모듈별 후보 생성

모든 모듈의 피벗은 `extractPivots`(ATR zigzag, `PIVOT_REVERSAL_ATR_MULT` 1.5)를 공유한다. id의 시각 성분은 봉 time(unix초).

### 3.1 차트 패턴 (`domain/overlays/patternOverlays.ts`)

- 입력: `screenChartPatterns` 결과(이미 계산됨) + `computeCandidateGeometry`.
- id: `pattern:<patternId>:<첫 피벗 time>`
- 스킬: `ChartPatternId` → 스킬 파일명(`double_bottom` → `double-bottom`).

| 패턴 | segments | levels | labels |
|---|---|---|---|
| double/triple top·bottom | 피벗 폴리라인(solid) | 넥라인 = breakoutLevel(dashed, 첫 피벗부터) | — |
| (inverse) head & shoulders | 피벗 폴리라인 | 넥라인: 두 골(마루) 연결선을 마지막 봉까지 연장(dashed) | LS / H / RS |
| triangle·wedge·rectangle | 상단선(고점 피벗 회귀), 하단선(저점 피벗 회귀), 첫~마지막 피벗 구간 | — | — |
| bull/bear flag·pennant | 폴(pole) 선분 + 채널 상·하단 | — | — |
| cup & handle·rounding bottom | 피벗 폴리라인 | 림 = breakoutLevel(dashed) | — |

- 회귀선은 `classifiers.ts`의 `leastSquaresSlope` 재사용.
- 색: 스킬 frontmatter `display.chart.color`.

### 3.2 추세선 (`domain/overlays/trendlineCandidates.ts`)

- 확정 피벗만(`includeProvisional: false`), 최근 `SCREEN_LOOKBACK_BARS`(120)봉.
- 지지선(ascending): 저점 피벗 두 개(p1 < p2, price 상승) 조합마다 직선. 저항선(descending): 고점 피벗 두 개(price 하락).
- 무효: p1 ~ 마지막 봉 사이 종가가 선을 `0.5 × ATR` 넘게 관통한 봉이 2개 이상. 평탄선(기울기 < `FLAT_SLOPE_ATR_PER_BAR`)은 제외(수평 레벨은 keyLevels 영역).
- 점수: 같은 종류 피벗 중 선에서 `0.25 × ATR` 이내인 터치 수(p1·p2 포함) 내림차순 → p2 최신순. 종류별 상위 3, 합계 ≤ 6.
- id: `tl:<support|resistance>:<p1 time>:<p2 time>`
- segment: p1 → 마지막 봉 time(선형 연장한 가격). labels 없음.

### 3.3 다이버전스 (`domain/overlays/divergenceCandidates.ts`)

- `detectRegularDivergence`를 `{ p1, p2 } | null` 반환으로 리팩터. 기존 신호 함수는 `p2`를 그대로 `detectedAt`으로 써서 동작 불변.
- RSI 강세·약세 각각, **신호가 발생했을 때만** 후보 1개(스킬 `divergence` 게이트와 같은 조건 → 패널과 자동 일치).
- id: `div:rsi_<bullish|bearish>:<p2 time>`
- segments: `price`(p1→p2, 저가 또는 고가), `rsi`(p1→p2 RSI 값, segment의 `pane: 'rsi'`). 오버레이 하나에 두 패인 선이 같이 들어감.
- MACD 히스토그램 수렴 신호는 피벗 쌍이 없어 선으로 그릴 수 없음 → 후보 없음(패널 텍스트만).

### 3.4 피보나치 (`domain/overlays/fibonacciCandidates.ts`)

- `FibonacciProjection`에 `highIndex`, `lowIndex` 추가(SMC 스윙 포인트가 이미 index를 가짐). ABC 투영도 a/b/c index 추가.
- 후보: horizon(short/medium/long)별 되돌림·확장 1개씩 + ABC 1개. 앵커 레그가 같은 horizon은 하나로 합침. ≤ 4.
- id: `fib:<short|medium|long|abc>:<앵커 끝 time>`
- 스킬: 되돌림 `fibonacci-retracement`, 확장·ABC `fibonacci-extension`, 전략 결과는 `fibonacci`(어느 항목에서 참조돼도 resolve됨).
- segments: 앵커 레그 A→B(dashed). levels: 0.236~0.786 되돌림 + 1.0~1.618 확장(2.618은 차트 밖으로 튀어 제외), 앵커 끝 time부터, label `61.8%`.

### 3.5 엘리어트 파동 (`domain/overlays/elliottCandidates.ts`, 신규 로직)

**후보 생성**

- 피벗: `includeProvisional: true`(진행 중인 파동이 핵심 정보), 최근 120봉.
- 충격파 탐색: 교대 피벗 연속 구간을 슬라이딩. 상승 충격파는 저점에서, 하락은 고점에서 시작.
  - 완성형: 피벗 6개(0~5).
  - 진행형: 마지막 피벗에서 끝나는 피벗 4개(3파 진행 중) 또는 5개(4파 진행 중). 5파 진행은 6개 구간의 마지막이 provisional인 경우로 포함.
- 간격 게이트(규칙 검사 전): 이웃한 파동 피벗은 `EW_MIN_WAVE_BARS`(2)봉 이상 떨어져야 하고, 0 지점부터 마지막 피벗까지 `EW_MIN_IMPULSE_SPAN_BARS`(10)봉 이상이어야 한다.
  zigzag는 폭이 큰 봉 하나의 고가·저가를 같은 index의 두 피벗으로 잡을 수 있다. 그러면 길이 0인 "파동"이 생겨 선으로 그릴 수 없고
  (실측: 차트 라이브러리 `data must be asc ordered by time` 크래시), 2~3봉짜리 초미세 카운트가 최고점을 받는다.
- 절대 규칙(하나라도 위반하면 탈락. 가진 파동까지만 검사):
  1. 2파 끝이 0 지점을 넘지 않음(되돌림 < 100%).
  2. 3파가 1·3·5파 중 최단이 아님(5파가 없으면 3파 < 1파일 때만 탈락).
  3. 4파 끝이 1파 끝 영역과 겹치지 않음.
- 가이드라인 점수(각 0~1, 가중합):
  2파 되돌림 0.382~0.786 / 3파 ≥ 1.618×1파 / 4파 되돌림 0.236~0.5 / 5파 ≈ 1파 또는 0.618×(0→3) / 2·4파 교대(되돌림 깊이 차) / 최근성(끝 피벗이 마지막 봉에 가까울수록).
- 조정파: 완성 충격파 직후 피벗 3개(A·B·C). B가 A의 100% 초과 되돌림이면 탈락. C가 A 끝을 넘으면 가점.
- 점수 상위 3개(충격파·충격파+ABC 섞어서).
- id: `ew:<up|down>:<0 지점 time>:<n>` (n = 포함 피벗 수, ABC 포함 시 `:abc` 접미)
- promptLine: 각 파동 끝 날짜·가격, 진행 중인 파동 번호, 규칙 통과·점수.

**표시**

- segments: 파동 폴리라인(solid). ABC는 dashed.
- labels: 각 파동 끝 피벗에 `1`~`5`, `A`~`C`. 고점은 above, 저점은 below.
- AI가 `candidateIds[1]`을 주면 대안 카운트(`variant: 'alternate'`, 흐린 색, 라벨 `(1)`~`(5)`).

**한계(스펙에 명시, 구현에서 튜닝)**

- 카운트는 해석이 여러 개일 수 있다. 상위 후보만 보이고 AI가 고르게 해서 완화할 뿐 정답을 보장하지 않는다.
- 피벗 민감도(1.5 ATR)가 파동 차수를 결정한다. 분봉에서 과다 분할되면 timeframe별 배수를 둔다(튜닝 상수 하나).
- 대각삼각형·삼각수렴 조정 등 복합 구조는 범위 밖.

## 4. siglens

### 4.1 UI (PR #885 헤더 띠 머지 후)

- 헤더 띠 우측, 톱니 왼쪽: `차트 작도 · N ▾` 버튼. N = 켜진 카테고리의 오버레이 수.
- 팝오버 체크리스트: 차트 패턴 / 추세선 / 다이버전스 / 피보나치 / 엘리어트(개수 0인 카테고리는 숨김).
- 기본 on: 차트 패턴, 추세선. 체크 상태는 기존 지표 토글 저장 방식(`useIndicatorVisibility` 계열)과 같은 저장소.
- 버튼 숨김: 분석 결과 없음, `chartOverlays` 빈 배열, 차트 timeframe ≠ 분석 timeframe.
- i18n: `차트 작도` 및 카테고리명 ko/en.

### 4.2 렌더링 (`widgets/chart`)

- 훅 `useChartOverlays(chartRef, overlays, visibleKinds, highlightedId)`.
- segment → 2점 `LineSeries`(`lastValueVisible: false`, `priceLineVisible: false`, crosshair marker off). 예전 `usePatternOverlay`와 같은 방식.
- level → anchor time부터 마지막 봉까지 2점 `LineSeries` + 우측 라벨. (`createPriceLine`은 전 구간이라 부적합)
- label → segment 끝 `LineSeries`에 `createSeriesMarkers`(text 마커).
- segment `pane: 'rsi'` → RSI 패인이 켜져 있을 때만 그 패인에 그림. 꺼져 있으면 가격 선만.
- 순수 변환은 `utils/chartOverlayUtils.ts`(overlay → series 데이터), 훅은 생성/정리만. 기존 고아 파일 `patternOverlayUtils.ts`, `constants.ts`의 `REGION_*`는 삭제.
- 색: 패턴은 `renderConfig.color`, 나머지는 kind별 고정 토큰(추세선 지지 teal / 저항 red, 다이버전스 amber, 피보 violet, 엘리어트 orange). alternate는 opacity 0.5.

### 4.3 패널 연동 ('원본' 보기)

- 패턴 카드·전략 카드 클릭 → `highlightedId` = 해당 `sourceRef`의 오버레이. 강조 = 선 굵기 2배, 나머지 opacity 0.3. 해당 카테고리가 꺼져 있으면 일시적으로 켜서 보여줌.
- 상태는 symbol 페이지 상위(views/symbol)에서 들고 차트·패널에 내림. 다시 클릭하면 해제.

## 5. 단계

각 단계 = core 릴리스 → siglens 버전 bump + 렌더링. 단계마다 `PROMPT_TEMPLATE_VERSION` bump.

| 단계 | core | siglens |
|---|---|---|
| 1 | 공통 타입, `resolveChartOverlays`, 패턴 후보 id·오버레이, 스키마(`candidateId`, `patternLines`/`timeRange` 삭제), 프롬프트 | 헤더 드롭다운, `useChartOverlays`, 패턴 렌더, 고아 코드 삭제 |
| 2 | 추세선 후보, `trendlineIds`, `trendlines` 하위 호환 채움 | 추세선 카테고리 |
| 3 | 다이버전스 `{p1,p2}` 리팩터, 피보 앵커 index, 두 후보, `strategyResults.candidateIds` | 다이버전스(RSI 패인 포함)·피보 렌더 |
| 4 | 엘리어트 후보 생성 | 엘리어트 렌더(라벨·alternate) |
| 5 | — | 패널 카드 클릭 강조 |

## 6. 테스트

- core 후보 생성기: 모듈별 단위 테스트. 픽스처는 손으로 만든 모양이 아니라 실제 bars에서 잘라낸 구간(과거 손 픽스처가 매핑을 건너뛴 전례).
  엘리어트는 규칙 3개 각각 위반 케이스 + 교과서형 통과 케이스.
- `resolveChartOverlays`: 환각 id 제거, `detected: false` 무시, sourceRef 매핑, 중복 참조 첫 항목, 빈 입력.
- 캐시 정규화: `chartOverlays` 없는 옛 캐시 → `[]`, 옛 `patternLines` 필드가 있어도 에러 없음.
- 프롬프트: 후보 id가 섹션에 들어가는지, 후보 없을 때 섹션 생략.
- tier 필터: 가려진 항목의 오버레이 제거.
- siglens: `chartOverlayUtils` 변환 단위 테스트, 드롭다운 표시 조건(빈 배열·timeframe 불일치), 훅 정리(언마운트 시 series 제거).

## 7. 위험

| 위험 | 대응 |
|---|---|
| AI가 id를 안 적음(참조율 낮음) | 런타임은 이상 신호만 로그(`unknown candidate id`, `no candidate referenced`). kind별 참조율은 단계 1 배포 후 저장된 프롬프트(`onPromptAssembled`)와 저장된 결과의 `chartOverlays`를 소비자 DB에서 오프라인 대조해 측정. 낮으면 규칙 문구 강화 |
| 프롬프트 토큰 증가 | kind별 상한(§2.4). 단계별로 before/after 토큰 측정 |
| 엘리어트 카운트 신뢰도 | primary/alternate 표시, 스킬 문서의 "해석은 복수" 문구 유지 |
| 차트 혼잡 | 기본 on은 패턴·추세선만 |
| 캐시된 옛 결과 | 버전 bump로 키 교체. 정규화가 옛 형태도 수용 |
