import type { CardCatalogHeader, CardCatalogCard } from "./schema";
import { CARD_TYPES } from "../game-core";
import { cardCatalogSchema, resolveProducerCardMetadata, type CardCatalog } from "./schema";

export type CatalogSemanticIssue = { path: string; message: string };

function duplicates(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const duplicate = new Set<string>();
    for (const value of values) {
        if (seen.has(value)) duplicate.add(value);
        seen.add(value);
    }
    return [...duplicate].sort((left, right) => left.localeCompare(right));
}

function canonicalLocale(locale: string): string | null {
    try {
        return Intl.getCanonicalLocales(locale)[0] ?? null;
    } catch {
        return null;
    }
}

function addDuplicates(issues: CatalogSemanticIssue[], path: string, values: readonly string[]) {
    for (const value of duplicates(values)) issues.push({ path, message: `duplicate '${value}'` });
}

export function catalogSemanticIssues(catalog: CardCatalog): CatalogSemanticIssue[] {
    const validator = catalogSemanticValidator(catalog);
    addDuplicates(
        validator.issues,
        "cards",
        catalog.cards.map((card) => card.id),
    );
    catalog.cards.forEach(validator.validateCard);
    return validator.issues;
}

export function catalogSemanticValidator(catalog: CardCatalogHeader) {
    const issues: CatalogSemanticIssue[] = [];
    addDuplicates(
        issues,
        "locales",
        catalog.locales.map((locale) => locale.id),
    );
    addDuplicates(
        issues,
        "taxonomy.questionCategories",
        catalog.taxonomy.questionCategories.map((category) => category.id),
    );
    addDuplicates(
        issues,
        "taxonomy.dareTypes",
        catalog.taxonomy.dareTypes.map((type) => type.id),
    );

    const localeIds = new Set(catalog.locales.map((locale) => locale.id));
    for (const [index, locale] of catalog.locales.entries()) {
        const canonical = canonicalLocale(locale.id);
        if (!canonical || canonical !== locale.id) {
            issues.push({ path: `locales.${index}.id`, message: "must be a canonical BCP 47 tag" });
        }
    }
    const defaultLocale = catalog.locales.find((locale) => locale.id === catalog.defaultLocale);
    if (!defaultLocale?.active) {
        issues.push({ path: "defaultLocale", message: "must reference an active locale" });
    }

    const questionCategories = new Map(
        catalog.taxonomy.questionCategories.map((category) => [category.id, category]),
    );
    const dareTypes = new Map(catalog.taxonomy.dareTypes.map((type) => [type.id, type]));
    validateTaxonomyLocalizations();
    const taxonomyLocales = new Map(
        [...catalog.taxonomy.questionCategories, ...catalog.taxonomy.dareTypes].map((taxonomy) => [
            taxonomy.id,
            new Set(taxonomy.localizations.map(({ locale }) => locale)),
        ]),
    );

    function validateCard(card: CardCatalogCard, index: number) {
        const path = `cards.${index}.id(${card.id})`;
        addDuplicates(
            issues,
            `${path}.localizations`,
            card.localizations.map((item) => item.locale),
        );
        addDuplicates(issues, `${path}.operationalFlags`, card.operationalFlags);
        validateCardLocales(card, path);
        if (
            card.lifecycle === "ACTIVE" &&
            !card.localizations.some((entry) => entry.locale === catalog.defaultLocale)
        ) {
            issues.push({ path, message: "active Card requires default-locale text" });
        }
        validateCardTaxonomy(card, path);
        if (!card.repeatableInSession && card.repeatCooldown !== 0) {
            issues.push({
                path: `${path}.repeatCooldown`,
                message: "must be 0 when repeatableInSession is false",
            });
        }
        const resolved = resolveProducerCardMetadata(catalog, card);
        if (
            resolved.maximumPlayerCount !== null &&
            resolved.maximumPlayerCount < resolved.minimumPlayerCount
        ) {
            issues.push({
                path,
                message: "resolved maximumPlayerCount must be null or at least minimumPlayerCount",
            });
        }
        validateCardTaxonomyLabels(card, path);
    }
    return { issues, validateCard };

    function validateCardLocales(card: CardCatalog["cards"][number], path: string) {
        for (const localization of card.localizations) {
            if (!localeIds.has(localization.locale)) {
                issues.push({
                    path: `${path}.localizations`,
                    message: `references undeclared locale '${localization.locale}'`,
                });
            }
        }
    }

    function validateCardTaxonomyLabels(card: CardCatalog["cards"][number], path: string) {
        const references = [
            [
                card.questionCategoryId,
                card.questionCategoryId
                    ? questionCategories.get(card.questionCategoryId)
                    : undefined,
            ],
            [
                card.dareAffinityCategoryId,
                card.dareAffinityCategoryId
                    ? questionCategories.get(card.dareAffinityCategoryId)
                    : undefined,
            ],
            [card.dareTypeId, card.dareTypeId ? dareTypes.get(card.dareTypeId) : undefined],
        ] as const;
        for (const localization of card.localizations) {
            for (const [id, taxonomy] of references) {
                if (!id) continue;
                if (!taxonomyLocales.get(id as never)?.has(localization.locale)) {
                    issues.push({
                        path,
                        message: `missing ${localization.locale} label for '${id}'`,
                    });
                }
            }
        }
    }

    function validateCardTaxonomy(card: CardCatalog["cards"][number], path: string) {
        if (card.cardType === CARD_TYPES.QUESTION) {
            if (!card.questionCategoryId || card.dareTypeId || card.dareAffinityCategoryId) {
                issues.push({ path, message: "Question taxonomy is inconsistent" });
            }
            if (card.questionCategoryId && !questionCategories.has(card.questionCategoryId)) {
                issues.push({ path, message: `references missing '${card.questionCategoryId}'` });
            }
        } else if (card.cardType === CARD_TYPES.DARE) {
            if (card.questionCategoryId || !card.dareTypeId) {
                issues.push({ path, message: "Dare taxonomy is inconsistent" });
            }
            if (card.dareTypeId && !dareTypes.has(card.dareTypeId)) {
                issues.push({ path, message: `references missing '${card.dareTypeId}'` });
            }
        } else if (card.dareTypeId || card.dareAffinityCategoryId) {
            issues.push({ path, message: "Conversation taxonomy is inconsistent" });
        }
        validateCardAffinity(card, path);
    }

    function validateCardAffinity(card: CardCatalog["cards"][number], path: string) {
        if (
            card.questionCategoryId &&
            card.cardType === CARD_TYPES.CONVERSATION_META &&
            !questionCategories.has(card.questionCategoryId)
        ) {
            issues.push({ path, message: `references missing '${card.questionCategoryId}'` });
        }
        if (card.dareAffinityCategoryId && !questionCategories.has(card.dareAffinityCategoryId)) {
            issues.push({
                path,
                message: `references missing '${card.dareAffinityCategoryId}'`,
            });
        }
    }

    function validateTaxonomyLocalizations() {
        for (const [collectionName, collection] of [
            ["taxonomy.questionCategories", catalog.taxonomy.questionCategories],
            ["taxonomy.dareTypes", catalog.taxonomy.dareTypes],
        ] as const) {
            for (const [index, taxonomy] of collection.entries()) {
                const taxonomyPath = `${collectionName}.${index}.id(${taxonomy.id})`;
                addDuplicates(
                    issues,
                    `${taxonomyPath}.localizations`,
                    taxonomy.localizations.map((entry) => entry.locale),
                );
                for (const localization of taxonomy.localizations) {
                    if (!localeIds.has(localization.locale)) {
                        issues.push({
                            path: `${taxonomyPath}.localizations`,
                            message: `references undeclared locale '${localization.locale}'`,
                        });
                    }
                }
            }
        }
    }
}

export function validateCardCatalog(input: unknown): CardCatalog {
    const catalog = cardCatalogSchema.parse(input);
    const issues = catalogSemanticIssues(catalog);
    if (issues.length) {
        const details = issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
        throw new Error(`Card catalog semantic validation failed:\n${details}`);
    }
    return catalog;
}
