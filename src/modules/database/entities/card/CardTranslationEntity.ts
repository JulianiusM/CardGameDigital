import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { CardEntity } from "./CardEntity";

export const CARD_TRANSLATION_STATUSES = ["DRAFT", "REVIEWED", "PUBLISHED", "STALE"] as const;
export type CardTranslationStatus = (typeof CARD_TRANSLATION_STATUSES)[number];

@Index("IDX_card_translations_locale_status", ["locale", "status"])
@Entity("card_translations")
export class CardTranslationEntity {
    @PrimaryColumn("varchar", { name: "card_id", length: 36 }) cardId!: string;
    @PrimaryColumn("varchar", { length: 35 }) locale!: string;
    @Column("text") text!: string;
    @Column("varchar", { length: 12 }) status!: CardTranslationStatus;
    @Column("int", { name: "revision" }) revision!: number;
    @Column("int", { name: "source_revision" }) sourceRevision!: number;
    @Column("varchar", { name: "content_hash", length: 64 }) contentHash!: string;
    @Column("datetime", { name: "updated_at" }) updatedAt!: Date;
    @ManyToOne(() => CardEntity, (card) => card.translations, { onDelete: "RESTRICT" })
    @JoinColumn({ name: "card_id" })
    card!: CardEntity;
}
