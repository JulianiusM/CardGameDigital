import { Entity, OneToMany, PrimaryColumn } from "typeorm";
import { QuestionCategoryTranslationEntity } from "./QuestionCategoryTranslationEntity";

@Entity("question_categories")
export class QuestionCategoryEntity {
    @PrimaryColumn("varchar", { length: 40 }) id!: string;
    @OneToMany(() => QuestionCategoryTranslationEntity, (translation) => translation.category)
    translations!: QuestionCategoryTranslationEntity[];
}
