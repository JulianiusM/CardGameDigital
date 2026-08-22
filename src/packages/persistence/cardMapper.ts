import type { PlayableCard } from "../game-core";
import type { CardEntity } from "../../modules/database/entities/card/CardEntity";
import type { CardTranslationEntity } from "../../modules/database/entities/card/CardTranslationEntity";

export function cardEntityToDomain(
    entity: CardEntity,
    translation: CardTranslationEntity,
): PlayableCard {
    return {
        id: entity.id as PlayableCard["id"],
        cardText: translation.text,
        locale: translation.locale,
        cardType: entity.cardType as PlayableCard["cardType"],
        yesNoAnswerPossible: entity.yesNoAnswerPossible,
        questionCategoryId: entity.questionCategoryId as PlayableCard["questionCategoryId"],
        dareTypeId: entity.dareTypeId as PlayableCard["dareTypeId"],
        dareAffinityCategoryId:
            entity.dareAffinityCategoryId as PlayableCard["dareAffinityCategoryId"],
        intensity: entity.intensity as PlayableCard["intensity"],
        alwaysEligible: entity.alwaysEligible,
        repeatableInSession: entity.repeatableInSession,
        repeatCooldown: entity.repeatCooldown,
        weight: entity.weight,
        active: entity.active,
        operationalFlags: (entity.flags ?? [])
            .map((entry) => entry.flag as PlayableCard["operationalFlags"][number])
            .sort(),
    };
}
