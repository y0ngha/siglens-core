# External Services

`siglens-core`가 직접 호출하는 외부 서비스 목록이다. 모든 호출은 `infrastructure/`
레이어 내부에서만 발생하며, 각 서비스는 `types.ts`의 인터페이스를 통해 추상화된다.

호출자(consumer)가 직접 사용하는 외부 API(FMP, Alpaca 등 시세 프로바이더)는
`siglens-core`의 범위가 아니다. 시세 프로바이더가 필요하면 consumer가 구현한 뒤
`infrastructure/market/`의 `MarketDataProvider` 인터페이스에 주입한다.

---

## 환경변수 전체 목록

```bash
# AI Provider (필수)
AI_PROVIDER=claude                  # claude | gemini (기본값: claude)
ANTHROPIC_API_KEY=                  # AI_PROVIDER=claude 시 필수
GEMINI_API_KEY=                     # AI_PROVIDER=gemini 시 필수
GEMINI_CHAT_FREE_API_KEY=           # 선택 — 채팅 Gemini free-tier key fallback용

# Upstash Redis (선택 — 미설정 시 캐시 없이 동작)
UPSTASH_REDIS_REST_URL=             # Upstash Redis REST URL
UPSTASH_REDIS_REST_TOKEN=           # master 토큰 (읽기/쓰기)
UPSTASH_REDIS_REST_READONLY_TOKEN=  # readonly 토큰 (없으면 master 사용)

# Market Data Provider (선택 — 기본값 fmp)
MARKET_DATA_PROVIDER=fmp            # fmp | alpaca
FMP_API_KEY=                        # MARKET_DATA_PROVIDER=fmp 시 필수
ALPACA_API_KEY=                     # MARKET_DATA_PROVIDER=alpaca 시 필수
ALPACA_API_SECRET=                  # MARKET_DATA_PROVIDER=alpaca 시 필수

# Worker (선택 — submitAnalysis 시 외부 worker에 위임할 때만)
WORKER_URL=                         # worker 엔드포인트 URL
WORKER_SECRET=                      # worker 인증 시크릿

# Neon / PostgreSQL (선택 — DB 레이어가 필요한 호출자에만)
DATABASE_URL=                       # postgres://user:pass@host/db?sslmode=require
```

환경변수는 **infrastructure 레이어 내부에서만 읽는다.** domain은 환경에 의존하지 않는다.
소비 프로젝트는 자신의 `.env`에 위 값을 설정해 주입한다. `siglens-core` 레파지토리의
테스트 실행 시에는 더미 값을 사용하며 실제 외부 호출을 하지 않는다.

---

## 1. AI Providers

### Claude (Anthropic)

공식 문서: https://docs.anthropic.com/en/api

```
Base URL: https://api.anthropic.com
Endpoint: POST /v1/messages
```

**인증**
```
Header: x-api-key: {ANTHROPIC_API_KEY}
Header: anthropic-version: 2023-06-01
```

**Request 요약**

| 필드 | 타입 | 설명 |
|---|---|---|
| model | string | 모델 ID (예: `claude-opus-4-7`, `claude-sonnet-4-6`) |
| max_tokens | number | 응답 토큰 상한 |
| messages | array | `{ role, content }` 배열 |
| system | string | 시스템 프롬프트 (옵션) |

**구현 위치**: `infrastructure/ai/claude.ts`

### Gemini (Google)

공식 문서: https://ai.google.dev/api

```
Base URL: https://generativelanguage.googleapis.com/v1beta
Endpoint: POST /models/{model}:generateContent
```

**인증**
```
Query parameter: key={GEMINI_API_KEY}
```

**구현 위치**: `infrastructure/ai/gemini.ts`

채팅 completion use-case(`application/chat/requestChatCompletion.ts`)는
consumer가 전달한 `paidApiKey`와 선택적 `freeApiKey`를
`callGeminiWithKeyFallback()`에 주입한다. Next.js 같은 consumer는 자신의
런타임에서 `GEMINI_API_KEY`와 `GEMINI_CHAT_FREE_API_KEY`를 읽고,
`siglens-core`에는 문자열 config만 전달한다.

### AI Provider 선택

```bash
# AI_PROVIDER 환경변수로 provider 선택
# 미설정 또는 unknown 값이면 기본값 claude 사용
AI_PROVIDER=claude   # claude | gemini
```

`createAiProvider()` 팩토리 함수가 환경변수를 읽어 적절한 Provider 인스턴스를 반환한다.
반환 타입은 `infrastructure/ai/types.ts`의 `AiProvider` 인터페이스로 통일되어 있으며,
도메인 호출자는 구체 프로바이더를 인지하지 않는다.

---

## 2. Upstash Redis (분석 결과 캐시)

공식 문서: https://upstash.com/docs/redis/features/restapi

```
Base URL: {UPSTASH_REDIS_REST_URL}
```

### 인증

```
Header: Authorization: Bearer {UPSTASH_REDIS_REST_TOKEN}
```

읽기 전용 작업에는 `UPSTASH_REDIS_REST_READONLY_TOKEN`을 사용하고,
미설정 시 master 토큰으로 fallback한다.

### 사용 패턴

AI 분석 결과는 심볼·타임프레임별 TTL로 캐싱한다.

- 캐시 키 예시: `analysis:{symbol}:{timeframe}` (예: `analysis:AAPL:1Day`)
- TTL은 타임프레임에 따라 결정한다 (`infrastructure/cache/config.ts`에서 정의)
- 환경변수 미설정 시 캐시 없이 정상 동작(graceful degradation)

### 구현 위치

```
infrastructure/cache/
├── types.ts     ← CacheProvider 인터페이스
├── config.ts    ← 캐시 키 / TTL 상수
└── redis.ts     ← Upstash 구현체
```

`CacheProvider`를 in-memory stub으로 대체하면 단위 테스트에서 외부 호출 없이 검증할 수 있다.

---

## 2-1. Upstash Redis (채팅 토큰 제한)

동일한 Upstash Redis 인스턴스를 채팅 토큰 제한에도 사용한다.
환경변수는 `infrastructure/upstash/config.ts`의 `readUpstashConfig()`를 통해 읽는다.
미설정 또는 Redis 오류 시 채팅은 통과 처리되어 graceful degradation을 유지한다.
Gemini 호출 이후 `server_busy` 또는 `server_error`로 매핑되는 서버 책임 오류가
발생하면 application layer가 이미 소비된 토큰을 1회 보상한다. 사용자/쿼터 책임으로
보는 `rate_limited`와 실제 토큰 고갈(`token_exhausted`)은 보상하지 않는다.

### Redis 키 구조

| 키 패턴 | 값 타입 | 설명 |
|---|---|---|
| `chat:tokens:{hashedClientId}` | number | 클라이언트별 일일 채팅 토큰 사용량 |

### 구현 위치

```
infrastructure/chat/
├── types.ts       ← ChatTokenStore 인터페이스
└── tokenStore.ts  ← Upstash 기반 구현체 + IP 해시 helper
```

---

## 3. Upstash Redis (Job 큐)

동일한 Upstash Redis 인스턴스를 Job 큐로 재사용한다.
환경변수는 `infrastructure/cache/config.ts`의 `readUpstashConfig()`를 통해 읽는다.

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

```
infrastructure/jobs/
├── types.ts     ← JobStatus, JobMeta, JobRedisClient 인터페이스
├── redis.ts     ← Upstash 기반 JobRedisClient 구현체
└── queue.ts     ← 8개 job 라이프사이클 함수
```

### 환경변수

Job 큐는 `infrastructure/cache/config.ts`의 Upstash 환경변수를 공유한다.
별도 환경변수 불필요.

---

## 4. Neon / PostgreSQL

공식 문서: https://neon.tech/docs

```
Connection string: postgres://{user}:{password}@{host}/{db}?sslmode=require
```

### 인증

`DATABASE_URL` 환경변수에 connection string을 주입한다.
Neon 이외의 Postgres (로컬, RDS 등)도 동일 인터페이스로 사용 가능하다.

### 사용 패턴

- **지속 저장이 필요한 데이터**에만 사용한다 (분석 이력, 사용자 메타데이터 등).
- 단순 캐시 용도는 Redis를 사용한다 (PostgreSQL ≠ 캐시).
- 연결은 라이브러리 모듈 레벨에서 재사용한다. 호출 단위 connection 생성을 피한다.
- 쿼리는 Drizzle ORM을 통해 실행하고, 문자열 연결로 SQL을 조립하지 않는다.

### 구현 위치

```
infrastructure/db/
├── types.ts     ← DB config/client 타입과 enum literal 타입
├── config.ts    ← DATABASE_URL 환경변수 reader
├── schema.ts    ← Drizzle 테이블/enum 스키마
├── client.ts    ← Neon serverless + Drizzle 클라이언트 초기화
└── index.ts     ← DB 모듈 re-export
```

인터페이스를 먼저 정의하고 구현체가 이를 만족하도록 한다. 테스트는 Neon/Drizzle 패키지를
mock 처리해 실제 데이터베이스에 접속하지 않는다.

### Drizzle 마이그레이션

```bash
yarn db:generate  # schema.ts → drizzle/ 마이그레이션 생성
yarn db:migrate   # DATABASE_URL 대상 DB에 마이그레이션 적용
```

`drizzle.config.ts`는 `DATABASE_URL`, `src/infrastructure/db/schema.ts`, `drizzle/`
출력 경로를 사용한다.

### 테이블

| 테이블 | 목적 |
|---|---|
| `users` | 사용자 메타데이터, 이메일 로그인용 비밀번호 해시, 구독 tier (`free` / `member` / `pro`) |
| `sessions` | 사용자 세션과 만료 시각 |
| `usage_logs` | 비로그인/로그인 사용량 집계 (`analysis` / `chatbot` / `premium_model`) |
| `oauth_accounts` | Google/Kakao/Apple OAuth 계정 연결 |
| `korean_tickers` | 한국어 티커 이름 매핑 |
| `asset_translations` | FMP 심볼 기반 자산명 번역 캐시 |

### 인증

`application/auth`는 이메일 회원가입·로그인·로그아웃 및 OAuth 로그인
유스케이스를 제공한다.

- `registerUser`는 `UserRepository`와 `PasswordHasher`를 주입받아 이메일 중복 확인, 비밀번호 해시 생성, 사용자 생성을 수행한다.
- `loginUser`는 `EmailAuthUserRepository`, `PasswordVerifier`, `SessionRepository`를 주입받아 자격증명을 검증하고 `sessions.id`를 세션 토큰으로 사용한다.
- `socialLoginUser`는 `OAuthUserRepository`와 `SessionRepository`를 주입받아 Google/Kakao/Apple provider 계정 링크를 조회하고, 첫 로그인 시 `users`와 `oauth_accounts`를 생성한 뒤 동일한 세션 쿠키 메커니즘을 사용한다.
- OAuth 이메일이 이미 이메일/비밀번호 계정으로 등록되어 있으면 자동 링크하지 않고 `email_already_exists` 충돌을 반환한다. 명시적 계정 연결 UI와 콜백 라우트는 consumer가 담당한다.
- `logoutUser`는 `SessionRepository.deleteSession()`으로 세션을 무효화하고 브라우저 쿠키 제거용 만료 쿠키 메타데이터를 반환한다.
- HTTP 응답 객체나 프레임워크 쿠키 API는 consumer가 담당한다. `siglens-core`는 HTTP-only 쿠키 메타데이터만 반환한다.

### 사용자 티어

`application/tier`는 사용자 등급 조회, 요청 컨텍스트 구성, 관리자 등급 변경 유스케이스를
제공한다.

- `getUserTier`는 `UserTierRepository.getUserTier()`로 `users.tier`를 조회하고, 대상 사용자가 없으면 `free`로 fallback한다.
- `createUserTierContext`는 consumer의 미들웨어/서버 핸들러가 인증된 `userId`를 전달하면 `{ userId, tier }` 요청 컨텍스트를 반환한다. 익명 요청은 repository 접근 없이 `free`가 된다.
- `setUserTier`는 관리자 화면 또는 운영 도구에서 `users.tier`를 수동 변경할 때 사용한다. 대상 사용자가 없으면 `user_not_found` 결과를 반환한다.

---

## 4. Filesystem (Skills)

외부 네트워크 서비스는 아니지만 I/O를 수반하므로 동일 규칙이 적용된다.

- 위치: 프로젝트 루트의 `/skills/**/*.md`
- 담당: `infrastructure/skills/loader.ts` (`FileSkillsLoader`)
- 파일 포맷과 frontmatter 스펙은 `docs/DOMAIN.md`의 Skills 섹션을 참조한다.

domain은 filesystem을 직접 읽지 않는다. consumer가 `FileSkillsLoader.loadSkills()`를
호출한 결과(`Skill[]`)를 domain 함수에 주입한다.

---

## 외부 호출자(Consumer)가 담당하는 부분

다음 외부 API는 **`siglens-core` 내부에서 호출하지 않는다.** 필요 시 consumer가
구현하여 `MarketDataProvider` 인터페이스로 주입한다.

- FMP (Financial Modeling Prep)
- Alpaca Market Data
- 기타 시세 프로바이더

`infrastructure/market/types.ts`에 `MarketDataProvider` 인터페이스가 정의되어 있으며,
라이브러리 자체는 인터페이스 구현 유무에 의존하지 않는다.

```typescript
// infrastructure/market/types.ts
export interface MarketDataProvider {
    fetchBars(symbol: string, timeframe: Timeframe): Promise<Bar[]>;
    fetchLatestBar(symbol: string): Promise<Bar | null>;
}
```
