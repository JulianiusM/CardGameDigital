import type { Repository } from "typeorm";
import type { CardId, PlayableCard } from "../game-core";
import type {
    CardCandidateRequest,
    CardLocalizationPolicy,
    CardRepository,
} from "../application/repositories";
import { CardEntity } from "../../modules/database/entities/card/CardEntity";
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
        if (localization.missingTranslation === "FALLBACK" && localization.fallbackLocale) {
            locales.push(localization.fallbackLocale);
        }
        return this.cards
            .createQueryBuilder("card")
            .leftJoinAndSelect("card.flags", "flag")
            .innerJoinAndSelect(
                "card.translations",
                "translation",
                "translation.locale IN (:...locales) AND translation.status = :published",
                { locales, published: "PUBLISHED" },
            )
            .where("card.active = :active", { active: true });
    }

    private toDomain(entity: CardEntity, localization: CardLocalizationPolicy): PlayableCard {
        const exact = entity.translations.find(
            (translation) => translation.locale === localization.locale,
        );
        const fallback = entity.translations.find(
            (translation) => translation.locale === localization.fallbackLocale,
        );
        const translation = exact ?? fallback;
        if (!translation) throw new Error("Localized card query returned no usable translation");
        return cardEntityToDomain(entity, translation);
    }
}
