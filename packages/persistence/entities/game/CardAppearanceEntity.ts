import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Index("IDX_card_appearance_session", ["sessionId", "sequence"], { unique: true })
@Index("IDX_card_appearances_last_seen", ["sessionId", "cardId", "sequence"])
@Index("IDX_card_appearances_group_seen", ["groupId", "cardId", "shownAt"])
@Entity("card_appearances")
export class CardAppearanceEntity {
    @PrimaryColumn("varchar", { length: 36 }) id!: string;
    @Column("varchar", { name: "session_id", length: 36 }) sessionId!: string;
    @Column("varchar", { name: "group_id", length: 36, nullable: true }) groupId!: string | null;
    @Column("varchar", { name: "card_id", length: 36 }) cardId!: string;
    @Column("varchar", { name: "player_id", length: 36, nullable: true }) playerId!: string | null;
    @Column("datetime", { name: "shown_at" }) shownAt!: Date;
    @Column("int", { name: "round_number" }) roundNumber!: number;
    @Column("int") sequence!: number;
    @Column("boolean", { default: false }) skipped!: boolean;
    @Column("boolean", { default: false }) completed!: boolean;
    @Column("boolean", { default: false }) vetoed!: boolean;
}
