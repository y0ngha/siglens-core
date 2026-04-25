export type GeminiContents =
    | string
    | Array<{ role: string; parts: Array<{ text: string }> }>;

export interface CallGeminiWithKeyFallbackOptions {
    freeApiKey: string | undefined;
    paidApiKey: string;
    model: string;
    contents: GeminiContents;
    systemInstruction?: string;
}
