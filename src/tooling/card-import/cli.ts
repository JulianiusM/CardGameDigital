import fs from "node:fs";
import path from "node:path";
import { normalizeCards } from "./normalize";

const [
    inputFile,
    outputFile,
    catalogVersion,
    sourceName = "legacy-access-v1",
    sourceLocale = "de-DE",
] = process.argv.slice(2);
if (!inputFile || !outputFile || !catalogVersion) {
    throw new Error(
        "Usage: card-import <raw-json> <catalog-json> <catalog-version> [source-namespace] [source-locale]",
    );
}
const raw = JSON.parse(fs.readFileSync(inputFile, "utf8")) as unknown;
if (!Array.isArray(raw)) throw new Error("Raw card import must be a JSON array");
const catalog = normalizeCards(raw, sourceName, catalogVersion, new Date(), sourceLocale);
fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
const errors = catalog.issues.filter((entry) => entry.severity === "ERROR").length;
const warnings = catalog.issues.filter((entry) => entry.severity === "WARNING").length;
console.log(`Normalized ${catalog.cards.length} cards; ${errors} errors; ${warnings} warnings`);
if (errors > 0) process.exitCode = 2;
