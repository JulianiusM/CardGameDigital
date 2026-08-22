import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { QuestionCategoryEntity } from "./QuestionCategoryEntity";

@Entity("question_category_translations")
export class QuestionCategoryTranslationEntity {
    @PrimaryColumn("varchar", { name: "category_id", length: 40 }) categoryId!: string;
    @PrimaryColumn("varchar", { length: 35 }) locale!: string;
    @Column("varchar", { length: 80 }) label!: string;
    @Column("text", { nullable: true }) description!: string | null;
    @ManyToOne(() => QuestionCategoryEntity, (category) => category.translations, {
        onDelete: "RESTRICT",
    })
    @JoinColumn({ name: "category_id" })
    category!: QuestionCategoryEntity;
}
