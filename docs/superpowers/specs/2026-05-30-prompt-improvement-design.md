# siglens 프롬프트 개선 설계 (A~E)

> 상태: 설계 승인 완료 (2026-05-30) · 구현 대기
> 범위: 그룹 A~E (5 sub-project, 약 20 PR). 그룹 F(스킬 동적 선별)는 별도 보류.
> 멀티레포: `siglens-core` / `siglens-worker` / `siglens`

---

## 1. 배경 & 목표

siglens AI 주식 분석의 모든 프롬프트(차트, 뉴스 개별/종합, 옵션, 펀더멘털, 종합, 챗봇, 마켓브리핑)를
네 기준으로 검토한 결과를 개선한다.

1. **정확도** — 분석 결과의 사실성
2. **결정성** — 같은 입력에 유사한 결과 (재현성)
3. **신뢰도** — 출력 형식·스키마의 안정성, 인젝션 방어
4. **정보 풍부·정확함** — 주입 정보의 질과 신호 대 잡음비

검토 결론: 도메인 계산·정규화·프롬프트 설계의 기본기는 높다. 가장 큰 레버리지는
**structured output 도입, 모델-부하 정합, 직접 계산 확대** 세 횡단 개선에 있다.

---

## 2. 아키텍처 컨텍스트 (개선 범위를 규정)

```
siglens(데이터수집) → siglens-core(프롬프트 빌드 + 정규화) → siglens-worker(LLM 호출) → provider(Claude/Gemini/OpenAI)
```

- **core는 LLM을 직접 호출하지 않는다.** 프롬프트 문자열만 빌드하고, worker로 `{ jobId, prompt, model, thinkingBudget?, tier }`를 POST.
  실제 추론 파라미터(temperature/seed/response_format)는 worker에 있다.
- 기본 모델 `gemini-2.5-flash-lite` (무료 티어). `MODEL_SPECS`에 `temperature: 0`은 있으나 `seed`는 없음.
- **JSON 강제 현황 (provider 비대칭):**
  - Gemini: `responseMimeType: 'application/json'` → 문법 JSON만 보장 (schema 미강제)
  - ChatGPT: `text.format.type: 'json_object'` → 문법 JSON만 보장 (schema 미강제)
  - Claude: 강제 없음 (순수 프롬프트 지시)
- **worker는 job type을 모른다.** dispatch body에 분석 종류가 없어, 차트 전용 `AI_SYSTEM_PROMPT`가
  뉴스·펀더멘털·옵션·종합에도 일괄 적용된다 (역할 충돌). → SP3-A1이 이 계약을 확장하는 것이 핵심.
- 차트 프롬프트는 `skills/` 67개 .md(~92K 토큰)를 `confidenceWeight >= 0.5` 게이트만 통과시켜 전부 inline.
- worker JSON 파싱(`normalizeJsonResponse`)은 salvage 없는 단순 `JSON.parse`.

---

## 3. 작업 목록 (A~E)

| ID | 작업 | 기준 | 레포 |
|---|---|---|---|
| C1 | 차트 프롬프트 중복 지시 통합 (readable 3중복·enum 2중복 → SSOT) | 정확 | core |
| C2 | 옵션 프롬프트 영어 전면 통일 + 펜스 정리 | 신뢰·정확 | core |
| C3 | 챗봇 Data Boundary(인젝션 방어) 추가 | 신뢰 | core |
| C4 | 마켓브리핑 Data Boundary + 스키마 강화 | 신뢰 | core |
| C5 | few-shot 전체 추가 (뉴스카드·챗봇 거절경계·종합 충돌보존) | 정확·결정 | core |
| C6 | 종합 프롬프트 축 출처 라벨 명시 | 정확 | core |
| D1 | 캐시키 프롬프트/스킬 버전화 (기술·펀더멘털) | 신뢰 | core |
| D2 | jsonrepair salvage 연결 (worker 최전방) | 신뢰 | worker |
| D3 | 브리핑 캐시키에 입력 해시 추가 | 신뢰 | core |
| A1 | dispatch 계약 확장 (analysisType + system + responseSchema?) | 신뢰·결정 | core+worker+siglens |
| A2 | 분석별 system prompt 분리 (core 직접 전송) | 정확·신뢰 | core+worker |
| A3 | provider별 schema 강제 (단순 스키마부터, 차트 보류) | 신뢰·결정 | core+worker |
| A4 | 브리핑 model 명시 전송 | 결정·신뢰 | core+worker |
| A5 | Gemini seed (입력해시 기반) | 결정 | core+worker |
| A6 | thinking 활성화 (차트·종합) — reasoning 공간 | 정확 | core+worker |
| B1 | 캔들 trend 사전 주입 | 결정·정확 | core |
| B2 | 지지/저항 후보 사전계산 (후보 제시형) | 정확·결정·정보 | core |
| B3 | 피봇/피보나치 도메인 계산 | 정확 | core |
| B4 | 추세선 후보 도메인 생성 | 정확·결정 | core |
| E1 | 뉴스 종합 기사수 상한 (priceImpact 정렬 상위 25) | 정확·정보 | siglens |
| E2 | 펀더멘털 peer 데이터 보강 (PER/PSR) | 정보·정확 | siglens(+core) |
| E3 | 펀더멘털 결측치 null vs 0 명시 | 정확 | core |
| E4 | 챗봇 prompt caching | (비용) | worker |

---

## 4. 분해 & 진행 순서

진행 순서: **SP1(C) → SP2(D) → SP3(A) → SP4(B) → SP5(E)**

| SP | 그룹 | 레포 | 위험 | 의존 |
|---|---|---|---|---|
| SP1 · 프롬프트 위생 | C | core | 낮음 | A3의 선행(옵션 enum·스키마 정돈) |
| SP2 · 캐싱·신뢰도 | D | core(+worker) | 낮음 | D3 model 부분은 A4 후 |
| SP3 · worker 계약확장 | A | core+worker+siglens | 높음 | SP1 후 |
| SP4 · 직접계산 | B | core | 중간 | 독립 |
| SP5 · 데이터흐름 | E | core+siglens+worker | 중간 | 독립 |

**핵심 의존성:** A1(계약 확장)이 A2·A3·A6의 공통 선행. SP1의 스키마 정돈이 A3의 선행.

---

## 5. 횡단 결정 기록

| 결정 | 선택 | 근거 |
|---|---|---|
| few-shot 범위 | **전체** (뉴스카드·챗봇·종합) | 출력 일관성 극대화 |
| 옵션 프롬프트 언어 | **영어 전면 통일** (출력은 한국어 유지) | 코드베이스 원칙 준수, 지시따르기 일관성 |
| reasoning 공간 (누락-1) | **thinking 모델 활용** (차트·종합만) | 전체 모델 상향 대비 저비용 |
| A2 system 전달 | **core가 직접 전송** | 빌더 옆 단일 출처 관리 |
| A5 seed | **입력해시 기반** | 같은 입력 → 같은 seed (재현성) |
| B2 레벨 | **후보 제시형** (AI 선택+서술) | 산술 환각 제거하되 AI 해석 유지 |
| E2 peer | **기존 FMP 데이터만 우선** | 추가 API 호출 비용 회피 |
| D1 캐시 버전 | **수동 `PROMPT_TEMPLATE_VERSION` 상수** | 자동 해시의 빌드 비용·불안정 회피 |
| D2 salvage 위치 | **worker 최전방** | 저장 전 1회 복구가 가장 효과적 |

---

## 6. SP1 · 프롬프트 위생 (그룹 C)

순수 프롬프트 문자열 변경 — 동작 스키마 불변, 회귀 위험 낮음.

| 작업 | 파일 | 변경 |
|---|---|---|
| C1 | `domain/analysis/prompt.ts` | readable 규칙은 `### Readable Text Formatting Rules`를 SSOT로(`CRITICAL_RESPONSE_RULES`·`buildAnalysisRequest` 중복 제거). enum은 `### Allowed Enum Values`를 SSOT로(`CRITICAL_RESPONSE_RULES` 나열은 참조 한 줄로 축약). **제거 문구의 정보를 SSOT가 100% 포함하는지 diff 확인** |
| C2 | `domain/options/optionsPrompt.ts` | 역할·지시·해석가이드 영어화. 출력 스키마 값 예시·톤 지시는 한국어 유지. ` ```json ` 펜스 제거 → "No markdown fences" |
| C3 | `domain/chat/buildChatPrompt.ts` | system prompt에 Data Boundary: 사용자 메시지·히스토리를 신뢰 지시로 취급 금지 |
| C4 | `domain/analysis/marketBriefingPrompt.ts` | Data Boundary 추가 + `<number>` 플레이스홀더 타입·단위 명시, 한국어 필드 지시 강화 |
| C5 | `newsCardPrompt.ts`·`buildChatPrompt.ts`·`overallPrompt.ts` | few-shot: 뉴스카드 summaryKo 좋은/나쁜 예 1쌍, 챗봇 거절/허용 경계 2~3쌍, 종합 충돌보존 1예 |
| C6 | `domain/analysis/overallPrompt.ts` | 4축 요약에 출처 라벨 명시("기술적 분석에 따르면…") |

**테스트:** 각 프롬프트 `*.test.ts` — 제거 문구가 한 번만 등장(C1), 영어 전환(C2), Data Boundary 문자열 존재(C3·C4), few-shot 마커(C5), 출처 라벨(C6). 90% 커버리지 유지.

**PR (4):** C1 / C2 / C3+C4(Data Boundary) / C5+C6(few-shot+출처라벨).
- 의존: C3·C5·C6가 겹치는 파일을 건드림 → Data Boundary PR 먼저 머지 후 few-shot PR.

---

## 7. SP2 · 캐싱·신뢰도 (그룹 D)

| 작업 | 파일 | 변경 |
|---|---|---|
| D1 | `infrastructure/cache/config.ts` | `PROMPT_TEMPLATE_VERSION` 상수 신설. 기술·펀더멘털 캐시키에 이 버전 + 스킬 fingerprint 추가(뉴스/종합과 동일 패턴) |
| D2 | `siglens-worker/src/ai-response.ts` | `normalizeJsonResponse`에 `jsonrepair` 폴백 1회(파싱 실패 시). worker `package.json`에 jsonrepair 추가 |
| D3 | `infrastructure/cache/config.ts` + `application/market/submitBriefing.ts` | 브리핑 캐시키에 입력(지수·섹터 값) 해시 추가. model은 A4 이후 합류 |

**테스트:** 캐시키 빌더 단위 테스트(버전·해시 반영), salvage는 worker 테스트(망가진 JSON 복구).

**PR (3):** D1(core) / D2(worker) / D3(core).

---

## 8. SP3 · worker 계약확장 (그룹 A) — 가장 큼

| 작업 | 레포 | 변경 |
|---|---|---|
| A1 | core+worker+siglens | dispatch body에 `analysisType`(enum) + `system`(분석별) + `responseSchema?` 필드 추가. worker는 미수신 시 기존 동작 fallback (하위호환) |
| A2 | core+worker | core가 분석별 system prompt 상수를 빌더 옆에 정의·export, dispatch `system`으로 전송. worker는 `body.system ?? AI_SYSTEM_PROMPT` |
| A3 | core+worker | core가 분석별 JSON Schema 객체 export. worker가 provider별 적용: Gemini `responseSchema` / GPT `json_schema`(strict) / Claude tool-use. **단순 스키마(뉴스·카드·펀더·옵션·종합)부터. 차트는 4단계 중첩이라 보류**(A6 thinking + 평탄화 후 별도 작업) |
| A4 | core+worker | `submitBriefing`이 model을 body에 포함, worker `/briefing`이 사용. D3 캐시키에 model 합류 |
| A5 | core+worker | dispatch에 입력해시 기반 정수 seed 전송 → worker Gemini `config.seed`. (Claude·GPT Responses API는 seed 미지원 → Gemini만) |
| A6 | core+worker | `analysisType ∈ {technical, overall}`이면 worker가 Gemini thinking on (reasoning 공간). 기본 모델 유지, thinking 토큰만 추가 |

**하위호환:** worker의 fallback 분기로 core 배포 → worker 배포 순서에 무관하게 안전.
**배포 순서:** worker(수신 가능하게) → core(전송 시작) → siglens(필요 시).

**테스트:** core 계약 빌더·스키마 export 단위 테스트. worker는 analysisType별 system/schema 적용 테스트(provider stub).

**PR (5):** A1+A2(계약+system) / A3(schema) / A4(briefing) / A5(seed) / A6(thinking).

---

## 9. SP4 · 직접계산 (그룹 B)

원칙: **숫자는 도메인이 계산, AI는 의미를 서술.** 기존 SL/TP reconcile 패턴(`actionRecommendation.ts`)의 확장.

| 작업 | 파일 | 변경 |
|---|---|---|
| B1 | `domain/analysis/prompt.ts` | 캔들 패턴 주입 시 `getSinglePatternTrend`/`getMultiPatternTrend` 결과를 함께 제공. AI는 제공 trend 신뢰(재판단 금지) |
| B2 | 신규 `domain/analysis/levelCandidates.ts` (+ prompt 주입) | POC/VAH/VAL·MA/EMA 수렴·swing high/low·BB 경계로 지지/저항 후보 산출(상위 N). 프롬프트에 "후보 레벨" 섹션. **AI는 선택+reason 서술**(후보 제시형) |
| B3 | 신규 `domain/analysis/pivotFib.ts` (+ 주입) | 피봇(Standard/Fibonacci)·피보나치 retracement/extension 도메인 계산. AI는 유효성 해석만 |
| B4 | 신규 `domain/analysis/trendlineCandidates.ts` (+ 주입) | swing point 연결로 후보 추세선 생성(`extendTrendline` 활용). AI는 검증·선택. time 좌표 환각 제거 |

**테스트:** 각 신규 도메인 함수 순수 단위 테스트(90% 브랜치). 프롬프트 주입 포맷 테스트. 회귀: 동일 종목 before/after 스냅샷 비교.

**PR (4):** B1 / B2 / B3 / B4 (전부 core). 난도 낮은 순(B1→B3→B2→B4) 권장.

---

## 10. SP5 · 데이터흐름 (그룹 E)

| 작업 | 레포 | 변경 |
|---|---|---|
| E1 | siglens | `news-article` 리포지토리 `listBySymbol`에 priceImpact 정렬 + 상위 25 LIMIT. 나머지는 카운트만 |
| E2 | siglens(+core) | peer에 PER/PSR 등 추가. **기존 FMP 응답에 존재하면 사용**, 없으면 추가 호출 비용 측정 후 별도 결정 |
| E3 | `domain/analysis/fundamentalPrompt.ts` | `N/A`를 "데이터 없음(N/A)"으로 명시해 0과 구분 |
| E4 | `siglens-worker` chat 경로 | provider별 prompt caching(Claude `cache_control` / Gemini implicit / OpenAI 자동). 멀티턴 토큰 절감 |

**테스트:** E1 쿼리 정렬·제한, E3 포맷 테스트. E4는 worker 통합 테스트.

**PR (4):** E1 / E2 / E3 / E4.

---

## 11. PR 목록 (약 20)

| 순서 | PR | 레포 |
|---|---|---|
| 1–4 | C1 · C2 · C3+C4 · C5+C6 | core |
| 5–7 | D1 · D2 · D3 | core·worker·core |
| 8–12 | A1+A2 · A3 · A4 · A5 · A6 | core+worker(+siglens) |
| 13–16 | B1 · B3 · B2 · B4 | core |
| 17–20 | E1 · E2 · E3 · E4 | siglens·siglens·core·worker |

각 PR은 `구현 → review-agent → mistake-managing-agent → git-agent` 사이클(레포별 CLAUDE.md 워크플로우).

---

## 12. 테스트 전략

- core/worker 모두 **90% 브랜치 커버리지** 유지.
- 프롬프트 변경(SP1·C)·직접계산(SP4·B)은 **before/after 회귀 스냅샷**으로 동일 종목 결과 비교.
- 계약 변경(SP3·A)은 worker fallback 경로 테스트로 하위호환 보장.

---

## 13. 비범위 (Out of Scope)

- **F · 스킬 동적 선별** — 결정론적 게이팅 설계가 필요한 별도 작업. A~E 완료 후 진행.
- **기본 모델 전체 상향** — 비용 부담으로 제외. 대신 A6(thinking, 차트/종합만)으로 부분 대응.
- **reasoning 모델 전반의 thinking 비결정성** — A5(seed)·A6(thinking)로 부분 대응. 완전 재현은 provider 한계상 불가.
- **차트 분석 schema 강제** — 4단계 중첩 스키마라 A3에서 보류. thinking(A6) 적용 후 스키마 평탄화와 함께 별도 작업으로 재검토.
