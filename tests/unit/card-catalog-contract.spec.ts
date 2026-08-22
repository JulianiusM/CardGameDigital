import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
    CARD_CATALOG_CARD_TYPES,
    CARD_CATALOG_DARE_TYPES,
    CARD_CATALOG_OPERATIONAL_FLAGS,
    CARD_CATALOG_QUESTION_CATEGORIES,
    validateCardCatalog,
} from "../../src/packages/card-catalog-contract";
import { cardCatalog } from "../support/cardCatalog";

describe("game-card-catalog/v1 contract", () => {
    it("keeps the producer JSON Schema enums aligned with the runtime contract", () => {
        const schema = JSON.parse(
            fs.readFileSync(
                "src/packages/card-catalog-contract/card-catalog-v1.schema.json",
                "utf8",
            ),
        );
        const cardProperties = schema.properties.cards.items.properties;
        expect(cardProperties.cardType.enum).toEqual(CARD_CATALOG_CARD_TYPES);
        expect(cardProperties.operationalFlags.items.enum).toEqual(CARD_CATALOG_OPERATIONAL_FLAGS);
        expect(schema.$defs.questionCategory.enum).toEqual(CARD_CATALOG_QUESTION_CATEGORIES);
        expect(schema.$defs.dareType.enum).toEqual(CARD_CATALOG_DARE_TYPES);
    });

    it("accepts a multilingual catalog including a UI-unsupported Card locale", () => {
        const catalog = cardCatalog({
            locales: [
                { id: "de-DE", nativeName: "Deutsch", active: true },
                { id: "fr-FR", nativeName: "Français", active: true },
            ],
            questionCategories: [
                {
                    id: "CAT_EVERYDAY",
                    localizations: [
                        { locale: "de-DE", label: "Alltag", description: null },
                        { locale: "fr-FR", label: "Quotidien", description: null },
                    ],
                },
            ],
            dareTypes: [],
        });
        catalog.cards[0].localizations = [
            { locale: "de-DE", text: "Eine Frage" },
            { locale: "fr-FR", text: "Une question" },
        ];
        expect(validateCardCatalog(catalog).locales[1].id).toBe("fr-FR");
    });

    it("rejects unknown fields and duplicate immutable identities", () => {
        expect(() => validateCardCatalog({ ...cardCatalog(), legacySource: "Access" })).toThrow();
        const duplicateCard = cardCatalog();
        duplicateCard.cards.push({ ...duplicateCard.cards[0] });
        expect(() => validateCardCatalog(duplicateCard)).toThrow("duplicate");
        const duplicateLocale = cardCatalog();
        duplicateLocale.locales.push({ ...duplicateLocale.locales[0] });
        expect(() => validateCardCatalog(duplicateLocale)).toThrow("duplicate");
        const duplicateLocalization = cardCatalog();
        duplicateLocalization.cards[0].localizations.push({
            ...duplicateLocalization.cards[0].localizations[0],
        });
        expect(() => validateCardCatalog(duplicateLocalization)).toThrow("duplicate");
    });

    it("rejects unresolved, non-canonical, or inactive locale references", () => {
        const unknown = cardCatalog();
        unknown.cards[0].localizations.push({ locale: "fr-FR", text: "Une question" });
        expect(() => validateCardCatalog(unknown)).toThrow("undeclared locale");
        const nonCanonical = cardCatalog();
        nonCanonical.locales[0].id = "de-de";
        expect(() => validateCardCatalog(nonCanonical)).toThrow("canonical BCP 47");
        const inactiveDefault = cardCatalog();
        inactiveDefault.locales[0].active = false;
        expect(() => validateCardCatalog(inactiveDefault)).toThrow("active locale");
    });

    it("requires default text, same-locale taxonomy, and valid card metadata", () => {
        const missingDefault = cardCatalog();
        missingDefault.cards[0].localizations = [{ locale: "en-GB", text: "A question" }];
        expect(() => validateCardCatalog(missingDefault)).toThrow("default-locale text");
        const missingLabel = cardCatalog();
        missingLabel.questionCategories[0].localizations = [
            { locale: "de-DE", label: "Alltag", description: null },
        ];
        expect(() => validateCardCatalog(missingLabel)).toThrow("missing en-GB label");
        const invalidType = cardCatalog();
        invalidType.cards[0].dareTypeId = "DARE_SILLY";
        expect(() => validateCardCatalog(invalidType)).toThrow("Question taxonomy");
        const whitespace = cardCatalog();
        whitespace.cards[0].localizations[0].text = " padded ";
        expect(() => validateCardCatalog(whitespace)).toThrow("leading/trailing whitespace");
    });
});
