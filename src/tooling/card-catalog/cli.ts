import fs from "node:fs";
import path from "node:path";
import {
    resolveProducerCardMetadata,
    validateCardCatalogArtifact,
} from "../../packages/card-catalog-contract";

const artifactPath = path.resolve(process.argv[2] ?? "catalog/card-catalog.json");
const artifact = validateCardCatalogArtifact(fs.readFileSync(artifactPath));
const activeCards = artifact.catalog.cards.filter((card) => card.lifecycle === "ACTIVE");
const retiredCards = artifact.catalog.cards.length - activeCards.length;
console.log(`Contract: ${artifact.catalog.contract}`);
console.log(`Catalog: ${artifact.catalog.catalogId} ${artifact.catalog.catalogVersion}`);
console.log(`Sequence: ${artifact.catalog.sequence}`);
console.log(`SHA-256: ${artifact.artifactDigest}`);
console.log(
    `Cards: ${artifact.catalog.cards.length} (${activeCards.length} active, ${retiredCards} retired)`,
);
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
console.log("Missing taxonomy labels: 0");
const resolved = artifact.catalog.cards.map((card) => ({
    card,
    metadata: resolveProducerCardMetadata(artifact.catalog, card),
}));
const sensitivityDistribution = new Map<string, number>();
for (const { metadata } of resolved) {
    sensitivityDistribution.set(
        metadata.socialSensitivity,
        (sensitivityDistribution.get(metadata.socialSensitivity) ?? 0) + 1,
    );
}
console.log(
    `Sensitivity: ${[...sensitivityDistribution].map(([value, count]) => `${value}=${count}`).join(", ")}`,
);
console.log(
    `Sensitivity inheritance: ${
        artifact.catalog.cards.filter((card) => {
            if (card.socialSensitivity !== undefined) return false;
            if (card.cardType === "DARE") return card.dareTypeId !== null;
            return card.questionCategoryId !== null;
        }).length
    } taxonomy; ${artifact.catalog.cards.filter((card) => card.socialSensitivity !== undefined).length} Card overrides`,
);
console.log(
    `Player counts: ${resolved.filter(({ metadata }) => metadata.minimumPlayerCount > 2).length} higher minimum; ${resolved.filter(({ metadata }) => metadata.maximumPlayerCount !== null).length} finite maximum`,
);
console.log("Invalid player ranges: 0");
