import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("game_groups")
@Index(["dataSpaceId", "name"], { unique: true })
export class GroupEntity {
    @PrimaryColumn("varchar", { length: 36 }) id!: string;
    @Column("varchar", { name: "data_space_id", length: 36 }) dataSpaceId!: string;
    @Column("varchar", { length: 80 }) name!: string;
    @Column("text", { name: "members_json" }) membersJson!: string;
    @Column("datetime", { name: "created_at" }) createdAt!: Date;
    @Column("datetime", { name: "updated_at" }) updatedAt!: Date;
    @Column("datetime", { name: "history_reset_at", nullable: true }) historyResetAt!: Date | null;
    @Column("varchar", { name: "preferred_profile_id", length: 80, nullable: true })
    preferredProfileId!: string | null;
    @Column("text", { name: "custom_configuration_json", nullable: true })
    customConfigurationJson!: string | null;
    @Column("text", { name: "card_language_settings_json", nullable: true })
    cardLanguageSettingsJson!: string | null;
}
