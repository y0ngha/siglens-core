# External Services

`siglens-core`가 직접 호출하는 외부 서비스 목록이다. 모든 호출은 `infrastructure/`
레이어 내부에서만 발생한다. 호출이 필요한 외부 시스템의 계약은 `domain/ports/`의 port
인터페이스로 선언하고, `infrastructure/`의 어댑터가 이를 구현한다.

코어가 직접 호출하는 외부 서비스는 다음 세 가지다.

- Upstash Redis (분석 캐시, 사용량 카운터, 채팅 토큰, 재분석 쿨다운, 생성 락)
- AI Provider SDK (Anthropic, Google Gemini, OpenAI, DeepSeek)
- 파일시스템 (Skills `.md` 파일)

시세 데이터(FMP, Alpaca 등)는 코어가 HTTP로 호출하지 않는다. 호출자(consumer)가
`domain/ports/marketDataProvider.ts`의 `MarketDataProvider` 구현체를 만들어 주입한다.

---

## 환경변수 전체 목록

`process.env`는 `infrastructure/` 안에서만 읽으며, 읽는 변수는 아래가 전부다. 각 변수는
해당 기능을 실제로 사용할 때만 읽힌다.

| 변수 | 읽는 곳 | 용도 | 필수 여부 |
|---|---|---|---|
| `UPSTASH_REDIS_REST_URL` | `infrastructure/upstash/config.ts` | Upstash Redis REST URL | 선택 — URL과 master 토큰 중 하나라도 없으면 `readUpstashConfig()`가 `null`을 반환하고 Redis 기능은 graceful degradation |
| `UPSTASH_REDIS_REST_TOKEN` | `infrastructure/upstash/config.ts` | master 토큰 (읽기/쓰기) | 선택 (위와 동일) |
| `UPSTASH_REDIS_REST_READONLY_TOKEN` | `infrastructure/upstash/config.ts` | 캐시 읽기 전용 토큰. 없으면 master 토큰으로 읽는다 | 선택 |
| `FMP_API_KEY` | `infrastructure/fmp/config.ts` | `readFmpConfig()`(미설정 시 throw) / `tryReadFmpConfig()`(미설정 시 `null`)가 읽는 FMP API 키 | 선택 — 해당 reader를 호출하는 경로에서만 필요 |
| `ANTHROPIC_API_KEY` | `infrastructure/ai/serverKeys.ts` | 서버 소유 Anthropic 키 | 서버 키로 해당 provider 모델을 호출할 때만 필수 |
| `GEMINI_API_KEY` | `infrastructure/ai/serverKeys.ts` | 서버 소유 Google Gemini 키 | 서버 키로 해당 provider 모델을 호출할 때만 필수 |
| `OPENAI_API_KEY` | `infrastructure/ai/serverKeys.ts` | 서버 소유 OpenAI 키 | 서버 키로 해당 provider 모델을 호출할 때만 필수 |
| `DEEPSEEK_API_KEY` | `infrastructure/ai/serverKeys.ts` | 서버 소유 DeepSeek 키 | 서버 키로 해당 provider 모델을 호출할 때만 필수 |

`domain/`과 `application/`은 환경에 의존하지 않는다. consumer 프로젝트는 자신의 환경에
위 값을 설정해 주입한다. `siglens-core` 레포의 테스트는 더미 값을 사용하며 실제 외부
호출을 하지 않는다.

---

## 1. AI Provider

구체 SDK 어댑터는 `infrastructure/ai/providers/`에 있다.

| 파일 | Provider | 진입 함수 |
|---|---|---|
| `anthropic.ts` | Anthropic (`@anthropic-ai/sdk`) | `callClaude` |
| `gemini.ts` | Google Gemini (`@google/genai`) | `callGemini` |
| `openai.ts` | OpenAI (`openai`) | `callChatGPT` |
| `deepseek.ts` | DeepSeek (OpenAI 호환 API, `openai` SDK) | `callDeepSeek` |

각 provider는 `infrastructure/ai/retry/`의 `withRetry` 래퍼를 거쳐 호출되고,
`infrastructure/ai/usage.ts`가 응답의 토큰 사용량을 정규화해 로그로 남긴다.
`infrastructure/ai/extractJsonWithRepair.ts` / `normalizeJsonResponse.ts`는 LLM 응답
JSON을 복구·정규화한다.

### API key 처리

- **서버 키**: 서버 키로 호출하는 모델에서는 `resolveServerApiKey(provider)`가 위 표의
  환경변수를 읽는다. 값이 없으면 `"<ENV_NAME> environment variable is required"`로
  throw하며, 검증은 import 시점이 아니라 **호출 시점**에 이뤄진다. 따라서 어떤 provider도
  호출하지 않는 consumer는 해당 키가 없어도 된다.
- **BYOK(사용자 키)**: 사용자 키는 코어가 저장하지 않는다. 호출자가 요청 옵션으로 전달하며,
  BYOK 경로에서는 `resolveServerApiKey`가 호출되지 않는다. 키를 서버 키로 쓸지 사용자
  키로 쓸지는 `domain/keyRouting.ts`의 `shouldUseServerKey(model, tier)` /
  `isByokOnly`가 결정한다.
- 사용자 키의 저장·암호화·검증은 consumer 책임이다.

### 채팅 completion의 주입 지점

`application/chat/requestChatCompletion.ts`의 `requestChatCompletion`은 provider를 직접
호출하지 않고 `RequestChatCompletionDependencies.callAiProvider`(`domain/ports/aiProvider.ts`의
`CallAiProvider` port)로 호출자가 주입한 구현체를 호출한다. 분석·브리핑 등 `run*` 유스케이스는
위 provider 어댑터를 `application/analysis/callAnalysisAi.ts`에서 직접 호출한다.

---

## 2. Upstash Redis

공식 문서: https://upstash.com/docs/redis/features/restapi

`@upstash/redis` 클라이언트를 사용하며, 연결 설정은 `infrastructure/upstash/config.ts`의
`readUpstashConfig()`가 위 환경변수에서 만든다. 환경변수가 설정되지 않았거나 Redis 호출이
실패하면 각 어댑터는 아래 "구현 위치"에 적힌 방식으로 graceful degradation 한다.

`@upstash/redis`는 optional peer dependency다(INF-11). 어댑터는 클라이언트를
`infrastructure/upstash/client.ts`의 `lazyRedisClient`로 받고, 패키지는 env가 설정된 상태에서
첫 작업을 할 때 로드된다. 만들어진 클라이언트만 기억하고, 실패(패키지 누락, 생성자의 URL 거부, 일시적
로드 오류)는 `loadOptionalSdk`와 같이 다음 작업에서 다시 시도한다 — 일시적 오류가 재시작 전까지
기능을 끄지 않게 한다. 실패는 같은 URL·오류당 5분에 한 번 `[upstash] Redis client unavailable` 오류
로그로 남는다(토큰은 남기지 않는다). 각 어댑터는 Redis 장애와 같은 경로로 처리한다(캐시는 `MissingSdkError`를 던지고, 토큰·쿨다운은 통과시키고,
`failurePolicy: 'closed'` 카운터는 `CounterStoreUnavailableError`를 던진다).

### 2.1 분석 결과 캐시

`createCacheProvider()`(`infrastructure/cache/redis.ts`)는 `CacheProvider` port
(`domain/ports/cache.ts`)를 구현한다. 환경변수가 없으면 `null`을 반환하며, 호출자는 이를
캐시 미스로 처리한다. 읽기는 readonly 토큰이 있으면 그것으로, 쓰기·삭제는 master 토큰으로
수행한다. 이 어댑터는 `get` / `set(ttl)` / `delete`와 더불어 `SET NX EX`를 쓰는
`setIfAbsent`, Lua compare-and-delete를 쓰는 `deleteIfEquals`를 제공한다.

캐시 키와 TTL은 `infrastructure/cache/config.ts`에서 정의한다. 주요 키 패턴은 다음과 같다
(전체 목록과 선택적 suffix는 해당 파일의 빌더 함수와 JSDoc이 기준이다).

| 키 패턴 | 설명 |
|---|---|
| `analysis:{symbol}:{timeframe}:{modelId}:{promptVersion}[:…]` | 종목·타임프레임별 기술적 분석 결과. 이유 표시·포지션·언어 등에 따른 suffix가 붙을 수 있다 |
| `analysis:peek:{symbol}:{timeframe}:{modelId}:{promptVersion}:{tier}[:…]` | 분석 캐시 조회(peek)용 키 |
| `briefing:market:{dateHour}:{model}:{inputHash}:{promptVersion}` | 시장 브리핑 (시간 단위 버킷) |
| `briefing:macro:{dateBucket}:{model}:{inputHash}:{promptVersion}` | 거시(macro) 브리핑 |
| `v1:analysis:{kind}:…` | 펀더멘털·재무제표·의회 거래·수급·시장 뉴스·경제 이벤트 등 기타 분석 (`CACHE_KEY_SCHEMA_VERSION` 접두) |

TTL은 용도별로 `config.ts`에 상수로 정의된다. 종목 분석은 `ANALYSIS_CACHE_TTL`이
타임프레임별 상한(5분봉 5분 … 일봉 1일)을 정하고, `computeBarsEffectiveTtl`이 일일 만료
경계를 반영해 실제 TTL을 계산한다. 시장 브리핑은 `MARKET_BRIEFING_CACHE_TTL`(1시간)이다.

### 2.2 생성 락 (in-flight de-duplication)

동일 캐시 키에 대한 LLM 호출이 동시에 여러 번 일어나지 않도록
`application/analysis/generationLock.ts`의 `dedupeGeneration`이 프로세스 내 합류
(`inFlight.ts`)와 Redis 락을 함께 사용한다. 락 승자만 모델을 호출하고, 나머지는 승자가
게시한 raw 출력을 기다린 뒤 사용한다. 캐시가 `setIfAbsent`를 지원하지 않으면 프로세스 내
합류만 적용되고, 락 획득 중 Redis 오류가 나면 락 없이 생성을 진행한다(fail-open).

| 키 패턴 | 설명 |
|---|---|
| `v1:lock:generation:{cacheKey}` | 생성 락 (TTL 5분, 승자가 게시 후 — 실패해도 — compare-and-delete로 해제) |
| `v1:generation:raw:{cacheKey}:{token}` | 승자가 대기 중인 peer에게 공유하는 raw LLM 출력 (TTL 2분) |

### 2.3 채팅 토큰 제한

`createChatTokenStore()`(`infrastructure/chat/tokenStore.ts`)는 `ChatTokenStore` port
(`domain/ports/chatTokenStore.ts`)를 구현한다. 클라이언트 IP를 `hashClientIp`로 SHA-256
해시한 값을 키에 사용하며, 일일 한도는 `CHAT_TOKEN_LIMIT`(현재 5), 키 TTL은 1일이다
(`INCR` + `EXPIRE NX`).

| 키 패턴 | 값 타입 | 설명 |
|---|---|---|
| `chat:tokens:{hashedClientId}` | number | 클라이언트별 일일 채팅 토큰 사용량 |

Upstash 환경변수가 없거나 Redis 오류가 나면 채팅은 통과 처리된다(fail-open).
`requestChatCompletion`은 주입된 provider 호출이 서버 책임 오류로 실패하면 이미 소비한
토큰을 1회 환불한다(`shouldRefundConsumedToken`).

### 2.4 기간 카운터

`createCounterStore({ prefix, period, failurePolicy })`(`infrastructure/usage/counterStore.ts`)는
`CounterStore` port(`domain/ports/counterStore.ts`)를 구현하는 일/월 단위 카운터다.

- 키: `{prefix}:{subject}:{bucket}` (bucket은 UTC 기준 `YYYY-MM-DD` 또는 `YYYY-MM`)
- `INCR` + `EXPIRE NX`로 소비하고, 한도 초과 시 즉시 `DECR`하여 음수로 흐르지 않게 한다.
- `failurePolicy: 'open'`은 장애 시 통과시키고, `'closed'`는
  `CounterStoreUnavailableError`를 던져 호출자가 쿼터 소진과 구분해 처리할 수 있게 한다.

### 2.5 재분석 쿨다운

`infrastructure/market/reanalyzeCooldown.ts`의 헬퍼(`tryAcquireReanalyzeCooldown`,
`releaseReanalyzeCooldown`, `getReanalyzeCooldownMs`)는 종목·타임프레임별 5분 쿨다운을
Redis `SET key NX EX 300`으로 관리한다. 이 헬퍼는 consumer가 필요할 때 호출하는 도구이며,
`run*` 유스케이스가 자동으로 적용하지는 않는다. Upstash 환경변수가 없거나 Redis 호출이
실패하면 쿨다운은 통과(`{ ok: true }`)로 처리된다 — UX 보호 장치이지 보안 경계가 아니다.

| 키 패턴 | 설명 |
|---|---|
| `analysis:cooldown:{symbol}:{timeframe}` | 재분석 쿨다운 락 |

### 구현 위치

```
domain/ports/
├── cache.ts            ← CacheProvider
├── chatTokenStore.ts   ← ChatTokenStore
└── counterStore.ts     ← CounterStore, CounterStoreUnavailableError

infrastructure/upstash/config.ts     ← readUpstashConfig (env reader)
infrastructure/upstash/client.ts     ← lazyRedisClient (@upstash/redis 지연 로드)
infrastructure/optionalPeer/         ← loadOptionalSdk, MissingSdkError (optional peer 공용 로더)
infrastructure/cache/                ← types.ts, config.ts (키·TTL), redis.ts (CacheProvider 어댑터)
infrastructure/chat/tokenStore.ts    ← ChatTokenStore 어댑터 + hashClientIp
infrastructure/usage/counterStore.ts ← CounterStore 어댑터
infrastructure/usage/hash.ts         ← hashUsageIp (일 단위 IP 해시)
infrastructure/market/reanalyzeCooldown.ts ← 재분석 쿨다운 헬퍼
application/analysis/generationLock.ts     ← dedupeGeneration (생성 락 오케스트레이션)
```

`CacheProvider`를 in-memory stub으로 대체하면 단위 테스트에서 외부 호출 없이 검증할 수 있다.

---

## 3. FMP Config Reader

`infrastructure/fmp/config.ts`는 `FMP_API_KEY`를 읽어 FMP 기반 `MarketDataProvider`
구현체에 전달할 설정 객체(`{ apiKey }`)를 만든다.

- `readFmpConfig()` — API 키 미설정 시 throw. 반드시 FMP가 필요한 경로에서 사용.
- `tryReadFmpConfig()` — API 키 미설정 시 `null` 반환. 선택적 경로에서 사용.

코어 라이브러리 자체는 FMP/Alpaca 등의 HTTP 엔드포인트를 호출하지 않는다. 시세 조회는
consumer가 주입한 `MarketDataProvider` 구현체에서 이뤄진다.

```typescript
// domain/ports/marketDataProvider.ts
export interface MarketDataProvider {
    getBars(options: GetBarsOptions): Promise<Bar[]>;
    getQuote(symbol: string): Promise<MarketQuote | null>;
}
```

---

## 4. Filesystem (Skills)

외부 네트워크 서비스는 아니지만 I/O를 수반하므로 동일 규칙이 적용된다.

- 위치: 프로세스 working directory 아래의 `skills/**/*.md` (코드 상 `join(process.cwd(), 'skills')`).
  skill 파일 자체는 consumer가 제공한다.
- 담당: `infrastructure/skills/loader.ts` (`createSkillsProvider`, `FileSkillsLoader`,
  `loadSkillsCached`)
- 파일 포맷과 frontmatter 스펙은 `docs/DOMAIN.md`의 Skills 섹션을 참조한다.

domain은 filesystem을 직접 읽지 않는다. `run*` 유스케이스(예: `runAnalysis`)가
`loadSkillsCached()`로 skill을 읽어 `Skill[]`을 domain 함수(프롬프트 빌더 등)에 주입한다.
`createSkillsProvider()` / `FileSkillsLoader`는 `SkillsProvider` port(`domain/ports/skillsProvider.ts`)의
어댑터이며 패키지 public entry(`src/index.ts`)에서는 export하지 않는다.

---

## 코어가 소유하지 않는 부분 (Consumer 책임)

다음은 `siglens-core` 내부에서 구현하거나 호출하지 않는다.

- DB (사용자·세션·티어 저장소 등) — `UsageRepository`, `UsageLogRepository`,
  `UserTierRepository` 같은 port만 정의하며 구현은 consumer 소유
- 사용자 LLM API key(BYOK) 저장·암호화
- 인증, OAuth 플로우, 이메일 발송
- 시세 프로바이더 HTTP 호출 (FMP, Alpaca 등) — `MarketDataProvider` 주입
- 뉴스·재무·옵션·의회 거래·수급 등 외부 데이터 조회 — `domain/ports/`의 해당 provider port 주입
