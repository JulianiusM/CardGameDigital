import { Column, Entity, OneToMany, PrimaryColumn } from "typeorm";
import { DareTypeTranslationEntity } from "./DareTypeTranslationEntity";

@Entity("dare_types")
export class DareTypeEntity {
    @PrimaryColumn("varchar", { length: 40 }) id!: string;
    @Column("varchar", { name: "default_social_sensitivity", length: 24, default: "GENERAL" })
    defaultSocialSensitivity!: string;
    @Column("int", { name: "default_minimum_player_count", default: 2 })
    defaultMinimumPlayerCount!: number;
    @Column("int", { name: "default_maximum_player_count", nullable: true })
    defaultMaximumPlayerCount!: number | null;
    @OneToMany(() => DareTypeTranslationEntity, (translation) => translation.dareType)
    translations!: DareTypeTranslationEntity[];
}
