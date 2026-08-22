import argon2 from "argon2";

/** OWASP's minimum Argon2id profile: 19 MiB, two iterations, one lane. */
const ARGON2_OPTIONS = {
    type: argon2.argon2id,
    memoryCost: 19 * 1024,
    timeCost: 2,
    parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPasswordHash(password: string, stored: string): Promise<boolean> {
    if (!stored.startsWith("$argon2id$")) return false;
    try {
        return await argon2.verify(stored, password);
    } catch {
        // Malformed database values are authentication failures, not server errors.
        return false;
    }
}
