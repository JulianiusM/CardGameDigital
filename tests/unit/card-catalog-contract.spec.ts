import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
    CARD_CATALOG_CARD_TYPES,
    CARD_CATALOG_DARE_TYPES,
    CARD_CATALOG_OPERATIONAL_FLAGS,
    CARD_CATALOG_QUESTION_CATEGORIES,
    CARD_CATALOG_SOCIAL_SENSITIVITIES,
    resolveProducerCardMetadata,
    validateCardCatalog,
    validateCardCatalogArtifact,
} from "../../packages/card-catalog-contract";
import { cardCatalog } from "../support/cardCatalog";

describe("game-card-catalog/v2 contract", () => {
    it("keeps the producer JSON Schema enums aligned with the runtime contract", () => {
        const schema = JSON.parse(
            fs.readFileSync("packages/card-catalog-contract/card-catalog-v2.schema.json", "utf8"),
        );
        const cardProperties = schema.$defs.card.properties;
        expect(cardProperties.cardType.enum).toEqual(CARD_CATALOG_CARD_TYPES);
        expect(schema.$defs.operationalFlag.enum).toEqual(CARD_CATALOG_OPERATIONAL_FLAGS);
        expect(schema.$defs.questionCategoryId.enum).toEqual(CARD_CATALOG_QUESTION_CATEGORIES);
        expect(schema.$defs.dareTypeId.enum).toEqual(CARD_CATALOG_DARE_TYPES);
        expect(schema.$defs.socialSensitivity.enum).toEqual(CARD_CATALOG_SOCIAL_SENSITIVITIES);
        expect(schema.properties.catalogId.const).toBe("core");
        expect(schema.properties.snapshotKind.const).toBe("FULL");

        expect(schema.$defs.questionCategory.required).toContain("defaultSocialSensitivity");
        expect(schema.$defs.dareType.required).toContain("defaultSocialSensitivity");
    });

    it("accepts the canonical producer example unchanged", () => {
        const example = JSON.parse(
            fs.readFileSync("tests/fixtures/card-catalog-v2.example.json", "utf8"),
        );
        expect(validateCardCatalog(example)).toEqual(example);
    });

    it("accepts a multilingual catalog including a UI-unsupported Card locale", () => {
        const catalog = cardCatalog({
            locales: [
                { id: "de-DE", nativeName: "Deutsch", active: true },
                { id: "fr-FR", nativeName: "Français", active: true },
            ],
            taxonomy: {
                questionCategories: [
                    {
                        id: "CAT_EVERYDAY",
                        defaultSocialSensitivity: "PERSONAL",
                        localizations: [
                            { locale: "de-DE", label: "Alltag", description: null },
                            { locale: "fr-FR", label: "Quotidien", description: null },
                        ],
                    },
                ],
                dareTypes: [],
            },
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

    it("rejects duplicate JSON object keys and invalid UTF-8 bytes", () => {
        const duplicateKey = JSON.stringify(cardCatalog()).replace(
            '"contract":',
            '"contract":"game-card-catalog/v2","contract":',
        );
        expect(() => validateCardCatalogArtifact(Buffer.from(duplicateKey))).toThrow(
            "duplicate object key 'contract'",
        );
        expect(() => validateCardCatalogArtifact(Buffer.from([0xc3, 0x28]))).toThrow(
            "not strict JSON",
        );
    });

    it("requires the exact v2 envelope", () => {
        const catalog = cardCatalog();
        expect(validateCardCatalog(catalog).contract).toBe("game-card-catalog/v2");
        expect(() =>
            validateCardCatalog({ ...catalog, contract: "game-card-catalog/v1" }),
        ).toThrow();
        expect(() => validateCardCatalog({ ...catalog, catalogId: "partner" })).toThrow();
        const { snapshotKind: _snapshotKind, ...missingSnapshotKind } = catalog;
        expect(() => validateCardCatalog(missingSnapshotKind)).toThrow();
        const { taxonomy: _taxonomy, ...flattened } = catalog;
        expect(() =>
            validateCardCatalog({
                ...flattened,
                questionCategories: catalog.taxonomy.questionCategories,
                dareTypes: catalog.taxonomy.dareTypes,
            }),
        ).toThrow();
    });

    it("enforces fixed producer defaults and required taxonomy sensitivity", () => {
        const catalog = cardCatalog();
        expect(() =>
            validateCardCatalog({
                ...catalog,
                cardDefaults: { ...catalog.cardDefaults, minimumPlayerCount: 3 },
            }),
        ).toThrow();
        expect(() =>
            validateCardCatalog({
                ...catalog,
                cardDefaults: { ...catalog.cardDefaults, maximumPlayerCount: 8 },
            }),
        ).toThrow();
        const { defaultSocialSensitivity: _sensitivity, ...categoryWithoutSensitivity } =
            catalog.taxonomy.questionCategories[0];
        expect(() =>
            validateCardCatalog({
                ...catalog,
                taxonomy: {
                    ...catalog.taxonomy,
                    questionCategories: [categoryWithoutSensitivity],
                },
            }),
        ).toThrow();
    });

    it("rejects producer player counts below two", () => {
        const catalog = cardCatalog();
        expect(() =>
            validateCardCatalog({
                ...catalog,
                cards: [{ ...catalog.cards[0], minimumPlayerCount: 1 }],
            }),
        ).toThrow();
        expect(() =>
            validateCardCatalog({
                ...catalog,
                cards: [{ ...catalog.cards[0], maximumPlayerCount: 1 }],
            }),
        ).toThrow();
    });

    it("resolves Card, primary-taxonomy, and fixed-default metadata in order", () => {
        const questionCatalog = cardCatalog();
        expect(
            resolveProducerCardMetadata(questionCatalog, questionCatalog.cards[0]),
        ).toMatchObject({
            socialSensitivity: "PERSONAL",
            minimumPlayerCount: 2,
            maximumPlayerCount: null,
        });

        const dareCatalog = cardCatalog();
        dareCatalog.cards[0] = {
            ...dareCatalog.cards[0],
            cardType: "DARE",
            questionCategoryId: null,
            dareTypeId: "DARE_SILLY",
            dareAffinityCategoryId: "CAT_EVERYDAY",
        };
        expect(
            resolveProducerCardMetadata(dareCatalog, dareCatalog.cards[0]).socialSensitivity,
        ).toBe("GENERAL");

        const metaCatalog = cardCatalog();
        metaCatalog.cards[0] = {
            ...metaCatalog.cards[0],
            cardType: "CONVERSATION_META",
            questionCategoryId: null,
        };
        expect(
            resolveProducerCardMetadata(metaCatalog, metaCatalog.cards[0]).socialSensitivity,
        ).toBe("GENERAL");
        metaCatalog.cards[0].questionCategoryId = "CAT_EVERYDAY";
        expect(
            resolveProducerCardMetadata(metaCatalog, metaCatalog.cards[0]).socialSensitivity,
        ).toBe("PERSONAL");

        metaCatalog.cards[0].socialSensitivity = "EXPLICIT";
        metaCatalog.cards[0].minimumPlayerCount = 4;
        metaCatalog.cards[0].maximumPlayerCount = 6;
        expect(resolveProducerCardMetadata(metaCatalog, metaCatalog.cards[0])).toEqual({
            socialSensitivity: "EXPLICIT",
            minimumPlayerCount: 4,
            maximumPlayerCount: 6,
        });
    });

    it("accepts every canonical social-sensitivity level and rejects unknown levels", () => {
        for (const sensitivity of CARD_CATALOG_SOCIAL_SENSITIVITIES) {
            const catalog = cardCatalog();
            catalog.taxonomy.questionCategories[0].defaultSocialSensitivity = sensitivity;
            expect(validateCardCatalog(catalog)).toEqual(catalog);
        }
        const catalog = cardCatalog();
        expect(() =>
            validateCardCatalog({
                ...catalog,
                taxonomy: {
                    ...catalog.taxonomy,
                    questionCategories: [
                        {
                            ...catalog.taxonomy.questionCategories[0],
                            defaultSocialSensitivity: "SECRET",
                        },
                    ],
                },
            }),
        ).toThrow();
    });

    it("distinguishes an absent maximum from an explicit unbounded Card maximum", () => {
        const catalog = cardCatalog();
        catalog.taxonomy.questionCategories[0].defaultMinimumPlayerCount = 3;
        catalog.taxonomy.questionCategories[0].defaultMaximumPlayerCount = 4;
        catalog.cards[0].maximumPlayerCount = null;
        expect(validateCardCatalog(catalog)).toEqual(catalog);
    });

    it("rejects an invalid resolved player-count range with the Card identity", () => {
        const catalog = cardCatalog();
        catalog.taxonomy.questionCategories[0].defaultMinimumPlayerCount = 4;
        catalog.cards[0].maximumPlayerCount = 3;
        expect(() => validateCardCatalog(catalog)).toThrow(catalog.cards[0].id);
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
        missingLabel.taxonomy.questionCategories[0].localizations = [
            { locale: "de-DE", label: "Alltag", description: null },
        ];
        expect(() => validateCardCatalog(missingLabel)).toThrow("missing en-GB label");
        const invalidType = cardCatalog();
        invalidType.cards[0].dareTypeId = "DARE_SILLY";
        expect(() => validateCardCatalog(invalidType)).toThrow("Question taxonomy");
        const whitespace = cardCatalog();
        whitespace.cards[0].localizations[0].text = " padded ";
        expect(() => validateCardCatalog(whitespace)).toThrow("leading/trailing whitespace");
        const cooldown = cardCatalog();
        cooldown.cards[0].repeatCooldown = 1;
        expect(() => validateCardCatalog(cooldown)).toThrow(
            "must be 0 when repeatableInSession is false",
        );
    });

    it("uses the canonical Card-type and operational-flag vocabulary", () => {
        const meta = cardCatalog();
        meta.cards[0] = {
            ...meta.cards[0],
            cardType: "CONVERSATION_META",
            questionCategoryId: null,
            localizations: [{ locale: "de-DE", text: "Wählt die nächste Person." }],
        };
        expect(validateCardCatalog(meta).cards[0].cardType).toBe("CONVERSATION_META");
        expect(() =>
            validateCardCatalog({
                ...meta,
                cards: [{ ...meta.cards[0], cardType: "CONVERSATION" }],
            }),
        ).toThrow();
        expect(() =>
            validateCardCatalog({
                ...cardCatalog(),
                cards: [
                    {
                        ...cardCatalog().cards[0],
                        operationalFlags: ["REQUIRES_PRIVATE_SPACE"],
                    },
                ],
            }),
        ).toThrow();
    });
});
