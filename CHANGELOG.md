# Changelog

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
