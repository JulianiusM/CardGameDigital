import fs from "node:fs";
import path from "node:path";
import type { DataSource } from "typeorm";
import {
    validateCardCatalogArtifact,
    type ValidatedCardCatalogArtifact,
} from "../../packages/card-catalog-contract";
import { applyCardCatalogSnapshot } from "../../packages/persistence/applyCardCatalogSnapshot";

export function bundledCardCatalogPath(): string {
    const packaged = path.resolve(__dirname, "../../catalog/card-catalog.json");
    if (fs.existsSync(packaged)) return packaged;
    return path.resolve(process.cwd(), "catalog/card-catalog.json");
}

export function bundledCardCatalogArtifact(
    deploymentMode: "local" | "public",
): ValidatedCardCatalogArtifact {
    const file = bundledCardCatalogPath();
    if (!fs.existsSync(file)) throw new Error(`Bundled Card catalog is missing: ${file}`);
    const artifact = validateCardCatalogArtifact(fs.readFileSync(file));
    if (
        deploymentMode === "public" &&
        (artifact.catalog.catalogId === "development" ||
            artifact.catalog.catalogVersion.startsWith("development-fixture"))
    ) {
        throw new Error("Public deployment refuses the bundled development Card catalog");
    }
    return artifact;
}

export async function applyBundledCardCatalog(
    dataSource: DataSource,
    artifact: ValidatedCardCatalogArtifact,
) {
    return applyCardCatalogSnapshot(dataSource, artifact);
}
