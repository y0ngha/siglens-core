# External Services

> **Note (Phase 0~7 refactor, 2026-05):** DB(Auth/Email/OAuth/BYOK/Ticker), Gemini SDK
> 의존성, 그리고 그에 부속된 환경변수(`DATABASE_URL`, `OAUTH_TOKEN_ENCRYPTION_KEY`,
> `LLM_API_KEY_ENCRYPTION_KEY`, `TRANSLATE_*`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` 등)는
> 모두 consumer(siglens) 측으로 이전되었다. 이 문서는 분석 경로에서 코어가 직접 호출하는
> 외부 서비스만 다룬다. consumer 측 외부 통합은 siglens 레포의 `docs/API.md` /
> `docs/AUTH.md`를 참조한다.

`siglens-core`가 직접 호출하는 외부 서비스 목록이다. 모든 호출은 `infrastructure/`
레이어 내부에서만 발생하며, 각 서비스는 `types.ts`의 인터페이스를 통해 추상화된다.

호출자(consumer)가 직접 사용하는 외부 API(FMP, Alpaca 등 시세 프로바이더)는 consumer가
구현한 뒤 `infrastructure/market/`의 `MarketDataProvider` 인터페이스에 주입한다.

---

## 환경변수 전체 목록

```bash
# Upstash Redis (선택 — 미설정 시 캐시/채팅 토큰 저장 없이 graceful degradation)
UPSTASH_REDIS_REST_URL=             # Upstash Redis REST URL
UPSTASH_REDIS_REST_TOKEN=           # master 토큰 (읽기/쓰기)
UPSTASH_REDIS_REST_READONLY_TOKEN=  # readonly 토큰 (없으면 master 사용)

# Market Data Provider (선택 — 기본값 fmp)
MARKET_DATA_PROVIDER=fmp            # fmp | alpaca
FMP_API_KEY=                        # MARKET_DATA_PROVIDER=fmp 시 필수
ALPACA_API_KEY=                     # MARKET_DATA_PROVIDER=alpaca 시 필수
ALPACA_API_SECRET=                  # MARKET_DATA_PROVIDER=alpaca 시 필수 (legacy alias: ALPACA_SECRET_KEY)

# Worker (선택 — submitAnalysis 시 외부 worker에 위임할 때만)
WORKER_URL=                         # worker 엔드포인트 URL
WORKER_SECRET=                      # worker 인증 시크릿
```

환경변수는 **infrastructure 레이어 내부에서만 읽는다.** domain/application은 환경에
의존하지 않는다. consumer 프로젝트는 자신의 `.env`에 위 값을 설정해 주입한다.
`siglens-core` 레포의 테스트 실행 시에는 더미 값을 사용하며 실제 외부 호출을 하지 않는다.

> AI Provider 호출(Claude/Gemini)은 더 이상 코어가 직접 수행하지 않는다.
> `requestChatCompletion`은 `RequestChatCompletionDependencies.callAiProvider`로
> consumer가 주입한 구현체를 호출하며, API key 관리·암호화·provider 라우팅은 consumer 측
> 책임이다.

---

## 1. Upstash Redis (분석 결과 캐시)

공식 문서: https://upstash.com/docs/redis/features/restapi

```
Base URL: {UPSTASH_REDIS_REST_URL}
```

### 인증

```
Header: Authorization: Bearer {UPSTASH_REDIS_REST_TOKEN}
```

읽기 전용 작업에는 `UPSTASH_REDIS_REST_READONLY_TOKEN`을 사용하고, 미설정 시 master
토큰으로 fallback한다.

### 사용 패턴

AI 분석 결과는 심볼·타임프레임별 TTL로 캐싱한다.

- 캐시 키 예시: `analysis:{symbol}:{timeframe}:{modelId}` (예: `analysis:AAPL:1Day:gemini-2.5-flash`)
- TTL은 타임프레임에 따라 결정한다 (`infrastructure/cache/config.ts`에서 정의)
- 환경변수 미설정 시 캐시 없이 정상 동작(graceful degradation)

### 구현 위치

```
domain/ports/
└── cache.ts     ← CacheProvider 인터페이스 (port)

infrastructure/cache/
├── types.ts     ← 어댑터 내부 타입 (CachedBriefingData 등)
├── config.ts    ← 캐시 키 / TTL 상수
└── redis.ts     ← Upstash 어댑터 (@adapter implements CacheProvider)
```

`CacheProvider`를 in-memory stub으로 대체하면 단위 테스트에서 외부 호출 없이 검증할 수 있다.

---

## 2. Upstash Redis (채팅 토큰 제한)

동일한 Upstash Redis 인스턴스를 채팅 토큰 제한에도 사용한다. 환경변수는
`infrastructure/upstash/config.ts`의 `readUpstashConfig()`를 통해 읽는다. 미설정 또는
Redis 오류 시 채팅은 통과 처리되어 graceful degradation을 유지한다. consumer가 주입한
AI provider 호출 이후 `server_busy` 또는 `server_error`로 매핑되는 서버 책임 오류가
발생하면 application layer가 이미 소비된 토큰을 1회 보상한다. 사용자/쿼터 책임으로 보는
`rate_limited`와 실제 토큰 고갈(`token_exhausted`)은 보상하지 않는다.

### Redis 키 구조

| 키 패턴 | 값 타입 | 설명 |
|---|---|---|
| `chat:tokens:{hashedClientId}` | number | 클라이언트별 일일 채팅 토큰 사용량 |

### 구현 위치

```
domain/ports/
└── chatTokenStore.ts  ← ChatTokenStore 포트 (@port)

infrastructure/chat/
└── tokenStore.ts      ← Upstash 기반 구현체 (@adapter implements ChatTokenStore) + IP 해시 helper
```

---

## 3. Upstash Redis (Job 큐)

동일한 Upstash Redis 인스턴스를 Job 큐로 재사용한다. 환경변수는
`infrastructure/upstash/config.ts`의 `readUpstashConfig()`를 공유한다.

### Redis 키 구조

| 키 패턴 | 값 타입 | 설명 |
|---|---|---|
| `job:{jobId}:status` | `JobStatus` | 잡 상태 (`processing` \| `done` \| `error`) |
| `job:{jobId}:result` | `unknown` | AI 분석 결과 (JSON) |
| `job:{jobId}:error` | `string` | 실패 원인 메시지 |
| `job:{jobId}:meta` | `JobMeta` | 잡 메타데이터 (symbol, timeframe 등) |
| `job:{jobId}:cancelled` | `"1"` | 취소 플래그 (존재 여부로 판단) |

### Job 라이프사이클 함수

`infrastructure/jobs/queue.ts`는 11개의 순수 라이프사이클 함수를 제공한다:
`setJobMeta`, `getJobStatus`, `getJobResult`, `getJobError`, `getJobMeta`,
`setJobStatus`, `setJobResult`, `setJobError`, `cancelJob`, `isJobCancelled`, `cleanupJob`

### 구현 위치

`JobStateStore` 포트 인터페이스(및 인자 타입 `JobStateSetOpts`)는 `domain/ports/jobStateStore.ts`에 정의되어 있고 (`@internal`), Upstash 기반 어댑터는 `infrastructure/jobs/redis.ts`에 있다.

```
domain/ports/
└── jobStateStore.ts  ← JobStateStore (@internal), JobStateSetOpts (@internal)

infrastructure/jobs/
├── types.ts     ← JobStatus, JobMeta (DTO)
├── redis.ts     ← Upstash 기반 JobStateStore 어댑터 (createJobStateStore)
└── queue.ts     ← job 라이프사이클 함수
```

---

## 4. Worker (분석 위임 HTTP)

`submitAnalysis` 유스케이스는 무거운 LLM 분석을 외부 worker에 HTTP POST로 위임할 수 있다.
`WORKER_URL`이 설정되어 있을 때만 활성화되며, `WORKER_SECRET`은 인증 헤더로 사용된다.
환경변수 reader는 `infrastructure/market/config.ts`에 있다.

`WORKER_URL` 미설정 시 worker 위임 경로는 비활성화되고, application layer는 호출자의
캐시·로컬 처리 경로로 graceful degradation 한다.

### Request Contract (`POST /analyze`)

```
Headers:
  Content-Type: application/json
  X-Worker-Secret: {WORKER_SECRET}
  X-AI-API-KEY: {userApiKey}   ← 선택적. SubmitAnalysisOptions.userApiKey가 있을 때만 포함.
                                  user-managed 모델 호출 시 필수.

Body (JSON):
  { jobId: string, prompt: string, model: TierModel }
```

- `model`: `SubmitAnalysisOptions.modelId ?? DEFAULT_ANALYSIS_MODEL_ID`로 결정된다. worker가 라우팅 및 provider 선택에 사용한다.
- `X-AI-API-KEY`: `SubmitAnalysisOptions.userApiKey`가 설정되어 있을 때만 헤더에 포함한다. siglens(consumer) 레포는 caller 측에서 이 값을 주입한다.

---

## 5. Market Data Provider Config Reader

`infrastructure/market/config.ts`와 `infrastructure/fmp/config.ts`는 `MARKET_DATA_PROVIDER`,
`FMP_API_KEY`, `ALPACA_API_KEY`, `ALPACA_API_SECRET` (legacy alias `ALPACA_SECRET_KEY`)을
읽어 consumer가 주입할 `MarketDataProvider` 구현체에 전달할 설정 객체를 만든다.

코어 라이브러리 자체는 FMP/Alpaca의 HTTP 엔드포인트를 호출하지 않는다. 호출은 consumer가
주입한 `MarketDataProvider` 구현체에서 이뤄진다.

```typescript
// infrastructure/market/types.ts
export interface MarketDataProvider {
    fetchBars(symbol: string, timeframe: Timeframe): Promise<Bar[]>;
    fetchLatestBar(symbol: string): Promise<Bar | null>;
}
```

---

## 6. Filesystem (Skills)

외부 네트워크 서비스는 아니지만 I/O를 수반하므로 동일 규칙이 적용된다.

- 위치: 프로젝트 루트의 `/skills/**/*.md`
- 담당: `infrastructure/skills/loader.ts` (`FileSkillsLoader`)
- 파일 포맷과 frontmatter 스펙은 `docs/DOMAIN.md`의 Skills 섹션을 참조한다.

domain은 filesystem을 직접 읽지 않는다. consumer가 `FileSkillsLoader.loadSkills()`를
호출한 결과(`Skill[]`)를 domain 함수에 주입한다.

---

## 외부 호출자(Consumer)가 담당하는 부분

다음은 **`siglens-core` 내부에서 호출하지 않는다.** Consumer(siglens) 레포의 `docs/API.md`
및 `docs/AUTH.md`를 참조한다.

- AI Provider HTTP 호출 (Anthropic, Google Gemini, OpenAI 등) — `callAiProvider` 주입
- DB(Neon/PostgreSQL/Drizzle) — Auth, OAuth, Email, BYOK, Ticker, Asset translations 모두 consumer 소유
- Email dispatch (verification / password reset)
- OAuth provider 콜백 (Google/Kakao/Apple)
- 사용자 LLM API key 저장·암호화 (BYOK)
- 시세 프로바이더 HTTP 호출 (FMP, Alpaca 등) — `MarketDataProvider` 주입
