import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { WebSocket } from "ws";
import {
    getAppDataSource,
    initDataSource,
} from "../../apps/server/src/modules/database/dataSource";
import { setBundledCardCatalogPathForTests } from "../../apps/server/src/modules/database/bundledCardCatalog";
import settings from "../../apps/server/src/modules/settings";
import { attachWebSocketServer } from "../../apps/server/src/modules/websocket";
import { RoomService } from "../../packages/application/roomService";
import { CryptoRandomSource } from "../../packages/application/cryptoRandomSource";
import { defaultRoomGameSettings } from "../../packages/application/roomGameSettings";
import { TypeOrmRealtimeRoomRepository } from "../../packages/persistence/TypeOrmRealtimeRoomRepository";
import { TypeOrmCardRepository } from "../../packages/persistence/TypeOrmCardRepository";
import { CardEntity } from "../../packages/persistence/entities/card/CardEntity";
import { RoomEntity } from "../../packages/persistence/entities/game/RoomEntity";
import { RoomParticipantEntity } from "../../packages/persistence/entities/game/RoomParticipantEntity";
import { DataSpace } from "../../packages/persistence/entities/user/DataSpace";
import { PROTOCOL_VERSION } from "../../packages/protocol";
import { SequenceRandomSource, GameSession } from "../../packages/game-core";

const id = (index: number) => `90000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** In-memory SQLite only. Real repositories, engine, ws adapter and loopback clients;
 * generated metadata is a fixture, never a catalog-installation or disk-fill test. */
async function main() {
    Object.assign(process.env, {
        NODE_ENV: "test",
        DEPLOYMENT_MODE: "local",
        AUTH_MODE: "none",
        DB_TYPE: "sqlite",
        DB_FILE: ":memory:",
        LOG_LEVEL: "error",
    });
    setBundledCardCatalogPathForTests(path.resolve("catalog/card-catalog.json"));
    await settings.read(process.platform === "win32" ? "NUL" : "/dev/null");
    const source = await initDataSource();
    const native = (source.driver as unknown as { databaseConnection: Database.Database })
        .databaseConnection;
    const cards = new TypeOrmCardRepository(source.getRepository(CardEntity));
    let queries = 0;
    source.subscribers.push({
        beforeQuery() {
            queries++;
        },
    });
    const reports: object[] = [];
    try {
        for (const catalogCount of [1940, 50_000]) {
            if (catalogCount === 50_000) {
                const count = await source.getRepository(CardEntity).count();
                const insert = native.prepare(
                    "INSERT INTO cards (id, card_type, yes_no_answer_possible, question_category_id, intensity, repeatable_in_session, social_sensitivity, active) VALUES (?, 'QUESTION', 1, 'CAT_EVERYDAY', 1, 1, 'GENERAL', 1)",
                );
                const render = native.prepare(
                    "INSERT INTO card_localizations (card_id, locale, text, active, updated_at) VALUES (?, 'de-DE', 'Benchmark Card', 1, CURRENT_TIMESTAMP)",
                );
                native.transaction(() => {
                    for (let i = count; i < catalogCount; i++) {
                        insert.run(id(i));
                        render.run(id(i));
                    }
                })();
            }
            assert.equal(await source.getRepository(CardEntity).count(), catalogCount);
            for (const peers of process.argv.includes("--large-room") ? [1000] : [100, 1000]) {
                process.stdout.write(
                    JSON.stringify({ phase: "setup", catalogCount, peers }) + "\n",
                );
                const repository = new TypeOrmRealtimeRoomRepository(source);
                const service = new RoomService(
                    repository,
                    cards,
                    new CryptoRandomSource(),
                    undefined,
                    { maximumParticipants: 1000, maximumPlayers: 1000 },
                );
                const owner = (await source.getRepository(DataSpace).find({ take: 1 }))[0];
                const gameSettings = {
                    ...defaultRoomGameSettings(),
                    mode: "NEVER_HAVE_I_EVER" as const,
                    adultContentConfirmed: true,
                    cardPolicy: {
                        scopeDefault: {
                            repeatableInSession: "ENABLE" as const,
                            repeatCooldown: { mode: "SET" as const, value: 0 },
                        },
                        conditionalRules: [],
                        exactCards: [],
                    },
                };
                const room = await service.createRoom("界".repeat(40), owner.id, gameSettings);
                const credentials = [room.participantCredential];
                const host = await service.authenticate(room.roomCode, room.participantCredential);
                assert(host);
                for (let i = 1; i < peers; i++) {
                    const credential = randomBytes(32).toString("base64url");
                    credentials.push(credential);
                    await source.getRepository(RoomParticipantEntity).insert({
                        id: randomUUID(),
                        roomId: room.roomId,
                        role: i === peers - 1 ? "DISPLAY" : "PLAYER",
                        displayName: "界".repeat(40),
                        credentialHash: createHash("sha256").update(credential).digest("hex"),
                        connectionStatus: "CONNECTED",
                        firstConnectedAt: new Date(),
                        lastConnectedAt: new Date(),
                        lastSeenAt: new Date(),
                        createdAt: new Date(),
                    });
                }
                let snapshot = await service.execute(room.roomId, host, {
                    type: "command.startSession",
                    revision: null,
                    payload: {},
                });
                process.stdout.write(
                    JSON.stringify({ phase: "started", catalogCount, peers }) + "\n",
                );
                assert(snapshot.session);
                const cardIds = native.prepare("SELECT id FROM cards ORDER BY id").all() as {
                    id: string;
                }[];
                const appearance = native.prepare(
                    "INSERT INTO card_appearances (id, session_id, card_id, shown_at, round_number, sequence) VALUES (?, ?, ?, CURRENT_TIMESTAMP, 1, ?)",
                );
                native.transaction(() => {
                    for (let i = 1; i <= 100_000; i++)
                        appearance.run(
                            id(100_000 + i),
                            snapshot.session!.id,
                            cardIds[i % cardIds.length].id,
                            i,
                        );
                })();
                const runtime = await repository.loadRuntime(room.roomId);
                assert(runtime);
                await repository.commitRuntime(room.roomId, runtime.revision, {
                    ...runtime,
                    cardsShown: 100_000,
                    revision: runtime.revision + 1,
                    poolRevision: runtime.poolRevision + 1,
                });
                const cold = new RoomService(
                    repository,
                    cards,
                    new CryptoRandomSource(),
                    undefined,
                    { maximumParticipants: 1000, maximumPlayers: 1000 },
                );
                queries = 0;
                let started = performance.now();
                const restored = await cold.snapshot(room.roomId, host);
                process.stdout.write(JSON.stringify({ phase: "cold", catalogCount, peers }) + "\n");
                const coldMs = performance.now() - started;
                const coldQueries = queries;
                assert.equal(restored.session?.cardsShown, 100_000);
                const current = await repository.loadRuntime(room.roomId);
                assert(current);
                // A cold reconstruction must consume the same complete stream deterministically.
                const first = GameSession.restore(
                    current,
                    new SequenceRandomSource([0.42, 0.7, 0.2]),
                );
                const second = GameSession.restore(
                    current,
                    new SequenceRandomSource([0.42, 0.7, 0.2]),
                );
                for (const game of [first, second])
                    await game.startTurn(
                        game.revision,
                        cards.scan(
                            { locale: game.cardLocale, missingTranslation: "EXCLUDE" },
                            game.historyContext,
                        ),
                    );
                assert.equal(first.currentCard?.id, second.currentCard?.id);
                const server = http.createServer();
                const ws = attachWebSocketServer(server, cold, {
                    heartbeatIntervalMs: 60_000,
                    reconciliationIntervalMs: 60_000,
                });
                await ws.roomLifecycleReady;
                server.listen(0, "127.0.0.1");
                await once(server, "listening");
                const port = (server.address() as { port: number }).port;
                const clients: WebSocket[] = [];
                const latest = new Map<number, { revision: number; session: any }>();
                let receivedBytes = 0;
                let protocolErrors = 0;
                const closedCodes: number[] = [];
                const memoryBefore = process.memoryUsage().heapUsed;
                let peakHeap = memoryBefore;
                const heapSampler = setInterval(() => {
                    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
                }, 20);
                started = performance.now();
                queries = 0;
                try {
                    // Reconnect waves admit 20 real devices concurrently; all peers remain connected.
                    for (let offset = 0; offset < peers; offset += 20) {
                        assert(
                            performance.now() - started < 120_000,
                            "Reconnect waves exceeded 120 seconds",
                        );
                        await Promise.all(
                            credentials
                                .slice(offset, offset + 20)
                                .map(async (credential, index) => {
                                    const number = offset + index;
                                    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
                                    clients.push(client);
                                    const initial = new Promise<void>((resolve, reject) => {
                                        const deadline = setTimeout(
                                            () => reject(new Error("Reconnect did not complete")),
                                            30_000,
                                        );
                                        client.on("message", (data) => {
                                            receivedBytes += Buffer.byteLength(data.toString());
                                            const envelope = JSON.parse(data.toString());
                                            if (envelope.type === "error") {
                                                protocolErrors++;
                                                reject(new Error(envelope.payload.code));
                                            }
                                            if (envelope.type === "room.snapshot") {
                                                const game = envelope.payload.session;
                                                latest.set(number, {
                                                    revision: envelope.revision,
                                                    session: {
                                                        neverHaveIEverVoting: {
                                                            result: game?.neverHaveIEverVoting
                                                                ?.result,
                                                        },
                                                        voteResult: game?.voteResult,
                                                    },
                                                });
                                                clearTimeout(deadline);
                                                resolve();
                                            }
                                        });
                                        client.once("error", reject);
                                        client.once("close", (code) => {
                                            closedCodes.push(code);
                                            clearTimeout(deadline);
                                            reject(new Error(`Reconnect socket closed: ${code}`));
                                        });
                                    });
                                    await once(client, "open");
                                    client.send(
                                        JSON.stringify({
                                            protocol: PROTOCOL_VERSION,
                                            type: "client.hello",
                                            requestId: randomUUID(),
                                            revision: null,
                                            payload: {
                                                roomCode: room.roomCode,
                                                participantCredential: credential,
                                                supportedProtocolVersions: [PROTOCOL_VERSION],
                                                applicationVersion: "benchmark",
                                                role: "PLAYER",
                                                capabilities: [],
                                            },
                                        }),
                                    );
                                    await initial;
                                }),
                        );
                        if ((offset + 20) % 200 === 0)
                            process.stdout.write(
                                JSON.stringify({
                                    phase: "reconnecting",
                                    peers: offset + 20,
                                    ms: Math.round(performance.now() - started),
                                }) + "\n",
                            );
                    }
                    const reconnectMs = performance.now() - started;
                    const reconnectQueries = queries;
                    await sleep(150);
                    async function command(type: string, payload: object) {
                        const budgetMs = peers === 100 ? 5_000 : 30_000;
                        const revision = latest.get(0)!.revision;
                        queries = 0;
                        const beforeBytes = receivedBytes;
                        const start = performance.now();
                        clients[0].send(
                            JSON.stringify({
                                protocol: PROTOCOL_VERSION,
                                type,
                                requestId: randomUUID(),
                                revision,
                                payload,
                            }),
                        );
                        while ([...latest.values()].some((value) => value.revision <= revision)) {
                            assert.equal(
                                closedCodes.length,
                                0,
                                `Sockets closed: ${closedCodes.slice(0, 5)}`,
                            );
                            assert(
                                performance.now() - start < budgetMs,
                                `${type}: Command-to-all-peers latency exceeded ${budgetMs} ms; queries ${queries}; delivered ${[...latest.values()].filter((value) => value.revision > revision).length}/${peers}`,
                            );
                            assert.equal(protocolErrors, 0);
                            await sleep(10);
                        }
                        return {
                            ms: Math.round(performance.now() - start),
                            queries,
                            bytes: receivedBytes - beforeBytes,
                        };
                    }
                    const draws = [await command("command.startTurn", {})];
                    const votes = [];
                    for (let cycle = 0; cycle < 5; cycle++) {
                        const voted = await command("command.submitVote", {
                            playerId: host.id,
                            vote: "YES",
                        });
                        votes.push(voted);
                        assert(voted.queries < 150, "Voting must not rescan the catalog");
                        for (const { session } of latest.values()) {
                            assert.equal(session.neverHaveIEverVoting.result, null);
                            assert.deepEqual(session.voteResult, { yes: 0, no: 0, total: 0 });
                        }
                        if (cycle < 4) draws.push(await command("command.skipCard", {}));
                    }
                    const heapGrowthMiB = Math.round(
                        (process.memoryUsage().heapUsed - memoryBefore) / 1024 / 1024,
                    );
                    const peakHeapGrowthMiB = Math.ceil((peakHeap - memoryBefore) / 1024 / 1024);
                    const pages = Math.ceil(catalogCount / 256);
                    assert(coldQueries <= pages * 4 + 50);
                    assert(draws.every((draw) => draw.queries <= pages * 8 + 200));
                    assert(heapGrowthMiB < 256, "Managed heap growth exceeded 256 MiB");
                    assert(peakHeapGrowthMiB < 256, "Sampled peak heap growth exceeded 256 MiB");
                    assert(reconnectMs < 120_000, "Reconnect waves exceeded 120 seconds");
                    const report = {
                        catalogCount,
                        peers,
                        historyRows: 100_000,
                        coldMs: Math.round(coldMs),
                        coldQueries,
                        reconnectMs: Math.round(reconnectMs),
                        reconnectQueries,
                        heapGrowthMiB,
                        peakHeapGrowthMiB,
                        draws,
                        votes,
                    };
                    reports.push(report);
                    process.stdout.write(JSON.stringify(report) + "\n");
                } finally {
                    clearInterval(heapSampler);
                    if (clients[0]?.readyState === WebSocket.OPEN && latest.has(0)) {
                        clients[0].send(
                            JSON.stringify({
                                protocol: PROTOCOL_VERSION,
                                type: "command.closeRoom",
                                requestId: randomUUID(),
                                revision: latest.get(0)!.revision,
                                payload: {},
                            }),
                        );
                        const closingAt = performance.now();
                        while (ws.clients.size && performance.now() - closingAt < 20_000)
                            await sleep(10);
                    }
                    for (const client of clients) client.terminate();
                    for (const client of ws.clients) client.terminate();
                    await new Promise<void>((resolve) => ws.close(() => resolve()));
                    await new Promise<void>((resolve) => server.close(() => resolve()));
                    await source
                        .getRepository(RoomEntity)
                        .update({ id: room.roomId }, { currentSessionId: null });
                    await source.getRepository(RoomEntity).delete(room.roomId);
                }
            }
        }
        process.stdout.write(
            JSON.stringify({
                node: process.version,
                platform: process.platform,
                cpu: os.cpus()[0].model,
                memoryGiB: Math.round(os.totalmem() / 2 ** 30),
                scenarios: reports.length,
            }) + "\n",
        );
    } finally {
        if (source.isInitialized) await source.destroy();
    }
}

main().catch((error) => {
    process.stderr.write(String(error) + "\n");
    process.exitCode = 1;
});
