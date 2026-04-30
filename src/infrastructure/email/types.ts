import type { EmailMessage } from '@/domain/types';

/**
 * Abstraction for delivering transactional emails.
 *
 * Consumers inject their own implementation (Resend, SendGrid, SMTP, etc.)
 * into use-cases that need to dispatch email.
 */
export interface EmailDispatcher {
    /**
     * Send a transactional email message.
     *
     * @param message - Email payload to deliver.
     * @returns `true` when the message was accepted for delivery, `false` otherwise.
     */
    sendEmail(message: EmailMessage): Promise<boolean>;
}
