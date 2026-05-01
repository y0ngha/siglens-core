import type { InquiryInput } from '@/infrastructure/db/types';
import type { SubmitInquiryDeps } from './types';

/**
 * Persist a visitor's contact form submission to the database.
 *
 * @param input - Title, content, and reply-to email from the contact form.
 * @param deps - Injected repository dependency.
 * @returns A promise that resolves when the inquiry has been persisted.
 */
export async function submitInquiry(
    input: InquiryInput,
    deps: SubmitInquiryDeps,
): Promise<void> {
    await deps.inquiryRepository.create(input);
}
