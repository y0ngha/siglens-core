import type { ActiveModelId, Tier } from '@/domain/types';
import { isFreeModel, isModelAllowed } from '@/domain/tier';

/**
 * Determine whether a request should use the server key.
 *
 * Server key is used when:
 * - Model is a free-tier model (server-managed)
 * - OR user is on pro tier (server pays for premium)
 */
export function shouldUseServerKey(
    model: ActiveModelId,
    tier: Tier | undefined
): boolean {
    return isFreeModel(model) || tier === 'pro';
}

/**
 * Determine whether a request requires a user-provided API key.
 *
 * Symmetric inverse of `shouldUseServerKey` for the case when a user key
 * is mandatory: non-free model AND non-pro tier.
 */
export function requiresUserApiKey(
    model: ActiveModelId,
    tier: Tier | undefined
): boolean {
    return !isFreeModel(model) && tier !== 'pro';
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
 * `isFreeModel`(free vs premium 분류, `enableTierRestrictions`와 무관)을 기반으로 별도로
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
