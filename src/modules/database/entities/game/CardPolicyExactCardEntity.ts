import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { CardEntity } from "../card/CardEntity";
import { DataSpace } from "../user/DataSpace";
import { GroupEntity } from "./GroupEntity";

@Entity("card_policy_exact_cards")
@Index("UQ_card_policy_exact_owner_card", ["ownerKey", "cardId"], { unique: true })
@Index("IDX_card_policy_exact_space", ["dataSpaceId"])
export class CardPolicyExactCardEntity {
    @PrimaryColumn("varchar", { length: 36 }) id!: string;
    @Column("varchar", { name: "owner_key", length: 80 }) ownerKey!: string;
    @Column("uuid", { name: "data_space_id" }) dataSpaceId!: string;
    @Column("varchar", { name: "group_id", length: 36, nullable: true }) groupId!: string | null;
    @Column("varchar", { name: "card_id", length: 36 }) cardId!: string;
    @Column("text", { name: "directives_json" }) directivesJson!: string;
    @Column("int", { default: 1 }) revision!: number;
    @Column("datetime", { name: "created_at" }) createdAt!: Date;
    @Column("datetime", { name: "updated_at" }) updatedAt!: Date;
    @ManyToOne(() => DataSpace, { onDelete: "CASCADE" })
    @JoinColumn({ name: "data_space_id" })
    dataSpace!: DataSpace;
    @ManyToOne(() => GroupEntity, { onDelete: "CASCADE", nullable: true })
    @JoinColumn({ name: "group_id" })
    group!: GroupEntity | null;
    @ManyToOne(() => CardEntity, { onDelete: "RESTRICT" })
    @JoinColumn({ name: "card_id" })
    card!: CardEntity;
}
