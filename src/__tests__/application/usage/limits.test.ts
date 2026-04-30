import { describe, expect, it, vi } from 'vitest';
import {
    buildUsageLimitError,
    checkAnalysisLimit,
    checkChatbotLimit,
} from '@/application/usage';
import type { UsageLimitDependencies } from '@/application/usage';
import type { TierConfig } from '@/domain/types';

const restrictedConfig: TierConfig = {
    limits: {
        analysisPerDay: { free: 2, member: 10, pro: Infinity },
        chatbotPerDay: { free: 3, member: 20, pro: Infinity },
    },
    timeframes: { free: ['1Day'], member: ['1Day'], pro: ['1Day'] },
    infoDepth: { free: ['summary'], member: ['summary'], pro: ['summary'] },
    models: {
        free: ['gemini-2.5-flash'],
        member: ['gemini-2.5-flash'],
        pro: ['gemini-2.5-flash'],
    },
    featureFlags: { enableTierRestrictions: true },
};

const unrestrictedConfig: TierConfig = {
    ...restrictedConfig,
    featureFlags: { enableTierRestrictions: false },
};

function createDependencies(counts: {
    analysis: number;
    chatbot: number;
}): UsageLimitDependencies {
    return {
        usage: {
            getUsageToday: vi.fn().mockResolvedValue(counts),
        },
    };
}

describe('usage limit checks', () => {
    it('allows analysis when tier restrictions are disabled without reading usage', async () => {
        const dependencies = createDependencies({ analysis: 999, chatbot: 0 });

        const result = await checkAnalysisLimit(
            {
                ipHash: 'hashed-ip',
                tier: 'free',
                config: unrestrictedConfig,
            },
            dependencies
        );

        expect(result).toBe(true);
        expect(dependencies.usage.getUsageToday).not.toHaveBeenCalled();
    });

    it('allows chatbot usage when tier restrictions are disabled without reading usage', async () => {
        const dependencies = createDependencies({ analysis: 0, chatbot: 999 });

        const result = await checkChatbotLimit(
            {
                ipHash: 'hashed-ip',
                tier: 'free',
                config: unrestrictedConfig,
            },
            dependencies
        );

        expect(result).toBe(true);
        expect(dependencies.usage.getUsageToday).not.toHaveBeenCalled();
    });

    it('uses package default config when config is omitted', async () => {
        const dependencies = createDependencies({ analysis: 0, chatbot: 0 });

        const result = await checkAnalysisLimit(
            {
                ipHash: 'hashed-ip',
                tier: 'free',
            },
            dependencies
        );

        expect(result).toBe(true);
        expect(dependencies.usage.getUsageToday).not.toHaveBeenCalled();
    });

    it('allows analysis while today usage is below the tier limit', async () => {
        const dependencies = createDependencies({ analysis: 1, chatbot: 0 });
        const now = new Date('2026-04-29T00:00:00.000Z');

        const result = await checkAnalysisLimit(
            {
                ipHash: 'hashed-ip',
                tier: 'free',
                now,
                config: restrictedConfig,
            },
            dependencies
        );

        expect(result).toBe(true);
        expect(dependencies.usage.getUsageToday).toHaveBeenCalledWith(
            'hashed-ip',
            now
        );
    });

    it('blocks analysis when today usage reaches the tier limit', async () => {
        const dependencies = createDependencies({ analysis: 2, chatbot: 0 });

        const result = await checkAnalysisLimit(
            {
                ipHash: 'hashed-ip',
                tier: 'free',
                config: restrictedConfig,
            },
            dependencies
        );

        expect(result).toBe(false);
    });

    it('blocks analysis when today usage exceeds the tier limit', async () => {
        const dependencies = createDependencies({ analysis: 3, chatbot: 0 });

        const result = await checkAnalysisLimit(
            {
                ipHash: 'hashed-ip',
                tier: 'free',
                config: restrictedConfig,
            },
            dependencies
        );

        expect(result).toBe(false);
    });

    it('allows chatbot usage while today usage is below the tier limit', async () => {
        const dependencies = createDependencies({ analysis: 0, chatbot: 2 });

        const result = await checkChatbotLimit(
            {
                ipHash: 'hashed-ip',
                tier: 'free',
                config: restrictedConfig,
            },
            dependencies
        );

        expect(result).toBe(true);
    });

    it('blocks chatbot usage when today usage reaches the tier limit', async () => {
        const dependencies = createDependencies({ analysis: 0, chatbot: 3 });

        const result = await checkChatbotLimit(
            {
                ipHash: 'hashed-ip',
                tier: 'free',
                config: restrictedConfig,
            },
            dependencies
        );

        expect(result).toBe(false);
    });

    it('blocks chatbot usage when today usage exceeds the tier limit', async () => {
        const dependencies = createDependencies({ analysis: 0, chatbot: 4 });

        const result = await checkChatbotLimit(
            {
                ipHash: 'hashed-ip',
                tier: 'free',
                config: restrictedConfig,
            },
            dependencies
        );

        expect(result).toBe(false);
    });

    it('allows analysis when usage repository throws (fail-open)', async () => {
        const consoleWarn = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);
        const dependencies: UsageLimitDependencies = {
            usage: {
                getUsageToday: vi.fn().mockRejectedValue(new Error('DB error')),
            },
        };

        const result = await checkAnalysisLimit(
            {
                ipHash: 'hashed-ip',
                tier: 'free',
                config: restrictedConfig,
            },
            dependencies
        );

        expect(result).toBe(true);
        expect(consoleWarn).toHaveBeenCalledWith(
            '[checkUsageLimit] Usage check failed, allowing request:',
            expect.any(Error)
        );
        consoleWarn.mockRestore();
    });

    it('allows chatbot usage when usage repository throws (fail-open)', async () => {
        const consoleWarn = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);
        const dependencies: UsageLimitDependencies = {
            usage: {
                getUsageToday: vi.fn().mockRejectedValue(new Error('DB error')),
            },
        };

        const result = await checkChatbotLimit(
            {
                ipHash: 'hashed-ip',
                tier: 'free',
                config: restrictedConfig,
            },
            dependencies
        );

        expect(result).toBe(true);
        expect(consoleWarn).toHaveBeenCalledWith(
            '[checkUsageLimit] Usage check failed, allowing request:',
            expect.any(Error)
        );
        consoleWarn.mockRestore();
    });

    it('returns a structured chatbot usage limit error for the requested tier', () => {
        expect(buildUsageLimitError('chatbotPerDay', 'member')).toEqual({
            code: 'chatbot_limit_exceeded',
            message: 'Daily chatbot usage limit exceeded.',
            feature: 'chatbotPerDay',
            tier: 'member',
        });
    });

    it('returns a structured analysis usage limit error for the requested tier', () => {
        expect(buildUsageLimitError('analysisPerDay', 'free')).toEqual({
            code: 'analysis_limit_exceeded',
            message: 'Daily analysis usage limit exceeded.',
            feature: 'analysisPerDay',
            tier: 'free',
        });
    });
});
