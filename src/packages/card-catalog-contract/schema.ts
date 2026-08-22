import { z } from "zod";
import { CARD_TYPES, DARE_TYPES, OPERATIONAL_FLAGS, QUESTION_CATEGORIES } from "../game-core";

export const CARD_CATALOG_CONTRACT = "game-card-catalog/v1" as const;
export const CARD_LIFECYCLES = ["ACTIVE", "RETIRED"] as const;
export const CARD_CATALOG_CARD_TYPES = Object.values(CARD_TYPES);
export const CARD_CATALOG_QUESTION_CATEGORIES = Object.values(QUESTION_CATEGORIES);
export const CARD_CATALOG_DARE_TYPES = Object.values(DARE_TYPES);
export const CARD_CATALOG_OPERATIONAL_FLAGS = Object.values(OPERATIONAL_FLAGS);

const nonBlankFinalText = z
    .string()
    .min(1)
    .refine((value) => value === value.trim(), "must not contain leading/trailing whitespace");
const localeId = z.string().min(2).max(35);
const localizationSchema = z.object({ locale: localeId, text: nonBlankFinalText }).strict();
const taxonomyLocalizationSchema = z
    .object({
        locale: localeId,
        label: nonBlankFinalText.max(80),
        description: nonBlankFinalText.nullable().optional(),
    })
    .strict();

export const cardCatalogSchema = z
    .object({
        contract: z.literal(CARD_CATALOG_CONTRACT),
        catalogId: z.string().min(1).max(40),
        sequence: z.number().int().positive(),
        catalogVersion: z.string().min(1).max(80),
        generatedAt: z.iso.datetime(),
        defaultLocale: localeId,
        locales: z.array(
            z
                .object({
                    id: localeId,
                    nativeName: nonBlankFinalText.max(80),
                    active: z.boolean(),
                })
                .strict(),
        ),
        questionCategories: z.array(
            z
                .object({
                    id: z.enum(CARD_CATALOG_QUESTION_CATEGORIES),
                    localizations: z.array(taxonomyLocalizationSchema),
                })
                .strict(),
        ),
        dareTypes: z.array(
            z
                .object({
                    id: z.enum(CARD_CATALOG_DARE_TYPES),
                    localizations: z.array(taxonomyLocalizationSchema),
                })
                .strict(),
        ),
        cards: z.array(
            z
                .object({
                    id: z.uuid(),
                    lifecycle: z.enum(CARD_LIFECYCLES),
                    cardType: z.enum(CARD_CATALOG_CARD_TYPES),
                    yesNoAnswerPossible: z.boolean(),
                    questionCategoryId: z.enum(CARD_CATALOG_QUESTION_CATEGORIES).nullable(),
                    dareTypeId: z.enum(CARD_CATALOG_DARE_TYPES).nullable(),
                    dareAffinityCategoryId: z.enum(CARD_CATALOG_QUESTION_CATEGORIES).nullable(),
                    intensity: z.number().int().min(1).max(5),
                    alwaysEligible: z.boolean(),
                    repeatableInSession: z.boolean(),
                    repeatCooldown: z.number().int().nonnegative(),
                    weight: z.number().positive(),
                    operationalFlags: z.array(z.enum(CARD_CATALOG_OPERATIONAL_FLAGS)),
                    localizations: z.array(localizationSchema),
                })
                .strict(),
        ),
    })
    .strict();

export type CardCatalog = z.infer<typeof cardCatalogSchema>;
export type CardCatalogCard = CardCatalog["cards"][number];
