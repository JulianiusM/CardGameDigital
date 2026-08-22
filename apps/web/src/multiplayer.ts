export type Role = "HOST" | "PLAYER" | "DISPLAY";
export type Participant = {
    id: string;
    roomId: string;
    role: Role;
    displayName: string;
    devicePlayers: { id: string; name: string }[];
};
export type Presence = Pick<Participant, "displayName" | "role"> & { participantId: string };
export type SessionView = {
    id: string;
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
    hasVoted: boolean;
    viewer: { participantId: string; role: Role; displayName: string };
    availableActions: string[];
    controllablePlayers: { id: string; name: string; hasVoted: boolean }[];
};
export type RoomSnapshot = {
    roomId: string;
    participants: Participant[];
    boundaryConfigured: boolean;
    session: SessionView | null;
};
export type GameProfileSummary = {
    id: string;
    name: string;
    description: string;
    editorialStatus: "PUBLISHED";
    requiresAdultConfirmation: boolean;
    maximumIntensity: number;
};
export type GroupSummary = { id: string; name: string; members: string[] };
export type GameSettings = {
    preferredProfileId: string;
    maximumIntensity: number;
    randomQuestionRatio: number;
    letsTalkMetaInterval: number;
    defaultGroupId: string | null;
};
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
    create: (displayName: string, persistence: "EPHEMERAL" | "DATASPACE") =>
        json<Join>("/api/v1/rooms", {
            method: "POST",
            body: JSON.stringify({ displayName, persistence }),
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

type ServerEnvelope = {
    type: "room.snapshot" | "room.presence" | "error" | string;
    payload: unknown;
};

export class RoomSocket {
    socket!: WebSocket;
    snapshot: RoomSnapshot | null = null;
    presence: Presence[] = [];
    error = "";
    role: Role;
    private retry: number | undefined;
    constructor(
        private joined: Join,
        private changed: () => void,
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
            this.send("client.hello", null, {
                supportedProtocolVersions: [1],
                applicationVersion: "0.2.3",
                role: this.joined.role,
                capabilities: [],
                roomCode: this.joined.roomCode,
                participantCredential: this.joined.participantCredential,
            });
        };
        this.socket.onmessage = (event) => {
            const message = JSON.parse(event.data) as ServerEnvelope;
            if (message.type === "room.snapshot") this.snapshot = message.payload as RoomSnapshot;
            if (message.type === "room.presence") {
                this.presence = (message.payload as { connected: Presence[] }).connected;
            }
            if (message.type === "room.roleChanged") {
                this.role = (message.payload as { role: Role }).role;
            }
            if (message.type === "error") {
                this.error = (message.payload as { message: string }).message;
            }
            this.changed();
        };
        this.socket.onclose = () => {
            this.error = messages.common.reconnecting;
            this.changed();
            this.retry = window.setTimeout(() => this.connect(), 1000);
        };
    }
    send(type: string, revision: number | null, payload: object = {}): void {
        if (this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(
                JSON.stringify({
                    protocol: 1,
                    type,
                    requestId: crypto.randomUUID(),
                    revision,
                    payload,
                }),
            );
        }
    }
    command(type: string, payload: object = {}): void {
        this.send(type, this.snapshot?.session?.revision ?? null, payload);
    }
}
export function saveJoin(join: Join) {
    sessionStorage.setItem(`room:${join.roomCode}:${join.role}`, JSON.stringify(join));
}
export function loadJoin(code: string, role: Role): Join | null {
    try {
        return JSON.parse(sessionStorage.getItem(`room:${code}:${role}`) ?? "null");
    } catch {
        return null;
    }
}
import { locale, messages } from "./i18n";
