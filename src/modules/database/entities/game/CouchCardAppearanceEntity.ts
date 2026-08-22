import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Index("IDX_couch_card_appearance_session", ["sessionId", "sequence"], { unique: true })
@Entity("couch_card_appearances")
export class CouchCardAppearanceEntity {
    @PrimaryColumn("varchar", { length: 36 }) id!: string;
    @Column("varchar", { name: "session_id", length: 36 }) sessionId!: string;
    @Column("varchar", { name: "group_id", length: 36, nullable: true }) groupId!: string | null;
    @Column("varchar", { name: "card_id", length: 36 }) cardId!: string;
    @Column("varchar", { name: "player_id", length: 36, nullable: true }) playerId!: string | null;
    @Column("datetime", { name: "shown_at" }) shownAt!: Date;
    @Column("int", { name: "round_number" }) roundNumber!: number;
    @Column("int") sequence!: number;
    @Column("boolean", { default: false }) skipped!: boolean;
}
