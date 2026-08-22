import {
    CARD_CATALOG_CONTRACT,
    type CardCatalog,
    validateCardCatalogArtifact,
} from "../../src/packages/card-catalog-contract";

export function cardCatalog(overrides: Partial<CardCatalog> = {}): CardCatalog {
    return {
        contract: CARD_CATALOG_CONTRACT,
        catalogId: "test-global",
        sequence: 1,
        catalogVersion: "test-1",
        generatedAt: "2026-08-22T00:00:00.000Z",
        defaultLocale: "de-DE",
        locales: [
            { id: "de-DE", nativeName: "Deutsch", active: true },
            { id: "en-GB", nativeName: "English", active: true },
        ],
        questionCategories: [
            {
                id: "CAT_EVERYDAY",
                localizations: [
                    { locale: "de-DE", label: "Alltag", description: null },
                    { locale: "en-GB", label: "Everyday", description: null },
                ],
            },
        ],
        dareTypes: [
            {
                id: "DARE_SILLY",
                localizations: [
                    { locale: "de-DE", label: "Blödsinn", description: null },
                    { locale: "en-GB", label: "Silly", description: null },
                ],
            },
        ],
        cards: [
            {
                id: "10000000-0000-4000-8000-000000000001",
                lifecycle: "ACTIVE",
                cardType: "QUESTION",
                yesNoAnswerPossible: false,
                questionCategoryId: "CAT_EVERYDAY",
                dareTypeId: null,
                dareAffinityCategoryId: null,
                intensity: 2,
                alwaysEligible: false,
                repeatableInSession: false,
                repeatCooldown: 0,
                weight: 1,
                operationalFlags: [],
                localizations: [
                    { locale: "de-DE", text: "Eine Frage" },
                    { locale: "en-GB", text: "A question" },
                ],
            },
        ],
        ...overrides,
    };
}

export function catalogArtifact(catalog: CardCatalog) {
    return validateCardCatalogArtifact(Buffer.from(JSON.stringify(catalog)));
}
