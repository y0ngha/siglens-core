# Analysis API Key Routing Unification

- **Date**: 2026-05-08
- **Scope**: 세 레포지토리 (siglens-core, siglens-worker, siglens)
- **Status**: 설계 완료, 구현 대기

---

## 1. 배경

### 1.1 현재 키 결정 규칙 (Chat completion)
`requestChatCompletion`에는 명확한 tier 기반 키 결정 로직이 있다:

| 조건 | 사용 키 |
|---|---|
| pro 티어 (모델 무관) | serverApiKey |
| non-pro + 무료 모델 | serverApiKey |
| non-pro + 프리미엄 모델 + BYOK 등록 | userApiKey |
| non-pro + 프리미엄 모델 + BYOK 없음 | `user_api_key_required` 에러 |
| serverApiKey 필요한데 없음 | `server_error` |

### 1.2 현재 분석 6종은 규칙 미적용
- `submitAnalysis` (technical), `submitNewsAnalysis`, `submitFundamentalAnalysis`, `submitOverallAnalysis`, `submitNewsCardAnalysis`, `submitBriefing` 모두 worker에 job을 전송한다.
- 키 결정은 worker가 단순 모델 분류로만 수행: `isSiglensProvided(model)` 이면 자체 env 키, 그 외엔 X-AI-API-KEY 필수.
- worker는 user tier를 모른다.

### 1.3 결정적 결함
- **pro 티어 + 프리미엄 모델 분석**: siglens가 BYOK key 미전달 → siglens-core가 X-AI-API-KEY 미설정 → worker가 HTTP 400 반환. **현재 깨짐**.
- **non-pro + 프리미엄 모델, 뉴스/펀더멘털/종합 분석**: siglens-core 옵션 자체에 `userApiKey` 필드 없음 → BYOK 유저도 모든 프리미엄 모델 분석 실패. **현재 깨짐**.

---

## 2. 아키텍처 차이 인식

| 경로 | AI 호출 위치 | 서버 키 보관 위치 |
|---|---|---|
| Chat (`requestChatCompletion`) | siglens-core가 SDK 직접 호출 | siglens env (siglens-core 파라미터로 주입) |
| Analysis 6종 | worker가 SDK 호출 | worker env (자체 보유) |

분석 경로의 서버 키는 **이미 worker가 가지고 있다**. siglens 또는 siglens-core가 별도로 조달할 필요 없음.

→ 분석 경로에서 "pro 티어 → 서버 키 사용" 규칙은 **worker에 tier 신호를 전달**하는 방식으로 구현한다.

---

## 3. 설계

### 3.1 키 결정 책임 분담

| 결정 | 담당 |
|---|---|
| BYOK 게이트 (non-pro + 프리미엄 + no BYOK → 에러) | siglens-core |
| pro 티어 vs 그 외 (서버 키 vs BYOK) | siglens-worker |
| BYOK key 조회 (DB) | siglens |
| Tier 조회 (DB) | siglens |

### 3.2 데이터 흐름

```
siglens (Next.js)
  ├─ DB에서 tier + BYOK key 조회
  └─ siglens-core 호출 시 tier + userApiKey 전달
        ↓
siglens-core
  ├─ BYOK 게이트 적용
  │   └─ non-pro + 프리미엄 + no userApiKey → user_api_key_required 반환
  └─ Worker POST
       Headers: X-Worker-Secret, [X-AI-API-KEY: userApiKey if 있음]
       Body: { jobId, prompt, model, tier }   ← tier 추가
        ↓
siglens-worker
  ├─ tier === 'pro' OR isSiglensProvided(model) → 자체 env 서버 키 사용
  └─ 그 외 → X-AI-API-KEY 필수 (BYOK)
```

---

## 4. 레포지토리별 변경

### 4.1 siglens-worker

#### `/analyze` 엔드포인트
- Body에 `tier?: Tier` 필드 수용
- 키 라우팅 변경:
  ```typescript
  // BEFORE
  const apiKey = isSiglensProvided(model)
      ? resolveServerApiKey(model)
      : userApiKey;

  // AFTER
  const useServerKey = isSiglensProvided(model) || tier === 'pro';
  const apiKey = useServerKey
      ? resolveServerApiKey(model)
      : userApiKey;
  ```
- 검증: 위 로직에서 `useServerKey === false` 이고 `userApiKey === undefined` → HTTP 400 (기존 유지)
- Tier 미전달(undefined) → 보수적으로 `non-pro` 취급 (BYOK 필요)

#### Tier 타입 정의
- siglens-core의 `Tier` 타입 import 또는 worker 측 자체 정의
- 잘못된 tier 문자열은 무시(undefined로 취급)

### 4.2 siglens-core

#### `domain/tier.ts` 추가
```typescript
/** 모델이 free 티어 목록에 없으면 premium으로 간주. */
export function isPremiumModel(
    model: ModelId,
    config: TierConfig = TIER_CONFIG
): boolean {
    return !config.models.free.includes(model as TierModel);
}
```

#### 분석 6종 공통 변경

옵션 타입에 다음 필드 추가:
```typescript
{
    /** Resolved subscription tier. siglens가 DB에서 조회 후 전달. */
    tier?: Tier;
    /** BYOK key. non-pro + premium model 케이스에 필수. */
    userApiKey?: string;
}
```
(이미 `tier` 또는 `userApiKey`가 있는 함수는 그대로)

각 `submitXxx` 함수에 BYOK 게이트 추가 (worker POST 직전):
```typescript
const tier = options.tier ?? DEFAULT_TIER;
const premium = isPremiumModel(modelId, tierConfig);

if (tier !== 'pro' && premium && options.userApiKey === undefined) {
    return /* user_api_key_required error result */;
}
```

Worker POST 시:
- Body에 `tier` 추가
- `options.userApiKey`가 있으면 X-AI-API-KEY 헤더로 전달

Result union에 새 에러 변형 추가:
- 각 분석 모듈의 기존 에러 패턴(`code` discriminant 등)에 맞춰 `user_api_key_required` 추가

#### `submitOverallAnalysis` 추가 변경
- `SubmitOverallAnalysisOptions` 최상위에 `userApiKey?: string` 추가
- `OverallDependencyInputs`의 `fundamental`/`news` Pick에 `userApiKey`/`tier` 포함
- `dependencyResolver.ts`: 최상위 `userApiKey`/`tier`를 세 axis로 전파

#### `requestChatCompletion`은 변경 없음
- 기존 `resolveApiKeys` 로직 유지 (chat은 worker를 거치지 않음)
- `isPremiumModel` 사용으로 통일하려면 옵션이지만 본 작업 범위 외

### 4.3 siglens

#### 공통 패턴: tier + BYOK 조회

각 action 파일에서 다음 흐름 적용:

```typescript
const user = await getCurrentUser();
const tier = user ? await getUserTier({ userId: user.id }) : DEFAULT_TIER;
const premium = isPremiumModel(modelId);

let userApiKey: string | undefined;
if (tier !== 'pro' && premium && user) {
    const byok = await resolveByokOutcome(user.id, modelId, ...);
    if (byok.status === 'allowed') {
        userApiKey = byok.userApiKey;
    } else if (byok.status === 'blocked') {
        return /* tier_premium_blocked */;
    }
}

return submitXxxAnalysis({
    ...,
    tier,
    userApiKey,
});
```

#### 변경 파일
| 파일 | 변경 |
|---|---|
| `submitAnalysisAction.ts` | `tierContext` 전달 추가 (이미 tier resolve 중) |
| `submitNewsAnalysisAction.ts` | tier + BYOK 조회 로직 추가 후 전달 |
| `submitFundamentalAnalysisAction.ts` | 동일 |
| `submitOverallAnalysisAction.ts` | 동일 |

#### BYOK 조회 헬퍼 추출
- `submitAnalysisAction.ts`의 `resolveByokOutcome` 로직을 4개 action에서 공유 가능하도록 `infrastructure/market/byok.ts` (또는 유사 위치)로 추출

---

## 5. 에러 코드

| 에러 | 발생 위치 | 의미 |
|---|---|---|
| `user_api_key_required` | siglens-core (BYOK 게이트) | non-pro + 프리미엄 + BYOK 미등록 |
| `tier_premium_blocked` | siglens (BYOK 게이트) | DB에서 BYOK 조회 실패 또는 미등록 |
| HTTP 400 (worker) | siglens-worker | non-pro + 프리미엄 + X-AI-API-KEY 누락 (siglens-core 게이트가 정상이면 도달 불가) |

---

## 6. 호환성 / 마이그레이션

### 릴리즈 순서 (필수)
1. **siglens-worker** — tier 수용 + 키 라우팅 확장 (구버전 siglens-core가 tier 미전달해도 정상 동작)
2. **siglens-core** — 옵션에 tier/userApiKey 추가 + BYOK 게이트 + worker body에 tier 포함
3. **siglens** — siglens-core 새 버전 사용, tier + BYOK 전달

### 하위 호환
- siglens-core: 새 옵션 모두 optional → 기존 호출 컴파일 유지. 단 런타임에서 tier 미전달이면 free 티어 취급.
- siglens-worker: tier 미전달 → `non-pro` 취급. 기존 동작 보존.

### 단계 1만 배포된 상태
- worker는 tier 인식 가능하지만 siglens-core가 아직 미전달 → 기존 동작 유지 (변경 영향 없음).

### 단계 2까지 배포된 상태
- siglens-core가 tier를 받고 worker에 전달. siglens가 tier 미전달이면 free 취급 → 기존 깨진 동작 유지.

### 단계 3 완료
- 모든 분석 함수가 chat completion과 동일한 규칙으로 키 결정.

---

## 7. 테스트

### siglens-core
- `domain/tier.test.ts`: `isPremiumModel` 케이스 (각 모델별)
- 6개 `submit*Analysis.test.ts`: BYOK 게이트 4 케이스 (pro/free model/BYOK 있음/없음) + worker POST body의 tier 포함
- `dependencyResolver.test.ts`: 최상위 userApiKey/tier 가 axis로 전파되는지

### siglens-worker
- `/analyze` body의 `tier` 파싱
- 키 라우팅 4 케이스: (siglens-provided × tier=pro), (siglens-provided × tier=non-pro), (premium × tier=pro), (premium × tier=non-pro + BYOK), (premium × tier=non-pro + no BYOK → 400)

### siglens
- 4개 action: tier 조회 + BYOK 조회 + siglens-core 호출 인자 검증
- BYOK 헬퍼 추출 시 단위 테스트

---

## 8. 결정 사항

- **서버 키 조달**: worker env (기존 그대로). siglens/siglens-core가 새로 env var 추가 안 함.
- **Tier 신호 전달 방식**: HTTP body에 `tier` 필드 (헤더 아님 — body가 이미 JSON이고 모델/jobId와 자연스럽게 같이 묶임).
- **BYOK 게이트 위치**: siglens-core. 이유: siglens가 게이트해도 siglens-core 직접 사용 컨슈머가 동일 보호를 받지 못함.
- **Tier enum**: `'free' | 'member' | 'pro'`. worker는 `'pro'`만 특수 처리.

---

## 9. 후속 / 범위 외

- siglens-core가 chat completion의 `resolveApiKeys`를 `domain/tier.ts`로 추출하는 리팩터링은 별도 PR.
- Worker에서 tier 기반 비용 측정/리포팅은 본 작업 범위 외.
- `submitBriefing`은 사용자 트리거가 아니라 서버 측 정기 작업으로 알려져 있음 — 본 작업에서 BYOK 게이트 미적용 (서버 키 전용으로 유지).
