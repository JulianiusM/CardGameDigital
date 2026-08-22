/** Framework-independent identifiers shared by the first domain seams. */
export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type CardId = Brand<string, "CardId">;
export type GameSessionId = Brand<string, "GameSessionId">;
export type RoomId = Brand<string, "RoomId">;
export type GroupId = Brand<string, "GroupId">;
export type DataSpaceId = Brand<string, "DataSpaceId">;

export type GameSessionSnapshot = {
    id: GameSessionId;
    revision: number;
    runtimeStateVersion: number;
    runtimeState: unknown;
};

export * from "./cards/card";
export * from "./cards/taxonomy";
export * from "./eligibility/cardEligibility";
export * from "./history/history";
export * from "./profiles/gameProfile";
export * from "./random/randomSource";
export * from "./selection/weightedSelection";
export * from "./sessions/session";
export * from "./profiles/builtInProfiles";
