import { type EntityManager } from "typeorm";
import { MESSAGE_KEYS } from "../localization/keys";
import { GameCapacityEntity } from "./entities/game/GameCapacityEntity";
import {
    DEFAULT_GAME_RESOURCE_LIMITS,
    type GameResourceLimits,
} from "../application/gameResourceLimits";

export const MAXIMUM_RETAINED_TEMPORARY_ROOMS = DEFAULT_GAME_RESOURCE_LIMITS.retainedRoomCapacity;
export const MAXIMUM_ACTIVE_SAVED_COUCH_GAMES = DEFAULT_GAME_RESOURCE_LIMITS.savedCouchCapacity;
export const MAXIMUM_TEMPORARY_ROOM_SESSIONS =
    DEFAULT_GAME_RESOURCE_LIMITS.temporaryRoomSessionCapacity;

export async function lockGameCapacity(manager: EntityManager): Promise<void> {
    const lock = manager
        .getRepository(GameCapacityEntity)
        .createQueryBuilder("capacity")
        .where("capacity.id = 1");
    if (manager.connection.options.type !== "better-sqlite3") lock.setLock("pessimistic_write");
    await lock.getOneOrFail();
}

export async function admitPersistentGame(
    manager: EntityManager,
    kind: "ROOM" | "COUCH",
    limits: GameResourceLimits = DEFAULT_GAME_RESOURCE_LIMITS,
): Promise<void> {
    // The transaction's consistent reads begin after acquiring the admission lock.
    const [row] = await manager.query(
        kind === "ROOM"
            ? "SELECT COUNT(*) AS total FROM rooms WHERE data_space_id IS NULL OR closed_at IS NULL"
            : "SELECT COUNT(*) AS total FROM couch_game_sessions WHERE ended_at IS NULL",
    );
    const limit = kind === "ROOM" ? limits.retainedRoomCapacity : limits.savedCouchCapacity;
    if (Number(row.total) >= limit)
        throw Object.assign(new Error(MESSAGE_KEYS.GAME_SESSION_CAPACITY_EXCEEDED), {
            code: "SESSION_CAPACITY_EXCEEDED",
            status: 429,
        });
}
