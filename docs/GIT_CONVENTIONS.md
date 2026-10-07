# Git Conventions

## 브랜치 네이밍

```
{type}/{이슈 번호}/{이슈 한줄 요약}
```

```
feat/2/도메인-공통-타입-정의
feat/4/alpaca-provider-구현
fix/8/rsi-초기구간-null-처리
chore/1/프로젝트-초기-환경-설정
```

**규칙**
- base 브랜치: main
- 한글 허용, 공백은 하이픈(-)으로 대체
- 영문은 소문자 kebab-case
- 이슈 번호 필수

---

## 커밋 타입

| 타입 | 설명 | 예시 |
|------|------|------|
| `feat` | 새로운 기능 | `feat: RSI 인디케이터 구현` |
| `fix` | 버그 수정 | `fix: RSI 초기 구간 null 처리 오류` |
| `chore` | 빌드, 설정, 패키지 | `chore: vitest 설정 업데이트` |
| `style` | 코드 포맷, 스타일 | `style: MA 오버레이 컬러 수정` |
| `refactor` | 리팩토링 | `refactor: AlpacaProvider 에러 처리 개선` |
| `test` | 테스트 추가/수정 | `test: calculateMACD 엣지 케이스 추가` |
| `docs` | 문서 수정 | `docs: DOMAIN.md RSI 명세 업데이트` |

---

## 커밋 메시지 형식

```
{type}: {변경 내용}
```

**예시**
```
feat: 도메인 공통 타입 정의
fix: RSI 초기 구간 null 처리 오류 수정
test: calculateRSI 엣지 케이스 테스트 추가
docs: DOMAIN.md VWAP 명세 추가
```

**규칙**
- 한글 사용 가능
- 마침표 없음
- 50자 이내
- 명령형 현재 시제

---

## PR 규칙

```
base 브랜치: main
제목: {type}: {이슈 제목}
```

**본문 템플릿**: `.github/PULL_REQUEST_TEMPLATE.md` 자동 적용됨.

<a id="G-1"></a>
#### G-1 — 한 PR은 한 관심사만 다룬다

관련 없는 변경은 별도 PR로 옮기거나 되돌린다. 관련 변경이 꼭 필요하면 커밋 메시지나
PR 본문에 이유를 적는다. 리뷰 범위가 흐려지고, 되돌려야 할 때 함께 끌려가기 때문이다.

---

## 릴리스

<a id="G-2"></a>
#### G-2 — publish 워크플로 성공은 패키지 사용 가능을 뜻하지 않는다

워크플로가 `success`로 끝나도 레지스트리의 tarball이 깨져 있을 수 있다(메타데이터는
정상인데 다운로드가 `409 Package file checksum mismatch`). 소비자(`siglens`,
`siglens-worker`, `siglens-trader`)의 코어 버전을 올리기 **전에** `dist.tarball`을
인증 헤더로 직접 받아 본다. `302`가 정상이다.

```bash
curl -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" <dist.tarball>
```

같은 버전은 재발행할 수 없으므로 `409`가 고정되면(수 분 폴링해도 그대로면 전파 지연이
아니다) 버전을 건너뛰어 다시 발행한다. 소비자 쪽 `yarn install`의 `quarantined`
메시지는 인증 문제처럼 보이지만 "tarball을 받을 수 없다"는 뜻이다.
