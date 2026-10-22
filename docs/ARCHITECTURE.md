# Architecture

## 개요

Layered Architecture를 기반으로 한다.
`siglens-core`는 **순수 TypeScript 라이브러리**이며, 도메인 계산 로직과 외부 I/O 래퍼만 포함한다.
UI, 렌더링, 프레임워크 종속 코드는 이 레파지토리에 존재하지 않는다.

---

## 레이어 구조

```
┌─────────────────────────────────────────┐
│         application (오케스트레이션)     │  domain과 infrastructure를 조합하는
│           market/, chat/, …            │  use-case 단위 함수 (run*)
├─────────────────────────────────────────┤
│          infrastructure (외부)          │  AI Provider SDK 어댑터,
│                                         │  Skills Loader, Upstash Redis
├─────────────────────────────────────────┤
│             domain (순수)              │  인디케이터, 캔들 패턴,
│                                         │  차트 패턴, 분석 프롬프트
└─────────────────────────────────────────┘
                    │
                    ▼
              src/index.ts
         (public entry of the package)
```

라이브러리 consumer(Next.js 앱, 백그라운드 프로세스, CLI 등)는 `src/index.ts`에서 재노출되는
심볼만 사용한다. Consumer의 프레젠테이션/런타임 코드는 이 레파지토리에 포함되지 않는다.

---

## 의존성 방향 규칙

```
domain         ← 외부 import 없음
                 순수 TypeScript 함수만 허용
                 technicalindicators 라이브러리도 금지
                 (계산 로직을 직접 구현)
                 Date.now(), fetch, console.*, process.env 전부 금지
                 추상 Repository / 외부 의존성 port 인터페이스 노출 담당 (ports/)
                 — 실제 어댑터는 infrastructure(캐시, AI provider 등) 또는
                   consumer(DB, 시세·뉴스 데이터 등)가 소유

infrastructure ← domain import 가능
                 application import 금지 (ESLint 강제)
                 외부 API (AI 프로바이더 SDK 등) 호출 담당 (ai/providers/)
                 Skills 파일 I/O 담당
                 Upstash Redis 캐시·카운터·쿨다운 관리 담당
                 인터페이스(types.ts)를 반드시 먼저 정의

application    ← domain, infrastructure import 가능
                 여러 infrastructure 모듈을 조합해 use-case를 완성
                 domain, infrastructure에서 application import 금지 (ESLint 강제)
                 모델을 프로세스 안에서 직접 호출하는 run* 함수로 구성한다
                 (job 큐나 외부 worker 없음). in-flight 중복 생성은
                 Redis 락(application/analysis/generationLock.ts)으로 막는다.
                 현재: market/ (runAnalysis, runBriefing, peek*Cache),
                       news/, overall/, congress/, investorFlows/,
                       fundamental/, financials/, options/, economy/,
                       analysis/ (공용 AI 호출·락), byok/, usage/, chat/
                       (requestChatCompletion), agent/ (runAgentTurn),
                       dashboard/, shared/

src/index.ts   ← domain, infrastructure, application에서 노출할 심볼을 재-export
                 외부 consumer가 유일하게 참조하는 진입점
```

**위반 예시 (절대 금지)**
```typescript
// ❌ domain에서 외부 라이브러리 import
// src/domain/indicators/rsi.ts
import { RSI } from 'technicalindicators'; // 금지

// ❌ domain에서 infrastructure import
// src/domain/analysis/prompt.ts
import { claudeClient } from '@/infrastructure/ai/claude'; // 금지

// ❌ domain에서 side effect 사용
// src/domain/indicators/rsi.ts
const now = Date.now();         // 금지
console.log(closes);            // 금지
const key = process.env.API_KEY; // 금지
```

**타입 배치 규칙**

```
인디케이터 결과 타입(MACDResult, BollingerResult 등) → domain/types.ts
  ❌ 인디케이터 구현 파일(rsi.ts 등)에 정의 금지
  ✅ domain/types.ts에 정의 후 import하여 사용

타입/스키마는 소속 레이어에서 정의
  ❌ infrastructure 전용 필드를 domain 타입에 정의
  ✅ Record<keyof Interface, ...>로 컴파일 타임 동기화 강제
```

**순환 의존성 금지**

```
모듈 간 순환 import 금지 (A → B → A)
  → 공유 상수/타입은 제3 파일로 분리하여 순환 해소
  ❌ module-a.ts imports module-b.ts, module-b.ts imports module-a.ts
  ✅ shared.ts에 공유 요소 분리 후 양쪽에서 import
```

---

## 폴더 구조

```
# 최상위 디렉토리 (node_modules, dist 제외)
.
├── docs
├── scripts
└── src
    ├── __tests__          # 테스트 (소스 구조를 미러링) + guards, fixtures, helpers
    ├── application
    │   ├── agent
    │   ├── analysis       # 공용 AI 호출, in-flight / 생성 락
    │   ├── byok
    │   ├── chat
    │   ├── congress
    │   ├── dashboard
    │   ├── economy
    │   ├── financials
    │   ├── fundamental
    │   ├── investorFlows
    │   ├── market
    │   ├── news
    │   ├── options
    │   ├── overall
    │   ├── shared
    │   └── usage
    ├── domain
    │   ├── agent
    │   ├── analysis
    │   ├── chat
    │   ├── constants
    │   ├── economy
    │   ├── indicators
    │   ├── investorFlows
    │   ├── llm
    │   ├── options
    │   ├── overlays
    │   ├── patterns
    │   ├── ports          # Port interfaces (CacheProvider, CallAiProvider, MarketDataProvider, repositories, …)
    │   ├── signals
    │   └── validation
    ├── infrastructure
    │   ├── ai            # AI provider SDK 어댑터(providers/), retry/, 서버 키 reader, 응답 JSON 복구, 사용량 로깅
    │   ├── cache         # Upstash 캐시 어댑터, 캐시 키·TTL
    │   ├── chat          # 채팅 토큰 저장소 (Upstash)
    │   ├── fmp           # FMP 환경변수 reader
    │   ├── hash          # 분석 입력 해시 helper
    │   ├── market        # 재분석 쿨다운 (Upstash)
    │   ├── skills        # Skills 파일 로더
    │   ├── upstash       # Upstash 환경변수 reader
    │   └── usage         # hashUsageIp, 기간 카운터 createCounterStore
    ├── index.ts           # 서버 entry
    └── index.client.ts    # 브라우저 entry (순수 서브셋)
```

### src/index.ts

라이브러리의 **유일한 public entry**. `domain/`, `infrastructure/`, `application/`에서
외부 consumer에게 노출할 심볼을 Tier 단위로 그룹화하여 재-export한다.

```typescript
// src/index.ts (Tier별 그룹화 구조, 발췌)
// === Tier 1: Application Entrypoints ===
export { runAnalysis } from './application/market/runAnalysis';
export { runBriefing } from './application/market/runBriefing';
export { runAgentTurn } from './application/agent/runAgentTurn';

// === Tier 2: Domain Building Blocks ===
export { classifyTrend, detectSignals } from './domain/signals';
export { calculateIndicators /* ... */ } from './domain/indicators';

// === Tier 3: Infrastructure Factories & Config ===
export { createCacheProvider } from './infrastructure/cache/redis';
export { createCounterStore } from './infrastructure/usage/counterStore';

// === Tier 4: Public Types & Constants ===
export type { Bar, Timeframe, IndicatorResult /* ... */ } from './domain/types';
```

Consumer는 `@y0ngha/siglens-core`에서 이 심볼만 import한다.
Deep import(`@y0ngha/siglens-core/src/domain/...` 또는 `@y0ngha/siglens-core/dist/...`)는 지원하지 않는다.

개별 지표 계산기(`calculateRSI` 등), 개별 신호 감지기(`detectRsiOversold` 등),
정규화 헬퍼(`asString` 등)는 internal로 분류되어 `src/index.ts`에서 export하지 않는다.
자세한 분류 기준과 인벤토리는 [`docs/PUBLIC_API.md`](./PUBLIC_API.md) 참고.

### Public API Boundary (Tiers)

Layer 의존 규칙(`domain → infrastructure → application`)과 **직교하는** 또 다른 축으로
Public API 노출 정책이 있다. 한 layer 내에도 public과 internal이 공존한다.

- **Tier 1**: `application/` 진입점 (예: `runAnalysis`, `getMarketSummary`)
- **Tier 2**: `domain/` high-level 함수 (예: `calculateIndicators`, `detectSignals`)
- **Tier 3**: `infrastructure/` factory & config (예: `createCacheProvider`, `createCounterStore`)
- **Tier 4**: 모든 public 타입/인터페이스/상수
- **Internal**: 다른 public 함수의 보조 구현. `src/index.ts`에서 export하지 않으며 정의부에 `/** @internal */` 태그를 단다.

Tier 정의, 함수별 분류, 새 함수 추가 시 결정 워크플로우, semver 정책은
[`docs/PUBLIC_API.md`](./PUBLIC_API.md)에서 관리한다.

### domain/signals/

Pure-function signal detectors. Follows the same rules as `domain/indicators/`:
no external imports, pure functions only.

### domain/ports/

추상 port 인터페이스 모음. 도메인이 의존하는 외부 시스템(캐시, DB, 시세·뉴스 데이터 등)의
계약만 선언하며, 실제 어댑터 구현은 `infrastructure/`(캐시, 카운터, 채팅 토큰, skills) 또는
consumer(DB 저장소, 시세·뉴스·재무 등 데이터 provider)가 소유한다. 의존성 역전(DIP)을 통해
도메인 계층이 외부 인프라에 결합되지 않도록 보장한다.

- `cache.ts` — `CacheProvider` 인터페이스 (TTL 기반 key-value 캐시 계약).
- `usageRepository.ts` — `UsageRepository` 인터페이스, `RecordUsageInput`.
- `usageLogRepository.ts` — `UsageLogRepository` 인터페이스, `CreateUsageLogInput`.
- `userTierRepository.ts` — `UserTierRepository` 인터페이스, `UserTier` alias.
- `aiProvider.ts` — `CallAiProvider` (채팅 completion용 provider-neutral 호출 시그니처).
- `agentProvider.ts` — `CallAgentProvider` (에이전트 툴 콜링 스트리밍).
- `chatTokenStore.ts` — `ChatTokenStore`.
- `counterStore.ts` — `CounterStore`, `CounterStoreUnavailableError`.
- `skillsProvider.ts` — `SkillsProvider`.
- `marketDataProvider.ts`, `newsProvider.ts`, `fundamentalDataProvider.ts`,
  `financialStatementsProvider.ts`, `optionsDataProvider.ts`, `congressTradesProvider.ts`,
  `investorFlowsDataProvider.ts` — consumer가 구현해 주입하는 데이터 provider port.

공유되는 도메인 값 타입(`UsageActionType`, `UsageCounts`, `UsageLogRecord` 등)은 `domain/types.ts`에서
정의되어 port 파일들 간 순환 import를 방지한다.

### infrastructure/

외부 시스템과의 경계를 담당한다. 각 서브디렉토리는 **하나의 외부 시스템**에만 대응하며,
`types.ts`에 정의된 인터페이스를 구현한다.

- `ai/` — AI provider SDK 어댑터(`providers/`: Anthropic, Gemini, OpenAI, DeepSeek), 재시도 래퍼(`retry/`), 서버 소유 키 reader(`serverKeys.ts`), LLM 응답 JSON 복구·정규화(`extractJsonWithRepair`, `normalizeJsonResponse`), 토큰 사용량 로깅(`usage.ts`). BYOK 사용자 키는 호출자가 전달하며 코어가 저장하지 않는다. 채팅용 호출 시그니처(`CallAiProvider`)는 `domain/ports/aiProvider.ts`에 있고 `requestChatCompletion`은 호출자가 주입한 구현을 사용한다.
- `cache/` — Upstash Redis 래퍼 (`CacheProvider` port 구현, TTL 기반 캐시 + `setIfAbsent` / `deleteIfEquals`)와 캐시 키·TTL 정의.
- `chat/` — Upstash Redis 기반 채팅 토큰 저장소 (`ChatTokenStore` 구현)
- `fmp/` — FMP 환경변수 reader (시세 호출은 consumer가 주입한 `MarketDataProvider`가 수행).
- `hash/` — 분석 입력·skill 카탈로그·API key scope 해시 helper (캐시 키와 시드 계산용)
- `market/` — 재분석 쿨다운 헬퍼 (`SET NX EX`, Upstash)
- `skills/` — Skills 파일 로더·샘플링 (filesystem → `Skill[]`)
- `upstash/` — Upstash Redis 환경변수 reader (`readUpstashConfig`)
- `usage/` — `hashUsageIp` 같은 분석 사용량 보조 함수, 기간 카운터 `createCounterStore`(Upstash)

### agent (ai.siglens.io)

- `domain/agent/` — 툴 카탈로그·인자 검증(`validateArgs`)·시스템 프롬프트·이력 창 (순수)
- `domain/ports/agentProvider.ts` — 툴 콜링 스트리밍 프로바이더 포트 (어댑터는 siglens 소유)
- `domain/ports/counterStore.ts` — 기간 카운터 포트와 `CounterStoreUnavailableError` (fail-closed 장애 신호)
- `application/agent/` — `runAgentTurn` 루프(상한·마감·환불·중단)와 `AGENT_LIMITS` 정책
- `application/shared/providerError.ts` — 채팅·에이전트 공용 프로바이더 에러 분류 `classifyProviderError`
- `infrastructure/usage/counterStore.ts` — Upstash 기간 카운터, `failurePolicy`(`open`/`closed`)

---

## 데이터 흐름

`siglens-core`는 라이브러리이므로 "데이터 흐름"은 consumer가 라이브러리를
호출하는 전형적인 시퀀스를 의미한다.

### 분석 파이프라인 (typical consumer flow)

```
Consumer (web app / 백그라운드 프로세스 / CLI)
  │
  ├─ runAnalysis(...) 호출 (MarketDataProvider·cache 등을 주입)
  │     │
  │     ├─ 1. Skills 로드 — infrastructure/skills/loader.ts (loadSkillsCached)
  │     ├─ 2. 캐시 조회 — CacheProvider (infrastructure/cache/redis.ts)
  │     ├─ 3. (캐시 미스) bars 수집 + 인디케이터 계산
  │     │     → 주입된 MarketDataProvider.getBars (consumer 구현)
  │     │     → domain/indicators/* (pure)
  │     ├─ 4. 프롬프트 구성 — domain/analysis/prompt.ts (pure function)
  │     ├─ 5. AI 호출 — dedupeGeneration(Redis 락)으로 동일 키 중복 생성을 막고,
  │     │     application/analysis/callAnalysisAi.ts가
  │     │     infrastructure/ai/providers/*를 직접 호출
  │     ├─ 6. 응답 정규화·후처리 — domain/analysis/*
  │     └─ 7. 결과 캐시 저장 — TTL 기반 (Upstash Redis)
  │
  └─ 결과 반환 → consumer는 자신의 프레젠테이션 레이어에서 처리
```

`siglens-core`는 위 흐름의 계산·검증·I/O 로직을 모두 소유하며 job 큐나 외부 worker 없이
한 번의 `run*` 호출 안에서 완료한다. 렌더링과 사용자 인터랙션은 consumer가 구현한다.

---

## 외부 I/O 원칙

`infrastructure/` 레이어는 다음 원칙을 따른다.

### 1. 인터페이스를 먼저 정의한다

모든 infrastructure 어댑터는 `domain/ports/`의 port 인터페이스를 구현한다.
`types.ts`는 어댑터 내부 타입만 담는다.

```typescript
// domain/ports/cache.ts — port (계약)
export interface CacheProvider { get; set; delete; setIfAbsent?; deleteIfEquals? }

// infrastructure/cache/redis.ts — adapter
export function createCacheProvider(): CacheProvider | null { ... }
```

### 2. Graceful Degradation

외부 시스템 연결 실패 시 라이브러리 전체가 깨지면 안 된다.
환경변수 누락·네트워크 오류 등은 캐시 없이 정상 동작(cache miss)으로 처리한다.

### 3. 환경변수는 infrastructure에서만 읽는다

`process.env.*` 접근은 infrastructure 모듈 내부에서만 허용된다.
domain은 환경에 의존하지 않는다.

### 4. 테스트에서는 인터페이스를 mock한다

외부 시스템(Upstash Redis, AI API, consumer 측 시세 API)을 실제로 호출하는
테스트는 작성하지 않는다. `CacheProvider` 같은 인터페이스를 stub 구현으로
교체하여 단위 테스트한다. core는 자체 DB infrastructure를 보유하지 않으므로
`UsageRepository` 등 추상 repository 인터페이스 또한 stub으로 mock한다.
