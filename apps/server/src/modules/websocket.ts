import { setImmediate as yieldToIo } from "node:timers/promises";
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
    type RoomSnapshot,
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
import { roomSnapshotEncoder } from "./roomSnapshotEncoding";
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
    "CATALOG_CAPACITY_EXCEEDED",
    "SESSION_CAPACITY_EXCEEDED",
]);
let pendingOutgoingBytes = 0;
const lastSnapshots = new WeakMap<
    WebSocket,
    { sessionId: string | null; revision: number; settingsRevision: number }
>();
const lastPresence = new WeakMap<WebSocket, string>();

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
    let pendingHandshakes = 0;
    let queuedInputBytes = 0;
    const broadcasts = new Map<string, Promise<void>>();
    const broadcastVersions = new Map<string, object>();
    const votingRefreshes = new Map<
        string,
        { timer?: NodeJS.Timeout; running: boolean; dirty: boolean }
    >();
    function scheduleVotingRefresh(roomId: string) {
        const state = votingRefreshes.get(roomId) ?? { running: false, dirty: false };
        votingRefreshes.set(roomId, state);
        state.dirty = true;
        // A vote/reconnect arriving during fan-out makes that common projection old.
        // Cancel it now, rather than waiting for thousands of obsolete deliveries.
        if (state.running) broadcastVersions.set(roomId, {});
        if (state.running || state.timer) return;
        state.timer = setTimeout(() => {
            state.timer = undefined;
            state.running = true;
            state.dirty = false;
            void refreshRoom(roomId)
                .catch((error) => {
                    logEvent(
                        "error",
                        "realtime.voting_refresh_failed",
                        configuredErrorLogFields(error, settings.value),
                        settings.value.logLevel,
                    );
                })
                .finally(() => {
                    state.running = false;
                    if (votingRefreshes.get(roomId) !== state) return;
                    if (state.dirty) scheduleVotingRefresh(roomId);
                    else votingRefreshes.delete(roomId);
                });
        }, settings.value.webSocketRefreshCoalesceMs);
        state.timer.unref();
    }
    const disconnectTimers = new Map<string, NodeJS.Timeout>();
    const hostDisconnectGraceMs =
        options.hostDisconnectGraceMs ?? settings.value.roomReconnectGraceSeconds * 1000;
    const reconciliationIntervalMs =
        options.reconciliationIntervalMs ?? settings.value.roomReconciliationIntervalMs;
    const heartbeatIntervalMs =
        options.heartbeatIntervalMs ?? settings.value.webSocketHeartbeatIntervalMs;
    const maxPayloadBytes = options.maxPayloadBytes ?? MAX_WEBSOCKET_MESSAGE_BYTES;
    const participantCommandRateLimit = options.participantCommandRateLimit ?? {
        windowMs: settings.value.roomCommandRateWindowMs,
        limit: settings.value.roomCommandRatePerParticipant,
    };
    const devicePairingRateLimit = options.devicePairingRateLimit ?? {
        windowMs: settings.value.devicePairingRateWindowMs,
        limit: settings.value.devicePairingRatePerParticipant,
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

    function refreshRoom(
        roomId: string,
        requestId: string | null = null,
        roleChanges: readonly RoomRoleChange[] = [],
        roleNoticeAlreadySent: ReadonlySet<string> = new Set(),
    ): Promise<void> {
        const version = {};
        broadcastVersions.set(roomId, version);
        const previous = broadcasts.get(roomId) ?? Promise.resolve();
        const result = previous
            .catch(() => undefined)
            .then(() =>
                broadcastSnapshot(roomId, requestId, roleChanges, roleNoticeAlreadySent, version),
            );
        const tracked = result
            .catch(() => undefined)
            .finally(() => {
                if (broadcasts.get(roomId) === tracked) {
                    broadcasts.delete(roomId);
                    broadcastVersions.delete(roomId);
                }
            });
        broadcasts.set(roomId, tracked);
        return result;
    }

    async function broadcastSnapshot(
        roomId: string,
        requestId: string | null = null,
        roleChanges: readonly RoomRoleChange[] = [],
        roleNoticeAlreadySent: ReadonlySet<string> = new Set(),
        version: object,
    ): Promise<void> {
        const superseded = () => requestId === null && broadcastVersions.get(roomId) !== version;
        if (superseded()) return;
        const project = await service.snapshotProjection(roomId);
        const common = project();
        const encode = roomSnapshotEncoder(common, requestId);
        const participants = common.participants;
        const byId = new Map(participants.map((participant) => [participant.id, participant]));
        let batchBytes = 0;
        let batchPeers = 0;
        for (const peer of sockets) {
            if (superseded()) return;
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
                const snapshot = project(peer.participant);
                const encoded = encode(snapshot);
                const bytes = encoded.reduce((sum, fragment) => sum + fragment.byteLength, 0);
                if (
                    batchPeers >= settings.value.webSocketBroadcastBatchPeers ||
                    batchBytes + bytes > settings.value.webSocketBroadcastBatchBytes
                ) {
                    await yieldToIo();
                    if (superseded()) return;
                    batchBytes = 0;
                    batchPeers = 0;
                }
                send(
                    peer.socket,
                    "room.snapshot",
                    requestId,
                    snapshot.session?.revision ?? null,
                    snapshot,
                    encoded,
                );
                batchBytes += bytes;
                batchPeers++;
            }
        }
        await yieldToIo();
        // Presence has no correlated reply. New gameplay must not wait behind an
        // older roster fan-out, even when that earlier snapshot acknowledged a command.
        await broadcastPresence(sockets, roomId, () => broadcastVersions.get(roomId) !== version);
    }
    function closeConnectedRoom(roomId: string): void {
        clearTimeout(votingRefreshes.get(roomId)?.timer);
        votingRefreshes.delete(roomId);
        for (const peer of sockets) {
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
        socket.on("error", () => socket.terminate());
        if (wss.clients.size > settings.value.webSocketMaximumConnections) {
            socket.close(1013, "Connection capacity full");
            return;
        }
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
            settings.value.webSocketHelloTimeoutMs,
        );
        const processMessage = async (raw: RawData, isBinary: boolean): Promise<void> => {
            let requestId: string | null = null;
            try {
                await lifecycleReady;
                if (isBinary) {
                    throw coded("VALIDATION_ERROR", MESSAGE_KEYS.REALTIME_INVALID_MESSAGE);
                }
                const value: unknown = parseProtocolMessage(raw);
                const base = envelopeSchema.parse(value);
                requestId = base.requestId;
                if (!context) {
                    return await authenticateSocket(value);
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
                await executeAuthenticatedCommand(context, value);
            } catch (error) {
                reportMessageError(error);
            }

            function reportMessageError(error: unknown) {
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

            async function executeAuthenticatedCommand(context: Context, value: unknown) {
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
                    if (finishParticipantLeave()) return;
                }
                if (
                    commandSnapshot.session?.currentCard &&
                    (command.type === "command.skipCard" || command.type === "command.vetoCard")
                ) {
                    broadcastRoomEvent(sockets, roomId, "session.cardReplaced", {
                        reason: command.type === "command.skipCard" ? "SKIPPED" : "VETOED",
                    });
                }
                if (command.type === "command.submitVote") {
                    send(
                        socket,
                        "room.snapshot",
                        requestId,
                        commandSnapshot.session?.revision ?? null,
                        commandSnapshot,
                    );
                    scheduleVotingRefresh(roomId);
                    return;
                }
                let roleReason: RoomRoleChangeReason | null = null;
                if (command.type === "command.transferHost") roleReason = "HOST_TRANSFERRED";
                else if (leaving && context.participant.role === "HOST") roleReason = "HOST_LEFT";
                const roleChanges = roleReason
                    ? roleChangesFromSnapshot(priorRoles, commandSnapshot.participants, roleReason)
                    : [];
                await refreshRoom(roomId, requestId, roleChanges);
                function finishParticipantLeave(): boolean {
                    for (const peer of sockets) {
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
                        return true;
                    }
                    return false;
                }
            }

            async function authenticateSocket(value: unknown) {
                const hello = clientHelloEnvelopeSchema.parse(value);
                if (!hello.payload.supportedProtocolVersions.includes(PROTOCOL_VERSION))
                    throw coded(
                        "PROTOCOL_VERSION_UNSUPPORTED",
                        MESSAGE_KEYS.REALTIME_PROTOCOL_UNSUPPORTED,
                    );
                if (pendingHandshakes >= settings.value.webSocketConcurrentAuthentications) {
                    socket.close(1013, "Authentication capacity full");
                    return;
                }
                // Hello submission and admitted database work have separate deadlines.
                clearTimeout(deadline);
                pendingHandshakes++;
                const authenticationDeadline = setTimeout(
                    () => socket.close(1013, "Authentication timed out"),
                    settings.value.webSocketAuthenticationTimeoutMs,
                );
                let activation;
                try {
                    activation = await service.authenticate(
                        hello.payload.roomCode,
                        hello.payload.participantCredential,
                    );
                } catch (error) {
                    socket.close(1013, "Authentication unavailable");
                    throw error;
                } finally {
                    clearTimeout(authenticationDeadline);
                    pendingHandshakes--;
                }
                if (!activation) {
                    send(socket, "error", requestId, null, {
                        code: "ROOM_NOT_FOUND",
                        message: translate(locale, MESSAGE_KEYS.REALTIME_CREDENTIAL_NOT_FOUND),
                    });
                    socket.close(4401, "Credential not found");
                    return;
                }
                if (socket.readyState !== WebSocket.OPEN) {
                    if (![...sockets].some((peer) => peer.participant.id === activation.id)) {
                        const result = await service.markTemporarilyDisconnected(
                            activation,
                            hostDisconnectGraceMs,
                        );
                        if (result.participant) scheduleDisconnectExpiry(result.participant);
                    }
                    return;
                }
                const participant = activation;
                const pendingFallback = disconnectTimers.get(participant.id);
                if (pendingFallback) {
                    clearTimeout(pendingFallback);
                    disconnectTimers.delete(participant.id);
                }
                for (const existing of sockets) {
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
                if (activation.roleChanges.length) {
                    await refreshRoom(
                        participant.roomId,
                        requestId,
                        activation.roleChanges,
                        noticesSent,
                    );
                } else {
                    const snapshot = await service.snapshot(participant.roomId, participant);
                    send(
                        socket,
                        "room.snapshot",
                        requestId,
                        snapshot.session?.revision ?? null,
                        snapshot,
                    );
                    scheduleVotingRefresh(participant.roomId);
                }
            }
        };
        let messageQueue = Promise.resolve();
        let queuedMessages = 0;
        let socketQueuedBytes = 0;
        socket.on("message", (raw, isBinary) => {
            if (Date.now() - commandWindowStarted > settings.value.webSocketRateWindowMs) {
                commandWindowStarted = Date.now();
                commandsInWindow = 0;
            }
            commandsInWindow += 1;
            if (
                isPublicRuntimeSecurityEnforced(settings.value) &&
                commandsInWindow > settings.value.webSocketRatePerSocket
            ) {
                send(socket, "error", null, null, {
                    code: "NOT_AUTHORIZED",
                    message: translate(locale, MESSAGE_KEYS.REALTIME_RATE_EXCEEDED),
                });
                return;
            }
            const bytes = Array.isArray(raw)
                ? raw.reduce((total, buffer) => total + buffer.byteLength, 0)
                : raw.byteLength;
            if (context && !isBinary && bytes <= settings.value.webSocketHeartbeatFastPathBytes) {
                try {
                    const ping = clientPingEnvelopeSchema.safeParse(JSON.parse(raw.toString()));
                    if (ping.success) {
                        send(socket, "server.pong", ping.data.requestId, null, {
                            serverTime: Date.now(),
                        });
                        return;
                    }
                } catch {
                    // The normal boundary handler below reports malformed messages.
                }
            }
            if (
                queuedMessages >= settings.value.webSocketQueuedMessages ||
                socketQueuedBytes + bytes > settings.value.webSocketQueuedBytesPerSocket ||
                queuedInputBytes + bytes > settings.value.webSocketQueuedBytesProcess
            ) {
                socket.close(1013, "Command queue full");
                return;
            }
            queuedMessages++;
            socketQueuedBytes += bytes;
            queuedInputBytes += bytes;
            messageQueue = messageQueue
                .then(() => {
                    if (socket.readyState === WebSocket.OPEN) return processMessage(raw, isBinary);
                })
                .catch(() => socket.terminate())
                .finally(() => {
                    queuedMessages--;
                    socketQueuedBytes -= bytes;
                    queuedInputBytes -= bytes;
                });
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
        for (const state of votingRefreshes.values()) clearTimeout(state.timer);
        votingRefreshes.clear();
        for (const timer of disconnectTimers.values()) clearTimeout(timer);
        disconnectTimers.clear();
        participantCommands.clear();
        devicePairings.clear();
    });
    return wss as WebSocketServer & { roomLifecycleReady: Promise<void> };
}

function parseProtocolMessage(raw: RawData) {
    let buffer: Buffer;
    if (Buffer.isBuffer(raw)) buffer = raw;
    else if (Array.isArray(raw)) buffer = Buffer.concat(raw);
    else buffer = Buffer.from(raw);
    const value: unknown = JSON.parse(buffer.toString("utf8"));
    const receivedProtocol =
        typeof value === "object" && value !== null && "protocol" in value
            ? (value as { protocol?: unknown }).protocol
            : undefined;
    if (typeof receivedProtocol === "number" && receivedProtocol !== PROTOCOL_VERSION)
        throw coded("PROTOCOL_VERSION_UNSUPPORTED", MESSAGE_KEYS.REALTIME_PROTOCOL_UNSUPPORTED);
    return value;
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
    encoded?: string | readonly Buffer[],
): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    let snapshotVersion:
        { sessionId: string | null; revision: number; settingsRevision: number } | undefined;
    if (type === "room.snapshot") {
        const snapshot = payload as RoomSnapshot;
        snapshotVersion = {
            sessionId: snapshot.session?.id ?? null,
            revision: snapshot.session?.revision ?? -1,
            settingsRevision: snapshot.settings.revision,
        };
        const previous = lastSnapshots.get(socket);
        if (
            previous &&
            (snapshotVersion.settingsRevision < previous.settingsRevision ||
                (snapshotVersion.sessionId === previous.sessionId &&
                    snapshotVersion.revision < previous.revision))
        )
            return;
    }
    const maximumBufferedBytes = settings.value.webSocketSendBytesPerSocket;
    if (socket.bufferedAmount > maximumBufferedBytes) {
        socket.close(1013, "Slow consumer");
        return;
    }
    let fragments: readonly Buffer[];
    if (typeof encoded === "object") fragments = encoded;
    else
        fragments = [
            Buffer.from(
                encoded ??
                    JSON.stringify({
                        protocol: PROTOCOL_VERSION,
                        type,
                        requestId,
                        revision,
                        payload,
                    }),
                "utf8",
            ),
        ];
    const bytes = fragments.reduce((sum, fragment) => sum + fragment.byteLength, 0);
    if (bytes > MAX_WEBSOCKET_MESSAGE_BYTES) {
        socket.close(1009, "Message too large");
        return;
    }
    if (socket.bufferedAmount + bytes > maximumBufferedBytes) {
        socket.close(1013, "Slow consumer");
        return;
    }
    if (pendingOutgoingBytes + bytes > settings.value.webSocketSendBytesProcess) {
        socket.close(1013, "Server send queue full");
        return;
    }
    pendingOutgoingBytes += bytes;
    if (snapshotVersion) lastSnapshots.set(socket, snapshotVersion);
    for (let index = 0; index < fragments.length - 1; index++)
        socket.send(fragments[index], { binary: false, fin: false });
    socket.send(fragments[fragments.length - 1], { binary: false, fin: true }, (error) => {
        pendingOutgoingBytes -= bytes;
        if (error) socket.terminate();
    });
}
function coded(code: string, message: string): Error {
    return Object.assign(new Error(message), { code });
}
async function broadcastPresence(
    sockets: Set<Context>,
    roomId: string,
    superseded: () => boolean,
): Promise<void> {
    const connectedByParticipant = new Map<string, Context>();
    for (const entry of sockets)
        if (entry.participant.roomId === roomId)
            connectedByParticipant.set(entry.participant.id, entry);
    const connected = [...connectedByParticipant.values()].map((entry) => ({
        participantId: entry.participant.id,
        displayName: entry.participant.displayName,
        role: entry.participant.role,
    }));
    const payload = { connected };
    const encoded = JSON.stringify({
        protocol: PROTOCOL_VERSION,
        type: "room.presence",
        requestId: null,
        revision: null,
        payload,
    });
    const data = Buffer.from(encoded, "utf8");
    let batchPeers = 0;
    let batchBytes = 0;
    for (const peer of sockets) {
        if (superseded()) return;
        if (peer.participant.roomId !== roomId || peer.socket.readyState !== WebSocket.OPEN)
            continue;
        if (lastPresence.get(peer.socket) === encoded) continue;
        if (
            batchPeers >= settings.value.webSocketBroadcastBatchPeers ||
            batchBytes + data.byteLength > settings.value.webSocketBroadcastBatchBytes
        ) {
            await yieldToIo();
            if (superseded()) return;
            batchBytes = 0;
            batchPeers = 0;
        }
        send(peer.socket, "room.presence", null, null, payload, [data]);
        lastPresence.set(peer.socket, encoded);
        batchPeers++;
        batchBytes += data.byteLength;
    }
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
