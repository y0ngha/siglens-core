# Architecture

## 개요

Layered Architecture를 기반으로 한다.
`siglens-core`는 **순수 TypeScript 라이브러리**이며, 도메인 계산 로직과 외부 I/O 래퍼만 포함한다.
UI, 렌더링, 프레임워크 종속 코드는 이 레파지토리에 존재하지 않는다.

---

## 레이어 구조

```
┌─────────────────────────────────────────┐
│         application (오케스트레이션)     │  여러 infrastructure를 조합하는
│           market/, chat/, …            │  use-case 단위 함수
├─────────────────────────────────────────┤
│          infrastructure (외부)          │  AI Provider, Skills Loader,
│                                         │  Upstash Redis, Neon DB,
│                                         │  Market Data Providers
├─────────────────────────────────────────┤
│             domain (순수)              │  인디케이터, 캔들 패턴,
│                                         │  차트 패턴, 분석 프롬프트
└─────────────────────────────────────────┘
                    │
                    ▼
              src/index.ts
         (public entry of the package)
```

라이브러리 consumer(Next.js 앱, Node worker, CLI 등)는 `src/index.ts`에서 재노출되는
심볼만 사용한다. Consumer의 프레젠테이션/런타임 코드는 이 레파지토리에 포함되지 않는다.

---

## 의존성 방향 규칙

```
domain         ← 외부 import 없음
                 순수 TypeScript 함수만 허용
                 technicalindicators 라이브러리도 금지
                 (계산 로직을 직접 구현)
                 Date.now(), fetch, console.*, process.env 전부 금지

infrastructure ← domain import 가능
                 application import 금지 (ESLint 강제)
                 외부 API (AI 프로바이더 등) 호출 담당
                 Skills 파일 I/O 담당
                 Upstash Redis 캐시 관리 담당 (cache/)
                 Neon / PostgreSQL 연결 관리 담당 (db/)
                 인터페이스(types.ts)를 반드시 먼저 정의

application    ← domain, infrastructure import 가능
                 여러 infrastructure 모듈을 조합해 use-case를 완성
                 domain, infrastructure에서 application import 금지 (ESLint 강제)
                 현재: market/ (submitAnalysis, pollAnalysis, cancelAnalysisJob,
                                submitBriefing, pollBriefing),
                       chat/ (requestChatCompletion)

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
# tree -d -L 3 -I "node_modules|dist"
.
├── docs
├── skills
└── src
    ├── __tests__
    │   ├── application
    │   │   ├── auth
    │   │   ├── dashboard
    │   │   ├── market
    │   │   ├── ticker
    │   │   └── tier
    │   ├── domain
    │   └── infrastructure
    ├── application
    │   ├── auth
    │   ├── chat
    │   ├── dashboard
    │   ├── market
    │   ├── ticker
    │   └── tier
    ├── domain
    │   ├── analysis
    │   ├── constants
    │   ├── indicators
    │   └── signals
    ├── infrastructure
    │   ├── ai
    │   ├── cache
    │   ├── chat
    │   ├── db
    │   ├── jobs
    │   ├── market
    │   └── skills
    └── index.ts
```

### src/index.ts

라이브러리의 **유일한 public entry**. `domain/`, `infrastructure/`, `application/`에서
외부 consumer에게 노출할 심볼을 Tier 단위로 그룹화하여 재-export한다.

```typescript
// src/index.ts (Tier별 그룹화 구조)
// === Tier 1: Application Entrypoints ===
export { submitAnalysis, pollAnalysis /* ... */ } from './application/market/...';

// === Tier 2: Domain Building Blocks ===
export { calculateIndicators } from './domain/indicators';
export { detectSignals, classifyTrend } from './domain/signals';
export { buildAnalysisPrompt } from './domain/analysis/prompt';

// === Tier 3: Infrastructure Factories & Config ===
export { createMarketDataProvider } from './infrastructure/market/factory';
export { FileSkillsLoader } from './infrastructure/skills/loader';

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

- **Tier 1**: `application/` 진입점 (예: `submitAnalysis`, `getMarketSummary`)
- **Tier 2**: `domain/` high-level 함수 (예: `calculateIndicators`, `detectSignals`, `buildAnalysisPrompt`)
- **Tier 3**: `infrastructure/` factory & config (예: `createCacheProvider`, `FileSkillsLoader`)
- **Tier 4**: 모든 public 타입/인터페이스/상수
- **Internal**: 다른 public 함수의 보조 구현. `src/index.ts`에서 export하지 않으며 정의부에 `/** @internal */` 태그를 단다.

Tier 정의, 함수별 분류, 새 함수 추가 시 결정 워크플로우, semver 정책은
[`docs/PUBLIC_API.md`](./PUBLIC_API.md)에서 관리한다.

### domain/signals/

Pure-function signal detectors. Follows the same rules as `domain/indicators/`:
no external imports, pure functions only.

### infrastructure/

외부 시스템과의 경계를 담당한다. 각 서브디렉토리는 **하나의 외부 시스템**에만 대응하며,
`types.ts`에 정의된 인터페이스를 구현한다.

- `ai/` — AI 프로바이더 클라이언트 (Claude, Gemini)
- `cache/` — Upstash Redis 래퍼 (TTL 기반 캐시)
- `chat/` — Upstash Redis 기반 채팅 토큰 저장소
- `db/` — Neon serverless PostgreSQL + Drizzle ORM 스키마/클라이언트
- `jobs/` — Redis 기반 Job 큐 (enqueue / dequeue / status 관리)
- `market/` — 시세 프로바이더 래퍼 (consumer가 주입한 provider 추상화)
- `skills/` — Skills 파일 로더 (filesystem → `Skill[]`)

---

## 데이터 흐름

`siglens-core`는 라이브러리이므로 "데이터 흐름"은 consumer가 라이브러리를
호출하는 전형적인 시퀀스를 의미한다.

### 분석 파이프라인 (typical consumer flow)

```
Consumer (web app / worker / CLI)
  │
  ├─ 1. bars 데이터 수집
  │     → infrastructure/market/<provider>.ts로 외부 시세 API 호출
  │     → domain/indicators/* 호출하여 인디케이터 계산
  │
  ├─ 2. Skills 로드
  │     → infrastructure/skills/loader.ts (FileSkillsLoader)
  │     → skills/ 디렉토리의 .md 파일을 파싱하여 Skill[] 반환
  │
  ├─ 3. 프롬프트 구성
  │     → domain/analysis/prompt.ts
  │     → buildAnalysisPrompt(symbol, bars, indicators, skills)
  │     → confidenceWeight < 0.5 인 Skill은 제외 (pure function)
  │
  ├─ 4. AI 호출
  │     → infrastructure/ai/<provider>.ts
  │     → 프롬프트를 AI 프로바이더에 전송
  │
  ├─ 5. 결과 캐시
  │     → infrastructure/cache/redis.ts
  │     → Upstash Redis에 TTL 기반으로 저장
  │
  └─ 6. 결과 반환
        → consumer는 AI 응답을 자신의 프레젠테이션 레이어에서 처리
```

`siglens-core`는 6단계 중 **1~5의 pure/infra 로직만** 소유한다.
consumer는 6단계(렌더링, 사용자 인터랙션)를 자유롭게 구현한다.

---

## 외부 I/O 원칙

`infrastructure/` 레이어는 다음 원칙을 따른다.

### 1. 인터페이스를 먼저 정의한다

모든 infrastructure 모듈은 `types.ts`에 인터페이스를 먼저 정의하고
구현체가 해당 인터페이스를 만족하도록 한다.

```typescript
// infrastructure/cache/types.ts
export interface AnalysisCache {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

// infrastructure/cache/redis.ts
export class UpstashAnalysisCache implements AnalysisCache { ... }
```

### 2. Graceful Degradation

외부 시스템 연결 실패 시 라이브러리 전체가 깨지면 안 된다.
환경변수 누락·네트워크 오류 등은 캐시 없이 정상 동작(cache miss)으로 처리한다.

### 3. 환경변수는 infrastructure에서만 읽는다

`process.env.*` 접근은 infrastructure 모듈 내부에서만 허용된다.
domain은 환경에 의존하지 않는다.

### 4. 테스트에서는 인터페이스를 mock한다

외부 시스템(Neon, Upstash, AI API)을 실제로 호출하는 테스트는 작성하지 않는다.
`AnalysisCache` 같은 인터페이스를 stub 구현으로 교체하여 단위 테스트한다.
