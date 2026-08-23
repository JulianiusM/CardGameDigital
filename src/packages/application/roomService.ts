import { MESSAGE_KEYS } from "../localization/keys";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
    CARD_TYPES,
    GameSession,
    globalCardIntensityLevel,
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
import {
    defaultRoomGameSettings,
    normalizeRoomGameSettings,
    profileRequiresAdultConfirmation,
    roomSettingsGameProfile,
    type RoomGameSettings,
    type VersionedRoomGameSettings,
} from "./roomGameSettings";
import { projectNeverHaveIEverVoting } from "./neverHaveIEverVoting";

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
        intensity: globalCardIntensityLevel(card),
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
    participants: readonly RoomParticipant[];
    boundaryConfigured: boolean;
    settings: VersionedRoomGameSettings;
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
        initialSettings?: RoomGameSettings,
    ): Promise<RoomJoinResult> {
        const settings = normalizeRoomGameSettings(
            initialSettings ?? {
                ...defaultRoomGameSettings(),
                cardLocale: await this.cards.defaultLocale(),
            },
        );
        await this.validateRoomSettings(settings);
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
            settings,
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
        const connected = { ...participant, connectionStatus: "CONNECTED" as const };
        await this.serialize(participant.roomId, () => this.addConnectedParticipant(connected));
        return connected;
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
        const [session, participants, boundaries, roomSettings] = await Promise.all([
            this.loadSession(roomId),
            this.repository.listParticipants(roomId),
            this.repository.listBoundaries(roomId),
            this.repository.loadSettings(roomId),
        ]);
        return {
            roomId,
            participants,
            boundaryConfigured: viewer ? boundaries.has(viewer.id) : false,
            settings: roomSettings,
            session: session ? this.project(session, viewer, participants) : null,
        };
    }

    execute(
        roomId: string,
        participant: RoomParticipant,
        command: RoomCommand,
    ): Promise<RoomSnapshot> {
        return this.serialize(roomId, () => this.executeSerialized(roomId, participant, command));
    }

    private serialize<T>(roomId: string, action: () => Promise<T>): Promise<T> {
        // All participant and Session transitions for one Room share a promise chain.
        // A failure is isolated so it cannot poison later work, while Rooms remain concurrent.
        const prior = this.queues.get(roomId) ?? Promise.resolve();
        const next = prior.catch(() => undefined).then(action);
        const tracked = next
            .catch(() => undefined)
            .finally(() => {
                if (this.queues.get(roomId) === tracked) this.queues.delete(roomId);
            });
        this.queues.set(roomId, tracked);
        return next;
    }

    private async addConnectedParticipant(participant: RoomParticipant): Promise<void> {
        if (participant.role === "DISPLAY") return;
        const current = await this.loadSession(participant.roomId);
        if (!current || current.state === "ENDED") return;
        const proposed = GameSession.restore(current.toRuntimeState(), this.random);
        proposed.addPlayers(current.revision, [
            { id: participant.id, name: participant.displayName },
            ...participant.devicePlayers,
        ]);
        if (proposed.revision === current.revision) return;
        await this.repository.commitRuntime(
            participant.roomId,
            current.revision,
            proposed.toRuntimeState(),
        );
        this.sessions.set(participant.roomId, proposed);
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
        if (command.type === "command.closeRoom") {
            const current = await this.loadSession(roomId);
            if (current && current.state !== "ENDED") {
                const proposed = GameSession.restore(current.toRuntimeState(), this.random);
                proposed.end(command.revision ?? current.revision);
                await this.repository.commitRuntime(
                    roomId,
                    current.revision,
                    proposed.toRuntimeState(),
                );
                this.sessions.set(roomId, proposed);
            }
            await this.repository.closeRoom(roomId, participant.id);
            const closedSnapshot = await this.snapshot(roomId);
            this.sessions.delete(roomId);
            return closedSnapshot;
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
        if (command.type === "command.updateRoomSettings") {
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
            if (await this.loadSession(roomId))
                throw Object.assign(new Error(MESSAGE_KEYS.ROOM_SESSION_ALREADY_STARTED), {
                    code: "INVALID_GAME_STATE",
                });
            const settings = await this.repository.loadSettings(roomId);
            await this.validateRoomSettings(settings);
            if (
                profileRequiresAdultConfirmation(settings.profileId) &&
                !settings.adultContentConfirmed
            ) {
                throw Object.assign(new Error(MESSAGE_KEYS.ROOM_ADULT_CONFIRMATION_REQUIRED), {
                    code: "NOT_AUTHORIZED",
                });
            }
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
            const groupHistoryCardIds = await this.repository.selectGroup(roomId, settings.groupId);
            const proposed = new GameSession(
                {
                    id: randomUUID(),
                    startedAt: Date.now(),
                    mode: settings.mode,
                    profile,
                    players,
                    boundariesByPlayer,
                    groupHistoryCardIds,
                    cardLocale: settings.cardLocale,
                    neverHaveIEverRevealMode: settings.neverHaveIEverRevealMode,
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
        if (command.type === "command.endSession" && current.state === "ENDED")
            return this.snapshot(roomId, participant);
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
        const runtime = await this.repository.loadRuntime(roomId);
        if (!runtime) {
            this.sessions.delete(roomId);
            return null;
        }
        if (cached && cached.id === runtime.id && cached.revision === runtime.revision)
            return cached;
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
        try {
            roomSettingsGameProfile(settings);
        } catch {
            throw Object.assign(new Error(MESSAGE_KEYS.ROOM_UNKNOWN_PROFILE), {
                code: "VALIDATION_ERROR",
            });
        }
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
        const cardCanBeSkipped =
            session.state === "SHOWING_CARD" || session.state === "COLLECTING_ANSWERS";
        const sessionCanAdvance =
            session.state === "WAITING_FOR_PLAYER" ||
            session.state === "SHOWING_CARD" ||
            session.state === "SHOWING_RESULTS";
        const availableActions = viewer
            ? [
                  ...(viewer.role === "HOST"
                      ? [
                            "START_SESSION",
                            ...(sessionCanAdvance ? ["ADVANCE_SESSION"] : []),
                            ...(cardCanBeSkipped ? ["SKIP_CARD"] : []),
                            "END_SESSION",
                        ]
                      : []),
                  ...(viewer.role !== "DISPLAY" && controlsActivePlayer
                      ? [
                            "CHOOSE_CARD_TYPE",
                            ...(sessionCanAdvance ? ["ADVANCE_SESSION"] : []),
                            ...(cardCanBeSkipped ? ["SKIP_CARD"] : []),
                        ]
                      : []),
                  ...(viewer.role !== "DISPLAY" &&
                  session.state === "COLLECTING_ANSWERS" &&
                  [...controllablePlayerIds].some(
                      (id) => session.isCurrentVoter(id) && !session.votes.has(id),
                  )
                      ? ["SUBMIT_VOTE"]
                      : []),
                  ...(viewer.role !== "DISPLAY" && cardCanBeSkipped ? ["VETO_CARD"] : []),
              ]
            : [];
        return {
            id: session.id,
            startedAt: session.startedAt,
            mode: session.mode,
            revision: session.revision,
            state: session.state,
            roundNumber: session.roundNumber,
            activePlayer: session.activePlayer,
            players: session.players,
            currentCard: projectCurrentCard(session.currentCard),
            cardsShown: session.sessionHistory.length,
            voteResult: session.voteResult(),
            neverHaveIEverVoting: projectNeverHaveIEverVoting(session),
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
