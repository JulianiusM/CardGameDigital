import { MESSAGE_KEYS } from "../localization/keys";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
    CARD_TYPES,
    BUILT_IN_PROFILE_IDS,
    GameSession,
    type GameMode,
    type GameProfile,
    type DareTypeId,
    type OperationalFlag,
    type QuestionCategoryId,
    type RandomSource,
    builtInGameProfile,
    type PlayerBoundaries,
    validateGameProfile,
} from "../game-core";
import {
    DEFAULT_CARD_TRANSLATION_POLICY,
    type CardLocalizationPolicy,
    type CardRepository,
} from "./repositories";
import type {
    RealtimeRoomRepository,
    RoomJoinResult,
    RoomParticipant,
    RoomRole,
} from "./realtimeRooms";
import {
    boundariesForSessionPlayers,
    controlledPlayerIds,
    fallbackHost,
    sessionPlayers,
} from "./roomParticipants";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const roleCapabilities: Record<RoomRole, ReadonlySet<string>> = {
    HOST: new Set([
        "DISPLAY_SESSION",
        "START_SESSION",
        "CHOOSE_CARD_TYPE",
        "SUBMIT_VOTE",
        "SKIP_CARD",
        "ADVANCE_SESSION",
        "END_SESSION",
        "SET_BOUNDARIES",
        "MANAGE_DEVICE_PLAYERS",
        "TRANSFER_HOST",
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
export type RoomCommand =
    | {
          type: "command.startSession";
          revision: null;
          payload: {
              mode: GameMode;
              profileId?: string;
              groupId?: string | null;
              adultContentConfirmed?: boolean;
              maximumIntensity: 1 | 2 | 3 | 4 | 5;
              randomQuestionRatio: number;
              letsTalkMetaInterval: number;
              cardLocale: string;
          };
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
    | { type: "command.leaveRoom"; revision: number | null; payload: Record<string, never> };

export type RoomSnapshot = {
    roomId: string;
    participants: readonly RoomParticipant[];
    boundaryConfigured: boolean;
    session: ReturnType<RoomService["project"]> | null;
};

export class RoomService {
    private readonly sessions = new Map<string, GameSession>();
    private readonly queues = new Map<string, Promise<unknown>>();
    constructor(
        private readonly repository: RealtimeRoomRepository,
        private readonly cards: CardRepository,
        private readonly random: RandomSource,
        private readonly cardTranslationPolicy: Pick<
            CardLocalizationPolicy,
            "missingTranslation" | "fallbackLocale"
        > = DEFAULT_CARD_TRANSLATION_POLICY,
    ) {}

    async createRoom(
        displayName: string,
        dataSpaceId: string | null = null,
    ): Promise<RoomJoinResult> {
        let code = "";
        do {
            code = Array.from(
                randomBytes(6),
                (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length],
            ).join("");
        } while (await this.repository.roomCodeExists(code));
        const roomId = randomUUID();
        const participantId = randomUUID();
        const credential = randomBytes(32).toString("base64url");
        await this.repository.createRoom({
            roomId,
            code,
            dataSpaceId,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            participant: {
                id: participantId,
                roomId,
                role: "HOST",
                displayName,
                devicePlayers: [],
                connectionStatus: "TEMPORARILY_DISCONNECTED",
                credentialHash: this.hashCredential(credential),
            },
        });
        return {
            roomId,
            roomCode: code,
            participantId,
            participantCredential: credential,
            role: "HOST",
        };
    }

    async joinRoom(
        roomCode: string,
        displayName: string,
        role: Exclude<RoomRole, "HOST">,
    ): Promise<RoomJoinResult> {
        const participantId = randomUUID();
        const credential = randomBytes(32).toString("base64url");
        // The repository resolves the non-secret code to the real Room ID.
        await this.repository.joinRoom({
            id: participantId,
            roomCode,
            role,
            displayName,
            devicePlayers: [],
            connectionStatus: "TEMPORARILY_DISCONNECTED",
            credentialHash: this.hashCredential(credential),
        });
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

    async authenticate(roomCode: string, credential: string): Promise<RoomParticipant | null> {
        const participant = await this.repository.authenticate(
            roomCode,
            this.hashCredential(credential),
        );
        if (!participant) return null;
        await this.repository.setConnectionStatus(participant.id, "CONNECTED");
        return { ...participant, connectionStatus: "CONNECTED" };
    }

    async markConnected(participant: RoomParticipant): Promise<void> {
        await this.repository.setConnectionStatus(participant.id, "CONNECTED");
    }

    initializeConnectionLifecycle(): Promise<readonly RoomParticipant[]> {
        return this.repository.resetConnectedParticipants();
    }

    async markTemporarilyDisconnected(participant: RoomParticipant): Promise<void> {
        const current = await this.repository.getParticipant(participant.roomId, participant.id);
        if (current?.connectionStatus === "CONNECTED")
            await this.repository.setConnectionStatus(participant.id, "TEMPORARILY_DISCONNECTED");
    }

    async expireDisconnectedParticipant(roomId: string, participantId: string): Promise<boolean> {
        const participant = await this.repository.getParticipant(roomId, participantId);
        if (!participant || participant.connectionStatus !== "TEMPORARILY_DISCONNECTED")
            return false;
        await this.leaveParticipant(roomId, participant);
        return true;
    }

    async snapshot(roomId: string, viewer?: RoomParticipant): Promise<RoomSnapshot> {
        const [session, participants, boundaries] = await Promise.all([
            this.loadSession(roomId),
            this.repository.listParticipants(roomId),
            this.repository.listBoundaries(roomId),
        ]);
        return {
            roomId,
            participants,
            boundaryConfigured: viewer ? boundaries.has(viewer.id) : false,
            session: session ? this.project(session, viewer, participants) : null,
        };
    }

    execute(
        roomId: string,
        participant: RoomParticipant,
        command: RoomCommand,
    ): Promise<RoomSnapshot> {
        // Commands for one Room share a promise chain. A failure is isolated so
        // it cannot poison later commands, while different Rooms remain concurrent.
        const prior = this.queues.get(roomId) ?? Promise.resolve();
        const next = prior
            .catch(() => undefined)
            .then(() => this.executeSerialized(roomId, participant, command));
        const tracked = next
            .catch(() => undefined)
            .finally(() => {
                if (this.queues.get(roomId) === tracked) this.queues.delete(roomId);
            });
        this.queues.set(roomId, tracked);
        return next;
    }

    /** Promote the oldest connected PLAYER after the host's reconnect grace period. */
    async reassignDisconnectedHost(
        roomId: string,
        disconnectedHostId: string,
        connectedParticipantIds: ReadonlySet<string>,
    ): Promise<boolean> {
        const participants = await this.repository.listParticipants(roomId);
        const fallback = fallbackHost(participants, connectedParticipantIds);
        if (!fallback) return false;
        try {
            await this.repository.transferHost(roomId, disconnectedHostId, fallback.id);
            return true;
        } catch {
            return false;
        }
    }

    private async leaveParticipant(roomId: string, participant: RoomParticipant): Promise<void> {
        const participants = await this.repository.listParticipants(roomId);
        if (participant.role === "HOST") {
            const connectedIds = new Set(
                participants
                    .filter(({ connectionStatus }) => connectionStatus === "CONNECTED")
                    .map(({ id }) => id),
            );
            connectedIds.delete(participant.id);
            await this.reassignDisconnectedHost(roomId, participant.id, connectedIds);
        }
        const current = await this.loadSession(roomId);
        if (current && participant.role !== "DISPLAY") {
            const controlledIds = controlledPlayerIds(participant, participants);
            const proposed = GameSession.restore(current.toRuntimeState(), this.random);
            proposed.removePlayers(current.revision, controlledIds);
            if (proposed.revision !== current.revision) {
                await this.repository.commitRuntime(
                    roomId,
                    current.revision,
                    proposed.toRuntimeState(),
                );
                this.sessions.set(roomId, proposed);
            }
        }
        await this.repository.setConnectionStatus(participant.id, "LEFT");
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
        if (command.type === "command.setDevicePlayers") {
            if (await this.loadSession(roomId)) {
                throw Object.assign(new Error(MESSAGE_KEYS.ROOM_DEVICE_PLAYERS_LOCKED), {
                    code: "INVALID_GAME_STATE",
                });
            }
            await this.repository.saveDevicePlayers(
                participant.id,
                command.payload.names.map((name) => ({ id: randomUUID(), name: name.trim() })),
            );
            return this.snapshot(roomId, participant);
        }
        if (command.type === "command.transferHost") {
            if (participant.role !== "HOST") {
                throw Object.assign(new Error(MESSAGE_KEYS.ROOM_HOST_ONLY_TRANSFER), {
                    code: "NOT_AUTHORIZED",
                });
            }
            await this.repository.transferHost(
                roomId,
                participant.id,
                command.payload.participantId,
            );
            return this.snapshot(roomId);
        }
        if (command.type === "command.setBoundaries") {
            if (await this.loadSession(roomId)) {
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
            await this.repository.saveBoundaries(participant.id, boundaries);
            return this.snapshot(roomId, participant);
        }
        if (command.type === "command.startSession") {
            if (await this.loadSession(roomId))
                throw Object.assign(new Error(MESSAGE_KEYS.ROOM_SESSION_ALREADY_STARTED), {
                    code: "INVALID_GAME_STATE",
                });
            const selectedProfile = builtInGameProfile(
                command.payload.profileId ?? BUILT_IN_PROFILE_IDS.FRIENDS,
            );
            if (!selectedProfile) {
                throw Object.assign(new Error(MESSAGE_KEYS.ROOM_UNKNOWN_PROFILE), {
                    code: "VALIDATION_ERROR",
                });
            }
            if (
                selectedProfile.requiresAdultConfirmation &&
                command.payload.adultContentConfirmed !== true
            ) {
                throw Object.assign(new Error(MESSAGE_KEYS.ROOM_ADULT_CONFIRMATION_REQUIRED), {
                    code: "NOT_AUTHORIZED",
                });
            }
            const profile: GameProfile = validateGameProfile({
                ...selectedProfile,
                maximumIntensity: Math.min(
                    selectedProfile.maximumIntensity,
                    command.payload.maximumIntensity,
                ) as GameProfile["maximumIntensity"],
                randomQuestionRatio: command.payload.randomQuestionRatio,
                letsTalkMetaInterval: command.payload.letsTalkMetaInterval,
            });
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
            const groupHistoryCardIds = await this.repository.selectGroup(
                roomId,
                command.payload.groupId ?? null,
            );
            const proposed = new GameSession(
                {
                    id: randomUUID(),
                    mode: command.payload.mode,
                    profile,
                    players,
                    boundariesByPlayer,
                    groupHistoryCardIds,
                    cardLocale: command.payload.cardLocale,
                },
                this.random,
            );
            const cards = await this.cards.listActive({
                locale: proposed.cardLocale,
                ...this.cardTranslationPolicy,
            });
            if (!proposed.hasEligibleCards(cards)) {
                throw Object.assign(new Error(MESSAGE_KEYS.GAME_CARD_POOL_EXHAUSTED), {
                    code: "CARD_POOL_EXHAUSTED",
                });
            }
            // Publish to the runtime cache only after the database transaction commits.
            await this.repository.commitRuntime(roomId, null, proposed.toRuntimeState());
            this.sessions.set(roomId, proposed);
            return this.snapshot(roomId, participant);
        }
        const current = await this.loadSession(roomId);
        if (!current)
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_SESSION_NOT_STARTED), {
                code: "INVALID_GAME_STATE",
            });
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
        const proposed = GameSession.restore(current.toRuntimeState(), this.random);
        const cards =
            command.type === "command.startTurn" ||
            command.type === "command.chooseCardType" ||
            command.type === "command.skipCard" ||
            command.type === "command.vetoCard"
                ? await this.cards.listActive({
                      locale: current.cardLocale,
                      ...this.cardTranslationPolicy,
                  })
                : [];
        if (command.type === "command.startTurn") proposed.startTurn(command.revision, cards);
        else if (command.type === "command.chooseCardType")
            proposed.chooseCardType(command.revision, command.payload.cardType, cards);
        else if (command.type === "command.skipCard" || command.type === "command.vetoCard")
            proposed.skipCard(command.revision, cards);
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
        // The proposed aggregate is invisible to readers and WebSocket clients until commit.
        await this.repository.commitRuntime(roomId, current.revision, proposed.toRuntimeState());
        this.sessions.set(roomId, proposed);
        return this.snapshot(roomId, participant);
    }

    private async loadSession(roomId: string): Promise<GameSession | null> {
        const cached = this.sessions.get(roomId);
        if (cached) return cached;
        const runtime = await this.repository.loadRuntime(roomId);
        if (!runtime) return null;
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
                "command.endSession": "END_SESSION",
                "command.leaveRoom": "LEAVE_ROOM",
            } as Record<string, string>
        )[command];
        if (!roleCapabilities[participant.role].has(capability))
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_NOT_AUTHORIZED), {
                code: "NOT_AUTHORIZED",
            });
    }
    private hashCredential(credential: string): string {
        return createHash("sha256").update(credential).digest("hex");
    }
    project(
        session: GameSession,
        viewer?: RoomParticipant,
        participants: readonly RoomParticipant[] = [],
    ) {
        const controllablePlayerIds = viewer
            ? controlledPlayerIds(viewer, participants)
            : new Set<string>();
        const controlsActivePlayer = session.activePlayer
            ? controllablePlayerIds.has(session.activePlayer.id)
            : false;
        const availableActions = viewer
            ? [
                  ...(viewer.role === "HOST"
                      ? ["START_SESSION", "ADVANCE_SESSION", "SKIP_CARD", "END_SESSION"]
                      : []),
                  ...(viewer.role !== "DISPLAY" && controlsActivePlayer
                      ? ["CHOOSE_CARD_TYPE", "ADVANCE_SESSION", "SKIP_CARD"]
                      : []),
                  ...(viewer.role !== "DISPLAY" &&
                  session.state === "COLLECTING_ANSWERS" &&
                  [...controllablePlayerIds].some((id) => !session.votes.has(id))
                      ? ["SUBMIT_VOTE"]
                      : []),
                  ...(viewer.role !== "DISPLAY" && session.currentCard ? ["VETO_CARD"] : []),
              ]
            : [];
        return {
            id: session.id,
            mode: session.mode,
            revision: session.revision,
            state: session.state,
            roundNumber: session.roundNumber,
            activePlayer: session.activePlayer,
            players: session.players,
            currentCard: session.currentCard,
            cardsShown: session.sessionHistory.length,
            voteResult: session.voteResult(),
            hasVoted: viewer ? session.votes.has(viewer.id) : false,
            controllablePlayers: session.players
                .filter(({ id }) => controllablePlayerIds.has(id))
                .map((player) => ({ ...player, hasVoted: session.votes.has(player.id) })),
            viewer: viewer
                ? { participantId: viewer.id, role: viewer.role, displayName: viewer.displayName }
                : null,
            availableActions,
        };
    }
}
