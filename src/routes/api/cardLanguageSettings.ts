import { In } from "typeorm";
import { z } from "zod";
import { AppDataSource } from "../../modules/database/dataSource";
import { LocaleEntity } from "../../modules/database/entities/card/LocaleEntity";
import { ExpectedError } from "../../modules/lib/errors";
import { MESSAGE_KEYS } from "../../packages/localization/keys";

const languageTagSchema = z
    .string()
    .trim()
    .min(2)
    .max(35)
    .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/);

export const cardLanguageSettingsSchema = z
    .object({
        cardLocale: languageTagSchema,
        cardFallbackEnabled: z.boolean(),
        cardFallbackLocales: z.array(languageTagSchema).max(100),
    })
    .strict()
    .superRefine(({ cardLocale, cardFallbackEnabled, cardFallbackLocales }, context) => {
        const normalized = cardFallbackLocales.map((entry) => entry.toLowerCase());
        if (new Set(normalized).size !== normalized.length) {
            context.addIssue({
                code: "custom",
                path: ["cardFallbackLocales"],
                message: "Fallback locales must be unique",
            });
        }
        if (normalized.includes(cardLocale.toLowerCase())) {
            context.addIssue({
                code: "custom",
                path: ["cardFallbackLocales"],
                message: "The primary Card locale cannot also be a fallback",
            });
        }
        if (cardFallbackEnabled && cardFallbackLocales.length === 0) {
            context.addIssue({
                code: "custom",
                path: ["cardFallbackLocales"],
                message: "Enabled Card fallback requires at least one locale",
            });
        }
    });

export type CardLanguageSettingsInput = z.infer<typeof cardLanguageSettingsSchema>;

export async function requireActiveCardLanguages(
    value: CardLanguageSettingsInput | null | undefined,
): Promise<void> {
    if (!value) return;
    const requested = [...new Set([value.cardLocale, ...value.cardFallbackLocales])];
    const active = await AppDataSource.getRepository(LocaleEntity).countBy({
        id: In(requested),
        active: true,
    });
    if (active !== requested.length) {
        throw new ExpectedError(MESSAGE_KEYS.CARD_LOCALE_UNAVAILABLE, "error", 400);
    }
}
