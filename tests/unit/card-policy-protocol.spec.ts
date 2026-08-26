import { describe, expect, it } from "vitest";
import {
    portableCardPolicyScopeSchema,
    sessionCardPolicySchema,
} from "../../src/packages/protocol/cardPolicy";

describe("Card-policy protocol", () => {
    it("uses one policy shape for persisted and pending scopes", () => {
        expect(sessionCardPolicySchema.parse({})).toEqual({
            scopeDefault: {},
            conditionalRules: [],
            exactCards: [],
        });
        expect(
            portableCardPolicyScopeSchema.parse({
                format: "party-game-card-policy/v2",
                scopeDefault: {},
                rules: [],
                exactCards: [],
            }),
        ).toEqual({
            format: "party-game-card-policy/v2",
            scopeDefault: {},
            rules: [],
            exactCards: [],
        });
    });
});
