import type { InquiryInput } from '@/infrastructure/db/types';
import type { SubmitInquiryDeps } from './types';

/**
 * Persist a visitor's contact form submission to the database.
 *
 * @param input - Title, content, and reply-to email from the contact form.
 * @param deps - Injected repository dependency.
 * @returns A promise that resolves when the inquiry has been persisted.
 * @throws Repository errors (DB connection failure, constraint violation) propagate to the caller.
 *
 * @example
 * ```ts
 * await submitInquiry(
 *   { title: '문의합니다', content: '내용', email: 'user@example.com' },
 *   { inquiryRepository: new DrizzleInquiryRepository(db) },
 * );
 * ```
 *
 * @see {@link InquiryRepository}
 * @see {@link DrizzleInquiryRepository}
 */
export async function submitInquiry(
    input: InquiryInput,
    deps: SubmitInquiryDeps
): Promise<void> {
    await deps.inquiryRepository.create(input);
}
