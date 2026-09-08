import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const deriveKey = promisify(argon2);

/** OWASP's minimum Argon2id profile: 19 MiB, two iterations, one lane. */
const ARGON2_OPTIONS = {
    memory: 19 * 1024,
    passes: 2,
    parallelism: 1,
    tagLength: 32,
} as const;

function encode(value: Buffer): string {
    return value.toString("base64").replace(/=+$/, "");
}

export async function hashPassword(password: string): Promise<string> {
    const nonce = randomBytes(16);
    const hash = await deriveKey("argon2id", { ...ARGON2_OPTIONS, message: password, nonce });
    return `$argon2id$v=19$m=${ARGON2_OPTIONS.memory},p=${ARGON2_OPTIONS.parallelism},t=${ARGON2_OPTIONS.passes}$${encode(nonce)}$${encode(hash)}`;
}

export async function verifyPasswordHash(password: string, stored: string): Promise<boolean> {
    // Accept the application's existing PHC profile, including both parameter orders.
    // Never let a malformed stored value select unbounded work or memory costs.
    const match =
        /^\$argon2id\$v=19\$m=19456,(?:p=1,t=2|t=2,p=1)\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/.exec(
            stored,
        );
    if (!match) return false;
    const nonce = Buffer.from(match[1], "base64");
    const expected = Buffer.from(match[2], "base64");
    if (encode(nonce) !== match[1] || encode(expected) !== match[2]) return false;
    try {
        const actual = await deriveKey("argon2id", { ...ARGON2_OPTIONS, message: password, nonce });
        return timingSafeEqual(actual, expected);
    } catch {
        // Malformed database values are authentication failures, not server errors.
        return false;
    }
}
