import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    catalogFileCards,
    readCatalogJson,
    validateCardCatalogFile,
} from "../../packages/card-catalog-contract/catalogFile";
import { cardCatalog } from "../support/cardCatalog";

let directory: string | undefined;
async function file(bytes: string | Buffer) {
    directory ??= await fs.mkdtemp(path.join(os.tmpdir(), "stream-catalog-"));
    const name = path.join(directory, "catalog.json");
    await fs.writeFile(name, bytes);
    return name;
}
async function consume(stream: AsyncIterable<unknown>) {
    for await (const _value of stream) {
        /* consume without retaining records */
    }
}
afterEach(async () => {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    directory = undefined;
});

describe("bounded catalog file reader", () => {
    it("accepts reordered members and UTF-8/escaped strings across stream chunks", async () => {
        const input = cardCatalog();
        input.cards[0].localizations[0].text = 'A \\" quote, newline\n and 日本語 😀';
        const { cards, ...header } = input;
        const bytes = " ".repeat(65530) + JSON.stringify({ cards, ...header });
        const artifact = await validateCardCatalogFile(await file(bytes));
        expect(artifact.cardCount).toBe(1);
        expect(artifact.catalog).not.toHaveProperty("cards");
        let count = 0;
        for await (const card of catalogFileCards(artifact)) {
            count++;
            expect(card.localizations[0].text).toBe(cards[0].localizations[0].text);
        }
        expect(count).toBe(1);
    });

    it.each([
        '{"cards":[],}',
        '{"cards":[{},]}',
        '{"cards":[] "sequence":1}',
        '{"cards":[],"cards":[]}',
        '{"cards":[{"id":"a","id":"b"}]}',
        '{"cards":[]} null',
        '{"cards":[]',
        '{"cards":[]}\u00a0',
    ])("rejects invalid or ambiguous JSON: %s", async (bytes) => {
        await expect(consume(readCatalogJson(await file(bytes)))).rejects.toThrow();
    });

    it("rejects duplicate UUIDs separated by a page without copying Card text into an index", async () => {
        const input = cardCatalog();
        const first = input.cards[0];
        input.cards = Array.from({ length: 258 }, (_, i) => ({
            ...first,
            id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        }));
        input.cards.push(input.cards[0]);
        await expect(validateCardCatalogFile(await file(JSON.stringify(input)))).rejects.toThrow(
            "Duplicate Card UUID",
        );
    });

    it("rejects invalid UTF-8 and oversized individual text before installation", async () => {
        await expect(
            consume(readCatalogJson(await file(Buffer.from([123, 255, 125])))),
        ).rejects.toThrow();
        const input = cardCatalog();
        input.cards[0].localizations[0].text = "界".repeat(3000);
        await expect(validateCardCatalogFile(await file(JSON.stringify(input)))).rejects.toThrow(
            "UTF-8 text bytes",
        );
    });

    it("detects changed bytes between validation and installation", async () => {
        const name = await file(JSON.stringify(cardCatalog()));
        const artifact = await validateCardCatalogFile(name);
        await fs.appendFile(name, " ");
        await expect(consume(catalogFileCards(artifact))).rejects.toThrow(
            "changed after validation",
        );
    });
});
