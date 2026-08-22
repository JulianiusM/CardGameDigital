import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Index("UQ_game_session_room_active", ["roomId"], { unique: true })
@Entity("game_sessions")
export class GameSessionEntity {
    @PrimaryColumn("varchar", { length: 36 }) id!: string;
    @Column("varchar", { name: "room_id", length: 36 }) roomId!: string;
    @Column("varchar", { name: "group_id", length: 36, nullable: true }) groupId!: string | null;
    @Column("varchar", { length: 40 }) mode!: string;
    @Column("int") revision!: number;
    @Column("int", { name: "runtime_state_version" }) runtimeStateVersion!: number;
    @Column("text", { name: "runtime_state_json" }) runtimeStateJson!: string;
    @Column("datetime", { name: "started_at" }) startedAt!: Date;
    @Column("datetime", { name: "ended_at", nullable: true }) endedAt!: Date | null;
}
