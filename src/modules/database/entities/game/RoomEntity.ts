import { Column, Entity, Index, OneToMany, PrimaryColumn } from "typeorm";
import { RoomParticipantEntity } from "./RoomParticipantEntity";

@Entity("rooms")
export class RoomEntity {
    @PrimaryColumn("varchar", { length: 36 }) id!: string;
    @Index({ unique: true }) @Column("varchar", { length: 8 }) code!: string;
    @Column("varchar", { name: "data_space_id", length: 36, nullable: true }) dataSpaceId!:
        string | null;
    @Column("varchar", { name: "group_id", length: 36, nullable: true }) groupId!: string | null;
    @Column("integer", { name: "settings_revision", default: 0 }) settingsRevision!: number;
    @Column("text", { name: "game_settings_json" }) gameSettingsJson!: string;
    @Column("varchar", { name: "settings_updated_by", length: 36, nullable: true })
    settingsUpdatedByParticipantId!: string | null;
    @Column("datetime", { name: "created_at" }) createdAt!: Date;
    @Column("datetime", { name: "expires_at" }) expiresAt!: Date;
    @OneToMany(() => RoomParticipantEntity, (participant) => participant.room)
    participants!: RoomParticipantEntity[];
}
