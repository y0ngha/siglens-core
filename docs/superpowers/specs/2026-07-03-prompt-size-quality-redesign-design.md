# 분석 프롬프트 크기 축소 + 품질 개선 설계 (Prompt Size & Quality Redesign)

- 날짜: 2026-07-03
- 상태: 설계 승인 대기 → 구현은 PR 단위 순차 진행
- 관련 레포: `siglens-core`(주 대상), `siglens`(skills 파일·생성 스크립트), `siglens-worker`(dispatch 수용·캐싱)
- 선행 스펙: `2026-06-01-group-f-skill-gating-design.md` (스킬 게이트 시스템)

## 1. 문제 정의 (실측)

분석 프롬프트가 과대하여 비용·레이턴시·품질(주의 희석)을 모두 악화시킨다.

| 실측 항목 | 값 |
|---|---|
| 스킬 카탈로그 (`siglens/skills`, 81개 `.md`) | 414,510 B |
| TECHNICAL 프롬프트에 무조건 인라인되는 스킬 본문 | ~226 KB ≈ 56K tokens (always_on 28개 187KB + 미태그 fail-open 12개 39KB) |
| always_on 28개의 구성 | **차트 패턴 17개(~105KB)** + SMC·MTF·피보나치·엘리어트 + SR 3 + 일목 + `_core` 2 |
| 미태그 12개의 구성 | 지표 6(ma/ema/atr/adx/obv/volume-profile) + fundamental 3 + news 3 — 차트 프롬프트에 무관 콘텐츠 포함 |
| `responseSchema` (TECHNICAL) | 9,159 chars — 프롬프트 프로즈와 규칙 중복 서술 |
| 뉴스 프롬프트 | 기사 `bodyKo` 전문 + `summaryKo` 무제한 인라인 (`newsPrompt.ts:25-26`) |
| 분석 경로 프롬프트 캐싱 | **없음** (chat 경로만 Anthropic ephemeral 사용) |
| `token_cost` | 전 스킬 0 — 죽은 메타데이터, fingerprint에만 참여 |

핵심 구조적 사실: **차트 패턴 탐지 코드가 없다.** `detectSignals`(지표 신호)와 `candle-detection.ts`(캔들)만 존재하고, 차트 패턴(H&S, 삼각형 등)은 AI가 bars에서 직접 인식한다(`patternSummaries`/`patternLines` 출력). 패턴 스킬 17개가 전부 always_on인 이유가 이것이다 — 발화시킬 트리거가 코드에 없다.

## 2. 목표와 제약

- 목표: 프롬프트 토큰 **-60% 이상**, 분석 품질 **무하락 또는 개선**, 레이턴시·비용 절감.
- **최우선 제약: AI 분석 품질 저하 금지.** 크기 절감이 품질과 충돌하면 품질이 이긴다.
- 하드 토큰 예산(스킬 선택 상한)은 두지 않는다 — 관련 있으면 다 넣되, 무관한 것은 넣지 않는다.
- 스코프: **전 분석 타입** (technical/overall/fundamental/financials/news 계열/options/congress/briefing/economy). worker 수정 포함.

## 3. 설계

### §3.1 스킬 2계층화 — Prompt Digest

각 스킬 `.md`는 사람용 원본을 유지하고, 파일 하단에 구분자로 감싼 프롬프트용 압축 섹션을 추가한다.

```markdown
---
name: rsi
gating: { tier: always_on }
token_cost: 312            # digest 실측 토큰 수 (스크립트가 계산·기록)
digest_hash: a1b2c3d4      # digest 생성 시점의 원본 본문 해시 (staleness 감지)
---
# RSI — 사람용 원본 (그대로 유지)
...

<!-- PROMPT_DIGEST:START -->
(프롬프트에 주입되는 압축본)
<!-- PROMPT_DIGEST:END -->
```

- **로더(core)**: `PROMPT_DIGEST` 섹션만 `skill.content`로 주입. 섹션 누락 시 **로더 에러** — fallback 없음. 81개 전량을 한 PR에서 완성하고 CI로 강제한다(fail-open 재발 방지).
- **작성 원칙**: 임계값·수치 기준·신호 판정 규칙·해석 우선순위 **전부 보존**. 교육적 서술·역사·개념 설명(모델이 이미 아는 일반 지식)·중복 예시 제거. 목표 원본의 25~35%이되 하드 상한 아님 — 규칙 밀도가 높은 스킬(SMC, 엘리어트 등)은 더 길게 남긴다.
- **생성 파이프라인(siglens 레포)**: `scripts/skills-digest.ts`
  - 검증 모드(CI): `digest_hash` vs 현재 원본 해시 비교 → stale/누락 목록 실패 처리.
  - 생성 모드: stale 스킬의 digest를 AI로 재생성해 파일에 기록 → 사람이 diff 리뷰 후 커밋. 최초 81개는 이번 작업에서 수작업 작성.
- **`token_cost` 부활**: digest 실측 토큰 수를 기록. 선택 상한에는 사용하지 않음(텔레메트리·관측용). 부수 효과: fingerprint(`{name, gating, tokenCost}`)에 이미 참여하므로 digest 변경 시 토큰 수 변동으로 **분석 캐시 자동 무효화** — 기존 "스킬 body 수정은 무효화 안 됨" 문제의 부분 해소. 토큰 수가 우연히 동일한 경우는 기존과 동일하게 수동 `PROMPT_TEMPLATE_VERSION` bump(정책 문서화).

### §3.2 선택 엔진 — 카테고리 필터 + fail-open 제거 + 관련성 정렬

**타입별 카테고리 화이트리스트** (core 상수, `selectSkills` 앞단 적용):

| 분석 타입 | 허용 카테고리 |
|---|---|
| TECHNICAL | `_core`, indicators, patterns, strategies, candlesticks, support-resistance |
| FUNDAMENTAL / FINANCIALS | `_core`, fundamental |
| NEWS (ticker/card/digest) | `_core`, news |
| OPTIONS | `_core`, indicators(변동성 관련 gated 발화만; 구현 시 옵션 프롬프트의 현행 스킬 사용 여부 재확인) |
| OVERALL | 없음 — 하위 분석 요약만 소비(현행 유지) |

- **fail-open 제거**: `gating` 미태그 스킬은 로더 에러. 미태그 12개는 감사 후 전부 명시 태깅(지표 6개는 "해당 지표가 페이로드에 포함" 상태 게이트 후보, fundamental/news 6개는 카테고리 필터로 자동 해결 + 명시 태깅 병행).
- **차트 패턴 스킬 17개 — 2단계 전환** (사용자 결정: 스크리너 최우선):
  1. 프리스크리너(§3.3) 구현·검증 완료 전: always_on 유지 + digest 압축(105KB → ~25KB).
  2. 스크리너 검증(재현율) 통과 후: **gated로 강등**, 스크리너 후보가 트리거. always_on에는 17개 패턴의 한 줄 인덱스(이름 + 모양 시그니처, 총 ~2KB)를 남겨 미탐 안전판으로 삼는다.
- **관련성 정렬**: 게이트 통과 스킬을 결정적 점수(발화 트리거 수 + `detectSignals` 신호 강도)로 정렬해 관련도 높은 스킬이 데이터 섹션 가까이 배치. 상한 없음, 순서만.
- **결과 구조**: `selectSkills(skills, ctx)` → `{ core: Skill[], selected: Skill[] }` — `core`(always_on, 정렬 고정)는 stable prefix로, `selected`(발화분, 관련성 정렬)는 dynamic suffix로.

### §3.3 차트 패턴 프리스크리너 (`core/src/domain/patterns/`)

목적: 정밀 탐지기가 아니라 **스킬 주입 후보 선별기**. 최종 판정은 AI가 한다.

- **피벗 기하 기반, 스케일 불변**: ATR 배수/가격 % 기반 zigzag 피벗 추출 → 패턴을 피벗 시퀀스의 상대 기하로 판정. 축소·확대·타임프레임·가격대에 불변.
  - H&S: 피벗 5점 시퀀스, 좌우 숄더 높이 차 허용 밴드(X%), 머리>숄더 Y×ATR, 넥라인 기울기 허용 범위.
  - 더블탑/바텀: 두 극점이 k×ATR 이내 + 중간 되돌림 깊이 조건.
  - 삼각형/쐐기/깃발: 피벗 고점열·저점열 각각의 회귀 기울기 부호 + 수렴/평행 판정.
- **재현율 우선**: 오탐 비용 = digest ~1.5KB 낭비, 미탐 비용 = 품질 저하. 문턱은 느슨하게("그럴싸하면 후보").
- 허용 밴드 파라미터는 상수 파일 1곳에 집약(튜닝 가능). 위 X/Y/k 등 초기값은 스펙에서 확정하지 않는다 — PR1에서 알려진 패턴 픽스처에 대한 재현율 튜닝으로 결정하고, 각 상수 옆에 근거를 주석으로 문서화한다.
- `buildSkillSelectionContext`에 스크리너 결과를 셋째 입력으로 추가(기존: 신호, 캔들 패턴).
- **검증**: 알려진 패턴 보유 차트 픽스처로 재현율 테스트 + 실 차트 로깅 관측(§3.7 PR1) 후에만 §3.2의 gated 전환을 실행.

### §3.4 어셈블리 2분할 + Worker 프롬프트 캐싱

**빌더 출력 (core):**

```ts
interface AssembledPrompt {
  stable: string;   // (analysisType, 카탈로그 fingerprint)에만 의존 — 바이트 단위 동일 보장
  dynamic: string;  // 심볼·시점 종속 — 매 호출 변동
}
```

- `stable`: 분석 의도 블록, 가이드라인, 안티-fabrication 가드레일, 잔류 출력 서술 규칙(§3.5), always_on 스킬 digest(+ 패턴 인덱스). `jobId`/`seed`/심볼/시각 포함 금지.
- `dynamic`: 발화 gated 스킬 digest(관련성 정렬), bars/지표/SMC 데이터, 티어·타임프레임 조건부 노트(`PRO_RELIABILITY_NOTE`, `ATR_EXTREME_SIZING_NOTE` — prefix 변형 최소화를 위해 dynamic으로 이동), 심볼별 요청 블록.
- 순서 원칙: 지시·지식(stable) 앞, 데이터·질문(dynamic) 뒤.

**Dispatch 계약 (core → worker):** 기존 `prompt` 필드 유지 + `promptStable`/`promptDynamic` 추가. worker는 신필드 우선, 없으면 `prompt`. **배포 순서: worker 선배포(양쪽 수용) → core 전환.**

**Worker 캐싱:**

- Gemini(기본): `promptStable + promptDynamic` 순 결합만으로 2.5 계열 implicit caching 적중. `cachedContentTokenCount` 로깅으로 적중률 관측 → 기대 이하면 explicit `cachedContent`(fingerprint 키 + TTL)로 승격(관측 후 결정).
- Claude: system 끝 + `promptStable` 끝 `cache_control: ephemeral` breakpoint 2개(chat 경로 검증 패턴 재사용).
- 텔레메트리: 잡별 `{ promptTokens, cachedTokens, latencyMs }` 로깅 — 전/후 비교와 §3.6 실증의 근거 데이터.

### §3.5 출력 규칙 일원화 + 뉴스 본문 제어

- **구조는 `responseSchema`만 담당**: 필드 존재·타입·enum을 프로즈로 반복하는 문장, "SINGLE valid JSON object" 류 삭제(structured output이 강제).
- **프로즈 잔류분**: 스키마가 표현 못 하는 것만 — 존댓말·톤, 필드 간 의미 제약, 근거 인용 규칙. stable prefix로 이동.
- `responseSchema`의 장황한 `description`도 압축(스키마도 입력 과금 대상).
- **뉴스**: 기사 관련성·최신성 정렬 → 상위 K(기본 5)는 `bodyKo` 전문(기사당 상한 N자, 기본 3,000자), 나머지는 `summaryKo`만. 전문 포함 기사의 요약 중복 제거. K·N 상수 튜닝 가능, 뉴스 A/B 케이스로 검증.

### §3.6 품질 검증 하네스 + E2E 실증

**A/B 하네스** (core 스크립트, CI 밖 수동 실행):

- 케이스: 대표 심볼 × 타임프레임 + 알려진 차트 패턴 케이스 + 뉴스 케이스. bars/뉴스는 픽스처 고정(재현성).
- 구/신 빌더 → 실제 모델 호출 → 결과 쌍을 **블라인드**(라벨 무작위) AI 심사위원(Opus)이 채점: 데이터 근거성, 환각, 실행 가능성, 패턴 판정 정확도.
- **통과 기준: 신 ≥ 구 (평균), 항목별 유의미한 하락 없음.** 미달 시 해당 스킬 digest/파라미터만 재작업 후 재실행.

**최종 E2E 실증 (머지 전 마지막 게이트, 사용자 요구):**

- `../siglens-worker` 로컬 기동(`yarn dev`), 신버전 core 링크, **dispatch → 실 모델 호출 → 정규화** 전 구간 통과.
- 타입별 최소 1케이스로 구/신 각각 실행, 3지표 실측:
  1. **품질**: 결과 쌍 블라인드 AI 심사위원 채점(위 루브릭 동일)
  2. **속도**: E2E 레이턴시 + TTFT, 웜업 후 2회차 호출로 캐시 효과 분리 측정
  3. **토큰**: `promptTokens`/`cachedTokens`/출력 토큰 — 절감률 산출
- 통과 기준: 품질 무하락(≥), 프롬프트 토큰 -60% 이상, 캐시 적중 확인.

### §3.7 롤아웃 (PR 순서 — 스크리너 최우선, 사용자 결정)

| PR | 내용 | 게이트 |
|---|---|---|
| PR1 | 차트 패턴 프리스크리너(`domain/patterns/`): 피벗 기하 + 허용 밴드 상수 + 재현율 픽스처. 스킬 선택 미연결, **로깅만**으로 실 차트 미탐률 관측 | 재현율 테스트 |
| PR2 | 스킬 digest 81개 전량 작성 + 로더 digest 파싱(누락 시 에러) + `scripts/skills-digest.ts` + `token_cost` 실측화 | **A/B 하네스 필수** |
| PR3 | 선택 엔진: 카테고리 화이트리스트, fail-open 제거, 미태그 12개 태깅, 관련성 정렬. 스크리너 검증 완료 시 패턴 스킬 gated 전환 + 패턴 인덱스 추가 | **A/B 하네스 필수**(특히 패턴 케이스) |
| PR4 | 어셈블리 2분할 + worker 신필드/캐싱(worker 선배포 → core 전환) + 텔레메트리 | 캐시 적중률 관측 |
| PR5 | 출력 규칙 일원화 + 뉴스 본문 제어 + `PROMPT_TEMPLATE_VERSION` bump | A/B(뉴스 케이스) |
| 최종 | E2E 실증(§3.6) — 품질·속도·토큰 3지표 통과 후 릴리스 | E2E 게이트 |

## 4. 버저닝·캐시 영향

- `PROMPT_TEMPLATE_VERSION` `'p1'` → `'p2'` + 타입별 버전(`FINANCIALS_…`, `ECONOMIC_EVENT_…`) 일괄 bump — 서술·직렬화 변경이므로 필수. warm 캐시 전량 콜드 스타트 1회 감수.
- digest 재생성 → `token_cost` 변동 → fingerprint 자동 무효화. 동일 토큰 수 edge는 수동 bump 정책 유지.
- `CACHE_KEY_SCHEMA_VERSION`(`'v1'`)은 응답 형태 불변이므로 유지(§3.5에서 응답 스키마 구조가 바뀌면 그때 bump).

## 5. 테스트 영향

- `toContain` 리터럴 단언 다수 갱신(`prompt.test.ts`, `prompt-gating.test.ts` 등) — 문구 변경 시 필연.
- 신규 불변식 테스트:
  1. stable prefix에 jobId/seed/심볼/시각 미포함 + 동일 입력 2회 빌드 바이트 동일.
  2. TECHNICAL 프롬프트에 fundamental/news 스킬 0개(카테고리 필터).
  3. digest 누락·미태그 스킬 → 로더 에러.
  4. 스크리너 재현율 픽스처(알려진 패턴 → 후보 포함).
- fingerprint 계약 테스트(`fingerprintCrossPath`, `skillFingerprint`)는 `tokenCost` 실측화에 맞춰 갱신.

## 6. 예상 효과 (TECHNICAL 기준)

| 단계 | 스킬 블록 크기 |
|---|---|
| 현재 | ~226 KB (≈56K tokens) |
| digest 적용 (PR2) | ~65 KB |
| 카테고리 필터 + 태깅 (PR3, 스크리너 전) | ~45–50 KB (stable prefix) |
| 패턴 gated 전환 (PR3, 스크리너 후) | prefix ~25 KB + 동적 후보 3–8 KB |
| + worker 캐싱 (PR4) | prefix 입력 과금 75–90% 할인, TTFT 단축 |

종합: 프롬프트 실크기 **-65~80%**, 잔여분 캐싱으로 비용 추가 절감, 무관 콘텐츠 0 + 관련성 정렬로 품질 개선 여지. 뉴스는 K·N 캡으로 별도 절감.

## 7. 스코프 제외 (명시)

- RAG형 런타임 스킬 검색(임베딩) — 비결정성·캐시 키 충돌·규모 대비 과잉으로 배제.
- 스킬 선택 하드 토큰 예산 — 사용자 결정으로 배제.
- bars/지표 직렬화 포맷 변경 — 이미 컴팩트, 레버 작음.
- overall 프롬프트 구조 변경 — 이미 요약 소비형으로 양호.
