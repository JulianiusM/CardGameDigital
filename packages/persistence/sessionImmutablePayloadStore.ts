import { readStoredJson, writeStoredJson } from "./storedJson";
import { DEFAULT_PERSISTENCE_WORK_LIMITS, persistenceWorkLimits } from "./persistenceWorkLimits";
import { MESSAGE_KEYS } from "../localization/keys";
import { createHash } from "node:crypto";
import { createBrotliCompress, brotliDecompress, constants } from "node:zlib";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { setImmediate } from "node:timers/promises";
import type { EntityManager } from "typeorm";
import {
    emptySessionCardPolicy,
    type GameSessionRuntimeState,
    type SessionCardPolicyInput,
    type SessionPolicySnapshot,
} from "../game-core";
import { retainedRuntimeBoundaries } from "./privateBoundaryRetention";
import { SessionImmutablePayloadEntity } from "./entities/game/SessionImmutablePayloadEntity";
import { SessionImmutablePayloadChunkEntity } from "./entities/game/SessionImmutablePayloadChunkEntity";

export const SESSION_PAYLOAD_CHUNK_BYTES = 24 * 1024;
export const MAXIMUM_POLICY_INPUT_BYTES = DEFAULT_PERSISTENCE_WORK_LIMITS.policyInputMaximumBytes;
const decompress = promisify(brotliDecompress);

type PolicyInputs = SessionPolicySnapshot & { session: SessionCardPolicyInput };
type LoadedInputs = { snapshot: SessionPolicySnapshot; session: SessionCardPolicyInput };
const loadedInputs = new WeakMap<
    object,
    Map<
        string,
        { snapshot: WeakRef<SessionPolicySnapshot>; session: WeakRef<SessionCardPolicyInput> }
    >
>();
const loadingInputs = new WeakMap<object, Map<string, Promise<LoadedInputs>>>();
let activeInputLoads = 0;

function policyCapacityExceeded(): Error {
    return Object.assign(new Error(MESSAGE_KEYS.GAME_SESSION_CAPACITY_EXCEEDED), {
        code: "SESSION_CAPACITY_EXCEEDED",
        status: 429,
    });
}

async function sharedPolicyInputs(manager: EntityManager, digest: string): Promise<LoadedInputs> {
    const cache = loadedInputs.get(manager.connection) ?? new Map();
    loadedInputs.set(manager.connection, cache);
    const cached = cache.get(digest);
    const snapshot = cached?.snapshot.deref();
    const session = cached?.session.deref();
    if (snapshot && session) return { snapshot, session };
    const pending = loadingInputs.get(manager.connection) ?? new Map();
    loadingInputs.set(manager.connection, pending);
    const existing = pending.get(digest);
    if (existing) return existing;
    if (activeInputLoads >= persistenceWorkLimits().policyConcurrentDecodes)
        throw policyCapacityExceeded();
    activeInputLoads++;
    const read = decodePolicyInputs(manager, digest).then((inputs) => {
        cache.delete(digest);
        if (cache.size >= persistenceWorkLimits().policyInputCacheMaximumEntries)
            cache.delete(cache.keys().next().value!);
        cache.set(digest, {
            snapshot: new WeakRef(inputs.snapshot),
            session: new WeakRef(inputs.session),
        });
        return inputs;
    });
    pending.set(digest, read);
    try {
        return await read;
    } finally {
        activeInputLoads--;
        pending.delete(digest);
    }
}

/** Serialize sparse policy one directive/rule at a time. No catalog or text exists here. */
function* policyPieces(inputs: PolicyInputs): Iterable<string> {
    yield "{";
    let firstScope = true;
    for (const name of ["dataSpace", "group", "session"] as const) {
        if (!firstScope) yield ",";
        firstScope = false;
        yield JSON.stringify(name) + ":";
        const scope = inputs[name];
        if (!scope) {
            yield "null";
            continue;
        }
        yield '{"scopeDefault":' + JSON.stringify(scope.scopeDefault) + ',"conditionalRules":[';
        for (let i = 0; i < scope.conditionalRules.length; i++) {
            if (i) yield ",";
            yield JSON.stringify(scope.conditionalRules[i]);
        }
        yield '],"exactCards":[';
        for (let i = 0; i < scope.exactCards.length; i++) {
            if (i) yield ",";
            yield JSON.stringify(scope.exactCards[i]);
        }
        yield "]}";
    }
    yield "}";
}

async function persistPolicyInputs(manager: EntityManager, inputs: PolicyInputs): Promise<string> {
    const hash = createHash("sha256").update("POLICY_INPUT\0");
    let bytes = 0;
    let pieces = 0;
    for (const piece of policyPieces(inputs)) {
        bytes += Buffer.byteLength(piece);
        if (bytes > persistenceWorkLimits().policyInputMaximumBytes) throw policyCapacityExceeded();
        hash.update(piece);
        if (++pieces % 256 === 0) await setImmediate();
    }
    const digest = hash.digest("hex");
    const payloads = manager.getRepository(SessionImmutablePayloadEntity);
    await manager
        .createQueryBuilder()
        .insert()
        .into(SessionImmutablePayloadEntity)
        .values({
            digest,
            payloadKind: "POLICY_INPUT",
            compression: "brotli",
            chunkCount: 0,
            uncompressedByteLength: bytes,
            compressedByteLength: 0,
            createdAt: new Date(),
        })
        .orIgnore()
        .execute();
    // INSERT IGNORE obtains the unique parent-row lock before adopting a digest.
    // Avoid shared locks on a missing key: concurrent identical starts would otherwise
    // acquire conflicting gap locks. A current read also sees the winning writer.
    const stored = payloads
        .createQueryBuilder("payload")
        .where("payload.digest = :digest", { digest });
    if (manager.connection.options.type !== "better-sqlite3") stored.setLock("pessimistic_write");
    if ((await stored.getOneOrFail()).chunkCount > 0) return digest;
    let pending = Buffer.alloc(0);
    let chunkCount = 0;
    let compressedBytes = 0;
    const saveChunk = async (chunk: Buffer) => {
        compressedBytes += chunk.length;
        await manager
            .createQueryBuilder()
            .insert()
            .into(SessionImmutablePayloadChunkEntity)
            .values({
                payloadDigest: digest,
                chunkIndex: chunkCount++,
                payloadBase64: chunk.toString("base64"),
            })
            .orIgnore()
            .execute();
    };
    const stream = Readable.from(policyPieces(inputs)).pipe(
        createBrotliCompress({
            params: { [constants.BROTLI_PARAM_QUALITY]: 4 },
        }),
    );
    for await (const chunk of stream) {
        pending = Buffer.concat([pending, chunk as Buffer]);
        while (pending.length >= SESSION_PAYLOAD_CHUNK_BYTES) {
            await saveChunk(pending.subarray(0, SESSION_PAYLOAD_CHUNK_BYTES));
            pending = pending.subarray(SESSION_PAYLOAD_CHUNK_BYTES);
        }
    }
    if (pending.length) await saveChunk(pending);
    await payloads.update({ digest }, { chunkCount, compressedByteLength: compressedBytes });
    return digest;
}

export async function externalizeSessionImmutableState(
    manager: EntityManager,
    runtime: GameSessionRuntimeState,
    existing?: { policyInputDigest: string | null },
): Promise<{ runtimeStateJson: string; policyInputDigest: string | null }> {
    let policyInputDigest = existing?.policyInputDigest ?? null;
    if (runtime.state === "ENDED") policyInputDigest = null;
    else if (
        !policyInputDigest &&
        (runtime.policySnapshot?.dataSpace ||
            runtime.policySnapshot?.group ||
            Object.keys(runtime.sessionCardPolicy.scopeDefault).length ||
            runtime.sessionCardPolicy.conditionalRules.length ||
            runtime.sessionCardPolicy.exactCards.length)
    ) {
        policyInputDigest = await persistPolicyInputs(manager, {
            dataSpace: runtime.policySnapshot?.dataSpace ?? null,
            group: runtime.policySnapshot?.group ?? null,
            session: runtime.sessionCardPolicy,
        });
    }
    return {
        runtimeStateJson: await writeStoredJson({
            ...runtime,
            boundariesByPlayer: retainedRuntimeBoundaries(runtime),
            policySnapshot: null,
            sessionCardPolicy: emptySessionCardPolicy(),
            groupHistoryCardIds: [],
            historyIndex: [],
        }),
        policyInputDigest,
    };
}

export async function hydrateSessionImmutableState(
    manager: EntityManager,
    runtimeStateJson: string,
    digests: { policyInputDigest: string | null },
): Promise<GameSessionRuntimeState> {
    const runtime = await readStoredJson<GameSessionRuntimeState>(runtimeStateJson);
    if (runtime.version !== 7) throw new Error("Unsupported persisted Session runtime");
    if (!digests.policyInputDigest || runtime.state === "ENDED") return runtime;
    const inputs = await sharedPolicyInputs(manager, digests.policyInputDigest);
    return { ...runtime, policySnapshot: inputs.snapshot, sessionCardPolicy: inputs.session };
}

async function decodePolicyInputs(manager: EntityManager, digest: string): Promise<LoadedInputs> {
    const metadata = await manager
        .getRepository(SessionImmutablePayloadEntity)
        .findOneBy({ digest: digest, payloadKind: "POLICY_INPUT" });
    if (
        !metadata ||
        metadata.uncompressedByteLength < 1 ||
        metadata.compressedByteLength < 1 ||
        metadata.chunkCount !==
            Math.ceil(metadata.compressedByteLength / SESSION_PAYLOAD_CHUNK_BYTES)
    )
        throw new Error("Invalid Session policy payload metadata");
    if (
        metadata.uncompressedByteLength > persistenceWorkLimits().policyInputMaximumBytes ||
        metadata.compressedByteLength > persistenceWorkLimits().policyInputMaximumBytes + 65536
    )
        throw policyCapacityExceeded();
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < metadata.chunkCount; offset += 16) {
        const page = await manager
            .getRepository(SessionImmutablePayloadChunkEntity)
            .createQueryBuilder("chunk")
            .where("chunk.payloadDigest = :digest AND chunk.chunkIndex >= :offset", {
                digest: metadata.digest,
                offset,
            })
            .orderBy("chunk.chunkIndex", "ASC")
            .take(Math.min(16, metadata.chunkCount - offset))
            .getMany();
        if (page.length !== Math.min(16, metadata.chunkCount - offset))
            throw new Error("Missing Session policy chunk");
        for (const [index, row] of page.entries()) {
            if (
                row.chunkIndex !== offset + index ||
                row.payloadBase64.length > (SESSION_PAYLOAD_CHUNK_BYTES * 4) / 3
            )
                throw new Error("Invalid Session policy chunk");
            chunks.push(Buffer.from(row.payloadBase64, "base64"));
        }
    }
    const compressed = Buffer.concat(chunks);
    if (compressed.length !== metadata.compressedByteLength)
        throw new Error("Invalid Session policy length");
    const json = await decompress(compressed, { maxOutputLength: metadata.uncompressedByteLength });
    if (
        json.length !== metadata.uncompressedByteLength ||
        createHash("sha256").update("POLICY_INPUT\0").update(json).digest("hex") !== metadata.digest
    )
        throw new Error("Invalid Session policy digest");
    const inputs = JSON.parse(json.toString("utf8")) as PolicyInputs;
    return {
        snapshot: { dataSpace: inputs.dataSpace, group: inputs.group },
        session: inputs.session,
    };
}

/** Bounded orphan cleanup; callers detach terminal references first, in the same transaction. */
export async function collectUnusedSessionInputs(manager: EntityManager): Promise<void> {
    const unreferenced = `NOT EXISTS (SELECT 1 FROM game_sessions s WHERE s.policy_input_digest = payload.digest)
        AND NOT EXISTS (SELECT 1 FROM couch_game_sessions s WHERE s.policy_input_digest = payload.digest)`;
    const candidates = manager
        .getRepository(SessionImmutablePayloadEntity)
        .createQueryBuilder("payload")
        .select(["payload.digest"])
        .where(unreferenced)
        .orderBy("payload.createdAt", "ASC")
        .take(persistenceWorkLimits().immutablePayloadCleanupBatchSize);
    if (manager.connection.options.type !== "better-sqlite3")
        candidates.setLock("pessimistic_write");
    for (const { digest } of await candidates.getMany()) {
        await manager.query(
            `DELETE FROM session_immutable_payloads WHERE digest = ?
            AND NOT EXISTS (SELECT 1 FROM game_sessions s WHERE s.policy_input_digest = ?)
            AND NOT EXISTS (SELECT 1 FROM couch_game_sessions s WHERE s.policy_input_digest = ?)`,
            [digest, digest, digest],
        );
    }
}
