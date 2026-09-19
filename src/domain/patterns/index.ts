/** @internal */
export { screenChartPatterns } from '@/domain/patterns/screenChartPatterns';
/** @internal */
export { computeCandidateGeometry } from '@/domain/patterns/patternGeometry';
// ChartPatternId / PatternCandidate are public (src/index.ts) — see
// domain/types.ts. PivotKind/PivotPoint are public too: `PatternCandidate`
// additively carries `pivots?: PivotPoint[]` (spec 2026-09-18 real-data fix),
// so both are reachable from a public type and must type-check for consumers.
export type {
    ChartPatternId,
    PatternCandidate,
    PivotKind,
    PivotPoint,
} from '@/domain/types';
