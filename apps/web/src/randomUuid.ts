type BrowserCrypto = {
    randomUUID?: () => string;
    getRandomValues: Crypto["getRandomValues"];
};

/** Generates a UUIDv4 on both secure origins and plain-HTTP local-network origins. */
export function randomUuidV4(source: BrowserCrypto = globalThis.crypto): string {
    if (typeof source?.randomUUID === "function") return source.randomUUID();
    if (typeof source?.getRandomValues !== "function") {
        throw new TypeError("Secure random generation is unavailable");
    }
    const bytes = source.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hexadecimal = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    return [
        hexadecimal.slice(0, 8),
        hexadecimal.slice(8, 12),
        hexadecimal.slice(12, 16),
        hexadecimal.slice(16, 20),
        hexadecimal.slice(20),
    ].join("-");
}
