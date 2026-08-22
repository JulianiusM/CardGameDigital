import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { RoomEntity } from "./RoomEntity";

@Index("IDX_room_participant_room", ["roomId"])
@Entity("room_participants")
export class RoomParticipantEntity {
    @PrimaryColumn("varchar", { length: 36 }) id!: string;
    @Column("varchar", { name: "room_id", length: 36 }) roomId!: string;
    @Column("varchar", { length: 16 }) role!: "HOST" | "PLAYER" | "DISPLAY";
    @Column("varchar", { name: "display_name", length: 40 }) displayName!: string;
    @Column("varchar", { name: "credential_hash", length: 64 }) credentialHash!: string;
    @Column("varchar", { name: "device_players_json", length: 4096, default: "[]" })
    devicePlayersJson!: string;
    @Column("datetime", { name: "created_at" }) createdAt!: Date;
    @ManyToOne(() => RoomEntity, (room) => room.participants, { onDelete: "CASCADE" })
    @JoinColumn({ name: "room_id" })
    room!: RoomEntity;
}
