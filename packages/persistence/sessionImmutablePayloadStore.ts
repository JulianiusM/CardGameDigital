import { createHash } from "node:crypto";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";
import type { EntityManager } from "typeorm";
import { SessionImmutablePayloadChunkEntity } from "./entities/game/SessionImmutablePayloadChunkEntity";
import { SessionImmutablePayloadEntity } from "./entities/game/SessionImmutablePayloadEntity";
import type { CardId, CompiledCardPolicySnapshot, GameSessionRuntimeState } from "../game-core";

export type SessionImmutablePayloadKind = "COMPILED_CARD_POLICY" | "GROUP_HISTORY";

/** Base64 stays below MariaDB TEXT and packet limits even with statement overhead. */
export const SESSION_PAYLOAD_CHUNK_BYTES = 24 * 1024;
const MAXIMUM_PAYLOAD_BYTES = 256 * 1024 * 1024;

export type EncodedSessionImmutablePayload = {
    digest: string;
    payloadKind: SessionImmutablePayloadKind;
    chunks: readonly string[];
    uncompressedByteLength: number;
    compressedByteLength: number;
};

export function encodeSessionImmutablePayload(
    payloadKind: SessionImmutablePayloadKind,
    payload: unknown,
): EncodedSessionImmutablePayload {
    const uncompressed = Buffer.from(JSON.stringify(payload), "utf8");
    const compressed = brotliCompressSync(uncompressed, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 },
    });
    const chunks: string[] = [];
    for (let offset = 0; offset < compressed.length; offset += SESSION_PAYLOAD_CHUNK_BYTES) {
        chunks.push(
            compressed.subarray(offset, offset + SESSION_PAYLOAD_CHUNK_BYTES).toString("base64"),
        );
    }
    const digest = createHash("sha256")
        .update(payloadKind)
        .update("\0")
        .update(uncompressed)
        .digest("hex");
    return {
        digest,
        payloadKind,
        chunks,
        uncompressedByteLength: uncompressed.length,
        compressedByteLength: compressed.length,
    };
}

export function encodeCompiledCardPolicySnapshot(
    snapshot: CompiledCardPolicySnapshot,
): EncodedSessionImmutablePayload {
    return encodeSessionImmutablePayload("COMPILED_CARD_POLICY", snapshot);
}

type GroupHistoryPayload =
    | {
          format: "CARD_ID_BITSET_V1";
          compiledCardPolicyDigest: string;
          cardCount: number;
          bitsBase64: string;
      }
    | { format: "CARD_IDS_V1"; cardIds: CardId[] };

function groupHistoryPayload(
    compiledCardPolicy: CompiledCardPolicySnapshot | null,
    compiledCardPolicyDigest: string | null,
    groupHistoryCardIds: readonly CardId[],
): GroupHistoryPayload {
    if (!compiledCardPolicy || !compiledCardPolicyDigest) {
        return { format: "CARD_IDS_V1", cardIds: [...groupHistoryCardIds].sort() };
    }
    const history = new Set(groupHistoryCardIds);
    const bits = Buffer.alloc(Math.ceil(compiledCardPolicy.cards.length / 8));
    for (const [index, [cardId]] of compiledCardPolicy.cards.entries()) {
        if (history.has(cardId)) bits[index >> 3] |= 1 << (index & 7);
    }
    return {
        format: "CARD_ID_BITSET_V1",
        compiledCardPolicyDigest,
        cardCount: compiledCardPolicy.cards.length,
        bitsBase64: bits.toString("base64"),
    };
}

export function encodeGroupHistorySnapshot(
    compiledCardPolicy: CompiledCardPolicySnapshot,
    compiledCardPolicyDigest: string,
    groupHistoryCardIds: readonly CardId[],
): EncodedSessionImmutablePayload {
    return encodeSessionImmutablePayload(
        "GROUP_HISTORY",
        groupHistoryPayload(compiledCardPolicy, compiledCardPolicyDigest, groupHistoryCardIds),
    );
}

async function persistEncodedPayload(
    manager: EntityManager,
    encoded: EncodedSessionImmutablePayload,
): Promise<void> {
    await manager
        .createQueryBuilder()
        .insert()
        .into(SessionImmutablePayloadEntity)
        .values({
            digest: encoded.digest,
            payloadKind: encoded.payloadKind,
            compression: "brotli",
            chunkCount: encoded.chunks.length,
            uncompressedByteLength: encoded.uncompressedByteLength,
            compressedByteLength: encoded.compressedByteLength,
            createdAt: new Date(),
        })
        .orIgnore()
        .execute();
    for (const [chunkIndex, payloadBase64] of encoded.chunks.entries()) {
        await manager
            .createQueryBuilder()
            .insert()
            .into(SessionImmutablePayloadChunkEntity)
            .values({ payloadDigest: encoded.digest, chunkIndex, payloadBase64 })
            .orIgnore()
            .execute();
    }
}

export async function externalizeSessionImmutableState(
    manager: EntityManager,
    runtime: GameSessionRuntimeState,
    existingDigests: {
        compiledCardPolicyDigest: string | null;
        groupHistoryDigest: string | null;
    } = { compiledCardPolicyDigest: null, groupHistoryDigest: null },
): Promise<{
    runtimeStateJson: string;
    compiledCardPolicyDigest: string | null;
    groupHistoryDigest: string | null;
}> {
    let compiledCardPolicyDigest = existingDigests.compiledCardPolicyDigest;
    if (!compiledCardPolicyDigest && runtime.compiledCardPolicy) {
        const encoded = encodeCompiledCardPolicySnapshot(runtime.compiledCardPolicy);
        await persistEncodedPayload(manager, encoded);
        compiledCardPolicyDigest = encoded.digest;
    }

    let groupHistoryDigest = existingDigests.groupHistoryDigest;
    if (!groupHistoryDigest && runtime.groupHistoryCardIds.length > 0) {
        const payload = groupHistoryPayload(
            runtime.compiledCardPolicy,
            compiledCardPolicyDigest,
            runtime.groupHistoryCardIds,
        );
        const encoded = encodeSessionImmutablePayload("GROUP_HISTORY", payload);
        await persistEncodedPayload(manager, encoded);
        groupHistoryDigest = encoded.digest;
    }

    return {
        runtimeStateJson: JSON.stringify({
            ...runtime,
            compiledCardPolicy: null,
            groupHistoryCardIds: [],
            sessionHistory: [],
        }),
        compiledCardPolicyDigest,
        groupHistoryDigest,
    };
}

async function loadImmutablePayload(
    manager: EntityManager,
    payloadKind: SessionImmutablePayloadKind,
    digest: string,
): Promise<unknown> {
    const metadata = await manager.getRepository(SessionImmutablePayloadEntity).findOneBy({
        digest,
        payloadKind,
    });
    if (!metadata) throw new Error(`Stored Session references a missing ${payloadKind} payload`);
    if (
        metadata.compression !== "brotli" ||
        metadata.uncompressedByteLength < 1 ||
        metadata.uncompressedByteLength > MAXIMUM_PAYLOAD_BYTES ||
        metadata.compressedByteLength < 1
    ) {
        throw new Error(`Stored Session ${payloadKind} metadata is invalid`);
    }
    const chunks = await manager.getRepository(SessionImmutablePayloadChunkEntity).find({
        where: { payloadDigest: digest },
        order: { chunkIndex: "ASC" },
    });
    if (
        chunks.length !== metadata.chunkCount ||
        chunks.some(({ chunkIndex }, index) => chunkIndex !== index)
    ) {
        throw new Error(`Stored Session ${payloadKind} chunks are incomplete`);
    }
    const compressed = Buffer.concat(
        chunks.map(({ payloadBase64 }) => Buffer.from(payloadBase64, "base64")),
    );
    if (compressed.length !== metadata.compressedByteLength) {
        throw new Error(`Stored Session ${payloadKind} size is inconsistent`);
    }
    const uncompressed = brotliDecompressSync(compressed, {
        maxOutputLength: metadata.uncompressedByteLength,
    });
    const actualDigest = createHash("sha256")
        .update(payloadKind)
        .update("\0")
        .update(uncompressed)
        .digest("hex");
    if (uncompressed.length !== metadata.uncompressedByteLength || actualDigest !== digest) {
        throw new Error(`Stored Session ${payloadKind} digest is inconsistent`);
    }
    return JSON.parse(uncompressed.toString("utf8")) as unknown;
}

function parseGroupHistory(
    payload: unknown,
    compiledCardPolicy: CompiledCardPolicySnapshot | null,
    compiledCardPolicyDigest: string | null,
): CardId[] {
    if (!payload || typeof payload !== "object" || !("format" in payload)) {
        throw new Error("Stored Session GROUP_HISTORY payload is invalid");
    }
    const candidate = payload as Partial<GroupHistoryPayload>;
    if (candidate.format === "CARD_IDS_V1") {
        if (
            !Array.isArray(candidate.cardIds) ||
            candidate.cardIds.some((cardId) => typeof cardId !== "string")
        ) {
            throw new Error("Stored Session GROUP_HISTORY Card IDs are invalid");
        }
        return candidate.cardIds;
    }
    if (
        candidate.format !== "CARD_ID_BITSET_V1" ||
        !compiledCardPolicy ||
        !compiledCardPolicyDigest ||
        candidate.compiledCardPolicyDigest !== compiledCardPolicyDigest ||
        candidate.cardCount !== compiledCardPolicy.cards.length ||
        typeof candidate.bitsBase64 !== "string"
    ) {
        throw new Error("Stored Session GROUP_HISTORY bitset metadata is invalid");
    }
    const bits = Buffer.from(candidate.bitsBase64, "base64");
    if (bits.length !== Math.ceil(candidate.cardCount / 8)) {
        throw new Error("Stored Session GROUP_HISTORY bitset size is invalid");
    }
    return compiledCardPolicy.cards
        .filter((_, index) => (bits[index >> 3] & (1 << (index & 7))) !== 0)
        .map(([cardId]) => cardId);
}

export async function hydrateSessionImmutableState(
    manager: EntityManager,
    runtimeStateJson: string,
    digests: {
        compiledCardPolicyDigest: string | null;
        groupHistoryDigest: string | null;
    },
    normalizedSessionHistory?: GameSessionRuntimeState["sessionHistory"],
): Promise<GameSessionRuntimeState> {
    const runtime = JSON.parse(runtimeStateJson) as GameSessionRuntimeState;
    const compiledCardPolicy = digests.compiledCardPolicyDigest
        ? ((await loadImmutablePayload(
              manager,
              "COMPILED_CARD_POLICY",
              digests.compiledCardPolicyDigest,
          )) as CompiledCardPolicySnapshot)
        : runtime.compiledCardPolicy;
    const groupHistoryCardIds = digests.groupHistoryDigest
        ? parseGroupHistory(
              await loadImmutablePayload(manager, "GROUP_HISTORY", digests.groupHistoryDigest),
              compiledCardPolicy,
              digests.compiledCardPolicyDigest,
          )
        : runtime.groupHistoryCardIds;
    const sessionHistory = normalizedSessionHistory ?? runtime.sessionHistory;
    return { ...runtime, compiledCardPolicy, groupHistoryCardIds, sessionHistory };
}
