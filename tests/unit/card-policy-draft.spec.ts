import { describe, expect, it, vi } from "vitest";
import { en } from "../../apps/web/src/locales/en";
import { MAX_POLICY_IMPORT_BYTES } from "../../packages/protocol/limits";
import { maximumSessionPolicy } from "../support/transportCapacity";
vi.mock("../../apps/web/src/i18n", async () => ({
    messages: (await import("../../apps/web/src/locales/en")).en,
}));
import { readPolicyImport, validateSessionPolicyDraft } from "../../apps/web/src/cardPolicyDraft";

describe("policy draft preflight", () => {
    it("rejects oversized files before reading or parsing them", async () => {
        const text = vi.fn();
        await expect(readPolicyImport({ size: MAX_POLICY_IMPORT_BYTES + 1, text })).rejects.toThrow(
            en.cardManagement.importTooLarge,
        );
        expect(text).not.toHaveBeenCalled();
    });
    it("rejects malformed, old and excessive imports before replacement confirmation", async () => {
        for (const text of [
            "{",
            JSON.stringify({ format: "party-game-card-policy/v1" }),
            JSON.stringify({
                format: "party-game-card-policy/v2",
                scopeDefault: {},
                rules: Array(251).fill({}),
                exactCards: [],
            }),
        ]) {
            await expect(
                readPolicyImport({ size: text.length, text: async () => text }),
            ).rejects.toThrow(en.cardManagement.invalidImport);
        }
    });
    it("accepts maximum Session drafts and rejects unsavable additions", () => {
        const policy = maximumSessionPolicy();
        expect(validateSessionPolicyDraft(policy)).toEqual(policy);
        expect(() =>
            validateSessionPolicyDraft({
                ...policy,
                conditionalRules: [...policy.conditionalRules, policy.conditionalRules[0]],
            }),
        ).toThrow(en.cardManagement.invalidSessionPolicy);
        expect(() =>
            validateSessionPolicyDraft({
                ...policy,
                exactCards: [...policy.exactCards, policy.exactCards[0]],
            }),
        ).toThrow(en.cardManagement.invalidSessionPolicy);
    });
});
