import { z } from "zod";
import {
    clientCapabilitySchema,
    clientRoleSchema,
    envelopeSchema,
    neverHaveIEverVoteValueSchema,
    roomGameSettingsSchema,
    questionCategoriesSchema,
    dareTypesSchema,
    operationalFlagsSchema,
} from "./common";
export * from "./cardPolicy";
export * from "./common";
import { ROOM_CODE_PATTERN_SOURCE } from "./limits";

export { PROTOCOL_VERSION } from "./version";
export const clientHelloPayloadSchema = z
    .object({
        supportedProtocolVersions: z.array(z.number().int().positive()).min(1),
        applicationVersion: z.string().min(1),
        role: clientRoleSchema,
        capabilities: z.array(clientCapabilitySchema),
        roomCode: z.string().regex(new RegExp(ROOM_CODE_PATTERN_SOURCE)),
        participantCredential: z.string().min(32),
    })
    .strict();
export const clientHelloEnvelopeSchema = envelopeSchema.extend({
    type: z.literal("client.hello"),
    revision: z.null(),
    payload: clientHelloPayloadSchema,
});
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
        z.object({ vote: neverHaveIEverVoteValueSchema, playerId: z.uuid().optional() }).strict(),
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
                disabledQuestionCategoryIds: questionCategoriesSchema,
                disabledDareTypeIds: dareTypesSchema,
                blockedOperationalFlags: operationalFlagsSchema,
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
        payload: z.object({ participantId: z.uuid() }).strict(),
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
export * from "./cardPolicyHttp";
export * from "./http";
export * from "./httpDtos";
export * from "./browser";
export * from "./rooms";
export * from "./limits";
