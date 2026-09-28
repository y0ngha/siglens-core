# 2026-09-28 뉴스 분석 프롬프트에 매크로 캘린더 주입 (SP2-B)

siglens 스킬 `news/macro-impact.md`는 "다음 FOMC·CPI 일정을 언급하라"고 지시했지만, 뉴스 프롬프트에는 **종목 어닝 캘린더만** 들어가
모델이 날짜를 지어낼 수 있었다. SP1에서 스킬 문구를 "입력에 있을 때만"으로 바꿨고, 이 PR은 그 입력을 실제로 제공한다.

## 0. 결론

| 항목 | 변경 |
|---|---|
| `buildNewsAnalysisPrompt` | 9-인자 오버로드 끝에 선택 인자 `macroCalendar: readonly EconomicCalendarEvent[] = []` 추가(10번째) |
| 프롬프트 | 비어 있지 않으면 `## Macro Calendar` 섹션 렌더(최대 12행, 날짜 오름차순). 비어 있으면 섹션 생략 |
| 데이터 경계 | 매크로 행도 untrusted source data. "매크로 일정은 Macro Calendar 섹션에 있는 것만 언급, 없으면 날짜를 말하지 말 것" 규칙 추가 |
| `SubmitNewsAnalysisOptions` | `macroCalendar?: readonly EconomicCalendarEvent[]` |
| `runNewsAnalysis` | 프롬프트로 전달 + 캐시 입력 해시·스킬 샘플링 시드에 매크로 지문(`date|event|actual`) 포함 |
| 필터링 | **소비자 책임**(어느 나라·중요도·기간). core는 받은 것을 정렬·상한만 적용 |
| 종합 분석 | `runOverallAnalysis` 옵션에도 `macroCalendar?` 추가 → 뉴스 축의 `runNewsAnalysis` 호출로 그대로 전달. `/news` 페이지 호출과 **같은 입력 → 같은 캐시 키**여야 뉴스 축이 캐시를 재사용한다(siglens `runOverallAnalysisAction` 주석이 이 불변식을 전제) |

## 1. 렌더 형식

```
## Macro Calendar (scheduled economic releases — source data)
- 2026-10-01 08:30:00 (in 3 days) | Core PCE Price Index MoM | impact High | actual — / estimate 0.3 / previous 0.2 %
```

- `date`는 FMP 원문 그대로(`EconomicCalendarEvent.date`), 상대 일수 접미사는 기존 어닝 캘린더의 `calendarDayDiff`/상대일 포맷 헬퍼 재사용
  (`now`가 없으면 접미사 생략 — 기존 규칙과 동일).
- 숫자 `null` → `—`. 단위는 `unit`.
- 12행 초과분은 버린다(날짜 오름차순 앞쪽 12개). 입력 순서와 무관하게 정렬.
- 크립토에도 렌더(매크로·유동성 맥락이 크립토 뉴스 해석에 쓰임).

## 2. 프롬프트 문구

- 도입 문장의 "using ONLY the provided article summaries, card metadata, and earnings calendar" → "…, earnings calendar, and macro calendar".
- Data Boundary에 추가: "Macro calendar rows are scheduled releases, not news. Mention a macro event date only if it appears in the Macro Calendar section; when the section is absent, do not state any macro event date."
- "Do not fabricate … earnings dates, regulatory events …" 줄에 "macro release dates" 추가.

## 3. 캐시

- 뉴스 분석 입력 해시(`hashNewsInput` 계열)에 매크로 지문을 선택 인자로 추가 — 기존 호출(매크로 없음)의 해시는 **바뀌지 않게**
  (빈 배열이면 기존 문자열과 동일하게 조립). 매크로 행의 `actual`이 발표로 채워지면 해시가 바뀌어 재분석된다.
- 스킬 샘플링 시드 파트에도 같은 지문(빈 배열이면 기존과 동일).
- 뉴스 프롬프트 전용 버전 상수가 있으면 bump, 없으면 해시 변경으로 충분.

## 4. 테스트

- 섹션 렌더: 정렬, 12행 상한, null → `—`, `now` 유무에 따른 접미사, 빈 배열 → 섹션 없음(기존 스냅샷/문자열 불변).
- 데이터 경계 규칙 문구 존재.
- 해시: 빈 매크로 = 기존 해시와 동일, `actual` 변경 시 해시 변경.
- `runNewsAnalysis`가 옵션을 프롬프트로 전달.
- 로컬 게이트: `yarn typecheck`, 스코프 테스트, `yarn lint`.

## 5. 소비자(siglens SP3)

뉴스 분석 서버 액션에서 `EconomyProvider`(FMP) 캘린더를 US·High impact·`[오늘−2일, 오늘+14일]`로 걸러 전달. 조회 실패는 `[]`(분석을 막지 않음).
