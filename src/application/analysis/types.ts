import type { BriefingModelId } from '@/application/analysis/briefingModel';
import type { ActiveModelId, Tier } from '@/domain/types';

/** 분석 AI 호출 옵션. worker의 11개 positional 인자를 옵션 객체로 대체한다. */
export interface CallAnalysisAiOptions {
    prompt: string;
    model: ActiveModelId;
    /**
     * 호출자가 이미 게이팅한 tier. `undefined`면 tier 검사를 생략하고
     * 서버 키/BYOK 판정만 수행한다(`shouldUseServerKey`).
     */
    tier?: Tier;
    /** BYOK. 서버 키를 쓰지 않는 경로(byok 등급 모델 + non-pro tier)에서 필수. */
    userApiKey?: string;
    signal?: AbortSignal;
    system?: string;
    responseSchema?: unknown;
    seed?: number;
    /**
     * "깊은 생각" 토글. `false`=모델 스펙의 `reasoning.off`, `true`=`reasoning.on`,
     * `undefined`=스펙의 `reasoning.default`.
     *
     * `false`가 곧 "추론 없음"은 아니다 — 완전히 끄지 못하는 모델이 있다
     * (`supportsHardOff` 참고). tier 강제(free→false)는 호출 측 책임이다.
     */
    reasoning?: boolean;
    /**
     * 로그 상관용 식별자. 이전에는 `jobId`였으나 job 큐가 제거되면서 이름만 남으면
     * 거짓이 되므로 개명했다. AI 호출 자체에는 영향을 주지 않는다.
     */
    correlationId?: string;
    /**
     * When `true`, a server-key DeepSeek call that fails for provider reasons is
     * retried once on the Gemini fallback model. **Off by default.** Only callers
     * where the user cannot choose the model (SEO prewarm, the ai.siglens.io agent)
     * set it — a user-chosen model must not change silently; its failure should
     * surface so the user can switch models (product decision 2026-09-15).
     */
    fallbackOnProviderFailure?: boolean;
}

/**
 * 브리핑 AI 호출 옵션.
 *
 * 브리핑은 tier/BYOK 개념이 없이 항상 서버 키를 쓴다 — `callAnalysisAi`를 재사용하면
 * tier가 undefined일 때 non-free 모델이 BYOK 경로를 타서 브리핑이 깨진다
 * (예: gemini-3.1-pro-preview override).
 */
export interface CallBriefingAiOptions {
    prompt: string;
    /** 요청된 모델(임의 값 허용). 브리핑 불가 모델이면 `fallbackModel`로 degrade된다. */
    requestedModel?: unknown;
    /**
     * 브리핑 가능 기본 모델. `BriefingModelId`(gemini | deepseek)로 제한되므로
     * claude/gpt를 fallback으로 넘기면 컴파일 단계에서 걸린다.
     */
    fallbackModel: BriefingModelId;
    signal?: AbortSignal;
    correlationId?: string;
}
