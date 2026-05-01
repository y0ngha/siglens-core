import { inquiries } from './schema';
import type { InquiryInput, InquiryRepository, SiglensDatabase } from './types';

/**
 * Drizzle ORM-backed implementation of {@link InquiryRepository}.
 *
 * @param db - Active Drizzle database connection created by {@link createDatabaseClient}.
 */
export class DrizzleInquiryRepository implements InquiryRepository {
    constructor(private readonly db: SiglensDatabase) {}

    /**
     * @returns A promise that resolves when the inquiry has been inserted.
     */
    async create(input: InquiryInput): Promise<void> {
        await this.db.insert(inquiries).values({
            title: input.title,
            content: input.content,
            email: input.email,
        });
    }
}
