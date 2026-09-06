import { createHash } from "node:crypto";
import { brotliCompress, brotliDecompress, constants } from "node:zlib";
import { promisify } from "node:util";
import { MESSAGE_KEYS } from "../localization/keys";
import { persistenceWorkLimits } from "./persistenceWorkLimits";

const compress = promisify(brotliCompress);
const decompress = promisify(brotliDecompress);
export const MAXIMUM_STORED_JSON_BYTES = 512 * 1024;
export const MAXIMUM_DECODED_JSON_BYTES = 4 * 1024 * 1024;
const INLINE_JSON_BYTES = 64 * 1024;
let activeCodecs = 0;

async function codec<T>(action: () => Promise<T>): Promise<T> {
    if (activeCodecs >= persistenceWorkLimits().storedJsonConcurrentCodecs)
        throw Object.assign(new Error(MESSAGE_KEYS.GAME_SESSION_CAPACITY_EXCEEDED), {
            code: "SESSION_CAPACITY_EXCEEDED",
            status: 429,
        });
    activeCodecs++;
    try {
        return await action();
    } finally {
        activeCodecs--;
    }
}

/** Hot settings/runtime only. No catalog or translations are passed to this codec.
 * Small records stay ordinary JSON. Larger records remain below the SQL packet budget,
 * including on MariaDB's 1 MiB configuration, without changing transport DTOs. */
export async function writeStoredJson(value: unknown): Promise<string> {
    const json = JSON.stringify(value);
    const bytes = Buffer.byteLength(json);
    if (bytes > MAXIMUM_DECODED_JSON_BYTES)
        throw new Error("Stored runtime/settings JSON exceeds supported bytes");
    if (bytes <= INLINE_JSON_BYTES) return json;
    return codec(async () => {
        const payload = await compress(Buffer.from(json), {
            params: { [constants.BROTLI_PARAM_QUALITY]: 4 },
        });
        const encoded = JSON.stringify({
            $encoding: "brotli-json/v1",
            bytes,
            digest: createHash("sha256").update(json).digest("hex"),
            payload: payload.toString("base64"),
        });
        if (Buffer.byteLength(encoded) > MAXIMUM_STORED_JSON_BYTES)
            throw new Error("Encoded runtime/settings JSON exceeds supported bytes");
        return encoded;
    });
}

export async function readStoredJson<T>(json: string): Promise<T> {
    if (Buffer.byteLength(json) > MAXIMUM_DECODED_JSON_BYTES)
        throw new Error("Stored JSON exceeds supported bytes");
    const value = JSON.parse(json);
    if (!value || typeof value !== "object" || !("$encoding" in value)) return value as T;
    if (
        value.$encoding !== "brotli-json/v1" ||
        !Number.isSafeInteger(value.bytes) ||
        value.bytes <= INLINE_JSON_BYTES ||
        value.bytes > MAXIMUM_DECODED_JSON_BYTES ||
        typeof value.digest !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.digest) ||
        typeof value.payload !== "string" ||
        Buffer.byteLength(json) > MAXIMUM_STORED_JSON_BYTES
    )
        throw new Error("Invalid stored JSON encoding");
    return codec(async () => {
        const decoded = await decompress(Buffer.from(value.payload, "base64"), {
            maxOutputLength: value.bytes,
        });
        if (
            decoded.length !== value.bytes ||
            createHash("sha256").update(decoded).digest("hex") !== value.digest
        )
            throw new Error("Invalid stored JSON digest or length");
        return JSON.parse(decoded.toString("utf8")) as T;
    });
}
