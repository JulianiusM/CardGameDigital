import type { CardId, GameSessionRuntimeState, PlayerBoundaries } from "../game-core";
import type { RoomGameSettings, VersionedRoomGameSettings } from "./roomGameSettings";

export type RoomRole = "HOST" | "PLAYER" | "DISPLAY";
export type ParticipantConnectionStatus = "CONNECTED" | "TEMPORARILY_DISCONNECTED" | "LEFT";
export type DevicePlayer = { id: string; name: string };
export type RoomParticipant = {
    id: string;
    roomId: string;
    role: RoomRole;
    displayName: string;
    devicePlayers: readonly DevicePlayer[];
    connectionStatus: ParticipantConnectionStatus;
};
export type RoomJoinResult = {
    roomId: string;
    roomCode: string;
    participantId: string;
    participantCredential: string;
    role: RoomRole;
};
export interface RealtimeRoomRepository {
    roomCodeExists(code: string): Promise<boolean>;
    createRoom(input: {
        roomId: string;
        code: string;
        dataSpaceId: string | null;
        expiresAt: Date;
        settings: RoomGameSettings;
        participant: RoomParticipant & { credentialHash: string };
    }): Promise<void>;
    joinRoom(
        input: Omit<RoomParticipant, "roomId"> & { roomCode: string; credentialHash: string },
    ): Promise<void>;
    authenticate(roomCode: string, credentialHash: string): Promise<RoomParticipant | null>;
    getParticipant(roomId: string, participantId: string): Promise<RoomParticipant | null>;
    listParticipants(roomId: string): Promise<readonly RoomParticipant[]>;
    setConnectionStatus(participantId: string, status: ParticipantConnectionStatus): Promise<void>;
    resetConnectedParticipants(): Promise<readonly RoomParticipant[]>;
    saveDevicePlayers(participantId: string, players: readonly DevicePlayer[]): Promise<void>;
    transferHost(roomId: string, currentHostId: string, nextHostId: string): Promise<void>;
    closeRoom(roomId: string, hostParticipantId: string): Promise<void>;
    loadSettings(roomId: string): Promise<VersionedRoomGameSettings>;
    saveSettings(
        roomId: string,
        participantId: string,
        expectedRevision: number,
        settings: RoomGameSettings,
    ): Promise<VersionedRoomGameSettings>;
    saveBoundaries(participantId: string, boundaries: PlayerBoundaries): Promise<void>;
    listBoundaries(roomId: string): Promise<ReadonlyMap<string, PlayerBoundaries>>;
    selectGroup(roomId: string, groupId: string | null): Promise<ReadonlySet<CardId>>;
    loadRuntime(roomId: string): Promise<GameSessionRuntimeState | null>;
    commitRuntime(
        roomId: string,
        previousRevision: number | null,
        runtime: GameSessionRuntimeState,
    ): Promise<void>;
    clearEndedRuntime(roomId: string, sessionId: string, revision: number): Promise<void>;
}
