import { SessionCache } from "./sessionCache";
import { DEFAULT_GAME_RESOURCE_LIMITS, type GameResourceLimits } from "./gameResourceLimits";
import { CommandQueue } from "./commandQueue";
import { withSessionCreationCapacity } from "./sessionCreationCapacity";
import { consentCheckedCards, currentSessionCard } from "./sessionCards";
import type { CardStream } from "../game-core";
import { MESSAGE_KEYS } from "../localization/keys";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
    GameSession,
    type DareTypeId,
    type OperationalFlag,
    type QuestionCategoryId,
    type RandomSource,
    type PlayerBoundaries,
    type PlayableCard,
} from "../game-core";
import {
    DEFAULT_CARD_TRANSLATION_POLICY,
    type CardLocalizationPolicy,
    type CardRepository,
} from "./repositories";
import type {
    RealtimeRoomRepository,
    RoomCapacity,
    RoomBootstrapMode,
    RoomCreateIdempotencyRecord,
    RoomJoinResult,
    RoomLifecycleTransitionResult,
    RoomParticipant,
    RoomRole,
} from "./realtimeRooms";
import {
    boundariesForSessionPlayers,
    controlledPlayerIds,
    sessionPlayers,
} from "./roomParticipants";
import { derivePersistedRoomHostStatus } from "./roomHostSelection";
import {
    ROOM_CREATE_RESPONSE_SCHEMA_VERSION,
    ROOM_CREATE_ROUTE_KEY,
    type RoomCreateIdempotencyProtection,
} from "./roomCreateIdempotency";
import {
    defaultRoomGameSettings,
    normalizeRoomGameSettings,
    roomSettingsGameProfile,
    type RoomGameSettings,
    type VersionedRoomGameSettings,
} from "./roomGameSettings";
import { projectNeverHaveIEverVoting, projectVoteResult } from "./neverHaveIEverVoting";
import { projectCardIntensities } from "./cardIntensityProjection";
import type { CardPolicyService } from "./cardPolicyService";
import { requiresAdultConfirmation } from "./adultConfirmation";
import {
    NOOP_ROOM_LIFECYCLE_OBSERVABILITY,
    type RoomCreateIdempotencyOutcome,
    type RoomLifecycleObservability,
} from "./roomLifecycleObservability";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const DEFAULT_ROOM_CAPACITY: Readonly<RoomCapacity> = Object.freeze({
    maximumParticipants: 100,
    maximumPlayers: 100,
});
const roleCapabilities: Record<RoomRole, ReadonlySet<string>> = {
    HOST: new Set([
        "DISPLAY_SESSION",
        "START_SESSION",
        "CHOOSE_CARD_TYPE",
        "SUBMIT_VOTE",
        "SKIP_CARD",
        "ADVANCE_SESSION",
        "END_SESSION",
        "RESET_SESSION",
        "CLOSE_ROOM",
        "SET_BOUNDARIES",
        "MANAGE_DEVICE_PLAYERS",
        "TRANSFER_HOST",
        "CHANGE_ROOM_SETTINGS",
        "LEAVE_ROOM",
    ]),
    PLAYER: new Set([
        "DISPLAY_SESSION",
        "CHOOSE_CARD_TYPE",
        "SUBMIT_VOTE",
        "SKIP_CARD",
        "ADVANCE_SESSION",
        "SET_BOUNDARIES",
        "MANAGE_DEVICE_PLAYERS",
        "LEAVE_ROOM",
    ]),
    DISPLAY: new Set(["DISPLAY_SESSION", "LEAVE_ROOM"]),
};

function projectCurrentCard(card: PlayableCard | null) {
    if (!card) return null;
    return {
        ...card,
        ...projectCardIntensities(card),
    };
}
export type RoomCommand =
    | { type: "command.startSession"; revision: null; payload: Record<string, never> }
    | {
          type: "command.updateRoomSettings";
          revision: null;
          payload: { expectedRevision: number; settings: RoomGameSettings };
      }
    | {
          type: "command.setDevicePlayers";
          revision: null;
          payload: { names: string[] };
      }
    | {
          type: "command.transferHost";
          revision: number | null;
          payload: { participantId: string };
      }
    | { type: "command.startTurn"; revision: number; payload: Record<string, never> }
    | {
          type: "command.chooseCardType";
          revision: number;
          payload: { cardType: "QUESTION" | "DARE" };
      }
    | { type: "command.skipCard"; revision: number; payload: Record<string, never> }
    | { type: "command.advanceSession"; revision: number; payload: Record<string, never> }
    | {
          type: "command.submitVote";
          revision: number;
          payload: { vote: "YES" | "NO"; playerId?: string };
      }
    | { type: "command.vetoCard"; revision: number; payload: Record<string, never> }
    | {
          type: "command.setBoundaries";
          revision: null;
          payload: {
              disabledQuestionCategoryIds: string[];
              disabledDareTypeIds: string[];
              blockedOperationalFlags: string[];
          };
      }
    | { type: "command.endSession"; revision: number; payload: Record<string, never> }
    | { type: "command.resetSession"; revision: number; payload: Record<string, never> }
    | { type: "command.closeRoom"; revision: number | null; payload: Record<string, never> }
    | { type: "command.leaveRoom"; revision: number | null; payload: Record<string, never> };

export type RoomSnapshot = {
    roomId: string;
    capacity: Readonly<RoomCapacity>;
    participants: readonly import("./realtimeRooms").PublicRoomParticipant[];
    bootstrapMode: RoomBootstrapMode;
    hostStatus: import("./realtimeRooms").RoomHostStatus;
    boundaryConfigured: boolean;
    settings: VersionedRoomGameSettings;
    session: Awaited<ReturnType<RoomService["project"]>> | null;
};

export type RoomConnectionActivation = RoomParticipant & {
    roleChanges: import("./realtimeRooms").RoomRoleChange[];
};

export type CreateRoomOptions = {
    bootstrapMode?: RoomBootstrapMode;
    idempotency?: {
        key: string;
        principalScope: string;
        requestBody: unknown;
    };
};

type RoomLifecycleOptions = {
    displayBootstrapEnabled: boolean;
    initialActivationMs: number;
    unactivatedParticipantTtlMs: number;
    reconnectGraceMs: number;
    idempotencyProtection: RoomCreateIdempotencyProtection | null;
    observability: RoomLifecycleObservability;
};

const DEFAULT_ROOM_LIFECYCLE: RoomLifecycleOptions = {
    displayBootstrapEnabled: false,
    initialActivationMs: 300_000,
    unactivatedParticipantTtlMs: 300_000,
    reconnectGraceMs: 180_000,
    idempotencyProtection: null,
    observability: NOOP_ROOM_LIFECYCLE_OBSERVABILITY,
};

export class RoomService {
    private readonly sessions: SessionCache;
    private readonly queues: CommandQueue;
    private readonly lifecycle: RoomLifecycleOptions;
    constructor(
        private readonly repository: RealtimeRoomRepository,
        private readonly cards: CardRepository,
        private readonly random: RandomSource,
        private readonly cardTranslationPolicy: Pick<
            CardLocalizationPolicy,
            "missingTranslation" | "fallbackLocales"
        > = DEFAULT_CARD_TRANSLATION_POLICY,
        private readonly capacity: Readonly<RoomCapacity> = DEFAULT_ROOM_CAPACITY,
        private readonly cardPolicies?: CardPolicyService,
        lifecycle: Partial<RoomLifecycleOptions> = {},
        private readonly limits: GameResourceLimits = DEFAULT_GAME_RESOURCE_LIMITS,
    ) {
        this.lifecycle = { ...DEFAULT_ROOM_LIFECYCLE, ...lifecycle };
        this.sessions = new SessionCache(limits);
        this.queues = new CommandQueue(
            limits.roomCommandQueuePerGame,
            limits.roomCommandQueueMaximum,
            limits.roomCommandQueueTerminalPerGame,
            limits.roomCommandQueueTerminalMaximum,
        );
    }

    async createRoom(
        displayName: string,
        dataSpaceId: string | null = null,
        initialSettings?: RoomGameSettings,
        options: CreateRoomOptions = {},
    ): Promise<RoomJoinResult> {
        return (
            await this.createRoomWithOutcome(displayName, dataSpaceId, initialSettings, options)
        ).response;
    }

    async createRoomWithOutcome(
        displayName: string,
        dataSpaceId: string | null = null,
        initialSettings?: RoomGameSettings,
        options: CreateRoomOptions = {},
    ): Promise<{ response: RoomJoinResult; outcome: "CREATED" | "REPLAYED" }> {
        const bootstrapMode = options.bootstrapMode ?? "CREATOR_HOST";
        const protection = this.lifecycle.idempotencyProtection;
        let idempotency:
            | {
                  principalScopeDigest: string;
                  keyDigest: string;
                  requestFingerprint: string;
              }
            | undefined;
        if (options.idempotency) {
            idempotency = this.protectRoomCreate(protection, options.idempotency);
            const replay = await this.repository.findRoomCreateIdempotency(
                idempotency.principalScopeDigest,
                ROOM_CREATE_ROUTE_KEY,
                idempotency.keyDigest,
            );
            if (replay) {
                const response = this.replayRoomCreate(replay, idempotency.requestFingerprint);
                this.observeRoomCreate(response, bootstrapMode, "REPLAYED");
                return {
                    response,
                    outcome: "REPLAYED",
                };
            }
        }
        this.validateBootstrapMode(bootstrapMode);
        const settings = normalizeRoomGameSettings(
            initialSettings ?? {
                ...defaultRoomGameSettings(),
                cardLocale: await this.cards.defaultLocale(),
            },
        );
        await this.validateRoomSettings(settings);
        const code = await this.createUnusedRoomCode();
        const roomId = randomUUID();
        const participantId = randomUUID();
        const credential = randomBytes(32).toString("base64url");
        const createdAt = Date.now();
        const activationDeadline = createdAt + this.lifecycle.initialActivationMs;
        const activationExpiresAt = createdAt + this.lifecycle.unactivatedParticipantTtlMs;
        const role: RoomRole = bootstrapMode === "DISPLAY_WAITING_FOR_HOST" ? "DISPLAY" : "HOST";
        const hostStatus =
            role === "HOST"
                ? {
                      state: "CONNECTING" as const,
                      participantId,
                      displayName,
                      deadline: activationExpiresAt,
                  }
                : {
                      state: "AWAITING_FIRST_HOST" as const,
                      participantId: null,
                      displayName: null,
                      deadline: null,
                  };
        const response: RoomJoinResult = {
            roomId,
            roomCode: code,
            participantId,
            participantCredential: credential,
            role,
            bootstrapMode,
            hostStatus,
        };
        const replayBinding = idempotency
            ? {
                  routeKey: ROOM_CREATE_ROUTE_KEY,
                  principalScopeDigest: idempotency.principalScopeDigest,
                  keyDigest: idempotency.keyDigest,
                  requestFingerprint: idempotency.requestFingerprint,
                  resourceId: roomId,
                  responseSchemaVersion: ROOM_CREATE_RESPONSE_SCHEMA_VERSION,
              }
            : null;
        let persisted: Awaited<ReturnType<RealtimeRoomRepository["createRoom"]>>;
        try {
            persisted = await this.repository.createRoom({
                roomId,
                code,
                dataSpaceId,
                createdAt,
                expiresAt: new Date(createdAt + this.limits.roomLifetimeSeconds * 1000),
                bootstrapMode,
                firstHostAssignedAt: role === "HOST" ? createdAt : null,
                activationDeadline,
                settings,
                participant: {
                    id: participantId,
                    roomId,
                    role,
                    displayName,
                    devicePlayers: [],
                    connectionStatus: "TEMPORARILY_DISCONNECTED",
                    joinedAt: createdAt,
                    firstConnectedAt: null,
                    lastConnectedAt: null,
                    reconnectDeadline: null,
                    activationExpiresAt,
                    leftAt: null,
                    revokedAt: null,
                    credentialHash: this.hashCredential(credential),
                },
                idempotency:
                    idempotency && protection && replayBinding
                        ? {
                              id: randomUUID(),
                              ...idempotency,
                              routeKey: ROOM_CREATE_ROUTE_KEY,
                              lookupKeyId: protection.lookupKeyId,
                              state: "REPLAYABLE",
                              statusCode: 201,
                              responseSchemaVersion: ROOM_CREATE_RESPONSE_SCHEMA_VERSION,
                              responseKeyId: protection.responseKeyId,
                              responseCiphertext: protection.encryptResponse(
                                  replayBinding,
                                  response,
                              ),
                              resourceId: roomId,
                              creatorParticipantId: participantId,
                              createdAt,
                          }
                        : undefined,
            });
        } catch (error) {
            if (idempotency) this.observeIdempotencyError(error, roomId);
            throw error;
        }
        if (!persisted.created) {
            const replayed = this.replayRoomCreate(
                persisted.record,
                idempotency!.requestFingerprint,
            );
            this.observeRoomCreate(replayed, bootstrapMode, "REPLAYED");
            return {
                response: replayed,
                outcome: "REPLAYED",
            };
        }
        this.observeRoomCreate(response, bootstrapMode, "CREATED", createdAt);
        if (idempotency) this.lifecycle.observability.roomCreateIdempotency("CREATED", roomId);
        return { response, outcome: "CREATED" };
    }

    private validateBootstrapMode(bootstrapMode: string) {
        if (
            bootstrapMode === "DISPLAY_WAITING_FOR_HOST" &&
            !this.lifecycle.displayBootstrapEnabled
        ) {
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_BOOTSTRAP_UNSUPPORTED), {
                code: "ROOM_BOOTSTRAP_MODE_UNSUPPORTED",
            });
        }
    }

    private protectRoomCreate(
        protection: RoomCreateIdempotencyProtection | null,
        input: NonNullable<CreateRoomOptions["idempotency"]>,
    ) {
        if (!protection) {
            this.lifecycle.observability.roomCreateIdempotency("PROTECTION_UNAVAILABLE", null);
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_BOOTSTRAP_UNSUPPORTED), {
                code: "ROOM_BOOTSTRAP_MODE_UNSUPPORTED",
            });
        }
        return {
            principalScopeDigest: protection.principalScopeDigest(input.principalScope),
            keyDigest: protection.keyDigest(input.key),
            requestFingerprint: protection.requestFingerprint(input.requestBody),
        };
    }

    private async createUnusedRoomCode() {
        let code = "";
        do {
            code = Array.from(
                randomBytes(6),
                (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length],
            ).join("");
        } while (await this.repository.roomCodeExists(code));
        return code;
    }

    async joinRoom(
        roomCode: string,
        displayName: string,
        role: Exclude<RoomRole, "HOST">,
    ): Promise<RoomJoinResult> {
        const participantId = randomUUID();
        const credential = randomBytes(32).toString("base64url");
        const joinedAt = Date.now();
        // The repository resolves the non-secret code to the real Room ID.
        await this.repository.joinRoom(
            {
                id: participantId,
                roomCode,
                role,
                displayName,
                devicePlayers: [],
                connectionStatus: "TEMPORARILY_DISCONNECTED",
                joinedAt,
                firstConnectedAt: null,
                lastConnectedAt: null,
                reconnectDeadline: null,
                activationExpiresAt: joinedAt + this.lifecycle.unactivatedParticipantTtlMs,
                leftAt: null,
                revokedAt: null,
                credentialHash: this.hashCredential(credential),
            },
            this.capacity,
        );
        const participant = await this.repository.authenticate(
            roomCode,
            this.hashCredential(credential),
        );
        if (!participant)
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_JOIN_NOT_COMMITTED), {
                code: "ROOM_NOT_FOUND",
            });
        return {
            roomId: participant.roomId,
            roomCode,
            participantId,
            participantCredential: credential,
            role,
        };
    }

    async authenticate(
        roomCode: string,
        credential: string,
    ): Promise<RoomConnectionActivation | null> {
        const credentialHash = this.hashCredential(credential);
        const participant = await this.repository.authenticate(roomCode, credentialHash);
        if (!participant) return null;
        return this.serialize(participant.roomId, async () => {
            const lifecycleTransition = {
                type: "ACTIVATE",
                roomId: participant.roomId,
                participantId: participant.id,
                credentialHash,
                at: Date.now(),
            } as const;
            const result = await this.repository.applyLifecycleTransition(lifecycleTransition);
            this.observeLifecycleTransition(lifecycleTransition, result);
            if (!result.participant || result.roomClosed) return null;
            return {
                ...result.participant,
                roleChanges: [...result.roleChanges],
            };
        });
    }

    /** Resolve the current lobby pool for an authenticated Room participant without
     * changing connection state or exposing the Room's persistent policy owner. */
    async eligibilityPreview(roomCode: string, credential: string) {
        const participant = await this.repository.authenticate(
            roomCode.toUpperCase(),
            this.hashCredential(credential),
        );
        if (!participant) return null;
        if (!this.cardPolicies) throw new Error("Card policy service is unavailable");

        const [settings, participants, policyOwner] = await Promise.all([
            this.repository.loadSettings(participant.roomId),
            this.repository.listParticipants(participant.roomId),
            this.repository.policyOwner?.(participant.roomId) ?? Promise.resolve(null),
        ]);
        const group =
            settings.groupId && policyOwner?.dataSpaceId
                ? await this.cards.groupHistoryWindow(
                      policyOwner.dataSpaceId,
                      settings.groupId,
                      Date.now(),
                  )
                : null;
        const cards = this.cards.scan(this.localizationPolicy(settings), {
            sessionId: "",
            topology: "ROOM",
            group,
        });
        return this.cardPolicies.eligibilityPreview({
            cards,
            dataSpaceId: policyOwner?.dataSpaceId,
            groupId: policyOwner?.groupId,
            profile: roomSettingsGameProfile(settings),
            sessionPolicy: settings.cardPolicy,
            mode: settings.mode,
            playerCount: Math.max(2, sessionPlayers(participants).length),
        });
    }

    initializeConnectionLifecycle(
        reconnectGraceMs = this.lifecycle.reconnectGraceMs,
    ): Promise<readonly RoomParticipant[]> {
        const at = Date.now();
        return this.repository.resetConnectedParticipants(at, at + reconnectGraceMs);
    }

    async markTemporarilyDisconnected(
        participant: RoomParticipant,
        reconnectGraceMs = this.lifecycle.reconnectGraceMs,
    ): Promise<RoomLifecycleTransitionResult> {
        return this.serialize(
            participant.roomId,
            async () => {
                const at = Date.now();
                const transition = {
                    type: "DISCONNECT",
                    roomId: participant.roomId,
                    participantId: participant.id,
                    at,
                    reconnectDeadline: at + reconnectGraceMs,
                } as const;
                const result = await this.repository.applyLifecycleTransition(transition);
                this.observeLifecycleTransition(transition, result);
                return result;
            },
            true,
        );
    }

    async expireDisconnectedParticipant(
        roomId: string,
        participantId: string,
    ): Promise<RoomLifecycleTransitionResult> {
        return this.serialize(
            roomId,
            async () => {
                const transition = {
                    type: "EXPIRE",
                    roomId,
                    participantId,
                    at: Date.now(),
                } as const;
                const result = await this.repository.applyLifecycleTransition(transition);
                this.observeLifecycleTransition(transition, result);
                return result;
            },
            true,
        );
    }

    async reconcileDueRooms(limit = 100): Promise<
        readonly {
            roomId: string;
            result: RoomLifecycleTransitionResult;
        }[]
    > {
        const at = Date.now();
        const roomIds = await this.repository.findDueRoomIds(at, limit);
        const results = [];
        for (const roomId of roomIds) {
            const result = await this.serialize(
                roomId,
                async () => {
                    const transition = {
                        type: "RECONCILE",
                        roomId,
                        at,
                    } as const;
                    const reconciled = await this.repository.applyLifecycleTransition(transition);
                    this.observeLifecycleTransition(transition, reconciled);
                    return reconciled;
                },
                true,
            );
            results.push({ roomId, result });
        }
        await this.repository.deleteExpiredRoomCreateTombstones(at, limit);
        return results;
    }

    async snapshot(roomId: string, viewer?: RoomParticipant): Promise<RoomSnapshot> {
        return (await this.snapshotProjection(roomId))(viewer);
    }

    /** Build shared state once per broadcast; viewer-specific controls remain private. */
    async snapshotProjection(roomId: string): Promise<(viewer?: RoomParticipant) => RoomSnapshot> {
        const [session, participants, boundaries, roomSettings, room] = await Promise.all([
            this.loadSession(roomId),
            this.repository.listParticipants(roomId),
            this.repository.listBoundaries(roomId),
            this.repository.loadSettings(roomId),
            this.repository.loadRoomState(roomId),
        ]);
        const remainingCardCount = session
            ? await session.remainingEligibleCardCount(
                  this.cards.scan(this.localizationPolicy(session), session.historyContext),
              )
            : 0;
        const common: RoomSnapshot = {
            roomId,
            capacity: this.capacity,
            participants: participants.map(
                ({ id, roomId, role, displayName, devicePlayers, connectionStatus }) => ({
                    id,
                    roomId,
                    role,
                    displayName,
                    devicePlayers,
                    connectionStatus,
                }),
            ),
            bootstrapMode: room.bootstrapMode,
            hostStatus: derivePersistedRoomHostStatus(room, participants),
            boundaryConfigured: false,
            settings: roomSettings,
            session: session
                ? await this.project(session, undefined, participants, remainingCardCount)
                : null,
        };
        const participantsById = new Map(
            participants.map((participant) => [participant.id, participant]),
        );
        const players = new Map(session?.players.map((player) => [player.id, player]));
        return (viewer) => ({
            ...common,
            boundaryConfigured: viewer ? boundaries.has(viewer.id) : false,
            session:
                session && common.session
                    ? {
                          ...common.session,
                          ...this.projectViewer(
                              session,
                              viewer ? (participantsById.get(viewer.id) ?? viewer) : undefined,
                              players,
                          ),
                      }
                    : null,
        });
    }

    execute(
        roomId: string,
        participant: RoomParticipant,
        command: RoomCommand,
    ): Promise<RoomSnapshot> {
        return this.serialize(
            roomId,
            () => this.executeSerialized(roomId, participant, command),
            ["command.endSession", "command.leaveRoom", "command.closeRoom"].includes(command.type),
        );
    }

    private serialize<T>(roomId: string, action: () => Promise<T>, terminal = false): Promise<T> {
        // All participant and Session transitions for one Room share a promise chain.
        // A failure is isolated so it cannot poison later work, while Rooms remain concurrent.
        return this.queues.run(roomId, action, terminal);
    }

    pruneSessions(at = Date.now()): number {
        return this.sessions.prune(at);
    }

    private async leaveParticipant(
        roomId: string,
        participant: RoomParticipant,
    ): Promise<RoomLifecycleTransitionResult> {
        const transition = {
            type: "LEAVE",
            roomId,
            participantId: participant.id,
            at: Date.now(),
        } as const;
        const result = await this.repository.applyLifecycleTransition(transition);
        this.observeLifecycleTransition(transition, result);
        return result;
    }

    private async executeSerialized(
        roomId: string,
        participant: RoomParticipant,
        command: RoomCommand,
    ): Promise<RoomSnapshot> {
        const authoritativeParticipant = await this.repository.getParticipant(
            roomId,
            participant.id,
        );
        if (!authoritativeParticipant)
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_NOT_AUTHORIZED), {
                code: "NOT_AUTHORIZED",
            });
        participant = authoritativeParticipant;
        this.authorize(participant, command.type);
        if (command.type === "command.leaveRoom") {
            await this.leaveParticipant(roomId, participant);
            return this.snapshot(roomId);
        }
        if (command.type === "command.closeRoom") {
            return await this.closeRoom(roomId, command, participant);
        }
        if (command.type === "command.setDevicePlayers") {
            return await this.setDevicePlayers(roomId, participant, command);
        }
        if (command.type === "command.transferHost") {
            return await this.transferHost(participant, roomId, command);
        }
        if (command.type === "command.updateRoomSettings") {
            return await this.updateRoomSettings(roomId, command, participant);
        }
        if (command.type === "command.setBoundaries") {
            return await this.setBoundaries(roomId, command, participant);
        }
        if (command.type === "command.resetSession") {
            const current = await this.loadSession(roomId);
            if (!current) return this.snapshot(roomId, participant);
            if (current.state !== "ENDED")
                throw Object.assign(new Error(MESSAGE_KEYS.ROOM_SESSION_NOT_ENDED), {
                    code: "INVALID_GAME_STATE",
                });
            await this.repository.clearEndedRuntime(roomId, current.id, current.revision);
            this.sessions.delete(roomId);
            return this.snapshot(roomId, participant);
        }
        if (command.type === "command.startSession") {
            return await this.startSession(roomId, participant);
        }
        return this.executeSessionCommand(roomId, participant, command);
    }

    private async startSession(roomId: string, participant: RoomParticipant) {
        return withSessionCreationCapacity(
            () => this.startSessionWithinCapacity(roomId, participant),
            this.limits.sessionConcurrentStarts,
        );
    }

    private async startSessionWithinCapacity(roomId: string, participant: RoomParticipant) {
        if (await this.loadSession(roomId))
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_SESSION_ALREADY_STARTED), {
                code: "INVALID_GAME_STATE",
            });
        const settings = await this.repository.loadSettings(roomId);
        await this.validateRoomSettings(settings);
        const profile = roomSettingsGameProfile(settings);
        const participants = await this.repository.listParticipants(roomId);
        const players = sessionPlayers(participants);
        if (players.length < 2) {
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_MINIMUM_PLAYERS), {
                code: "VALIDATION_ERROR",
            });
        }
        const boundariesByPlayer = boundariesForSessionPlayers(
            participants,
            await this.repository.listBoundaries(roomId),
        );
        await this.repository.selectGroup(roomId, settings.groupId);
        const catalog = await this.cards.catalogProvenance();
        const policyOwner = await this.repository.policyOwner?.(roomId);
        const policySnapshot =
            (await this.cardPolicies?.captureSessionPolicy({
                dataSpaceId: policyOwner?.dataSpaceId,
                groupId: settings.groupId,
            })) ?? null;
        const sessionId = randomUUID();
        const startedAt = Date.now();
        const group =
            settings.groupId && policyOwner?.dataSpaceId
                ? await this.cards.groupHistoryWindow(
                      policyOwner.dataSpaceId,
                      settings.groupId,
                      startedAt,
                  )
                : null;
        const proposed = new GameSession(
            {
                id: sessionId,
                startedAt,
                mode: settings.mode,
                profile,
                players,
                boundariesByPlayer,
                cardLocale: settings.cardLocale,
                cardFallbackEnabled: settings.cardFallbackEnabled,
                cardFallbackLocales: settings.cardFallbackLocales,
                neverHaveIEverRevealMode: settings.neverHaveIEverRevealMode,
                catalog,
                policySnapshot,
                historyContext: { sessionId, topology: "ROOM", group },
                sessionCardPolicy: settings.cardPolicy,
            },
            this.random,
        );
        if (
            !(await proposed.hasEligibleCards(
                consentCheckedCards(
                    proposed,
                    this.cards.scan(this.localizationPolicy(proposed), proposed.historyContext),
                    settings.adultContentConfirmed,
                ),
            ))
        ) {
            throw Object.assign(new Error(MESSAGE_KEYS.GAME_CARD_POOL_EXHAUSTED), {
                code: "CARD_POOL_EXHAUSTED",
            });
        }
        // Publish to the runtime cache only after the database transaction commits.
        await this.repository.commitRuntime(roomId, null, proposed.toRuntimeState(), {
            actor: participant,
            settingsRevision: settings.revision,
        });
        this.sessions.set(roomId, proposed);
        return this.snapshot(roomId, participant);
    }

    private async setBoundaries(
        roomId: string,
        command: Extract<RoomCommand, { type: "command.setBoundaries" }>,
        participant: RoomParticipant,
    ) {
        const current = await this.loadSession(roomId);
        if (
            current &&
            (current.state === "ENDED" || current.players.some(({ id }) => id === participant.id))
        ) {
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_BOUNDARIES_LOCKED), {
                code: "INVALID_GAME_STATE",
            });
        }
        const boundaries: PlayerBoundaries = {
            disabledQuestionCategoryIds: new Set(
                command.payload.disabledQuestionCategoryIds as QuestionCategoryId[],
            ),
            disabledDareTypeIds: new Set(command.payload.disabledDareTypeIds as DareTypeId[]),
            blockedOperationalFlags: new Set(
                command.payload.blockedOperationalFlags as OperationalFlag[],
            ),
        };
        if (current) {
            const proposed = current.fork(this.random);
            const players = sessionPlayers([participant]);
            proposed.addPlayers(
                current.revision,
                players,
                new Map(players.map(({ id }) => [id, boundaries])),
            );
            await this.repository.commitRuntime(
                roomId,
                current.revision,
                proposed.toRuntimeState(),
                { enrollment: { participantId: participant.id, boundaries }, actor: participant },
            );
            this.sessions.set(roomId, proposed);
        } else {
            await this.repository.saveBoundaries(participant.id, boundaries);
        }
        return this.snapshot(roomId, participant);
    }

    private async updateRoomSettings(
        roomId: string,
        command: Extract<RoomCommand, { type: "command.updateRoomSettings" }>,
        participant: RoomParticipant,
    ) {
        if (await this.loadSession(roomId)) {
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_SETTINGS_LOCKED), {
                code: "INVALID_GAME_STATE",
            });
        }
        const settings = normalizeRoomGameSettings(command.payload.settings);
        await this.validateRoomSettings(settings);
        await this.repository.saveSettings(
            roomId,
            participant.id,
            command.payload.expectedRevision,
            settings,
        );
        return this.snapshot(roomId, participant);
    }

    private async transferHost(
        participant: RoomParticipant,
        roomId: string,
        command: Extract<RoomCommand, { type: "command.transferHost" }>,
    ) {
        if (participant.role !== "HOST") {
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_HOST_ONLY_TRANSFER), {
                code: "NOT_AUTHORIZED",
            });
        }
        const transition = {
            type: "TRANSFER_HOST",
            roomId,
            participantId: participant.id,
            targetParticipantId: command.payload.participantId,
            at: Date.now(),
        } as const;
        const result = await this.repository.applyLifecycleTransition(transition);
        this.observeLifecycleTransition(transition, result);
        return this.snapshot(roomId);
    }

    private async setDevicePlayers(
        roomId: string,
        participant: RoomParticipant,
        command: Extract<RoomCommand, { type: "command.setDevicePlayers" }>,
    ) {
        if (await this.loadSession(roomId)) {
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_DEVICE_PLAYERS_LOCKED), {
                code: "INVALID_GAME_STATE",
            });
        }
        const participants = await this.repository.listParticipants(roomId);
        const playerCount = participants.reduce((total, current) => {
            if (current.role === "DISPLAY") return total;
            const devicePlayerCount =
                current.id === participant.id
                    ? command.payload.names.length
                    : current.devicePlayers.length;
            return total + 1 + devicePlayerCount;
        }, 0);
        if (playerCount > this.capacity.maximumPlayers) {
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_FULL), { code: "ROOM_FULL" });
        }
        await this.repository.saveDevicePlayers(
            participant.id,
            command.payload.names.map((name) => ({ id: randomUUID(), name: name.trim() })),
        );
        return this.snapshot(roomId, participant);
    }

    private async closeRoom(
        roomId: string,
        command: Extract<RoomCommand, { type: "command.closeRoom" }>,
        participant: RoomParticipant,
    ) {
        const transition = {
            type: "CLOSE",
            roomId,
            participantId: participant.id,
            at: Date.now(),
            expectedSessionRevision: command.revision,
        } as const;
        const result = await this.repository.applyLifecycleTransition(transition);
        this.observeLifecycleTransition(transition, result);
        const closedSnapshot = await this.snapshot(roomId);
        this.sessions.delete(roomId);
        return closedSnapshot;
    }

    private async executeSessionCommand(
        roomId: string,
        participant: RoomParticipant,
        command: SessionCommand,
    ): Promise<RoomSnapshot> {
        const current = await this.loadSession(roomId);
        if (!current)
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_SESSION_NOT_STARTED), {
                code: "INVALID_GAME_STATE",
            });
        if (command.type === "command.endSession" && current.state === "ENDED")
            return this.snapshot(roomId, participant);
        if (
            command.type !== "command.endSession" &&
            !current.players.some(({ id }) => id === participant.id)
        ) {
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_ENROLLMENT_REQUIRED), {
                code: "NOT_AUTHORIZED",
            });
        }
        const roomParticipants = await this.repository.listParticipants(roomId);
        const controllablePlayerIds = controlledPlayerIds(participant, roomParticipants);
        if (
            command.type === "command.chooseCardType" &&
            (!current.activePlayer || !controllablePlayerIds.has(current.activePlayer.id))
        )
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_ACTIVE_PLAYER_ONLY), {
                code: "NOT_ACTIVE_PLAYER",
            });
        if (
            (command.type === "command.startTurn" || command.type === "command.advanceSession") &&
            participant.role !== "HOST" &&
            (!current.activePlayer || !controllablePlayerIds.has(current.activePlayer.id))
        )
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_ACTIVE_PLAYER_OR_HOST_ONLY), {
                code: "NOT_ACTIVE_PLAYER",
            });
        const proposed = current.fork(this.random);
        const cards = this.cards.scan(this.localizationPolicy(proposed), proposed.historyContext);
        await this.applySessionCommand(
            command,
            proposed,
            cards,
            participant,
            controllablePlayerIds,
        );
        // The proposed aggregate is invisible to readers and WebSocket clients until commit.
        await this.repository.commitRuntime(roomId, current.revision, proposed.toRuntimeState(), {
            actor: participant,
        });
        this.sessions.set(roomId, proposed);
        return this.snapshot(roomId, participant);
    }
    private async applySessionCommand(
        command: SessionCommand,
        proposed: GameSession,
        cards: CardStream,
        participant: RoomParticipant,
        controllablePlayerIds: ReadonlySet<string>,
    ) {
        if (command.type === "command.startTurn") await proposed.startTurn(command.revision, cards);
        else if (command.type === "command.chooseCardType")
            await proposed.chooseCardType(command.revision, command.payload.cardType, cards);
        else if (command.type === "command.skipCard")
            await proposed.skipCard(command.revision, cards);
        else if (command.type === "command.vetoCard")
            await proposed.vetoCard(command.revision, cards);
        else if (command.type === "command.advanceSession") proposed.advance(command.revision);
        else if (command.type === "command.submitVote") {
            const voterId = command.payload.playerId ?? participant.id;
            if (!controllablePlayerIds.has(voterId)) {
                throw Object.assign(new Error(MESSAGE_KEYS.ROOM_CANNOT_VOTE_FOR_OTHER), {
                    code: "NOT_AUTHORIZED",
                });
            }
            proposed.submitVote(command.revision, voterId, command.payload.vote);
        } else if (command.type === "command.endSession") proposed.end(command.revision);
    }

    private async loadSession(roomId: string): Promise<GameSession | null> {
        const cached = this.sessions.get(roomId);
        if (cached) {
            const persisted = await this.repository.runtimeRevision(roomId);
            if (persisted?.id === cached.id && persisted.revision === cached.revision)
                return cached;
        }
        const runtime = await this.repository.loadRuntime(roomId);
        if (!runtime) {
            this.sessions.delete(roomId);
            return null;
        }
        if (cached?.id === runtime.id && cached.revision === runtime.revision) return cached;
        const restored = GameSession.restore(runtime, this.random);
        this.sessions.set(roomId, restored);
        return restored;
    }
    private authorize(participant: RoomParticipant, command: string): void {
        const capability = (
            {
                "command.startSession": "START_SESSION",
                "command.startTurn": "ADVANCE_SESSION",
                "command.chooseCardType": "CHOOSE_CARD_TYPE",
                "command.skipCard": "SKIP_CARD",
                "command.vetoCard": "SKIP_CARD",
                "command.advanceSession": "ADVANCE_SESSION",
                "command.submitVote": "SUBMIT_VOTE",
                "command.setBoundaries": "SET_BOUNDARIES",
                "command.setDevicePlayers": "MANAGE_DEVICE_PLAYERS",
                "command.transferHost": "TRANSFER_HOST",
                "command.updateRoomSettings": "CHANGE_ROOM_SETTINGS",
                "command.endSession": "END_SESSION",
                "command.resetSession": "RESET_SESSION",
                "command.closeRoom": "CLOSE_ROOM",
                "command.leaveRoom": "LEAVE_ROOM",
            } as Record<string, string>
        )[command];
        if (!roleCapabilities[participant.role].has(capability))
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_NOT_AUTHORIZED), {
                code: "NOT_AUTHORIZED",
            });
    }
    private async validateRoomSettings(settings: RoomGameSettings): Promise<void> {
        if (!(await this.cards.isLocaleActive(settings.cardLocale))) {
            throw Object.assign(new Error(MESSAGE_KEYS.CARD_LOCALE_UNAVAILABLE), {
                code: "CARD_LOCALE_UNAVAILABLE",
            });
        }
        if (settings.cardFallbackEnabled && settings.cardFallbackLocales.length === 0) {
            throw Object.assign(new Error(MESSAGE_KEYS.CARD_LOCALE_UNAVAILABLE), {
                code: "CARD_LOCALE_UNAVAILABLE",
            });
        }
        const normalizedFallbacks = settings.cardFallbackLocales.map((entry) =>
            entry.toLowerCase(),
        );
        if (
            new Set(normalizedFallbacks).size !== normalizedFallbacks.length ||
            normalizedFallbacks.includes(settings.cardLocale.toLowerCase())
        ) {
            throw Object.assign(new Error(MESSAGE_KEYS.CARD_LOCALE_UNAVAILABLE), {
                code: "CARD_LOCALE_UNAVAILABLE",
            });
        }
        for (const fallbackLocale of settings.cardFallbackLocales) {
            if (!(await this.cards.isLocaleActive(fallbackLocale))) {
                throw Object.assign(new Error(MESSAGE_KEYS.CARD_LOCALE_UNAVAILABLE), {
                    code: "CARD_LOCALE_UNAVAILABLE",
                });
            }
        }
        try {
            roomSettingsGameProfile(settings);
        } catch {
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_UNKNOWN_PROFILE), {
                code: "VALIDATION_ERROR",
            });
        }
    }
    private localizationPolicy(
        session: Pick<GameSession, "cardLocale" | "cardFallbackEnabled" | "cardFallbackLocales">,
    ): CardLocalizationPolicy {
        if (session.cardFallbackEnabled) {
            return {
                locale: session.cardLocale,
                missingTranslation: "FALLBACK",
                fallbackLocales: session.cardFallbackLocales,
            };
        }
        return { locale: session.cardLocale, ...this.cardTranslationPolicy };
    }
    private replayRoomCreate(
        record: RoomCreateIdempotencyRecord,
        requestFingerprint: string,
    ): RoomJoinResult {
        const protection = this.lifecycle.idempotencyProtection;
        if (!protection) {
            this.lifecycle.observability.roomCreateIdempotency(
                "PROTECTION_UNAVAILABLE",
                record.resourceId,
            );
            throw new Error("Room-create replay protection is unavailable");
        }
        if (!protection.matchesFingerprint(record.requestFingerprint, requestFingerprint)) {
            this.lifecycle.observability.roomCreateIdempotency("CONFLICT", record.resourceId);
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_IDEMPOTENCY_REUSED), {
                code: "IDEMPOTENCY_KEY_REUSED",
            });
        }
        if (record.state === "RESOURCE_GONE") {
            this.lifecycle.observability.roomCreateIdempotency("GONE", record.resourceId);
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_IDEMPOTENCY_GONE), {
                code: "IDEMPOTENCY_RESULT_GONE",
            });
        }
        if (
            record.statusCode !== 201 ||
            record.responseSchemaVersion !== ROOM_CREATE_RESPONSE_SCHEMA_VERSION ||
            record.lookupKeyId !== protection.lookupKeyId ||
            record.responseKeyId !== protection.responseKeyId ||
            !record.responseCiphertext ||
            !record.resourceId
        ) {
            this.lifecycle.observability.roomCreateIdempotency(
                "PROTECTION_UNAVAILABLE",
                record.resourceId,
            );
            throw new Error("Stored Room-create replay metadata is inconsistent");
        }
        try {
            const response = protection.decryptResponse(
                {
                    routeKey: record.routeKey,
                    principalScopeDigest: record.principalScopeDigest,
                    keyDigest: record.keyDigest,
                    requestFingerprint: record.requestFingerprint,
                    resourceId: record.resourceId,
                    responseSchemaVersion: record.responseSchemaVersion,
                },
                record.responseCiphertext,
            );
            this.lifecycle.observability.roomCreateIdempotency("REPLAYED", response.roomId);
            return response;
        } catch (error) {
            this.lifecycle.observability.roomCreateIdempotency(
                "PROTECTION_UNAVAILABLE",
                record.resourceId,
            );
            throw error;
        }
    }
    private observeRoomCreate(
        response: RoomJoinResult,
        bootstrapMode: RoomBootstrapMode,
        result: "CREATED" | "REPLAYED",
        at = Date.now(),
    ): void {
        if (!response.hostStatus) {
            throw new Error("Room-create response is missing authoritative Host status");
        }
        this.lifecycle.observability.roomCreate({
            roomId: response.roomId,
            bootstrapMode,
            creatorRole: response.role,
            hostStatus: response.hostStatus,
            at,
            result,
        });
    }
    private observeIdempotencyError(error: unknown, roomId: string | null): void {
        const code = (error as { code?: string }).code;
        let outcome: RoomCreateIdempotencyOutcome | null = null;
        if (code === "IDEMPOTENCY_KEY_REUSED") outcome = "CONFLICT";
        else if (code === "IDEMPOTENCY_RESULT_GONE") outcome = "GONE";
        else if (code === "IDEMPOTENCY_REQUEST_IN_PROGRESS") outcome = "IN_PROGRESS";
        if (outcome) this.lifecycle.observability.roomCreateIdempotency(outcome, roomId);
    }
    private observeLifecycleTransition(
        transition: import("./realtimeRooms").RoomLifecycleTransition,
        result: RoomLifecycleTransitionResult,
    ): void {
        if (result.roomClosed) this.sessions.delete(transition.roomId);
        this.lifecycle.observability.lifecycleTransition({
            roomId: transition.roomId,
            participantId: "participantId" in transition ? transition.participantId : null,
            trigger: transition.type,
            at: transition.at,
            result,
        });
    }
    private hashCredential(credential: string): string {
        return createHash("sha256").update(credential).digest("hex");
    }
    async project(
        session: GameSession,
        viewer?: RoomParticipant,
        participants: readonly RoomParticipant[] = [],
        remainingCardCount = 0,
    ) {
        const voting = projectNeverHaveIEverVoting(session);
        return {
            id: session.id,
            startedAt: session.startedAt,
            mode: session.mode,
            revision: session.revision,
            state: session.state,
            roundNumber: session.roundNumber,
            activePlayer: session.activePlayer,
            players: session.players,
            currentCard: projectCurrentCard(
                await currentSessionCard(session, this.cards, this.localizationPolicy(session)),
            ),
            cardsShown: session.cardsShown,
            remainingCardCount,
            voteResult: projectVoteResult(voting),
            neverHaveIEverVoting: voting,
            ...this.projectViewer(
                session,
                viewer,
                new Map(session.players.map((player) => [player.id, player])),
            ),
        };
    }

    private projectViewer(
        session: GameSession,
        viewer: RoomParticipant | undefined,
        players: ReadonlyMap<string, GameSession["players"][number]>,
    ) {
        const controlled = viewer ? controlledPlayerIds(viewer, []) : new Set<string>();
        return {
            hasVoted: viewer ? session.votes.has(viewer.id) : false,
            controllablePlayers: [...controlled].flatMap((id) => {
                const player = players.get(id);
                return player ? [{ ...player, hasVoted: session.votes.has(id) }] : [];
            }),
            viewer: viewer
                ? { participantId: viewer.id, role: viewer.role, displayName: viewer.displayName }
                : null,
            availableActions: this.availableSessionActions(session, controlled, viewer),
        };
    }

    private availableSessionActions(
        session: GameSession,
        controllablePlayerIds: ReadonlySet<string>,
        viewer: RoomParticipant | undefined,
    ): string[] {
        if (!viewer || viewer.role === "DISPLAY") return [];
        if (!session.players.some(({ id }) => id === viewer.id)) {
            return viewer.role === "HOST" ? ["END_SESSION"] : [];
        }
        const cardCanBeSkipped =
            session.state === "SHOWING_CARD" || session.state === "COLLECTING_ANSWERS";
        const sessionCanAdvance =
            session.state === "WAITING_FOR_PLAYER" ||
            session.state === "SHOWING_CARD" ||
            session.state === "SHOWING_RESULTS";
        const progressionActions: string[] = [];
        if (sessionCanAdvance) progressionActions.push("ADVANCE_SESSION");
        if (cardCanBeSkipped) progressionActions.push("SKIP_CARD");
        const availableActions: string[] = [];
        if (viewer.role === "HOST")
            availableActions.push("START_SESSION", ...progressionActions, "END_SESSION");
        if (session.activePlayer && controllablePlayerIds.has(session.activePlayer.id)) {
            availableActions.push("CHOOSE_CARD_TYPE", ...progressionActions);
        }
        if (
            session.state === "COLLECTING_ANSWERS" &&
            [...controllablePlayerIds].some(
                (id) => session.isCurrentVoter(id) && !session.votes.has(id),
            )
        ) {
            availableActions.push("SUBMIT_VOTE");
        }
        if (cardCanBeSkipped) availableActions.push("VETO_CARD");
        return availableActions;
    }
}

type SessionCommand = Extract<
    RoomCommand,
    {
        type:
            | "command.startTurn"
            | "command.chooseCardType"
            | "command.skipCard"
            | "command.vetoCard"
            | "command.advanceSession"
            | "command.submitVote"
            | "command.endSession";
    }
>;
