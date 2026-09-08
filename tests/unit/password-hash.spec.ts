import { describe, expect, it } from "vitest";
import { hashPassword, verifyPasswordHash } from "../../apps/server/src/modules/passwordHash";

describe("Argon2id password hashing", () => {
    // Generated independently with node-argon2 0.45.1 and the deployed profile.
    const existingHash =
        "$argon2id$v=19$m=19456,p=1,t=2$MDEyMzQ1Njc4OWFiY2RlZg$ustztP9f8yKUEFcLKc3c/Yq9i+8trRl4jNwWFX9MDwU";

    it("creates an Argon2id hash and verifies only the correct password", async () => {
        const hash = await hashPassword("correct horse battery staple");
        expect(hash).toMatch(/^\$argon2id\$/);
        expect(hash).not.toContain("correct horse battery staple");
        await expect(verifyPasswordHash("correct horse battery staple", hash)).resolves.toBe(true);
        await expect(verifyPasswordHash("wrong", hash)).resolves.toBe(false);
    });

    it("verifies passwords already stored by the native Argon2 package", async () => {
        await expect(verifyPasswordHash("compatibility test password", existingHash)).resolves.toBe(
            true,
        );
        await expect(verifyPasswordHash("wrong", existingHash)).resolves.toBe(false);
        await expect(
            verifyPasswordHash(
                "compatibility test password",
                existingHash.replace("p=1,t=2", "t=2,p=1"),
            ),
        ).resolves.toBe(true);
    });

    it("uses a fresh random salt for every password", async () => {
        const first = await hashPassword("日本語 😀\u0000 password");
        const second = await hashPassword("日本語 😀\u0000 password");
        expect(first).not.toBe(second);
        await expect(verifyPasswordHash("日本語 😀\u0000 password", first)).resolves.toBe(true);
    });

    it.each([
        ["v=19", "v=16"],
        ["m=19456", "m=4294967295"],
        ["p=1", "p=0"],
        ["t=2", "t=999999999"],
        ["MDEyMzQ1Njc4OWFiY2RlZg", "MDEyMzQ1Njc4OWFiY2RlZh"],
        ["MDwU", "MDwV"],
    ])("rejects unsupported profile or noncanonical encoding: %s", async (before, after) => {
        await expect(
            verifyPasswordHash("compatibility test password", existingHash.replace(before, after)),
        ).resolves.toBe(false);
    });

    it("rejects unsupported or malformed stored hashes", async () => {
        await expect(verifyPasswordHash("password", "not-a-password-hash")).resolves.toBe(false);
        await expect(verifyPasswordHash("password", "$argon2id$broken")).resolves.toBe(false);
    });
});
