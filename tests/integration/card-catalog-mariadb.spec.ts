import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entities } from "../../src/modules/database/__index__";
import { CardCatalogVersionEntity } from "../../src/modules/database/entities/card/CardCatalogVersionEntity";
import { applyCardCatalogSnapshot } from "../../src/packages/persistence/applyCardCatalogSnapshot";
import { cardCatalog, catalogArtifact } from "../support/cardCatalog";

const enabled = process.env.CARD_CATALOG_MARIADB_TEST === "1";
const database = process.env.E2E_DB_NAME ?? "";
if (enabled && !/e2e/i.test(database)) {
    throw new Error("CARD_CATALOG_MARIADB_TEST requires an E2E_DB_NAME containing 'e2e'");
}

const sources: DataSource[] = [];
function source(): DataSource {
    return new DataSource({
        type: "mariadb",
        host: process.env.E2E_DB_HOST,
        port: Number(process.env.E2E_DB_PORT ?? 3306),
        username: process.env.E2E_DB_USER,
        password: process.env.E2E_DB_PASSWORD,
        database,
        entities,
        synchronize: false,
    });
}

describe.skipIf(!enabled)("MariaDB Card catalog advisory lock", () => {
    beforeAll(async () => {
        const schema = source();
        sources.push(schema);
        await schema.initialize();
        await schema.synchronize(true);
    });

    afterAll(async () => {
        await Promise.all(
            sources.filter((item) => item.isInitialized).map((item) => item.destroy()),
        );
    });

    it("serializes concurrent startup and records a release once", async () => {
        const first = source();
        const second = source();
        sources.push(first, second);
        await Promise.all([first.initialize(), second.initialize()]);
        const artifact = catalogArtifact(cardCatalog());
        const results = await Promise.all([
            applyCardCatalogSnapshot(first, artifact),
            applyCardCatalogSnapshot(second, artifact),
        ]);
        expect(results.sort()).toEqual(["APPLIED", "UNCHANGED"]);
        expect(await first.getRepository(CardCatalogVersionEntity).count()).toBe(1);
    });
});
