import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity("card_catalog_versions")
export class CardCatalogVersionEntity {
    @PrimaryColumn("varchar", { name: "catalog_version", length: 80 }) catalogVersion!: string;
    @Column("int", { name: "schema_version" }) schemaVersion!: number;
    @Column("varchar", { name: "source_name", length: 100 }) sourceName!: string;
    @Column("varchar", { name: "source_digest", length: 64 }) sourceDigest!: string;
    @Column("datetime", { name: "generated_at" }) generatedAt!: Date;
    @Column("datetime", { name: "applied_at" }) appliedAt!: Date;
}
