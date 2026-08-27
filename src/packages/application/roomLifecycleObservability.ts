import type {
    RoomBootstrapMode,
    RoomHostStatus,
    RoomLifecycleTransition,
    RoomLifecycleTransitionResult,
    RoomRole,
} from "./realtimeRooms";

export type RoomCreateObservation = {
    roomId: string;
    bootstrapMode: RoomBootstrapMode;
    creatorRole: RoomRole;
    hostStatus: RoomHostStatus;
    at: number;
    result: "CREATED" | "REPLAYED";
};

export type RoomCreateIdempotencyOutcome =
    | "CREATED"
    | "REPLAYED"
    | "CONFLICT"
    | "GONE"
    | "IN_PROGRESS"
    | "INVALID"
    | "REQUIRED"
    | "PROTECTION_UNAVAILABLE";

export type RoomLifecycleObservation = {
    roomId: string;
    participantId: string | null;
    trigger: RoomLifecycleTransition["type"];
    at: number;
    result: RoomLifecycleTransitionResult;
};

export interface RoomLifecycleObservability {
    roomCreate(event: RoomCreateObservation): void;
    roomCreateIdempotency(outcome: RoomCreateIdempotencyOutcome, roomId: string | null): void;
    lifecycleTransition(event: RoomLifecycleObservation): void;
}

export const NOOP_ROOM_LIFECYCLE_OBSERVABILITY: RoomLifecycleObservability = {
    roomCreate: () => undefined,
    roomCreateIdempotency: () => undefined,
    lifecycleTransition: () => undefined,
};
