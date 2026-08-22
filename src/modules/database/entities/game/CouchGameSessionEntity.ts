import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity("couch_game_sessions")
export class CouchGameSessionEntity {
    @PrimaryColumn("varchar", { length: 36 }) id!: string;
    @Column("varchar", { name: "data_space_id", length: 36, nullable: true }) dataSpaceId!:
        string | null;
    @Column("varchar", { name: "group_id", length: 36, nullable: true }) groupId!: string | null;
    @Column("varchar", { length: 40 }) mode!: string;
    @Column("int") revision!: number;
    @Column("int", { name: "runtime_state_version" }) runtimeStateVersion!: number;
    @Column("text", { name: "runtime_state_json" }) runtimeStateJson!: string;
    @Column("datetime", { name: "started_at" }) startedAt!: Date;
    @Column("datetime", { name: "ended_at", nullable: true }) endedAt!: Date | null;
}
