import { describe, it, expect } from 'vitest';
import { fixtures } from '@/__tests__/domain/patterns/fixtures/generate';

import hsTextbook from '@/__tests__/domain/patterns/fixtures/hs-textbook.json';
import doubleTop from '@/__tests__/domain/patterns/fixtures/double-top.json';
import ascendingTriangle from '@/__tests__/domain/patterns/fixtures/ascending-triangle.json';
import bullFlag from '@/__tests__/domain/patterns/fixtures/bull-flag.json';
import cupAndHandle from '@/__tests__/domain/patterns/fixtures/cup-and-handle.json';

/**
 * Guards against generator/JSON drift: `generate.ts`'s in-memory fixture
 * builders (`fixtures`) must produce byte-for-byte the same data as the
 * committed JSON fixtures consumed by `screenChartPatterns.test.ts`. If
 * someone edits the builder segments without re-running the generator (or
 * vice versa), this fails instead of silently testing stale data.
 */
const COMMITTED_JSON: Record<string, unknown> = {
    'hs-textbook.json': hsTextbook,
    'double-top.json': doubleTop,
    'ascending-triangle.json': ascendingTriangle,
    'bull-flag.json': bullFlag,
    'cup-and-handle.json': cupAndHandle,
};

describe('fixture generator는 committed JSON과 drift가 없다', () => {
    it.each(fixtures.map(fixture => [fixture.file, fixture] as const))(
        '%s',
        (file, fixture) => {
            const committed = COMMITTED_JSON[file];
            expect(committed).toBeDefined();
            expect({ atr: fixture.atr, bars: fixture.bars }).toEqual(committed);
        }
    );

    it('committed JSON 파일 5개 모두를 검증한다', () => {
        expect(fixtures.map(f => f.file).sort()).toEqual(
            Object.keys(COMMITTED_JSON).sort()
        );
    });
});
