import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { CardEntity } from "./CardEntity";

@Entity("card_operational_flags")
@Index("IDX_card_operational_flags_flag_card", ["flag", "cardId"])
export class CardOperationalFlagEntity {
    @PrimaryColumn("varchar", { name: "card_id", length: 36 }) cardId!: string;
    @PrimaryColumn("varchar", { name: "flag", length: 60 }) flag!: string;
    @ManyToOne(() => CardEntity, (card) => card.flags, { onDelete: "CASCADE" })
    @JoinColumn({ name: "card_id" })
    card!: CardEntity;
}
