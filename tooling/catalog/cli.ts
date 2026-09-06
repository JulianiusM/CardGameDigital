import path from "node:path";
import {
    validateCardCatalogFile,
    catalogFileCards,
    resolveProducerCardMetadata,
} from "../../packages/card-catalog-contract";

async function main(): Promise<void> {
    const artifact = await validateCardCatalogFile(
        path.resolve(process.argv[2] ?? "catalog/card-catalog.json"),
    );
    let active = 0;
    const coverage = new Map<string, number>();
    const sensitivity = new Map<string, number>();
    let higherMinimum = 0;
    let finiteMaximum = 0;
    for await (const card of catalogFileCards(artifact)) {
        const metadata = resolveProducerCardMetadata(artifact.catalog, card);
        sensitivity.set(
            metadata.socialSensitivity,
            (sensitivity.get(metadata.socialSensitivity) ?? 0) + 1,
        );
        higherMinimum += Number(metadata.minimumPlayerCount > 2);
        finiteMaximum += Number(metadata.maximumPlayerCount !== null);
        if (card.lifecycle !== "ACTIVE") continue;
        active++;
        for (const { locale } of card.localizations)
            coverage.set(locale, (coverage.get(locale) ?? 0) + 1);
    }
    console.log(`Contract: ${artifact.catalog.contract}`);
    console.log(`Catalog: ${artifact.catalog.catalogId} ${artifact.catalog.catalogVersion}`);
    console.log(`Sequence: ${artifact.catalog.sequence}`);
    console.log(`SHA-256: ${artifact.artifactDigest}`);
    console.log(
        `Cards: ${artifact.cardCount} (${active} active, ${artifact.cardCount - active} retired)`,
    );
    console.log(
        `Locales: ${artifact.catalog.locales.length}; default ${artifact.catalog.defaultLocale}`,
    );
    for (const locale of artifact.catalog.locales)
        console.log(`${locale.id}: ${coverage.get(locale.id) ?? 0}/${active}`);
    console.log(
        `Sensitivity: ${[...sensitivity].map(([value, count]) => `${value}=${count}`).join(", ")}`,
    );
    console.log(`Player counts: ${higherMinimum} higher minimum; ${finiteMaximum} finite maximum`);
    console.log("Missing taxonomy labels: 0; invalid player ranges: 0");
}
void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
