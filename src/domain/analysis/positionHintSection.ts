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
 * @internal Per-band position-management orientation phrase for each
 * {@link PositionBucket}. Each entry names the **holder's** vantage point for
 * that band (보유자 관점) and the management trade-off the analysis should be
 * oriented around — e.g. 부분 익절 vs 보유 지속 in profit, 손절 규율 vs 추가매수 in
 * loss. Deliberately verb-bearing (익절/손절/추가매수/보유): unlike the band label
 * above, these ARE the instructive part of the hint.
 *
 * Still strictly bucket-qualitative — describes the *kind* of decision a holder
 * in this band typically weighs, never a numeric level, size, or target, so the
 * "no raw figures" guarantee is preserved (the bucket already strips price /
 * quantity; see {@link bucketizePosition} in `positionBucket.ts`).
 */
const POSITION_BUCKET_MGMT_KO: Record<PositionBucket, string> = {
    'deep-profit':
        '이미 큰 평가이익을 확보한 보유자 관점 — 이익 실현(전량·부분 익절)과 추세 지속 시 보유 지속 사이의 판단',
    profit: '이익 구간 보유자 관점 — 부분 익절과 보유 지속 판단',
    'near-breakeven':
        '본전 부근 보유자 관점 — 손익분기 방어와 방향 확인 후 대응',
    loss: '손실 구간 보유자 관점 — 손절 규율과 반등 시 대응, 추가매수 여부 판단',
    'deep-loss': '큰 손실 구간 보유자 관점 — 냉정한 손절·보유·분할 대응 판단',
};

/**
 * @internal Formats the member position-bucket hint section; not part of the
 * public API (personalized-analysis-by-position-bucket spec, Subsystem C).
 *
 * Emits an **instructive** position-management framing: it tells the model the
 * member is ALREADY HOLDING this symbol in the given band and to orient the
 * analysis conclusion and trading-strategy (진입/청산/리스크) sections toward
 * *managing that position* (보유 지속 / 부분 익절 / 추가매수·물타기 / 손절 규율
 * 시나리오) rather than toward a fresh would-be-buyer entry.
 *
 * **This is a deliberate, product-approved relaxation of the prior
 * non-instructive design.** The earlier version injected a single passive
 * "참고: ... 구간에 있습니다." reference line and left the framing entirely to the
 * base guardrails; in practice the model treated it as minor context and still
 * produced generic entry-zone analysis, so the "내 평단 기준으로 분석했어요" badge
 * over-promised. The product owner approved strengthening the hint to a holder
 * (position-management) perspective. Two invariants are preserved through that
 * relaxation:
 * - **Bucket-qualitative only** — no raw average price, quantity, amount, or
 *   percentage ever appears (the bucket itself already strips that information;
 *   see {@link bucketizePosition} in `positionBucket.ts`). The emitted string
 *   contains no digits.
 * - **Disclaimer-safe** — framed as a 보유자 관점 / 일반적 시나리오 (scenario /
 *   perspective guidance), explicitly NOT assuming a specific holding size or
 *   amount, and keeping "최종 판단과 책임은 사용자에게 있음" (the final judgment is the
 *   user's). It never commands a specific action to a specific user, so
 *   per-user financial-advice governance stays with the existing analysis
 *   guardrails.
 *
 * Used only by {@link buildAnalysisPrompt} (technical/chart analysis, v1
 * scope) — pushed into the `dynamic` section array, never `stable`, since a
 * per-member value must not pollute the byte-cached stable system-prompt
 * prefix that's shared across every caller regardless of holding.
 *
 * @param bucket - The member's position bucket.
 * @returns The formatted hint line, or `''` when `bucket` doesn't resolve to
 *   a known {@link POSITION_BUCKET_LABEL_KO} entry (e.g. a runtime value
 *   outside the `PositionBucket` union) — defensive guard against emitting a
 *   literal `'undefined'` into a user-facing prompt. Callers must treat an
 *   empty string as "no hint" and skip it rather than pushing it as a
 *   section (see {@link buildAnalysisPrompt}'s dynamic-section assembly).
 */
export function formatPositionHintSection(bucket: PositionBucket): string {
    const label = POSITION_BUCKET_LABEL_KO[bucket];
    const mgmt = POSITION_BUCKET_MGMT_KO[bucket];
    if (label === undefined || mgmt === undefined) return '';
    return `이 사용자는 이 종목을 이미 보유 중이며 현재 '${label}' 구간입니다. 신규 진입자 관점이 아니라 ${mgmt}에서, 분석 결론과 매매 전략(진입/청산/리스크)을 보유 포지션 관리 관점으로 서술하세요. 단, 특정 보유 규모·금액을 가정하지 말고 일반적 시나리오로 서술하며, 최종 판단과 책임은 사용자에게 있음을 전제로 하세요.`;
}
