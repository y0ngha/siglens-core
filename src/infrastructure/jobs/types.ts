import type { Timeframe } from '@/domain/types';

export type JobStatus = 'processing' | 'done' | 'error';

export interface JobRedisClient {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, opts: { ex: number }): Promise<unknown>;
    del(...keys: string[]): Promise<number>;
}

export interface JobMeta {
    symbol: string;
    timeframe: Timeframe;
    skillsDegraded: boolean;
    /** AI entryPrice 미제공 시 reconcile 단계에서 SL/TP 검증 기준으로 사용하는 마지막 bar 종가. */
    lastClose?: number;
    /** SL/TP fallback 계산용 마지막 ATR; 미존재 시 AI 원본값 유지. */
    atr?: number;
}
