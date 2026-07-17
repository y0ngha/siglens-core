// This section is a deliberate exception to the repo's "AI-facing prompt
// strings must be in English" convention (see prompt.ts and siblings): the
// hint's entire content IS the literal Korean phrase the model should weave
// into its (Korean) output, mirroring how other prompt builders embed exact
// Korean example strings for output-language fields (e.g. prompt.ts's
// '상단 추세선' / '분석 시점 가격' instructions). Nothing here is an
// English instruction that got translated by mistake.

import type { PositionBucket } from '@/domain/types';

/**
 * @internal Korean band name shown to the model for each {@link PositionBucket}.
 * Intentionally coarse/qualitative — no numeric figure ever appears here.
 */
const POSITION_BUCKET_LABEL_KO: Record<PositionBucket, string> = {
    'deep-profit': '깊은 수익',
    profit: '수익',
    'near-breakeven': '본전 부근',
    loss: '손실',
    'deep-loss': '깊은 손실',
};

/**
 * @internal Formats the member position-bucket hint section; not part of the
 * public API (personalized-analysis-by-position-bucket spec, Subsystem C).
 *
 * Emits a single neutral reference line naming the member's coarse
 * unrealized-P&L band. Deliberately:
 * - **Qualitative only** — no raw average price, quantity, or percentage
 *   ever appears (the bucket itself already strips that information; see
 *   {@link bucketizePosition} in `positionBucket.ts`).
 * - **Non-instructive** — states the band as reference context ("참고: ...")
 *   rather than telling the model what to recommend, so per-user financial
 *   advice stays governed by the existing analysis guardrails, not by this
 *   hint.
 *
 * Used only by {@link buildAnalysisPrompt} (technical/chart analysis, v1
 * scope) — pushed into the `dynamic` section array, never `stable`, since a
 * per-member value must not pollute the byte-cached stable system-prompt
 * prefix that's shared across every caller regardless of holding.
 *
 * @param bucket - The member's position bucket.
 * @returns The formatted hint line.
 */
export function formatPositionHintSection(bucket: PositionBucket): string {
    return `참고: 이 사용자는 현재 이 종목에서 '${POSITION_BUCKET_LABEL_KO[bucket]}' 구간에 있습니다.`;
}
