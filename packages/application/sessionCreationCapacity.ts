import { MESSAGE_KEYS } from "../localization/keys";
import { DEFAULT_GAME_RESOURCE_LIMITS } from "./gameResourceLimits";

export const MAXIMUM_CONCURRENT_SESSION_STARTS =
    DEFAULT_GAME_RESOURCE_LIMITS.sessionConcurrentStarts;
let starting = 0;

/** Reject before loading or compiling a catalog; do not queue large proposals. */
export async function withSessionCreationCapacity<T>(
    create: () => Promise<T>,
    maximum = MAXIMUM_CONCURRENT_SESSION_STARTS,
): Promise<T> {
    if (starting >= maximum) {
        throw Object.assign(new Error(MESSAGE_KEYS.GAME_SESSION_CAPACITY_EXCEEDED), {
            code: "SESSION_CAPACITY_EXCEEDED",
            status: 429,
        });
    }
    starting++;
    try {
        return await create();
    } finally {
        starting--;
    }
}
