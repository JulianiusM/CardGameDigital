import { MESSAGE_KEYS } from "../packages/localization/keys";
import type http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
    clientHelloEnvelopeSchema,
    envelopeSchema,
    PROTOCOL_VERSION,
    roomCommandEnvelopeSchema,
    snapshotRequestEnvelopeSchema,
} from "../packages/protocol";
import type { RoomParticipant } from "../packages/application/realtimeRooms";
import type { RoomCommand, RoomService } from "../packages/application/roomService";
import settings from "./settings";
import { isTrustedOrigin } from "./requestSecurity";
import { detectLocale, translate, translateError } from "../packages/localization/messages";

type Context = { socket: WebSocket; participant: RoomParticipant; roomCode: string };
export function attachWebSocketServer(
    server: http.Server,
    service: RoomService,
    options: { hostDisconnectGraceMs?: number } = {},
): WebSocketServer {
    const sockets = new Set<Context>();
    const hostFallbackTimers = new Map<string, NodeJS.Timeout>();
    const orphanedRooms = new Map<string, string>();
    const hostDisconnectGraceMs = options.hostDisconnectGraceMs ?? 15_000;
    const wss = new WebSocketServer({ server, path: "/ws" });

    async function refreshRoom(roomId: string, requestId: string | null = null): Promise<void> {
        const participants = (await service.snapshot(roomId)).participants;
        const byId = new Map(participants.map((participant) => [participant.id, participant]));
        for (const peer of sockets) {
            if (peer.participant.roomId !== roomId) continue;
            const refreshed = byId.get(peer.participant.id);
            if (!refreshed) continue;
            if (refreshed.role !== peer.participant.role) {
                peer.participant = refreshed;
                send(peer.socket, "room.roleChanged", null, null, { role: refreshed.role });
            } else peer.participant = refreshed;
            if (peer.socket.readyState === WebSocket.OPEN) {
                const snapshot = await service.snapshot(roomId, peer.participant);
                send(
                    peer.socket,
                    "room.snapshot",
                    requestId,
                    snapshot.session?.revision ?? null,
                    snapshot,
                );
            }
        }
        broadcastPresence(sockets, roomId);
    }
    wss.on("connection", (socket, request) => {
        const requestedLocale = new URL(request.url ?? "/ws", "http://localhost").searchParams.get(
            "locale",
        );
        const locale = detectLocale(requestedLocale ?? request.headers["accept-language"]);
        if (settings.value.deploymentMode === "public") {
            const origin = request.headers.origin;
            if (!isTrustedOrigin(origin, settings.value.publicUrl)) {
                socket.close(4403, translate(locale, MESSAGE_KEYS.REALTIME_ORIGIN_NOT_ALLOWED));
                return;
            }
        }
        let context: Context | undefined;
        let commandWindowStarted = Date.now();
        let commandsInWindow = 0;
        const deadline = setTimeout(
            () => socket.close(4401, translate(locale, MESSAGE_KEYS.REALTIME_HANDSHAKE_REQUIRED)),
            5_000,
        );
        socket.on("message", async (raw) => {
            let requestId: string | null = null;
            try {
                const value: unknown = JSON.parse(raw.toString());
                if (Date.now() - commandWindowStarted > 10_000) {
                    commandWindowStarted = Date.now();
                    commandsInWindow = 0;
                }
                if (++commandsInWindow > 30) {
                    throw coded("NOT_AUTHORIZED", MESSAGE_KEYS.REALTIME_RATE_EXCEEDED);
                }
                const base = envelopeSchema.parse(value);
                requestId = base.requestId;
                if (!context) {
                    const hello = clientHelloEnvelopeSchema.parse(value);
                    if (!hello.payload.supportedProtocolVersions.includes(PROTOCOL_VERSION))
                        throw coded(
                            "PROTOCOL_VERSION_UNSUPPORTED",
                            MESSAGE_KEYS.REALTIME_PROTOCOL_UNSUPPORTED,
                        );
                    const participant = await service.authenticate(
                        hello.payload.roomCode,
                        hello.payload.participantCredential,
                    );
                    if (!participant)
                        throw coded("ROOM_NOT_FOUND", MESSAGE_KEYS.REALTIME_CREDENTIAL_NOT_FOUND);
                    const pendingFallback = hostFallbackTimers.get(participant.id);
                    if (pendingFallback) {
                        clearTimeout(pendingFallback);
                        hostFallbackTimers.delete(participant.id);
                    }
                    context = { socket, participant, roomCode: hello.payload.roomCode };
                    sockets.add(context);
                    const orphanedHostId = orphanedRooms.get(participant.roomId);
                    if (orphanedHostId && participant.role === "PLAYER") {
                        const connected = new Set(
                            [...sockets]
                                .filter((peer) => peer.participant.roomId === participant.roomId)
                                .map((peer) => peer.participant.id),
                        );
                        if (
                            await service.reassignDisconnectedHost(
                                participant.roomId,
                                orphanedHostId,
                                connected,
                            )
                        ) {
                            orphanedRooms.delete(participant.roomId);
                            const refreshed = (
                                await service.snapshot(participant.roomId)
                            ).participants.find(({ id }) => id === participant.id);
                            if (refreshed) context.participant = refreshed;
                        }
                    } else if (orphanedHostId === participant.id) {
                        orphanedRooms.delete(participant.roomId);
                    }
                    clearTimeout(deadline);
                    send(socket, "server.hello", requestId, null, {
                        protocolVersion: PROTOCOL_VERSION,
                        participantId: context.participant.id,
                        role: context.participant.role,
                    });
                    const snapshot = await service.snapshot(
                        context.participant.roomId,
                        context.participant,
                    );
                    send(
                        socket,
                        "room.snapshot",
                        requestId,
                        snapshot.session?.revision ?? null,
                        snapshot,
                    );
                    broadcastPresence(sockets, context.participant.roomId);
                    return;
                }
                if (snapshotRequestEnvelopeSchema.safeParse(value).success) {
                    const snapshot = await service.snapshot(
                        context.participant.roomId,
                        context.participant,
                    );
                    send(
                        socket,
                        "room.snapshot",
                        requestId,
                        snapshot.session?.revision ?? null,
                        snapshot,
                    );
                    return;
                }
                const command = roomCommandEnvelopeSchema.parse(value) as RoomCommand;
                // RoomService returns only after the transition has committed. Each
                // recipient then receives its own capability/private-state projection.
                await service.execute(context.participant.roomId, context.participant, command);
                await refreshRoom(context.participant.roomId, requestId);
            } catch (error) {
                const details = error as { code?: string; message?: string };
                send(socket, "error", requestId, null, {
                    code: details.code ?? "VALIDATION_ERROR",
                    message: translateError(
                        locale,
                        details.message ?? MESSAGE_KEYS.REALTIME_INVALID_MESSAGE,
                    ),
                });
            }
        });
        socket.on("close", () => {
            clearTimeout(deadline);
            if (context) {
                const roomId = context.participant.roomId;
                const participantId = context.participant.id;
                const wasHost = context.participant.role === "HOST";
                sockets.delete(context);
                broadcastPresence(sockets, roomId);
                if (wasHost) {
                    const timer = setTimeout(async () => {
                        try {
                            hostFallbackTimers.delete(participantId);
                            const connected = new Set(
                                [...sockets]
                                    .filter((peer) => peer.participant.roomId === roomId)
                                    .map((peer) => peer.participant.id),
                            );
                            const reassigned = await service.reassignDisconnectedHost(
                                roomId,
                                participantId,
                                connected,
                            );
                            if (reassigned) await refreshRoom(roomId);
                            else orphanedRooms.set(roomId, participantId);
                        } catch {
                            // Server shutdown or Room expiry can race the grace timer.
                        }
                    }, hostDisconnectGraceMs);
                    timer.unref();
                    hostFallbackTimers.set(participantId, timer);
                }
            }
        });
    });
    wss.on("close", () => {
        for (const timer of hostFallbackTimers.values()) clearTimeout(timer);
        hostFallbackTimers.clear();
        orphanedRooms.clear();
    });
    return wss;
}
function send(
    socket: WebSocket,
    type: string,
    requestId: string | null,
    revision: number | null,
    payload: unknown,
): void {
    socket.send(JSON.stringify({ protocol: PROTOCOL_VERSION, type, requestId, revision, payload }));
}
function coded(code: string, message: string): Error {
    return Object.assign(new Error(message), { code });
}
function broadcastPresence(sockets: Set<Context>, roomId: string): void {
    const connected = [...sockets]
        .filter((entry) => entry.participant.roomId === roomId)
        .map((entry) => ({
            participantId: entry.participant.id,
            displayName: entry.participant.displayName,
            role: entry.participant.role,
        }));
    for (const peer of sockets)
        if (peer.participant.roomId === roomId && peer.socket.readyState === WebSocket.OPEN)
            send(peer.socket, "room.presence", null, null, { connected });
}
