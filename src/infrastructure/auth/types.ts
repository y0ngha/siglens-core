/**
 * Interface for hashing plain-text passwords before storage.
 */
export interface PasswordHasher {
    /**
     * Hash a plain-text password and return the hashed string.
     *
     * @param password - Plain-text password to hash.
     * @returns Hashed password string safe for storage.
     */
    hashPassword(password: string): Promise<string>;
}

/**
 * Interface for comparing a plain-text password against a stored password hash.
 */
export interface PasswordVerifier {
    /**
     * Compare a plain-text password with a stored password hash.
     *
     * @param password - Plain-text password supplied by the user.
     * @param passwordHash - Stored password hash for the account.
     * @returns Whether the password matches the hash.
     */
    verifyPassword(password: string, passwordHash: string): Promise<boolean>;
}
