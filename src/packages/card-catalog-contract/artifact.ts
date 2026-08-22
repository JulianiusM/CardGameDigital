import { createHash } from "node:crypto";
import { validateCardCatalog } from "./semanticValidation";
import type { CardCatalog } from "./schema";

export type ValidatedCardCatalogArtifact = {
    catalog: CardCatalog;
    artifactDigest: string;
    bytes: Buffer;
};

export function validateCardCatalogArtifact(bytes: Buffer): ValidatedCardCatalogArtifact {
    let input: unknown;
    try {
        input = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
        throw new Error(`Card catalog is not strict JSON: ${(error as Error).message}`);
    }
    return {
        catalog: validateCardCatalog(input),
        artifactDigest: createHash("sha256").update(bytes).digest("hex"),
        bytes,
    };
}
