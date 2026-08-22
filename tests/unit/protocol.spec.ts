import { describe, expect, it } from "vitest";
import {
    clientHelloEnvelopeSchema,
    PROTOCOL_VERSION,
    roomCommandEnvelopeSchema,
} from "../../src/packages/protocol";

describe("protocol v1 boundary", () => {
    it("validates the unauthenticated client hello envelope", () => {
        const result = clientHelloEnvelopeSchema.safeParse({
            protocol: PROTOCOL_VERSION,
            type: "client.hello",
            requestId: "request-1",
            revision: null,
            payload: {
                supportedProtocolVersions: [1],
                applicationVersion: "0.1.0",
                role: "DISPLAY",
                capabilities: ["DISPLAY_SESSION"],
                roomCode: "ABC234",
                participantCredential: "x".repeat(43),
            },
        });
        expect(result.success).toBe(true);
    });

    it("rejects unknown payload fields and invalid roles", () => {
        const result = clientHelloEnvelopeSchema.safeParse({
            protocol: 1,
            type: "client.hello",
            requestId: null,
            revision: null,
            payload: {
                supportedProtocolVersions: [1],
                applicationVersion: "0.1.0",
                role: "ADMIN",
                capabilities: [],
                secret: "leak",
            },
        });
        expect(result.success).toBe(false);
    });

    it("validates private boundary dimensions independently", () => {
        const result = roomCommandEnvelopeSchema.safeParse({
            protocol: 1,
            type: "command.setBoundaries",
            requestId: "private-boundaries",
            revision: null,
            payload: {
                disabledQuestionCategoryIds: ["CAT_SEX_EXPERIENCE"],
                disabledDareTypeIds: ["DARE_THIRD_PARTY"],
                blockedOperationalFlags: ["INVOLVES_THIRD_PARTY"],
            },
        });
        expect(result.success).toBe(true);
    });
});
