import { describe, it, expect } from 'vitest';
import { buildMacroBriefingPrompt } from '@/domain/economy/macroBriefingPrompt';
import type { EconomySnapshot } from '@/domain/economy/types';

const SNAP: EconomySnapshot = {
    indicators: [
        {
            name: 'federalFunds',
            latest: { date: '2026-05-01', value: 3.63 },
            previous: { date: '2026-04-01', value: 3.58 },
            trend: [],
        },
        {
            name: 'inflationRate',
            latest: { date: '2026-06-15', value: 2.32 },
            previous: null,
            trend: [],
        },
    ],
    treasury: { date: '2026-06-15', year2: 4.07, year10: 4.47 },
    calendar: [
        {
            date: '2026-06-17 14:00:00',
            event: 'Fed Rate Decision',
            impact: 'High',
            actual: null,
            estimate: 3.63,
            previous: 3.63,
            unit: '%',
        },
    ],
};

describe('buildMacroBriefingPrompt', () => {
    it('지표·2s10s·임박 캘린더를 프롬프트에 포함', () => {
        const p = buildMacroBriefingPrompt(SNAP);
        expect(p).toContain('federalFunds');
        expect(p).toContain('3.63');
        expect(p).toContain('Fed Rate Decision');
        expect(p).toContain('0.40'); // 2s10s = 4.47 - 4.07
    });

    it('스키마(JSON 필드)·데이터 경계 지시 포함', () => {
        const p = buildMacroBriefingPrompt(SNAP);
        expect(p).toContain('"regime"');
        expect(p).toContain('Data Boundary');
    });

    it('빈 스냅샷에도 throw 없이 문자열 반환', () => {
        const p = buildMacroBriefingPrompt({
            indicators: [],
            treasury: null,
            calendar: [],
        });
        expect(typeof p).toBe('string');
        expect(p.length).toBeGreaterThan(0);
        expect(p).toContain('(없음)');
    });

    it('latest=null 지표는 N/A, treasury=null이면 2s10s N/A', () => {
        const p = buildMacroBriefingPrompt({
            indicators: [
                { name: 'GDP', latest: null, previous: null, trend: [] },
            ],
            treasury: null,
            calendar: [],
        });
        expect(p).toContain('GDP: N/A');
        expect(p).toContain('2s10s 스프레드: N/A');
    });

    it('estimate=null 캘린더 이벤트는 예상=N/A로 표기', () => {
        const p = buildMacroBriefingPrompt({
            indicators: [],
            treasury: null,
            calendar: [
                {
                    date: '2026-06-17 14:00:00',
                    event: 'Fed Rate Decision',
                    impact: 'High',
                    actual: null,
                    estimate: null,
                    previous: null,
                    unit: '%',
                },
            ],
        });
        expect(p).toContain('예상=N/A');
    });
});
