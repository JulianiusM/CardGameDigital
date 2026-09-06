import { createHash } from "node:crypto";
import { validateCardCatalog } from "./semanticValidation";
import type { CardCatalog } from "./schema";

export type ValidatedCardCatalogArtifact = {
    catalog: CardCatalog;
    artifactDigest: string;
    bytes: Buffer;
};

export class JsonObjectKeyScanner {
    private offset = 0;

    constructor(private readonly source: string) {}

    scan(): void {
        this.skipWhitespace();
        this.readValue("$");
        this.skipWhitespace();
    }

    private readValue(path: string): void {
        this.skipWhitespace();
        const token = this.source[this.offset];
        if (token === "{") {
            this.readObject(path);
            return;
        }
        if (token === "[") {
            this.readArray(path);
            return;
        }
        if (token === '"') {
            this.readString();
            return;
        }
        this.readPrimitive();
    }

    private readObject(path: string): void {
        this.offset++;
        this.skipWhitespace();
        const keys = new Set<string>();
        if (this.source[this.offset] === "}") {
            this.offset++;
            return;
        }
        while (this.offset < this.source.length) {
            const key = this.readString();
            if (keys.has(key)) {
                throw new Error(`Card catalog contains duplicate object key '${key}' at ${path}`);
            }
            keys.add(key);
            this.skipWhitespace();
            this.offset++;
            this.readValue(`${path}.${key}`);
            this.skipWhitespace();
            const delimiter = this.source[this.offset++];
            if (delimiter === "}") return;
            this.skipWhitespace();
        }
    }

    private readArray(path: string): void {
        this.offset++;
        this.skipWhitespace();
        if (this.source[this.offset] === "]") {
            this.offset++;
            return;
        }
        let index = 0;
        while (this.offset < this.source.length) {
            this.readValue(`${path}[${index}]`);
            index++;
            this.skipWhitespace();
            const delimiter = this.source[this.offset++];
            if (delimiter === "]") return;
            this.skipWhitespace();
        }
    }

    private readString(): string {
        const start = this.offset;
        this.offset++;
        while (this.offset < this.source.length) {
            const character = this.source[this.offset++];
            if (character === "\\") {
                this.offset++;
                continue;
            }
            if (character === '"') {
                return JSON.parse(this.source.slice(start, this.offset)) as string;
            }
        }
        return "";
    }

    private readPrimitive(): void {
        while (this.offset < this.source.length) {
            const character = this.source[this.offset];
            if (character === "," || character === "]" || character === "}" || /\s/.test(character))
                return;
            this.offset++;
        }
    }

    private skipWhitespace(): void {
        while (/\s/.test(this.source[this.offset] ?? "")) this.offset++;
    }
}

export function validateCardCatalogArtifact(bytes: Buffer): ValidatedCardCatalogArtifact {
    let input: unknown;
    try {
        const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        input = JSON.parse(source);
        new JsonObjectKeyScanner(source).scan();
    } catch (error) {
        throw new Error(`Card catalog is not strict JSON: ${(error as Error).message}`);
    }
    return {
        catalog: validateCardCatalog(input),
        artifactDigest: createHash("sha256").update(bytes).digest("hex"),
        bytes,
    };
}
