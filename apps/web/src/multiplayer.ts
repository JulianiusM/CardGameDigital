import { locale, messages } from "./i18n";

export type Role = "HOST" | "PLAYER" | "DISPLAY";
export type Participant = {
    id: string;
    roomId: string;
    role: Role;
    displayName: string;
    devicePlayers: { id: string; name: string }[];
    connectionStatus: "CONNECTED" | "TEMPORARILY_DISCONNECTED";
};
export type Presence = Pick<Participant, "displayName" | "role"> & { participantId: string };
export type SessionView = {
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
    neverHaveIEverVoting: NeverHaveIEverVotingView | null;
    hasVoted: boolean;
    viewer: { participantId: string; role: Role; displayName: string };
    availableActions: string[];
    controllablePlayers: { id: string; name: string; hasVoted: boolean }[];
};
export type NeverHaveIEverRevealMode = "ANONYMOUS_AGGREGATE" | "NAMED_ANSWERS";
export type NeverHaveIEverVotingView = {
    revealMode: NeverHaveIEverRevealMode;
    progress: {
        playerId: string;
        displayName: string;
        status: "PENDING" | "VOTED";
    }[];
    result: {
        yes: number;
        no: number;
        total: number;
        namedAnswers?: {
            playerId: string;
            displayName: string;
            vote: "YES" | "NO";
        }[];
    } | null;
};
export type RoomSnapshot = {
    roomId: string;
    participants: Participant[];
    boundaryConfigured: boolean;
    settings: VersionedRoomGameSettings;
    session: SessionView | null;
};
export type EffectiveGameSettings = {
    enabledQuestionCategoryIds: string[];
    enabledDareTypeIds: string[];
    blockedOperationalFlags: string[];
    startingIntensity: 1 | 2 | 3 | 4 | 5;
    maximumIntensity: 1 | 2 | 3 | 4 | 5;
    intensityProgressionUnit: "ROUNDS" | "CARDS";
    intensityProgressionInterval: number;
    intensityProgressionIncrement: number;
    randomQuestionRatio: number;
    maximumTypeStreak: number;
    letsTalkMetaInterval: number;
};
export type RoomGameSettings = {
    mode: string;
    profileId: string;
    groupId: string | null;
    adultContentConfirmed: boolean;
    cardLocale: string;
    neverHaveIEverRevealMode: NeverHaveIEverRevealMode;
    configuration: EffectiveGameSettings;
};
export type PublicGameSettings = Pick<
    RoomGameSettings,
    "mode" | "profileId" | "cardLocale" | "neverHaveIEverRevealMode" | "configuration"
>;
export type VersionedRoomGameSettings = RoomGameSettings & {
    revision: number;
    updatedByParticipantId: string | null;
};
export type GameProfileSummary = {
    id: string;
    name: string;
    description: string;
    editorialStatus: "PUBLISHED";
    requiresAdultConfirmation: boolean;
    startingIntensity: number;
    maximumIntensity: number;
    intensityProgressionUnit: "ROUNDS" | "CARDS";
    intensityProgressionInterval: number;
    intensityProgressionIncrement: number;
    enabledQuestionCategoryIds: string[];
    enabledDareTypeIds: string[];
    blockedOperationalFlags: string[];
    randomQuestionRatio: number;
    maximumTypeStreak: number;
    letsTalkMetaInterval: number;
    immutable: boolean;
};
export type GroupSummary = {
    id: string;
    name: string;
    members: string[];
    preferredProfileId: string | null;
    historyResetAt?: string | null;
};
export type GameSettings = {
    preferredProfileId: string;
    startingIntensity: number;
    maximumIntensity: number;
    intensityProgressionUnit: "ROUNDS" | "CARDS";
    intensityProgressionInterval: number;
    intensityProgressionIncrement: number;
    randomQuestionRatio: number;
    letsTalkMetaInterval: number;
    defaultGroupId: string | null;
};
export type CardLocaleSummary = { id: string; nativeName: string; coverage: number };
export type Join = {
    roomId: string;
    roomCode: string;
    participantId: string;
    participantCredential: string;
    role: Role;
};
type ErrorResponse = { error?: { message?: string } };

async function json<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(path, {
        headers: { "accept-language": locale, "content-type": "application/json" },
        ...init,
    });
    const body: unknown = await response.json();
    if (!response.ok) {
        const error = body as ErrorResponse;
        throw new Error(error.error?.message ?? messages.common.requestFailed);
    }
    return body as T;
}
export const rooms = {
    create: (
        displayName: string,
        persistence: "EPHEMERAL" | "DATASPACE",
        settings: RoomGameSettings,
    ) =>
        json<Join>("/api/v1/rooms", {
            method: "POST",
            body: JSON.stringify({ displayName, persistence, settings }),
        }),
    join: (roomCode: string, displayName: string, role: Exclude<Role, "HOST">) =>
        json<Join>(`/api/v1/rooms/${roomCode}/participants`, {
            method: "POST",
            body: JSON.stringify({ displayName, role }),
        }),
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
export async function loadHostConfiguration(): Promise<{
    groups: GroupSummary[];
    settings: GameSettings;
}> {
    const [groupResult, settingsResult] = await Promise.all([
        json<{ groups: GroupSummary[] }>("/api/v1/groups", { method: "GET" }),
        json<{ settings: GameSettings }>("/api/v1/game-settings", { method: "GET" }),
    ]);
    return { groups: groupResult.groups, settings: settingsResult.settings };
}
export async function saveGameSettings(settings: GameSettings): Promise<void> {
    await json<{ settings: GameSettings }>("/api/v1/game-settings", {
        method: "PUT",
        body: JSON.stringify(settings),
    });
}
export async function createGroup(
    name: string,
    members: string[],
    preferredProfileId: string,
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
        }),
    });
}
export async function resetGroupHistory(groupId: string): Promise<GroupSummary> {
    return json<GroupSummary>(`/api/v1/groups/${groupId}/history-reset`, {
        method: "POST",
        body: JSON.stringify({ confirmed: true }),
    });
}
export async function loadServerInfo(): Promise<{ authenticationAvailable: boolean }> {
    return json<{ authenticationAvailable: boolean }>("/api/v1/server-info", { method: "GET" });
}

type ServerEnvelope = {
    type: "room.snapshot" | "room.presence" | "error" | string;
    payload: unknown;
};

export type ReconnectPhase =
    "CONNECTED" | "CONNECTING" | "WAITING" | "OFFLINE" | "STOPPED" | "EXHAUSTED";

const MAX_RECONNECT_ATTEMPTS = 5;
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
        const scheme = location.protocol === "https:" ? "wss" : "ws";
        const socket = new WebSocket(`${scheme}://${location.host}/ws?locale=${locale}`);
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
                supportedProtocolVersions: [2],
                applicationVersion: "0.2.3",
                role: this.joined.role,
                capabilities: [],
                roomCode: this.joined.roomCode,
                participantCredential: this.joined.participantCredential,
            });
        };
        socket.onmessage = (event) => {
            if (this.socket !== socket || this.disposed) return;
            this.lastServerActivity = Date.now();
            const message = JSON.parse(event.data) as ServerEnvelope;
            if (message.type === "server.pong") return;
            if (message.type === "room.snapshot") {
                const next = message.payload as RoomSnapshot;
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
                this.presence = (message.payload as { connected: Presence[] }).connected;
            }
            if (message.type === "room.roleChanged") {
                this.role = (message.payload as { role: Role }).role;
            }
            if (message.type === "room.participantLeft") {
                const payload = message.payload as {
                    displayName: string;
                    reason: "LEFT" | "DISCONNECT_EXPIRED";
                };
                this.roomNotice =
                    payload.reason === "DISCONNECT_EXPIRED"
                        ? messages.room.participantRemoved(payload.displayName)
                        : messages.room.participantLeft(payload.displayName);
                this.roomNoticeId++;
            }
            if (message.type === "session.cardReplaced") {
                const payload = message.payload as { reason: "SKIPPED" | "VETOED" };
                this.pendingCardReplacement = payload.reason;
                this.roomNotice =
                    payload.reason === "SKIPPED"
                        ? messages.room.cardSkipped
                        : messages.room.cardVetoed;
                this.roomNoticeId++;
            }
            if (message.type === "server.hello") {
                const payload = message.payload as { participantId: string; role: Role };
                this.authenticated = payload.participantId === this.joined.participantId;
                this.role = payload.role;
                if (this.authenticated) this.markConnected();
            }
            if (message.type === "error") {
                const payload = message.payload as { code: string; message: string };
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
        const delaySeconds = nextAttempt;
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
            this.markReconnecting();
            this.scheduleReconnect();
        }
    };
    private browserOnline = (): void => {
        if (this.authenticated || this.leaving || this.disposed) return;
        if (["STOPPED", "EXHAUSTED"].includes(this.reconnectPhase)) return;
        this.clearRetryTimers();
        this.connect();
    };
    send(type: string, revision: number | null, payload: object = {}): void {
        if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(
                JSON.stringify({
                    protocol: 2,
                    type,
                    requestId: crypto.randomUUID(),
                    revision,
                    payload,
                }),
            );
        }
    }
    command(type: string, payload: object = {}): void {
        if (type === "command.leaveRoom") this.leaving = true;
        this.send(type, this.snapshot?.session?.revision ?? null, payload);
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
