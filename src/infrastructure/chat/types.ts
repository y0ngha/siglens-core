export interface ChatTokenStore {
    tryConsumeToken(hashedClientId: string): Promise<boolean>;
    getRemainingTokens(hashedClientId: string): Promise<number>;
}
