import type { CardId, GameSessionRuntimeState, PlayerBoundaries } from "../game-core";
import type { RoomGameSettings, VersionedRoomGameSettings } from "./roomGameSettings";

export type RoomRole = "HOST" | "PLAYER" | "DISPLAY";
export type RoomBootstrapMode = "CREATOR_HOST" | "DISPLAY_WAITING_FOR_HOST";
export type RoomHostState =
    | "AWAITING_FIRST_HOST"
    | "CONNECTING"
    | "CONNECTED"
    | "RECONNECTING"
    | "AWAITING_REPLACEMENT_HOST";
export type RoomRoleChangeReason =
    | "INITIAL_HOST_ASSIGNED"
    | "HOST_TRANSFERRED"
    | "HOST_LEFT"
    | "HOST_DISCONNECT_EXPIRED"
    | "HOST_REVOKED"
    | "HOST_ACTIVATION_EXPIRED";
export type ParticipantConnectionStatus = "CONNECTED" | "TEMPORARILY_DISCONNECTED" | "LEFT";
export type DevicePlayer = { id: string; name: string };
export type RoomEnrollment = { participantId: string; boundaries: PlayerBoundaries };
export type RoomRuntimeCommit = {
    settingsRevision?: number;
    enrollment?: RoomEnrollment;
    actor?: Pick<RoomParticipant, "id" | "role">;
};
export type RoomParticipant = {
    id: string;
    roomId: string;
    role: RoomRole;
    displayName: string;
    devicePlayers: readonly DevicePlayer[];
    connectionStatus: ParticipantConnectionStatus;
    joinedAt: number;
    firstConnectedAt: number | null;
    lastConnectedAt: number | null;
    reconnectDeadline: number | null;
    activationExpiresAt: number;
    leftAt: number | null;
    revokedAt: number | null;
};
export type PublicRoomParticipant = Pick<
    RoomParticipant,
    "id" | "roomId" | "role" | "displayName" | "devicePlayers" | "connectionStatus"
>;
export type RoomState = {
    id: string;
    code: string;
    bootstrapMode: RoomBootstrapMode;
    firstHostAssignedAt: number | null;
    activationDeadline: number;
    activatedAt: number | null;
    createdAt: number;
    expiresAt: number;
    closedAt: number | null;
    creatorParticipantId: string;
};
export type RoomHostStatus = {
    state: RoomHostState;
    participantId: string | null;
    displayName: string | null;
    deadline: number | null;
};
export type RoomRoleChange = {
    participantId: string;
    previousRole: RoomRole;
    role: RoomRole;
    reason: RoomRoleChangeReason;
};
export type RoomJoinResult = {
    roomId: string;
    roomCode: string;
    participantId: string;
    participantCredential: string;
    role: RoomRole;
    bootstrapMode?: RoomBootstrapMode;
    hostStatus?: RoomHostStatus;
};
export type RoomCapacity = {
    maximumParticipants: number;
    maximumPlayers: number;
};

export type RoomCreateIdempotencyRecord = {
    principalScopeDigest: string;
    routeKey: string;
    keyDigest: string;
    lookupKeyId: string | null;
    requestFingerprint: string;
    state: "REPLAYABLE" | "RESOURCE_GONE";
    statusCode: number | null;
    responseSchemaVersion: number | null;
    responseKeyId: string | null;
    responseCiphertext: string | null;
    resourceId: string | null;
    creatorParticipantId: string | null;
};

export type RoomCreateIdempotencyInput = RoomCreateIdempotencyRecord & {
    id: string;
    createdAt: number;
};

export type RoomLifecycleTransition =
    | {
          type: "ACTIVATE";
          roomId: string;
          participantId: string;
          credentialHash: string;
          at: number;
      }
    | {
          type: "DISCONNECT";
          roomId: string;
          participantId: string;
          at: number;
          reconnectDeadline: number;
      }
    | { type: "EXPIRE"; roomId: string; participantId: string; at: number }
    | { type: "LEAVE"; roomId: string; participantId: string; at: number }
    | {
          type: "TRANSFER_HOST";
          roomId: string;
          participantId: string;
          targetParticipantId: string;
          at: number;
      }
    | {
          type: "CLOSE";
          roomId: string;
          participantId: string;
          at: number;
          expectedSessionRevision?: number | null;
      }
    | { type: "RECONCILE"; roomId: string; at: number };

export type RoomCloseReason =
    "EXPLICIT_CLOSE" | "ROOM_EXPIRED" | "INITIAL_ACTIVATION_EXPIRED" | "ABANDONED";

export type RoomLifecycleTransitionResult = {
    participant: RoomParticipant | null;
    expiredParticipants: readonly RoomParticipant[];
    roleChanges: readonly RoomRoleChange[];
    roomClosed: boolean;
    hostStatusBefore: RoomHostStatus | null;
    hostStatusAfter: RoomHostStatus | null;
    participantFirstActivated: boolean;
    replayResultsErased: number;
    closeReason: RoomCloseReason | null;
    invariantRepair: boolean;
};

export interface RealtimeRoomRepository {
    roomCodeExists(code: string): Promise<boolean>;
    createRoom(input: {
        roomId: string;
        code: string;
        dataSpaceId: string | null;
        createdAt: number;
        expiresAt: Date;
        bootstrapMode: RoomBootstrapMode;
        firstHostAssignedAt: number | null;
        activationDeadline: number;
        settings: RoomGameSettings;
        participant: RoomParticipant & { credentialHash: string };
        idempotency?: RoomCreateIdempotencyInput;
    }): Promise<{ created: true } | { created: false; record: RoomCreateIdempotencyRecord }>;
    findRoomCreateIdempotency(
        principalScopeDigest: string,
        routeKey: string,
        keyDigest: string,
    ): Promise<RoomCreateIdempotencyRecord | null>;
    joinRoom(
        input: Omit<RoomParticipant, "roomId"> & { roomCode: string; credentialHash: string },
        capacity: RoomCapacity,
    ): Promise<void>;
    authenticate(roomCode: string, credentialHash: string): Promise<RoomParticipant | null>;
    loadRoomState(roomId: string): Promise<RoomState>;
    getParticipant(roomId: string, participantId: string): Promise<RoomParticipant | null>;
    listParticipants(roomId: string): Promise<readonly RoomParticipant[]>;
    /** Terminal transitions erase participant boundary rows and represented-player runtime
     * boundaries in the same transaction; active recovery and continuing lobbies retain them. */
    applyLifecycleTransition(
        transition: RoomLifecycleTransition,
    ): Promise<RoomLifecycleTransitionResult>;
    resetConnectedParticipants(
        at: number,
        reconnectDeadline: number,
    ): Promise<readonly RoomParticipant[]>;
    findDueRoomIds(at: number, limit: number): Promise<readonly string[]>;
    deleteExpiredRoomCreateTombstones(at: number, limit: number): Promise<number>;
    saveDevicePlayers(participantId: string, players: readonly DevicePlayer[]): Promise<void>;
    loadSettings(roomId: string): Promise<VersionedRoomGameSettings>;
    saveSettings(
        roomId: string,
        participantId: string,
        expectedRevision: number,
        settings: RoomGameSettings,
    ): Promise<VersionedRoomGameSettings>;
    /** Save lobby choices only; active first-time enrollment uses commitRuntime. */
    saveBoundaries(participantId: string, boundaries: PlayerBoundaries): Promise<void>;
    listBoundaries(roomId: string): Promise<ReadonlyMap<string, PlayerBoundaries>>;
    selectGroup(roomId: string, groupId: string | null): Promise<void>;
    policyOwner?(roomId: string): Promise<{ dataSpaceId: string; groupId: string | null } | null>;
    runtimeRevision(roomId: string): Promise<{ id: string; revision: number } | null>;
    loadRuntime(roomId: string): Promise<GameSessionRuntimeState | null>;
    /** Preserve optimistic revisions and exclude ended/departed-player boundaries.
     * First-time enrollment saves the participant's boundary row and expanded runtime
     * together; a stale revision or terminal participant rejects the entire transaction. */
    commitRuntime(
        roomId: string,
        previousRevision: number | null,
        runtime: GameSessionRuntimeState,
        options?: RoomRuntimeCommit,
    ): Promise<void>;
    clearEndedRuntime(roomId: string, sessionId: string, revision: number): Promise<void>;
}
