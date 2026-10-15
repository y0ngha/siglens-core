# Changelog

## [2.18.1](https://github.com/y0ngha/siglens-core/compare/v2.18.0...v2.18.1) (2026-10-15)

### Bug Fixes

* byok-only 종합 분석 캐시 조회는 키 없이 통과 ([#275](https://github.com/y0ngha/siglens-core/issues/275)) ([4b088cc](https://github.com/y0ngha/siglens-core/commit/4b088ccc28b3e938b73d47a561df0a02dd2271e2))

# [2.18.0](https://github.com/y0ngha/siglens-core/compare/v2.17.0...v2.18.0) (2026-10-15)

### Features

* 공개 API 키 정책(byok-only) 옵션 추가 ([#274](https://github.com/y0ngha/siglens-core/issues/274)) ([509b411](https://github.com/y0ngha/siglens-core/commit/509b4117fada0625cc316dda9d862640a5853156))
* 수급(투자자 흐름) 분석 추가 ([#273](https://github.com/y0ngha/siglens-core/issues/273)) ([8178c97](https://github.com/y0ngha/siglens-core/commit/8178c979b1375cf8c04ea7d9573c183c8bbe765c))

# [2.17.0](https://github.com/y0ngha/siglens-core/compare/v2.16.2...v2.17.0) (2026-10-15)

### Features

* 신규 모델 7종 추가와 구모델 4종 퇴역 ([#272](https://github.com/y0ngha/siglens-core/issues/272)) ([5868f5b](https://github.com/y0ngha/siglens-core/commit/5868f5b689afbbdd474d538ad5856191700ddaae))

## [2.16.2](https://github.com/y0ngha/siglens-core/compare/v2.16.1...v2.16.2) (2026-10-11)

### Bug Fixes

* Gemini 호출에서 sampling 파라미터를 빼고 gemini-3.7-flash를 퇴역시킨다 ([#271](https://github.com/y0ngha/siglens-core/issues/271)) ([de9dc70](https://github.com/y0ngha/siglens-core/commit/de9dc706a1d671335420b1f7119090be059209ad))

## [2.16.1](https://github.com/y0ngha/siglens-core/compare/v2.16.0...v2.16.1) (2026-10-10)

### Features

* 에이전트 답변의 브랜드 표기를 언어에 맞춘다 ([#270](https://github.com/y0ngha/siglens-core/issues/270)) ([f201439](https://github.com/y0ngha/siglens-core/commit/f201439f6f35009b5fb6e184496d1bdb478f50c1))

# [2.16.0](https://github.com/y0ngha/siglens-core/compare/v2.15.2...v2.16.0) (2026-10-09)

### Features

* 미터형 하루 전체 공개 정책과 get_guide 에이전트 툴을 추가한다 ([#269](https://github.com/y0ngha/siglens-core/issues/269)) ([265c65c](https://github.com/y0ngha/siglens-core/commit/265c65c9d52970d05610ced32826839be1208477))

## [2.15.2](https://github.com/y0ngha/siglens-core/compare/v2.15.1...v2.15.2) (2026-10-09)

### Bug Fixes

* 브라우저 번들에서 ES2023 배열 메서드를 빼 Chrome 109에서 앱이 깨지지 않게 한다 ([#268](https://github.com/y0ngha/siglens-core/issues/268)) ([703c5c4](https://github.com/y0ngha/siglens-core/commit/703c5c4d34a1d4596088beac133dd047541dcbb9))

## [2.15.1](https://github.com/y0ngha/siglens-core/compare/v2.15.0...v2.15.1) (2026-10-08)

### Bug Fixes

* 최종 A/B·독립 재검증 후속 — 무효화 지난 패턴 제외, 계산 섹션 서술 금지, 카드 정리, 라운딩 작도 보정 ([#267](https://github.com/y0ngha/siglens-core/issues/267)) ([bbf5374](https://github.com/y0ngha/siglens-core/commit/bbf537493520515f4571ef1daf5e1a4d87c2f242))

# [2.15.0](https://github.com/y0ngha/siglens-core/compare/v2.14.1...v2.15.0) (2026-10-08)

### Bug Fixes

* 패턴 작도의 레벨 흔들림·오탐을 줄이고 리뷰·A/B 후속을 반영한다 ([#266](https://github.com/y0ngha/siglens-core/issues/266)) ([2b778f0](https://github.com/y0ngha/siglens-core/commit/2b778f00a1692961066078fd9e32544105c5314a))

### Features

* 에이전트 문체 규칙에 no-ai-slop 이중언어 갱신을 반영한다 ([#265](https://github.com/y0ngha/siglens-core/issues/265)) ([6ae8c78](https://github.com/y0ngha/siglens-core/commit/6ae8c781d0ce8c19a4136cb0b7fab48ffb54a1c4))

## [2.14.1](https://github.com/y0ngha/siglens-core/compare/v2.14.0...v2.14.1) (2026-10-08)

### Bug Fixes

* 차트 패턴 작도를 엄격한 자격 판정으로 분리해 교과서 정의를 지키게 한다 ([#264](https://github.com/y0ngha/siglens-core/issues/264)) ([7e18e4c](https://github.com/y0ngha/siglens-core/commit/7e18e4c9fecb8c955fe40a70c2d465c9c454243b))

# [2.14.0](https://github.com/y0ngha/siglens-core/compare/v2.13.1...v2.14.0) (2026-10-06)

### Performance Improvements

* 생성 중복·캐시 키 흔들림을 줄이고 에이전트 프롬프트 프리픽스를 고정한다 ([#261](https://github.com/y0ngha/siglens-core/issues/261)) ([121ea69](https://github.com/y0ngha/siglens-core/commit/121ea69b5292a179dd26edc7d81b38d7de77dcd1))

## [2.13.1](https://github.com/y0ngha/siglens-core/compare/v2.13.0...v2.13.1) (2026-10-06)

### Bug Fixes

* 프롬프트가 쓸 수 없는 시장 이벤트가 분석 캐시 키를 바꾸지 않게 한다 ([#260](https://github.com/y0ngha/siglens-core/issues/260)) ([f2882ca](https://github.com/y0ngha/siglens-core/commit/f2882ca97ce8903b2bb4585fe47add718cc88e51))

# [2.13.0](https://github.com/y0ngha/siglens-core/compare/v2.12.0...v2.13.0) (2026-10-05)

### Features

* 거시 브리핑 단위·뉴스 요약·후속 질문 프롬프트 개선 ([#259](https://github.com/y0ngha/siglens-core/issues/259)) ([809d326](https://github.com/y0ngha/siglens-core/commit/809d326f3c6cde35b5529079fd5d2da3088a01d8))

# [2.12.0](https://github.com/y0ngha/siglens-core/compare/v2.11.0...v2.12.0) (2026-10-05)

### Bug Fixes

* 분석 캐시 만료를 시장 세션별로 하고, 뉴스 동인 문장이 입력을 가리키지 않게 한다 ([#258](https://github.com/y0ngha/siglens-core/issues/258)) ([c3565bf](https://github.com/y0ngha/siglens-core/commit/c3565bf80de3f02280c234829f3bbeca1570b5fb))

# [2.11.0](https://github.com/y0ngha/siglens-core/compare/v2.10.0...v2.11.0) (2026-10-05)

### Features

* 극단 구간 머문 기록 집계(summarizeExtremeZoneEpisodes)를 추가하고 수익률 집계를 deprecated로 둔다 ([#257](https://github.com/y0ngha/siglens-core/issues/257)) ([cd84fff](https://github.com/y0ngha/siglens-core/commit/cd84fff7286c316840541f03425c405b1aad8912)), closes [#256](https://github.com/y0ngha/siglens-core/issues/256)

# [2.10.0](https://github.com/y0ngha/siglens-core/compare/v2.9.0...v2.10.0) (2026-10-05)

### Features

* 공포·탐욕 지수를 5년 일봉 기준으로 계산 ([#255](https://github.com/y0ngha/siglens-core/issues/255)) ([f5b1cbd](https://github.com/y0ngha/siglens-core/commit/f5b1cbdc19d27dfaa4dcced9b9e67177c868702a))

# [2.9.0](https://github.com/y0ngha/siglens-core/compare/v2.8.1...v2.9.0) (2026-10-04)

### Features

* 공포·탐욕 구간 전환·극단 구간 사후 집계·시장 대비 차이 계산 추가 ([#253](https://github.com/y0ngha/siglens-core/issues/253)) ([c54a652](https://github.com/y0ngha/siglens-core/commit/c54a652917378d234caa20ed8d931a7b1bd762b3))

## [2.8.1](https://github.com/y0ngha/siglens-core/compare/v2.8.0...v2.8.1) (2026-10-04)

### Bug Fixes

* Overall Analysis가 최신 Technical 분석을 peek key로 재사용 ([#251](https://github.com/y0ngha/siglens-core/issues/251)) ([7d8b40f](https://github.com/y0ngha/siglens-core/commit/7d8b40f27e7727051031146925291ad8df5e6978))

### Performance Improvements

* Analysis Intent를 안정 Prefix로 이동하여 Cache 효율 개선 ([#250](https://github.com/y0ngha/siglens-core/issues/250)) ([c1a70a2](https://github.com/y0ngha/siglens-core/commit/c1a70a23a6d6aa76156677ea17cb0ed9a3c1680b))
* News Card 모델을 DeepSeek으로 전환하고 Prompt Cache 구성 ([#249](https://github.com/y0ngha/siglens-core/issues/249)) ([0de1c35](https://github.com/y0ngha/siglens-core/commit/0de1c3510bbcbb3b74c57ab035d6e7b010f7bbf1))

# [2.8.0](https://github.com/y0ngha/siglens-core/compare/v2.7.1...v2.8.0) (2026-10-03)

### Features

* 에이전트 시스템 프롬프트 confluence 통합 및 작문 스타일 개선 ([#248](https://github.com/y0ngha/siglens-core/issues/248)) ([7910322](https://github.com/y0ngha/siglens-core/commit/791032279aa887fd8e46a64ff96cc13888fde9c6))

## [2.7.1](https://github.com/y0ngha/siglens-core/compare/v2.7.0...v2.7.1) (2026-10-02)

### Bug Fixes

* **analysis:** 모델이 직접 셈하다 틀리던 비교값을 프롬프트에 계산해 넣기 (p21) ([#247](https://github.com/y0ngha/siglens-core/issues/247)) ([59846d2](https://github.com/y0ngha/siglens-core/commit/59846d2f401b0884248e37343743c9a621a8a486))

# [2.7.0](https://github.com/y0ngha/siglens-core/compare/v2.6.0...v2.7.0) (2026-10-02)

### Features

* **overlays:** 무효화·목표가 수평선 + 이미 지난 엘리어트·패턴 제외 ([#245](https://github.com/y0ngha/siglens-core/issues/245)) ([58cf6dc](https://github.com/y0ngha/siglens-core/commit/58cf6dc590082ab1ce651c4e8309f2acb7bfe3b5))

# [2.6.0](https://github.com/y0ngha/siglens-core/compare/v2.5.0...v2.6.0) (2026-10-02)

### Features

* **overlays:** Elliott triangles and diagonals, stricter impulse, computed invalidation/targets in candidate lines ([#244](https://github.com/y0ngha/siglens-core/issues/244)) ([00e6036](https://github.com/y0ngha/siglens-core/commit/00e6036d69b22809b082dfcecb999a8d7613fb24))

# [2.5.0](https://github.com/y0ngha/siglens-core/compare/v2.4.0...v2.5.0) (2026-10-01)

### Bug Fixes

* **overlays:** re-home cross-kind strategy ids instead of dropping them ([#243](https://github.com/y0ngha/siglens-core/issues/243)) ([3e2d668](https://github.com/y0ngha/siglens-core/commit/3e2d668d3fa7fd8e41ed87f8e99d5723b318bf44))

# [2.4.0](https://github.com/y0ngha/siglens-core/compare/v2.3.1...v2.4.0) (2026-10-01)

### Features

* **overlays:** export STRATEGY_OVERLAY_KINDS; record cross-kind drop decision and shelved prompt A/B ([#242](https://github.com/y0ngha/siglens-core/issues/242)) ([837d3f9](https://github.com/y0ngha/siglens-core/commit/837d3f9d485dddf1fd4883be7851e078a3c5909a))

## [2.3.1](https://github.com/y0ngha/siglens-core/compare/v2.3.0...v2.3.1) (2026-10-01)

### Bug Fixes

* **overlays:** match pattern targets to drawn lines, canonicalise skill names, fix id/limit edge cases ([#241](https://github.com/y0ngha/siglens-core/issues/241)) ([8aa5f01](https://github.com/y0ngha/siglens-core/commit/8aa5f016dccbcc4b6eabd50d33f7e79d1d0b8226))

# [2.3.0](https://github.com/y0ngha/siglens-core/compare/v2.2.2...v2.3.0) (2026-10-01)

### Bug Fixes

* **overlays:** strategy and pattern cards draw only their own overlays ([#240](https://github.com/y0ngha/siglens-core/issues/240)) ([2229042](https://github.com/y0ngha/siglens-core/commit/22290422f031a0521071c89dd3bef8cbf07bee1c))

## [2.2.2](https://github.com/y0ngha/siglens-core/compare/v2.2.1...v2.2.2) (2026-10-01)

### Bug Fixes

* **overlays:** fibonacci extension labels + canonical pattern skillName ([#239](https://github.com/y0ngha/siglens-core/issues/239)) ([f3d3b7d](https://github.com/y0ngha/siglens-core/commit/f3d3b7d6461f4195641579549ed29399d13ca2b8))

## [2.2.1](https://github.com/y0ngha/siglens-core/compare/v2.2.0...v2.2.1) (2026-09-29)

### Bug Fixes

* **overall:** technical 축에 positionBucket 전달 허용 — 회원 보유 종목 technical 키(:pos=) 재사용 ([#238](https://github.com/y0ngha/siglens-core/issues/238)) ([881b4b7](https://github.com/y0ngha/siglens-core/commit/881b4b798ad872a3037851517a9cdc5e2e4c02f3))

# [2.2.0](https://github.com/y0ngha/siglens-core/compare/v2.1.1...v2.2.0) (2026-09-29)

### Bug Fixes

* **cache:** 분석 캐시 키 churn 제거 — 이력 조회 창 제외·버킷 고정, technical peek 포인터 키, peek locale ([#237](https://github.com/y0ngha/siglens-core/issues/237)) ([8ff19db](https://github.com/y0ngha/siglens-core/commit/8ff19db851d9df6ccfdfe019ac00d120a23c3f03))

## [2.1.1](https://github.com/y0ngha/siglens-core/compare/v2.1.0...v2.1.1) (2026-09-29)

### Bug Fixes

* **overlays:** candidateId 없이 detected된 패턴도 유일한 스크리너 후보로 작도 ([54febac](https://github.com/y0ngha/siglens-core/commit/54febac6fd1daf5ae88f7990fdcfdf2456033442))

# [2.1.0](https://github.com/y0ngha/siglens-core/compare/v2.0.1...v2.1.0) (2026-09-28)

### Features

* add public classifyMaStack MA-stack classifier ([519d666](https://github.com/y0ngha/siglens-core/commit/519d66626e055fe078778491e63914d6ca458ed9))

## [2.0.1](https://github.com/y0ngha/siglens-core/compare/v2.0.0...v2.0.1) (2026-09-28)

### Bug Fixes

* **normalize:** priceTargets 한쪽이 bare 배열이어도 목표가 보존 ([99b4fa2](https://github.com/y0ngha/siglens-core/commit/99b4fa2093d7d6d4d72dd092001d314d618b5eee))

# [2.0.0](https://github.com/y0ngha/siglens-core/compare/v1.18.0...v2.0.0) (2026-09-28)

### Bug Fixes

* **overlays:** PR [#233](https://github.com/y0ngha/siglens-core/issues/233) 리뷰 반영 — import 순서, 빌더 실패 노출, trendline 가드, 테스트 보강 ([f2a63a0](https://github.com/y0ngha/siglens-core/commit/f2a63a0b2b7db4a972aa4fe9f6824533b2244dde))

# [1.18.0](https://github.com/y0ngha/siglens-core/compare/v1.17.2...v1.18.0) (2026-09-28)

### Bug Fixes

* **news:** 매크로 지문 JSON 직렬화 + 렌더 12행과 동일 선택 (PR [#232](https://github.com/y0ngha/siglens-core/issues/232) 리뷰 반영) ([5d9079f](https://github.com/y0ngha/siglens-core/commit/5d9079ffa9c1fd0c7acf9aa5e55028e03bc8f88e))

### Features

* **detectors:** 캔들 6종·차트 패턴 5종·신호 4종 추가 + PROMPT_TEMPLATE_VERSION p19 ([5ec29d5](https://github.com/y0ngha/siglens-core/commit/5ec29d564f583b8cb546f9bc4aecd1014f22994a))
* **news:** 뉴스·종합 분석 프롬프트에 매크로 캘린더 주입 + 종합 뉴스 축 assetClass 전달 ([03ffd10](https://github.com/y0ngha/siglens-core/commit/03ffd107430a8b1f6beb4447a14dd93e080b8912))

## [1.17.2](https://github.com/y0ngha/siglens-core/compare/v1.17.1...v1.17.2) (2026-09-26)

### Bug Fixes

* **analysis:** 뉴스성 급락이면 눌림 진입 판정을 보류한다 ([17c19ab](https://github.com/y0ngha/siglens-core/commit/17c19abb5462ccfcad428400e8572518d6ab070d))

## [1.17.1](https://github.com/y0ngha/siglens-core/compare/v1.17.0...v1.17.1) (2026-09-26)

### Bug Fixes

* **analysis:** 눌림 판독의 진입 판정을 룰 엔진이 정하게 한다 ([e1e8061](https://github.com/y0ngha/siglens-core/commit/e1e80615fa54e9661228d63db3f2ea94610bcc71))
* **signals:** near·MA200 아래 눌림 기저율 문장을 재측정에 맞춘다 ([1c66676](https://github.com/y0ngha/siglens-core/commit/1c66676efe78e765043463099167fb3ec63b01a8))

# [1.17.0](https://github.com/y0ngha/siglens-core/compare/v1.16.0...v1.17.0) (2026-09-25)

### Bug Fixes

* **signals:** evaluatePullback·classifyPullback JSDoc과 가드 분기 테스트 보강 ([494942f](https://github.com/y0ngha/siglens-core/commit/494942f2992a92240fba8c184b8386f8f3a3dd73)), closes [#227](https://github.com/y0ngha/siglens-core/issues/227)

### Features

* **agent:** get_bars_indicators pullback 필드 계약과 눌림 판독 전달 규칙 추가 ([694ae99](https://github.com/y0ngha/siglens-core/commit/694ae9950256760cdba0519277b97e5f9c5deed0))
* **analysis:** 컨플루언스 신뢰도를 서술용으로 철회하고 일봉 Short-Term Washout 블록 추가 ([95e3a52](https://github.com/y0ngha/siglens-core/commit/95e3a52b8458b4d6c8fca694b94ba5086c093436))
* **signals:** 일봉 단기 과매도 눌림 판독 evaluatePullback 추가 ([8a1ab3b](https://github.com/y0ngha/siglens-core/commit/8a1ab3b79dd5974914cf2470b1c2cb75e6654f07))

# [1.16.0](https://github.com/y0ngha/siglens-core/compare/v1.15.1...v1.16.0) (2026-09-24)

### Features

* **fear-greed:** add crypto market fear & greed index ([9f4fc22](https://github.com/y0ngha/siglens-core/commit/9f4fc220bee155fc063727c99d33706ebcf7a8e7))

## [1.15.1](https://github.com/y0ngha/siglens-core/compare/v1.15.0...v1.15.1) (2026-09-24)

### Bug Fixes

* **ai:** 이미 취소된 signal로 들어온 요청은 보내기 전에 거부한다 ([f9e012c](https://github.com/y0ngha/siglens-core/commit/f9e012cae2fdeae3a1bb426ca40838ad275d6b61))

# [1.15.0](https://github.com/y0ngha/siglens-core/compare/v1.14.0...v1.15.0) (2026-09-24)

# [1.14.0](https://github.com/y0ngha/siglens-core/compare/v1.13.1...v1.14.0) (2026-09-21)


### Features

* **overall:** 뉴스 축이 no_news면 오류 대신 abstain 처리한다 ([3282dda](https://github.com/y0ngha/siglens-core/commit/3282dda82f6f344688bc76fa298df90ef917ace1))

## [1.13.1](https://github.com/y0ngha/siglens-core/compare/v1.13.0...v1.13.1) (2026-09-20)


### Bug Fixes

* **overall:** technical 축이 priorAnalyses·marketEvents를 받아 캐시 키를 단독 경로와 맞춘다 ([23b6170](https://github.com/y0ngha/siglens-core/commit/23b6170c11d37eaed05afd38571aec8e84aaed76))

# [1.13.0](https://github.com/y0ngha/siglens-core/compare/v1.12.0...v1.13.0) (2026-09-20)


### Features

* **agent:** 종목·코인 발굴 질문을 시그널 스캔으로 보내고 스캔 결과의 성격을 규칙 기반으로 못박는다 ([fcee2db](https://github.com/y0ngha/siglens-core/commit/fcee2db82d0df6c0370d2de80ebb60bcfb744d90))

# [1.12.0](https://github.com/y0ngha/siglens-core/compare/v1.11.3...v1.12.0) (2026-09-19)


### Bug Fixes

* **agent:** 리뷰 지적 반영 - tools.length 가드 테스트 추가, [@internal](https://github.com/internal) 태그 추가, 테스트 분리 ([c4fabac](https://github.com/y0ngha/siglens-core/commit/c4fabac647195339cf952fa308b10db2db6da04c))


### Features

* **agent:** 도구 결과 없는 이어 묻기는 첫 스텝에서 도구 호출을 강제하고, 모델이 채운 reconciledLevels를 버린다 ([75c95f4](https://github.com/y0ngha/siglens-core/commit/75c95f48290f8c8e2f35a6b9aa6287016ec2e2b9))

## [1.11.3](https://github.com/y0ngha/siglens-core/compare/v1.11.2...v1.11.3) (2026-09-19)


### Features

* **agent:** 답변 깊이를 대화에서 자동으로 고르고 쉬운 답에 더 깊게 보기 제안을 붙인다 ([9b444b3](https://github.com/y0ngha/siglens-core/commit/9b444b314a377ae02c65fdfc54e79da538d9391e))

## [1.11.2](https://github.com/y0ngha/siglens-core/compare/v1.11.1...v1.11.2) (2026-09-19)


### Bug Fixes

* **analysis:** 캐시에서 읽은 분석도 planCheck를 잃지 않게 한다 ([7c3f596](https://github.com/y0ngha/siglens-core/commit/7c3f596b60ff086654a76b4d8b759fbadcf0d8b2))

## [1.11.1](https://github.com/y0ngha/siglens-core/compare/v1.11.0...v1.11.1) (2026-09-19)


### Bug Fixes

* **analysis:** 모델이 채운 reconciledLevels에도 결정론적 손익비 줄을 붙인다 ([08e8d3d](https://github.com/y0ngha/siglens-core/commit/08e8d3d705f6f89ac7d4b5db0de16423db0840b8))
* **analysis:** 손익비 줄이 두 경로 모두 가장 가까운 목표가를 쓰게 한다 ([0a91d0e](https://github.com/y0ngha/siglens-core/commit/0a91d0e0b9ae647d664bd871629e5ea109b6ddcf)), closes [#215](https://github.com/y0ngha/siglens-core/issues/215)


### Features

* **agent:** get_bars_indicators 설명에 ranges·ma50Pct를 추가한다 ([e2ff8e9](https://github.com/y0ngha/siglens-core/commit/e2ff8e97e865a65bc7442441fc00c871030fe616))

# [1.11.0](https://github.com/y0ngha/siglens-core/compare/v1.10.1...v1.11.0) (2026-09-19)


### Features

* **agent:** 에이전트 프롬프트에 "계산 금지" 규칙과 지평선·분석-대비-현재 규칙 추가 ([16bb993](https://github.com/y0ngha/siglens-core/commit/16bb99335cd9ba67782bdb307cee7295868f6ce4))
* **app:** 응용층 분석 실행기와 공개 인터페이스 확장 ([c0784ef](https://github.com/y0ngha/siglens-core/commit/c0784eff8d95ee2675adcc8a0d69c502a338f29b))
* **pattern:** 패턴 기하와 목표 계산 함수들을 추가한다 ([9ec4c3f](https://github.com/y0ngha/siglens-core/commit/9ec4c3f6f7105d49bc45400bf41374c820802b6d))
* **prompt:** 기본재무·재무·뉴스·시장브리핑 프롬프트에 계산된 수치 추가 ([486bea0](https://github.com/y0ngha/siglens-core/commit/486bea03802b881af85f3818d68e0e94c81dafa2))
* **prompt:** 기술 분석 프롬프트 "지표 상태" 섹션과 위험:수익 결정론적 텍스트 ([d3921a7](https://github.com/y0ngha/siglens-core/commit/d3921a7340c569e86e9d4b03b46f3eed1726831a))
* **prompt:** 전체·거시·경제·옵션·채팅 프롬프트에 계산된 수치 추가 ([6f64e35](https://github.com/y0ngha/siglens-core/commit/6f64e35204de3e52d2c3374083cc161fd9a8d4f3))
* **prompt:** 지표 상태와 캔들 패턴 후보 섹션 추가 ([e267f6f](https://github.com/y0ngha/siglens-core/commit/e267f6fb7663a5f7f46865dd6ed7d7cc466a0093))
* **prompt:** reconcileBullishActionRecommendation이 로케일을 통해 손익비를 출력 언어로 렌더한다 ([bf7f480](https://github.com/y0ngha/siglens-core/commit/bf7f4808b229adefc28e5ff461fe03c8f52df4d0))
* **types:** 지표 상태, 패턴 기하, 옵션 수량화 타입 추가 ([620b23c](https://github.com/y0ngha/siglens-core/commit/620b23cb722fce97dc7cfe057ba451a46b9574fc))

## [1.10.1](https://github.com/y0ngha/siglens-core/compare/v1.10.0...v1.10.1) (2026-09-17)


### Bug Fixes

* **prompt:** 분석 산문이 독자에게 행동을 지시하지 않게 한다 ([72b18fe](https://github.com/y0ngha/siglens-core/commit/72b18fe56456c48da4233f854bcaa68a6b30d81a))

# [1.10.0](https://github.com/y0ngha/siglens-core/compare/v1.9.0...v1.10.0) (2026-09-17)


### Features

* 컨플루언스 HTF 게이트 모드 옵션(htfMode) 추가 ([234b389](https://github.com/y0ngha/siglens-core/commit/234b38943366dd64b32b4b7cbdc1a6f2d315b3ad)), closes [#211](https://github.com/y0ngha/siglens-core/issues/211)

# [1.9.0](https://github.com/y0ngha/siglens-core/compare/v1.8.0...v1.9.0) (2026-09-17)


### Bug Fixes

* **news:** peek never throws on a corrupted cache payload; PUBLIC_API option list corrected ([49111f6](https://github.com/y0ngha/siglens-core/commit/49111f6d2f0279f42bf3661a86d0135e9ade8531))
* **news:** review follow-ups — export MarketNewsDigestCacheKeyOptions, import order, key helper tests ([beab811](https://github.com/y0ngha/siglens-core/commit/beab811431a5b78b7c617975ba9bdd0a3505ca10))


### Features

* **news:** add peekMarketNewsDigestCache read-only cache peek ([d69e992](https://github.com/y0ngha/siglens-core/commit/d69e99238ed2fd98b89c484bf8a3ed2cd0403db9))

# [1.8.0](https://github.com/y0ngha/siglens-core/compare/v1.7.0...v1.8.0) (2026-09-17)


### Bug Fixes

* **agent:** 전망 질문 라우팅 행이 두 툴 중 하나만 있어도 남게 하고 툴별 규칙을 가용성에 맞춘다 ([32fe6b7](https://github.com/y0ngha/siglens-core/commit/32fe6b7a2fd067b3138c4846e7bd39387af5cee5)), closes [#208](https://github.com/y0ngha/siglens-core/issues/208)
* **agent:** Rules 섹션을 배열 필터링으로 바꿔 빈 줄 렌더링을 없애고 부재 분기 테스트를 채운다 ([0261f88](https://github.com/y0ngha/siglens-core/commit/0261f88721a2453179fe941539fb83b15caab805)), closes [#208](https://github.com/y0ngha/siglens-core/issues/208)


### Features

* **agent:** 데이터가 가리키는 방향을 말하고 사용자 용어 수준에 맞추며 입장을 유지한다 ([b0d55c0](https://github.com/y0ngha/siglens-core/commit/b0d55c0f0fa065dc1c3d5976fbc5f4a2bae154d8))

# [1.7.0](https://github.com/y0ngha/siglens-core/compare/v1.6.1...v1.7.0) (2026-09-15)


### Bug Fixes

* **agent:** 근거 수치 비교를 반 단위 허용 오차로 바꿔 반올림 경계 오탐 제거 ([155bd57](https://github.com/y0ngha/siglens-core/commit/155bd57d6c406243c1deaec7515509cd060e0b05))
* **agent:** 컨플루언스 확인 규칙을 방향성 질문으로 한정 ([b82969b](https://github.com/y0ngha/siglens-core/commit/b82969bbe22882af93df49e36f7201493a424750))


### Features

* **agent:** 종목 분석 질문에 컨플루언스 확인을 필수화 (프롬프트 2026-09-15.1) ([e53c082](https://github.com/y0ngha/siglens-core/commit/e53c0827fb71e36ff86870defffd15b16b0718c7))
* **ai:** DeepSeek 스트림 무응답 감시 + 옵트인 Gemini 3.6 폴백 ([bfe56d0](https://github.com/y0ngha/siglens-core/commit/bfe56d00f687529c3c2dc3d5234dcd377e1a864c))

## [1.6.1](https://github.com/y0ngha/siglens-core/compare/v1.6.0...v1.6.1) (2026-09-14)


### Bug Fixes

* **agent:** 툴 타임아웃 상향 — free/cached 10s→30s, external 8s→15s ([85c0fc8](https://github.com/y0ngha/siglens-core/commit/85c0fc8f41502e7ddaf9af080bee4db7c542995c))
* **agent:** findUngroundedNumbers 오탐 감소 — 지수명·기간 표기 숫자 제외, 비율×100 퍼센트 허용(분수형 한정) ([d57293c](https://github.com/y0ngha/siglens-core/commit/d57293c00d469642420b41948b427d39ebc19bf7))
* **agent:** PR [#205](https://github.com/y0ngha/siglens-core/issues/205) 리뷰 반영 — 지수명 숫자를 명칭 숫자 목록으로 한정해 실제 지수 값은 대조 ([13739d1](https://github.com/y0ngha/siglens-core/commit/13739d17eb3a7f79e9e8761650ba17099eca9446))
* **agent:** PR [#205](https://github.com/y0ngha/siglens-core/issues/205) 재리뷰 반영 — 지수명·기간 제외는 토큰 전체 일치일 때만, 천단위 쉼표 지수값 대조 ([46075fc](https://github.com/y0ngha/siglens-core/commit/46075fc5e88fe6a88d7e94311f96a126863e4e97))

# [1.6.0](https://github.com/y0ngha/siglens-core/compare/v1.5.0...v1.6.0) (2026-09-14)


### Features

* **agent:** 데이터 도구 4종 추가·도구 설명 정합화·답변 숫자 근거 대조 헬퍼 ([3e369ce](https://github.com/y0ngha/siglens-core/commit/3e369cec80bb4d8701cb5f6f76821a40f1e240a3))

# [1.5.0](https://github.com/y0ngha/siglens-core/compare/v1.4.0...v1.5.0) (2026-09-13)


### Bug Fixes

* **agent:** PR [#203](https://github.com/y0ngha/siglens-core/issues/203) 리뷰 반영 — 형식만 맞는 무효 시각 가드 테스트, timeZone JSDoc 계약 정정 ([6f990fd](https://github.com/y0ngha/siglens-core/commit/6f990fdd2f849689d078716c3ddd0df7e2159223))


### Features

* **agent:** 답변 시각을 사용자 시간대로 — 툴 결과 ISO 시각 사전 변환, 프롬프트에 사용자 현지 시각 ([76afc52](https://github.com/y0ngha/siglens-core/commit/76afc52796369a19200b2234bc1d298c30f86b54))

# [1.4.0](https://github.com/y0ngha/siglens-core/compare/v1.3.1...v1.4.0) (2026-09-13)


### Bug Fixes

* **agent:** PR [#202](https://github.com/y0ngha/siglens-core/issues/202) 리뷰 반영 — 무제한 한도 장애 무관 테스트, 유지하는 일일 한도 분기 의도 주석, 프롬프트 버전 연속화(.4) ([4f4a3ec](https://github.com/y0ngha/siglens-core/commit/4f4a3ec1224b80f075763912673820654c2dc702))
* **agent:** PR [#202](https://github.com/y0ngha/siglens-core/issues/202) 리뷰 반영 — AgentRemaining 무제한은 null, AGENT_TURN_CAPS를 domain으로 옮겨 툴 설명과 단일 소스화, 로그 마커 [@internal](https://github.com/internal), 죽은 login_required 분기 제거 ([449d6b5](https://github.com/y0ngha/siglens-core/commit/449d6b5f4eda3e89f5975fd750d3c56e4a0f30e2))
* **agent:** PR [#202](https://github.com/y0ngha/siglens-core/issues/202) 리뷰 반영 — import 정렬, 턴 카운트 환불 경로(free) 테스트 복구 ([5f75e7d](https://github.com/y0ngha/siglens-core/commit/5f75e7dcdf79477e1bd61874b3fd75680fb4a12e))


### Features

* **agent:** 로그인 사용자의 새 분석 일일 한도 제거(Infinity) — SIGLENS 분석 정책과 일치, 무제한 한도는 카운터 미사용 ([00296c6](https://github.com/y0ngha/siglens-core/commit/00296c616838ab3a65fe5aea3969715e52053a96))
* **agent:** 분석·웹 검색 일일 한도 전 등급 제거, 로그인 사용자 턴 무제한(비회원 10회 유지), 공용 검색 예산 소진 로그 마커 ([abdeea6](https://github.com/y0ngha/siglens-core/commit/abdeea6bc042f75b4d204c30bb4a59d9053deb9e))
* **agent:** 턴당 상한 상향 — 단계 10·툴 30·웹검색 4·새 분석 3·종목 5, 새 분석 일일 한도 회원 15·Pro 30 ([a1f4abb](https://github.com/y0ngha/siglens-core/commit/a1f4abb3b3373b1df5e5a102f4d59322f2523256))

## [1.3.1](https://github.com/y0ngha/siglens-core/compare/v1.3.0...v1.3.1) (2026-09-13)


### Bug Fixes

* **agent:** 로그인 워딩·범위 밖/내부정보 가드레일·답변 중 추가 툴 호출 금지·추천 질문 브랜드 제거 ([47ae9a7](https://github.com/y0ngha/siglens-core/commit/47ae9a7685ba3035f8dbb27893c008d9244e8024))

# [1.3.0](https://github.com/y0ngha/siglens-core/compare/v1.2.1...v1.3.0) (2026-09-13)


### Bug Fixes

* **agent:** PR [#200](https://github.com/y0ngha/siglens-core/issues/200) 리뷰 반영 — 툴 설명 SIGLENS 표기, 게스트 User 블록 중복 제거 ([2616325](https://github.com/y0ngha/siglens-core/commit/26163252792f1231070d5ac0d3af95c2f82b8a3e))


### Features

* **agent:** 게스트 턴 허용·login_required 거절·SIGLENS 표기 ([fe57460](https://github.com/y0ngha/siglens-core/commit/fe574601979b69fcfd9fb01c0745346eee6bdea9))

## [1.2.1](https://github.com/y0ngha/siglens-core/compare/v1.2.0...v1.2.1) (2026-09-13)


### Bug Fixes

* **agent:** 답변 위생 — UTC 시각·내부 구조 노출·툴 전 내레이션·범위 밖 코드 작성 차단 ([ac3a7dd](https://github.com/y0ngha/siglens-core/commit/ac3a7dd06e9d245899eb65301371c29855e6c23d))

# [1.2.0](https://github.com/y0ngha/siglens-core/compare/v1.1.0...v1.2.0) (2026-09-12)


### Features

* **agent:** 첫 화면 제안 질문 프롬프트·파서 추가, 답변 출처 표기를 서비스 이름으로 강제 ([fc56bd9](https://github.com/y0ngha/siglens-core/commit/fc56bd96e0c44b2a5c01f734ed97bc9a0e399fb0))

# [1.1.0](https://github.com/y0ngha/siglens-core/compare/v1.0.4...v1.1.0) (2026-09-11)


### Bug Fixes

* **agent:** PR [#197](https://github.com/y0ngha/siglens-core/issues/197) 리뷰 반영 — 레이어 재노출 제거·상수 공유·커버리지·JSDoc ([685f9bb](https://github.com/y0ngha/siglens-core/commit/685f9bb01470d078e179d2830698226b68378197))


### Features

* **agent:** 에이전트 모듈 public export·engines >=20.3·ARCHITECTURE 갱신 ([706172f](https://github.com/y0ngha/siglens-core/commit/706172f83ff4bbe2c82d08e5bba1d9386fb671ce))
* **agent:** 에이전트 포트 타입·NormalizedUsage domain 이동·인자 검증기 ([751e070](https://github.com/y0ngha/siglens-core/commit/751e070d0d49bc31b988ed9eebbe94843d2de796))
* **agent:** 툴 카탈로그 9종·이력 창 선택·시스템 프롬프트 ([d0a26bb](https://github.com/y0ngha/siglens-core/commit/d0a26bb07b722a3a24cffbf521b576300e18a2a9))
* **agent:** 프로바이더 에러 분류 추출·기간 카운터 스토어·에이전트 한도 정책 ([601608a](https://github.com/y0ngha/siglens-core/commit/601608afe9bff885247e6c8d20a115770d0a414a))
* **agent:** runAgentTurn 에이전트 루프 ([c864311](https://github.com/y0ngha/siglens-core/commit/c864311c632ee043b591f14c0bce3ec9973dabbc))

## [1.0.4](https://github.com/y0ngha/siglens-core/compare/v1.0.3...v1.0.4) (2026-09-11)


### Bug Fixes

* **ai:** DeepSeek 연결된 JSON 응답 복구·1회 재생성, 가격 없는 봉 필터 ([3a097f1](https://github.com/y0ngha/siglens-core/commit/3a097f12ed585b07c7603bf5ea0c03395781487f))
* **cache:** 매크로 브리핑·경제 이벤트 프롬프트 버전 bump, 일봉 피벗 가드 테스트 ([a63b16e](https://github.com/y0ngha/siglens-core/commit/a63b16e918d141dedf6ac0ad86e21f25e3ab30ef))
* **prompt:** 가격 정밀도·통화 공급 계약·at-price 레벨 (감사 P1/P2) ([7fbae69](https://github.com/y0ngha/siglens-core/commit/7fbae69580dbe379c9d7074e817259d712719117))

## [1.0.3](https://github.com/y0ngha/siglens-core/compare/v1.0.2...v1.0.3) (2026-09-11)


### Bug Fixes

* **fear-greed:** 백분위 동률을 최하위가 아니라 중간 순위로 매긴다 ([eaf1c60](https://github.com/y0ngha/siglens-core/commit/eaf1c60f3057d7acf181aecc8b2059f30b3ba267))

## [1.0.2](https://github.com/y0ngha/siglens-core/compare/v1.0.1...v1.0.2) (2026-09-10)


### Bug Fixes

* 거시 브리핑 캐시 키에 프롬프트 버전 추가 ([a37a3fb](https://github.com/y0ngha/siglens-core/commit/a37a3fbaccb08ccb682fce511aa793a6dbe18d7f))
* 리뷰 반영 — 경제 이벤트 캐시 버전·import 순서 ([89a7b4b](https://github.com/y0ngha/siglens-core/commit/89a7b4b8f7db598507fb8432f9713b2d5b1e7ec4))
* 캐시 버전 축 추가·가격 포맷 스윕 ([67cd2cd](https://github.com/y0ngha/siglens-core/commit/67cd2cd7da0ac789b5e80c09ce103ad98db11179))
* 프롬프트 수치 렌더링 결함 수정 ([f05ecd3](https://github.com/y0ngha/siglens-core/commit/f05ecd390b83cf7232bd71fece49b8da8499c8ee))

## [1.0.1](https://github.com/y0ngha/siglens-core/compare/v1.0.0...v1.0.1) (2026-09-10)


### Bug Fixes

* **deepseek:** 스키마를 Responses API로 강제한다 ([#193](https://github.com/y0ngha/siglens-core/issues/193)) ([e2e1d28](https://github.com/y0ngha/siglens-core/commit/e2e1d28da57ec490c31e2a8ba6ac01db19834de5))

# [1.0.0](https://github.com/y0ngha/siglens-core/compare/v0.59.0...v1.0.0) (2026-09-10)


### Bug Fixes

* ab-harness 모델 참조 정정 및 문서 동기화 ([5406631](https://github.com/y0ngha/siglens-core/commit/5406631c909869a606228565a777cec344235f64))
* ab-harness 스크립트 모델 참조 업데이트 ([2ca654f](https://github.com/y0ngha/siglens-core/commit/2ca654f2b8be2ef8b6adeb0b71da02757998649d))


### Features

* 모델 레지스트리 및 접근 제어 체계 재정의 ([ffb6306](https://github.com/y0ngha/siglens-core/commit/ffb63066a13cd6cddaab09e310c24629f205e766))


### BREAKING CHANGES

* 모델 레지스트리 API 변경 (siglens, siglens-worker 영향)
Note: package.json 버전 업데이트는 별도 릴리스 커밋에서 처리.
deepseek-v4.1-pro는 2026-09-14부터 Flash 요청으로 라우팅되는 시간 제한 포함(주석 추가됨).

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>

# [0.56.0](https://github.com/y0ngha/siglens-core/compare/v0.55.0...v0.56.0) (2026-09-03)


### Features

* onPromptAssembled 콜백 및 lint 수정 ([3bbb16f](https://github.com/y0ngha/siglens-core/commit/3bbb16f817ffa304aa07b2d6a2b024df2d7a013b))

# [0.55.0](https://github.com/y0ngha/siglens-core/compare/v0.54.0...v0.55.0) (2026-09-03)


### Bug Fixes

* PR [#187](https://github.com/y0ngha/siglens-core/issues/187) 코드 리뷰 반영 (4차) ([42d9463](https://github.com/y0ngha/siglens-core/commit/42d9463cad3806cbc9facb3fe898ac0a9e8819d1))
* PR [#187](https://github.com/y0ngha/siglens-core/issues/187) 코드 리뷰 반영 (5차) ([2a055e9](https://github.com/y0ngha/siglens-core/commit/2a055e917e1271565e12c40a4f6ace00b6deff25))
* PR [#187](https://github.com/y0ngha/siglens-core/issues/187) 코드 리뷰 피드백 (2차) ([00822cc](https://github.com/y0ngha/siglens-core/commit/00822cc730d4871af0209eb1a76aaab8df54d373))
* PR [#187](https://github.com/y0ngha/siglens-core/issues/187) 코드 리뷰 피드백 (3차) ([24b5eb3](https://github.com/y0ngha/siglens-core/commit/24b5eb34ba94c6169f1f28855dc9471932bf5d97))


### Features

* prior-analysis context in prompts ([62f0f1c](https://github.com/y0ngha/siglens-core/commit/62f0f1c386482fa6b87644f0bc6b7d120552040a))

# [0.54.0](https://github.com/y0ngha/siglens-core/compare/v0.53.0...v0.54.0) (2026-09-01)


### Bug Fixes

* 손절·목표가 표기에 통화를 반영한다 ([937b3e2](https://github.com/y0ngha/siglens-core/commit/937b3e253c3419aadfe6c226b1c215ef9ad5437e))

# [0.53.0](https://github.com/y0ngha/siglens-core/compare/v0.52.0...v0.53.0) (2026-08-30)


### Features

* AI 산출물 출력 언어를 로케일로 받는다 ([#184](https://github.com/y0ngha/siglens-core/issues/184)) ([0294a74](https://github.com/y0ngha/siglens-core/commit/0294a74))


### Bug Fixes

* 캐시 키 접미도 알 수 없는 로케일을 ko로 정규화한다 ([#185](https://github.com/y0ngha/siglens-core/issues/185)) ([3b538ae](https://github.com/y0ngha/siglens-core/commit/3b538ae))

# [0.52.0](https://github.com/y0ngha/siglens-core/compare/v0.51.0...v0.52.0) (2026-08-23)


### Features

* overall 종합에 수치 축 가중치를 넣는다 ([#183](https://github.com/y0ngha/siglens-core/issues/183)) ([e108300](https://github.com/y0ngha/siglens-core/commit/e1083004488d18f2db4008ee542ec9bb79e114db))

# [0.51.0](https://github.com/y0ngha/siglens-core/compare/v0.50.2...v0.51.0) (2026-08-23)


### Features

* 컨플루언스 집계와 손익비를 프롬프트에서 코드로 옮긴다 ([#182](https://github.com/y0ngha/siglens-core/issues/182)) ([289eb14](https://github.com/y0ngha/siglens-core/commit/289eb1407c6c82157911aec412d8a1f42ef5ce22))

## [0.50.2](https://github.com/y0ngha/siglens-core/compare/v0.50.1...v0.50.2) (2026-08-22)


### Bug Fixes

* 컨플루언스 기본값을 실측으로 다시 잡는다 (min 2.5, 거래량 기본 off) ([9f065b5](https://github.com/y0ngha/siglens-core/commit/9f065b5b12f452d42aae7e772f3e8fe141ab7ecb))

## [0.50.1](https://github.com/y0ngha/siglens-core/compare/v0.50.0...v0.50.1) (2026-08-22)


### Bug Fixes

* 청산 임계를 진입에서 분리한다 (CONFLUENCE_EXIT_MIN) ([591728a](https://github.com/y0ngha/siglens-core/commit/591728a0af22522ecb304dc3ff188809b6755c7b))

# [0.50.0](https://github.com/y0ngha/siglens-core/compare/v0.49.0...v0.50.0) (2026-08-22)


### Features

* 지표 컨플루언스 룰을 core로 올린다 (evaluateConfluence + calculateMA export) ([ee0126d](https://github.com/y0ngha/siglens-core/commit/ee0126d99f7a5567a8d68efa390af20dd62f1ff8))

# [0.49.0](https://github.com/y0ngha/siglens-core/compare/v0.48.0...v0.49.0) (2026-08-20)


### Bug Fixes

* claude-review 지적 반영 — 공개 JSDoc 영어화 + 가드 실제 배선 ([85a0786](https://github.com/y0ngha/siglens-core/commit/85a0786befa5c14a6634b230e591f2ec0500c802))

# [0.48.0](https://github.com/y0ngha/siglens-core/compare/v0.47.1...v0.48.0) (2026-08-19)

## [0.47.1](https://github.com/y0ngha/siglens-core/compare/v0.47.0...v0.47.1) (2026-08-19)


### Bug Fixes

* **cache:** 시장 브리핑 캐시 키에 프롬프트 버전·컨텍스트 축 추가 ([5344b90](https://github.com/y0ngha/siglens-core/commit/5344b90df35f0dd8210cd0913a63a7bc5e36237a))
* **prompt:** 시장 브리핑·경제 발표 프롬프트의 미국 전제 제거 ([6b4834d](https://github.com/y0ngha/siglens-core/commit/6b4834da0e52f641a86c481478000f578d3d5bf9))

# [0.47.0](https://github.com/y0ngha/siglens-core/compare/v0.46.0...v0.47.0) (2026-08-17)

## [0.44.1](https://github.com/y0ngha/siglens-core/compare/v0.44.0...v0.44.1) (2026-08-17)


### Bug Fixes

* 다음 개장 계산이 휴장일을 건너뛴다 ([#177](https://github.com/y0ngha/siglens-core/issues/177)) ([7116436](https://github.com/y0ngha/siglens-core/commit/7116436294a3dad45e8876e53b1b9493bcdfab18))

# [0.44.0](https://github.com/y0ngha/siglens-core/compare/v0.43.0...v0.44.0) (2026-08-17)


### Features

* NYSE 휴장일·반장 캘린더를 계산으로 판정 ([#175](https://github.com/y0ngha/siglens-core/issues/175)) ([c5c66c3](https://github.com/y0ngha/siglens-core/commit/c5c66c383578398afa738b0f969ddf022193668e))

# [0.43.0](https://github.com/y0ngha/siglens-core/compare/v0.42.3...v0.43.0) (2026-08-15)


### Features

* 시장 공포탐욕지수(Market Fear & Greed Index) 도메인 모듈 구현 ([d19a812](https://github.com/y0ngha/siglens-core/commit/d19a8121f6815902ba2e4dd486155311f5279bb4))

## [0.42.3](https://github.com/y0ngha/siglens-core/compare/v0.42.2...v0.42.3) (2026-08-11)


### Bug Fixes

* **retry:** abort retries that cannot finish within the wall-clock budget ([c570f2e](https://github.com/y0ngha/siglens-core/commit/c570f2ec8b05307a2cef1a716c02726a9b070681))

## [0.42.2](https://github.com/y0ngha/siglens-core/compare/v0.42.1...v0.42.2) (2026-08-03)


### Bug Fixes

* run* 결과 타입 9개 export 추가 ([ac01db1](https://github.com/y0ngha/siglens-core/commit/ac01db1f2d7a9cdb81005f15de64f00eff9de2fe))

## [0.42.1](https://github.com/y0ngha/siglens-core/compare/v0.42.0...v0.42.1) (2026-08-02)


### Bug Fixes

* 누락된 run* export 9개 추가 ([492ffa6](https://github.com/y0ngha/siglens-core/commit/492ffa6dcc7b4e1d1080283402fcdbd6ac650c65))

# [0.42.0](https://github.com/y0ngha/siglens-core/compare/v0.41.0...v0.42.0) (2026-08-02)


* refactor!: worker job 큐 레이어 삭제 ([cedb04f](https://github.com/y0ngha/siglens-core/commit/cedb04f81ed9e06d277feac4e6c4b77138a55d9f))


### Bug Fixes

* AI SDK를 dependencies로 이동 ([6017228](https://github.com/y0ngha/siglens-core/commit/60172286cc86655b1ec70b1d8479229c54e6b56b))
* normalize가 자체 파싱하는 6곳의 중복 JSON.parse 제거 ([5019daf](https://github.com/y0ngha/siglens-core/commit/5019daf482fdec2585a3cca318aed59e3966bfad))


### Features

* 분석 in-flight 중복 제거 추가 ([3cb5d5a](https://github.com/y0ngha/siglens-core/commit/3cb5d5a487351439aa628c51ebf7dd5e6be09479))
* 분석 provider 서버 키 리더 추가 ([41a3b80](https://github.com/y0ngha/siglens-core/commit/41a3b8055b7e2d7393ce9c4453884b159dd7ccf6))
* 키 라우팅·브리핑 모델 해석을 core로 이동 ([6b0bf5f](https://github.com/y0ngha/siglens-core/commit/6b0bf5f8b185fe8aac3b502ade1c26f176aea9e3))
* AI JSON 응답 정규화를 core로 이동 ([cc9223a](https://github.com/y0ngha/siglens-core/commit/cc9223a4d2c8f16514841ae6936916dd67090f9e))
* callAnalysisAi/callBriefingAi 진입점 추가 ([196c69f](https://github.com/y0ngha/siglens-core/commit/196c69f0ab6aec76ad5f21065f719a932dd55db0))
* fundamental/financials/options/news run* 추가 ([d1e338f](https://github.com/y0ngha/siglens-core/commit/d1e338fc673f76021d18843b99ac24354b8f2aa1))
* LLM provider 어댑터 4종을 core로 이동 ([07ad7c9](https://github.com/y0ngha/siglens-core/commit/07ad7c99398c329bad37b8905332d6531c921a87))
* news/congress run* 함수 추가 ([0494256](https://github.com/y0ngha/siglens-core/commit/0494256a467e2a16a021b72a00555501b79931c1))
* overall/briefing/economy run* 추가 ([bb816a4](https://github.com/y0ngha/siglens-core/commit/bb816a496640f86ab9d32079b56614beff64f676))
* provider별 재시도 래퍼를 core로 이동 ([a63e1c5](https://github.com/y0ngha/siglens-core/commit/a63e1c5e046f59e9167583da30602a4cb72757d5))
* runAnalysis 추가 (submit+poll 통합) ([13897c7](https://github.com/y0ngha/siglens-core/commit/13897c784b4f0b86dad5cac7956dcaa4bfe8c57e))
* worker의 재시도 루프를 core로 이동 ([db7f66c](https://github.com/y0ngha/siglens-core/commit/db7f66c7765805e0d623dc28825da3f4887ba0f0))
* worker의 AI usage 정규화를 core로 이동 ([577cc52](https://github.com/y0ngha/siglens-core/commit/577cc5284d6efb6add4ba39d7f7d48112f7d602a))


### BREAKING CHANGES

* removes public API exports (submit*/poll*/cancel* functions) that consumers still import until they switch to run*.

Tests: 4111 → 3459 (drop is deleted tests for deleted code, not lost coverage)

# [0.41.0](https://github.com/y0ngha/siglens-core/compare/v0.40.0...v0.41.0) (2026-07-31)


### Bug Fixes

* 워커 디스패치 에러 처리 및 폴링 무한 루프 개선 ([7a3924f](https://github.com/y0ngha/siglens-core/commit/7a3924f7ffc3ba62727d1e1693bb8939f1f4306c))
* 의회 트렌드 분석 사용자 BYOK 키 지원 ([0316e7a](https://github.com/y0ngha/siglens-core/commit/0316e7a9ffa1da7c8265907333d1e040fd1cfdf9))

# [0.40.0](https://github.com/y0ngha/siglens-core/compare/v0.39.0...v0.40.0) (2026-07-31)


### Features

* 2026-07 LLM 모델 레지스트리 확장 ([e169ac9](https://github.com/y0ngha/siglens-core/commit/e169ac9473dc008c6d6c37c46493d88e9e473722))

# [0.39.0](https://github.com/y0ngha/siglens-core/compare/v0.38.0...v0.39.0) (2026-07-18)


### Features

* **analysis:** pure-Korean output rule + holder-consistent position framing — bump prompt to p8 ([0d21dd8](https://github.com/y0ngha/siglens-core/commit/0d21dd866cbc10e2323efc8b70907e2d80507535))

# [0.38.0](https://github.com/y0ngha/siglens-core/compare/v0.37.0...v0.38.0) (2026-07-18)


### Features

* **analysis:** position hint frames analysis for a holder (position management) — bump prompt to p7 ([fbc61d1](https://github.com/y0ngha/siglens-core/commit/fbc61d1a451fc8bdc46c25660ebb778c5e85435a))

# [0.37.0](https://github.com/y0ngha/siglens-core/compare/v0.36.0...v0.37.0) (2026-07-18)


### Bug Fixes

* address PR review — PUBLIC_API sync, JSDoc symbol, defensive hint ([f7a1d49](https://github.com/y0ngha/siglens-core/commit/f7a1d4912d98144dfceaf32970e3c83acadbc85f)), closes [#7](https://github.com/y0ngha/siglens-core/issues/7)


### Features

* add PositionBucket type + bucketizePosition ([0b0bd7a](https://github.com/y0ngha/siglens-core/commit/0b0bd7a8bb9e088700a921102e641750c4d9c2c5))
* export bucketizePosition + PositionBucket from public barrel ([6aa52d5](https://github.com/y0ngha/siglens-core/commit/6aa52d509cd36dbe279da73ee3d8b1dc6703fa16))
* thread positionBucket into analysis cache key (no template-version bump) + prompt hint ([5d6ac7b](https://github.com/y0ngha/siglens-core/commit/5d6ac7b9a40d5ccf0e4c04ca3fba4c4562d314d6))

# [0.36.0](https://github.com/y0ngha/siglens-core/compare/v0.35.0...v0.36.0) (2026-07-16)


### Features

* **tier:** expose sampled skill detections to free tier ([2b06564](https://github.com/y0ngha/siglens-core/commit/2b065641e1a020dc380456e819cc305a282a9025))

# [0.35.0](https://github.com/y0ngha/siglens-core/compare/v0.34.0...v0.35.0) (2026-07-15)


### Bug Fixes

* free-tier skill sampling grouped by `skill.type ?? 'regular'`, but fundamental/news/congress skills are type-less (only technical skills carry a type), so they collapsed into one shared group capped to 3 for free — a downstream per-category prompt filter could then be starved to zero. Fix: group by `skill.type ?? skill.category ?? 'regular'` so each non-technical category is capped independently (<=3 each); technical behavior unchanged (technical skills always have a type). Added domain mixed-catalog + starvation regression tests and congress/fundamental integration starvation tests. Note member/pro fingerprints unchanged; free keys self-invalidate via the tier-scoped fingerprint. Tests 3679 pass, coverage 99.52%. ([6732129](https://github.com/y0ngha/siglens-core/commit/6732129cc319ce6e21281122824fedbdab2ee656))
* import ordering, JSDoc, public exports, and helper extraction ([d63f986](https://github.com/y0ngha/siglens-core/commit/d63f98680f9427798119b6cf789bb46c8389e391))
* PUBLIC_API/DOMAIN docs 동기화 및 tier 관련 import/JSDoc 개선 ([0eeeb3b](https://github.com/y0ngha/siglens-core/commit/0eeeb3ba8cd84e3311dfccadc95f0f69084f9269))


### Features

* free-tier analysis gating ([8802b7e](https://github.com/y0ngha/siglens-core/commit/8802b7eb3cb38fa1d332563ceaf84c51c533c586))

# [0.34.0](https://github.com/y0ngha/siglens-core/compare/v0.33.0...v0.34.0) (2026-07-11)


### Features

* thread per-request reasoning toggle through analysis cache key ([ea8d7af](https://github.com/y0ngha/siglens-core/commit/ea8d7af4a682a5aa7b87e11f25452686639a776b))

# [0.33.0](https://github.com/y0ngha/siglens-core/compare/v0.32.1...v0.33.0) (2026-07-11)


### Features

* add DeepSeek V4 provider and make it the default ([de841fe](https://github.com/y0ngha/siglens-core/commit/de841fe098cac4b30a11a67ba3bd0a3835fdd44b))

## [0.32.1](https://github.com/y0ngha/siglens-core/compare/v0.32.0...v0.32.1) (2026-07-05)


### Bug Fixes

* **analysis:** retain compact field-shape guards for non-forced Claude path (PR review) ([53d9219](https://github.com/y0ngha/siglens-core/commit/53d921942a719af4df1ed7a2ec217c604e355ff2))

# [0.32.0](https://github.com/y0ngha/siglens-core/compare/v0.31.0...v0.32.0) (2026-07-05)


### Bug Fixes

* **analysis:** output-contract recap tail — instruction sandwiching to preserve rule recency under stable-first ordering ([e9c5c2c](https://github.com/y0ngha/siglens-core/commit/e9c5c2c71473e94bcb484d953b9914f6cad43a18))
* **analysis:** PR review round 1 — builders [@internal](https://github.com/internal), design-C doc/comment accuracy, public-type docs ([cfc08ec](https://github.com/y0ngha/siglens-core/commit/cfc08ec5abdaecf62e71eda4dd2e0df99e0cdae7))
* **analysis:** restore full output rules to prompt tail — stable carries knowledge only ([8074692](https://github.com/y0ngha/siglens-core/commit/80746923039b4ddeb382ac8df51347c40012f91c))


### Features

* **analysis:** design C — skills-to-system split, user prompt keeps production order ([d4decf8](https://github.com/y0ngha/siglens-core/commit/d4decf8585e3a480e3cea32381abcc12fc0d7aa6))
* **analysis:** split buildAnalysisPrompt (technical) into stable/dynamic assembly ([987e718](https://github.com/y0ngha/siglens-core/commit/987e718746fae266d3aa885c5ee847d9802f05a5))
* **analysis:** split congress/briefing/economy prompts into stable/dynamic assembly ([16e7b8c](https://github.com/y0ngha/siglens-core/commit/16e7b8c98e79377bd5d56545b1bb463b63e78714))
* **analysis:** split fundamental/financials/news/overall prompts into stable/dynamic assembly ([a9a1207](https://github.com/y0ngha/siglens-core/commit/a9a12070bd32ce8d936a7e100b8a098af3d878f2))
* **analysis:** split newsCard/marketNewsDigest/options prompts into stable/dynamic assembly ([33890e5](https://github.com/y0ngha/siglens-core/commit/33890e50c456dfc58b4f78746d3effdf66ce14fa))
* **types:** export ChartPatternId publicly ([6dfdcef](https://github.com/y0ngha/siglens-core/commit/6dfdcef0400aa351b17490262f1840eb5e6aa750))

# [0.31.0](https://github.com/y0ngha/siglens-core/compare/v0.30.0...v0.31.0) (2026-07-04)

# [0.30.0](https://github.com/y0ngha/siglens-core/compare/v0.29.0...v0.30.0) (2026-07-04)


### Bug Fixes

* **analysis:** grounding constraint on contingent-plan mandate — no invented levels ([57c024e](https://github.com/y0ngha/siglens-core/commit/57c024e1c3336062a526e8deed03dbbdb2e77866))
* **analysis:** mandate contingent level-plan assembly even on wait/avoid verdicts ([bceba23](https://github.com/y0ngha/siglens-core/commit/bceba23fce15a2be3f6674c21b9032e1062e3428))
* **analysis:** PR review round 1 — news template version, gate bucket fix, poll resilience, review nits ([d76e1b7](https://github.com/y0ngha/siglens-core/commit/d76e1b7011d0c420fb1c7c5e0917085e1774e084))
* **analysis:** PR review round 2 — skillWhitelist tests, shared CLI arg parser, non-chart gating docs ([9a95c15](https://github.com/y0ngha/siglens-core/commit/9a95c1520333947d4b57dae61aafe6b239130f66))
* **skills:** minimal YAML parser drops top-level keys after nested blocks — parse depth correctly ([c9a3755](https://github.com/y0ngha/siglens-core/commit/c9a3755d0eb8c5863b40ff8ec09ac3a88aad731f))


### Features

* **analysis:** category whitelist + fail-closed gating + relevance-ordered selection ([24d820f](https://github.com/y0ngha/siglens-core/commit/24d820fa8a3e908a9430b65adbace9533cf23cc4)), closes [siglens#671](https://github.com/siglens/issues/671)
* **analysis:** pattern-screener candidates as skill selection triggers ([11853a7](https://github.com/y0ngha/siglens-core/commit/11853a7994a4329ec286ae402bd66245695aaaef))
* **harness:** multi-sample runs + batched multi-pass judging with median aggregation ([403cdb9](https://github.com/y0ngha/siglens-core/commit/403cdb960c185d327623531bb69d7aacd05fe470))

# [0.29.0](https://github.com/y0ngha/siglens-core/compare/v0.28.0...v0.29.0) (2026-07-03)


### Bug Fixes

* **harness:** integer-aware gate outlier rule (was zero-tolerance 0.25 on 1-5 scale) ([f8986f6](https://github.com/y0ngha/siglens-core/commit/f8986f6c7bd241c63b1fe90472b8f8b675688ab6))
* **harness:** resumable runModels with incremental saves and stronger 503 backoff ([4491b2e](https://github.com/y0ngha/siglens-core/commit/4491b2e9dad5a06f45bea8af115dd3acb959a9b5))
* **skills:** version-split rationale in config, error cause chain, shared digest fixture ([eb3f87c](https://github.com/y0ngha/siglens-core/commit/eb3f87c027022e62ac26d4b6cc946f0c6f9beefe))


### Features

* **harness:** A/B prompt quality harness (build/run/judge) with frozen fixtures ([0f3f96b](https://github.com/y0ngha/siglens-core/commit/0f3f96b940b972d9188fa4d2a716fb57c1525d80))
* **skills:** loader injects PROMPT_DIGEST only, hard-fails on missing digest ([14f6f58](https://github.com/y0ngha/siglens-core/commit/14f6f58bada08ccfee17513d80ce86eed97543eb))

# [0.28.0](https://github.com/y0ngha/siglens-core/compare/v0.27.0...v0.28.0) (2026-07-03)


### Bug Fixes

* **patterns:** add [@internal](https://github.com/internal) tags per MISTAKES 9.5 + epsilon-guard singular determinant ([cdade61](https://github.com/y0ngha/siglens-core/commit/cdade6118b1ed08ff9d6ce533e47ba596437bccd))
* **patterns:** exception-isolate observe-only screener + jobId in log payload ([f10d3ca](https://github.com/y0ngha/siglens-core/commit/f10d3cad0ed0f2609ad998099b85045e542c0213))
* **patterns:** PR review round 2 — cast/catch justifications, branch tests, types re-export, constants consolidation ([84f1e9c](https://github.com/y0ngha/siglens-core/commit/84f1e9c302552d12b13fc90b7396d7998c3c784d)), closes [#160](https://github.com/y0ngha/siglens-core/issues/160) [#7](https://github.com/y0ngha/siglens-core/issues/7)
* **patterns:** PR review round 3 — timeless docs, H&S atr guard tests, epsilon constant ([176f495](https://github.com/y0ngha/siglens-core/commit/176f495e89cce1d4904da15ac94f37f24b44d760))
* **patterns:** PR review round 4 — flag/curvature reject-path tests, defensive guard comments ([cdddc33](https://github.com/y0ngha/siglens-core/commit/cdddc33fe8b30e02f847c22952e30daa10028113))
* **patterns:** PR review round 5 — toSorted, PivotKind alias, constant-derived test boundaries ([5b4bb09](https://github.com/y0ngha/siglens-core/commit/5b4bb095ea9c371b09e697777e45ec4b513362bf))


### Features

* **patterns:** add chart pattern screener types and tolerance constants ([ecc2866](https://github.com/y0ngha/siglens-core/commit/ecc28662be4f8aeb2a58814fdd4f4dc631d28c97))
* **patterns:** ATR-relative zigzag pivot extraction ([6b48c50](https://github.com/y0ngha/siglens-core/commit/6b48c50ac6846654215ace11469020163fa8a7bc))
* **patterns:** curvature classifiers (rounding bottom, cup and handle) ([cea3857](https://github.com/y0ngha/siglens-core/commit/cea3857d5447575610df5756f02b8692d1a0a7e9))
* **patterns:** extreme-matching classifiers (double/triple top-bottom) ([8ff2d96](https://github.com/y0ngha/siglens-core/commit/8ff2d96027c12b0f23e83ce4b1bbcd8b2a8c2457))
* **patterns:** five-pivot H&S classifiers ([95ee0df](https://github.com/y0ngha/siglens-core/commit/95ee0df7aed185c9a6fd06dc3dd16aa648382ac2))
* **patterns:** flag/pennant classifiers ([b8d50ca](https://github.com/y0ngha/siglens-core/commit/b8d50ca39b8830af63ab85e82043329d5b430044))
* **patterns:** observe-only screener logging in submitAnalysis ([eb22d52](https://github.com/y0ngha/siglens-core/commit/eb22d52b76e96c226801efee3a13a43e3b75c29a))
* **patterns:** provisional trailing pivot option + pivot edge tests ([e9bb5f1](https://github.com/y0ngha/siglens-core/commit/e9bb5f1151d7229f668099bace2b3f09b75fcf2f))
* **patterns:** screener facade with recall fixtures ([47f05d6](https://github.com/y0ngha/siglens-core/commit/47f05d692d3038476d4238164b10a0a0162120c9))
* **patterns:** trendline-pair classifiers (triangles/wedges/rectangle) ([3d1fe77](https://github.com/y0ngha/siglens-core/commit/3d1fe773fe012baf07061291932da5ff55543cd0))

# [0.26.0](https://github.com/y0ngha/siglens-core/compare/v0.25.0...v0.26.0) (2026-06-21)


### Bug Fixes

* **core:** PR [#158](https://github.com/y0ngha/siglens-core/issues/158) review round 1 — crypto fundamental-axis, dead-field removal, JSDoc/exports/docs, perf cache ([499d8ed](https://github.com/y0ngha/siglens-core/commit/499d8ed02d5704523e2a43bf21a24815dd3897ff))
* **core:** PR [#158](https://github.com/y0ngha/siglens-core/issues/158) round 2 — private session helper, non-vacuous equity test, formatter consistency, timeless JSDoc ([1cf3ad5](https://github.com/y0ngha/siglens-core/commit/1cf3ad5c5e9170c9cc6b8d26a4853ad774d460e5))
* **core:** PR [#158](https://github.com/y0ngha/siglens-core/issues/158) round 8 — PUBLIC_API return-type, ttl ceiling test, range-condition + DRY in utils ([839adbb](https://github.com/y0ngha/siglens-core/commit/839adbb9fe911273fb22d9a048c0e23d0d4de606))
* **core:** remove unused imports (PR [#158](https://github.com/y0ngha/siglens-core/issues/158) round 5 lint warnings) ([f2ab93e](https://github.com/y0ngha/siglens-core/commit/f2ab93ed02ef810a3b3a55a445c7d2d4eb6305e1))
* **prompt:** assetClass framing without fabricated chat context + crypto overall opener + falsifiable tests (core review R1-R4) ([9357a3e](https://github.com/y0ngha/siglens-core/commit/9357a3eb2635720169efe68de94fcdb813e13828))
* **prompt:** make overall Data Boundary axis-label asset-class-aware (core review R2 round-2) ([8ddae7f](https://github.com/y0ngha/siglens-core/commit/8ddae7f3c387bc640047edf0ba08936b45bf02f0))
* **test:** route assetClass via dedicated param, not removed context field (PR [#158](https://github.com/y0ngha/siglens-core/issues/158) typecheck) ([af00e67](https://github.com/y0ngha/siglens-core/commit/af00e67b7e5cd9a9a0abf33b3b3d558fa35fac17))
* **types:** restore CurrentAnalysisContext backward compat — tagged union only, assetClass optional per member ([e778746](https://github.com/y0ngha/siglens-core/commit/e77874644969850dcf0f05e1a5cbf2506988e55d))


### Features

* **app:** thread assetClass through submit + chat use-cases ([4dd2ac1](https://github.com/y0ngha/siglens-core/commit/4dd2ac1b75f06bc1a7a0b6401bc96cfee04a5549))
* **cache:** session-aware computeBarsEffectiveTtl (crypto 24/7) ([6185241](https://github.com/y0ngha/siglens-core/commit/61852419401fb02e250d497cb2a86e5ead8cc73c))
* **core:** export AssetClass, MarketSessionSpec, session functions ([3e924ea](https://github.com/y0ngha/siglens-core/commit/3e924eabd634851aa5398c4192a71903875608e3))
* **prompt:** assetClass-aware analysis prompt framing ([da0e099](https://github.com/y0ngha/siglens-core/commit/da0e099dc9a5e5177ff837b8a8bace1a24b01308))
* **prompt:** assetClass-aware chat prompt framing ([cb87a38](https://github.com/y0ngha/siglens-core/commit/cb87a38ba8a150d767eeca4f7d95e2a87f5ee0b8))
* **session:** add MarketSessionSpec and spec-driven session functions ([538c334](https://github.com/y0ngha/siglens-core/commit/538c33465a33145ee77207c30575270c2be4c402))
* **types:** add AssetClass domain type ([883e68c](https://github.com/y0ngha/siglens-core/commit/883e68c2445319741ecf4c847ab68d8ff54e4c20))

# [0.25.0](https://github.com/y0ngha/siglens-core/compare/v0.24.0...v0.25.0) (2026-06-20)


### Bug Fixes

* **economy:** analyzeEconomicEvent 리뷰 반영 — dead import 제거·캐시키 테스트 프로덕션 고정·N/A 단위 정리 ([56d158c](https://github.com/y0ngha/siglens-core/commit/56d158c7202e002a51ab7d34595a7f3beccac721))
* **economy:** core PR [#157](https://github.com/y0ngha/siglens-core/issues/157) 리뷰 반영 — [@internal](https://github.com/internal) 제거·내부타입 비공개·import/first·as 주석·normalize try-catch·모델ID 단일화·doc/test 정리 ([75a8ad1](https://github.com/y0ngha/siglens-core/commit/75a8ad13bd2a8f9c556cc469828e55ccc465df9e))
* **economy:** core PR [#157](https://github.com/y0ngha/siglens-core/issues/157) R2 반영 — parseLlmPayload 공유 추출·테스트 import 병합·PUBLIC_API 갱신·withUnit 모듈화·매직넘버/doc 정리 ([0332486](https://github.com/y0ngha/siglens-core/commit/03324861da0f8a1d3e3c6e796dd23f656b0dd9dc))


### Features

* **economy:** add analyzeEconomicEvent worker-job AI analysis family ([313209e](https://github.com/y0ngha/siglens-core/commit/313209e07c55e89ea8f87151798f2c7c160f5ebe))
* **economy:** add translateIndicatorName worker-job AI translation family ([93bb7c0](https://github.com/y0ngha/siglens-core/commit/93bb7c0cf32ef7a2e2ab96be6a8cea6907e643fb))

# [0.24.0](https://github.com/y0ngha/siglens-core/compare/v0.23.0...v0.24.0) (2026-06-18)


### Bug Fixes

* **congress:** PR [#155](https://github.com/y0ngha/siglens-core/issues/155) 리뷰 반영 — toSorted·IIFE 추출·[@internal](https://github.com/internal) 정정·export 정리·dead 필드 제거·스킬 테스트 ([181da6d](https://github.com/y0ngha/siglens-core/commit/181da6d5248c702c5c7ff136526e6e2a597dca05))
* **congress:** PR [#155](https://github.com/y0ngha/siglens-core/issues/155) APPROVED suggestions — error required + 에러 메시지 단언 ([2cd3a7f](https://github.com/y0ngha/siglens-core/commit/2cd3a7f26a8b4c0b5de93ab6b25fac6bf0af4f98))
* **congress:** PR [#155](https://github.com/y0ngha/siglens-core/issues/155) R2 — 공개 API 영어 JSDoc/주석 + 분기 커버리지(cacheKey·SyntaxError) + summarize 함수형 ([e01b8be](https://github.com/y0ngha/siglens-core/commit/e01b8be284dd47e98ae78dd93c267ed1072883e0))
* **congress:** PR [#155](https://github.com/y0ngha/siglens-core/issues/155) R3 — nested fn 추출·summarize reduce·types JSDoc·skill 중복호출 제거·테스트 분기/단언 보강 ([82a94b3](https://github.com/y0ngha/siglens-core/commit/82a94b3e9da57fe7efdd73632f1fddc885a6ce94))
* **congress:** PR [#155](https://github.com/y0ngha/siglens-core/issues/155) R4 — summarize for-of 회귀·as 캐스트 주석·MAX_TRADES_IN_PROMPT·빈 trades 테스트·browser entry congress 노출 ([fd67482](https://github.com/y0ngha/siglens-core/commit/fd67482df0762f762023aa1c02b0d188af826b29))
* **congress:** PR [#155](https://github.com/y0ngha/siglens-core/issues/155) R5 — PUBLIC_API.md 인벤토리·테스트 BASE_OPTIONS·캐시 값 단언 강화 ([dd49de4](https://github.com/y0ngha/siglens-core/commit/dd49de45b90afeea47a090e003214ea27ad79e5e))
* **congress:** provider port가 raw wire 반환하도록 정정(이중 정규화 제거) + poll TTL 단언 ([fb17644](https://github.com/y0ngha/siglens-core/commit/fb17644e6730a16f131f1a7721377382a664e9a9))
* **congress:** SkillCategory에 'congress' 추가, 프롬프트 필터 캐스트 제거 ([36bfa7f](https://github.com/y0ngha/siglens-core/commit/36bfa7f6155dff1d00e4e9b2e8ba3a3a573b3552))
* **congress:** submit 테스트 mock을 port 타입+vi.fn 참조로 정정(루트 tsc 통과) ([decdf08](https://github.com/y0ngha/siglens-core/commit/decdf0811186a3b981eccd1a4a1f69468d72e718))
* **news:** address PR [#154](https://github.com/y0ngha/siglens-core/issues/154) R2 — [@internal](https://github.com/internal) tag, JobMeta.category, cleanup ([17cdc6b](https://github.com/y0ngha/siglens-core/commit/17cdc6b904dfcc702b38e63aebdb1bd968ec1451))
* **news:** address PR [#154](https://github.com/y0ngha/siglens-core/issues/154) R3 — TypeDoc links, branch test, type strength, variant naming, doc cleanup ([20baff0](https://github.com/y0ngha/siglens-core/commit/20baff0cff567b743a260d1301ec16f7d78dac5b))
* **news:** address PR [#154](https://github.com/y0ngha/siglens-core/issues/154) R4 — JSDoc example, JobMeta type, named result type, test split ([14f2c8f](https://github.com/y0ngha/siglens-core/commit/14f2c8fb743f732f52c239527a5696d399a941b7))
* **news:** address PR [#154](https://github.com/y0ngha/siglens-core/issues/154) R5 — cover failure branches, dedup test, tighten dispatch timeout ([b0e89bc](https://github.com/y0ngha/siglens-core/commit/b0e89bcc40e3e334027b3516054514dd291ba17f))
* **news:** address PR [#154](https://github.com/y0ngha/siglens-core/issues/154) R8 — force/skip precedence lock, LOG_TAG case, branch tests ([32f97f3](https://github.com/y0ngha/siglens-core/commit/32f97f342614a57a1d5d18723bbcf71749976001))
* **news:** address PR [#154](https://github.com/y0ngha/siglens-core/issues/154) review — tryNormalizeNews helper, branch tests, PUBLIC_API, log msg ([67bf962](https://github.com/y0ngha/siglens-core/commit/67bf96235c7ebc8c56ded60c62105b6110185f0a))


### Features

* **congress:** 결정론적 건수 통계(summarizeCongressTrades) ([ee52485](https://github.com/y0ngha/siglens-core/commit/ee524855cbd568bde4d6f06e356f18d9071620f8))
* **congress:** 의회 거래 도메인 타입 추가 ([c94bd7f](https://github.com/y0ngha/siglens-core/commit/c94bd7f0573d9ef3c6d35333a03f9c5a4ec887b0))
* **congress:** AI 동향 잡 submit/poll/cancel + 캐시 설정(no_trades 분기) ([be1e839](https://github.com/y0ngha/siglens-core/commit/be1e83912c786a52fed342534d93bca750bb7d59))
* **congress:** AI 동향 프롬프트 빌더(건수 통계 주입) ([68fc013](https://github.com/y0ngha/siglens-core/commit/68fc01343e0fdf28efb5195b2e51210457701a5e))
* **congress:** ChatPanel 컨텍스트에 congress kind 추가 ([f7db534](https://github.com/y0ngha/siglens-core/commit/f7db534b86bdf91152466d40a194f5f464a7e717))
* **congress:** CongressTradesProvider port 추가 ([f97f285](https://github.com/y0ngha/siglens-core/commit/f97f285985ac62109c84ce56d3af0380b24b7ef4))
* **congress:** LLM 응답 방어 정규화(normalizeCongressTrendResponse) ([a220367](https://github.com/y0ngha/siglens-core/commit/a220367f590be9739137ee36315f0a5c423ec501))
* **congress:** public API barrel export 완성 ([80bd568](https://github.com/y0ngha/siglens-core/commit/80bd5686c0d990e5dde453690bdce8f09416dcdc))
* **congress:** wire→domain 정규화(side 변종·amount 구간·chamber) ([18ab5f3](https://github.com/y0ngha/siglens-core/commit/18ab5f399a3317eda59db1131a8bf35b1a37aa55))
* **economy:** domain types and normalizers for macro indicators ([8adfeb6](https://github.com/y0ngha/siglens-core/commit/8adfeb6a0fd7ea7bfb95760deef7c0e9f92b610a))
* **economy:** macro briefing application layer with worker integration ([742bf19](https://github.com/y0ngha/siglens-core/commit/742bf191c3f42ffa74c85f27961364826928677b))
* **news:** add market-news category digest prompt builder ([d58425d](https://github.com/y0ngha/siglens-core/commit/d58425df5b30410850aea28b016c07a50e30843d))
* **news:** add market-news digest cache key builder ([51f69b5](https://github.com/y0ngha/siglens-core/commit/51f69b5d053e8507cf2cc8132793cf49819c5802))
* **news:** add NewsFeedCategory domain type ([eeefc6b](https://github.com/y0ngha/siglens-core/commit/eeefc6be1cc544d138cec5e056e06589357213e0))
* **news:** add submit/poll for market-news category digest ([2eb8ebc](https://github.com/y0ngha/siglens-core/commit/2eb8ebcacee7d28ec76be5b3bb02271ece9913d4))

# [0.23.0](https://github.com/y0ngha/siglens-core/compare/v0.22.0...v0.23.0) (2026-06-15)

# [0.22.0](https://github.com/y0ngha/siglens-core/compare/v0.21.1...v0.22.0) (2026-06-15)


### Bug Fixes

* **financials:** address PR [#153](https://github.com/y0ngha/siglens-core/issues/153) review — use growth data, fix summary tie, FF refactor, public-API docs ([77306d2](https://github.com/y0ngha/siglens-core/commit/77306d22a03ffa0b27325dd41ebf403e24f48029))
* **financials:** address PR [#153](https://github.com/y0ngha/siglens-core/issues/153) round 2 — English JSDoc, PUBLIC_API.md, optional-field wording, dead code ([c17dce2](https://github.com/y0ngha/siglens-core/commit/c17dce27d1ae0ceab1f2b8fba87f607dbd8fe047))
* **financials:** address PR [#153](https://github.com/y0ngha/siglens-core/issues/153) round 3 — margin-tie bug, client barrel, signal type union ([af76f69](https://github.com/y0ngha/siglens-core/commit/af76f69ae1e6dde2ab99a869d4af4972f5c2422e))
* **financials:** address PR [#153](https://github.com/y0ngha/siglens-core/issues/153) round 4 — camelCase, union extraction, field JSDoc, magic-number consts, declarative poll ([8c16643](https://github.com/y0ngha/siglens-core/commit/8c166437828d05fd8f8199946f00d58dd75d2187))
* **financials:** address review — export result variants, quarterly fcfMargin key, period in cache key, schema-version doc ([9dfe899](https://github.com/y0ngha/siglens-core/commit/9dfe89919f9245277fb15f3e8d01c015f2fc4dc0))


### Features

* **financials:** add buildFinancialsAnalysisPrompt (scorecard-injected) ([906042e](https://github.com/y0ngha/siglens-core/commit/906042e569c90f852690fe15cf30a5759c5ea534))
* **financials:** add cache key, system prompt, response schema constants ([8a9717a](https://github.com/y0ngha/siglens-core/commit/8a9717a593f07722551c8edc31e3149c3fb8c80f))
* **financials:** add computeFinancialsScorecard (4-axis deterministic scoring) ([6456ae9](https://github.com/y0ngha/siglens-core/commit/6456ae9c1de0bfc1d17f952fe501d4e3713922cf))
* **financials:** add domain types (rows, snapshot, scorecard, response) ([51b0146](https://github.com/y0ngha/siglens-core/commit/51b0146671e4c6dbd62269b46c95be507150ed9b))
* **financials:** add financials kind to chat context ([98ac2c0](https://github.com/y0ngha/siglens-core/commit/98ac2c0b648f16c2f5da1c53015a5201a824026c))
* **financials:** add financials to AnalysisType union ([34e7637](https://github.com/y0ngha/siglens-core/commit/34e7637decd78162ea1619a5e68bf3c7ac2ad02a))
* **financials:** add financialsBulletsKo to overall response ([8aed515](https://github.com/y0ngha/siglens-core/commit/8aed5151a8fdff67dff540d0a217bb7753137383))
* **financials:** add FinancialStatementsProvider port ([7a1d24d](https://github.com/y0ngha/siglens-core/commit/7a1d24d3eabd02959b27a28de668dce5dc487678))
* **financials:** add normalizeFinancialsAnalysisResponse with defensive parsing ([9eff43a](https://github.com/y0ngha/siglens-core/commit/9eff43ad1719fa8d0d7b957bd589d90c9e0b291e))
* **financials:** add normalizeFinancialsSnapshot with derived margins ([adb6228](https://github.com/y0ngha/siglens-core/commit/adb6228b48c12fbd9ab37f3e7aa6e2a3a45cf17c))
* **financials:** add poll + cancel financials analysis ([fd06b95](https://github.com/y0ngha/siglens-core/commit/fd06b953f985201c1025ac3e9085a558fd05b1af))
* **financials:** add submitFinancialsAnalysis use-case ([6990153](https://github.com/y0ngha/siglens-core/commit/69901537c99e30e7d6f7c719d90ac512493fdc10))
* **financials:** inject scorecard into overall prompt, inputs, cache hash ([1f5eed3](https://github.com/y0ngha/siglens-core/commit/1f5eed3d7a0a28910e607ed8321fe36a19066430))
* **financials:** wire financials domain into public barrel ([deedf55](https://github.com/y0ngha/siglens-core/commit/deedf55f56386decc116b39057f50f4d9c24900e))

## [0.21.1](https://github.com/y0ngha/siglens-core/compare/v0.21.0...v0.21.1) (2026-06-07)

# [0.21.0](https://github.com/y0ngha/siglens-core/compare/v0.20.0...v0.21.0) (2026-06-07)


### Bug Fixes

* **review:** apply PR [#152](https://github.com/y0ngha/siglens-core/issues/152) review — [@internal](https://github.com/internal) tags, role Set, readonly, boundary tests ([401565b](https://github.com/y0ngha/siglens-core/commit/401565ba0bf3b723c7373fa74414b82027f3800d))
* **review:** sync low-confidence test fixtures with new include-and-label behavior ([3d89396](https://github.com/y0ngha/siglens-core/commit/3d89396420af5d10ad769771f3fe94e54d3c528a)), closes [#152](https://github.com/y0ngha/siglens-core/issues/152)


### Features

* **analysis:** add single-source confidence level/label + role helper ([66302d9](https://github.com/y0ngha/siglens-core/commit/66302d9d3b2c02a15ea3370daff286b20f2657b8))
* **analysis:** chart prompt uses shared 3-tier label + indicator role label ([d5fafb2](https://github.com/y0ngha/siglens-core/commit/d5fafb2551ce80a9a3a5dbeec515ef45c8db9e35))
* **analysis:** drop fundamental/news confidence floor, add confidence labels ([d8de29d](https://github.com/y0ngha/siglens-core/commit/d8de29d1224466138c3609cbb9f7f517e6570fda))
* **analysis:** drop pattern confidence floor filter ([4459b02](https://github.com/y0ngha/siglens-core/commit/4459b02c8f56fe650014370849307472de2541a6))
* **loader:** parse usage_roles with fail-safe canonical normalization ([c67d13f](https://github.com/y0ngha/siglens-core/commit/c67d13f7d129913311718932c3c8ab864260fa76))
* **types:** add SkillUsageRole and Skill.usageRoles ([ee14dcc](https://github.com/y0ngha/siglens-core/commit/ee14dcc7c4f127fe97e4f1a5ae8d8f8f8611a9b4))


### BREAKING CHANGES

* **review:** MIN_CONFIDENCE_WEIGHT and MEDIUM_CONFIDENCE_WEIGHT are removed from the public API. confidenceWeight is now a display weight (Low/Medium/High label) and no longer gates skill inclusion.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>

# [0.20.0](https://github.com/y0ngha/siglens-core/compare/v0.19.1...v0.20.0) (2026-06-05)


### Bug Fixes

* **dashboard:** skip caching empty sector-signals to prevent transient-outage poison ([10d60a6](https://github.com/y0ngha/siglens-core/commit/10d60a6587ba883feb5a72fcc08ff0a4c5956a54))
* **indicators:** apply PR [#148](https://github.com/y0ngha/siglens-core/issues/148) review — as-cast comments, param guards, test/style fixes ([0e1ad69](https://github.com/y0ngha/siglens-core/commit/0e1ad69244f6ffd3d5984a32eb991c1498964c0f)), closes [TS#7](https://github.com/TS/issues/7)
* PR [#146](https://github.com/y0ngha/siglens-core/issues/146) 리뷰 반영 — 함수형 스타일, DRY 헬퍼, 타입안전성 ([cfcec04](https://github.com/y0ngha/siglens-core/commit/cfcec0473dec00ffd40c6d4836cebc66e9788b7e))
* **review:** address PR [#145](https://github.com/y0ngha/siglens-core/issues/145) — [@internal](https://github.com/internal) tag, timeless JSDoc, fake timers, peek guards ([cbc9ef7](https://github.com/y0ngha/siglens-core/commit/cbc9ef73443740c0b46d2074f7f0f614d4c34b37))
* **review:** pin localeCompare locale to 'en' for stable cache key (PR [#145](https://github.com/y0ngha/siglens-core/issues/145)) ([751c891](https://github.com/y0ngha/siglens-core/commit/751c89150aa92bfe5f4d7138a547674535202e1e))
* **validation:** apply PR [#146](https://github.com/y0ngha/siglens-core/issues/146) approved-review suggestions ([2af7115](https://github.com/y0ngha/siglens-core/commit/2af71155c3e3fe2a07b80a50775ce885d14a7d24))
* **validation:** apply PR [#146](https://github.com/y0ngha/siglens-core/issues/146) round-2 review — dedupe forward-return collection, relocate SanityOptions ([161520c](https://github.com/y0ngha/siglens-core/commit/161520cc547919fdd3fdb0f03a8618bc415fe36f))
* **validation:** cache series.length + cover requireFmpApiKey file fallback ([384d948](https://github.com/y0ngha/siglens-core/commit/384d948b160343ee6db30984fe0ab59cb509586c)), closes [#2](https://github.com/y0ngha/siglens-core/issues/2)


### Features

* **briefing:** add read-only peekBriefingCache for SSR seed ([f6e12cc](https://github.com/y0ngha/siglens-core/commit/f6e12cc29d570f6af4142644a21be190f7ad2d7b))
* **indicators:** Phase 1 — 12 pro-indicator calculation functions ([52b73e3](https://github.com/y0ngha/siglens-core/commit/52b73e394d903578eb09b15ae1f8991d291eea9b))
* **indicators:** pro-indicators Phase 3 Part A — pipeline integration ([#150](https://github.com/y0ngha/siglens-core/issues/150)) ([c779322](https://github.com/y0ngha/siglens-core/commit/c779322e85dca50e779eec310a609cdc8e83dad0))
* pro-indicators Phase 0 — forward-edge validation harness ([86ac1e7](https://github.com/y0ngha/siglens-core/commit/86ac1e74d5b4cf0439bb570e8254e3585d96f8b2))
* **validation:** pro-indicators Phase 2 forward-edge harness + empirical report ([#149](https://github.com/y0ngha/siglens-core/issues/149)) ([9fa39b8](https://github.com/y0ngha/siglens-core/commit/9fa39b8c34bb946c81c52b3e8de356051c9dcbb3))

## [0.19.1](https://github.com/y0ngha/siglens-core/compare/v0.19.0...v0.19.1) (2026-06-03)

# [0.19.0](https://github.com/y0ngha/siglens-core/compare/v0.18.0...v0.19.0) (2026-06-01)


### Bug Fixes

* address PR2 review — public API exports, [@internal](https://github.com/internal), discriminated SkillGating, deterministic sort, undefined guards ([18125cf](https://github.com/y0ngha/siglens-core/commit/18125cf902c42c0f456962f7d8af043a3ad0f840))
* address PR2 review — snake_case frontmatter parsing, fingerprint helper, SMC id, guards ([0bd9c05](https://github.com/y0ngha/siglens-core/commit/0bd9c0557343b835391759299f7f6307b9dc16db))
* address PR2 review round 2 — hashSkillCatalog locale, PUBLIC_API.md, drop public SignalKind ([684d053](https://github.com/y0ngha/siglens-core/commit/684d053e0fad267c7fde8123e4a37a3224dcfaab))
* address PR2 review round 3 — as-cast safety comments + internal [@link](https://github.com/link) prose (swept) ([2e4120e](https://github.com/y0ngha/siglens-core/commit/2e4120eadbdd67d98c4dc6e3fabc3cc9ce238893))
* address PR2 review round 4 — declarative dedupe, as-cast (b) comments, [@internal](https://github.com/internal) consistency (swept) ([cb13c3d](https://github.com/y0ngha/siglens-core/commit/cb13c3dd39103476a90863b1ebec0b2365ff70f0))
* address PR2 review round 5 — single candle-entry computation, drop vacuous test, direct fingerprint ([1b0974c](https://github.com/y0ngha/siglens-core/commit/1b0974c73984bb1acb6a822d13ef77c3e74f9a86))
* **signals:** address PR1 review — symmetry test coverage, defensive guards, CMF doc ([733f65d](https://github.com/y0ngha/siglens-core/commit/733f65dfc9713fc11a47c6349cba7e59067c7d36))
* **signals:** mfi_oversold_bounce uses lookback cross, not 1-bar check ([44c48f0](https://github.com/y0ngha/siglens-core/commit/44c48f03669153aebd3da45ebbc4d051c2bc4902))


### Features

* **analysis:** pure selectSkills gating function ([b425c84](https://github.com/y0ngha/siglens-core/commit/b425c84a5fd92b2b26791498ad97fb8d5e522772))
* **analysis:** SMC compressed note + anti-fabrication guardrail ([4e967e4](https://github.com/y0ngha/siglens-core/commit/4e967e4ca5a85b5aac031e75d10659ccb31747d1))
* **analysis:** textbook state predicates for skill gating (TF-aware) ([797710b](https://github.com/y0ngha/siglens-core/commit/797710b835282c6682891141d37a5f71f1341664))
* **analysis:** wire selectSkills into buildAnalysisPrompt (chart only) ([f9c1d4a](https://github.com/y0ngha/siglens-core/commit/f9c1d4ab7f59a00a6ee359b052b6d304aa7127ea))
* **cache:** fold skill fingerprint into chart cache key ([133c4a3](https://github.com/y0ngha/siglens-core/commit/133c4a3a32dc7b6271ad1663ea03feb59d190ea4))
* **signals:** add 9 bearish mirror detectors ([7ca173f](https://github.com/y0ngha/siglens-core/commit/7ca173f5142905fc314f7e8745d0c26d810d4544))
* **signals:** add bearish signal kinds to Signal union ([4194884](https://github.com/y0ngha/siglens-core/commit/4194884c0ae500bf2b87961d5f5c6991f966905b))
* **signals:** add bearish threshold constants ([b0be1db](https://github.com/y0ngha/siglens-core/commit/b0be1dba859b55ac3ec34c556829d8cdc4aa816b))
* **signals:** register bearish detectors in detectSignals ([a527055](https://github.com/y0ngha/siglens-core/commit/a5270550e87c4b850a16f594729a455d0d341e3e))
* **skills:** parse gating frontmatter + dedup by name ([0d37666](https://github.com/y0ngha/siglens-core/commit/0d37666506de5d8877742375922ed0e878fc845b))
* **types:** add SkillGating + SkillSelectionContext ([e2deccd](https://github.com/y0ngha/siglens-core/commit/e2deccdd8627e303d20acd57a638663dd9362421))

# [0.18.0](https://github.com/y0ngha/siglens-core/compare/v0.17.0...v0.18.0) (2026-05-31)


### Bug Fixes

* B3 리뷰 반영 - 피봇 anchor len-2·PUBLIC_API 등재 ([df350d3](https://github.com/y0ngha/siglens-core/commit/df350d3a696e0f282a35e02c16608efe9978fc42))
* include null in nullable enum values (strength, entryRecommendation) ([8e94822](https://github.com/y0ngha/siglens-core/commit/8e948221794545ccd9855368f962985d17174c8a))
* SMC equal-level 클러스터링으로 캐시 10MB 초과 차단 ([d459c98](https://github.com/y0ngha/siglens-core/commit/d459c9807662fc6c8d98c037e846af96cfaf80d0))


### Code Refactoring

* **smc:** finalize SMCEqualLevel.type removal ([12b71ca](https://github.com/y0ngha/siglens-core/commit/12b71ca0af0c1366abf57f4df7eae6aea9c1c760))


### Features

* 브리핑 캐시키에 입력 해시 추가 ([#123](https://github.com/y0ngha/siglens-core/issues/123)) ([768c9c6](https://github.com/y0ngha/siglens-core/commit/768c9c686a0df980a19082c421e0651389eb07ad))
* 지지/저항 후보 사전계산 주입 ([#124](https://github.com/y0ngha/siglens-core/issues/124)) ([76cd366](https://github.com/y0ngha/siglens-core/commit/76cd3662a5f262b3fbf504837fbd6596969403a2))
* 챗봇·브리핑 Data Boundary 추가 ([#122](https://github.com/y0ngha/siglens-core/issues/122)) ([93712ac](https://github.com/y0ngha/siglens-core/commit/93712ac1affd697460a23733caa305074bc88722))
* 캐시키에 프롬프트 템플릿 버전 반영 ([#121](https://github.com/y0ngha/siglens-core/issues/121)) ([7157b78](https://github.com/y0ngha/siglens-core/commit/7157b7835647ac616c97acc2ae3f1f24f904e7e0))
* 캔들 패턴 trend 사전 주입 ([#120](https://github.com/y0ngha/siglens-core/issues/120)) ([0dd5a83](https://github.com/y0ngha/siglens-core/commit/0dd5a83a6c38d2b734e77723f94880b706f35931))
* 펀더멘털 프롬프트 결측치 의미 명시 ([#119](https://github.com/y0ngha/siglens-core/issues/119)) ([526173a](https://github.com/y0ngha/siglens-core/commit/526173aa1cca876fc9919aba361356d98e4eb0e6))
* 피봇·피보나치 레벨 사전계산 주입 ([72c11f8](https://github.com/y0ngha/siglens-core/commit/72c11f8610aa416b72a71d4228ef1af126f8d70f))
* add anchored VWAP helper ([18d81a9](https://github.com/y0ngha/siglens-core/commit/18d81a95dbefa3e7e222a405f7b3be187c2a448b))
* add computeMarketReference multi-horizon layer ([2082076](https://github.com/y0ngha/siglens-core/commit/20820760c942597425286bf48dad8cdeef68558b))
* add market-reference constants ([9e0551e](https://github.com/y0ngha/siglens-core/commit/9e0551e0c0e817bc771c799f3993ad496e5130cc))
* add MarketReference domain types ([7812903](https://github.com/y0ngha/siglens-core/commit/78129033601407addadc66b53ba26f62712fede6))
* add round-number reference levels ([2baa4f2](https://github.com/y0ngha/siglens-core/commit/2baa4f2cc90a13e6df609590f8687a189cf14d62))
* add standard + camarilla pivot levels ([a65cb8b](https://github.com/y0ngha/siglens-core/commit/a65cb8b88ce25f19019d51503b0a5e154b40ddb3))
* add trend-structure descriptive helpers ([9d0005f](https://github.com/y0ngha/siglens-core/commit/9d0005ffd93cfd099eec0a47a34d4dbca96d87b3))
* **briefing:** send model on dispatch and fold it into the cache key ([60308b9](https://github.com/y0ngha/siglens-core/commit/60308b9447653711ae587549f4552e3f80b2d1a1))
* collect + split indicator reference levels ([9f0a993](https://github.com/y0ngha/siglens-core/commit/9f0a993ddbfccd2ac2068fc51ce20c908b1c179a))
* **dispatch:** add analysisType + per-analysis system prompt to /analyze contract ([bfe6dba](https://github.com/y0ngha/siglens-core/commit/bfe6dbafeff06c477b7ecb8f827f68186ac133e9))
* **dispatch:** send canonical response JSON schemas for structured output ([d159f12](https://github.com/y0ngha/siglens-core/commit/d159f12196e506ff9d059dd52b5961b89dcbd469))
* **dispatch:** send deterministic seed for reproducible generation ([4548f80](https://github.com/y0ngha/siglens-core/commit/4548f80b70b97caf7f16a2a7e355fbebdc52fe4a))
* **dispatch:** structured-output schema for chart/technical analysis ([dbeb962](https://github.com/y0ngha/siglens-core/commit/dbeb962551c05e53bd286a67525bd023eb35c0bd))
* few-shot 예시·종합 출처 라벨 추가 ([#125](https://github.com/y0ngha/siglens-core/issues/125)) ([9d5e5ac](https://github.com/y0ngha/siglens-core/commit/9d5e5acdbabf6b77a38015685390a1fddea83205))
* **fundamental:** add peer PER/PSR to comparable-peers prompt rows ([28bd859](https://github.com/y0ngha/siglens-core/commit/28bd859060985f301e6822d89192b5eea21776cc))
* **prompt:** inject precomputed trendline candidates from swing points ([495345c](https://github.com/y0ngha/siglens-core/commit/495345c5840fe44e123ac0924050b3ae33883667))
* **prompt:** label horizons with timeframe-relative calendar spans ([64ddfb8](https://github.com/y0ngha/siglens-core/commit/64ddfb8c8f842b9c123a36e5eb5a6c04b5baf843))
* **prompt:** swap precomputed sections for advisory Market Reference ([468d623](https://github.com/y0ngha/siglens-core/commit/468d62398c4266799028a6facf264ded1ea8b246))
* **smc:** add recency + span to liquidity pools, drop dead type field ([a2aa430](https://github.com/y0ngha/siglens-core/commit/a2aa430e944f8926f2276b9eedfe1d9b2182287f))
* **sr:** rank support/resistance candidates by confluence + tested history ([40e0e82](https://github.com/y0ngha/siglens-core/commit/40e0e82d00d65125d56405150ddad10ab6b7bba9))
* surface anchored VWAP levels per horizon ([d4d21f4](https://github.com/y0ngha/siglens-core/commit/d4d21f41be1efaf1cfd36c0aed052dd6066a2849))


### BREAKING CHANGES

* **smc:** SMCEqualLevel.type field removed. It was redundant because
equalHighs and equalLows are already separate arrays that encode the high/low
context. Read the array an element came from instead of its former `type`.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

# [0.17.0](https://github.com/y0ngha/siglens-core/compare/v0.15.0...v0.17.0) (2026-05-29)


### Bug Fixes

* 리뷰 코멘트 반영 — 커버리지 기준 90%로 통일 ([07660a6](https://github.com/y0ngha/siglens-core/commit/07660a6e21c7a2c8e4772c23269bd765792d7c9f))
* address PR [#108](https://github.com/y0ngha/siglens-core/issues/108) review (declarative const+catch, unused-param naming, test cleanup) ([42e256f](https://github.com/y0ngha/siglens-core/commit/42e256f94c56c87cf19fb3667c69cca42c6b6fa9))
* restore consumer-used public exports SectorGroupDef + NewsTimeRange ([747adab](https://github.com/y0ngha/siglens-core/commit/747adab576d645525fe3b23f19ee7a6c73f7d362))


### Features

* add read-only peekAnalysisCache getter ([d1ab74b](https://github.com/y0ngha/siglens-core/commit/d1ab74b8c7a6a5ac05a4139943d924433ef15d1a))
* add read-only peekOverallAnalysisCache getter ([cf34bce](https://github.com/y0ngha/siglens-core/commit/cf34bcefc208056ba150a709d05fdf5c28085a63))

# [0.15.0](https://github.com/y0ngha/siglens-core/compare/v0.14.1...v0.15.0) (2026-05-28)


### Features

* expose fear-greed classifier constants in public API ([2ba8e1f](https://github.com/y0ngha/siglens-core/commit/2ba8e1f20a9d29852f37b3f723a65f76a593f1a8))

## [0.14.1](https://github.com/y0ngha/siglens-core/compare/v0.14.0...v0.14.1) (2026-05-28)


### Bug Fixes

* address PR [#104](https://github.com/y0ngha/siglens-core/issues/104) review (document DI pattern, PUBLIC_API sync, JSDoc, provider guards) ([242358f](https://github.com/y0ngha/siglens-core/commit/242358f257206eebbb8aa84c766117b5daf3f3c6))
* address PR [#104](https://github.com/y0ngha/siglens-core/issues/104) round-2 review (remove redundant provider guards, test optional-provider throw, docs/API.md sync) ([420ed47](https://github.com/y0ngha/siglens-core/commit/420ed473c6c87f68b73adf4fbf66810b9fae3c0e))
* address PR [#104](https://github.com/y0ngha/siglens-core/issues/104) round-3 review (optional-field JSDoc wording, stale Alpaca comment, guard order) ([5a45978](https://github.com/y0ngha/siglens-core/commit/5a45978172dd025b53426052cd0a279dd11929d4))
* remove remaining stale Alpaca reference in getSectorSignals JSDoc ([08b72ad](https://github.com/y0ngha/siglens-core/commit/08b72ad180fcc066853f526a1240faf6c980757f))

# [0.14.0](https://github.com/y0ngha/siglens-core/compare/v0.13.0...v0.14.0) (2026-05-28)


### Bug Fixes

* address PR [#103](https://github.com/y0ngha/siglens-core/issues/103) review comments — tier exports, move EtSessionStatus to domain/types, English docs ([38e470e](https://github.com/y0ngha/siglens-core/commit/38e470e6430d81d0e47414a7047018f0f27bb982))
* address PR [#103](https://github.com/y0ngha/siglens-core/issues/103) review round 2 feedback ([cfcdfe7](https://github.com/y0ngha/siglens-core/commit/cfcdfe7447cdb503a672f3850e000b6e368f9aae))


### Features

* public ET session API (isEtRegularSessionOpen, getEtSessionStatus, market-hour constants) ([937c385](https://github.com/y0ngha/siglens-core/commit/937c3853628cbe08475ae8230742e66b85a19387))

# [0.13.0](https://github.com/y0ngha/siglens-core/compare/v0.12.0...v0.13.0) (2026-05-28)


### Bug Fixes

* address PR [#102](https://github.com/y0ngha/siglens-core/issues/102) review — [@internal](https://github.com/internal) tags, English public JSDoc, h23 hour cycle, second-precise TTL ([e3ded7b](https://github.com/y0ngha/siglens-core/commit/e3ded7b93bc625609f188f744bf3510546db735a))
* address PR [#102](https://github.com/y0ngha/siglens-core/issues/102) round 2 — extract minute constants, remove dead guard, refine JSDoc, add Sunday test ([3fcb7d5](https://github.com/y0ngha/siglens-core/commit/3fcb7d5e065d141783bfbf9e8f99db6ebd7c5cb6))
* address PR [#102](https://github.com/y0ngha/siglens-core/issues/102) round 3 — literal MINUTES_PER_DAY, drop [@internal](https://github.com/internal) [@link](https://github.com/link) in public JSDoc ([0cd331d](https://github.com/y0ngha/siglens-core/commit/0cd331dc44a1cba84b9d53d259f8146bd00648f2))


### Features

* add computeBarsEffectiveTtl (open-boundary bars cache TTL) ([fdc37cd](https://github.com/y0ngha/siglens-core/commit/fdc37cd0061fd39a2edf7e54a36ad501fb528411))
* add DST-safe ET regular-session helpers (isEtRegularSessionOpen, secondsUntilNextEtRegularOpen) ([7294372](https://github.com/y0ngha/siglens-core/commit/7294372fce0b1aca72dad84a263ac654bc496987))
* export computeBarsEffectiveTtl from public API ([496ccc9](https://github.com/y0ngha/siglens-core/commit/496ccc9144cff944ff016d00d7afca1b8b120748))

# [0.12.0](https://github.com/y0ngha/siglens-core/compare/v0.11.4...v0.12.0) (2026-05-22)


### Bug Fixes

* **overall:** align buildChatPrompt test fixture with integratedConclusionKo rename ([3a524b3](https://github.com/y0ngha/siglens-core/commit/3a524b3ecef3e37caca5ec12983e4ac738206e5f))
* **overall:** populate OptionsChain.daysToExpiration in test fixtures ([a8f2fd9](https://github.com/y0ngha/siglens-core/commit/a8f2fd9254dde403b5a0dac402dfc2bf76a3f1d0))
* **overall:** strip options.analyzedAt from inputHash to prevent cache thrash ([4feeaa0](https://github.com/y0ngha/siglens-core/commit/4feeaa03e08f207d845c23357b34c4a991af048b))
* **overall:** update test fixtures/assertions for integratedConclusionKo rename + optionsBulletsKo ([9b73ab0](https://github.com/y0ngha/siglens-core/commit/9b73ab0b7984bb20ef197c35e67bd1f06ce4015a))


### Features

* **overall:** 4-axis prompt schema + integratedConclusionKo rename + options/stale hints ([255cfed](https://github.com/y0ngha/siglens-core/commit/255cfed9d07824405baed06f91747c84eb433db8))
* **overall:** add pickNearestExpiration helper with 0DTE avoidance ([2018e7d](https://github.com/y0ngha/siglens-core/commit/2018e7db0b8e477e74a30190104c41946d9d2176))
* **overall:** extend OverallAxis with 'options' + response/inputs type surface ([da86a58](https://github.com/y0ngha/siglens-core/commit/da86a58d4976174739c16158c4e95a05c483342d))
* **overall:** include options payload in input hash + pass to prompt ([6906d5e](https://github.com/y0ngha/siglens-core/commit/6906d5eaf72ec350a8152b81a0fa4d0bfa093f8b))
* **overall:** integrate options axis into dependency resolver (skipped/pending/error paths) ([e7ae4a7](https://github.com/y0ngha/siglens-core/commit/e7ae4a7c2b64163493502ef509abbb857dbff4f9))
* **overall:** normalize 4-axis response with integratedConclusionKo + optionsOiStale echo ([1c10937](https://github.com/y0ngha/siglens-core/commit/1c109378614d83c2218ce25093283989447f2c9b))
* **overall:** plumb force through all 4 axes to actually bypass cache ([df011ed](https://github.com/y0ngha/siglens-core/commit/df011ed348188ca9227124433500808074b7c531))

## [0.11.4](https://github.com/y0ngha/siglens-core/compare/v0.11.3...v0.11.4) (2026-05-22)


### Bug Fixes

* **ai-port:** address PR [#92](https://github.com/y0ngha/siglens-core/issues/92) round 2 review — restore deprecated Gemini type aliases ([d29fd5e](https://github.com/y0ngha/siglens-core/commit/d29fd5e872ccfb7b6878fb62c297576856b9be47)), closes [#3](https://github.com/y0ngha/siglens-core/issues/3)
* **ai-port:** address PR [#92](https://github.com/y0ngha/siglens-core/issues/92) round 3 review — replace inline dynamic type imports + accurate GeminiPart deprecation note ([030a69c](https://github.com/y0ngha/siglens-core/commit/030a69c9c2d7bbd8fc53bed99dfe21d08a1f6d7d))
* **ai-port:** address PR [#92](https://github.com/y0ngha/siglens-core/issues/92) round 4 review — restore alphabetical import order in chat/types.ts and relocate [@port](https://github.com/port) tag to CallAiProvider JSDoc ([8cc8294](https://github.com/y0ngha/siglens-core/commit/8cc8294e92a812589119940f7a92d1c6fb2143c5))
* **ports:** address PR [#98](https://github.com/y0ngha/siglens-core/issues/98) review — break circular import, sync architecture docs ([ecce88c](https://github.com/y0ngha/siglens-core/commit/ecce88c2153d1ea43e615a8b8a088491083a8026))

## [0.11.3](https://github.com/y0ngha/siglens-core/compare/v0.11.2...v0.11.3) (2026-05-22)


### Bug Fixes

* **prompt:** address PR [#90](https://github.com/y0ngha/siglens-core/issues/90) review — Snapshot Price casing, guideline consolidation, JSDoc sync ([f60b0ce](https://github.com/y0ngha/siglens-core/commit/f60b0ce441c9660a246250c97c477ee669a58b31))


### Features

* options volume/bid-ask metrics and chat context integration ([7db6e93](https://github.com/y0ngha/siglens-core/commit/7db6e93a3604ef469cefd4db8b987e7f01f6c4ce))
* **prompt:** require Korean output to use "분석 시점 가격" instead of "현재 가격" ([0edc5f4](https://github.com/y0ngha/siglens-core/commit/0edc5f47ab4bdcbb632b67e789d8012a0fa85880))


### BREAKING CHANGES

* CurrentAnalysisContext union widened with 'options' case.
Exhaustive-switch consumers must add handler for OptionsAnalysisResponse.
New Tier 4 types (StrikeVolumeAggregate, TopOiQuote) are additive and do not
affect siglens-core semver versioning (currently 0.x minor bump only).

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>

## [0.11.2](https://github.com/y0ngha/siglens-core/compare/v0.11.1...v0.11.2) (2026-05-22)


### Features

* 0D expiration slot and cache-hit recovery for options analysis ([47ec177](https://github.com/y0ngha/siglens-core/commit/47ec17726c29ab268826edc6fdabd20e1119f317))


### BREAKING CHANGES

* ExpirationSlotKey now includes '0D' as head element. EXPIRATION_SLOTS array length increased from 6 to 7. Consumers iterating EXPIRATION_SLOTS must expect one additional slot.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

## [0.11.1](https://github.com/y0ngha/siglens-core/compare/v0.11.0...v0.11.1) (2026-05-21)


### Bug Fixes

* 옵션 분석 응답의 hardcoded 날짜 수정 ([8ebb030](https://github.com/y0ngha/siglens-core/commit/8ebb030e2527675024fb935f4d42b09779b78be9))

# [0.11.0](https://github.com/y0ngha/siglens-core/compare/v0.10.1...v0.11.0) (2026-05-21)


### Bug Fixes

* **options:** apply round 13 review — JSDoc + test cleanup + barrel routing ([edde0f7](https://github.com/y0ngha/siglens-core/commit/edde0f760a01dbbaec210ddf7c4b6b2ac82a50ba))
* **options:** apply round 14 review — branch coverage + expirationSlots for-of ([fd92033](https://github.com/y0ngha/siglens-core/commit/fd92033168a165bd85e57c301d657b08818578a4))
* **options:** apply round 16 review — extract filter type + remove cancel ref + tests ([71116ac](https://github.com/y0ngha/siglens-core/commit/71116ac0cd63d62feb592cf36b486005e820bf60))
* **options:** apply round 17 review — rename calendar-day basis + name poll variants ([89afb61](https://github.com/y0ngha/siglens-core/commit/89afb61e0342eddf6525de91ce2b826d0471ae50))
* **options:** apply round 18 review — extract LOG_PREFIX + tighten types ([7d3ca94](https://github.com/y0ngha/siglens-core/commit/7d3ca94fb146574760e5fee4dd8ef6b6fd67a902))
* **options:** apply round 20 review — add browser exports + doc subdir pattern ([0be3ea3](https://github.com/y0ngha/siglens-core/commit/0be3ea347c8718851a9de2621c6218749a88616e))
* **options:** apply round 20 review — canonical imports + comment cleanup + explicit normalize return types ([480bb25](https://github.com/y0ngha/siglens-core/commit/480bb255659227e7e260deae5ec110b9f1a2eb0e))
* **options:** forward underlyingPrice to summarizeChainForLlm from prompt builder ([9784c77](https://github.com/y0ngha/siglens-core/commit/9784c77d4e3e31798261186fdc5d0a2d4bc547c2))
* **options:** reorder cache check before BYOK gate and usage limit ([e139c22](https://github.com/y0ngha/siglens-core/commit/e139c22d72fc0b1978906b489ad96271af8f9961)), closes [#86](https://github.com/y0ngha/siglens-core/issues/86)
* **options:** resolve PR [#86](https://github.com/y0ngha/siglens-core/issues/86) review round 5 — 5 Blocker + 5 Suggestion ([fd68357](https://github.com/y0ngha/siglens-core/commit/fd68357fedfd1f199fa0e2909766e187fcd97b37))
* **options:** resolve PR [#86](https://github.com/y0ngha/siglens-core/issues/86) review round 6 — 2 Blocker + 10 Suggestion ([4475449](https://github.com/y0ngha/siglens-core/commit/44754494fc9a2b37f7ad43b9bfdf834a579a5121))
* **options:** resolve PR [#86](https://github.com/y0ngha/siglens-core/issues/86) review round 7 — 6 Blocker + 2 Suggestion ([615e8ce](https://github.com/y0ngha/siglens-core/commit/615e8ce14f8ba694e8b2f683c9579771e7d6e266))
* **options:** resolve PR [#86](https://github.com/y0ngha/siglens-core/issues/86) review round 8 — 1 Blocker + 4 Suggestion ([7b4b6db](https://github.com/y0ngha/siglens-core/commit/7b4b6db4a25a0e9c869271d65e7a7ae9a439a9d1))
* **options:** resolve PR [#86](https://github.com/y0ngha/siglens-core/issues/86) round-3 review — 13 Blocker + 5 Suggestion ([67c6dab](https://github.com/y0ngha/siglens-core/commit/67c6dab8a1e1d184f6b5e0f57171a8cb786cc09e))
* **options:** resolve PR [#86](https://github.com/y0ngha/siglens-core/issues/86) round-4 review — 2 Blocker + 5 Suggestion ([eda74bb](https://github.com/y0ngha/siglens-core/commit/eda74bbd49cc1652619f4f7350d6ff44bc280009))
* **options:** tighten numeric return types + relocate prompt-options type ([40ad290](https://github.com/y0ngha/siglens-core/commit/40ad29028c4f35710ee3037c26750812f23de7ff))
* **options:** tighten sanitize filter + export prompt options type ([d3bdf62](https://github.com/y0ngha/siglens-core/commit/d3bdf620aa1cebe497ab611728547a2556a3b6b1))
* **options:** TZ-safe ET day diff + spot-anchored ATM IV (PR [#86](https://github.com/y0ngha/siglens-core/issues/86) feedback) ([31532ef](https://github.com/y0ngha/siglens-core/commit/31532efcf80fb5dd0b32218498eb10a1e227ecf9))


### Features

* add asIsoDate primitive normalization helper ([27e29d8](https://github.com/y0ngha/siglens-core/commit/27e29d81be5ffd8686bd67f89121128984ef4d2c))
* **options:** add buildOptionsAnalysisPrompt + summarizeChainForLlm ([0d59658](https://github.com/y0ngha/siglens-core/commit/0d596580c4675f0fd94a6170043bfb5c8dbab8f6))
* **options:** add cache TTL constant and cache key builder ([9b407e8](https://github.com/y0ngha/siglens-core/commit/9b407e86b132642c651931dbe33c63085bf806e1))
* **options:** add core calculation functions (max pain, P/C, implied move, OI agg, sanitize) ([fbf63a5](https://github.com/y0ngha/siglens-core/commit/fbf63a58b5e297a334e1be57bb00c08560ecd68f))
* **options:** add core domain types for options analysis ([dca3d09](https://github.com/y0ngha/siglens-core/commit/dca3d0913aead0e586086f64fa17d37b1ef79baa))
* **options:** add expiration slot mapping (1W/2W/1M/2M/3M/6M) ([feefe3f](https://github.com/y0ngha/siglens-core/commit/feefe3fc691b15e535967bbaf20ea54b12b16d24))
* **options:** add normalizeOptionsAnalysisResponse with nested field guards ([27235b4](https://github.com/y0ngha/siglens-core/commit/27235b41e50657d50995909b22cd23eb7f5bad3d))
* **options:** add pollOptionsAnalysis with write-side normalization + cache persistence ([8a8da5a](https://github.com/y0ngha/siglens-core/commit/8a8da5ab3ee2d59f50e6f978f72f3496cf870eb4))
* **options:** add submit/poll types (matches news/fundamental patterns) ([70f8b11](https://github.com/y0ngha/siglens-core/commit/70f8b11ecdf07d7d122505d6fcf7d1f334a71b47))
* **options:** add submitOptionsAnalysis use-case (matches news/fundamental cache+enqueue pattern) ([907a7b4](https://github.com/y0ngha/siglens-core/commit/907a7b470739a3d6b5c118716390a7c1143d45a5))
* **options:** export options application use-cases through public API ([fbef646](https://github.com/y0ngha/siglens-core/commit/fbef646e2f68e53cb82924e5ba66ea6fa046fd3f))
* **options:** expose options public API (types + provider interface + calc utils + normalize + prompt) ([6782ce9](https://github.com/y0ngha/siglens-core/commit/6782ce9a425676d001b157739a1b3bd94fcd9170))

## [0.10.1](https://github.com/y0ngha/siglens-core/compare/v0.9.5...v0.10.1) (2026-05-11)


### Bug Fixes

* address round-2 review (JSDoc, client export, PUBLIC_API, test rename) ([1d3ca8b](https://github.com/y0ngha/siglens-core/commit/1d3ca8b08951de1637501f8936dd759629e1140d))
* Propagate skipEnqueueIfMiss to overall sub-axis submits and address review feedback ([214cc4a](https://github.com/y0ngha/siglens-core/commit/214cc4a127d8f9ec1b4fb815fee17ea959de0b71)), closes [hi#priority](https://github.com/hi/issues/priority)


### Features

* Add skipEnqueueIfMiss option to submitAnalysis ([7eadd45](https://github.com/y0ngha/siglens-core/commit/7eadd452b54f8f40b2dd0b579bc07de4e9c39447))
* Add skipEnqueueIfMiss option to submitFundamentalAnalysis ([2d04638](https://github.com/y0ngha/siglens-core/commit/2d0463896306932b10a2b3459e254e5fcf1dc900))
* Add skipEnqueueIfMiss option to submitNewsAnalysis ([7f05a9a](https://github.com/y0ngha/siglens-core/commit/7f05a9a09cffc455913599eaf7c3783664718da1))
* Add skipEnqueueIfMiss option to submitOverallAnalysis ([3f4f841](https://github.com/y0ngha/siglens-core/commit/3f4f841a5422ee734c0dc0c517d4966df3482e49))

## [0.10.0](https://github.com/y0ngha/siglens-core/compare/v0.9.5...v0.10.0) (2026-05-11)


### Features

* add `skipEnqueueIfMiss` option to `submitAnalysis`, `submitFundamentalAnalysis`, `submitNewsAnalysis`, and `submitOverallAnalysis`. When set, a cache miss returns `{ status: 'miss_no_trigger' }` instead of enqueueing a worker job. Cache hits are unaffected. Intended for consumer-side bot/crawler gating where read-only access should not trigger AI analysis.

## [0.9.5](https://github.com/y0ngha/siglens-core/compare/v0.9.4...v0.9.5) (2026-05-11)


### Bug Fixes

* LLM 응답에서 JSON 깨질 때 오류나는 현상 수정 ([f804134](https://github.com/y0ngha/siglens-core/commit/f804134b06ffcebdd407d8d743ad3c326850711f))

## [0.9.4](https://github.com/y0ngha/siglens-core/compare/v0.9.3...v0.9.4) (2026-05-10)


### Features

* modelSpecs Downgrade ([e524269](https://github.com/y0ngha/siglens-core/commit/e5242691272ff741709fb877767f8ddf06db1461))

## [0.9.3](https://github.com/y0ngha/siglens-core/compare/v0.9.2...v0.9.3) (2026-05-08)


### Bug Fixes

* 분석 데이터 polling 진행시 symbol 체크 추가 ([b02e1b2](https://github.com/y0ngha/siglens-core/commit/b02e1b27a69e76d3ecf98ce63b1dbbb06f771407))
* address PR [#84](https://github.com/y0ngha/siglens-core/issues/84) review findings (B1-B4, S1-S2) + modelSpecs test ([e45cd75](https://github.com/y0ngha/siglens-core/commit/e45cd758bf9f60bdb1355de6698713b7a4b64c5a))
* **domain:** document isPremiumModel intent + expand tests + update PUBLIC_API ([07471b7](https://github.com/y0ngha/siglens-core/commit/07471b797c932d44fba1087cc73f386b2def7b52))
* **market:** extract message constant + enrich error type + decouple tests from TIER_CONFIG ([c009262](https://github.com/y0ngha/siglens-core/commit/c0092626e983dd06c00f9cdde84f1207ca1608dd))
* round 2 review (B1 status unification, B2 client export, B3 axis key_error, S2 dead code) ([608405f](https://github.com/y0ngha/siglens-core/commit/608405f2d31237612ef4f08df6edcf0a9b671b82))
* round 3 review (B1 message constant, B2 axis re-surface, S1-S3 cleanup) ([507e992](https://github.com/y0ngha/siglens-core/commit/507e99214a1db559a5abfad5b036a8dff49037c8))
* round 4 review (B1 [@internal](https://github.com/internal), B2 requiresByokKey helper, B3+S1+S2) ([ceb1f4d](https://github.com/y0ngha/siglens-core/commit/ceb1f4d9333150aa82ac109ff3380828e436f039))
* round 5 review (B1 gate order, B2 ApiKeyRequiredError extraction, S1-S3) ([1810d02](https://github.com/y0ngha/siglens-core/commit/1810d02564b971b8629f27e1e29cee0d27bf560e))
* round 6 review (B1 BYOK error factory, B2 typed union for axis errors, S1) ([16bd811](https://github.com/y0ngha/siglens-core/commit/16bd8119f47d6fb71594920bb5af294e2bc85e98))
* round 7 review (B1-B3 JSDoc updates, S1-S3 test + fallback) ([b87a37d](https://github.com/y0ngha/siglens-core/commit/b87a37dd4cea57ebe75bc7bf0b2ed41df6030b7d))
* round 8 review (B1 helper extraction, S1 test dedup, S2 task ID comments) ([43c33b6](https://github.com/y0ngha/siglens-core/commit/43c33b664c56b4a54e0eba844726af100271acfd))


### Features

* **domain:** add isFreeModel as positive complement of isPremiumModel ([3cbcaab](https://github.com/y0ngha/siglens-core/commit/3cbcaab4add5f635409d9fa78938fd933aa52c4c))
* **domain:** add isPremiumModel pure function ([1bac9ac](https://github.com/y0ngha/siglens-core/commit/1bac9ac87988f44bd41a55db3ad71508726af2ed))
* **fundamental:** userApiKey + BYOK gate + tier forwarding ([d3e1a91](https://github.com/y0ngha/siglens-core/commit/d3e1a91143b4c5b6f8ddc8aedda297295f7e7b7d))
* **market:** BYOK gate + tier forwarding to worker ([00813a8](https://github.com/y0ngha/siglens-core/commit/00813a8fd2c40090354b8874d4ecd72b9b561511))
* **news:** userApiKey + BYOK gate + tier forwarding ([bedd4e4](https://github.com/y0ngha/siglens-core/commit/bedd4e46a77b517f7bb0e711d38b8524b58cae1a))
* **overall:** top-level userApiKey + axis propagation + BYOK gate + tier forwarding ([287b208](https://github.com/y0ngha/siglens-core/commit/287b208c19c3cad5c92ed024829ff53cc9e08ba7))

## [0.9.2](https://github.com/y0ngha/siglens-core/compare/v0.9.1...v0.9.2) (2026-05-08)


### Reverts

* Revert "Merge pull request #82 from y0ngha/feat/81/job-dedup-and-cancel-refcount" ([04be8ee](https://github.com/y0ngha/siglens-core/commit/04be8ee435a1b487516fa5616d7cc198cb7518b1)), closes [#82](https://github.com/y0ngha/siglens-core/issues/82)

## [0.9.1](https://github.com/y0ngha/siglens-core/compare/v0.8.0...v0.9.1) (2026-05-08)


### Bug Fixes

* PR [#82](https://github.com/y0ngha/siglens-core/issues/82) 리뷰 코멘트 반영 (B-1 ~ B-5, S-1 ~ S-5) ([b4d1aa5](https://github.com/y0ngha/siglens-core/commit/b4d1aa592685397b7e4844424cd0bb9a7be6019a))
* PR [#82](https://github.com/y0ngha/siglens-core/issues/82) 추가 리뷰 반영 (B-1 docs/API.md 동기화, S-1 submitBriefing dedup) ([5230d19](https://github.com/y0ngha/siglens-core/commit/5230d19a9c67e861eadaa1a580f3501766b54371))
* PR [#82](https://github.com/y0ngha/siglens-core/issues/82) 추가 리뷰 반영 (B-1 InFlightClaim → types.ts, B-2 briefing inflight 누수, S-1/S-2/S-3) ([88a860b](https://github.com/y0ngha/siglens-core/commit/88a860bb71723f855b167a4f4582bffd53c245dc))
* PR [#82](https://github.com/y0ngha/siglens-core/issues/82) 추가 리뷰 반영 (B-1 semver bump, B-2 cacheKey JSDoc, B-3/B-4 분기 테스트, S-1 cleanup 주석) ([a442a28](https://github.com/y0ngha/siglens-core/commit/a442a285af6d13efc99b874c3ac2941aa57d5f65))
* PR [#82](https://github.com/y0ngha/siglens-core/issues/82) 추가 리뷰 반영 (B-1 setNx null 분기 테스트, S-1 const 추출, S-2 process.env 복원) ([1675547](https://github.com/y0ngha/siglens-core/commit/1675547ccf85150d1e22c61add0b8f78996ef218))
* PR [#82](https://github.com/y0ngha/siglens-core/issues/82) retry 소진 후 fall-through claim에서 refcount 초기화 누락 수정 ([e533598](https://github.com/y0ngha/siglens-core/commit/e5335983d3a5a3dd9833d4de0ef4afe92572b6ca))
* restore [@internal](https://github.com/internal), extract fetchProviderData(), add overallConclusionKo guard ([82de1bb](https://github.com/y0ngha/siglens-core/commit/82de1bb821a307e00ab096c6ba65593294c14f4f)), closes [#12](https://github.com/y0ngha/siglens-core/issues/12)
* skillsDegraded type narrowing and error message clarity ([eb66e4c](https://github.com/y0ngha/siglens-core/commit/eb66e4c7617d9a6ee8c495b28a011bb716d63a3a))


### Features

* Job 중복 제거 및 Cancel 구독자 카운팅 (refcount) ([4b3f51d](https://github.com/y0ngha/siglens-core/commit/4b3f51df53fca7023d055633ea9c9dc3af22546f))

# [0.9.0](https://github.com/y0ngha/siglens-core/compare/v0.8.0...v0.9.0) (2026-05-08)


### Features

* job dedup via `claimOrJoinInFlightJob` (Redis SETNX on `job:inflight:{cacheKey}`) and subscriber refcount cancel via `releaseInFlightJob` so concurrent submitters share a single worker job and only the last cancel propagates to `/cancel`. Wired into all four analysis submit paths (technical / fundamental / news / overall) and `submitBriefing`.


### BREAKING CHANGES

* `JobMeta.symbol` is now optional (`symbol?: string`) so briefing jobs — which are not symbol-bound — can register `cacheKey` for inflight-slot cleanup. Consumers reading `meta.symbol` as a non-null `string` must add a guard or fallback.

# [0.8.0](https://github.com/y0ngha/siglens-core/compare/v0.7.11...v0.8.0) (2026-05-07)


### Bug Fixes

* **fearGreed:** address composition review findings ([584ced4](https://github.com/y0ngha/siglens-core/commit/584ced4c8a2772809cd03aea7a87dd0398739f52))
* **fearGreed:** address factors review findings ([a99aa04](https://github.com/y0ngha/siglens-core/commit/a99aa046ebffe7aaaa2eba6db88ea81ef5cddafa))
* **fearGreed:** address percentile review findings ([2090654](https://github.com/y0ngha/siglens-core/commit/2090654929f0f6121af1d8ae2e6abd92f66a9965))
* **fearGreed:** address PR [#78](https://github.com/y0ngha/siglens-core/issues/78) review findings (14 items) ([1d1d3ca](https://github.com/y0ngha/siglens-core/commit/1d1d3caae2559f51fc2f9a279932eb5a6a95ef83))
* **fearGreed:** address PR [#78](https://github.com/y0ngha/siglens-core/issues/78) round 2 review (4 blockers + 2 suggestions) ([56d6f03](https://github.com/y0ngha/siglens-core/commit/56d6f03045bd7d1fa6b2df4aa5c292d5adfeea04))
* **fearGreed:** address PR [#78](https://github.com/y0ngha/siglens-core/issues/78) round 3 review (4 blockers) ([faf52a6](https://github.com/y0ngha/siglens-core/commit/faf52a6e861f226d178919339b41d2612902d23b))
* **fearGreed:** address types review findings ([20319ac](https://github.com/y0ngha/siglens-core/commit/20319ac3673f3f7cc4b8a934628779c4ce7a759e))
* **fearGreed:** address walkForward review findings ([a6b90ed](https://github.com/y0ngha/siglens-core/commit/a6b90ed7679194515f9203ca191dc18d2929d4a1))
* **fearGreed:** address wiring review findings (test coverage + English comments) ([187296a](https://github.com/y0ngha/siglens-core/commit/187296af0271c151ef8b39f2d59c25577dff6761))
* **fearGreed:** annotate findIndex callback to satisfy noImplicitAny ([6c54e91](https://github.com/y0ngha/siglens-core/commit/6c54e9114509039403d1cb87f97c33b7c8ea499c))
* **fearGreed:** merge into indicators barrel + revision history + [@returns](https://github.com/returns) types ([66d6640](https://github.com/y0ngha/siglens-core/commit/66d6640c0cf590a1d4f8a7080d098166ecb7ce61))
* **fearGreed:** restore spec impl and use 250-bar fixtures ([606d831](https://github.com/y0ngha/siglens-core/commit/606d831877afc9c22d390b3439ad5099587e2431))
* **fearGreed:** tag module-internal factors exports with [@internal](https://github.com/internal) ([c7a6ba3](https://github.com/y0ngha/siglens-core/commit/c7a6ba3a7a686fff7fc547ae285579d43b6824b8))
* **fearGreed:** use spec-verbatim warning strings ([d6f3f12](https://github.com/y0ngha/siglens-core/commit/d6f3f124fb9dfb5de1f9c3451b9819d2471276ed))
* PR [#77](https://github.com/y0ngha/siglens-core/issues/77) 라운드 2 리뷰 코멘트 반영 (semver bump, branch coverage, isFallbackAnalysis 도메인 이동 등) ([c4d68c0](https://github.com/y0ngha/siglens-core/commit/c4d68c0c6551f19e631c424697331653b9c51743))
* PR [#77](https://github.com/y0ngha/siglens-core/issues/77) 라운드 3 리뷰 코멘트 반영 (isFallbackAnalysis 단위 테스트, WHAT 주석 제거) ([b29b811](https://github.com/y0ngha/siglens-core/commit/b29b811561a366eae73948ca99a86b032b90f6f6))
* PR [#77](https://github.com/y0ngha/siglens-core/issues/77) 라운드 4 리뷰 코멘트 반영 (빈 응답 분기 테스트, 상수 추출, JSDoc 개선) ([3e953d3](https://github.com/y0ngha/siglens-core/commit/3e953d3030a4d0560302c59a0540ccb4c0a0bb9b))
* PR [#77](https://github.com/y0ngha/siglens-core/issues/77) 라운드 5 리뷰 코멘트 반영 (import 블록 병합, JSDoc 정확도 개선, timer leak 방지) ([b6e6430](https://github.com/y0ngha/siglens-core/commit/b6e64302d647b13c43d845f535882542063ed291))
* PR [#77](https://github.com/y0ngha/siglens-core/issues/77) 라운드 6 Suggestion 적용 (B-5 describe 이름 정규화, timer afterEach 이동) ([8cc2b22](https://github.com/y0ngha/siglens-core/commit/8cc2b22ada4daf319911d5602a8ccc35d67ddf9c))
* PR [#77](https://github.com/y0ngha/siglens-core/issues/77) 리뷰 코멘트 반영 (Tier 2 JSDoc, BYOK widening CHANGELOG, PUBLIC_API 동기화 외) ([be937ec](https://github.com/y0ngha/siglens-core/commit/be937ecc8460f261fa3c4e43f06a35cb4b471bbc))
* PR [#79](https://github.com/y0ngha/siglens-core/issues/79) review 반영 — 0.8.0 bump, deprecated alias, docs 정리 ([3f7ad2b](https://github.com/y0ngha/siglens-core/commit/3f7ad2b30e2923fe0a83070f7014f406d6a56ddd))
* PR [#79](https://github.com/y0ngha/siglens-core/issues/79) round 2 — NEWS_CARD_MODEL_ID export, JSDoc 소비자 중립화 ([1002db0](https://github.com/y0ngha/siglens-core/commit/1002db0e8f87db036f95abecd519fec958a35046))
* PR [#79](https://github.com/y0ngha/siglens-core/issues/79) round 3 — dead mock 제거, fetch 실패 경로 테스트 추가 ([6e9aa62](https://github.com/y0ngha/siglens-core/commit/6e9aa6233fe511c199256938671bf7214fdb3afd))


### Features

* 뉴스 분석시 thinkingBudget 을 옵션으로 받을 수 있도록 처리 ([890e007](https://github.com/y0ngha/siglens-core/commit/890e0078a681fd4dc46597467ce9f0893384fbdc))
* AI Effort 조절 및 타입 변경 ([977be14](https://github.com/y0ngha/siglens-core/commit/977be14e3836058e6746480f288dc36babd3b254))
* **fearGreed:** add 5-factor raw computation ([a87a471](https://github.com/y0ngha/siglens-core/commit/a87a471e47cfc401eecf0ddf20db8eba562ca737))
* **fearGreed:** add barrel and re-export types from domain/types ([f9bef99](https://github.com/y0ngha/siglens-core/commit/f9bef9911d400ef7843357c096095a4e81152cac))
* **fearGreed:** add composition (groups, score, label, warning) ([c475f27](https://github.com/y0ngha/siglens-core/commit/c475f273cf28f401b8cecdf9c6d094fe493825cd))
* **fearGreed:** add domain types ([f6eff8a](https://github.com/y0ngha/siglens-core/commit/f6eff8a8dd1255afa32d8fb08b93651215b749bd))
* **fearGreed:** add percentile utility ([62bdc1d](https://github.com/y0ngha/siglens-core/commit/62bdc1de7f60a7740c6099e1322b783a5b934f7b))
* **fearGreed:** add walk-forward snapshot and history ([5393447](https://github.com/y0ngha/siglens-core/commit/5393447566d1fd2f349343b4944a6c6341e1cf0d))
* **fearGreed:** export computeFearGreedIndex/History as Tier 1 ([68a76c1](https://github.com/y0ngha/siglens-core/commit/68a76c1ce27e15f5baa87f1d2a07c699d5709ad7))
* **fearGreed:** inject fearGreed context into buildAnalysisPrompt ([15b18b2](https://github.com/y0ngha/siglens-core/commit/15b18b223634a5825067fef7f879c76224fb22f9))
* **fearGreed:** inject fearGreed into overall analysis + DRY shared helper ([db8b645](https://github.com/y0ngha/siglens-core/commit/db8b6450349279aa1423085e952a813d2a51bb88))
* **fearGreed:** wire fearGreed snapshot into submitAnalysis ([37a599e](https://github.com/y0ngha/siglens-core/commit/37a599e20205133cbdde266fb998b01cf66643d4))


### Performance Improvements

* 프롬프트 개선 ([38aaf5b](https://github.com/y0ngha/siglens-core/commit/38aaf5b2b535dc227619d09cf53e74ca02a2f530))

## [0.7.11](https://github.com/y0ngha/siglens-core/compare/v0.7.10...v0.7.11) (2026-05-06)


### BREAKING CHANGES

* **Model removed — `claude-haiku-3-5`:** the model identifier `claude-haiku-3-5` has been removed from `ActiveModelId` and `MODEL_SPECS`. Consumers must migrate to `claude-haiku-4-5` (wire identifier `claude-haiku-4-5-20251001`).
* **`claude-haiku-4-5` limits:** `maxOutputTokens` is 64 000; no thinking budget; `temperature` is still supported.
* **`ModelSpec.topP` removed:** the `topP` field no longer exists on any `ModelSpec` entry. Sampling-based models (Gemini, Haiku) now expose only `temperature`.
* **`ModelSpec` effort field:** reasoning variants (Claude Sonnet/Opus 4.x and ChatGPT models) now expose `effort: EffortLevel` (`'low' | 'medium' | 'high'`) in place of the former `thinkingBudget` / `temperature` fields.
* **New `EffortLevel` type:** exported from `@y0ngha/siglens-core`. Consumers building provider request payloads should import and use this type.
* **`apiModelId` added to every `ModelSpec`:** the field holds the exact model string required by the provider SDK. SDK callers must use `spec.apiModelId` (not the `ActiveModelId` map key) when constructing the provider request payload.
* **`MODEL_SPECS` shape changed:** any code that spreads or iterates `ModelSpec` values will need to handle the new `apiModelId` field and the absence of `topP`.
* **`CallAiProviderOptions.serverApiKey` is now `string | undefined`:** previously typed as `string`, this field is now `string | undefined`. Consumer implementations of `callAiProvider` must handle `undefined` — exactly one of `userApiKey` / `serverApiKey` is defined per call (enforced by the application layer). Update your implementation to check which key is present before using it.


### Features

* 프롬프트 개선 및 여러가지 수정... ([21d5fba](https://github.com/y0ngha/siglens-core/commit/21d5fbac87a632fff0d51ce1569d7f5e0d0dd3fd))

## [0.7.10](https://github.com/y0ngha/siglens-core/compare/v0.7.9...v0.7.10) (2026-05-05)


### Features

* AI 뉴스 기능 개발 ([70510f5](https://github.com/y0ngha/siglens-core/commit/70510f50dc83238a73657e5526cbdfa15a3db832))
* top_p 제거 ([e73e456](https://github.com/y0ngha/siglens-core/commit/e73e456f153859474ecb86d2cbc2e3e7b47e53c4))

## [0.7.9](https://github.com/y0ngha/siglens-core/compare/v0.7.8...v0.7.9) (2026-05-05)


### Features

* claude 3.5 삭제 후 4.5로 변경 ([75a72e3](https://github.com/y0ngha/siglens-core/commit/75a72e3984781b38303119c338f962c763da1d3f))

## [0.7.8](https://github.com/y0ngha/siglens-core/compare/v0.7.7...v0.7.8) (2026-05-05)


### Bug Fixes

* apiKeys 오류 수정 및 로그 추가 ([2509c98](https://github.com/y0ngha/siglens-core/commit/2509c98c05a45d6a97c79b4d4c92431677317f34))

## [0.7.7](https://github.com/y0ngha/siglens-core/compare/v0.7.6...v0.7.7) (2026-05-05)

## [0.7.6](https://github.com/y0ngha/siglens-core/compare/v0.7.5...v0.7.6) (2026-05-05)


### Features

* modelSpecs에 apiModelId 추가 ([eaad7be](https://github.com/y0ngha/siglens-core/commit/eaad7beb1a5889cdb3020a57fbd32a012d29d00f))

## [0.7.5](https://github.com/y0ngha/siglens-core/compare/v0.7.4...v0.7.5) (2026-05-05)

## [0.7.4](https://github.com/y0ngha/siglens-core/compare/v0.7.3...v0.7.4) (2026-05-05)


### Bug Fixes

* api key 가져올 때 버그 수정 ([27471f7](https://github.com/y0ngha/siglens-core/commit/27471f7d74a82cc651c7aa930dd26ab20762bae4))

## [0.7.3](https://github.com/y0ngha/siglens-core/compare/v0.7.2...v0.7.3) (2026-05-03)


### Bug Fixes

* **cache,prompt:** cache stability + interface cleanup + prompt completeness ([025c9fc](https://github.com/y0ngha/siglens-core/commit/025c9fc30de0a8363429470d3ba61eb983941db3)), closes [#11](https://github.com/y0ngha/siglens-core/issues/11)
* **chat:** wire currentAnalysisContext + tighten non-pro key routing guard ([094b6ea](https://github.com/y0ngha/siglens-core/commit/094b6ea8c2479adeae061d608349208978a15190)), closes [#5](https://github.com/y0ngha/siglens-core/issues/5) [#4](https://github.com/y0ngha/siglens-core/issues/4)
* **docs,domain:** contract alignment + dead-text cleanup + safer provider mapping ([0e6096f](https://github.com/y0ngha/siglens-core/commit/0e6096f16127a39f89acca260a7e34a5e5a736ed)), closes [#15](https://github.com/y0ngha/siglens-core/issues/15) [#9](https://github.com/y0ngha/siglens-core/issues/9) [#10](https://github.com/y0ngha/siglens-core/issues/10) [#14](https://github.com/y0ngha/siglens-core/issues/14) [#12](https://github.com/y0ngha/siglens-core/issues/12)
* **overall:** cache key stability + dependency meta alignment ([2e08a08](https://github.com/y0ngha/siglens-core/commit/2e08a0822d6b3618da8a7a9b70f303af16391f75)), closes [#1](https://github.com/y0ngha/siglens-core/issues/1) [#8](https://github.com/y0ngha/siglens-core/issues/8) [#16](https://github.com/y0ngha/siglens-core/issues/16)
* PR [#76](https://github.com/y0ngha/siglens-core/issues/76) review feedback (4 blockers + 2 suggestions + 1 inline) ([a9b0d46](https://github.com/y0ngha/siglens-core/commit/a9b0d46687b325872451d45fbf2e9ddc78c7c9eb)), closes [#75](https://github.com/y0ngha/siglens-core/issues/75)
* PR [#76](https://github.com/y0ngha/siglens-core/issues/76) round 2 review (3 blockers + 2 suggestions) ([199532f](https://github.com/y0ngha/siglens-core/commit/199532f027b317dd4cb05d3b98ce97206fda7099))
* **usage:** unify analysis usage tracking + prevent overall triple-counting ([3970e35](https://github.com/y0ngha/siglens-core/commit/3970e3517bdc2bea608621618df0fc822d97d04e)), closes [2/#3](https://github.com/y0ngha/siglens-core/issues/3) [#2](https://github.com/y0ngha/siglens-core/issues/2) [#3](https://github.com/y0ngha/siglens-core/issues/3)


### Features

* **client:** expose new fundamental/news/overall types + pure functions ([60bf52d](https://github.com/y0ngha/siglens-core/commit/60bf52d764d316fcf3d31687c181cb3213cbde4b)), closes [#7](https://github.com/y0ngha/siglens-core/issues/7)

## [0.7.2](https://github.com/y0ngha/siglens-core/compare/v0.7.1...v0.7.2) (2026-05-03)


### Bug Fixes

* 사용되지 않는 import / 변수 제거 ([91e5bc6](https://github.com/y0ngha/siglens-core/commit/91e5bc6d6f2bd72247b6210e9950f75c711093a0))
* 사용되지 않는 test import 제거 ([272185c](https://github.com/y0ngha/siglens-core/commit/272185c6eb464c11449a00ce71e76e46bd6dd4f6))
* countSkillFiles에 fundamental/news 카테고리 추가 + 테스트 ([659eb0c](https://github.com/y0ngha/siglens-core/commit/659eb0c2edb43f60d3163fc7ab0ffe87279da1be))
* PR [#75](https://github.com/y0ngha/siglens-core/issues/75) 인라인 1-5 반영 (userApiKey 전달, 의존성 error 처리, 단위 변환, FileSkillsLoader 캐싱, JSON fence 유연 매칭) ([afa3d86](https://github.com/y0ngha/siglens-core/commit/afa3d86ae2f23e7908c9d632cd3fabefb84b2456))
* PR [#75](https://github.com/y0ngha/siglens-core/issues/75) R2 B-3 — loadSkillsCached console.error + 테스트 ([1aaadc0](https://github.com/y0ngha/siglens-core/commit/1aaadc024ee8f59ec110c286fe712eb665943374))
* SectorHistoricalPoint public export 누락 + PUBLIC_API.md 내부 인벤토리 동기화 ([9f9ffbc](https://github.com/y0ngha/siglens-core/commit/9f9ffbc065e7df86dd8660bdd7c14f8b3106f70b))
* submitNewsAnalysis 사용되지 않는 import 제거 ([6bb9a9d](https://github.com/y0ngha/siglens-core/commit/6bb9a9d86f57d59d62f5b404f6888800a580ca80))
* submitNewsCardAnalysis 사용되지 않는 import 제거 ([690ca84](https://github.com/y0ngha/siglens-core/commit/690ca8421f82b27cdb3df78d27cbe1c1d9a4b011))


### Features

* 새 분석 3종 응답 정규화 함수 추가 ([7819955](https://github.com/y0ngha/siglens-core/commit/7819955f39c593119b7b75c94bf8e12f5177a76c))
* 새 분석 4종 캐시 키 빌더 + TTL 상수 추가 ([dadd9c9](https://github.com/y0ngha/siglens-core/commit/dadd9c99fe4ff3d9163e84a0d77e99e71bc64907))
* 새 분석 use-case + 타입 + Provider 인터페이스 public export ([ad810c7](https://github.com/y0ngha/siglens-core/commit/ad810c7198d191165268612c401dc1143b70a9e6))
* 펀더/뉴스/종합 분석 도메인 타입 추가 ([14dde38](https://github.com/y0ngha/siglens-core/commit/14dde386b28aa33a038216eb7a190401a97d56b5))
* buildChatPrompt에 currentAnalysisContext 파라미터 추가 ([e1a5722](https://github.com/y0ngha/siglens-core/commit/e1a5722b2ec940e1e3ce4303ee5d38a9a245f6ae))
* buildFundamentalAnalysisPrompt 추가 ([1caf6db](https://github.com/y0ngha/siglens-core/commit/1caf6dbc1b53b6fd145109138dbb2f8504cc58da))
* buildNewsAnalysisPrompt 추가 ([84a9fcd](https://github.com/y0ngha/siglens-core/commit/84a9fcd640f379b0a29f513b6c342130cd9ab067))
* buildNewsCardAnalysisPrompt 추가 (flash-lite 묶음 호출용) ([9fd9930](https://github.com/y0ngha/siglens-core/commit/9fd9930e75683051567d1958aaca94ff23244c9a))
* buildOverallAnalysisPrompt 추가 (3축 통합 + 타임프레임 맥락) ([ff94e87](https://github.com/y0ngha/siglens-core/commit/ff94e87a8feffc2d0a1df2b4948b2ae57f1c10df))
* Fundamental analysis use-case (submit/poll/cancel) ([03d6533](https://github.com/y0ngha/siglens-core/commit/03d6533e915041f65fbdff4c29920e3c56dd186a))
* FundamentalDataProvider 인터페이스 + snapshot 정규화 함수 ([f072297](https://github.com/y0ngha/siglens-core/commit/f0722979bc6190eca80be5df20b33ade0a12e35a))
* News analysis use-case (submit/poll/cancel) ([79899de](https://github.com/y0ngha/siglens-core/commit/79899def35940cf79b88a5eb64f194569125f585))
* News card 분석 use-case (flash-lite 묶음 호출, 영구 캐시) ([c42af29](https://github.com/y0ngha/siglens-core/commit/c42af29cb77a77ec6f3bd5f4e049380abd1db379))
* NewsProvider 인터페이스 정의 ([a2f5d59](https://github.com/y0ngha/siglens-core/commit/a2f5d59d0fbf0ba38f192e244648a8c64be202b7))
* Overall 의존성 resolver (캐시 룩업 + miss 백그라운드 트리거) ([27f3567](https://github.com/y0ngha/siglens-core/commit/27f35671a51f39321cb4e486ad88b5017b267a6f))
* Overall analysis use-case (의존성 자동 처리 + submit/poll/cancel) ([5338e15](https://github.com/y0ngha/siglens-core/commit/5338e152e60de8495137309c80802fedcd5dff19))
* PR [#75](https://github.com/y0ngha/siglens-core/issues/75) R3 B-6 — skillsDegraded를 loadSkillsCached + JobMeta로 노출 ([a26f7d2](https://github.com/y0ngha/siglens-core/commit/a26f7d22f5d159c82cc6edba554504b170bc0d94))
* Skills loader fundamental/news 카테고리 지원 ([3d28ecc](https://github.com/y0ngha/siglens-core/commit/3d28eccbe674cf6b6451caa2d2bd6a01d20bb001))

## [0.7.1](https://github.com/y0ngha/siglens-core/compare/v0.7.0...v0.7.1) (2026-05-02)


### Bug Fixes

* PR [#74](https://github.com/y0ngha/siglens-core/issues/74) — move LlmProvider to domain/types, clarify key routing JSDoc, improve test coverage ([dd15a5c](https://github.com/y0ngha/siglens-core/commit/dd15a5cca34ba1ee59866d952fe2f0d89940f380))
* PR [#74](https://github.com/y0ngha/siglens-core/issues/74) 리뷰 반영 - 중복 import 병합, isPremium 상수 추출, constants 파일 이름 변경 ([385b83c](https://github.com/y0ngha/siglens-core/commit/385b83cc14d648e274af442bac00dce8e358ea01))
* PR [#74](https://github.com/y0ngha/siglens-core/issues/74) 리뷰 반영 - JSDoc 명확화, 타이어 분류 정정, 모델 상수 적용 ([c93b675](https://github.com/y0ngha/siglens-core/commit/c93b67557f3fb5b70522ccbb2ae12869440ccf74))
* Remove circular import and improve provider constants exhaustiveness ([77eb329](https://github.com/y0ngha/siglens-core/commit/77eb329ea824945b46d34b75866f50bed87da83c))


### Features

* add user_api_key_required error code, pro tier key routing, and getProviderForModel ([e415631](https://github.com/y0ngha/siglens-core/commit/e4156316cab2eeea6dd4f21923f4203f899a4300))
* submitAnalysis worker에 model 및 X-AI-API-KEY 지원 ([cda6c0c](https://github.com/y0ngha/siglens-core/commit/cda6c0c6b9bb6e498a770bc7992f133e1d52e886))

# [0.7.0](https://github.com/y0ngha/siglens-core/compare/v0.4.0...v0.7.0) (2026-05-02)


### Bug Fixes

* PR [#70](https://github.com/y0ngha/siglens-core/issues/70) review comments ([cfa7774](https://github.com/y0ngha/siglens-core/commit/cfa7774100ec1cc633b5d931e449790ee07732b8))
* PR [#70](https://github.com/y0ngha/siglens-core/issues/70) round 2 — Tier 4 JSDoc + API.md sync ([3c4b6bd](https://github.com/y0ngha/siglens-core/commit/3c4b6bd1ee1cba07a854c86d18621b2090797572))
* PR [#71](https://github.com/y0ngha/siglens-core/issues/71) review — narrowing predicates + types relocation + JSDoc ([8ca59e4](https://github.com/y0ngha/siglens-core/commit/8ca59e4c69999c6445d97c1535ed4fd6379083cb)), closes [#1](https://github.com/y0ngha/siglens-core/issues/1)
* PR [#71](https://github.com/y0ngha/siglens-core/issues/71) round 3 — merge export blocks + extract constants + comment ([deb682a](https://github.com/y0ngha/siglens-core/commit/deb682a589d180b31e6185583483ab5f8544c8b7)), closes [#5](https://github.com/y0ngha/siglens-core/issues/5)


### Features

* add MODEL_SPECS as single source of truth for AI model parameters ([af004d0](https://github.com/y0ngha/siglens-core/commit/af004d0a3b85e6f25f5679a84a638f65d2f33cb1))

## [0.6.0] - 2026-05-02

### Features

* **모델 스펙 단일 source of truth** — `domain/analysis/modelSpecs.ts` 신설. `siglens-worker`가 SDK 호출에 사용하던 per-model 파라미터(`CLAUDE_MODEL_MAX_TOKENS`, `CLAUDE_MODEL_THINKING_BUDGET`, `GEMINI_MODEL_MAX_TOKENS`, `GEMINI_MODEL_THINKING_BUDGET`, `CHATGPT_MODEL_MAX_TOKENS`, `temperature: 0`, `topP: 0.95`)와 `thinking-budget` 유틸을 core로 이전.
* 신규 export — Tier 4: `MODEL_SPECS`, `THINKING_BUDGET_FALLBACK_STEPS`, `DISABLED_THINKING_BUDGET`, `ModelSpec`, `AIProvider`, `ActiveModelId`, `ClaudeModelId`, `GeminiModelId`, `ChatGPTModelId`. `ModelSpec` / `AIProvider` / `ActiveModelId`는 `domain/types.ts`에 보관 (공용 도메인 타입 컨벤션).
* 신규 export — Tier 2 헬퍼: `getProvider`, `isClaudeModel`, `isGeminiModel`, `isChatGPTModel`, `getThinkingBudgetSequence`. `is*Model` 3개는 TypeScript 타입 predicate로, 호출부에서 `ActiveModelId`를 provider별 subset(`ClaudeModelId` 등)으로 narrowing할 수 있다.
* `ActiveModelId = Exclude<TierModel, 'claude-sonnet-4' | 'claude-opus-4'>` — `TierModel`에 backward-compat로 남은 deprecated 식별자를 제외한 active set. `MODEL_SPECS`는 `Record<ActiveModelId, ModelSpec>`로 정의되어 새 모델 누락 시 컴파일러가 알려준다.

이번 릴리스는 additive 변경 — 기존 export는 영향 없음. AI SDK 호출자(워커, 서버 액션, UI)는 다음 publish에서 자체 하드코딩을 제거하고 core의 `MODEL_SPECS`를 참조하도록 전환된다.

## [0.5.0](https://github.com/y0ngha/siglens-core/compare/v0.4.0...v0.5.0) (2026-05-02)

### BREAKING CHANGES

* `requestChatCompletion(params, dependencies)`의 `dependencies` 인자가 더 이상 optional이 아니며, `callAiProvider`가 필수 필드로 승격됨. 이전에 `@deprecated`로 유지되던 `callGemini` 및 `getCurrentDate` 필드는 제거됨.
* Deprecated 타입 별칭 제거: `GeminiContents` (→ `AiContents`), `CallGeminiWithKeyFallbackOptions` (→ `CallAiProviderOptions`).
* `OAuthProvider`, `LlmProvider` 도메인 union 타입 제거 (in-core consumer 부재).
* `src/index.ts`에서 약 140개의 export 제거 — auth use-case, OAuth helper, email dispatcher/template, contact, BYOK, Tier CRUD, ticker, Drizzle/Neon DB infra, Gemini SDK 어댑터 전부 consumer 애플리케이션으로 ejection.
* `peerDependencies`에서 `@neondatabase/serverless`, `drizzle-orm`, `@google/genai` 제거. `@upstash/redis`만 유지됨.

### Phases

* Phase 0 — `docs/SCOPE.md` 재작성 + Phase 0~7 ejection 로드맵, `hashUsageIp`을 `infrastructure/usage/hash.ts`로 추출, ticker cache key 분리.
* Phase 1 — Inquiry application, OAuth helpers, EmailTokenStore/EmailDispatcher, `infrastructure/db/inquiryRepository.ts` ejection (13 export 제거).
* Phase 2 — 10개 auth use-case, `domain/auth/`, `infrastructure/auth/`, user/session/oauthAccount Drizzle repository ejection (~70 export 제거).
* Phase 3 — BYOK (`domain/llm/`, `userApiKeyRepository`, `tokenEncryption`) 및 Tier CRUD use-case ejection. `domain/tier.ts`와 `UserTierRepository` 인터페이스는 분석 정책으로 유지.
* Phase 4 — Ticker 한글 검색·매핑 (`application/ticker/`, `domain/ticker.ts`, `infrastructure/ticker/`, `tickerRepository`) 및 ticker cache key ejection (~14 export 제거).
* Phase 4.5 — AI infra 슬림화: `infrastructure/ai/gemini.ts` 삭제, `AI_SYSTEM_PROMPT`를 `domain/analysis/systemPrompt.ts`로 이동, `callAiProvider` 필수화, `@google/genai` peer dep 제거.
* Phase 5 — `DrizzleUsageRepository` / `DrizzleUsageLogRepository` ejection. `UsageRepository`, `UsageLogRepository` 인터페이스 및 정책 함수(`checkAnalysisLimit`, `checkChatbotLimit`) 유지.
* Phase 6 — `infrastructure/db/{schema,client,config,constants}` 및 `drizzle/` 마이그레이션 전체 ejection. Drizzle/Neon dependency 제거.
* Phase 7 — 문서 정리 (`PUBLIC_API.md` 요약 배너, `SERVICE.md` 재작성, `ARCHITECTURE.md` 폴더 트리 갱신), 잔존하던 `bcryptjs` dependency 제거.

# [0.4.0](https://github.com/y0ngha/siglens-core/compare/v0.2.1...v0.4.0) (2026-05-01)


### Bug Fixes

* 분석 캐시 키에 모델 식별자 포함 및 사용량 기록 개선 ([f49d023](https://github.com/y0ngha/siglens-core/commit/f49d0230cd1cd0217ccdee47283191d8123655cb))
* 분석 캐시 키에서 모델 식별자 통일 및 중복 제거 ([7e321fe](https://github.com/y0ngha/siglens-core/commit/7e321fe69c8ab1985b9145fad132ffd3226dff07))
* 분석 캐시 TTL 만료 시간을 오후 5시에서 오전 5시로 변경 ([b501ca5](https://github.com/y0ngha/siglens-core/commit/b501ca5908b2af9750943fe87b08bd3a95de568d))
* address PR 64 review comments ([7825261](https://github.com/y0ngha/siglens-core/commit/7825261715c86e5712077be6b14a31ee926f7fae))
* deprecated getCurrentDate를 fallback으로 복원 ([2ecd7fa](https://github.com/y0ngha/siglens-core/commit/2ecd7fafc2d41c2404703e29c85b9180bc3d7803))
* getAllowedModels 정렬 순서 일관성 확보 ([45518b8](https://github.com/y0ngha/siglens-core/commit/45518b88b144f0b3938a0f60c4f221139784f1db))
* inquiry feature JSDoc, test cleanup, infrastructure tests, and public API exports ([30796d9](https://github.com/y0ngha/siglens-core/commit/30796d9790f13051ef6838b18fbf17308dbc20c1))
* **inquiry:** use EMAIL_MAX_LENGTH constant, export DrizzleInquiryRepository, add [@returns](https://github.com/returns) JSDoc ([128e869](https://github.com/y0ngha/siglens-core/commit/128e869533f4dcb73e8a803d70d197e1eb93fcf6))
* LlmProvider 타입을 도메인 공통 타입으로 이동 및 구조화 ([0650209](https://github.com/y0ngha/siglens-core/commit/065020979d93fc7b9eb7c1f72c6cd1c64e909fa2))
* onConflictDoUpdate SET 절에 updatedAt 추가 및 JSDoc 역할 중심 변경 ([da6acab](https://github.com/y0ngha/siglens-core/commit/da6acaba1890563462762d93dd46f187e4119eee))
* PR [#65](https://github.com/y0ngha/siglens-core/issues/65) 리뷰 코멘트 반영 — {never} JSDoc 타입, 테스트 분리, 문서 갱신 ([a4bc432](https://github.com/y0ngha/siglens-core/commit/a4bc432267d278047d40e46d0c464c626b565307))
* PR [#65](https://github.com/y0ngha/siglens-core/issues/65) 리뷰 코멘트 반영 — 공개 API 하위 호환성 및 버전 메타데이터 ([ff8f8db](https://github.com/y0ngha/siglens-core/commit/ff8f8db26ea659b1d247a0e7a12be853a24aa18c))
* PR [#65](https://github.com/y0ngha/siglens-core/issues/65) 리뷰 코멘트 반영 — GeminiContents를 AiContents로 전환 (provider-neutral) ([00e7183](https://github.com/y0ngha/siglens-core/commit/00e7183505572fd7bae8523225b7bd01b4972b60))
* PR [#65](https://github.com/y0ngha/siglens-core/issues/65) 리뷰 코멘트 반영 — provider-neutral 문서 정정 및 누락 테스트 추가 ([4d74293](https://github.com/y0ngha/siglens-core/commit/4d74293b487a488f1e537260653c8c8de06547b4))
* PR [#65](https://github.com/y0ngha/siglens-core/issues/65) 리뷰 코멘트 반영 — Tier 1 JSDoc 완성, provider-neutral 파라미터 타입 정정 ([9d9c816](https://github.com/y0ngha/siglens-core/commit/9d9c8168d9dd12510465d60f8d9d54b81d37a525))
* PR [#65](https://github.com/y0ngha/siglens-core/issues/65) review comments 반영 ([38551ba](https://github.com/y0ngha/siglens-core/commit/38551ba451d6a1d2e12a4efb5dc88c8d8e628c0d))
* PR [#68](https://github.com/y0ngha/siglens-core/issues/68) review comments 반영 ([69a7d42](https://github.com/y0ngha/siglens-core/commit/69a7d42cb97266a6827086671fb4ee090ce8c8f4))
* requestChatCompletion 시간 주입 통일 ([b21e9f5](https://github.com/y0ngha/siglens-core/commit/b21e9f5289b467c832406aea9ba6038fdd211e47)), closes [#63](https://github.com/y0ngha/siglens-core/issues/63)
* resolve PR [#65](https://github.com/y0ngha/siglens-core/issues/65) review comments ([e254cd2](https://github.com/y0ngha/siglens-core/commit/e254cd24a6dcd05a54ac9757853f4cf115638c93))


### Features

* 공개 API 내보내기 - LLM 도메인 및 저장소 ([3b834de](https://github.com/y0ngha/siglens-core/commit/3b834dee2fdc2581df2caf9957994c30cf21ebd6))
* 분석 캐시 키에 모델 식별자 포함 ([3f52aba](https://github.com/y0ngha/siglens-core/commit/3f52abad85c97ea21768879a39a6c792db8e9a42))
* 스키마 및 타입 - user_api_keys 정의 ([d26c0a1](https://github.com/y0ngha/siglens-core/commit/d26c0a117a6335673a0c40bb368ed8952e46b33f))
* 암호화 키 설정 - LLM_API_KEY_ENCRYPTION_KEY 환경변수 ([35f7ecd](https://github.com/y0ngha/siglens-core/commit/35f7ecdf1091a8c9a712fb9a2261a75e18e49339))
* 저장소 - DrizzleUserApiKeyRepository 구현 ([5bd2211](https://github.com/y0ngha/siglens-core/commit/5bd22110528610d1d7b6318cd0d1cf736902df43))
* AI 모델 티어 확대 및 모델 업데이트 ([a08bed4](https://github.com/y0ngha/siglens-core/commit/a08bed40f5aa6cbd2396f2065fa8abba3c1fbcee))
* DB 내보내기 - userApiKeyRepository 추가 ([223537b](https://github.com/y0ngha/siglens-core/commit/223537be77f0d407319af91b296e6232da80347f))
* DB 마이그레이션 - user_api_keys 테이블 추가 ([138895b](https://github.com/y0ngha/siglens-core/commit/138895b87825797d2245a57c2c0291fbe350672d))
* **db:** add DrizzleInquiryRepository ([74aed9f](https://github.com/y0ngha/siglens-core/commit/74aed9fc27f73a48fa1f814dd1efa81daa983040))
* **db:** add inquiries migration ([05bca84](https://github.com/y0ngha/siglens-core/commit/05bca841d0cb17fbd878653a6d5faa54f98fc216))
* **db:** add inquiries table schema and InquiryRepository interface ([25f59bd](https://github.com/y0ngha/siglens-core/commit/25f59bddb2d46fbef8c1252040ebaa2ee916a2a6))
* Drizzle 메타데이터 - 마이그레이션 스냅샷 ([e5a075a](https://github.com/y0ngha/siglens-core/commit/e5a075afb5dd612db3d41fd546268309bb680be0))
* **inquiry:** add submitInquiry use-case with tests ([45d63dc](https://github.com/y0ngha/siglens-core/commit/45d63dcd56820886ef0f5c0fc14ecdf813c09dd7))
* **inquiry:** export submitInquiry and types from public API ([a958fbb](https://github.com/y0ngha/siglens-core/commit/a958fbb23bfbffd4653889767841877608705304))
* LLM 도메인 - 제공자 타입 및 유효성 검증 ([eb817ab](https://github.com/y0ngha/siglens-core/commit/eb817abbda336fe0e41d62964e5d1a6d895c3030))


### Reverts

* change-log, package.json 롤백 ([8f3dcec](https://github.com/y0ngha/siglens-core/commit/8f3dcece29d466e12889a17816598724d16dadfc))

## [0.3.0](https://github.com/y0ngha/siglens-core/compare/v0.2.1...v0.3.0) (2026-05-01)

### BREAKING CHANGES

* `RequestChatCompletionDependencies.callGemini` renamed to `callAiProvider`. The old field is retained as `@deprecated` and falls back to `callAiProvider` during the transition period.
* `CallGeminiWithKeyFallbackOptions` renamed to `CallAiProviderOptions` with field renames (`freeApiKey` → `primaryApiKey`, `paidApiKey` → `fallbackApiKey`). The old type alias is retained as `@deprecated`.
* `TierModel` union members `claude-sonnet-4` and `claude-opus-4` are `@deprecated` in favour of `claude-sonnet-4-6` and `claude-opus-4-7`. Both old identifiers remain in the union until the next major version.

### Features

* AI 모델 티어 확대 — FREE 티어에 claude-haiku-3-5·gpt-5-mini, MEMBER 티어에 claude-sonnet-4-6·gpt-5.4, PRO 티어에 claude-opus-4-7·gpt-5.5·gemini-3-flash-preview·gemini-3.1-pro-preview 추가
* AI provider 추상화 — `callGemini` → `callAiProvider`, `CallGeminiWithKeyFallbackOptions` → `CallAiProviderOptions` (provider-neutral 이름으로 변경)
* `VALID_CHAT_MODELS`를 tier 설정에서 파생하도록 변경 (`getAllowedModels`)

## [0.2.1](https://github.com/y0ngha/siglens-core/compare/v0.1.14...v0.2.1) (2026-05-01)


### Bug Fixes

* 리뷰 코멘트 반영 - race condition, logging, type imports 정리 ([4047393](https://github.com/y0ngha/siglens-core/commit/4047393f73e94c078ea3d64fccca0b9c5a2139cf))
* address PR 56 follow-up comments ([7688d75](https://github.com/y0ngha/siglens-core/commit/7688d75cf690361f157d40f0b35f1c29668faf96))
* address PR 56 review comments ([2fe2e51](https://github.com/y0ngha/siglens-core/commit/2fe2e51e437f72db15a2be23c34d9d45fdeada4c))
* import error fix ([29bfeab](https://github.com/y0ngha/siglens-core/commit/29bfeab2300208580032b8928e1cbeb553f7f7d8))
* PR [#49](https://github.com/y0ngha/siglens-core/issues/49) 리뷰 코멘트 반영 - OAuth 타입 구조 개선, 테스트 추가, 타임아웃 상수 통합 ([dacc5e0](https://github.com/y0ngha/siglens-core/commit/dacc5e0e4318373c63080bc7876304b52d3149fb))
* PR [#51](https://github.com/y0ngha/siglens-core/issues/51) 리뷰 코멘트 반영 - OAuth 토큰 폐기 기능 오류 수정 ([1716120](https://github.com/y0ngha/siglens-core/commit/171612088c47e903a7a4b079b086488fa5cb7a17))
* PR 51 리뷰 코멘트 반영 ([ed3f6c4](https://github.com/y0ngha/siglens-core/commit/ed3f6c4e083c411e92d614d7ed02721d0a09ba9d))


### Features

* 도메인 타입 및 public API 업데이트 ([f20d04a](https://github.com/y0ngha/siglens-core/commit/f20d04aaebd97074ba36c0efb81d9eb5b44dd6c6))
* 이메일 인증 통합 + 비밀번호 재설정 Redis 마이그레이션 ([db5c9fa](https://github.com/y0ngha/siglens-core/commit/db5c9fa06c77201b806ab2ddb67000e5d6544c21))
* add OAuth token revocation on account deletion ([#50](https://github.com/y0ngha/siglens-core/issues/50)) ([db1ae78](https://github.com/y0ngha/siglens-core/commit/db1ae78ff41d359fc348dc84424f7ecf3dab39c5))
* EmailDispatcher 및 email 템플릿 구현 ([7a1b209](https://github.com/y0ngha/siglens-core/commit/7a1b2099cd3126d58dcfc878471afebae84e99d5))
* requestPasswordReset에 EmailDispatcher 통합 ([3df579f](https://github.com/y0ngha/siglens-core/commit/3df579feec1f9ec812256f1bd9bdc9e5a2b6b904))

## [0.2.0](https://github.com/y0ngha/siglens-core/compare/v0.1.14...v0.2.0) (2026-05-01)

### BREAKING CHANGES

* `registerUser` now accepts a dependencies object containing `users`, `passwordHasher`, and `emailTokens`.
* `requestPasswordReset` now requires `EmailTokenStore`, `EmailDispatcher`, and `buildMessage` options for Redis-backed token storage and dispatch.
* `confirmPasswordReset` input now requires `email`, and its dependencies now use `emailAuthUsers`, `users`, `emailTokens`, and `passwordHasher`.
* Password reset persistence moved from the PostgreSQL `password_resets` table to Redis keys under `email_token:{purpose}:{email}`.

### Features

* add Redis-backed email verification and password reset token flows.

## [0.1.14](https://github.com/y0ngha/siglens-core/compare/v0.1.12...v0.1.14) (2026-04-30)


### Bug Fixes

* address AI model tier PR review comments ([390aa28](https://github.com/y0ngha/siglens-core/commit/390aa28d76c694eb0bbd2c611e16fec048c4d5dd))
* address timeframe restriction PR review ([af33517](https://github.com/y0ngha/siglens-core/commit/af33517fe770ed5371f84b17ad2b44ac4d6415b0))
* address usage limit PR review ([b48e139](https://github.com/y0ngha/siglens-core/commit/b48e139300b6304e4bb0f7121c6dc2cc85dff7ff))
* address usage limit review comments ([42edc8d](https://github.com/y0ngha/siglens-core/commit/42edc8d6f1b0eb25c9cf785fff1797c2275f0a43))
* asset-info DB 실패 시 캐시 갱신 중단 ([45b4a30](https://github.com/y0ngha/siglens-core/commit/45b4a303f2b977d4d1d5cb8d1afaaed40f1021bd))
* PR [#49](https://github.com/y0ngha/siglens-core/issues/49) 리뷰 코멘트 반영 - 사용 제한 게이트 에러 처리 개선 ([8b74c4b](https://github.com/y0ngha/siglens-core/commit/8b74c4b792eb0d084e5524928d6b9c293c155bf3))
* PR [#49](https://github.com/y0ngha/siglens-core/issues/49) 리뷰 코멘트 반영 - 사용 제한 게이트 에러 처리 개선 ([7c1daa0](https://github.com/y0ngha/siglens-core/commit/7c1daa084af17d3a1bf1129a680369518547624e))
* PR [#49](https://github.com/y0ngha/siglens-core/issues/49) 리뷰 코멘트 반영 - 사용 제한 게이트 에러 처리 개선 ([931ceee](https://github.com/y0ngha/siglens-core/commit/931ceeeaa66690b82abf211c1b5233b44fe262fa))
* PR [#49](https://github.com/y0ngha/siglens-core/issues/49) 리뷰 코멘트 반영 - 사용 제한 게이트 에러 처리 개선 ([508d31e](https://github.com/y0ngha/siglens-core/commit/508d31e1b2996695dffd77ed8c32f0bf7cbaa94f))
* PR [#49](https://github.com/y0ngha/siglens-core/issues/49) 리뷰 코멘트 반영 - 사용 제한 게이트 타입 및 에러 메시지 개선 ([8780160](https://github.com/y0ngha/siglens-core/commit/8780160dee1f55d568e6de7984785234d71be497))
* PR 45 리뷰 코멘트 반영 ([fffdbbd](https://github.com/y0ngha/siglens-core/commit/fffdbbd7b915e2fbcb196a7cdb4fcdfd60c9e3e2))
* PR 45 review comments ([a31488f](https://github.com/y0ngha/siglens-core/commit/a31488fc332241eb31169c92bb11646ee1ffd828))
* PR 46 리뷰 코멘트 반영 ([11d7d52](https://github.com/y0ngha/siglens-core/commit/11d7d5241624d29d80e6e5c4bdfdbc6c258abaf3))
* PR 46 리뷰 코멘트 반영 ([369375e](https://github.com/y0ngha/siglens-core/commit/369375ecb6946e8c935f385d0877ef4a5ff72d47))
* PR 리뷰 코멘트 반영 ([d762e0a](https://github.com/y0ngha/siglens-core/commit/d762e0a4adf33cc92cc710c47280a39e74b2cf9d))
* PR 리뷰 코멘트 반영 ([dd515fd](https://github.com/y0ngha/siglens-core/commit/dd515fdccb6cdcc1b432ef3249b41615fb5f9629))
* PR 리뷰 코멘트 반영 ([7a95119](https://github.com/y0ngha/siglens-core/commit/7a951194914de3f46c1d49394b0aa8a15b1a2ced))
* PR 리뷰 코멘트 반영 ([d93326d](https://github.com/y0ngha/siglens-core/commit/d93326d59238d9fc7a2f8956a8f6cab65b3aa047))
* preserve usage limit error types ([947d972](https://github.com/y0ngha/siglens-core/commit/947d972ca4c44f57ee080fb39142e1dda7fd0d44))
* reuse analysis usage timestamp ([0fbff9b](https://github.com/y0ngha/siglens-core/commit/0fbff9b6680f2df82b545e308b734637cb7b5cc2))
* Update src/infrastructure/db/usageRepository.ts ([ddecc62](https://github.com/y0ngha/siglens-core/commit/ddecc624f4d4f9e0b2f45db155000f6cc3bfb053))


### Features

* 정보 깊이 제한 필터 구현 ([d68bfd5](https://github.com/y0ngha/siglens-core/commit/d68bfd595693366ccbb7f6dce7617882cb28c043))
* 타임프레임 티어 제한 구현 ([58c12bf](https://github.com/y0ngha/siglens-core/commit/58c12bf6b3b25547c325555766fa942ce0ad36ce))
* add AI model tier gating ([01671cc](https://github.com/y0ngha/siglens-core/commit/01671cc6bce96fc3a675cb77e6ba37895d8204cb))
* add usage limit gates ([31022b9](https://github.com/y0ngha/siglens-core/commit/31022b953522d870d2e97f9d2ac95f69c19fc22b))
* **auth:** add password reset use cases ([f2081b3](https://github.com/y0ngha/siglens-core/commit/f2081b31a8b20c177ff0d8f02cdf5e78343a90b8))
* implement usage tracking repository ([cb816cd](https://github.com/y0ngha/siglens-core/commit/cb816cd5e677e07d77ac64b34edd7e03aa2fe1ed))

## [0.1.12](https://github.com/y0ngha/siglens-core/compare/v0.1.10...v0.1.12) (2026-04-27)


### Bug Fixes

* 리뷰 코멘트 반영 - bcrypt 목킹, [@see](https://github.com/see) 태그, deleteAccount 쿠키 메타 ([82bd07c](https://github.com/y0ngha/siglens-core/commit/82bd07c98129d71c167bdc5aa4e411d76887034f)), closes [#11](https://github.com/y0ngha/siglens-core/issues/11)


### Features

* 공개 API 및 모듈 export 추가 ([8ec1038](https://github.com/y0ngha/siglens-core/commit/8ec1038d1a03c4a2f5a655af43d1fb1bd4777abd))
* 데이터베이스 레포지토리 auth 기능 확장 ([277bce2](https://github.com/y0ngha/siglens-core/commit/277bce2a258d077d8a5df82a21dbab930a2dffd3))
* auth 헬퍼 묶음 및 회원탈퇴 use-case 추가 ([d4fcbf5](https://github.com/y0ngha/siglens-core/commit/d4fcbf5d9b9d0732c4fce08e97f8b5d88950994c))
* bcrypt 어댑터 및 인프라 auth 모듈 추가 ([b5ea632](https://github.com/y0ngha/siglens-core/commit/b5ea632052510af983eb238dab9e19285fae8cce))

## [0.1.10](https://github.com/y0ngha/siglens-core/compare/v0.1.9...v0.1.10) (2026-04-27)


### Bug Fixes

* 리뷰 코멘트 반영 - DB 스키마 타입 export 및 테스트 보완 ([65d17c0](https://github.com/y0ngha/siglens-core/commit/65d17c0566cea513f61d08e8a4254dc06ebf05b0))
* 이메일 로그인 리뷰 코멘트 반영 ([6b84fe7](https://github.com/y0ngha/siglens-core/commit/6b84fe7b801bd4fcde1754aca692cb45ffa2e271))
* address PR [#35](https://github.com/y0ngha/siglens-core/issues/35) follow-up review ([03b69da](https://github.com/y0ngha/siglens-core/commit/03b69da554c27bb179ea275fffde30a96a5290b5))
* address PR [#36](https://github.com/y0ngha/siglens-core/issues/36) tier export review ([adfe234](https://github.com/y0ngha/siglens-core/commit/adfe234b1f2acd6e15e764617092e33b9e8b7da2))
* address social login review comments ([ff8307a](https://github.com/y0ngha/siglens-core/commit/ff8307ae019117f9316554efc225f32c59537c8c))
* Neon Drizzle 스키마 설정 개선 ([8a9b70e](https://github.com/y0ngha/siglens-core/commit/8a9b70ee78b67a44bb32aa6625c4919d51705247))
* Neon Drizzle DB 타입 및 내보내기 정정 ([65f5914](https://github.com/y0ngha/siglens-core/commit/65f59144a5578cbf59a3aff6465eb1d60fe093bc))
* Neon Drizzle DB 테스트 및 스키마 코드 품질 개선 ([800f806](https://github.com/y0ngha/siglens-core/commit/800f8063c873f1ee94211204a125501c5f4381df))
* PR [#32](https://github.com/y0ngha/siglens-core/issues/32) 리뷰 코멘트 반영 - DB Tier 3/4 exports 분리 및 NeonSqlClient 제거 ([00c56ca](https://github.com/y0ngha/siglens-core/commit/00c56cac306508328477449d6adc5908a96cc474))
* PR [#33](https://github.com/y0ngha/siglens-core/issues/33) 리뷰 코멘트 반영 - infra 크로스모듈 커플링 제거 및 Tier 그룹핑 회귀 수정 ([7e2d357](https://github.com/y0ngha/siglens-core/commit/7e2d357e19cf0f2367f7937c4eb5703c16ce71be))
* PR [#37](https://github.com/y0ngha/siglens-core/issues/37) 리뷰 코멘트 반영 ([db2f3d4](https://github.com/y0ngha/siglens-core/commit/db2f3d44ed62a55c1f99009501fa270dd1d964ef))
* registerUser 함수 개선 (입력값 trim, 비밀번호 메시지 템플릿) ([ded0040](https://github.com/y0ngha/siglens-core/commit/ded0040deb608abd01e66c20b2fba2780404a851))
* resolve PR [#35](https://github.com/y0ngha/siglens-core/issues/35) review blockers ([d4bb15e](https://github.com/y0ngha/siglens-core/commit/d4bb15ec6ff585fd42ee297963537237c42e1e60))
* review fix ([371b6ae](https://github.com/y0ngha/siglens-core/commit/371b6ae14da3d512ae1fce9a757dc464fe6fc661))
* trim PR 35 database public API ([9578331](https://github.com/y0ngha/siglens-core/commit/957833107760217d3ccb9833668e1efb819f00a4))


### Features

* 사용자 등급 시스템 구현 ([846c911](https://github.com/y0ngha/siglens-core/commit/846c91114a5ea495261d3d5e963287c8b2b38125))
* 이메일 회원가입 구현 ([0b11ebe](https://github.com/y0ngha/siglens-core/commit/0b11ebe991cb329958f67690a68cbd47c95a20f5))
* 티어 제한 설정 추가 ([f1d73d7](https://github.com/y0ngha/siglens-core/commit/f1d73d770794aa6d38cadd454840cc9985afacab))
* implement email login ([4ddbded](https://github.com/y0ngha/siglens-core/commit/4ddbded8700e96d503c21f1887ec7981bb91f9fa))
* implement social login ([8da8606](https://github.com/y0ngha/siglens-core/commit/8da8606b22d2835da9d26365ff6b390da29b6968))
* Neon Drizzle DB 스키마 연동 ([018a4f7](https://github.com/y0ngha/siglens-core/commit/018a4f79c8622985dbc6fc2a7912b93ca10dc21b))
* Neon Drizzle DB 스키마 연동 ([5ed15ce](https://github.com/y0ngha/siglens-core/commit/5ed15ceaf60352b58502d796d6fa9a74f17dccf4))

## [0.1.9](https://github.com/y0ngha/siglens-core/compare/v0.1.8...v0.1.9) (2026-04-27)


### Features

* AI 채팅 진행시 서버 오류일 경우 보상 트랜잭션 진행 ([6e80d49](https://github.com/y0ngha/siglens-core/commit/6e80d494cae7d810faaf53a92c11e316bda010e5))

## [0.1.8](https://github.com/y0ngha/siglens-core/compare/v0.1.7...v0.1.8) (2026-04-27)


### Features

* 채팅 프롬프트 형식 추가 ([2d59dc8](https://github.com/y0ngha/siglens-core/commit/2d59dc817ace94d384dd44e0261601b550b60679))


### Performance Improvements

* 프롬프트, 채팅 프롬프트 가독성 및 품질 개선 ([05dbd09](https://github.com/y0ngha/siglens-core/commit/05dbd094eeb9f55ef90e242a03a49659588a13be))

## [0.1.7](https://github.com/y0ngha/siglens-core/compare/v0.1.6...v0.1.7) (2026-04-27)

## [0.1.6](https://github.com/y0ngha/siglens-core/compare/v0.1.5...v0.1.6) (2026-04-27)


### Features

* support waitUntil for background application tasks ([2fe5fac](https://github.com/y0ngha/siglens-core/commit/2fe5fac2e8f14b10babc5b493a964b6ed2c54282))

## [0.1.5](https://github.com/y0ngha/siglens-core/compare/v0.1.4...v0.1.5) (2026-04-27)

## [0.1.4](https://github.com/y0ngha/siglens-core/compare/v0.1.3...v0.1.4) (2026-04-26)


### Bug Fixes

* 일목균형표 방어로직 추가 ([bba68a7](https://github.com/y0ngha/siglens-core/commit/bba68a722d0151af3722087a0ea7911a5bab285b))

## [0.1.3](https://github.com/y0ngha/siglens-core/compare/v0.1.2...v0.1.3) (2026-04-26)


### Bug Fixes

* AI 후속 질문 범위 판별 개선 ([a62f304](https://github.com/y0ngha/siglens-core/commit/a62f304fa880ea4346aea751d49a9d2753e4a3bf))


### Features

* siglens에 필요한 type export ([c43a01e](https://github.com/y0ngha/siglens-core/commit/c43a01ec743898ab77ff4a2d46b2030347216cdd))

## [0.1.2](https://github.com/y0ngha/siglens-core/compare/v0.1.1...v0.1.2) (2026-04-26)


### Bug Fixes

* 빠진 export 추가 ([1c46968](https://github.com/y0ngha/siglens-core/commit/1c46968cfbf2f7d8c774e6ef1b5895de896673d3))

## 0.1.1 (2026-04-26)


### Bug Fixes

* PR [#23](https://github.com/y0ngha/siglens-core/issues/23) suggestion 반영 — Bearish MACD abs 일관성 및 !단언 주석 보완 ([fe80349](https://github.com/y0ngha/siglens-core/commit/fe80349f994e7d1ff2e3d577012d2c673a15e9a7))
* PR [#24](https://github.com/y0ngha/siglens-core/issues/24) Round 2 review comments 반영 ([cf5b752](https://github.com/y0ngha/siglens-core/commit/cf5b7522a165638505f1542c240212ab0a8fac9f))
* PR [#24](https://github.com/y0ngha/siglens-core/issues/24) Round 3 review comments 반영 ([d3e2f0e](https://github.com/y0ngha/siglens-core/commit/d3e2f0e9f011849f1a91e7c000b34932daf74f16))
* PR [#24](https://github.com/y0ngha/siglens-core/issues/24) Round 4 review comments 반영 ([16c0304](https://github.com/y0ngha/siglens-core/commit/16c030417e56ff19e79803848760299c939c9ed0))
* PR [#24](https://github.com/y0ngha/siglens-core/issues/24) Round 4 review comments 반영 ([c47c4d1](https://github.com/y0ngha/siglens-core/commit/c47c4d1266ea0a19ad3f20597c08a01dcf303db3))
* PR [#24](https://github.com/y0ngha/siglens-core/issues/24) Round 5 review comments 반영 ([5e4c7b2](https://github.com/y0ngha/siglens-core/commit/5e4c7b2ee92a1e4d5684de4be1d48fbdea4f30ab))
* PR [#24](https://github.com/y0ngha/siglens-core/issues/24) 리뷰 코멘트 반영 - re-export 제거, TTL 수정, 테스트 패턴 개선 ([992bebe](https://github.com/y0ngha/siglens-core/commit/992bebef21f7ce074b675c2b4f6b58ea72eee658))
* PR [#26](https://github.com/y0ngha/siglens-core/issues/26) review comments 반영 ([71a5232](https://github.com/y0ngha/siglens-core/commit/71a5232ce6f686d247b4d3e2d5d90ee6ea426d9d))
* PR [#26](https://github.com/y0ngha/siglens-core/issues/26) review comments 반영 ([13bd96e](https://github.com/y0ngha/siglens-core/commit/13bd96e146e8ec6dce6b1a10bb71dc7d86238127))
* PR [#26](https://github.com/y0ngha/siglens-core/issues/26) review comments 반영 ([ddff271](https://github.com/y0ngha/siglens-core/commit/ddff2710007bad28d2ec14108c571a105e88237f))
* PR [#26](https://github.com/y0ngha/siglens-core/issues/26) Round 2 리뷰 코멘트 반영 — squeezeMomentum/ichimoku O(N) 리팩터, WorkerConfig 타입 이동, volume-profile 인플레이스 변환, toBeCloseTo 수치 검증 테스트 추가 ([b5e2caa](https://github.com/y0ngha/siglens-core/commit/b5e2caa936800fd3fd2ffaafd8afaea0417c1957))
* PR [#26](https://github.com/y0ngha/siglens-core/issues/26) Round 3 리뷰 코멘트 반영 — lastNonNull domain 이동, new Date() 중복 제거, donchianChannel O(N) 최적화 ([067a561](https://github.com/y0ngha/siglens-core/commit/067a561467f46c1bd8c4f3e7cc380a15c99473d7))
* PR [#26](https://github.com/y0ngha/siglens-core/issues/26) Round 3 리뷰 코멘트 반영 — toBeCloseTo 스케일 조정, Market 에러 핸들링 개선 ([9ba0e30](https://github.com/y0ngha/siglens-core/commit/9ba0e30bb9192965960cb020b7f2f8bef5a01df2))
* PR [#26](https://github.com/y0ngha/siglens-core/issues/26) 리뷰 반영 — env var config 집중화, ichimoku 테스트 정확도 검증 추가, 규칙 문서 업데이트 ([946d644](https://github.com/y0ngha/siglens-core/commit/946d6440f1d76dba5c20b3e1feefbcbd5c265350))
* PR [#26](https://github.com/y0ngha/siglens-core/issues/26) 리뷰 반영 — 상수화, 타입 정의, 선언형 패턴 적용 ([f8be071](https://github.com/y0ngha/siglens-core/commit/f8be071912351511c0566367f2995cd0edd1014e))
* PR [#26](https://github.com/y0ngha/siglens-core/issues/26) 리뷰 반영 — 시간 의존성 제거, 상수 추출, 선언형 패턴 ([304926b](https://github.com/y0ngha/siglens-core/commit/304926b32149d403b4be15b6dfcafd4eca227d31))
* PR [#26](https://github.com/y0ngha/siglens-core/issues/26) 리뷰 반영 — 인터페이스 계층 분리, 테스트 정확도 검증 추가 ([92c0614](https://github.com/y0ngha/siglens-core/commit/92c06149a2f8317ac37ae27a86dad32a5dfba873))
* PR [#26](https://github.com/y0ngha/siglens-core/issues/26) 리뷰 코멘트 반영 — 에러 처리 패턴 개선 및 타입 캐스팅 위치 조정 ([3f45f68](https://github.com/y0ngha/siglens-core/commit/3f45f68c7a1c12e9963bbbd7b55363d776f06aa4))
* PR [#27](https://github.com/y0ngha/siglens-core/issues/27) 리뷰 코멘트 반영 ([62c67e8](https://github.com/y0ngha/siglens-core/commit/62c67e86f151791cf295e8bb07c7b449792515f2))
* PR [#27](https://github.com/y0ngha/siglens-core/issues/27) 리뷰 코멘트 반영 ([79afc2f](https://github.com/y0ngha/siglens-core/commit/79afc2ff065a3cc69e42f240a92ec1262899edc5))
* Remove RawAnalysisResponse from public API exports ([66c7ce5](https://github.com/y0ngha/siglens-core/commit/66c7ce5d78d56ec45e51bb85776efb7325209e5a))
* stochastic/stochastic-rsi/smc 리팩터 및 utils 최적화 ([5a6d196](https://github.com/y0ngha/siglens-core/commit/5a6d1966463a7609744e81001796a5617d504c4b))
* YAML 파싱 reduce+spread O(K²) → for-loop 패턴 ([e9a905d](https://github.com/y0ngha/siglens-core/commit/e9a905d8b11fdb754655e7275d1b2d9448c75914))
* 리뷰 코멘트 반영 (타입 정의, 메서드 재사용, 코드 개선) ([ae4cfa7](https://github.com/y0ngha/siglens-core/commit/ae4cfa7a11b5e948fd202f715aad0563c401a3e8))
* 리뷰 피드백 반영 (테스트 커버리지 확대, 불변성 강화, 매직 넘버 제거) ([e144fb1](https://github.com/y0ngha/siglens-core/commit/e144fb1e57095cc22d1b84d4f358b47a26405c54))
* 마켓 인프라 환경 변수 중앙화 및 타입 단순화 ([f82935d](https://github.com/y0ngha/siglens-core/commit/f82935d9a50d4cd75800fd5bd901c4e61ec217b9))
* 인디케이터 슬라이딩 윈도우 최적화 및 O(N²) 패턴 제거 ([5be2de5](https://github.com/y0ngha/siglens-core/commit/5be2de5ad3dfcf95b1b56504821b5394061cad8d))
* 타입 안전성 강화 - 캐스팅 주석, non-null 어설션, 테스트 수정 ([55ef140](https://github.com/y0ngha/siglens-core/commit/55ef1402339849186c0abd8fe084077bc68380df))


### Features

* [Migrate] infrastructure/ticker ([#19](https://github.com/y0ngha/siglens-core/issues/19)) + infrastructure/dashboard ([#20](https://github.com/y0ngha/siglens-core/issues/20)) ([68d620e](https://github.com/y0ngha/siglens-core/commit/68d620ee191a7a9d1d2488685265e5f4431807e2))
* add application layer — move orchestration functions from infrastructure/market ([5873704](https://github.com/y0ngha/siglens-core/commit/5873704018da6d85f70a39c8303bc6419e178ec9))
* enforce application layer boundary via ESLint no-restricted-imports ([f166035](https://github.com/y0ngha/siglens-core/commit/f1660356c26740001010943b003dc5e24cc7ea0e))
* infrastructure/cache, jobs, ai 이전 (Issue [#17](https://github.com/y0ngha/siglens-core/issues/17)) ([995c1e3](https://github.com/y0ngha/siglens-core/commit/995c1e34523315bcfb616abc760c5062e326f4c0))
* infrastructure/market 이전 ([#18](https://github.com/y0ngha/siglens-core/issues/18)) ([d6a77a9](https://github.com/y0ngha/siglens-core/commit/d6a77a95d5bcf10cc2663be4cff7914cbb2d3256))
* infrastructure/ticker + infrastructure/dashboard 이전 ([281e51f](https://github.com/y0ngha/siglens-core/commit/281e51f7e28922055c1fc90ebff7b7f837b99627)), closes [#19](https://github.com/y0ngha/siglens-core/issues/19) [#20](https://github.com/y0ngha/siglens-core/issues/20)
* 서버 코드 분리 & 핵심 로직 NPM Private Package 분리 ([022bfc3](https://github.com/y0ngha/siglens-core/commit/022bfc3d07002d367ccf413e097c79eab20e8cf4))
