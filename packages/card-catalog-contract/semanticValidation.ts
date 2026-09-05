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
    return [...duplicate].sort();
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
    const issues: CatalogSemanticIssue[] = [];
    addDuplicates(
        issues,
        "locales",
        catalog.locales.map((locale) => locale.id),
    );
    addDuplicates(
        issues,
        "cards",
        catalog.cards.map((card) => card.id),
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

    for (const [index, card] of catalog.cards.entries()) {
        const path = `cards.${index}.id(${card.id})`;
        addDuplicates(
            issues,
            `${path}.localizations`,
            card.localizations.map((item) => item.locale),
        );
        addDuplicates(issues, `${path}.operationalFlags`, card.operationalFlags);
        for (const localization of card.localizations) {
            if (!localeIds.has(localization.locale)) {
                issues.push({
                    path: `${path}.localizations`,
                    message: `references undeclared locale '${localization.locale}'`,
                });
            }
        }
        if (
            card.lifecycle === "ACTIVE" &&
            !card.localizations.some((entry) => entry.locale === catalog.defaultLocale)
        ) {
            issues.push({ path, message: "active Card requires default-locale text" });
        }
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
        for (const localization of card.localizations) {
            if (card.questionCategoryId) {
                const taxonomy = questionCategories.get(card.questionCategoryId);
                if (!taxonomy?.localizations.some((item) => item.locale === localization.locale)) {
                    issues.push({
                        path,
                        message: `missing ${localization.locale} label for '${card.questionCategoryId}'`,
                    });
                }
            }
            if (card.dareAffinityCategoryId) {
                const taxonomy = questionCategories.get(card.dareAffinityCategoryId);
                if (!taxonomy?.localizations.some((item) => item.locale === localization.locale)) {
                    issues.push({
                        path,
                        message: `missing ${localization.locale} label for '${card.dareAffinityCategoryId}'`,
                    });
                }
            }
            if (card.dareTypeId) {
                const taxonomy = dareTypes.get(card.dareTypeId);
                if (!taxonomy?.localizations.some((item) => item.locale === localization.locale)) {
                    issues.push({
                        path,
                        message: `missing ${localization.locale} label for '${card.dareTypeId}'`,
                    });
                }
            }
        }
    }
    return issues;
}

export function validateCardCatalog(input: unknown): CardCatalog {
    const catalog = cardCatalogSchema.parse(input);
    const issues = catalogSemanticIssues(catalog);
    if (issues.length) {
        throw new Error(
            `Card catalog semantic validation failed:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`,
        );
    }
    return catalog;
}
