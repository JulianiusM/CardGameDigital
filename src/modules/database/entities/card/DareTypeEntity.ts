import { Entity, OneToMany, PrimaryColumn } from "typeorm";
import { DareTypeTranslationEntity } from "./DareTypeTranslationEntity";

@Entity("dare_types")
export class DareTypeEntity {
    @PrimaryColumn("varchar", { length: 40 }) id!: string;
    @OneToMany(() => DareTypeTranslationEntity, (translation) => translation.dareType)
    translations!: DareTypeTranslationEntity[];
}
