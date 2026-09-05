import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { DareTypeEntity } from "./DareTypeEntity";

@Entity("dare_type_translations")
export class DareTypeTranslationEntity {
    @PrimaryColumn("varchar", { name: "dare_type_id", length: 40 }) dareTypeId!: string;
    @PrimaryColumn("varchar", { length: 35 }) locale!: string;
    @Column("varchar", { length: 80 }) label!: string;
    @Column("text", { nullable: true }) description!: string | null;
    @ManyToOne(() => DareTypeEntity, (dareType) => dareType.translations, {
        onDelete: "RESTRICT",
    })
    @JoinColumn({ name: "dare_type_id" })
    dareType!: DareTypeEntity;
}
