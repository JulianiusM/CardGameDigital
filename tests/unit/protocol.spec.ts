import { describe, expect, it } from "vitest";
import {
    cardReplacedEventPayloadSchema,
    clientPingEnvelopeSchema,
    clientHelloEnvelopeSchema,
    participantLeftEventPayloadSchema,
    PROTOCOL_VERSION,
    protocolErrorCodeSchema,
    roomCreateRequestSchema,
    roomCreateResponseSchema,
    roomCommandEnvelopeSchema,
    roomRoleChangedPayloadSchema,
} from "../../src/packages/protocol";
import { defaultRoomGameSettings } from "../../src/packages/application/roomGameSettings";

describe("protocol v2 boundary", () => {
    it("declares every stable application error emitted over WebSocket", () => {
        expect(protocolErrorCodeSchema.parse("CARD_LOCALE_UNAVAILABLE")).toBe(
            "CARD_LOCALE_UNAVAILABLE",
        );
        expect(protocolErrorCodeSchema.parse("ROOM_FULL")).toBe("ROOM_FULL");
    });

    it("defaults ordinary creation and validates display-bootstrap wire projections", () => {
        expect(roomCreateRequestSchema.parse({ displayName: "Host" }).bootstrapMode).toBe(
            "CREATOR_HOST",
        );
        expect(
            roomCreateResponseSchema.safeParse({
                roomId: "00000000-0000-4000-8000-000000000001",
                roomCode: "ABC234",
                participantId: "00000000-0000-4000-8000-000000000002",
                participantCredential: "x".repeat(43),
                role: "DISPLAY",
                bootstrapMode: "DISPLAY_WAITING_FOR_HOST",
                hostStatus: {
                    state: "AWAITING_FIRST_HOST",
                    participantId: null,
                    displayName: null,
                    deadline: null,
                },
            }).success,
        ).toBe(true);
        expect(
            roomRoleChangedPayloadSchema.safeParse({
                role: "HOST",
                previousRole: "PLAYER",
                reason: "INITIAL_HOST_ASSIGNED",
            }).success,
        ).toBe(true);
    });

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

    it("accepts only the empty authenticated heartbeat shape", () => {
        const heartbeat = {
            protocol: PROTOCOL_VERSION,
            type: "client.ping",
            requestId: "heartbeat-1",
            revision: null,
            payload: {},
        };
        expect(clientPingEnvelopeSchema.safeParse(heartbeat).success).toBe(true);
        expect(
            clientPingEnvelopeSchema.safeParse({ ...heartbeat, payload: { credential: "no" } })
                .success,
        ).toBe(false);
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

    it("validates semantic Room lifecycle event payloads strictly", () => {
        expect(
            participantLeftEventPayloadSchema.safeParse({
                participantId: "00000000-0000-4000-8000-000000000001",
                displayName: "Ben",
                reason: "DISCONNECT_EXPIRED",
            }).success,
        ).toBe(true);
        expect(
            participantLeftEventPayloadSchema.safeParse({
                participantId: "00000000-0000-4000-8000-000000000001",
                displayName: "Ben",
                reason: "LEFT",
                privateBoundaries: [],
            }).success,
        ).toBe(false);
        expect(cardReplacedEventPayloadSchema.safeParse({ reason: "SKIPPED" }).success).toBe(true);
        expect(cardReplacedEventPayloadSchema.safeParse({ reason: "ADVANCED" }).success).toBe(
            false,
        );
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

    it("defaults omitted Never Have I Ever reveal settings and validates named reveal", () => {
        const settings = defaultRoomGameSettings();
        const legacyShape = { ...settings } as Record<string, unknown>;
        delete legacyShape.neverHaveIEverRevealMode;
        delete legacyShape.cardFallbackEnabled;
        delete legacyShape.cardFallbackLocales;
        const parsedLegacy = roomCommandEnvelopeSchema.parse({
            protocol: PROTOCOL_VERSION,
            type: "command.updateRoomSettings",
            requestId: "default-reveal",
            revision: null,
            payload: { expectedRevision: 0, settings: legacyShape },
        });
        if (parsedLegacy.type !== "command.updateRoomSettings") throw new Error("wrong command");
        const parsedLegacyPayload = parsedLegacy.payload as {
            settings: ReturnType<typeof defaultRoomGameSettings>;
        };
        expect(parsedLegacyPayload.settings.neverHaveIEverRevealMode).toBe("ANONYMOUS_AGGREGATE");
        expect(parsedLegacyPayload.settings.cardFallbackEnabled).toBe(false);
        expect(parsedLegacyPayload.settings.cardFallbackLocales).toEqual([]);
        expect(
            roomCommandEnvelopeSchema.safeParse({
                protocol: PROTOCOL_VERSION,
                type: "command.updateRoomSettings",
                requestId: "named-reveal",
                revision: null,
                payload: {
                    expectedRevision: 0,
                    settings: { ...settings, neverHaveIEverRevealMode: "NAMED_ANSWERS" },
                },
            }).success,
        ).toBe(true);
    });

    it("defaults compatible progression settings and rejects an end below the start", () => {
        const settings = defaultRoomGameSettings();
        const configuration = { ...settings.configuration } as Record<string, unknown>;
        delete configuration.startingIntensity;
        delete configuration.intensityProgressionUnit;
        delete configuration.intensityProgressionInterval;
        delete configuration.intensityProgressionIncrement;
        const parsed = roomCommandEnvelopeSchema.parse({
            protocol: PROTOCOL_VERSION,
            type: "command.updateRoomSettings",
            requestId: "progression-defaults",
            revision: null,
            payload: { expectedRevision: 0, settings: { ...settings, configuration } },
        });
        if (parsed.type !== "command.updateRoomSettings") throw new Error("wrong command");
        const parsedPayload = parsed.payload as {
            expectedRevision: number;
            settings: ReturnType<typeof defaultRoomGameSettings>;
        };
        expect(parsedPayload.settings.configuration).toMatchObject({
            startingIntensity: 1,
            intensityProgressionUnit: "CARDS",
            intensityProgressionInterval: 2,
            intensityProgressionIncrement: 1,
        });
        expect(
            roomCommandEnvelopeSchema.safeParse({
                ...parsed,
                payload: {
                    ...parsedPayload,
                    settings: {
                        ...parsedPayload.settings,
                        configuration: {
                            ...parsedPayload.settings.configuration,
                            startingIntensity: 4,
                            maximumIntensity: 3,
                        },
                    },
                },
            }).success,
        ).toBe(false);
    });
});
