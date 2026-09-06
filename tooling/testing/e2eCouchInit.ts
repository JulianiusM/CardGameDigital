import fs from "node:fs";
import path from "node:path";
import { DataSource } from "typeorm";
import { validateCardCatalogFile } from "../../packages/card-catalog-contract";
import { applyCardCatalogSnapshot } from "../../packages/persistence/applyCardCatalogSnapshot";
import { dataSourceOptions } from "../../apps/server/src/modules/database/dataSource";
import { resolveSettings } from "../../apps/server/src/modules/settings";

const dbFile = path.resolve(process.env.COUCH_E2E_DB_FILE ?? ".tmp/couch-e2e.sqlite");
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
fs.rmSync(dbFile, { force: true });
const settings = resolveSettings({ DB_FILE: dbFile }, "/dev/null");
const source = new DataSource(dataSourceOptions(settings));

async function main() {
    await source.initialize();
    await source.runMigrations({ transaction: "all" });
    await applyCardCatalogSnapshot(
        source,
        await validateCardCatalogFile(path.resolve("catalog/card-catalog.json")),
    );
    await source.destroy();
    console.log(`Couch E2E database initialized at ${dbFile}`);
}
main().catch(async (error) => {
    if (source.isInitialized) await source.destroy();
    console.error(error);
    process.exit(1);
});
