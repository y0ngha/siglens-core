import { compare, hash } from 'bcryptjs';
import type { PasswordHasher, PasswordVerifier } from './types';

/**
 * @internal Salt rounds applied when hashing passwords with the default bcrypt adapter.
 *
 * The cost factor of 12 balances brute-force resistance and per-request CPU cost
 * on modern serverless runtimes; consumers requiring a different cost should
 * implement {@link PasswordHasher} directly instead of importing this constant.
 */
export const BCRYPT_DEFAULT_SALT_ROUNDS = 12;

/**
 * Default {@link PasswordHasher} implementation backed by `bcryptjs`.
 *
 * Hashes passwords with a cost factor of {@link BCRYPT_DEFAULT_SALT_ROUNDS}.
 *
 * @example
 * ```typescript
 * import { bcryptPasswordHasher, registerUser } from '@y0ngha/siglens-core';
 *
 * await registerUser(
 *     { email, password },
 *     { users, passwordHasher: bcryptPasswordHasher },
 * );
 * ```
 */
export const bcryptPasswordHasher: PasswordHasher = {
    hashPassword(password: string): Promise<string> {
        return hash(password, BCRYPT_DEFAULT_SALT_ROUNDS);
    },
};

/**
 * Default {@link PasswordVerifier} implementation backed by `bcryptjs`.
 *
 * Compares a plain-text password against a stored bcrypt hash in constant time.
 *
 * @example
 * ```typescript
 * import { bcryptPasswordVerifier, loginUser } from '@y0ngha/siglens-core';
 *
 * await loginUser(
 *     { email, password },
 *     { users, sessions, passwordVerifier: bcryptPasswordVerifier },
 * );
 * ```
 */
export const bcryptPasswordVerifier: PasswordVerifier = {
    verifyPassword(password: string, passwordHash: string): Promise<boolean> {
        return compare(password, passwordHash);
    },
};
