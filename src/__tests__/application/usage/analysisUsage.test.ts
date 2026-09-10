import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
    checkAnalysisUsageAllowed,
    recordAnalysisUsageSafely,
} from '@/application/usage/analysisUsage';
import type { AnalysisUsageOptions } from '@/application/usage/types';
import type { TierConfig } from '@/domain/types';
import type { UsageRepository } from '@/domain/ports/usageRepository';
import { hashUsageIp } from '@/infrastructure/usage/hash';

const restrictedConfig: TierConfig = {
    limits: {
        analysisPerDay: { free: 2, member: 10, pro: Infinity },
        chatbotPerDay: { free: 3, member: 20, pro: Infinity },
    },
    timeframes: { free: ['1Day'], member: ['1Day'], pro: ['1Day'] },
    infoDepth: { free: ['summary'], member: ['summary'], pro: ['summary'] },
    models: {
        free: ['gemini-3.6-flash'],
        member: ['gemini-3.6-flash'],
        pro: ['gemini-3.6-flash'],
    },
    featureFlags: { enableTierRestrictions: true },
};

const unrestrictedConfig: TierConfig = {
    ...restrictedConfig,
    featureFlags: { enableTierRestrictions: false },
};

function makeUsageRepository(overrides?: {
    recordUsage?: Mock;
    getUsageToday?: Mock;
}): UsageRepository {
    return {
        recordUsage:
            overrides?.recordUsage ?? vi.fn().mockResolvedValue(undefined),
        getUsageToday:
            overrides?.getUsageToday ??
            vi.fn().mockResolvedValue({ analysis: 0, chatbot: 0 }),
    };
}

function makeUsage(
    repo: UsageRepository,
    extra?: Partial<AnalysisUsageOptions>
): AnalysisUsageOptions {
    return {
        usageRepository: repo,
        clientIp: '203.0.113.10',
        ...extra,
    };
}

describe('recordAnalysisUsageSafely', () => {
    it('is a no-op when usage is undefined', async () => {
        // Branch (1): usage === undefined
        await expect(
            recordAnalysisUsageSafely(undefined, 'gemini-3.6-flash', new Date())
        ).resolves.toBeUndefined();
    });

    it('records usage with the provided occurredAt and effective model id', async () => {
        // Branch (2): success path; modelUsed/userId omitted → defaults applied
        const recordUsage = vi.fn().mockResolvedValue(undefined);
        const usage = makeUsage(makeUsageRepository({ recordUsage }));
        const occurredAt = new Date('2026-04-29T00:00:00.000Z');

        await recordAnalysisUsageSafely(usage, 'gemini-3.6-flash', occurredAt);

        expect(recordUsage).toHaveBeenCalledTimes(1);
        expect(recordUsage).toHaveBeenCalledWith({
            userId: null,
            ipAddress: '203.0.113.10',
            actionType: 'analysis',
            modelUsed: 'gemini-3.6-flash',
            occurredAt,
        });
    });

    it('prefers usage.modelUsed and usage.userId over defaults when provided', async () => {
        // Branch (2) variant: modelUsed/userId provided → overrides used
        const recordUsage = vi.fn().mockResolvedValue(undefined);
        const usage = makeUsage(makeUsageRepository({ recordUsage }), {
            userId: 'user-abc',
            modelUsed: 'override-model',
        });

        await recordAnalysisUsageSafely(usage, 'gemini-3.6-flash');

        expect(recordUsage).toHaveBeenCalledWith({
            userId: 'user-abc',
            ipAddress: '203.0.113.10',
            actionType: 'analysis',
            modelUsed: 'override-model',
            occurredAt: undefined,
        });
    });

    it('catches repository errors, logs via console.warn, and does not rethrow', async () => {
        // Branch (3): catch path
        const consoleWarn = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);
        const error = new Error('DB error');
        const recordUsage = vi.fn().mockRejectedValue(error);
        const usage = makeUsage(makeUsageRepository({ recordUsage }));

        await expect(
            recordAnalysisUsageSafely(usage, 'gemini-3.6-flash')
        ).resolves.toBeUndefined();

        expect(consoleWarn).toHaveBeenCalledWith(
            '[recordAnalysisUsageSafely] Failed to record analysis usage:',
            error
        );
        consoleWarn.mockRestore();
    });
});

describe('checkAnalysisUsageAllowed', () => {
    const occurredAt = new Date('2026-04-29T00:00:00.000Z');

    it('hashes the client IP with the same UTC daily salt and delegates to checkAnalysisLimit', async () => {
        // Branch (4): correctly hashed clientIp + tier passed to underlying check
        const expectedHash = hashUsageIp('203.0.113.10', occurredAt);
        const getUsageToday = vi
            .fn()
            .mockResolvedValue({ analysis: 0, chatbot: 0 });
        const usage = makeUsage(makeUsageRepository({ getUsageToday }));

        const result = await checkAnalysisUsageAllowed(
            usage,
            'free',
            occurredAt,
            restrictedConfig
        );

        expect(result).toBe(true);
        expect(getUsageToday).toHaveBeenCalledWith(expectedHash, occurredAt);
    });

    it('returns true when underlying check allows (below tier limit)', async () => {
        // Branch (5a): underlying check returns true
        const usage = makeUsage(
            makeUsageRepository({
                getUsageToday: vi
                    .fn()
                    .mockResolvedValue({ analysis: 1, chatbot: 0 }),
            })
        );

        await expect(
            checkAnalysisUsageAllowed(
                usage,
                'free',
                occurredAt,
                restrictedConfig
            )
        ).resolves.toBe(true);
    });

    it('returns false when underlying check blocks (limit reached)', async () => {
        // Branch (5b): underlying check returns false
        const usage = makeUsage(
            makeUsageRepository({
                getUsageToday: vi
                    .fn()
                    .mockResolvedValue({ analysis: 2, chatbot: 0 }),
            })
        );

        await expect(
            checkAnalysisUsageAllowed(
                usage,
                'free',
                occurredAt,
                restrictedConfig
            )
        ).resolves.toBe(false);
    });

    it('returns true when tier restrictions are disabled by config (short-circuit)', async () => {
        // Branch (6): config short-circuit through underlying check; usage repo never read
        const getUsageToday = vi
            .fn()
            .mockResolvedValue({ analysis: 999, chatbot: 0 });
        const usage = makeUsage(makeUsageRepository({ getUsageToday }));

        const result = await checkAnalysisUsageAllowed(
            usage,
            'free',
            occurredAt,
            unrestrictedConfig
        );

        expect(result).toBe(true);
        expect(getUsageToday).not.toHaveBeenCalled();
    });
});
