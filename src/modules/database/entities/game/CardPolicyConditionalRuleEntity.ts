import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { DataSpace } from "../user/DataSpace";
import { GroupEntity } from "./GroupEntity";

@Entity("card_policy_conditional_rules")
@Index("IDX_card_policy_rules_owner_order", ["ownerKey", "ruleOrder"], { unique: true })
@Index("IDX_card_policy_rules_space", ["dataSpaceId"])
export class CardPolicyConditionalRuleEntity {
    @PrimaryColumn("varchar", { length: 36 }) id!: string;
    @Column("varchar", { name: "owner_key", length: 80 }) ownerKey!: string;
    @Column("varchar", { name: "data_space_id", length: 36 }) dataSpaceId!: string;
    @Column("varchar", { name: "group_id", length: 36, nullable: true }) groupId!: string | null;
    @Column("varchar", { length: 100 }) name!: string;
    @Column("int", { name: "rule_order" }) ruleOrder!: number;
    @Column("boolean", { default: true }) enabled!: boolean;
    @Column("text", { name: "predicate_json" }) predicateJson!: string;
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
}
