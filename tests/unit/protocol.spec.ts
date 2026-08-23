import { describe, expect, it } from "vitest";
import {
    clientHelloEnvelopeSchema,
    PROTOCOL_VERSION,
    roomCommandEnvelopeSchema,
} from "../../src/packages/protocol";
import { defaultRoomGameSettings } from "../../src/packages/application/roomGameSettings";

describe("protocol v2 boundary", () => {
    it("validates the unauthenticated client hello envelope", () => {
        const result = clientHelloEnvelopeSchema.safeParse({
            protocol: PROTOCOL_VERSION,
            type: "client.hello",
            requestId: "request-1",
            revision: null,
            payload: {
                supportedProtocolVersions: [PROTOCOL_VERSION],
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
            protocol: PROTOCOL_VERSION,
            type: "client.hello",
            requestId: null,
            revision: null,
            payload: {
                supportedProtocolVersions: [PROTOCOL_VERSION],
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
            protocol: PROTOCOL_VERSION,
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

    it("accepts an intentional leave command without participant identity", () => {
        expect(
            roomCommandEnvelopeSchema.safeParse({
                protocol: PROTOCOL_VERSION,
                type: "command.leaveRoom",
                requestId: "leave",
                revision: null,
                payload: {},
            }).success,
        ).toBe(true);
    });

    it("accepts the Host-only ended-Session reset as a revisioned command", () => {
        expect(
            roomCommandEnvelopeSchema.safeParse({
                protocol: PROTOCOL_VERSION,
                type: "command.resetSession",
                requestId: "new-game",
                revision: 4,
                payload: {},
            }).success,
        ).toBe(true);
    });

    it("accepts the Host-only Room closure command", () => {
        expect(
            roomCommandEnvelopeSchema.safeParse({
                protocol: PROTOCOL_VERSION,
                type: "command.closeRoom",
                requestId: "close-room",
                revision: 4,
                payload: {},
            }).success,
        ).toBe(true);
    });

    it("accepts canonical Room settings but rejects private boundaries in the public payload", () => {
        const command = {
            protocol: PROTOCOL_VERSION,
            type: "command.updateRoomSettings",
            requestId: "settings",
            revision: null,
            payload: { expectedRevision: 0, settings: defaultRoomGameSettings() },
        };
        expect(roomCommandEnvelopeSchema.safeParse(command).success).toBe(true);
        expect(
            roomCommandEnvelopeSchema.safeParse({
                ...command,
                payload: {
                    ...command.payload,
                    settings: {
                        ...command.payload.settings,
                        disabledDareTypeIds: ["DARE_NUDITY"],
                    },
                },
            }).success,
        ).toBe(false);
    });
});
