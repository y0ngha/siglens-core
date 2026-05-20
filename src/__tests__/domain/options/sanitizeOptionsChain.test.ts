import { describe, it, expect } from 'vitest';
import { sanitizeOptionsChain } from '@/domain/options/sanitizeOptionsChain';
import type { OptionsChain, OptionsContract } from '@/domain/options/types';

const makeContract = (
    strike: number,
    oi: number,
    volume = 0
): OptionsContract => ({
    contractSymbol: `X${strike}`,
    strike,
    lastPrice: null,
    bid: null,
    ask: null,
    volume,
    openInterest: oi,
    impliedVolatility: null,
    inTheMoney: false,
});

describe('sanitizeOptionsChain', () => {
    it('drops contracts with negative OI', () => {
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [makeContract(195, 100), makeContract(200, -50)],
            puts: [],
        };
        const result = sanitizeOptionsChain(chain);
        expect(result?.calls).toHaveLength(1);
        expect(result?.calls[0].strike).toBe(195);
    });

    it('drops contracts with negative volume even when OI is non-negative', () => {
        // openInterest≥0 but volume<0 → still invalid (separate filter branch).
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [
                makeContract(195, 100, 0),
                makeContract(200, 100, -1), // bad volume
            ],
            puts: [],
        };
        const result = sanitizeOptionsChain(chain);
        expect(result?.calls).toHaveLength(1);
        expect(result?.calls[0].strike).toBe(195);
    });

    it('drops duplicate strikes (keeps first)', () => {
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [makeContract(195, 100), makeContract(195, 200)],
            puts: [],
        };
        const result = sanitizeOptionsChain(chain);
        expect(result?.calls).toHaveLength(1);
        expect(result?.calls[0].openInterest).toBe(100);
    });

    it('rejects entire chain when >5% of contracts are invalid', () => {
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [
                makeContract(190, 100),
                makeContract(195, -1), // invalid
                makeContract(200, -2), // invalid (2/3 > 5%)
            ],
            puts: [],
        };
        expect(sanitizeOptionsChain(chain)).toBeNull();
    });

    it('does NOT reject chain at exactly 5% invalid ratio', () => {
        // 2 invalid / 40 total = 0.05 = 5%. The reject rule is `> 0.05`,
        // so exactly 5% must survive. invalidCount=2 also matches
        // MIN_INVALID_TO_REJECT but the ratio gate stays open.
        const validCalls = Array.from({ length: 38 }, (_, i) =>
            makeContract(100 + i, 100)
        );
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [
                ...validCalls,
                makeContract(200, -1),
                makeContract(201, -2),
            ],
            puts: [],
        };
        const result = sanitizeOptionsChain(chain);
        expect(result).not.toBeNull();
        expect(result?.calls).toHaveLength(38);
    });

    it('does NOT reject chain when only 1 contract is invalid (below MIN_INVALID_TO_REJECT)', () => {
        // 1 < MIN_INVALID_TO_REJECT (=2), so the absolute floor blocks rejection
        // even though 1/3 ≈ 33% > 5%.
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [
                makeContract(190, 100),
                makeContract(195, 200),
                makeContract(200, -1), // 1 invalid
            ],
            puts: [],
        };
        const result = sanitizeOptionsChain(chain);
        expect(result).not.toBeNull();
        expect(result?.calls).toHaveLength(2);
    });

    it('rejects entire chain when >5% of puts are invalid (puts-side branch)', () => {
        // Mirrors the calls-side rejection rule on the puts branch — covers
        // the `shouldReject(invalidPuts, totalPuts)` guard. 2/3 > 5% and
        // invalidCount (2) ≥ MIN_INVALID_TO_REJECT.
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [makeContract(190, 100)],
            puts: [
                makeContract(195, 100),
                makeContract(200, -1), // invalid
                makeContract(205, -2), // invalid (2/3 > 5%)
            ],
        };
        expect(sanitizeOptionsChain(chain)).toBeNull();
    });
});
