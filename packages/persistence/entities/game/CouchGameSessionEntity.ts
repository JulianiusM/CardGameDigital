import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("couch_game_sessions")
@Index("IDX_couch_session_retention", ["endedAt", "lastActiveAt"])
export class CouchGameSessionEntity {
    @PrimaryColumn("varchar", { length: 36 }) id!: string;
    @Column("varchar", { name: "data_space_id", length: 36, nullable: true }) dataSpaceId!:
        string | null;
    @Column("varchar", { name: "group_id", length: 36, nullable: true }) groupId!: string | null;
    @Column("varchar", { length: 40 }) mode!: string;
    @Column("int") revision!: number;
    @Column("int", { name: "runtime_state_version" }) runtimeStateVersion!: number;
    @Column("text", { name: "runtime_state_json" }) runtimeStateJson!: string;
    @Column("varchar", { name: "policy_input_digest", length: 64, nullable: true })
    policyInputDigest!: string | null;
    @Column("datetime", { name: "started_at" }) startedAt!: Date;
    @Column("datetime", { name: "last_active_at", default: "1970-01-01 00:00:00" })
    lastActiveAt!: Date;
    @Column("datetime", { name: "ended_at", nullable: true }) endedAt!: Date | null;
}
