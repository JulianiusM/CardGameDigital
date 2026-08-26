import { z } from "zod";
import {
    DARE_TYPES,
    OPERATIONAL_FLAGS,
    QUESTION_CATEGORIES,
    SOCIAL_SENSITIVITIES,
} from "../game-core";
export * from "./cardPolicy";
import { sessionCardPolicySchema } from "./cardPolicy";

export const PROTOCOL_VERSION = 2 as const;
export const protocolErrorCodeSchema = z.enum([
    "VALIDATION_ERROR",
    "AUTHENTICATION_ERROR",
    "ROOM_NOT_FOUND",
    "ROOM_FULL",
    "CARD_LOCALE_UNAVAILABLE",
    "INVALID_GAME_STATE",
    "NOT_ACTIVE_PLAYER",
    "CARD_POOL_EXHAUSTED",
    "STALE_SESSION_REVISION",
    "NOT_AUTHORIZED",
    "PROTOCOL_VERSION_UNSUPPORTED",
]);
export const clientRoleSchema = z.enum(["HOST", "PLAYER", "DISPLAY"]);
export const clientCapabilitySchema = z.enum([
    "JOIN_ROOM",
    "DISPLAY_SESSION",
    "CHOOSE_CARD_TYPE",
    "SUBMIT_VOTE",
    "SKIP_CARD",
    "ADVANCE_SESSION",
    "VETO_CARD",
    "CHANGE_SESSION_SETTINGS",
    "MANAGE_PLAYERS",
    "MANAGE_DEVICE_PLAYERS",
    "TRANSFER_HOST",
    "END_SESSION",
    "LEAVE_ROOM",
]);
export const envelopeSchema = z
    .object({
        protocol: z.literal(PROTOCOL_VERSION),
        type: z.string().min(1),
        requestId: z.string().min(1).nullable(),
        revision: z.number().int().nonnegative().nullable(),
        payload: z.unknown(),
    })
    .strict();
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
export type Envelope = z.infer<typeof envelopeSchema>;
export const participantLeftEventPayloadSchema = z
    .object({
        participantId: z.string().uuid(),
        displayName: z.string().min(1).max(80),
        reason: z.enum(["LEFT", "DISCONNECT_EXPIRED"]),
    })
    .strict();
export const cardReplacedEventPayloadSchema = z
    .object({ reason: z.enum(["SKIPPED", "VETOED"]) })
    .strict();
export type ParticipantLeftEventPayload = z.infer<typeof participantLeftEventPayloadSchema>;
export type CardReplacedEventPayload = z.infer<typeof cardReplacedEventPayloadSchema>;

export const effectiveGameSettingsSchema = z
    .object({
        enabledQuestionCategoryIds: z.array(z.enum(QUESTION_CATEGORIES)),
        enabledDareTypeIds: z.array(z.enum(DARE_TYPES)),
        blockedOperationalFlags: z.array(z.enum(OPERATIONAL_FLAGS)),
        maximumSocialSensitivity: z.enum(SOCIAL_SENSITIVITIES).default("EXPLICIT"),
        startingIntensity: z
            .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
            .default(1),
        maximumIntensity: z.union([
            z.literal(1),
            z.literal(2),
            z.literal(3),
            z.literal(4),
            z.literal(5),
        ]),
        intensityProgressionUnit: z.enum(["ROUNDS", "CARDS"]).default("CARDS"),
        intensityProgressionInterval: z.number().int().min(1).max(100).default(2),
        intensityProgressionIncrement: z.number().min(0.5).max(4).multipleOf(0.5).default(1),
        randomQuestionRatio: z.number().min(0).max(1),
        maximumTypeStreak: z.number().int().min(1).max(10),
        letsTalkMetaInterval: z.number().int().min(1).max(100),
    })
    .strict()
    .refine(({ startingIntensity, maximumIntensity }) => startingIntensity <= maximumIntensity, {
        message: "startingIntensity cannot exceed maximumIntensity",
        path: ["startingIntensity"],
    });
export const roomGameSettingsSchema = z
    .object({
        mode: z.enum([
            "CLASSIC_TRUTH_OR_DARE",
            "RANDOM_TRUTH_OR_DARE",
            "NEVER_HAVE_I_EVER",
            "LETS_TALK",
        ]),
        profileId: z.string().min(1).max(80),
        groupId: z.string().uuid().nullable(),
        adultContentConfirmed: z.boolean(),
        cardLocale: z.string().min(2).max(35),
        cardFallbackEnabled: z.boolean().default(false),
        cardFallbackLocales: z
            .array(z.string().min(2).max(35))
            .max(100)
            .default([])
            .refine(
                (locales) =>
                    new Set(locales.map((entry) => entry.toLowerCase())).size === locales.length,
                "Fallback locales must be unique",
            ),
        neverHaveIEverRevealMode: z
            .enum(["ANONYMOUS_AGGREGATE", "NAMED_ANSWERS"])
            .default("ANONYMOUS_AGGREGATE"),
        cardPolicy: sessionCardPolicySchema,
        configuration: effectiveGameSettingsSchema,
    })
    .strict();
export type RoomGameSettingsPayload = z.infer<typeof roomGameSettingsSchema>;

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
