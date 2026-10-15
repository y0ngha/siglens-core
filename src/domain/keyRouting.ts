import type { ActiveModelId, Tier } from '@/domain/types';
import { isModelAllowed, requiresByokKey } from '@/domain/tier';

/**
 * Which key pays for a generation.
 *
 * - `'tier'` (default): today's behaviour. The server key covers `'free'` and
 *   `'member'` class models (and every model for a pro-tier caller); only a
 *   `'byok'`-class model on a non-pro tier falls through to `userApiKey`.
 * - `'byok-only'`: every generation uses the caller's own `userApiKey`, for
 *   any model and any tier. No server key is ever read — not for the call, not
 *   for a retry, not for the DeepSeek→Gemini `providerFallback`. A missing
 *   `userApiKey` fails fast, before any provider call.
 *
 * `'byok-only'` changes ONLY who pays. It never changes what is generated or
 * how results are cached: the policy is deliberately absent from every cache
 * key and every Redis lock/result key, so a result produced on a user key and
 * one produced on the server key are the same entry. The one place the policy
 * is scoped is the in-process in-flight join key (see "In-flight sharing"
 * below). `tier` keeps its other
 * meanings under `'byok-only'` — timeframe access, info depth and skill
 * sampling are still derived from it — it just no longer decides the key.
 *
 * **In-flight sharing.** The cache entry and the cross-instance Redis
 * lock/result keys are shared across policies, but the IN-PROCESS in-flight
 * join is not: a `'byok-only'` generation joins only runs with the same policy
 * AND the same `userApiKey` (scoped by a hash of the key, never the raw key),
 * while `'tier'` runs join each other exactly as before. So a website caller
 * never inherits a byok-only caller's bad-key failure or abort, and one
 * byok-only user's bad key never breaks another's run. A cross-instance waiter
 * whose lock winner failed generates on its own key.
 *
 * **Fail closed.** Any value other than `undefined` or `'tier'` (an untyped JS
 * caller's typo, say) is treated as `'byok-only'` — see {@link isByokOnly}.
 *
 * Intended for the public API, where the website keeps `'tier'`.
 */
export type KeyPolicy = 'tier' | 'byok-only';

/**
 * Whether `keyPolicy` means "caller's own key only". Fails closed: only
 * `undefined` and `'tier'` select the tier routing; every other value,
 * including an unknown string, is byok-only.
 */
export function isByokOnly(keyPolicy: unknown): boolean {
    return keyPolicy !== undefined && keyPolicy !== 'tier';
}

/** Policy applied when a caller omits `keyPolicy`. */
export const DEFAULT_KEY_POLICY: KeyPolicy = 'tier';

/**
 * `tier`가 없으면 가장 제한적인 등급으로 본다.
 *
 * `requiresByokKey`는 `tier === 'pro'`만 특별 취급하므로, 미지의 호출자를 free로
 * 접는 것은 "pro 면제를 주지 않는다"와 같은 뜻이다.
 *
 * @internal
 */
function resolveTierOrDefault(tier: Tier | undefined): Tier {
    return tier ?? 'free';
}

/**
 * Determine whether a request should use the server key.
 *
 * Server key covers the `'free'` and `'member'` access classes, plus every
 * model for a pro-tier caller. Only a `'byok'`-class model on a non-pro tier
 * falls through to the user's own key. Under `keyPolicy: 'byok-only'` the
 * answer is always `false` (see {@link KeyPolicy}).
 *
 * ⚠️ Do NOT reimplement this as `isFreeModel(model) || tier === 'pro'`. That
 * was the pre-three-way-axis form, and it charges member-class models to the
 * caller's key — a member requesting `claude-sonnet-5-5` would be told
 * "User API key required" for a model the server pays for. Key routing must
 * go through {@link requiresByokKey}, which is the only classifier that knows
 * the `'member'` class exists.
 */
export function shouldUseServerKey(
    model: ActiveModelId,
    tier: Tier | undefined,
    keyPolicy: KeyPolicy = DEFAULT_KEY_POLICY
): boolean {
    if (isByokOnly(keyPolicy)) return false;
    return !requiresByokKey(resolveTierOrDefault(tier), model);
}

/**
 * Determine whether a request requires a user-provided API key.
 *
 * Symmetric inverse of {@link shouldUseServerKey}: byok-class model AND
 * non-pro tier.
 */
export function requiresUserApiKey(
    model: ActiveModelId,
    tier: Tier | undefined,
    keyPolicy: KeyPolicy = DEFAULT_KEY_POLICY
): boolean {
    if (isByokOnly(keyPolicy)) return true;
    return requiresByokKey(resolveTierOrDefault(tier), model);
}

/**
 * Policy-flag-tracking 검사: 요청된 `model`이 주어진 `tier`에서 core의 현재 tier 정책
 * 하에 허용되는지 core의 `isModelAllowed`에 위임해 검사한다.
 *
 * ⚠️ 이 함수를 "완전히 미지의 model id로 SDK를 호출하는 것을 막는 배리어"로 오해하지
 * 말 것. 현재 정책(`TIER_CONFIG.featureFlags.enableTierRestrictions === false`, 모델
 * 게이팅 OFF)에서는 `resolveAllowedModels`가 tier와 무관하게 `PRO_MODELS`(전체 tier
 * 모델의 합집합)를 반환하므로, 이 함수의 거부 분기는 사실상 도달 불가능하다. 이 문서는
 * 향후 유지보수자가 "이 함수가 어차피 걸러주니 상위 검증을 느슨하게 해도 된다"고 결론
 * 내리지 않도록 명시적으로 남겨둔다 — 이 함수는 core가 tier restrictions를 다시 켰을
 * 때를 위한 정책-추적용 검사이지, 오늘의 1차 방어선이 아니다.
 *
 * tier→model 접근 제어의 1차 책임은 호출 측(siglens의 BYOK 게이트)에 있다. 이전
 * 구현은 `TIER_CONFIG.models[tier]`의 intrinsic membership을 직접 봐서 core의 정책
 * 플래그를 무시했는데, 그 결과 member가 자기 키로 `claude-opus-5` 같은 pro 전용 모델을
 * 선택하면 상위 게이트(free/premium만 구분)는 통과시키지만 이 함수가 도로 거부해
 * 삼켜진 400이 무한 스피너로 이어졌다(siglens-worker#21 리뷰에서 확인).
 * `isModelAllowed`에 위임함으로써 이 정책 불일치를 해소한다.
 *
 * 비용 안전장치는 이 함수의 책임이 아니다 — `shouldUseServerKey`/`requiresUserApiKey`가
 * `requiresByokKey`(3분류 접근 등급 기반, `enableTierRestrictions`와 무관)를 통해 별도로
 * 담당하며, 이 경로는 전혀 바뀌지 않는다.
 *
 * @returns `tier`가 undefined면 검사 생략(true). 그 외에는 `isModelAllowed`가 참조하는
 * roster(현재 정책 하에서는 `PRO_MODELS`)에 등록된 model이면 true, 그 roster 어디에도
 * 없는 model(오탈자·deprecated 등)이면 false.
 *
 * 이 JSDoc이 위 정책(enableTierRestrictions, 오늘 이 함수가 사실상 no-op인 이유)에
 * 대한 canonical 설명이다. 관련 테스트 주석은 이 설명을 재서술하지 않고 이 JSDoc을
 * 가리키는 pointer만 유지한다 — 정책이 바뀌면 여기 한 곳만 갱신하면 되도록.
 */
export function isModelAllowedForTier(
    model: ActiveModelId,
    tier: Tier | undefined
): boolean {
    if (tier === undefined) return true;
    return isModelAllowed(tier, model);
}
