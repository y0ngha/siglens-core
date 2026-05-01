import { inquiries } from './schema';
import type { InquiryInput, InquiryRepository, SiglensDatabase } from './types';

export class DrizzleInquiryRepository implements InquiryRepository {
    constructor(private readonly db: SiglensDatabase) {}

    async create(input: InquiryInput): Promise<void> {
        await this.db.insert(inquiries).values(input);
    }
}
