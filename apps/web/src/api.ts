import { messages } from "./i18n";
import { ApiError, fetchJsonResponse, httpErrorDetails } from "./http";
import { decodeCouchSessionSnapshot, type CouchSessionSnapshot } from "../../../packages/protocol";

export type Snapshot = CouchSessionSnapshot;
export const COUCH_SESSION_STORAGE_KEY = "party-game:couch-session";

async function request(path: string, init?: RequestInit): Promise<Snapshot> {
    const { response, body: unknownBody } = await fetchJsonResponse(`/api/v1/couch${path}`, init);
    if (!response.ok) {
        const error = httpErrorDetails(unknownBody);
        throw new ApiError(
            error.code ?? "UNKNOWN_ERROR",
            error.message ?? messages.common.requestFailed,
            response.status,
        );
    }
    const snapshot = decodeCouchSessionSnapshot(unknownBody);
    if (!snapshot) throw new Error(messages.common.requestFailed);
    return snapshot;
}
export const couchApi = {
    get: (id: string, signal?: AbortSignal) =>
        request(`/sessions/${encodeURIComponent(id)}`, { signal, cache: "no-store" }),
    create: (payload: unknown) =>
        request("/sessions", { method: "POST", body: JSON.stringify(payload) }),
    command: (session: Snapshot, command: string, payload: object = {}) =>
        request(`/sessions/${session.id}/${command}`, {
            method: "POST",
            signal: AbortSignal.timeout(10_000),
            body: JSON.stringify({ revision: session.revision, ...payload }),
        }),
};
