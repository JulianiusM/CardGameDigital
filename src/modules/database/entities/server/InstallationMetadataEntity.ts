import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("installation_metadata")
export class InstallationMetadataEntity {
    @PrimaryColumn("integer") id!: number;
    @Index({ unique: true })
    @Column("varchar", { name: "server_id", length: 36 })
    serverId!: string;
    @Column("datetime", { name: "created_at" }) createdAt!: Date;
    @Column("integer", { name: "identity_schema_version", default: 1 })
    identitySchemaVersion!: number;
}
