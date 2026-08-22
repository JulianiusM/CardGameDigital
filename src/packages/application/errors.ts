import { MESSAGE_KEYS } from "../localization/keys";
export type ApplicationErrorCode =
    | "VALIDATION_ERROR"
    | "AUTHENTICATION_ERROR"
    | "NOT_AUTHORIZED"
    | "ROOM_NOT_FOUND"
    | "INVALID_GAME_STATE"
    | "CARD_POOL_EXHAUSTED"
    | "STALE_SESSION_REVISION";

export class ApplicationError extends Error {
    constructor(
        readonly code: ApplicationErrorCode,
        message: string,
        readonly details?: unknown,
    ) {
        super(message);
        this.name = new.target.name;
    }
}

export class StaleRevisionError extends ApplicationError {
    constructor(
        readonly expected: number,
        readonly received: number,
    ) {
        super("STALE_SESSION_REVISION", MESSAGE_KEYS.GAME_STALE_REVISION, {
            expected,
            received,
        });
    }
}

export class CardPoolExhaustedError extends ApplicationError {
    constructor() {
        super("CARD_POOL_EXHAUSTED", MESSAGE_KEYS.GAME_CARD_POOL_EXHAUSTED);
    }
}
