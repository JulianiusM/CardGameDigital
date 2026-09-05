import { z } from "zod";
import { PROTOCOL_VERSION } from "./version";
import {
    cardReplacedEventPayloadSchema,
    clientCapabilitySchema,
    clientRoleSchema,
    envelopeSchema,
    neverHaveIEverRevealModeSchema,
    neverHaveIEverVoteStatusSchema,
    neverHaveIEverVoteValueSchema,
    participantConnectionStatusSchema,
    participantLeftEventPayloadSchema,
    protocolErrorCodeSchema,
    roomBootstrapModeSchema,
    roomGameSettingsSchema,
    roomHostStatusSchema,
    roomRoleChangedPayloadSchema,
} from "./common";

const playerSchema = z.object({ id: z.uuid(), name: z.string().min(1).max(40) }).strict();
const voteResultSchema = z
    .object({
        yes: z.number().int().nonnegative(),
        no: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
    })
    .strict();

const namedAnswerSchema = z
    .object({
        playerId: z.uuid(),
        displayName: z.string().min(1).max(40),
        vote: neverHaveIEverVoteValueSchema,
    })
    .strict();

export const neverHaveIEverVotingViewSchema = z
    .object({
        revealMode: neverHaveIEverRevealModeSchema,
        progress: z.array(
            z
                .object({
                    playerId: z.uuid(),
                    displayName: z.string().min(1).max(40),
                    status: neverHaveIEverVoteStatusSchema,
                })
                .strict(),
        ),
        result: voteResultSchema
            .extend({ namedAnswers: z.array(namedAnswerSchema).optional() })
            .nullable(),
    })
    .strict();
export type NeverHaveIEverVotingView = z.infer<typeof neverHaveIEverVotingViewSchema>;

export const sessionViewSchema = z
    .object({
        id: z.uuid(),
        startedAt: z.number().int().nonnegative(),
        mode: z.enum([
            "CLASSIC_TRUTH_OR_DARE",
            "RANDOM_TRUTH_OR_DARE",
            "NEVER_HAVE_I_EVER",
            "LETS_TALK",
        ]),
        revision: z.number().int().nonnegative(),
        state: z.enum([
            "WAITING_FOR_PLAYER",
            "CHOOSING_CARD_TYPE",
            "SELECTING_CARD",
            "SHOWING_CARD",
            "WAITING_FOR_RESOLUTION",
            "COLLECTING_ANSWERS",
            "SHOWING_RESULTS",
            "TRANSITION",
            "NEXT_PLAYER",
            "ENDED",
        ]),
        roundNumber: z.number().int().nonnegative(),
        activePlayer: playerSchema.nullable(),
        players: z.array(playerSchema),
        currentCard: z
            .object({
                id: z.uuid(),
                cardText: z.string(),
                cardType: z.enum(["QUESTION", "DARE", "CONVERSATION_META"]),
                cardIntensity: z.number().int().min(1).max(5),
                intensity: z.number().int().min(1).max(5),
                questionCategoryId: z.string().nullable(),
                dareTypeId: z.string().nullable(),
            })
            .loose()
            .nullable(),
        cardsShown: z.number().int().nonnegative(),
        remainingCardCount: z.number().int().nonnegative(),
        voteResult: voteResultSchema,
        neverHaveIEverVoting: neverHaveIEverVotingViewSchema.nullable(),
        hasVoted: z.boolean(),
        controllablePlayers: z.array(playerSchema.extend({ hasVoted: z.boolean() })),
        viewer: z
            .object({
                participantId: z.uuid(),
                role: clientRoleSchema,
                displayName: z.string().min(1).max(40),
            })
            .strict()
            .nullable(),
        availableActions: z.array(clientCapabilitySchema),
    })
    .strict();
export type SessionView = z.infer<typeof sessionViewSchema>;

export const publicRoomParticipantSchema = z
    .object({
        id: z.uuid(),
        roomId: z.uuid(),
        role: clientRoleSchema,
        displayName: z.string().min(1).max(40),
        devicePlayers: z.array(playerSchema).max(19),
        connectionStatus: participantConnectionStatusSchema,
    })
    .strict();
export type PublicRoomParticipant = z.infer<typeof publicRoomParticipantSchema>;

const versionedRoomGameSettingsSchema = z.lazy(() =>
    roomGameSettingsSchema.extend({
        revision: z.number().int().nonnegative(),
        updatedByParticipantId: z.uuid().nullable(),
    }),
);
export type VersionedRoomGameSettings = z.infer<typeof versionedRoomGameSettingsSchema>;

export const roomSnapshotSchema = z
    .object({
        roomId: z.uuid(),
        capacity: z
            .object({
                maximumParticipants: z.number().int().min(2),
                maximumPlayers: z.number().int().min(2),
            })
            .strict(),
        participants: z.array(publicRoomParticipantSchema),
        bootstrapMode: roomBootstrapModeSchema,
        hostStatus: roomHostStatusSchema,
        boundaryConfigured: z.boolean(),
        settings: versionedRoomGameSettingsSchema,
        session: sessionViewSchema.nullable(),
    })
    .strict();
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

export const serverHelloEnvelopeSchema = envelopeSchema.extend({
    type: z.literal("server.hello"),
    revision: z.null(),
    payload: z
        .object({
            protocolVersion: z.literal(PROTOCOL_VERSION),
            participantId: z.uuid(),
            role: clientRoleSchema,
        })
        .strict(),
});

export const serverPongEnvelopeSchema = envelopeSchema.extend({
    type: z.literal("server.pong"),
    requestId: z.string().min(1),
    revision: z.null(),
    payload: z.object({ serverTime: z.number().int().nonnegative() }).strict(),
});

export const roomSnapshotEnvelopeSchema = envelopeSchema.extend({
    type: z.literal("room.snapshot"),
    payload: roomSnapshotSchema,
});

export const roomPresenceEnvelopeSchema = envelopeSchema.extend({
    type: z.literal("room.presence"),
    revision: z.null(),
    payload: z
        .object({
            connected: z.array(
                z
                    .object({
                        participantId: z.uuid(),
                        displayName: z.string().min(1).max(40),
                        role: clientRoleSchema,
                    })
                    .strict(),
            ),
        })
        .strict(),
});
export type RoomPresence = z.infer<typeof roomPresenceEnvelopeSchema>["payload"]["connected"];

export const roomRoleChangedEnvelopeSchema = envelopeSchema.extend({
    type: z.literal("room.roleChanged"),
    revision: z.null(),
    payload: roomRoleChangedPayloadSchema,
});

export const participantLeftEnvelopeSchema = envelopeSchema.extend({
    type: z.literal("room.participantLeft"),
    revision: z.null(),
    payload: participantLeftEventPayloadSchema,
});

export const cardReplacedEnvelopeSchema = envelopeSchema.extend({
    type: z.literal("session.cardReplaced"),
    revision: z.null(),
    payload: cardReplacedEventPayloadSchema,
});

export const protocolErrorEnvelopeSchema = envelopeSchema.extend({
    type: z.literal("error"),
    revision: z.null(),
    payload: z
        .object({ code: protocolErrorCodeSchema, message: z.string().min(1).max(500) })
        .strict(),
});

export const serverEnvelopeSchema = z.union([
    serverHelloEnvelopeSchema,
    serverPongEnvelopeSchema,
    roomSnapshotEnvelopeSchema,
    roomPresenceEnvelopeSchema,
    roomRoleChangedEnvelopeSchema,
    participantLeftEnvelopeSchema,
    cardReplacedEnvelopeSchema,
    protocolErrorEnvelopeSchema,
]);
export type ServerEnvelope = z.infer<typeof serverEnvelopeSchema>;
