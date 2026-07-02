/** @internal 스크리너가 식별 가능한 차트 패턴 ID — skills/patterns/*.md 파일명과 1:1. */
export type ChartPatternId =
    | 'head_and_shoulders'
    | 'inverse_head_and_shoulders'
    | 'double_top'
    | 'double_bottom'
    | 'triple_top'
    | 'triple_bottom'
    | 'ascending_triangle'
    | 'descending_triangle'
    | 'symmetrical_triangle'
    | 'ascending_wedge'
    | 'descending_wedge'
    | 'bull_flag'
    | 'bear_flag'
    | 'pennant'
    | 'rectangle'
    | 'cup_and_handle'
    | 'rounding_bottom';

/** @internal A confirmed zigzag extreme — a local high or low that survived the ATR-relative reversal threshold. */
export interface PivotPoint {
    /** bars 배열 인덱스. */
    index: number;
    price: number;
    kind: 'high' | 'low';
}

/** @internal A pre-screener candidate hit — a coarse, recall-biased match for one pattern ID over a bar range. */
export interface PatternCandidate {
    id: ChartPatternId;
    /** 판정에 사용된 피벗들의 bar 인덱스 범위. */
    startIndex: number;
    endIndex: number;
}
