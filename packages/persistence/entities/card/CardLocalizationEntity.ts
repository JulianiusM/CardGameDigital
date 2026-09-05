import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { CardEntity } from "./CardEntity";

@Index("IDX_card_localizations_locale_active", ["locale", "active"])
@Entity("card_localizations")
export class CardLocalizationEntity {
    @PrimaryColumn("varchar", { name: "card_id", length: 36 }) cardId!: string;
    @PrimaryColumn("varchar", { length: 35 }) locale!: string;
    @Column("text") text!: string;
    @Column("boolean", { default: true }) active!: boolean;
    @Column("datetime", { name: "updated_at" }) updatedAt!: Date;
    @ManyToOne(() => CardEntity, (card) => card.localizations, { onDelete: "RESTRICT" })
    @JoinColumn({ name: "card_id" })
    card!: CardEntity;
}
