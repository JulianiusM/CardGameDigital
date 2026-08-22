import fs from "node:fs";
import path from "node:path";
import { validateCardCatalogArtifact } from "../../packages/card-catalog-contract";

const artifactPath = path.resolve(process.argv[2] ?? "catalog/card-catalog.json");
const artifact = validateCardCatalogArtifact(fs.readFileSync(artifactPath));
const activeCards = artifact.catalog.cards.filter((card) => card.lifecycle === "ACTIVE");
console.log(`Contract: ${artifact.catalog.contract}`);
console.log(`Catalog: ${artifact.catalog.catalogId} ${artifact.catalog.catalogVersion}`);
console.log(`Sequence: ${artifact.catalog.sequence}`);
console.log(`SHA-256: ${artifact.artifactDigest}`);
console.log(`Cards: ${artifact.catalog.cards.length} (${activeCards.length} active)`);
console.log(
    `Locales: ${artifact.catalog.locales.length}; default ${artifact.catalog.defaultLocale}`,
);
for (const locale of artifact.catalog.locales) {
    const localized = activeCards.filter((card) =>
        card.localizations.some((entry) => entry.locale === locale.id),
    ).length;
    const coverage = activeCards.length ? localized / activeCards.length : 1;
    console.log(
        `${locale.id}: ${localized}/${activeCards.length} (${(coverage * 100).toFixed(1)}%)`,
    );
}
