import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Index("UQ_card_catalog_version", ["catalogId", "catalogVersion"], { unique: true })
@Entity("card_catalog_versions")
export class CardCatalogVersionEntity {
    @PrimaryColumn("varchar", { name: "catalog_id", length: 40 }) catalogId!: string;
    @PrimaryColumn("int", { name: "sequence" }) sequence!: number;
    @Column("varchar", { name: "contract", length: 40, default: "game-card-catalog/v2" })
    contract!: string;
    @Column("varchar", { name: "catalog_version", length: 80 }) catalogVersion!: string;
    @Column("varchar", { name: "artifact_digest", length: 64 }) artifactDigest!: string;
    @Column("datetime", { name: "generated_at" }) generatedAt!: Date;
    @Column("datetime", { name: "applied_at" }) appliedAt!: Date;
    @Column("varchar", { name: "default_locale", length: 35 }) defaultLocale!: string;
    @Column("int", { name: "card_count" }) cardCount!: number;
    @Column("int", { name: "locale_count" }) localeCount!: number;
}
