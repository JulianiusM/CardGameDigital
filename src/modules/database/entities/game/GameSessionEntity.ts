import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Index("IDX_game_session_room", ["roomId"])
@Entity("game_sessions")
export class GameSessionEntity {
    @PrimaryColumn("varchar", { length: 36 }) id!: string;
    @Column("varchar", { name: "room_id", length: 36 }) roomId!: string;
    @Column("varchar", { name: "group_id", length: 36, nullable: true }) groupId!: string | null;
    @Column("varchar", { length: 40 }) mode!: string;
    @Column("int") revision!: number;
    @Column("int", { name: "runtime_state_version" }) runtimeStateVersion!: number;
    @Column("text", { name: "runtime_state_json" }) runtimeStateJson!: string;
    @Column("varchar", {
        name: "compiled_card_policy_digest",
        length: 64,
        nullable: true,
    })
    compiledCardPolicyDigest!: string | null;
    @Column("varchar", { name: "group_history_digest", length: 64, nullable: true })
    groupHistoryDigest!: string | null;
    @Column("datetime", { name: "started_at" }) startedAt!: Date;
    @Column("datetime", { name: "ended_at", nullable: true }) endedAt!: Date | null;
}
