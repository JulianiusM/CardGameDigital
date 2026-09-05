import { MESSAGE_KEYS } from "../../../../packages/localization/keys";
import type http from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { ZodError } from "zod";
import {
    MAX_WEBSOCKET_MESSAGE_BYTES,
    clientPingEnvelopeSchema,
    clientHelloEnvelopeSchema,
    envelopeSchema,
    PROTOCOL_VERSION,
    roomCommandEnvelopeSchema,
    snapshotRequestEnvelopeSchema,
    type CardReplacedEventPayload,
    type ParticipantLeftEventPayload,
} from "../../../../packages/protocol";
import type {
    RoomParticipant,
    RoomRoleChange,
    RoomRoleChangeReason,
} from "../../../../packages/application/realtimeRooms";
import type { RoomCommand, RoomService } from "../../../../packages/application/roomService";
import settings, { isPublicRuntimeSecurityEnforced } from "./settings";
import { isTrustedOrigin } from "./requestSecurity";
import {
    detectLocale,
    translate,
    translateError,
} from "../../../../packages/localization/messages";
import { FixedWindowRateLimiter } from "./fixedWindowRateLimiter";
import { configuredErrorLogFields, logEvent } from "./structuredLogger";

type Context = {
    socket: WebSocket;
    participant: RoomParticipant;
    roomCode: string;
    intentionalLeave?: boolean;
};
const expectedRealtimeErrorCodes = new Set([
    "VALIDATION_ERROR",
    "PROTOCOL_VERSION_UNSUPPORTED",
    "NOT_AUTHORIZED",
    "NOT_ACTIVE_PLAYER",
    "ROOM_NOT_FOUND",
    "ROOM_FULL",
    "INVALID_GAME_STATE",
    "STALE_SESSION_REVISION",
    "CARD_LOCALE_UNAVAILABLE",
    "CARD_POOL_EXHAUSTED",
]);
export function attachWebSocketServer(
    server: http.Server,
    service: RoomService,
    options: {
        hostDisconnectGraceMs?: number;
        heartbeatIntervalMs?: number;
        participantCommandRateLimit?: { windowMs: number; limit: number };
        devicePairingRateLimit?: { windowMs: number; limit: number };
        maxPayloadBytes?: number;
        reconciliationIntervalMs?: number;
    } = {},
): WebSocketServer & { roomLifecycleReady: Promise<void> } {
    const sockets = new Set<Context>();
    const disconnectTimers = new Map<string, NodeJS.Timeout>();
    const hostDisconnectGraceMs = options.hostDisconnectGraceMs ?? 180_000;
    const reconciliationIntervalMs = options.reconciliationIntervalMs ?? 1_000;
    const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5_000;
    const maxPayloadBytes = options.maxPayloadBytes ?? MAX_WEBSOCKET_MESSAGE_BYTES;
    const participantCommandRateLimit = options.participantCommandRateLimit ?? {
        windowMs: 60_000,
        limit: 120,
    };
    const devicePairingRateLimit = options.devicePairingRateLimit ?? {
        windowMs: 15 * 60_000,
        limit: 10,
    };
    const participantCommands = new FixedWindowRateLimiter(
        participantCommandRateLimit.windowMs,
        participantCommandRateLimit.limit,
    );
    const devicePairings = new FixedWindowRateLimiter(
        devicePairingRateLimit.windowMs,
        devicePairingRateLimit.limit,
    );
    const lifecycleReady = service.initializeConnectionLifecycle(hostDisconnectGraceMs);
    const wss = new WebSocketServer({
        server,
        path: settings.value.webSocketPath,
        maxPayload: maxPayloadBytes,
        perMessageDeflate: false,
    });
    const responsiveSockets = new WeakSet<WebSocket>();
    const heartbeat = setInterval(() => {
        for (const socket of wss.clients) {
            if (!responsiveSockets.has(socket)) {
                socket.terminate();
                continue;
            }
            responsiveSockets.delete(socket);
            socket.ping();
        }
    }, heartbeatIntervalMs);
    heartbeat.unref();

    function scheduleDisconnectExpiry(participant: RoomParticipant): void {
        const existing = disconnectTimers.get(participant.id);
        if (existing) clearTimeout(existing);
        const delay = Math.max(
            0,
            (participant.reconnectDeadline ?? Date.now() + hostDisconnectGraceMs) - Date.now(),
        );
        const timer = setTimeout(async () => {
            try {
                disconnectTimers.delete(participant.id);
                const result = await service.expireDisconnectedParticipant(
                    participant.roomId,
                    participant.id,
                );
                for (const expired of result.expiredParticipants) {
                    broadcastRoomEvent(sockets, participant.roomId, "room.participantLeft", {
                        participantId: expired.id,
                        displayName: expired.displayName,
                        reason: "DISCONNECT_EXPIRED",
                    });
                }
                if (result.roomClosed) closeConnectedRoom(participant.roomId);
                else {
                    await refreshRoom(participant.roomId, null, result.roleChanges);
                    if (
                        result.participant?.connectionStatus === "TEMPORARILY_DISCONNECTED" &&
                        result.participant.reconnectDeadline !== null
                    ) {
                        scheduleDisconnectExpiry(result.participant);
                    }
                }
            } catch (error) {
                logEvent(
                    "error",
                    "realtime.disconnect_expiry_failed",
                    configuredErrorLogFields(error, settings.value),
                    settings.value.logLevel,
                );
            }
        }, delay);
        timer.unref();
        disconnectTimers.set(participant.id, timer);
    }

    const roomLifecycleReady = lifecycleReady
        .then((participants) => {
            for (const participant of participants) scheduleDisconnectExpiry(participant);
        })
        .catch((error) => {
            logEvent(
                "error",
                "realtime.lifecycle_initialization_failed",
                configuredErrorLogFields(error, settings.value),
                settings.value.logLevel,
            );
            throw error;
        });
    Object.defineProperty(wss, "roomLifecycleReady", {
        value: roomLifecycleReady,
        enumerable: false,
    });

    let reconciliationRunning = false;
    const reconciliation = setInterval(() => {
        if (reconciliationRunning) return;
        reconciliationRunning = true;
        void service
            .reconcileDueRooms()
            .then(async (rooms) => {
                for (const { roomId, result } of rooms) {
                    for (const expired of result.expiredParticipants) {
                        broadcastRoomEvent(sockets, roomId, "room.participantLeft", {
                            participantId: expired.id,
                            displayName: expired.displayName,
                            reason: "DISCONNECT_EXPIRED",
                        });
                    }
                    if (result.roomClosed) closeConnectedRoom(roomId);
                    else await refreshRoom(roomId, null, result.roleChanges);
                }
            })
            .catch((error) => {
                logEvent(
                    "error",
                    "realtime.lifecycle_reconciliation_failed",
                    configuredErrorLogFields(error, settings.value),
                    settings.value.logLevel,
                );
            })
            .finally(() => {
                reconciliationRunning = false;
            });
    }, reconciliationIntervalMs);
    reconciliation.unref();

    async function refreshRoom(
        roomId: string,
        requestId: string | null = null,
        roleChanges: readonly RoomRoleChange[] = [],
        roleNoticeAlreadySent: ReadonlySet<string> = new Set(),
    ): Promise<void> {
        const participants = (await service.snapshot(roomId)).participants;
        const byId = new Map(participants.map((participant) => [participant.id, participant]));
        for (const peer of sockets) {
            if (peer.participant.roomId !== roomId) continue;
            const refreshed = byId.get(peer.participant.id);
            if (!refreshed) continue;
            const previousRole = peer.participant.role;
            peer.participant = { ...peer.participant, ...refreshed };
            const roleChange = roleChanges.find(
                ({ participantId }) => participantId === peer.participant.id,
            );
            if (
                refreshed.role !== previousRole &&
                !roleNoticeAlreadySent.has(peer.participant.id)
            ) {
                send(peer.socket, "room.roleChanged", null, null, {
                    role: refreshed.role,
                    previousRole,
                    reason: roleChange?.reason ?? "HOST_TRANSFERRED",
                });
            }
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
    function closeConnectedRoom(roomId: string): void {
        for (const peer of [...sockets]) {
            if (peer.participant.roomId !== roomId) continue;
            const timer = disconnectTimers.get(peer.participant.id);
            if (timer) clearTimeout(timer);
            disconnectTimers.delete(peer.participant.id);
            peer.intentionalLeave = true;
            sockets.delete(peer);
            peer.socket.close(4001, "room closed");
        }
    }
    wss.on("connection", (socket, request) => {
        responsiveSockets.add(socket);
        socket.on("pong", () => responsiveSockets.add(socket));
        const requestedLocale = new URL(request.url ?? "/ws", "http://localhost").searchParams.get(
            "locale",
        );
        const locale = detectLocale(requestedLocale ?? request.headers["accept-language"]);
        if (isPublicRuntimeSecurityEnforced(settings.value)) {
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
        const processMessage = async (raw: RawData, isBinary: boolean): Promise<void> => {
            let requestId: string | null = null;
            try {
                await lifecycleReady;
                if (isBinary) {
                    throw coded("VALIDATION_ERROR", MESSAGE_KEYS.REALTIME_INVALID_MESSAGE);
                }
                const value: unknown = JSON.parse(raw.toString());
                const receivedProtocol =
                    typeof value === "object" && value !== null && "protocol" in value
                        ? (value as { protocol?: unknown }).protocol
                        : undefined;
                if (typeof receivedProtocol === "number" && receivedProtocol !== PROTOCOL_VERSION)
                    throw coded(
                        "PROTOCOL_VERSION_UNSUPPORTED",
                        MESSAGE_KEYS.REALTIME_PROTOCOL_UNSUPPORTED,
                    );
                const base = envelopeSchema.parse(value);
                requestId = base.requestId;
                if (!context) {
                    const hello = clientHelloEnvelopeSchema.parse(value);
                    if (!hello.payload.supportedProtocolVersions.includes(PROTOCOL_VERSION))
                        throw coded(
                            "PROTOCOL_VERSION_UNSUPPORTED",
                            MESSAGE_KEYS.REALTIME_PROTOCOL_UNSUPPORTED,
                        );
                    const activation = await service.authenticate(
                        hello.payload.roomCode,
                        hello.payload.participantCredential,
                    );
                    if (!activation)
                        throw coded("ROOM_NOT_FOUND", MESSAGE_KEYS.REALTIME_CREDENTIAL_NOT_FOUND);
                    const participant = activation;
                    const pendingFallback = disconnectTimers.get(participant.id);
                    if (pendingFallback) {
                        clearTimeout(pendingFallback);
                        disconnectTimers.delete(participant.id);
                    }
                    for (const existing of [...sockets]) {
                        if (existing.participant.id !== participant.id) continue;
                        existing.intentionalLeave = true;
                        sockets.delete(existing);
                        existing.socket.close(4002, "connection replaced");
                    }
                    context = { socket, participant, roomCode: hello.payload.roomCode };
                    sockets.add(context);
                    clearTimeout(deadline);
                    send(socket, "server.hello", requestId, null, {
                        protocolVersion: PROTOCOL_VERSION,
                        participantId: participant.id,
                        role: participant.role,
                    });
                    const ownRoleChange = activation.roleChanges.find(
                        ({ participantId }) => participantId === participant.id,
                    );
                    const noticesSent = new Set<string>();
                    if (ownRoleChange) {
                        send(socket, "room.roleChanged", null, null, {
                            role: ownRoleChange.role,
                            previousRole: ownRoleChange.previousRole,
                            reason: ownRoleChange.reason,
                        });
                        noticesSent.add(participant.id);
                    }
                    await refreshRoom(
                        participant.roomId,
                        requestId,
                        activation.roleChanges,
                        noticesSent,
                    );
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
                if (clientPingEnvelopeSchema.safeParse(value).success) {
                    send(socket, "server.pong", requestId, null, { serverTime: Date.now() });
                    return;
                }
                const command = roomCommandEnvelopeSchema.parse(value) as RoomCommand;
                if (
                    isPublicRuntimeSecurityEnforced(settings.value) &&
                    !participantCommands.consume(context.participant.id)
                ) {
                    throw coded("NOT_AUTHORIZED", MESSAGE_KEYS.REALTIME_RATE_EXCEEDED);
                }
                if (
                    isPublicRuntimeSecurityEnforced(settings.value) &&
                    command.type === "command.setDevicePlayers" &&
                    !devicePairings.consume(context.participant.id)
                ) {
                    throw coded("NOT_AUTHORIZED", MESSAGE_KEYS.REALTIME_RATE_EXCEEDED);
                }
                // RoomService returns only after the transition has committed. Each
                // recipient then receives its own capability/private-state projection.
                const roomId = context.participant.roomId;
                const leaving = command.type === "command.leaveRoom";
                const closing = command.type === "command.closeRoom";
                const priorRoles = new Map(
                    [...sockets]
                        .filter((peer) => peer.participant.roomId === roomId)
                        .map((peer) => [peer.participant.id, peer.participant.role]),
                );
                const commandSnapshot = await service.execute(roomId, context.participant, command);
                if (closing) {
                    closeConnectedRoom(roomId);
                    return;
                }
                if (leaving) {
                    for (const peer of [...sockets]) {
                        if (peer.participant.id !== context.participant.id) continue;
                        peer.intentionalLeave = true;
                        sockets.delete(peer);
                        peer.socket.close(1000, "left room");
                    }
                    broadcastRoomEvent(sockets, roomId, "room.participantLeft", {
                        participantId: context.participant.id,
                        displayName: context.participant.displayName,
                        reason: "LEFT",
                    });
                    if (commandSnapshot.participants.length === 0) {
                        closeConnectedRoom(roomId);
                        return;
                    }
                }
                if (command.type === "command.skipCard" || command.type === "command.vetoCard") {
                    broadcastRoomEvent(sockets, roomId, "session.cardReplaced", {
                        reason: command.type === "command.skipCard" ? "SKIPPED" : "VETOED",
                    });
                }
                let roleReason: RoomRoleChangeReason | null = null;
                if (command.type === "command.transferHost") roleReason = "HOST_TRANSFERRED";
                else if (leaving && context.participant.role === "HOST") roleReason = "HOST_LEFT";
                const roleChanges = roleReason
                    ? roleChangesFromSnapshot(priorRoles, commandSnapshot.participants, roleReason)
                    : [];
                await refreshRoom(roomId, requestId, roleChanges);
            } catch (error) {
                const details = error as { code?: string; message?: string };
                const expectedCode = details.code
                    ? expectedRealtimeErrorCodes.has(details.code)
                    : false;
                if (
                    !expectedCode &&
                    !(error instanceof ZodError) &&
                    !(error instanceof SyntaxError)
                ) {
                    logEvent(
                        "error",
                        "realtime.unhandled_error",
                        { requestId, ...configuredErrorLogFields(error, settings.value) },
                        settings.value.logLevel,
                    );
                }
                send(socket, "error", requestId, null, {
                    code: details.code ?? "VALIDATION_ERROR",
                    message: translateError(
                        locale,
                        details.message ?? MESSAGE_KEYS.REALTIME_INVALID_MESSAGE,
                    ),
                });
            }
        };
        let messageQueue = Promise.resolve();
        socket.on("message", (raw, isBinary) => {
            if (Date.now() - commandWindowStarted > 10_000) {
                commandWindowStarted = Date.now();
                commandsInWindow = 0;
            }
            commandsInWindow += 1;
            if (isPublicRuntimeSecurityEnforced(settings.value) && commandsInWindow > 30) {
                send(socket, "error", null, null, {
                    code: "NOT_AUTHORIZED",
                    message: translate(locale, MESSAGE_KEYS.REALTIME_RATE_EXCEEDED),
                });
                return;
            }
            messageQueue = messageQueue
                .then(() => processMessage(raw, isBinary))
                .catch(() => socket.terminate());
        });
        socket.on("close", async () => {
            clearTimeout(deadline);
            if (context && !context.intentionalLeave) {
                const roomId = context.participant.roomId;
                const participantId = context.participant.id;
                sockets.delete(context);
                if ([...sockets].some((peer) => peer.participant.id === participantId)) return;
                try {
                    const result = await service.markTemporarilyDisconnected(
                        context.participant,
                        hostDisconnectGraceMs,
                    );
                    if (result.roomClosed) {
                        closeConnectedRoom(roomId);
                        return;
                    }
                    await refreshRoom(roomId, null, result.roleChanges);
                    if (result.participant?.id === participantId) {
                        scheduleDisconnectExpiry(result.participant);
                    }
                } catch (error) {
                    logEvent(
                        "error",
                        "realtime.disconnect_transition_failed",
                        configuredErrorLogFields(error, settings.value),
                        settings.value.logLevel,
                    );
                }
            }
        });
    });
    wss.on("close", () => {
        clearInterval(heartbeat);
        clearInterval(reconciliation);
        for (const timer of disconnectTimers.values()) clearTimeout(timer);
        disconnectTimers.clear();
        participantCommands.clear();
        devicePairings.clear();
    });
    return wss as WebSocketServer & { roomLifecycleReady: Promise<void> };
}

function roleChangesFromSnapshot(
    previousRoles: ReadonlyMap<string, RoomParticipant["role"]>,
    participants: readonly Pick<RoomParticipant, "id" | "role">[],
    reason: RoomRoleChangeReason,
): RoomRoleChange[] {
    const changes: RoomRoleChange[] = [];
    for (const participant of participants) {
        const previousRole = previousRoles.get(participant.id);
        if (!previousRole || previousRole === participant.role) continue;
        changes.push({
            participantId: participant.id,
            previousRole,
            role: participant.role,
            reason,
        });
    }
    return changes;
}

function send(
    socket: WebSocket,
    type: string,
    requestId: string | null,
    revision: number | null,
    payload: unknown,
): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ protocol: PROTOCOL_VERSION, type, requestId, revision, payload }));
}
function coded(code: string, message: string): Error {
    return Object.assign(new Error(message), { code });
}
function broadcastPresence(sockets: Set<Context>, roomId: string): void {
    const connectedByParticipant = new Map<string, Context>();
    for (const entry of sockets)
        if (entry.participant.roomId === roomId)
            connectedByParticipant.set(entry.participant.id, entry);
    const connected = [...connectedByParticipant.values()].map((entry) => ({
        participantId: entry.participant.id,
        displayName: entry.participant.displayName,
        role: entry.participant.role,
    }));
    for (const peer of sockets)
        if (peer.participant.roomId === roomId && peer.socket.readyState === WebSocket.OPEN)
            send(peer.socket, "room.presence", null, null, { connected });
}

type RoomEventPayloads = {
    "room.participantLeft": ParticipantLeftEventPayload;
    "session.cardReplaced": CardReplacedEventPayload;
};

function broadcastRoomEvent<Type extends keyof RoomEventPayloads>(
    sockets: Set<Context>,
    roomId: string,
    type: Type,
    payload: RoomEventPayloads[Type],
): void {
    for (const peer of sockets)
        if (peer.participant.roomId === roomId && peer.socket.readyState === WebSocket.OPEN)
            send(peer.socket, type, null, null, payload);
}
