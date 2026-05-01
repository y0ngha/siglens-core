import { describe, expect, it, vi } from 'vitest';
import type {
    InquiryInput,
    InquiryRepository,
} from '@/infrastructure/db/types';
import { submitInquiry } from '@/application/inquiry/submitInquiry';
import type { SubmitInquiryDeps } from '@/application/inquiry/types';

function makeDeps(): {
    deps: SubmitInquiryDeps;
    create: ReturnType<typeof vi.fn>;
} {
    const create = vi
        .fn<InquiryRepository['create']>()
        .mockResolvedValue(undefined);
    const inquiryRepository: InquiryRepository = { create };
    return {
        deps: { inquiryRepository },
        create,
    };
}

const validInput: InquiryInput = {
    title: 'Test title',
    content: 'Test content body',
    email: 'visitor@example.com',
};

describe('submitInquiry', () => {
    it('calls repository.create with the exact input', async () => {
        const { deps, create } = makeDeps();

        await submitInquiry(validInput, deps);

        expect(create).toHaveBeenCalledOnce();
        expect(create).toHaveBeenCalledWith(validInput);
    });

    it('propagates repository errors to the caller', async () => {
        const dbError = new Error('db connection lost');
        const create = vi
            .fn<InquiryRepository['create']>()
            .mockRejectedValue(dbError);
        const deps: SubmitInquiryDeps = {
            inquiryRepository: { create },
        };

        await expect(submitInquiry(validInput, deps)).rejects.toThrow(
            'db connection lost'
        );
    });
});
