import { z } from "zod";
import { MAXIMUM_CARD_TEXT_BYTES, MAXIMUM_CARD_TEXT_CHARACTERS } from "./contentLimits";
import {
    CARD_TYPES,
    DARE_TYPES,
    OPERATIONAL_FLAGS,
    QUESTION_CATEGORIES,
    SOCIAL_SENSITIVITIES,
} from "../game-core";

export const CARD_CATALOG_CONTRACT = "game-card-catalog/v2" as const;
export const CARD_CATALOG_ID = "core" as const;
export const CARD_CATALOG_SNAPSHOT_KIND = "FULL" as const;
export const CARD_LIFECYCLES = ["ACTIVE", "RETIRED"] as const;
export const CARD_CATALOG_CARD_TYPES = Object.values(CARD_TYPES);
export const CARD_CATALOG_QUESTION_CATEGORIES = Object.values(QUESTION_CATEGORIES);
export const CARD_CATALOG_DARE_TYPES = Object.values(DARE_TYPES);
export const CARD_CATALOG_OPERATIONAL_FLAGS = Object.values(OPERATIONAL_FLAGS);
export const CARD_CATALOG_SOCIAL_SENSITIVITIES = Object.values(SOCIAL_SENSITIVITIES);

const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const localeIdPattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const canonicalUuidSchema = z.string().regex(canonicalUuidPattern).pipe(z.uuid());
const minimumPlayerCountSchema = z.number().int().min(2).max(2_147_483_647);
const maximumPlayerCountSchema = z.number().int().min(2).max(2_147_483_647).nullable();
const nonBlankFinalText = z
    .string()
    .min(1)
    .refine((value) => {
        let characters = 0;
        for (const _character of value)
            if (++characters > MAXIMUM_CARD_TEXT_CHARACTERS) return false;
        return true;
    }, "exceeds supported text characters")
    .refine(
        (value) => new TextEncoder().encode(value).byteLength <= MAXIMUM_CARD_TEXT_BYTES,
        "exceeds supported UTF-8 text bytes",
    )
    .refine((value) => value === value.trim(), "must not contain leading/trailing whitespace");
const localeId = z.string().min(2).max(35).regex(localeIdPattern);
const localizationSchema = z.object({ locale: localeId, text: nonBlankFinalText }).strict();
const taxonomyLocalizationSchema = z
    .object({
        locale: localeId,
        label: nonBlankFinalText.max(80),
        description: nonBlankFinalText.nullable(),
    })
    .strict();
const taxonomyEntryFields = {
    defaultSocialSensitivity: z.enum(CARD_CATALOG_SOCIAL_SENSITIVITIES),
    defaultMinimumPlayerCount: minimumPlayerCountSchema.optional(),
    defaultMaximumPlayerCount: maximumPlayerCountSchema.optional(),
    localizations: z.array(taxonomyLocalizationSchema).min(1),
};

export const cardCatalogSchema = z
    .object({
        contract: z.literal(CARD_CATALOG_CONTRACT),
        catalogId: z.literal(CARD_CATALOG_ID),
        catalogVersion: z.string().min(1).max(80),
        sequence: z.number().int().positive().max(2_147_483_647),
        generatedAt: z.iso.datetime({ offset: true }),
        snapshotKind: z.literal(CARD_CATALOG_SNAPSHOT_KIND),
        cardDefaults: z
            .object({
                socialSensitivity: z.literal(SOCIAL_SENSITIVITIES.GENERAL),
                minimumPlayerCount: z.literal(2),
                maximumPlayerCount: z.null(),
            })
            .strict(),
        defaultLocale: localeId,
        locales: z
            .array(
                z
                    .object({
                        id: localeId,
                        nativeName: nonBlankFinalText.max(80),
                        active: z.boolean(),
                    })
                    .strict(),
            )
            .min(1),
        taxonomy: z
            .object({
                questionCategories: z.array(
                    z
                        .object({
                            id: z.enum(CARD_CATALOG_QUESTION_CATEGORIES),
                            ...taxonomyEntryFields,
                        })
                        .strict(),
                ),
                dareTypes: z.array(
                    z
                        .object({
                            id: z.enum(CARD_CATALOG_DARE_TYPES),
                            ...taxonomyEntryFields,
                        })
                        .strict(),
                ),
            })
            .strict(),
        cards: z
            .array(
                z
                    .object({
                        id: canonicalUuidSchema,
                        lifecycle: z.enum(CARD_LIFECYCLES),
                        cardType: z.enum(CARD_CATALOG_CARD_TYPES),
                        questionCategoryId: z.enum(CARD_CATALOG_QUESTION_CATEGORIES).nullable(),
                        dareTypeId: z.enum(CARD_CATALOG_DARE_TYPES).nullable(),
                        dareAffinityCategoryId: z.enum(CARD_CATALOG_QUESTION_CATEGORIES).nullable(),
                        yesNoAnswerPossible: z.boolean(),
                        intensity: z.number().int().min(1).max(5),
                        alwaysEligible: z.boolean(),
                        repeatableInSession: z.boolean(),
                        repeatCooldown: z.number().int().nonnegative().max(2_147_483_647),
                        weight: z.number().positive(),
                        socialSensitivity: z.enum(CARD_CATALOG_SOCIAL_SENSITIVITIES).optional(),
                        minimumPlayerCount: minimumPlayerCountSchema.optional(),
                        maximumPlayerCount: maximumPlayerCountSchema.optional(),
                        operationalFlags: z
                            .array(z.enum(CARD_CATALOG_OPERATIONAL_FLAGS))
                            .refine(
                                (values) => new Set(values).size === values.length,
                                "must contain unique values",
                            ),
                        localizations: z.array(localizationSchema),
                    })
                    .strict(),
            )
            .min(1),
    })
    .strict();

export type CardCatalog = z.infer<typeof cardCatalogSchema>;
export type CardCatalogCard = CardCatalog["cards"][number];
export const cardCatalogHeaderSchema = cardCatalogSchema.omit({ cards: true });
export type CardCatalogHeader = z.infer<typeof cardCatalogHeaderSchema>;
export const catalogCardSchema = cardCatalogSchema.shape.cards.element;

type TaxonomyDefaults =
    | CardCatalog["taxonomy"]["questionCategories"][number]
    | CardCatalog["taxonomy"]["dareTypes"][number];

function primaryTaxonomy(
    catalog: CardCatalogHeader,
    card: CardCatalogCard,
): TaxonomyDefaults | undefined {
    if (card.cardType === CARD_TYPES.QUESTION) {
        return catalog.taxonomy.questionCategories.find(({ id }) => id === card.questionCategoryId);
    }
    if (card.cardType === CARD_TYPES.DARE) {
        return catalog.taxonomy.dareTypes.find(({ id }) => id === card.dareTypeId);
    }
    if (card.questionCategoryId) {
        return catalog.taxonomy.questionCategories.find(({ id }) => id === card.questionCategoryId);
    }
    return undefined;
}

export function resolveProducerCardMetadata(catalog: CardCatalogHeader, card: CardCatalogCard) {
    const taxonomy = primaryTaxonomy(catalog, card);
    const cardHasMaximum = Object.hasOwn(card, "maximumPlayerCount");
    const taxonomyHasMaximum = Boolean(
        taxonomy && Object.hasOwn(taxonomy, "defaultMaximumPlayerCount"),
    );
    let maximumPlayerCount: number | null = catalog.cardDefaults.maximumPlayerCount;
    if (taxonomyHasMaximum) maximumPlayerCount = taxonomy?.defaultMaximumPlayerCount ?? null;
    if (cardHasMaximum) maximumPlayerCount = card.maximumPlayerCount ?? null;

    return {
        socialSensitivity:
            card.socialSensitivity ??
            taxonomy?.defaultSocialSensitivity ??
            catalog.cardDefaults.socialSensitivity,
        minimumPlayerCount:
            card.minimumPlayerCount ??
            taxonomy?.defaultMinimumPlayerCount ??
            catalog.cardDefaults.minimumPlayerCount,
        maximumPlayerCount,
    };
}
