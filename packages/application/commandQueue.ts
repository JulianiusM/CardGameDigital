import { MESSAGE_KEYS } from "../localization/keys";
import { DEFAULT_GAME_RESOURCE_LIMITS } from "./gameResourceLimits";

/** Small proposals wait; overload never builds an unbounded promise chain. */
export class CommandQueue {
    private readonly tails = new Map<string, Promise<void>>();
    private readonly pending = new Map<string, number>();
    private total = 0;

    constructor(
        private readonly perGame = DEFAULT_GAME_RESOURCE_LIMITS.couchCommandQueuePerGame,
        private readonly maximum = DEFAULT_GAME_RESOURCE_LIMITS.couchCommandQueueMaximum,
        private readonly terminalPerGame = DEFAULT_GAME_RESOURCE_LIMITS.couchCommandQueueTerminalPerGame,
        private readonly terminalMaximum = DEFAULT_GAME_RESOURCE_LIMITS.couchCommandQueueTerminalMaximum,
    ) {}

    run<T>(id: string, action: () => Promise<T>, terminal = false): Promise<T> {
        const count = this.pending.get(id) ?? 0;
        // A separate small allowance keeps end/leave/close available under pressure.
        if (
            count >= this.perGame + (terminal ? this.terminalPerGame : 0) ||
            this.total >= this.maximum + (terminal ? this.terminalMaximum : 0)
        )
            return Promise.reject(
                Object.assign(new Error(MESSAGE_KEYS.GAME_SESSION_CAPACITY_EXCEEDED), {
                    code: "SESSION_CAPACITY_EXCEEDED",
                    status: 429,
                }),
            );
        this.pending.set(id, count + 1);
        this.total++;
        const next = (this.tails.get(id) ?? Promise.resolve()).then(action);
        const tracked = next
            .then(
                () => undefined,
                () => undefined,
            )
            .finally(() => {
                this.total--;
                const remaining = this.pending.get(id)! - 1;
                if (remaining) this.pending.set(id, remaining);
                else this.pending.delete(id);
                if (this.tails.get(id) === tracked) this.tails.delete(id);
            });
        this.tails.set(id, tracked);
        return next;
    }
}
