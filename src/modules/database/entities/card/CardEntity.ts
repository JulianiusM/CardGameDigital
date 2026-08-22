import { Column, Entity, Index, OneToMany, PrimaryColumn } from "typeorm";
import { CardLocalizationEntity } from "./CardLocalizationEntity";
import { CardOperationalFlagEntity } from "./CardOperationalFlagEntity";

@Index("IDX_cards_type_active", ["cardType", "active"])
@Entity("cards")
export class CardEntity {
    @PrimaryColumn("varchar", { length: 36 }) id!: string;
    @Column("varchar", { name: "card_type", length: 20 }) cardType!: string;
    @Column("boolean", { name: "yes_no_answer_possible", default: false })
    yesNoAnswerPossible!: boolean;
    @Column("varchar", { name: "question_category_id", length: 40, nullable: true })
    questionCategoryId!: string | null;
    @Column("varchar", { name: "dare_type_id", length: 40, nullable: true }) dareTypeId!:
        string | null;
    @Column("varchar", { name: "dare_affinity_category_id", length: 40, nullable: true })
    dareAffinityCategoryId!: string | null;
    @Column("int", { name: "intensity", default: 1 }) intensity!: number;
    @Column("boolean", { name: "always_eligible", default: false }) alwaysEligible!: boolean;
    @Column("boolean", { name: "repeatable_in_session", default: false })
    repeatableInSession!: boolean;
    @Column("int", { name: "repeat_cooldown", default: 0 }) repeatCooldown!: number;
    @Column("float", { name: "weight", default: 1 }) weight!: number;
    @Column("boolean", { name: "active", default: true }) active!: boolean;
    @OneToMany(() => CardOperationalFlagEntity, (flag) => flag.card, { cascade: true })
    flags!: CardOperationalFlagEntity[];
    @OneToMany(() => CardLocalizationEntity, (localization) => localization.card, { cascade: true })
    localizations!: CardLocalizationEntity[];
}
