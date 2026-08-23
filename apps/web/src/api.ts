export type Snapshot = {
    id: string;
    startedAt: number;
    mode: string;
    revision: number;
    state: string;
    roundNumber: number;
    activePlayer: { id: string; name: string } | null;
    players: { id: string; name: string }[];
    currentCard: {
        id: string;
        cardText: string;
        cardType: string;
        intensity: number;
        questionCategoryId: string | null;
        dareTypeId: string | null;
    } | null;
    cardsShown: number;
    voteResult: { yes: number; no: number; total: number };
    votedPlayerIds: string[];
};

export class ApiError extends Error {
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

async function request(path: string, init?: RequestInit): Promise<Snapshot> {
    const response = await fetch(`/api/v1/couch${path}`, {
        headers: { "accept-language": locale, "content-type": "application/json" },
        ...init,
    });
    const body = await response.json();
    if (!response.ok)
        throw new ApiError(
            body?.error?.code ?? "UNKNOWN_ERROR",
            body?.error?.message ?? messages.common.requestFailed,
        );
    return body;
}
export const couchApi = {
    create: (payload: unknown) =>
        request("/sessions", { method: "POST", body: JSON.stringify(payload) }),
    command: (session: Snapshot, command: string, payload: object = {}) =>
        request(`/sessions/${session.id}/${command}`, {
            method: "POST",
            body: JSON.stringify({ revision: session.revision, ...payload }),
        }),
};
import { locale, messages } from "./i18n";
