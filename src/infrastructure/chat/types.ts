export interface ChatTokenStore {
    tryConsumeToken(hashedClientId: string): Promise<boolean>;
    refundConsumedToken(hashedClientId: string): Promise<void>;
    getRemainingTokens(hashedClientId: string): Promise<number>;
}
