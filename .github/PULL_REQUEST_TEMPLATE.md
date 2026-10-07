## 관련 이슈

closes #{이슈}

## 구현 내용

{내용}

## 레이어 및 코드 품질 체크

- [ ] @docs/CONVENTIONS.md 준수 확인
- [ ] @docs/FF.md 준수 확인
- [ ] 변경한 레이어의 CLAUDE.md(DOM/APP/INF) 및 PUBLIC_API.md Export 변경 체크리스트 준수 확인
- [ ] domain/: 외부 라이브러리 import 없음, 순수 함수만
- [ ] 인디케이터 초기 구간 null 반환 (0, NaN 없음)
- [ ] 반환 타입 명시
- [ ] 선언적 코드 우선 (for/while은 CONVENTIONS.md#CP-5 예외에 해당할 때만)
- [ ] any 타입 없음
- [ ] 새 파일에 대응하는 테스트 파일 포함
- [ ] 테스트 구조: describe → describe(context) → it
- [ ] 초기 구간 null 케이스 테스트 포함
- [ ] 매직 넘버 없음

## 변경 파일 목록

[생성]

[수정] 

## CI Check lists

- [ ] yarn format
- [ ] yarn lint
- [ ] yarn lint:style
- [ ] yarn test
- [ ] yarn build