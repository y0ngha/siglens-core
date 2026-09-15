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
     * `true`면 서버 키 DeepSeek 호출이 공급자 사유로 실패했을 때 `DEEPSEEK_FALLBACK_MODEL`
     * (Gemini)로 한 번 재시도한다. **기본은 끔.** 사용자가 모델을 고를 수 없는 경로
     * (SEO 프리웜, ai.siglens.io 에이전트)만 켠다 — 사용자가 고른 모델은 조용히 바뀌면
     * 안 되고, 실패를 드러내 모델 변경을 안내해야 한다(사용자 결정 2026-09-15).
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
