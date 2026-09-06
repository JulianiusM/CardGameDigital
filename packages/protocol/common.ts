import { z } from "zod";
import {
    DARE_TYPES,
    INTENSITY_PROGRESSION_INCREMENT_MAXIMUM,
    INTENSITY_PROGRESSION_INCREMENT_MINIMUM,
    INTENSITY_PROGRESSION_UNITS,
    NEVER_HAVE_I_EVER_REVEAL_MODES,
    OPERATIONAL_FLAGS,
    QUESTION_CATEGORIES,
    SOCIAL_SENSITIVITIES,
} from "../game-core";
import { sessionCardPolicySchema } from "./cardPolicy";
import { PROTOCOL_VERSION } from "./version";
import { MAX_REQUEST_ID_CHARACTERS } from "./limits";

export const requestIdSchema = z.string().min(1).max(MAX_REQUEST_ID_CHARACTERS);
export const questionCategoriesSchema = z
    .array(z.enum(QUESTION_CATEGORIES))
    .max(Object.values(QUESTION_CATEGORIES).length)
    .refine((values) => new Set(values).size === values.length, "Values must be unique");
export const dareTypesSchema = z
    .array(z.enum(DARE_TYPES))
    .max(Object.values(DARE_TYPES).length)
    .refine((values) => new Set(values).size === values.length, "Values must be unique");
export const operationalFlagsSchema = z
    .array(z.enum(OPERATIONAL_FLAGS))
    .max(Object.values(OPERATIONAL_FLAGS).length)
    .refine((values) => new Set(values).size === values.length, "Values must be unique");

export const ROOM_GAME_SETTING_CONSTRAINTS = {
    intensityProgressionInterval: { minimum: 1, maximum: 100 },
    intensityProgressionIncrement: {
        minimum: INTENSITY_PROGRESSION_INCREMENT_MINIMUM,
        maximum: INTENSITY_PROGRESSION_INCREMENT_MAXIMUM,
        step: 0.5,
    },
    randomQuestionRatio: { minimum: 0, maximum: 1 },
    maximumTypeStreak: { minimum: 1, maximum: 10 },
    letsTalkMetaInterval: { minimum: 1, maximum: 100 },
} as const;

export const protocolErrorCodeSchema = z.enum([
    "VALIDATION_ERROR",
    "AUTHENTICATION_ERROR",
    "ROOM_NOT_FOUND",
    "ROOM_FULL",
    "ROOM_BOOTSTRAP_MODE_UNSUPPORTED",
    "IDEMPOTENCY_KEY_REQUIRED",
    "IDEMPOTENCY_KEY_INVALID",
    "IDEMPOTENCY_KEY_REUSED",
    "IDEMPOTENCY_REQUEST_IN_PROGRESS",
    "IDEMPOTENCY_RESULT_GONE",
    "CARD_LOCALE_UNAVAILABLE",
    "INVALID_GAME_STATE",
    "NOT_ACTIVE_PLAYER",
    "CARD_POOL_EXHAUSTED",
    "SESSION_CAPACITY_EXCEEDED",
    "STALE_SESSION_REVISION",
    "NOT_AUTHORIZED",
    "PROTOCOL_VERSION_UNSUPPORTED",
]);
export type ProtocolErrorCode = z.infer<typeof protocolErrorCodeSchema>;
export const clientRoleSchema = z.enum(["HOST", "PLAYER", "DISPLAY"]);
export type ClientRole = z.infer<typeof clientRoleSchema>;
export const roomBootstrapModeSchema = z.enum(["CREATOR_HOST", "DISPLAY_WAITING_FOR_HOST"]);
export type RoomBootstrapMode = z.infer<typeof roomBootstrapModeSchema>;
export const roomHostStateSchema = z.enum([
    "AWAITING_FIRST_HOST",
    "CONNECTING",
    "CONNECTED",
    "RECONNECTING",
    "AWAITING_REPLACEMENT_HOST",
]);
export type RoomHostState = z.infer<typeof roomHostStateSchema>;
export const roomRoleChangeReasonSchema = z.enum([
    "INITIAL_HOST_ASSIGNED",
    "HOST_TRANSFERRED",
    "HOST_LEFT",
    "HOST_DISCONNECT_EXPIRED",
    "HOST_REVOKED",
    "HOST_ACTIVATION_EXPIRED",
]);
export const sessionPersistenceSchema = z.enum(["EPHEMERAL", "DATASPACE"]);
export type SessionPersistence = z.infer<typeof sessionPersistenceSchema>;
export const neverHaveIEverVoteStatusSchema = z.enum(["PENDING", "VOTED"]);
export type NeverHaveIEverVoteStatus = z.infer<typeof neverHaveIEverVoteStatusSchema>;
export const neverHaveIEverVoteValueSchema = z.enum(["YES", "NO"]);
export type NeverHaveIEverVoteValue = z.infer<typeof neverHaveIEverVoteValueSchema>;
export const participantLeftReasonSchema = z.enum(["LEFT", "DISCONNECT_EXPIRED"]);
export type ParticipantLeftReason = z.infer<typeof participantLeftReasonSchema>;
export const cardReplacementReasonSchema = z.enum(["SKIPPED", "VETOED"]);
export type CardReplacementReason = z.infer<typeof cardReplacementReasonSchema>;
export const participantConnectionStatusSchema = z.enum(["CONNECTED", "TEMPORARILY_DISCONNECTED"]);
export type ParticipantConnectionStatus = z.infer<typeof participantConnectionStatusSchema>;
export const neverHaveIEverRevealModeSchema = z.enum(NEVER_HAVE_I_EVER_REVEAL_MODES);
export type NeverHaveIEverRevealMode = z.infer<typeof neverHaveIEverRevealModeSchema>;
export const roomHostStatusSchema = z
    .object({
        state: roomHostStateSchema,
        participantId: z.uuid().nullable(),
        displayName: z.string().min(1).max(40).nullable(),
        deadline: z.number().int().nonnegative().nullable(),
    })
    .strict();
export type RoomHostStatus = z.infer<typeof roomHostStatusSchema>;
export const clientCapabilitySchema = z.enum([
    "JOIN_ROOM",
    "DISPLAY_SESSION",
    "START_SESSION",
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
export type ClientCapability = z.infer<typeof clientCapabilitySchema>;
export const envelopeSchema = z
    .object({
        protocol: z.literal(PROTOCOL_VERSION),
        type: z.string().min(1),
        requestId: requestIdSchema.nullable(),
        revision: z.number().int().nonnegative().nullable(),
        payload: z.unknown(),
    })
    .strict();
export type Envelope = z.infer<typeof envelopeSchema>;

export const participantLeftEventPayloadSchema = z
    .object({
        participantId: z.uuid(),
        displayName: z.string().min(1).max(80),
        reason: participantLeftReasonSchema,
    })
    .strict();
export type ParticipantLeftEventPayload = z.infer<typeof participantLeftEventPayloadSchema>;

export const cardReplacedEventPayloadSchema = z
    .object({ reason: cardReplacementReasonSchema })
    .strict();
export type CardReplacedEventPayload = z.infer<typeof cardReplacedEventPayloadSchema>;

export const effectiveGameSettingsSchema = z
    .object({
        enabledQuestionCategoryIds: questionCategoriesSchema,
        enabledDareTypeIds: dareTypesSchema,
        blockedOperationalFlags: operationalFlagsSchema,
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
        intensityProgressionUnit: z.enum(INTENSITY_PROGRESSION_UNITS).default("CARDS"),
        intensityProgressionInterval: z
            .number()
            .int()
            .min(ROOM_GAME_SETTING_CONSTRAINTS.intensityProgressionInterval.minimum)
            .max(ROOM_GAME_SETTING_CONSTRAINTS.intensityProgressionInterval.maximum)
            .default(2),
        intensityProgressionIncrement: z
            .number()
            .min(ROOM_GAME_SETTING_CONSTRAINTS.intensityProgressionIncrement.minimum)
            .max(ROOM_GAME_SETTING_CONSTRAINTS.intensityProgressionIncrement.maximum)
            .multipleOf(ROOM_GAME_SETTING_CONSTRAINTS.intensityProgressionIncrement.step)
            .default(1),
        randomQuestionRatio: z
            .number()
            .min(ROOM_GAME_SETTING_CONSTRAINTS.randomQuestionRatio.minimum)
            .max(ROOM_GAME_SETTING_CONSTRAINTS.randomQuestionRatio.maximum),
        maximumTypeStreak: z
            .number()
            .int()
            .min(ROOM_GAME_SETTING_CONSTRAINTS.maximumTypeStreak.minimum)
            .max(ROOM_GAME_SETTING_CONSTRAINTS.maximumTypeStreak.maximum),
        letsTalkMetaInterval: z
            .number()
            .int()
            .min(ROOM_GAME_SETTING_CONSTRAINTS.letsTalkMetaInterval.minimum)
            .max(ROOM_GAME_SETTING_CONSTRAINTS.letsTalkMetaInterval.maximum),
    })
    .strict()
    .refine(({ startingIntensity, maximumIntensity }) => startingIntensity <= maximumIntensity, {
        message: "startingIntensity cannot exceed maximumIntensity",
        path: ["startingIntensity"],
    });
export type EffectiveGameSettings = z.infer<typeof effectiveGameSettingsSchema>;
export const roomGameSettingsSchema = z
    .object({
        mode: z.enum([
            "CLASSIC_TRUTH_OR_DARE",
            "RANDOM_TRUTH_OR_DARE",
            "NEVER_HAVE_I_EVER",
            "LETS_TALK",
        ]),
        profileId: z.string().min(1).max(80),
        groupId: z.uuid().nullable(),
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
        neverHaveIEverRevealMode: neverHaveIEverRevealModeSchema.default("ANONYMOUS_AGGREGATE"),
        cardPolicy: sessionCardPolicySchema,
        configuration: effectiveGameSettingsSchema,
    })
    .strict();
export type RoomGameSettings = z.infer<typeof roomGameSettingsSchema>;

export const roomRoleChangedPayloadSchema = z
    .object({
        role: clientRoleSchema,
        previousRole: clientRoleSchema,
        reason: roomRoleChangeReasonSchema,
    })
    .strict();
