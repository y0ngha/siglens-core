import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import type {
    DeepSeekModelId,
    GeminiModelId,
} from '@/domain/analysis/modelSpecs';

/**
 * 브리핑이 라우팅할 수 있는 모델 — `callBriefingAi`가 디스패치를 배선한 provider만
 * 포함한다. 타입으로 좁혀두면 호출부에서 "지원하지 않는 provider" 런타임 가드가
 * 필요 없어진다.
 */
export type BriefingModelId = GeminiModelId | DeepSeekModelId;

function isBriefingCapable(model: string): model is BriefingModelId {
    if (!(model in MODEL_SPECS)) return false;
    const { provider } = MODEL_SPECS[model as keyof typeof MODEL_SPECS];
    return provider === 'gemini' || provider === 'deepseek';
}

/**
 * Resolves the model to use for a briefing job.
 *
 * Briefing only supports providers whose dispatch is wired up in
 * `callBriefingAi` — currently Gemini and DeepSeek. This resolver's contract is
 * therefore "returns a briefing-capable model": it returns the request-supplied
 * model only when it is a supported Gemini or DeepSeek model, and otherwise
 * (absent, unknown, or a supported-but-non-briefing model such as claude/gpt)
 * falls back to the configured server-side default. Gracefully degrading
 * non-briefing models here is what lets `callBriefingAi` dispatch exhaustively
 * without a runtime "unsupported provider" guard.
 */
export function resolveBriefingModel(
    requestedModel: unknown,
    fallback: BriefingModelId
): BriefingModelId {
    if (typeof requestedModel !== 'string') return fallback;
    return isBriefingCapable(requestedModel) ? requestedModel : fallback;
}
