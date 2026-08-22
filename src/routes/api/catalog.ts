import express from "express";
import { z } from "zod";
import { AppDataSource } from "../../modules/database/dataSource";
import { CardEntity } from "../../modules/database/entities/card/CardEntity";
import { CardLocalizationEntity } from "../../modules/database/entities/card/CardLocalizationEntity";
import { DareTypeTranslationEntity } from "../../modules/database/entities/card/DareTypeTranslationEntity";
import { LocaleEntity } from "../../modules/database/entities/card/LocaleEntity";
import { QuestionCategoryTranslationEntity } from "../../modules/database/entities/card/QuestionCategoryTranslationEntity";
import { MESSAGE_KEYS } from "../../packages/localization/keys";
import { detectLocale, translate } from "../../packages/localization/messages";

const router = express.Router();
const localeSchema = z.string().min(2).max(35);

router.get("/locales", async (_request, response, next) => {
    try {
        const locales = await AppDataSource.getRepository(LocaleEntity).find({
            where: { active: true },
            order: { id: "ASC" },
        });
        const defaultLocale = locales.find((locale) => locale.isDefault);
        if (!defaultLocale) throw new Error("No active default Card locale is installed");
        const activeCardCount = await AppDataSource.getRepository(CardEntity).countBy({
            active: true,
        });
        const result = [];
        for (const locale of locales) {
            const localizedCardCount = await AppDataSource.getRepository(CardLocalizationEntity)
                .createQueryBuilder("localization")
                .innerJoin("localization.card", "card", "card.active = :active", { active: true })
                .where("localization.locale = :locale", { locale: locale.id })
                .andWhere("localization.active = :active", { active: true })
                .getCount();
            result.push({
                id: locale.id,
                nativeName: locale.displayName,
                coverage: activeCardCount ? localizedCardCount / activeCardCount : 1,
            });
        }
        response.json({ defaultLocale: defaultLocale.id, locales: result });
    } catch (error) {
        next(error);
    }
});

router.get("/taxonomies", async (request, response, next) => {
    try {
        const locale = localeSchema.parse(request.query.locale);
        const activeLocale = await AppDataSource.getRepository(LocaleEntity).existsBy({
            id: locale,
            active: true,
        });
        if (!activeLocale) {
            response.status(400).json({
                error: {
                    code: "CARD_LOCALE_UNAVAILABLE",
                    message: translate(
                        detectLocale(request.get("accept-language")),
                        MESSAGE_KEYS.CARD_LOCALE_UNAVAILABLE,
                    ),
                },
            });
            return;
        }
        const questionCategories = await AppDataSource.getRepository(
            QuestionCategoryTranslationEntity,
        ).find({ where: { locale }, order: { categoryId: "ASC" } });
        const dareTypes = await AppDataSource.getRepository(DareTypeTranslationEntity).find({
            where: { locale },
            order: { dareTypeId: "ASC" },
        });
        response.json({
            locale,
            questionCategories: questionCategories.map((item) => ({
                id: item.categoryId,
                label: item.label,
                description: item.description,
            })),
            dareTypes: dareTypes.map((item) => ({
                id: item.dareTypeId,
                label: item.label,
                description: item.description,
            })),
        });
    } catch (error) {
        next(error);
    }
});

export default router;
