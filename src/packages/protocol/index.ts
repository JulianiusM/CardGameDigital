import { z } from "zod";
import { DARE_TYPES, OPERATIONAL_FLAGS, QUESTION_CATEGORIES } from "../game-core";
import {
    clientCapabilitySchema,
    clientRoleSchema,
    envelopeSchema,
    roomBootstrapModeSchema,
    roomGameSettingsSchema,
    roomHostStatusSchema,
} from "./common";
export * from "./cardPolicy";
export * from "./common";
import { PROTOCOL_VERSION } from "./version";

export { PROTOCOL_VERSION } from "./version";
export const clientHelloPayloadSchema = z
    .object({
        supportedProtocolVersions: z.array(z.number().int().positive()).min(1),
        applicationVersion: z.string().min(1),
        role: clientRoleSchema,
        capabilities: z.array(clientCapabilitySchema),
        roomCode: z.string().regex(/^[A-Z2-9]{6}$/),
        participantCredential: z.string().min(32),
    })
    .strict();
export const clientHelloEnvelopeSchema = envelopeSchema.extend({
    type: z.literal("client.hello"),
    revision: z.null(),
    payload: clientHelloPayloadSchema,
});
export const roomCreateRequestSchema = z
    .object({
        displayName: z.string().trim().min(1).max(40),
        persistence: z.enum(["EPHEMERAL", "DATASPACE"]).default("EPHEMERAL"),
        bootstrapMode: roomBootstrapModeSchema.default("CREATOR_HOST"),
        settings: roomGameSettingsSchema.optional(),
    })
    .strict();
export const roomCreateResponseSchema = z
    .object({
        roomId: z.string().uuid(),
        roomCode: z.string().regex(/^[A-Z2-9]{6}$/),
        participantId: z.string().uuid(),
        participantCredential: z.string().min(32),
        role: clientRoleSchema,
        bootstrapMode: roomBootstrapModeSchema,
        hostStatus: roomHostStatusSchema,
    })
    .strict();
const emptyPayloadSchema = z.object({}).strict();
const revisionedCommand = <T extends z.ZodType>(type: string, payload: T) =>
    envelopeSchema.extend({
        type: z.literal(type),
        revision: z.number().int().nonnegative(),
        payload,
    });
export const startSessionCommandSchema = envelopeSchema.extend({
    type: z.literal("command.startSession"),
    revision: z.null(),
    payload: z.object({}).strict(),
});
export const roomCommandEnvelopeSchema = z.union([
    startSessionCommandSchema,
    revisionedCommand("command.startTurn", emptyPayloadSchema),
    revisionedCommand(
        "command.chooseCardType",
        z.object({ cardType: z.enum(["QUESTION", "DARE"]) }).strict(),
    ),
    revisionedCommand("command.skipCard", emptyPayloadSchema),
    revisionedCommand("command.advanceSession", emptyPayloadSchema),
    revisionedCommand(
        "command.submitVote",
        z.object({ vote: z.enum(["YES", "NO"]), playerId: z.string().uuid().optional() }).strict(),
    ),
    revisionedCommand("command.vetoCard", emptyPayloadSchema),
    envelopeSchema.extend({
        type: z.literal("command.updateRoomSettings"),
        revision: z.null(),
        payload: z
            .object({
                expectedRevision: z.number().int().nonnegative(),
                settings: roomGameSettingsSchema,
            })
            .strict(),
    }),
    envelopeSchema.extend({
        type: z.literal("command.setBoundaries"),
        revision: z.null(),
        payload: z
            .object({
                disabledQuestionCategoryIds: z.array(z.enum(QUESTION_CATEGORIES)),
                disabledDareTypeIds: z.array(z.enum(DARE_TYPES)),
                blockedOperationalFlags: z.array(z.enum(OPERATIONAL_FLAGS)),
            })
            .strict(),
    }),
    envelopeSchema.extend({
        type: z.literal("command.setDevicePlayers"),
        revision: z.null(),
        payload: z.object({ names: z.array(z.string().trim().min(1).max(40)).max(19) }).strict(),
    }),
    envelopeSchema.extend({
        type: z.literal("command.transferHost"),
        payload: z.object({ participantId: z.string().uuid() }).strict(),
    }),
    revisionedCommand("command.endSession", emptyPayloadSchema),
    revisionedCommand("command.resetSession", emptyPayloadSchema),
    envelopeSchema.extend({
        type: z.literal("command.closeRoom"),
        payload: emptyPayloadSchema,
    }),
    envelopeSchema.extend({
        type: z.literal("command.leaveRoom"),
        payload: emptyPayloadSchema,
    }),
]);
export const snapshotRequestEnvelopeSchema = envelopeSchema.extend({
    type: z.literal("room.snapshot.request"),
    payload: emptyPayloadSchema,
});
export const clientPingEnvelopeSchema = envelopeSchema.extend({
    type: z.literal("client.ping"),
    revision: z.null(),
    payload: emptyPayloadSchema,
});
export type ClientHelloEnvelope = z.infer<typeof clientHelloEnvelopeSchema>;
export type RoomCommandEnvelope = z.infer<typeof roomCommandEnvelopeSchema>;

export * from "./serverInfo";
export * from "./snapshots";
