import fs from "node:fs";
import path from "node:path";
import type { DataSource } from "typeorm";
import {
    validateCardCatalogArtifact,
    type ValidatedCardCatalogArtifact,
} from "../../../../../packages/card-catalog-contract";
import {
    applyCardCatalogSnapshot,
    isDevelopmentCardCatalogVersion,
} from "../../../../../packages/persistence/applyCardCatalogSnapshot";
import { resolveRuntimeAssetPath } from "../runtimeAssets";

let catalogPathForTests: string | undefined;

/** Keeps broad integration suites small while dedicated startup coverage uses production bytes. */
export function setBundledCardCatalogPathForTests(file: string): void {
    if (process.env.NODE_ENV !== "test") {
        throw new Error("The bundled Card catalog test path is available only under NODE_ENV=test");
    }
    catalogPathForTests = path.resolve(file);
}

export function bundledCardCatalogPath(): string {
    if (catalogPathForTests) return catalogPathForTests;
    return resolveRuntimeAssetPath(path.join("catalog", "card-catalog.json"));
}

export function bundledCardCatalogArtifact(
    deploymentMode: "local" | "public",
    allowDevelopmentFixture = false,
): ValidatedCardCatalogArtifact {
    const file = bundledCardCatalogPath();
    if (!fs.existsSync(file)) throw new Error(`Bundled Card catalog is missing: ${file}`);
    const artifact = validateCardCatalogArtifact(fs.readFileSync(file));
    if (
        deploymentMode === "public" &&
        !allowDevelopmentFixture &&
        isDevelopmentCardCatalogVersion(artifact.catalog.catalogVersion)
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
