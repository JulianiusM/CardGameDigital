import { Column, Entity, OneToMany, PrimaryColumn } from "typeorm";
import { QuestionCategoryTranslationEntity } from "./QuestionCategoryTranslationEntity";

@Entity("question_categories")
export class QuestionCategoryEntity {
    @PrimaryColumn("varchar", { length: 40 }) id!: string;
    @Column("varchar", { name: "default_social_sensitivity", length: 24, default: "GENERAL" })
    defaultSocialSensitivity!: string;
    @Column("int", { name: "default_minimum_player_count", default: 2 })
    defaultMinimumPlayerCount!: number;
    @Column("int", { name: "default_maximum_player_count", nullable: true })
    defaultMaximumPlayerCount!: number | null;
    @OneToMany(() => QuestionCategoryTranslationEntity, (translation) => translation.category)
    translations!: QuestionCategoryTranslationEntity[];
}
