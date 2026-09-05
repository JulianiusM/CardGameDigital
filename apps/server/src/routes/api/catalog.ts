import express from "express";
import { z } from "zod";
import { getAppDataSource } from "../../modules/database/dataSource";
import { CardEntity } from "../../../../../packages/persistence/entities/card/CardEntity";
import { CardLocalizationEntity } from "../../../../../packages/persistence/entities/card/CardLocalizationEntity";
import { DareTypeTranslationEntity } from "../../../../../packages/persistence/entities/card/DareTypeTranslationEntity";
import { LocaleEntity } from "../../../../../packages/persistence/entities/card/LocaleEntity";
import { QuestionCategoryTranslationEntity } from "../../../../../packages/persistence/entities/card/QuestionCategoryTranslationEntity";
import { DARE_TYPE_IDS, QUESTION_CATEGORY_IDS } from "../../../../../packages/game-core";
import { MESSAGE_KEYS } from "../../../../../packages/localization/keys";
import { detectLocale, translate } from "../../../../../packages/localization/messages";

const router = express.Router();
const localeSchema = z.string().min(2).max(35);

router.get("/locales", async (_request, response, next) => {
    try {
        const locales = await getAppDataSource()
            .getRepository(LocaleEntity)
            .find({
                where: { active: true },
                order: { id: "ASC" },
            });
        const defaultLocale = locales.find((locale) => locale.isDefault);
        if (!defaultLocale) throw new Error("No active default Card locale is installed");
        const activeCardCount = await getAppDataSource().getRepository(CardEntity).countBy({
            active: true,
        });
        const result = [];
        for (const locale of locales) {
            const localizedCardCount = await getAppDataSource()
                .getRepository(CardLocalizationEntity)
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
        const activeLocale = await getAppDataSource().getRepository(LocaleEntity).existsBy({
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
        const questionCategoryTranslations = await getAppDataSource()
            .getRepository(QuestionCategoryTranslationEntity)
            .find({ where: { locale } });
        const dareTypeTranslations = await getAppDataSource()
            .getRepository(DareTypeTranslationEntity)
            .find({ where: { locale } });
        const questionCategoriesById = new Map(
            questionCategoryTranslations.map((item) => [item.categoryId, item]),
        );
        const dareTypesById = new Map(dareTypeTranslations.map((item) => [item.dareTypeId, item]));
        response.json({
            locale,
            questionCategories: QUESTION_CATEGORY_IDS.flatMap((id) => {
                const item = questionCategoriesById.get(id);
                return item ? [{ id, label: item.label, description: item.description }] : [];
            }),
            dareTypes: DARE_TYPE_IDS.flatMap((id) => {
                const item = dareTypesById.get(id);
                return item ? [{ id, label: item.label, description: item.description }] : [];
            }),
        });
    } catch (error) {
        next(error);
    }
});

export default router;
