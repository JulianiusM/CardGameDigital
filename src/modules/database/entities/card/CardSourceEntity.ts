import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { CardEntity } from "./CardEntity";

@Entity("card_sources")
export class CardSourceEntity {
    @PrimaryColumn("varchar", { name: "source_namespace", length: 100 }) sourceNamespace!: string;
    @PrimaryColumn("varchar", { name: "source_id", length: 255 }) sourceId!: string;
    @Column("varchar", { name: "card_id", length: 36 }) cardId!: string;
    @Column("varchar", { name: "origin", length: 255 }) origin!: string;
    @Column("varchar", { name: "origin_category", length: 255, nullable: true }) originCategory!:
        string | null;
    @ManyToOne(() => CardEntity, (card) => card.sources, { onDelete: "RESTRICT" })
    @JoinColumn({ name: "card_id" })
    card!: CardEntity;
}
