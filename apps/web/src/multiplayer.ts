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
    maximumIntensity: 1 | 2 | 3 | 4 | 5;
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
    maximumIntensity: number;
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
    maximumIntensity: number;
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

export class RoomSocket {
    socket!: WebSocket;
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
    role: Role;
    private retry: number | undefined;
    private leaving = false;
    private pendingCardReplacement: "SKIPPED" | "VETOED" | null = null;
    constructor(
        private joined: Join,
        private changed: () => void,
        private left: (reason: "LEFT" | "ROOM_CLOSED") => void = () => undefined,
    ) {
        this.role = joined.role;
        this.connect();
    }
    /** Opens a socket and re-authenticates with the participant credential. */
    private connect(): void {
        const scheme = location.protocol === "https:" ? "wss" : "ws";
        this.socket = new WebSocket(`${scheme}://${location.host}/ws?locale=${locale}`);
        this.socket.onopen = () => {
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
        this.socket.onmessage = (event) => {
            const message = JSON.parse(event.data) as ServerEnvelope;
            if (message.type === "room.snapshot") {
                const next = message.payload as RoomSnapshot;
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
            }
            if (message.type === "error") {
                const payload = message.payload as { code: string; message: string };
                this.errorCode = payload.code;
                this.error = payload.message;
                if (
                    !this.authenticated &&
                    ["ROOM_NOT_FOUND", "NOT_AUTHORIZED"].includes(payload.code)
                ) {
                    this.leaving = true;
                    this.socket.close();
                }
            }
            this.changed();
        };
        this.socket.onclose = (event) => {
            if (event.code === 4001) {
                this.left("ROOM_CLOSED");
                return;
            }
            if (this.leaving) {
                this.left("LEFT");
                return;
            }
            this.error = messages.common.reconnecting;
            this.changed();
            this.retry = window.setTimeout(() => this.connect(), 1000);
        };
    }
    send(type: string, revision: number | null, payload: object = {}): void {
        if (this.socket.readyState === WebSocket.OPEN) {
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
    dispose(): void {
        if (this.retry) window.clearTimeout(this.retry);
        this.leaving = true;
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
