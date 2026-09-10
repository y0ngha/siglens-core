# 모델 등급 재편 + 추론 기본값 OFF 설계

- 작성일: 2026-09-06
- 브랜치: `feat/model-tier-restructure`
- 영향 레포: `siglens-core` (주), `siglens` (배선), `siglens-worker` (MODEL_SPECS 소비)

---

## 1. 배경

### 1.1 현재 상태

모델 접근 제어 축이 **이진값 하나**뿐이다.

```ts
isPremiumModel(model) = !TIER_CONFIG.models.free.includes(model)
requiresByokKey(tier, model) = tier !== 'pro' && isPremiumModel(model)
```

`TIER_CONFIG.models`에 `free`/`member`/`pro` 세 목록이 있으나
`featureFlags.enableTierRestrictions: false`라 `getAllowedModels`가 이를 참조하지
않는다. 즉 **member 목록은 현재 아무 효과가 없다.**

결과적으로 실제 동작하는 분류는 둘뿐이다.

| 클래스 | 접근 | 비용 |
|---|---|---|
| free | 비회원 포함 누구나 | 서버 키 대납 |
| premium | 로그인 + provider별 BYOK 키 (pro면 키 면제) | 사용자 키 |

"회원이면 서버 키로 열리는 모델"을 표현할 수단이 없다.

### 1.2 등급 배치가 가격과 어긋남

현행 배치를 실측 단가와 대조하면 역전이 다수 발견된다.

- `claude-sonnet-4-6`(free 목록, $3/$15)이 member 목록 대부분보다 비싸다
- `gemini-3.6-flash`($0.75/$3.75)가 `gemini-2.5-pro`보다 싼데 상위 목록에 있다
- Byok 최저가와 member 최고가 구간이 겹친다

### 1.3 추론 기본값이 provider마다 다름

`MODEL_SPECS`의 추론 설정이 곧 기본값인데, 모델별로 ON/OFF가 제각각이다.
`deepseek-v4.1-pro`는 `thinking: true`, Gemini는 `thinkingBudget: 32_768`,
Claude sonnet/opus는 `effort: 'high'`. 서버 키로 대납하는 Free·Member 모델이
기본적으로 추론을 돌리면 대납 비용이 불필요하게 커진다.

### 1.4 추론 OFF가 실제로 동작하지 않음

`callAnalysisAi`가 `reasoning === false`를 provider별로 번역하는데, 셋이 틀렸다.

| provider | 현재 번역 | 실제 결과 |
|---|---|---|
| claude | `effort: 'low'` | OFF 아님 — 여전히 adaptive thinking |
| chatgpt | `effort: 'low'` | OFF 아님 — 여전히 reasoning |
| gemini | `thinkingBudget: 0` | 모델에 따라 400 또는 **조용히 무시** |
| deepseek | `thinking: false` | 정상 |

특히 Gemini 판정에 쓰이는 `GEMINI_MODELS_SUPPORTING_DISABLED_THINKING`은
"리터럴 0에 400을 반환하는가"를 기준으로 삼는데, 실측 결과 이 기준은
`gemini-3.7-flash` / `gemini-3.8-flash`에서 틀린 답을 준다(400은 나지 않으면서
budget 0을 무시함). 이 집합에 들어가면 OFF가 무효가 되고 폴백 경고조차
찍히지 않는다.

---

## 2. Gemini 추론 제어 실측 (2026-09-06)

공식 문서(`ai.google.dev/gemini-api/docs/thinking`)의 "Can Disable? No" 표는
실측과 일치하지 않아 채택하지 않는다. 아래는 라이브 호출 결과다.

측정 방법: 각 모델에 동일 프롬프트를 5가지 `thinkingConfig` 형태로 호출하고
`usageMetadata.thoughtsTokenCount`를 읽는다. **프롬프트 난이도가 결과를 바꾸므로
반드시 다단계 추론이 필요한 프롬프트를 쓴다** — 사소한 프롬프트에서는 모델이
자발적으로 생각을 생략해 `thoughts=0`이 나오고, 이는 "비활성화됨"과 구분되지
않는다. 스크립트는 `scratchpad/gemini-thinking-probe-hard.mjs` 참조.

| 모델 | `thinkingBudget: 0` | `thinkingLevel: 'minimal'` | `thinkingLevel: 'low'` | 미지정 |
|---|---|---|---|---|
| `gemini-3.5-flash-lite` | 400 | **thoughts=0** | 957 | 0 |
| `gemini-3.6-flash` | 400 | **thoughts=0** | 177 | 418 |
| `gemini-3.7-flash` | 200, thoughts=176 | 400 (미지원) | 158 | 213 |
| `gemini-3.8-flash` | 200, thoughts=200 | 400 (미지원) | 178 | 329 |
| `gemini-3.1-pro-preview` | 400 | 400 (미지원) | 400 | 759 |

도출되는 사실 셋.

1. `thinkingLevel`(문자열: `minimal`/`low`/`medium`/`high`)이 3세대의 제어
   파라미터이며 core는 현재 이를 사용하지 않는다.
2. `gemini-3.5-flash-lite`·`gemini-3.6-flash`만 완전 비활성이 가능하고,
   그 수단은 `thinkingLevel: 'minimal'`이다.
3. `gemini-3.7-flash`·`gemini-3.8-flash`는 `thinkingBudget: 0`을 **에러 없이
   무시한다.** 완전 비활성 불가이며 최저는 `thinkingLevel: 'low'`다.

---

## 3. 최종 모델 레지스트리 (16개)

### 3.1 Free (5) — 서버 키, 비회원 포함 누구나

| 모델 | 입력 $/1M | 출력 $/1M |
|---|---|---|
| `gpt-5.6-luna` | 0.20 | 1.20 |
| `gemini-3.5-flash-lite` | 0.30 | 2.50 |
| `deepseek-v4.1-flash` | — | — |
| `gemini-3.6-flash` | 0.75 | 3.75 |
| `claude-haiku-4-5` | 1.00 | 5.00 |

### 3.2 Member (6) — 서버 키, 로그인 필수

| 모델 | 입력 $/1M | 출력 $/1M |
|---|---|---|
| `gemini-3.7-flash` | 0.75 | 3.75 |
| `gemini-3.8-flash` | 0.75 | 3.75 |
| `deepseek-v4.1-pro` | — | — |
| `claude-sonnet-5` | 2.00 | 10.00 |
| `gpt-5.6-terra` | 2.00 | 12.00 |
| `gemini-3.1-pro-preview` | 2.00 | 12.00 |

### 3.3 Byok (5) — 사용자 키. 향후 pro 티어의 서버 대납 대상

| 모델 | 입력 $/1M | 출력 $/1M |
|---|---|---|
| `gpt-5.6-sol` | 4.00 | 20.00 |
| `claude-opus-4-8` | 5.00 | 25.00 |
| `claude-opus-5` | 5.00 | 25.00 |
| `claude-fable-5-1` | 10.00 | 50.00 |
| `gpt-6-astra` | 10.00 | 50.00 |

등급 간 단가 구간이 겹치지 않는다: Free ≤ $5 < Member ≤ $12 < Byok ≥ $20.

### 3.4 삭제 (9)

`claude-sonnet-4-6`, `claude-opus-4-7`, `gemini-2.5-flash`,
`gemini-2.5-flash-lite`, `gemini-2.5-pro`, `gemini-3-flash-preview`,
`gpt-5-mini`, `gpt-5.4`, `gpt-5.5`

### 3.5 신규 (6)

`gpt-5.6-luna`, `gemini-3.7-flash`, `gemini-3.8-flash`, `claude-opus-4-8`,
`claude-fable-5-1`, `gpt-6-astra`

### 3.6 폐기 alias 제거

`TierModel`의 `'claude-sonnet-4'` / `'claude-opus-4'`(`types.ts:2274,2276`)와
`DeprecatedModelId`(`types.ts:2284`)를 제거한다. 두 alias의 JSDoc이 가리키는
대체 모델(`claude-sonnet-4-6`, `claude-opus-4-7`)이 §3.4에서 삭제되므로 문서가
존재하지 않는 모델을 가리키게 된다.

제거해도 안전한 근거: 저장된 옛 모델 ID는 소비자 측 허용목록 검증에서 걸러져
기본 모델로 폴백된다(siglens `useSelectedModel`). §3.4의 9개도 동일 경로를
타므로 alias 2개만 타입에 특별대우로 남길 이유가 없다.

`ActiveModelId = Exclude<TierModel, DeprecatedModelId>`는 `TierModel`과
동일해지므로 `ActiveModelId`를 `TierModel`의 alias로 단순화한다. 두 이름 모두
public export이므로 유지한다.

---

## 4. 접근 축 3분류

### 4.1 타입과 분류자

```ts
export type ModelAccess = 'free' | 'member' | 'byok';

const FREE_MODELS:   readonly TierModel[] = [...];  // 5
const MEMBER_MODELS: readonly TierModel[] = [...];  // 6
const BYOK_MODELS:   readonly TierModel[] = [...];  // 5

export function getModelAccess(model: ModelId): ModelAccess;
```

**세 목록은 서로소다.** 현행 `MEMBER_MODELS = [...FREE_MODELS, ...]` 누적
방식을 버린다. 누적이면 `getModelAccess`가 한 모델에 두 값을 줄 수 있다.

`TIER_CONFIG.models`는 등급별 **허용 목록**(누적)을 계속 제공해야 하므로
세 목록에서 파생한다.

```ts
models: {
    free:   FREE_MODELS,
    member: [...FREE_MODELS, ...MEMBER_MODELS],
    pro:    [...FREE_MODELS, ...MEMBER_MODELS, ...BYOK_MODELS],
}
```

### 4.2 기존 분류자 보존

호출처가 많으므로 시그니처를 유지하고 구현만 재정의한다.

```ts
isFreeModel(m)          = getModelAccess(m) === 'free'
isPremiumModel(m)       = getModelAccess(m) !== 'free'
requiresByokKey(tier,m) = tier !== 'pro' && getModelAccess(m) === 'byok'
```

`requiresByokKey`가 `byok`만 검사하도록 좁아지는 것이 이번 변경의 핵심이다.
member 모델은 더 이상 BYOK 키를 요구하지 않는다.

### 4.3 게이트 분기

소비자(`siglens`)의 `resolveTierAndByok` / `useModelGate`가 따를 분기다.

```
free                     → allowed (서버 키)
member + userId === null → blocked (auth 게이트)
member                   → allowed (서버 키)
byok   + userId === null → blocked (auth 게이트)
byok   + tier === 'pro'  → allowed (서버 키)
byok   + 키 없음          → blocked (byok 게이트)
byok   + 키 있음          → allowed (userApiKey)
```

`byok + tier === 'pro'` 분기는 현행 코드에 이미 존재한다. pro 라이선스를
운영하게 되어도 core 변경은 필요 없다.

### 4.4 추론 토글 게이트는 불변

`resolveReasoning(tier, clientReasoning) = tier !== 'free' && clientReasoning === true`
를 그대로 둔다. 비회원·free 티어는 어떤 모델에서도 추론을 켤 수 없다.
Free 모델을 회원이 선택한 경우에만 토글이 열린다.

근거: 비회원 트래픽은 상한이 없고(`analysisPerDay: Infinity`) 추론 토큰까지
서버가 대납하게 된다.

---

## 5. 추론 설정을 데이터로

### 5.1 문제

OFF 표현이 provider마다 다르고(`thinkingLevel:'minimal'` / `{type:'disabled'}` /
`effort:'none'` / `thinking:false`), 그 지식이 `callAnalysisAi`의 switch에
흩어져 있다. 모델별 예외(§2의 3.7/3.8, 아래 fable·astra)를 담을 자리가 없어
모델 ID를 나열한 Set이 필요해지는데, 그 Set이 바로 §1.4에서 틀린 것으로
판명된 구조다.

### 5.2 구조

`ModelSpec`이 OFF 설정, ON 설정, 기본값을 함께 선언한다.

```ts
interface ReasoningModes<TConfig> {
    /** 추론 OFF일 때 적용할 provider별 설정. */
    off: TConfig;
    /** 추론 ON일 때 적용할 provider별 설정. */
    on: TConfig;
    /** `reasoning`이 undefined일 때 적용할 쪽. */
    default: 'off' | 'on';
    /**
     * `off`가 추론을 완전히 없애는지 여부. 기본 `true`.
     * `false`면 `off`는 "그 모델이 허용하는 최저 강도"일 뿐이며 모델은 여전히
     * 사고 토큰을 소비한다. 소비자가 "껐다"고 오해하지 않도록 명시한다.
     */
    hardOff?: boolean;
    /**
     * 추론 토글이 이 모델에서 의미를 갖는지 여부. 기본 `true`.
     * `false`면 `off`와 `on`이 동일하므로 토글을 조작해도 호출 결과가 바뀌지
     * 않는다. 소비자 UI는 이 값이 `false`일 때 토글을 비활성화해야 한다.
     */
    toggleable?: boolean;
}
```

`hardOff`와 `toggleable`은 서로 다른 사실을 기술한다.

| 필드 | 의미 | UI 처리 |
|---|---|---|
| `hardOff: false` | 토글은 동작하지만 OFF가 완전한 OFF는 아님 | 토글은 열되 "완전히 끌 수 없음" 안내 |
| `toggleable: false` | 토글 자체가 무의미 (`off === on`) | 토글 비활성화 |

provider별 `TConfig`:

| provider | TConfig |
|---|---|
| gemini | `{ level: 'minimal' \| 'low' \| 'medium' \| 'high' }` |
| claude (adaptive) | `{ mode: 'disabled' } \| { mode: 'adaptive'; effort: ClaudeEffortLevel }` |
| claude (haiku) | `{ budgetTokens: number }` |
| chatgpt | `{ effort: ChatGptEffortLevel }` |
| deepseek | `{ thinking: boolean }` |

`EffortLevel`을 provider별로 분리한다. 현행 `'low'|'medium'|'high'` 공용
union으로는 GPT의 `'none'`을 표현할 수 없고, 공용에 `'none'`을 추가하면
Claude 스펙이 지원하지 않는 값을 타입상 허용하게 된다.

```ts
export type ClaudeEffortLevel  = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ChatGptEffortLevel = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/** @deprecated provider별 union을 사용할 것. */
export type EffortLevel = 'low' | 'medium' | 'high';
```

### 5.3 소비 지점

`callAnalysisAi`의 provider별 switch가 두 줄로 대체된다.

```ts
const enabled = reasoning ?? spec.reasoning.default === 'on';
const config  = enabled ? spec.reasoning.on : spec.reasoning.off;
```

`config`를 어댑터에 그대로 넘긴다. 확정사항 "`reasoning === true`는 전
provider에서 스펙을 오버라이드해야 한다"가 코드가 아니라 데이터로 성립한다.

`GEMINI_MODELS_SUPPORTING_DISABLED_THINKING` 집합과
`supportsDisabledThinking()`을 제거하고, 그 역할을 `spec.reasoning.hardOff`가
대신한다. 판정 기준이 "400이 나는가"에서 "off가 진짜 0을 만드는가"로 바뀐다.

### 5.4 모델별 설정표

`default`는 §3의 등급을 따른다 — Free·Member는 `'off'`, Byok는 `'on'`.

| 모델 | off | on | default | hardOff |
|---|---|---|---|---|
| `gpt-5.6-luna` | `effort:'none'` | `effort:'high'` | off | true |
| `gemini-3.5-flash-lite` | `level:'minimal'` | `level:'high'` | off | true |
| `deepseek-v4.1-flash` | `thinking:false` | `thinking:true` | off | true |
| `gemini-3.6-flash` | `level:'minimal'` | `level:'high'` | off | true |
| `claude-haiku-4-5` | `budgetTokens:0` | `budgetTokens:0` | off | true¹ |
| `gemini-3.7-flash` | `level:'low'` | `level:'high'` | off | **false** |
| `gemini-3.8-flash` | `level:'low'` | `level:'high'` | off | **false** |
| `deepseek-v4.1-pro` | `thinking:false` | `thinking:true` | off | true |
| `claude-sonnet-5` | `mode:'disabled'` | `mode:'adaptive', effort:'high'` | off | true |
| `gpt-5.6-terra` | `effort:'none'` | `effort:'high'` | off | true |
| `gemini-3.1-pro-preview` | `level:'low'` | `level:'high'` | off | **false** |
| `gpt-5.6-sol` | `effort:'none'` | `effort:'high'` | on | true |
| `claude-opus-4-8` | `mode:'disabled'` | `mode:'adaptive', effort:'high'` | on | true |
| `claude-opus-5` | `mode:'disabled'` | `mode:'adaptive', effort:'high'` | on | true |
| `claude-fable-5-1` | `mode:'adaptive', effort:'low'` | `mode:'adaptive', effort:'high'` | on | **false** |
| `gpt-6-astra` | `effort:'low'` | `effort:'high'` | on | **false** |

`hardOff: false`인 5개의 근거:

- `gemini-3.7-flash` / `gemini-3.8-flash` / `gemini-3.1-pro-preview` — §2 실측.
  최저 `low`에서도 각각 약 158 / 178 / 400 사고 토큰을 소비한다.
- `claude-fable-5-1` — thinking이 항상 켜져 있다. `{type:'disabled'}`와
  `{type:'enabled', budget_tokens}` 모두 400을 반환하므로 `thinking` 파라미터를
  생략하거나 `{type:'adaptive'}`만 보낼 수 있다. 최저 강도는 `effort:'low'`다.
- `gpt-6-astra` — `reasoning.effort: 'none'`이 400을 반환한다. 최저는 `'low'`다.

¹ `claude-haiku-4-5`는 `toggleable: false`다. `off`와 `on`이 같아 토글이 결과를
바꾸지 않으므로 UI에서 비활성화한다. 근거는 §8.1 참조. 위 표에서 `toggleable`을
명시하지 않은 나머지 15개는 모두 기본값 `true`다.

### 5.5 토글 가능 여부 조회

소비자 UI가 토글 활성/비활성을 결정할 수 있도록 public helper를 추가한다.

```ts
/**
 * 해당 모델에서 추론 토글이 결과를 바꾸는지 여부.
 * `false`면 소비자 UI는 토글을 비활성화해야 한다.
 */
export function isReasoningToggleable(model: ActiveModelId): boolean;

/**
 * 해당 모델의 OFF 설정이 추론을 완전히 없애는지 여부.
 * `false`면 OFF로도 사고 토큰이 소비된다.
 */
export function supportsHardOff(model: ActiveModelId): boolean;
```

`supportsHardOff`는 제거되는 `supportsDisabledThinking`의 후속이다. 판정 기준이
"400을 반환하는가"에서 "off가 진짜 0을 만드는가"로 바뀌며, Gemini 전용이 아니라
전 provider에 적용된다.

---

## 6. 어댑터 변경

### 6.1 `infrastructure/ai/providers/gemini.ts`

현재 `options.thinking === true`일 때만 `thinkingConfig`를 전송한다
(`gemini.ts:99`). 그 결과 기본 경로에서는 설정을 아예 보내지 않아 모델의
자연 기본값이 적용된다 — `gemini-3.6-flash` 기준 418 사고 토큰.

변경: `thinkingConfig`를 **항상** 전송하고, `thinkingLevel` 문자열을 받는다.
`thinkingBudget` 숫자 경로는 3세대에서 무시되거나 400을 유발하므로 제거한다.

`MAX_TOKENS` 재시도 시퀀스(`getThinkingBudgetSequence`,
`THINKING_BUDGET_FALLBACK_STEPS`)가 숫자 budget을 전제로 하므로 level 단계
축소(`high → medium → low → minimal`)로 재작성해야 한다. `minimal`을 지원하지
않는 모델은 `low`가 바닥이다.

### 6.2 `infrastructure/ai/providers/anthropic.ts`

현재 `spec.effort` 유무만으로 thinking 여부가 갈린다(`anthropic.ts:96,167-180`).
effort가 있으면 **항상** `thinking: {type:'adaptive'}`를 보내므로 OFF 경로가
존재하지 않는다.

변경: `{ mode: 'disabled' }`를 받으면 `thinking: {type:'disabled'}`를 전송하는
분기를 신설한다.

주의: `claude-opus-5`는 `{type:'disabled'}`를 `effort`가 `high` 이하일 때만
허용하고 `xhigh`/`max`에서는 400을 반환한다. §5.4의 `on`이 `high`이므로 현재
구성에서는 문제가 없으나, 향후 `xhigh` 도입 시 함께 검토해야 한다.

`claude-sonnet-5`는 sampling 파라미터(`temperature`)를 400으로 거부하므로
haiku식 temperature 경로로 우회할 수 없다. disabled 분기 신설이 유일한 수단이다.

### 6.3 `infrastructure/ai/providers/openai.ts`

`supportsEffort = spec.effort !== undefined` 가드(`openai.ts:94`)를 유지하되
`ChatGptEffortLevel`을 받도록 넓힌다. `'none'` 전달 경로만 추가하면 된다.

### 6.4 `infrastructure/ai/providers/deepseek.ts`

`options.thinking ?? spec.thinking`(`deepseek.ts:111`)이 이미 올바르게
동작한다. `spec.reasoning` 구조를 읽도록 필드 참조만 바꾼다.

---

## 7. 테스트

1. **레지스트리 커버리지** — `MODEL_SPECS`의 모든 키가 `FREE_MODELS` /
   `MEMBER_MODELS` / `BYOK_MODELS` 중 **정확히 하나**에만 존재한다. 세 목록의
   합집합이 `MODEL_SPECS` 키 집합과 일치한다. 이 단언이 없으면 목록에서
   누락된 모델은 컴파일러에 잡히지 않고 `getModelAccess`에서만 터진다.
2. **`getModelAccess` 반환값** — 16개 모델 전부에 대해 기대 등급을 단언한다.
3. **`requiresByokKey`** — member 모델 × 비-pro 티어가 `false`를 반환하는지
   (이번 변경의 핵심 회귀 지점). byok 모델 × 비-pro가 `true`인지.
4. **`spec.reasoning.default`** — Free·Member 11개가 `'off'`, Byok 5개가
   `'on'`인지 등급 목록에서 파생해 단언한다. 하드코딩된 기대값 나열이 아니라
   등급과 기본값의 관계를 검증한다.
5. **`hardOff`** — §5.4에서 `false`인 5개를 단언한다. 실측 근거 주석을 함께 둔다.
5.1 **`toggleable`** — `claude-haiku-4-5`만 `false`이고 나머지 15개는 `true`인지
   단언한다. 아울러 `toggleable === false`인 모델은 `off`와 `on`이 실제로
   같은 값인지 검증한다 — 이 불변식이 깨지면 UI가 토글을 막았는데 내부적으로는
   설정이 달라지는 상태가 된다.
6. **삭제 모델 부재** — §3.4의 9개와 alias 2개가 `TierModel`·`MODEL_SPECS`·
   세 목록 어디에도 없는지 단언한다.
7. **`callAnalysisAi` 설정 선택** — `reasoning`이 `true`/`false`/`undefined`일
   때 어댑터에 전달되는 config가 각각 `on`/`off`/`default`쪽인지 검증한다.
   provider 4종 각각에 대해 확인한다.

기존 `GEMINI_MODELS_SUPPORTING_DISABLED_THINKING` 관련 테스트는 제거한다.

---

## 8. 결정 및 후속 과제

### 8.1 `claude-haiku-4-5`의 추론 토글 — 토글 비활성 (결정됨)

추론 토글 게이트(§4.4)는 **티어만 보고 모델은 보지 않는다.** 따라서 회원이
Free 등급 모델을 선택해도 토글이 열린다. haiku는 Free 등급이므로 이 경로에
그대로 노출된다.

결정: haiku는 `toggleable: false`로 두어 `off`/`on`을 모두 `budgetTokens: 0`으로
고정하고, **소비자 UI가 토글을 비활성화한다.**

근거: haiku를 켜려면 `budget_tokens ≥ 1024` 경로를 어댑터에 신설해야 하고,
extended thinking과 `temperature: 0`의 양립 여부를 별도 검증해야 한다. haiku는
Free 등급의 최저 지연 모델이며, 추론이 필요하면 사용자가 상위 모델을 고르는
편이 자연스럽다.

토글을 비활성화하지 않고 무시만 하면 사용자가 켰다고 믿는데 아무 일도 일어나지
않는 상태가 된다. `isReasoningToggleable`(§5.5)이 이 구분을 소비자에게 제공한다.

#### 8.1.1 `locked`와 `disabled`의 우선순위

siglens `ReasoningToggle`은 이미 두 상태를 구분한다.

| 상태 | 조건 | 동작 |
|---|---|---|
| `locked` (`!canUse`) | 비회원 / free 티어 | 잠긴 모양으로 노출. 스위치는 항상 OFF로 표시되고, 클릭하면 가입 유도 모달이 열린다 |
| `disabled` | 별도 prop | 완전 no-op. `if (disabled) return;`이 핸들러 최상단이라 가입 유도조차 열리지 않는다 |

`toggleable: false` 모델에서는 **`disabled`가 `locked`보다 우선한다.**

근거: 비회원이 haiku를 선택한 상태에서 `locked`(가입 유도)를 띄우면 "가입하면
열린다"는 거짓 약속이 된다. haiku는 가입해도 열리지 않는다. 현행 핸들러가 이미
`disabled`를 먼저 검사하므로 `disabled={!isReasoningToggleable(model)}`를
넘기는 배선만 추가하면 된다.

`hardOff: false` 모델은 이와 다르다. 토글이 실제로 동작하므로 `locked`/`disabled`
어느 쪽도 적용하지 않고, OFF가 완전한 OFF가 아니라는 안내만 덧붙인다.

### 8.2 일일 사용 한도

`TIER_CONFIG.limits.analysisPerDay`가 전 등급 `Infinity`다. Member 모델이
서버 키 대납으로 전환되므로 회원당 무제한 대납이 된다. 최고가가 $25에서
$12로 내려와 위험은 절반 이하지만 상한은 여전히 없다.

이번 작업 범위 밖으로 두되 별도 과제로 추적한다.

### 8.3 Gemini 프로모 단가 만료

`gemini-3.6-flash` / `3.7-flash` / `3.8-flash`는 2026-12-31까지 $0.75/$3.75이며
2027-01-01부터 $1.50/$7.50로 인상된다. 그 시점에 Free 등급의
`gemini-3.6-flash`가 출력 $7.50이 되어 `claude-haiku-4-5`($5)를 넘어서고
"Free ≤ $5" 원칙이 깨진다. 해당 시점에 등급 재배치 또는 원칙 재조정이 필요하다.

### 8.4 Byok 등급의 provider 편중

Byok 5개가 Claude 3 / GPT 2로 구성되어 Google·DeepSeek 키를 등록해도 열리는
모델이 없다. 사용자 판단으로 이번 범위에서 제외한다.

---

## 9. Public API 영향 (BREAKING)

`src/index.ts`에서 제거되거나 시그니처가 바뀌는 public export다. core는 0.x이므로
minor 범프로 breaking을 표시하고 `docs/PUBLIC_API.md`에
기록한다. 이 작업이 열려 있는 동안 main이 `v0.59.0`(PR #191, market-events)을
먼저 배포했으므로 대상 버전은 `0.59.0 → 0.60.0`이다.

| 심볼 | 위치 | 조치 |
|---|---|---|
| `GEMINI_MODELS_SUPPORTING_DISABLED_THINKING` | `index.ts:180` | 제거 — `spec.reasoning.hardOff`가 대체 |
| `supportsDisabledThinking` | `index.ts:187` | 제거 — 동일 |
| `getThinkingBudgetSequence` | `index.ts:182` | 시그니처 변경 — 숫자 budget 시퀀스에서 `thinkingLevel` 단계 축소로 |
| `DISABLED_THINKING_BUDGET` | `index.ts:404` | 제거 — Gemini가 숫자 budget을 쓰지 않게 됨 |
| `EffortLevel` | `index.ts:418` | 유지하되 `@deprecated`. `ClaudeEffortLevel` / `ChatGptEffortLevel` 신규 export |
| `isReasoningModelSpec` | `index.ts:425` | 시그니처 변경 — `spec.effort`가 `spec.reasoning`으로 이동 |
| `isClaudeSamplingModelSpec` | `index.ts:424` | 시그니처 변경 — 동일 |
| `ModelSpec` 및 5종 변형 | 타입 | 필드 재구성 (`effort`/`thinkingBudget`/`thinking` → `reasoning`) |

신규 export:

| 심볼 | 용도 |
|---|---|
| `ModelAccess` | `'free' \| 'member' \| 'byok'` |
| `getModelAccess` | 모델 → 등급 |
| `isReasoningToggleable` | 소비자 UI의 토글 비활성 판정 |
| `supportsHardOff` | `supportsDisabledThinking` 후속 |
| `ClaudeEffortLevel` / `ChatGptEffortLevel` | provider별 effort union |
| `ReasoningModes` | 스펙 필드 타입 |

`siglens-worker`가 `MODEL_SPECS`를 직접 읽으므로 core 배포 후 worker도 함께
배선해야 한다. 배포 순서는 core publish → siglens → worker.

## 10. 소비자(`siglens`) 영향

core 배포 후 별도 PR로 처리한다.

- `resolveTierAndByok` — §4.3의 member 분기 추가
- `useModelGate.handleModelChange` — `!isFreeModel` 단일 검사에서 3분기로
- `MODEL_DISPLAY_MAP`(`shared/lib/modelDisplay.ts`) — 삭제 9개 제거, 신규 6개 추가
- `providerDefaults.ts` — provider별 우선순위 목록 3개에서 삭제 모델 제거,
  신규 모델 삽입
- 모델 선택 UI 뱃지 — 현재 `!isFreeModel`일 때 "PRO" 하나만 표시한다
  (`widgets/analysis/ModelSelector.tsx:193`, `widgets/chat/ModelSelect.tsx:179`).
  member / byok 2종 구분이 필요하다
- `ReasoningToggle` 배선 — `disabled={!isReasoningToggleable(selectedModel)}`
  를 넘긴다. §8.1.1의 우선순위에 따라 `disabled`가 `locked`를 이긴다.
  모델을 바꾸면 토글의 활성 상태도 따라 바뀌므로 `SymbolModelContext`에서
  선택 모델과 함께 계산해 내려보낸다
- `hardOff: false` 모델 안내 — 토글은 열되 "이 모델은 추론을 완전히 끌 수
  없습니다" 수준의 보조 문구를 노출한다. 문자열은 i18n 카탈로그에 추가해야
  하므로 `yarn i18n:extract --write`를 함께 돌린다
- `DEFAULT_MODEL`·`DEFAULT_PLAIN_MODEL`·`DEFAULT_DIGEST_MODEL_ID`는 모두
  `deepseek-v4.1-flash`이며 Free로 잔존하므로 변경 없다
