import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity("locales")
export class LocaleEntity {
    @PrimaryColumn("varchar", { length: 35 }) id!: string;
    @Column("varchar", { name: "display_name", length: 80 }) displayName!: string;
    @Column("boolean", { name: "active", default: true }) active!: boolean;
    @Column("boolean", { name: "is_default", default: false }) isDefault!: boolean;
}
