import type { Repository } from "typeorm";
import type { CardId, PlayableCard } from "../game-core";
import type {
    CardCandidateRequest,
    CardLocalizationPolicy,
    CardRepository,
} from "../application/repositories";
import { CardEntity } from "./entities/card/CardEntity";
import { LocaleEntity } from "./entities/card/LocaleEntity";
import { cardEntityToDomain } from "./cardMapper";

export class TypeOrmCardRepository implements CardRepository {
    constructor(private readonly cards: Repository<CardEntity>) {}

    async getById(id: CardId, localization: CardLocalizationPolicy): Promise<PlayableCard | null> {
        const entities = await this.localizedQuery(localization)
            .andWhere("card.id = :id", { id })
            .getMany();
        return entities[0] ? this.toDomain(entities[0], localization) : null;
    }

    async listActive(localization: CardLocalizationPolicy): Promise<readonly PlayableCard[]> {
        return (await this.localizedQuery(localization).getMany()).map((entity) =>
            this.toDomain(entity, localization),
        );
    }

    async findEligibleCandidates(
        request: CardCandidateRequest,
        localization: CardLocalizationPolicy,
    ): Promise<readonly PlayableCard[]> {
        const query = this.localizedQuery(localization).andWhere("card.cardType = :cardType", {
            cardType: request.cardType,
        });
        if (request.questionCategoryIds?.length)
            query.andWhere("card.questionCategoryId IN (:...questionCategories)", {
                questionCategories: request.questionCategoryIds,
            });
        if (request.dareTypeIds?.length)
            query.andWhere("card.dareTypeId IN (:...dareTypes)", {
                dareTypes: request.dareTypeIds,
            });
        if (request.yesNoAnswerPossible !== undefined)
            query.andWhere("card.yesNoAnswerPossible = :yesNo", {
                yesNo: request.yesNoAnswerPossible,
            });
        return (await query.getMany()).map((entity) => this.toDomain(entity, localization));
    }

    private localizedQuery(localization: CardLocalizationPolicy) {
        const locales = [localization.locale];
        if (localization.missingTranslation === "FALLBACK" && localization.fallbackLocales) {
            locales.push(...localization.fallbackLocales);
        }
        return this.cards
            .createQueryBuilder("card")
            .leftJoinAndSelect("card.flags", "flag")
            .innerJoinAndSelect(
                "card.localizations",
                "localization",
                "localization.locale IN (:...locales) AND localization.active = :localizationActive",
                { locales, localizationActive: true },
            )
            .where("card.active = :active", { active: true });
    }

    private toDomain(entity: CardEntity, localization: CardLocalizationPolicy): PlayableCard {
        const exact = entity.localizations.find((entry) => entry.locale === localization.locale);
        const fallback = localization.fallbackLocales
            ?.map((locale) => entity.localizations.find((entry) => entry.locale === locale))
            .find((entry) => entry !== undefined);
        const localized = exact ?? fallback;
        if (!localized) throw new Error("Localized card query returned no usable localization");
        return cardEntityToDomain(entity, localized);
    }

    async isLocaleActive(locale: string): Promise<boolean> {
        return this.cards.manager
            .getRepository(LocaleEntity)
            .existsBy({ id: locale, active: true });
    }

    async defaultLocale(): Promise<string> {
        const locale = await this.cards.manager
            .getRepository(LocaleEntity)
            .findOneBy({ active: true, isDefault: true });
        if (!locale) throw new Error("No active default Card locale is installed");
        return locale.id;
    }
}
