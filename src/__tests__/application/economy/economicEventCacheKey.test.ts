import { describe, it, expect } from 'vitest';
import {
    buildEconomicEventCacheKey,
    ECONOMIC_EVENT_PROMPT_TEMPLATE_VERSION,
    ECONOMIC_EVENT_CACHE_TTL,
} from '@/infrastructure/cache/config';
import { hashAnalysisInput } from '@/infrastructure/hash/analysisInput';
import type { EconomicEventAnalysisInput } from '@/domain/economy/types';

const BASE_INPUT: EconomicEventAnalysisInput = {
    event: 'CPI MoM',
    impact: 'High',
    actual: 0.2,
    estimate: 0.3,
    previous: 0.4,
    unit: '%',
};

function makeHash(input: EconomicEventAnalysisInput): string {
    return hashAnalysisInput(
        JSON.stringify({
            event: input.event,
            impact: input.impact,
            actual: input.actual,
            estimate: input.estimate,
            previous: input.previous,
            unit: input.unit,
        })
    );
}

describe('buildEconomicEventCacheKey', () => {
    it('올바른 키 형식 반환 (v1:analysis:economic-event:<hash>:p1)', () => {
        const hash = makeHash(BASE_INPUT);
        const key = buildEconomicEventCacheKey(hash);
        expect(key).toMatch(/^v1:analysis:economic-event:[0-9a-f]{16}:p1$/);
    });

    it('동일 입력 해시 → 동일 캐시 키(결정적)', () => {
        const hash = makeHash(BASE_INPUT);
        expect(buildEconomicEventCacheKey(hash)).toBe(
            buildEconomicEventCacheKey(hash)
        );
    });

    it('프롬프트 버전 상수가 키에 포함', () => {
        const hash = makeHash(BASE_INPUT);
        const key = buildEconomicEventCacheKey(hash);
        expect(key).toContain(ECONOMIC_EVENT_PROMPT_TEMPLATE_VERSION);
    });

    it('actual 값이 다르면 키도 달라짐', () => {
        const hashA = makeHash(BASE_INPUT);
        const hashB = makeHash({ ...BASE_INPUT, actual: 0.5 });
        expect(buildEconomicEventCacheKey(hashA)).not.toBe(
            buildEconomicEventCacheKey(hashB)
        );
    });

    it('이벤트 이름이 다르면 키도 달라짐', () => {
        const hashA = makeHash(BASE_INPUT);
        const hashB = makeHash({ ...BASE_INPUT, event: 'PPI MoM' });
        expect(buildEconomicEventCacheKey(hashA)).not.toBe(
            buildEconomicEventCacheKey(hashB)
        );
    });

    it('actual=null 이어도 결정적 해시를 가진 키 반환', () => {
        const hash = makeHash({ ...BASE_INPUT, actual: null });
        const key = buildEconomicEventCacheKey(hash);
        expect(key).toMatch(/^v1:analysis:economic-event:[0-9a-f]{16}:p1$/);
    });

    it('ECONOMIC_EVENT_CACHE_TTL이 양수(24h = 86400s)', () => {
        expect(ECONOMIC_EVENT_CACHE_TTL).toBeGreaterThan(0);
        expect(ECONOMIC_EVENT_CACHE_TTL).toBe(86400);
    });
});
