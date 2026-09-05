import { z } from "zod";
import {
    clientRoleSchema,
    roomBootstrapModeSchema,
    roomGameSettingsSchema,
    roomHostStatusSchema,
    sessionPersistenceSchema,
} from "./common";
import { ROOM_CODE_PATTERN_SOURCE } from "./limits";

export const roomCreateRequestSchema = z
    .object({
        displayName: z.string().trim().min(1).max(40),
        persistence: sessionPersistenceSchema.default("EPHEMERAL"),
        bootstrapMode: roomBootstrapModeSchema.default("CREATOR_HOST"),
        settings: roomGameSettingsSchema.optional(),
    })
    .strict();

export const roomJoinResponseSchema = z
    .object({
        roomId: z.string().uuid(),
        roomCode: z.string().regex(new RegExp(ROOM_CODE_PATTERN_SOURCE)),
        participantId: z.string().uuid(),
        participantCredential: z.string().min(32),
        role: z.enum(["PLAYER", "DISPLAY"]),
    })
    .strict();

export const roomCreateResponseSchema = roomJoinResponseSchema.extend({
    role: clientRoleSchema,
    bootstrapMode: roomBootstrapModeSchema,
    hostStatus: roomHostStatusSchema,
});

export type RoomJoinResponse = z.infer<typeof roomJoinResponseSchema>;
export type RoomCreateResponse = z.infer<typeof roomCreateResponseSchema>;
