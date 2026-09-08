import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entities } from "../../apps/server/src/modules/database/__index__";
import { CardCatalogVersionEntity } from "../../packages/persistence/entities/card/CardCatalogVersionEntity";
import { applyCardCatalogSnapshot } from "../../packages/persistence/applyCardCatalogSnapshot";
import { cardCatalog, catalogArtifact } from "../support/cardCatalog";
import { loadMariaTestProfile, resetMariaTestDatabase } from "../support/mariaDb";

const enabled = process.env.CARD_CATALOG_MARIADB_TEST === "1";
const profile = loadMariaTestProfile("", "E2E");
if (enabled && !profile) {
    throw new Error("CARD_CATALOG_MARIADB_TEST requires a disposable E2E_DB_* profile");
}

const sources: DataSource[] = [];
function source(): DataSource {
    if (!profile) throw new Error("The MariaDB catalog suite requires an E2E database profile");
    return new DataSource({
        type: "mariadb",
        host: profile.host,
        port: profile.port,
        username: profile.user,
        password: profile.password,
        database: profile.database,
        entities,
        synchronize: false,
    });
}

describe.skipIf(!enabled)("MariaDB Card catalog advisory lock", () => {
    beforeAll(async () => {
        if (!profile) throw new Error("The MariaDB catalog suite requires an E2E database profile");
        await resetMariaTestDatabase(profile);
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
