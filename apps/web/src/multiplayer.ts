import { locale, messages } from "./i18n";
import { fetchJsonResponse, httpErrorDetails } from "./http";
import { randomUuidV4 } from "./randomUuid";
import packageMetadata from "../../../package.json";
import {
    decodeRoomCreateResponse,
    decodeRoomJoinResponse,
    decodeServerEnvelope,
    decodeServerInfo,
} from "../../../packages/protocol/browser";
import { PROTOCOL_VERSION } from "../../../packages/protocol/version";
import type {
    CardLocaleSummary,
    CardTaxonomyCatalog,
    ClientRole,
    GameProfileSummary,
    GameSettings,
    GroupSummary,
    PublicRoomParticipant,
    RoomBootstrapMode,
    RoomCreateResponse,
    RoomGameSettings,
    RoomJoinResponse,
    RoomPresence,
    RoomSnapshot,
    ServerInfoPayload,
} from "../../../packages/protocol";

export type Role = ClientRole;
export type Participant = PublicRoomParticipant;
export type Presence = RoomPresence[number];
export type Join = RoomCreateResponse | RoomJoinResponse;
export type ServerInfo = ServerInfoPayload;
async function json<T>(path: string, init: RequestInit, decode?: (body: unknown) => T): Promise<T> {
    const { response, body } = await fetchJsonResponse(path, init);
    if (!response.ok) {
        throw new Error(httpErrorDetails(body).message ?? messages.common.requestFailed);
    }
    return decode ? decode(body) : (body as T);
}
export const rooms = {
    create: async (
        displayName: string,
        persistence: "EPHEMERAL" | "DATASPACE",
        settings: RoomGameSettings,
        bootstrapMode: RoomBootstrapMode = "CREATOR_HOST",
    ) => {
        const body = JSON.stringify({ displayName, persistence, settings, bootstrapMode });
        const idempotencyKey =
            bootstrapMode === "DISPLAY_WAITING_FOR_HOST"
                ? displayBootstrapIdempotencyKey(body)
                : null;
        const result = await json<RoomCreateResponse>(
            "/api/v1/rooms",
            {
                method: "POST",
                headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
                body,
            },
            decodeRoomCreateResponse,
        );
        if (idempotencyKey) clearDisplayBootstrapIdempotencyKey(idempotencyKey);
        return result;
    },
    join: (roomCode: string, displayName: string, role: Exclude<Role, "HOST">) =>
        json<RoomJoinResponse>(
            `/api/v1/rooms/${roomCode}/participants`,
            {
                method: "POST",
                body: JSON.stringify({ displayName, role }),
            },
            decodeRoomJoinResponse,
        ),
};
export async function loadGameProfiles(): Promise<GameProfileSummary[]> {
    const result = await json<{ profiles: GameProfileSummary[] }>("/api/v1/game-profiles", {
        method: "GET",
    });
    return result.profiles;
}
export async function loadCardLocales(): Promise<{
    defaultLocale: string;
    locales: CardLocaleSummary[];
}> {
    return json("/api/v1/catalog/locales", { method: "GET" });
}
export async function loadCardTaxonomies(cardLocale: string): Promise<CardTaxonomyCatalog> {
    return json(`/api/v1/catalog/taxonomies?locale=${encodeURIComponent(cardLocale)}`, {
        method: "GET",
    });
}
export async function loadHostConfiguration(): Promise<{
    groups: GroupSummary[];
    settings: GameSettings;
    dataSpace: { id: string; name: string };
}> {
    const [groupResult, settingsResult] = await Promise.all([
        loadGroups().then((groups) => ({ groups })),
        json<{ settings: GameSettings; dataSpace: { id: string; name: string } }>(
            "/api/v1/game-settings",
            { method: "GET" },
        ),
    ]);
    return {
        groups: groupResult.groups,
        settings: settingsResult.settings,
        dataSpace: settingsResult.dataSpace,
    };
}
export async function loadGroups(): Promise<GroupSummary[]> {
    const result = await json<{ groups: GroupSummary[] }>("/api/v1/groups", { method: "GET" });
    return result.groups;
}
export async function saveGameSettings(settings: GameSettings): Promise<GameSettings> {
    const result = await json<{ settings: GameSettings }>("/api/v1/game-settings", {
        method: "PUT",
        body: JSON.stringify(settings),
    });
    return result.settings;
}
export async function createGroup(
    name: string,
    members: string[],
    preferredProfileId?: string,
): Promise<GroupSummary> {
    return json<GroupSummary>("/api/v1/groups", {
        method: "POST",
        body: JSON.stringify({ name, members, preferredProfileId }),
    });
}
export async function updateGroup(group: GroupSummary): Promise<GroupSummary> {
    return json<GroupSummary>(`/api/v1/groups/${group.id}`, {
        method: "PUT",
        body: JSON.stringify({
            name: group.name,
            members: group.members,
            preferredProfileId: group.preferredProfileId,
            customConfiguration: group.customConfiguration,
            cardLanguageSettings: group.cardLanguageSettings,
        }),
    });
}
export async function resetGroupHistory(groupId: string): Promise<GroupSummary> {
    return json<GroupSummary>(`/api/v1/groups/${groupId}/history-reset`, {
        method: "POST",
        body: JSON.stringify({ confirmed: true }),
    });
}
export async function deleteGroup(groupId: string): Promise<void> {
    await json<void>(`/api/v1/groups/${groupId}`, { method: "DELETE" });
}
export async function loadServerInfo(): Promise<ServerInfo> {
    return json("/api/v1/server-info", { method: "GET" }, decodeServerInfo);
}

export type ReconnectPhase =
    "CONNECTED" | "CONNECTING" | "WAITING" | "OFFLINE" | "STOPPED" | "EXHAUSTED";

const MAX_RECONNECT_ATTEMPTS = 30;
const CONNECT_TIMEOUT_MS = 5_000;

export class RoomSocket {
    socket: WebSocket | undefined;
    snapshot: RoomSnapshot | null = null;
    presence: Presence[] = [];
    error = "";
    errorCode = "";
    authenticated = false;
    settingsNotice = "";
    settingsNoticeId = 0;
    roomNotice = "";
    roomNoticeId = 0;
    cardReplacementSequence = 0;
    cardReplacementReason: "SKIPPED" | "VETOED" | "" = "";
    reconnectPhase: ReconnectPhase = "CONNECTING";
    reconnectAttempt = 0;
    reconnectSeconds = 0;
    readonly reconnectMaximum = MAX_RECONNECT_ATTEMPTS;
    role: Role;
    private retry: number | undefined;
    private retryCountdown: number | undefined;
    private connectTimeout: number | undefined;
    private heartbeat: number | undefined;
    private lastServerActivity = 0;
    private leaving = false;
    private disposed = false;
    private terminalReason: "LEFT" | "RECONNECT_EXPIRED" = "LEFT";
    private pendingCardReplacement: "SKIPPED" | "VETOED" | null = null;
    constructor(
        private joined: Join,
        private changed: () => void,
        private left: (reason: "LEFT" | "ROOM_CLOSED" | "RECONNECT_EXPIRED") => void = () =>
            undefined,
        private readonly webSocketPath = "/ws",
    ) {
        this.role = joined.role;
        if (typeof window !== "undefined") {
            window.addEventListener("offline", this.browserOffline);
            window.addEventListener("online", this.browserOnline);
        }
        this.connect();
    }
    /** Opens a socket and re-authenticates with the participant credential. */
    private connect(): void {
        if (this.leaving || this.disposed) return;
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
            this.markReconnecting("OFFLINE");
            return;
        }
        this.clearRetryTimers();
        this.reconnectPhase = "CONNECTING";
        this.reconnectSeconds = 0;
        this.changed();
        const endpoint = new URL(this.webSocketPath, `${location.protocol}//${location.host}`);
        endpoint.protocol = location.protocol === "https:" ? "wss:" : "ws:";
        endpoint.searchParams.set("locale", locale);
        const socket = new WebSocket(endpoint.toString());
        this.socket = socket;
        this.connectTimeout = window.setTimeout(() => {
            if (this.socket === socket && !this.authenticated) this.reconnectFrom(socket);
        }, CONNECT_TIMEOUT_MS);
        socket.onopen = () => {
            if (this.socket !== socket || this.disposed) return;
            this.lastServerActivity = Date.now();
            this.startHeartbeat(socket);
            this.error = "";
            this.errorCode = "";
            this.send("client.hello", null, {
                supportedProtocolVersions: [PROTOCOL_VERSION],
                applicationVersion: packageMetadata.version,
                role: this.joined.role,
                capabilities: [],
                roomCode: this.joined.roomCode,
                participantCredential: this.joined.participantCredential,
            });
        };
        socket.onmessage = (event) => {
            if (this.socket !== socket || this.disposed) return;
            this.lastServerActivity = Date.now();
            let message;
            try {
                message = decodeServerEnvelope(JSON.parse(event.data));
            } catch {
                this.errorCode = "VALIDATION_ERROR";
                this.error = messages.common.requestFailed;
                this.changed();
                return;
            }
            if (!message) return;
            if (message.type === "server.pong") return;
            if (message.type === "room.snapshot") {
                const next = message.payload;
                const previousParticipantIds = new Set(
                    this.snapshot?.participants.map(({ id }) => id) ?? [],
                );
                const previousCardId = this.snapshot?.session?.currentCard?.id;
                const nextCardId = next.session?.currentCard?.id;
                const previousRevision = this.snapshot?.settings.revision;
                if (
                    previousRevision !== undefined &&
                    next.settings.revision > previousRevision &&
                    next.settings.updatedByParticipantId !== this.joined.participantId
                ) {
                    this.settingsNotice = messages.room.settingsChanged;
                    this.settingsNoticeId++;
                }
                if (this.pendingCardReplacement && nextCardId) {
                    this.cardReplacementReason = this.pendingCardReplacement;
                    this.cardReplacementSequence++;
                    this.pendingCardReplacement = null;
                } else if (previousCardId !== nextCardId) {
                    this.cardReplacementReason = "";
                }
                if (this.snapshot?.session && next.session?.state !== "ENDED") {
                    const joinedPlayers = next.participants.filter(
                        ({ id, role }) => role === "PLAYER" && !previousParticipantIds.has(id),
                    );
                    if (joinedPlayers.length) {
                        this.roomNotice = messages.room.participantJoined(
                            joinedPlayers.map(({ displayName }) => displayName).join(", "),
                        );
                        this.roomNoticeId++;
                    }
                }
                this.snapshot = next;
                this.error = "";
                this.errorCode = "";
            }
            if (message.type === "room.presence") {
                this.presence = message.payload.connected;
            }
            if (message.type === "room.roleChanged") {
                this.role = message.payload.role;
            }
            if (message.type === "room.participantLeft") {
                const payload = message.payload;
                this.roomNotice =
                    payload.reason === "DISCONNECT_EXPIRED"
                        ? messages.room.participantRemoved(payload.displayName)
                        : messages.room.participantLeft(payload.displayName);
                this.roomNoticeId++;
            }
            if (message.type === "session.cardReplaced") {
                const payload = message.payload;
                this.pendingCardReplacement = payload.reason;
                this.roomNotice =
                    payload.reason === "SKIPPED"
                        ? messages.room.cardSkipped
                        : messages.room.cardVetoed;
                this.roomNoticeId++;
            }
            if (message.type === "server.hello") {
                const payload = message.payload;
                this.authenticated = payload.participantId === this.joined.participantId;
                this.role = payload.role;
                if (this.authenticated) this.markConnected();
            }
            if (message.type === "error") {
                const payload = message.payload;
                this.errorCode = payload.code;
                this.error = payload.message;
                if (
                    !this.authenticated &&
                    ["ROOM_NOT_FOUND", "NOT_AUTHORIZED"].includes(payload.code)
                ) {
                    this.terminalReason = "RECONNECT_EXPIRED";
                    this.leaving = true;
                    socket.close();
                }
            }
            this.changed();
        };
        socket.onerror = () => {
            if (this.socket !== socket || this.disposed || this.leaving) return;
            this.reconnectFrom(socket);
        };
        socket.onclose = (event) => {
            if (this.socket !== socket || this.disposed) return;
            this.clearConnectTimeout();
            this.stopHeartbeat();
            this.authenticated = false;
            if (event.code === 4001) {
                this.left("ROOM_CLOSED");
                return;
            }
            if (this.leaving) {
                this.left(this.terminalReason);
                return;
            }
            this.markReconnecting("WAITING");
            this.scheduleReconnect();
        };
    }
    private startHeartbeat(socket: WebSocket): void {
        this.stopHeartbeat();
        this.heartbeat = window.setInterval(() => {
            if (this.socket !== socket || this.leaving || this.disposed) return;
            if (Date.now() - this.lastServerActivity > 12_000) {
                this.reconnectFrom(socket);
                return;
            }
            this.send("client.ping", null);
        }, 5_000);
    }
    private stopHeartbeat(): void {
        if (this.heartbeat) window.clearInterval(this.heartbeat);
        this.heartbeat = undefined;
    }
    private reconnectFrom(socket: WebSocket): void {
        if (this.socket !== socket || this.leaving || this.disposed) return;
        this.clearConnectTimeout();
        this.stopHeartbeat();
        this.markReconnecting("WAITING");
        socket.close();
        this.scheduleReconnect();
    }
    private markReconnecting(phase: "WAITING" | "OFFLINE"): void {
        this.authenticated = false;
        this.error = "";
        this.errorCode = "";
        this.reconnectPhase = phase;
        if (phase === "OFFLINE") this.reconnectSeconds = 0;
        this.changed();
    }
    private scheduleReconnect(): void {
        if (this.retry || this.leaving || this.disposed) return;
        if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
            this.reconnectPhase = "EXHAUSTED";
            this.reconnectSeconds = 0;
            this.changed();
            return;
        }
        const nextAttempt = this.reconnectAttempt + 1;
        const delaySeconds = Math.min(nextAttempt, 10);
        const retryAt = Date.now() + delaySeconds * 1_000;
        this.reconnectPhase = "WAITING";
        this.reconnectSeconds = delaySeconds;
        this.changed();
        this.retryCountdown = window.setInterval(() => {
            const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1_000));
            if (seconds === this.reconnectSeconds) return;
            this.reconnectSeconds = seconds;
            this.changed();
        }, 250);
        this.retry = window.setTimeout(() => {
            this.clearRetryTimers();
            this.reconnectAttempt = nextAttempt;
            this.connect();
        }, delaySeconds * 1_000);
    }
    private markConnected(): void {
        this.clearRetryTimers();
        this.clearConnectTimeout();
        this.reconnectPhase = "CONNECTED";
        this.reconnectAttempt = 0;
        this.reconnectSeconds = 0;
    }
    private clearRetryTimers(): void {
        if (this.retry) window.clearTimeout(this.retry);
        if (this.retryCountdown) window.clearInterval(this.retryCountdown);
        this.retry = undefined;
        this.retryCountdown = undefined;
    }
    private clearConnectTimeout(): void {
        if (this.connectTimeout) window.clearTimeout(this.connectTimeout);
        this.connectTimeout = undefined;
    }
    private browserOffline = (): void => {
        if (this.socket) this.reconnectFrom(this.socket);
        else {
            this.markReconnecting("OFFLINE");
            this.scheduleReconnect();
        }
    };
    private browserOnline = (): void => {
        if (this.authenticated || this.leaving || this.disposed) return;
        if (["STOPPED", "EXHAUSTED"].includes(this.reconnectPhase)) return;
        this.clearRetryTimers();
        this.connect();
    };
    send(type: string, revision: number | null, payload: object = {}): boolean {
        if (this.socket?.readyState === WebSocket.OPEN) {
            try {
                this.socket.send(
                    JSON.stringify({
                        protocol: PROTOCOL_VERSION,
                        type,
                        requestId: randomUuidV4(),
                        revision,
                        payload,
                    }),
                );
                return true;
            } catch {
                return false;
            }
        }
        return false;
    }
    command(type: string, payload: object = {}): void {
        if (
            !this.authenticated ||
            !this.send(type, this.snapshot?.session?.revision ?? null, payload)
        ) {
            this.errorCode = "CONNECTION_UNAVAILABLE";
            this.error = messages.common.connectionFailed;
            this.changed();
            return;
        }
        if (type === "command.leaveRoom") this.leaving = true;
    }
    clearSettingsNotice(): void {
        this.settingsNotice = "";
        this.changed();
    }
    retryNow(): void {
        if (this.authenticated || this.leaving || this.disposed) return;
        this.clearRetryTimers();
        this.clearConnectTimeout();
        this.reconnectAttempt = 0;
        this.reconnectPhase = "CONNECTING";
        const previous = this.socket;
        this.socket = undefined;
        previous?.close();
        this.connect();
    }
    stopReconnecting(): void {
        if (this.authenticated || this.leaving || this.disposed) return;
        this.clearRetryTimers();
        this.clearConnectTimeout();
        this.stopHeartbeat();
        this.reconnectPhase = "STOPPED";
        this.reconnectSeconds = 0;
        const previous = this.socket;
        this.socket = undefined;
        previous?.close();
        this.changed();
    }
    dispose(): void {
        this.clearRetryTimers();
        this.clearConnectTimeout();
        this.stopHeartbeat();
        this.disposed = true;
        this.leaving = true;
        if (typeof window !== "undefined") {
            window.removeEventListener("offline", this.browserOffline);
            window.removeEventListener("online", this.browserOnline);
        }
        this.socket?.close();
    }
}
export function saveJoin(join: Join) {
    sessionStorage.setItem(`room:${join.roomCode}:${join.role}`, JSON.stringify(join));
    sessionStorage.setItem(
        "party-game:last-room",
        JSON.stringify({
            roomCode: join.roomCode,
            role: join.role,
        }),
    );
}
export function loadJoin(code: string, role: Role): Join | null {
    try {
        return JSON.parse(sessionStorage.getItem(`room:${code}:${role}`) ?? "null");
    } catch {
        return null;
    }
}
export function loadLastJoin(): Join | null {
    try {
        const last = JSON.parse(sessionStorage.getItem("party-game:last-room") ?? "null") as {
            roomCode: string;
            role: Role;
        } | null;
        return last ? loadJoin(last.roomCode, last.role) : null;
    } catch {
        return null;
    }
}
export function clearJoin(join: Join): void {
    sessionStorage.removeItem(`room:${join.roomCode}:${join.role}`);
    const last = sessionStorage.getItem("party-game:last-room");
    if (last?.includes(join.roomCode)) sessionStorage.removeItem("party-game:last-room");
}

const DISPLAY_BOOTSTRAP_PENDING_KEY = "party-game:display-bootstrap-create";
let pendingDisplayBootstrapCreate: { body: string; key: string } | null = null;

function displayBootstrapIdempotencyKey(body: string): string {
    if (pendingDisplayBootstrapCreate?.body === body) {
        return pendingDisplayBootstrapCreate.key;
    }
    try {
        const pending = JSON.parse(
            sessionStorage.getItem(DISPLAY_BOOTSTRAP_PENDING_KEY) ?? "null",
        ) as { body: string; key: string } | null;
        if (pending?.body === body && pending.key) {
            pendingDisplayBootstrapCreate = pending;
            return pending.key;
        }
        const key = randomUuidV4();
        pendingDisplayBootstrapCreate = { body, key };
        sessionStorage.setItem(DISPLAY_BOOTSTRAP_PENDING_KEY, JSON.stringify({ body, key }));
        return key;
    } catch {
        const key = randomUuidV4();
        pendingDisplayBootstrapCreate = { body, key };
        return key;
    }
}

function clearDisplayBootstrapIdempotencyKey(key: string): void {
    try {
        const pending = JSON.parse(
            sessionStorage.getItem(DISPLAY_BOOTSTRAP_PENDING_KEY) ?? "null",
        ) as { key?: string } | null;
        if (pending?.key === key) sessionStorage.removeItem(DISPLAY_BOOTSTRAP_PENDING_KEY);
    } catch {
        // Storage can be unavailable in privacy-restricted browser contexts.
    }
    if (pendingDisplayBootstrapCreate?.key === key) pendingDisplayBootstrapCreate = null;
}
