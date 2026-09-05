import { messages } from "./i18n";
import { fetchJsonResponse, httpErrorDetails } from "./http";
import type { CouchSessionSnapshot } from "../../../packages/protocol";

export type Snapshot = CouchSessionSnapshot;

export class ApiError extends Error {
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

async function request(path: string, init?: RequestInit): Promise<Snapshot> {
    const { response, body: unknownBody } = await fetchJsonResponse(`/api/v1/couch${path}`, init);
    if (!response.ok) {
        const error = httpErrorDetails(unknownBody);
        throw new ApiError(
            error.code ?? "UNKNOWN_ERROR",
            error.message ?? messages.common.requestFailed,
        );
    }
    return unknownBody as Snapshot;
}
export const couchApi = {
    get: (id: string) => request(`/sessions/${encodeURIComponent(id)}`),
    create: (payload: unknown) =>
        request("/sessions", { method: "POST", body: JSON.stringify(payload) }),
    command: (session: Snapshot, command: string, payload: object = {}) =>
        request(`/sessions/${session.id}/${command}`, {
            method: "POST",
            body: JSON.stringify({ revision: session.revision, ...payload }),
        }),
};
