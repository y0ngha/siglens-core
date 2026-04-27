import { describe, expect, it } from 'vitest';
import {
    bcryptPasswordHasher,
    bcryptPasswordVerifier,
} from '@/infrastructure/auth';

describe('bcryptPasswordHasher', () => {
    it('produces a hash that round-trips through bcryptPasswordVerifier', async () => {
        const password = 'Password1!';

        const hash = await bcryptPasswordHasher.hashPassword(password);

        expect(hash).not.toBe(password);
        expect(hash.length).toBeGreaterThan(0);
        expect(
            await bcryptPasswordVerifier.verifyPassword(password, hash)
        ).toBe(true);
    });

    it('produces different hashes for the same password on each call', async () => {
        const password = 'Password1!';

        const firstHash = await bcryptPasswordHasher.hashPassword(password);
        const secondHash = await bcryptPasswordHasher.hashPassword(password);

        expect(firstHash).not.toBe(secondHash);
    });
});

describe('bcryptPasswordVerifier', () => {
    it('returns false for a password that does not match the stored hash', async () => {
        const hash = await bcryptPasswordHasher.hashPassword('Password1!');

        const matches = await bcryptPasswordVerifier.verifyPassword(
            'WrongPassword!',
            hash
        );

        expect(matches).toBe(false);
    });

    it('returns false when the stored hash is malformed', async () => {
        const matches = await bcryptPasswordVerifier.verifyPassword(
            'Password1!',
            'not-a-bcrypt-hash'
        );

        expect(matches).toBe(false);
    });
});
