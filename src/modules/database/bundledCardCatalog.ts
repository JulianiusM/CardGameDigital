import fs from "node:fs";
import path from "node:path";
import type { DataSource } from "typeorm";
import { validateCardCatalogArtifact } from "../../packages/card-catalog-contract";
import { applyCardCatalogSnapshot } from "../../packages/persistence/applyCardCatalogSnapshot";

export function bundledCardCatalogPath(): string {
    const packaged = path.resolve(__dirname, "../../catalog/card-catalog.json");
    if (fs.existsSync(packaged)) return packaged;
    return path.resolve(process.cwd(), "catalog/card-catalog.json");
}

export async function applyBundledCardCatalog(dataSource: DataSource) {
    const file = bundledCardCatalogPath();
    if (!fs.existsSync(file)) throw new Error(`Bundled Card catalog is missing: ${file}`);
    const artifact = validateCardCatalogArtifact(fs.readFileSync(file));
    return applyCardCatalogSnapshot(dataSource, artifact);
}
