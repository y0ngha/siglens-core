import type { InquiryRepository } from '@/infrastructure/db/types';

/** Dependencies required by the `submitInquiry` use-case. */
export interface SubmitInquiryDeps {
    inquiryRepository: InquiryRepository;
}
