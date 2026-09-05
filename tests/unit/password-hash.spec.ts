import { describe, expect, it } from "vitest";
import { hashPassword, verifyPasswordHash } from "../../apps/server/src/modules/passwordHash";

describe("Argon2id password hashing", () => {
    it("creates an Argon2id hash and verifies only the correct password", async () => {
        const hash = await hashPassword("correct horse battery staple");
        expect(hash).toMatch(/^\$argon2id\$/);
        expect(hash).not.toContain("correct horse battery staple");
        await expect(verifyPasswordHash("correct horse battery staple", hash)).resolves.toBe(true);
        await expect(verifyPasswordHash("wrong", hash)).resolves.toBe(false);
    });

    it("rejects unsupported or malformed stored hashes", async () => {
        await expect(verifyPasswordHash("password", "not-a-password-hash")).resolves.toBe(false);
        await expect(verifyPasswordHash("password", "$argon2id$broken")).resolves.toBe(false);
    });
});
