import type { Bar, SqueezeMomentumResult } from '@/domain/types';

export function buildBars(n: number): Bar[] {
    return Array.from({ length: n }, (_, i) => ({
        time: 1700000000 + i * 86400,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1000,
    }));
}

export function sqz(momentum: number | null): SqueezeMomentumResult {
    return {
        momentum,
        sqzOn: null,
        sqzOff: null,
        noSqz: null,
        increasing: null,
    };
}
