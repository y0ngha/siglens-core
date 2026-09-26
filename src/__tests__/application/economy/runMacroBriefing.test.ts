import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/application/analysis/callBriefingAi');
vi.mock('@/infrastructure/cache/redis');

import { runMacroBriefing } from '@/application/economy/runMacroBriefing';
import { callBriefingAi } from '@/application/analysis/callBriefingAi';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { MACRO_BRIEFING_CACHE_TTL } from '@/infrastructure/cache/config';
import type { EconomySnapshot } from '@/domain/types';

const mockCallBriefingAi = callBriefingAi as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

const mockBriefingRaw = {
    summary: '연준 동결 기조 유지.',
    highlights: ['연방기금금리 동결'],
    regime: 'neutral',
};

const mockCachedBriefing = {
    summary: '캐시된 매크로 브리핑.',
    highlights: [],
    regime: 'risk_off',
};

const SNAP: EconomySnapshot = {
    indicators: [
        {
            name: 'federalFunds',
            latest: { date: '2026-07-01', value: 4.25 },
            previous: { date: '2026-06-01', value: 4.25 },
            trend: [],
        },
    ],
    treasury: { date: '2026-07-15', year2: 4.1, year10: 4.5 },
    calendar: [],
};

describe('runMacroBriefing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-02T10:00:00.000Z'));
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheGet.mockResolvedValue(null);
        mockCacheSet.mockResolvedValue(undefined);
        mockCallBriefingAi.mockResolvedValue(JSON.stringify(mockBriefingRaw));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('cache hit', () => {
        it('cache hit → callBriefingAi NOT called, returns {status:"cached"}', async () => {
            mockCacheGet.mockResolvedValueOnce({
                briefing: mockCachedBriefing,
                generatedAt: '2026-08-02T10:00:00.000Z',
            });

            const result = await runMacroBriefing(SNAP);

            expect(result.status).toBe('cached');
            expect(mockCallBriefingAi).not.toHaveBeenCalled();
        });

        it('briefing == null인 envelope은 cache miss로 처리하고 LLM을 태운다', async () => {
            mockCacheGet.mockResolvedValueOnce({
                briefing: null,
                generatedAt: '2026-08-02T10:00:00.000Z',
            });

            const result = await runMacroBriefing(SNAP);

            expect(result.status).toBe('done');
            expect(mockCallBriefingAi).toHaveBeenCalledTimes(1);
        });

        it('캐시 히트 시 generatedAt을 그대로 반환한다', async () => {
            const generatedAt = '2026-08-02T10:00:00.000Z';
            mockCacheGet.mockResolvedValueOnce({
                briefing: mockCachedBriefing,
                generatedAt,
            });

            const result = await runMacroBriefing(SNAP);

            if (result.status === 'cached') {
                expect(result.generatedAt).toBe(generatedAt);
            }
        });
    });

    describe('cache miss → LLM', () => {
        it('callBriefingAi를 1회 호출하고 done을 반환한다', async () => {
            const result = await runMacroBriefing(SNAP);

            expect(mockCallBriefingAi).toHaveBeenCalledTimes(1);
            expect(result.status).toBe('done');
        });

        it('signal을 callBriefingAi에 그대로 전달한다', async () => {
            const controller = new AbortController();

            await runMacroBriefing(SNAP, { signal: controller.signal });

            expect(mockCallBriefingAi).toHaveBeenCalledWith(
                expect.objectContaining({ signal: controller.signal })
            );
        });

        it('결과를 MACRO_BRIEFING_CACHE_TTL로 캐시에 기록한다', async () => {
            await runMacroBriefing(SNAP);

            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    briefing: expect.any(Object),
                    generatedAt: expect.any(String),
                }),
                MACRO_BRIEFING_CACHE_TTL
            );
        });
    });

    describe('캐시 프로바이더 없음', () => {
        it('cache provider null이면 조회 건너뛰고 LLM을 호출한다', async () => {
            mockCreateCacheProvider.mockReturnValueOnce(null);

            const result = await runMacroBriefing(SNAP);

            expect(result.status).toBe('done');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCallBriefingAi).toHaveBeenCalledTimes(1);
        });
    });

    describe('in-flight 중복 제거', () => {
        it('같은 캐시 키 동시 호출은 LLM을 1회만 태운다', async () => {
            let resolveAi: (value: string) => void = () => {};
            mockCallBriefingAi.mockReturnValueOnce(
                new Promise<string>(resolve => {
                    resolveAi = resolve;
                })
            );

            const both = Promise.all([
                runMacroBriefing(SNAP),
                runMacroBriefing(SNAP),
            ]);

            resolveAi(JSON.stringify(mockBriefingRaw));
            const [a, b] = await both;

            expect(mockCallBriefingAi).toHaveBeenCalledTimes(1);
            expect(a.status).toBe('done');
            expect(b.status).toBe('done');
        });
    });

    describe('캐시 장애 내성', () => {
        it('캐시 조회가 실패하면 로그만 남기고 LLM 브리핑 후 같은 키로 캐시에 기록한다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            mockCacheGet.mockRejectedValueOnce(new Error('redis down'));

            const result = await runMacroBriefing(SNAP);

            expect(result.status).toBe('done');
            expect(result.briefing.summary).toBe(mockBriefingRaw.summary);
            expect(mockCallBriefingAi).toHaveBeenCalledTimes(1);
            expect(mockCacheSet).toHaveBeenCalledWith(
                mockCacheGet.mock.calls[0][0],
                {
                    briefing: result.briefing,
                    generatedAt: '2026-08-02T10:00:00.000Z',
                },
                MACRO_BRIEFING_CACHE_TTL
            );
            expect(errorSpy).toHaveBeenCalledWith(
                '[RunMacroBriefing] Cache read failed:',
                expect.any(Error)
            );
            errorSpy.mockRestore();
        });

        it('캐시 쓰기가 실패해도 브리핑은 그대로 반환되고 오류는 로그로만 남는다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            const writeError = new Error('redis write failed');
            mockCacheSet.mockRejectedValueOnce(writeError);

            const result = await runMacroBriefing(SNAP);

            expect(result.status).toBe('done');
            expect(result.briefing.summary).toBe(mockBriefingRaw.summary);
            await vi.waitFor(() =>
                expect(errorSpy).toHaveBeenCalledWith(
                    '[RunMacroBriefing] Cache write failed:',
                    writeError
                )
            );
            errorSpy.mockRestore();
        });
    });

    describe('빈 브리핑', () => {
        it('LLM 응답에 summary가 없으면 경고를 남기고 빈 summary로 done을 반환한다', async () => {
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => undefined);
            mockCallBriefingAi.mockResolvedValueOnce(
                JSON.stringify({ highlights: ['부분 응답'] })
            );

            const result = await runMacroBriefing(SNAP);

            expect(result.status).toBe('done');
            expect(result.briefing.summary).toBe('');
            expect(warnSpy).toHaveBeenCalledWith(
                '[RunMacroBriefing] Empty briefing — summary field absent'
            );
            warnSpy.mockRestore();
        });

        it('summary가 있으면 빈 브리핑 경고를 남기지 않는다', async () => {
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => undefined);

            await runMacroBriefing(SNAP);

            expect(warnSpy).not.toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });
});
