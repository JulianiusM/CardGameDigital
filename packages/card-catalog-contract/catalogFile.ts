import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import {
    cardCatalogHeaderSchema,
    catalogCardSchema,
    type CardCatalogHeader,
    type CardCatalogCard,
} from "./schema";
import { JsonObjectKeyScanner } from "./artifact";
import { catalogSemanticValidator } from "./semanticValidation";
import { MAXIMUM_CATALOG_VALUE_BYTES } from "./contentLimits";

type JsonValue =
    | { kind: "header"; key: string; value: unknown; bytes: number }
    | { kind: "card"; value: unknown }
    | { kind: "digest"; value: string };

/** A strict top-level JSON reader that releases each Card before reading the next.
 * Object members may appear in any order. Strings, nesting, commas and duplicate
 * keys are validated; even invalid input has a bounded record allocation. */
export async function* readCatalogJson(file: string): AsyncIterable<JsonValue> {
    let state = "root";
    let key = "";
    const keys = new Set<string>();
    let allowEnd = true;
    let kind: "key" | "header" | "card" = "key";
    let depth = 0;
    let quoted = false;
    let escaped = false;
    let primitive = false;
    let parts: string[] = [];
    let bytes = 0;
    let mark = -1;
    const hash = createHash("sha256");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const append = (piece: string) => {
        bytes += Buffer.byteLength(piece);
        if (bytes > MAXIMUM_CATALOG_VALUE_BYTES)
            throw new Error("Card catalog record exceeds supported bytes");
        parts.push(piece);
    };
    const complete = (): JsonValue | null => {
        const text = parts.join("");
        const value: unknown = JSON.parse(text);
        new JsonObjectKeyScanner(text).scan();
        parts = [];
        const valueBytes = bytes;
        bytes = 0;
        mark = -1;
        if (kind === "key") {
            if (typeof value !== "string" || keys.has(value))
                throw new Error("Invalid or duplicate catalog member");
            if (!Object.hasOwn(cardCatalogHeaderSchema.shape, value) && value !== "cards")
                throw new Error("Unknown catalog member");
            key = value;
            keys.add(key);
            state = "colon";
            return null;
        }
        state = kind === "card" ? "afterCard" : "afterValue";
        if (kind === "card") return { kind: "card", value };
        return { kind: "header", key, value, bytes: valueBytes };
    };
    for await (const buffer of createReadStream(file, { highWaterMark: 64 * 1024 })) {
        hash.update(buffer);
        const segment = decoder.decode(buffer, { stream: true });
        if (state === "collect") mark = 0;
        for (let index = 0; index < segment.length; index++) {
            const character = segment[index];
            if (state === "collect") {
                if (primitive && depth === 0 && /[ \t\r\n,}\]]/.test(character)) {
                    append(segment.slice(mark, index));
                    const value = complete();
                    if (value) yield value;
                    index--;
                    continue;
                }
                if (quoted) {
                    if (escaped) escaped = false;
                    else if (character === "\\") escaped = true;
                    else if (character === '"') {
                        quoted = false;
                        if (depth === 0) {
                            append(segment.slice(mark, index + 1));
                            const value = complete();
                            if (value) yield value;
                        }
                    }
                    continue;
                }
                if (character === '"') quoted = true;
                else if (character === "{" || character === "[") {
                    depth++;
                    if (depth > 64) throw new Error("Card catalog nesting is too deep");
                } else if (character === "}" || character === "]") {
                    depth--;
                    if (depth === 0) {
                        append(segment.slice(mark, index + 1));
                        const value = complete();
                        if (value) yield value;
                    }
                }
                continue;
            }
            if (/[ \t\r\n]/.test(character)) continue;
            if (state === "root") {
                if (character !== "{") throw new Error("Catalog must be an object");
                state = "key";
                continue;
            }
            if (state === "key" && character === "}" && allowEnd) {
                state = "done";
                continue;
            }
            if (state === "colon") {
                if (character !== ":") throw new Error("Missing catalog member colon");
                state = "value";
                continue;
            }
            if (state === "value" && key === "cards") {
                if (character !== "[") throw new Error("Catalog Cards must be an array");
                state = "card";
                allowEnd = true;
                continue;
            }
            if (state === "card" && character === "]" && allowEnd) {
                state = "afterValue";
                continue;
            }
            if (state === "afterValue" || state === "afterCard") {
                if (character === ",") {
                    state = state === "afterCard" ? "card" : "key";
                    allowEnd = false;
                    continue;
                }
                if (state === "afterValue" && character === "}") {
                    state = "done";
                    continue;
                }
                if (state === "afterCard" && character === "]") {
                    state = "afterValue";
                    continue;
                }
                throw new Error("Invalid catalog delimiter");
            }
            if (state === "done") throw new Error("Content follows the catalog object");
            if (state === "key" && character !== '"')
                throw new Error("Invalid catalog member name");
            if (state === "card" && character !== "{") throw new Error("A Card must be an object");
            kind = "header";
            if (state === "key") kind = "key";
            else if (state === "card") kind = "card";
            state = "collect";
            mark = index;
            quoted = character === '"';
            escaped = false;
            depth = character === "{" || character === "[" ? 1 : 0;
            primitive = !quoted && depth === 0;
        }
        if (state === "collect") append(segment.slice(mark));
    }
    decoder.decode();
    if (state !== "done" || !keys.has("cards")) throw new Error("Incomplete Card catalog");
    yield { kind: "digest", value: hash.digest("hex") };
}

export type CatalogFileArtifact = {
    file: string;
    catalog: CardCatalogHeader;
    cardCount: number;
    artifactDigest: string;
};

export async function validateCardCatalogFile(file: string): Promise<CatalogFileArtifact> {
    const header: Record<string, unknown> = {};
    let headerBytes = 0;
    let cardCount = 0;
    let artifactDigest = "";
    // A temporary UUID-only uniqueness index spills to disk with a 2 MiB cache.
    // SQLite deletes its anonymous database on close. No text is copied to it.
    const ids = new Database("");
    try {
        ids.pragma("cache_size = -2048");
        ids.pragma("journal_mode = OFF");
        ids.exec("CREATE TABLE ids (id BLOB PRIMARY KEY) WITHOUT ROWID; BEGIN");
        const insert = ids.prepare("INSERT OR IGNORE INTO ids VALUES (?)");
        for await (const value of readCatalogJson(file)) {
            if (value.kind === "header") {
                headerBytes += value.bytes;
                if (headerBytes > MAXIMUM_CATALOG_VALUE_BYTES)
                    throw new Error("Catalog header exceeds supported bytes");
                header[value.key] = value.value;
            } else if (value.kind === "card") {
                const card = catalogCardSchema.parse(value.value);
                if (insert.run(Buffer.from(card.id.replaceAll("-", ""), "hex")).changes !== 1)
                    throw new Error("Duplicate Card UUID in catalog");
                cardCount++;
            } else artifactDigest = value.value;
        }
    } finally {
        ids.close();
    }
    if (!cardCount) throw new Error("Catalog requires Cards");
    const artifact = {
        file,
        catalog: cardCatalogHeaderSchema.parse(header),
        cardCount,
        artifactDigest,
    };
    const validator = catalogSemanticValidator(artifact.catalog);
    let index = 0;
    if (validator.issues.length) throw new Error(JSON.stringify(validator.issues.slice(0, 5)));
    for await (const card of catalogFileCards(artifact)) {
        validator.validateCard(card, index++);
        if (validator.issues.length) throw new Error(JSON.stringify(validator.issues.slice(0, 5)));
    }
    return artifact;
}

export async function* catalogFileCards(
    artifact: CatalogFileArtifact,
): AsyncIterable<CardCatalogCard> {
    for await (const value of readCatalogJson(artifact.file)) {
        if (value.kind === "card") yield catalogCardSchema.parse(value.value);
        if (value.kind === "digest" && value.value !== artifact.artifactDigest)
            throw new Error("Catalog bytes changed after validation");
    }
}
