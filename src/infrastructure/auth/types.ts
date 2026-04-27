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
