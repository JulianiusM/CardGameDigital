import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { DataSpace } from "../user/DataSpace";
import { GroupEntity } from "./GroupEntity";

@Entity("card_policy_scope_defaults")
@Index("IDX_card_policy_default_space", ["dataSpaceId"])
export class CardPolicyScopeDefaultEntity {
    @PrimaryColumn("varchar", { name: "owner_key", length: 80 }) ownerKey!: string;
    @Column("uuid", { name: "data_space_id" }) dataSpaceId!: string;
    @Column("varchar", { name: "group_id", length: 36, nullable: true }) groupId!: string | null;
    @Column("text", { name: "directives_json" }) directivesJson!: string;
    @Column("int", { default: 1 }) revision!: number;
    @Column("int", { name: "scope_revision", default: 0 }) scopeRevision!: number;
    @Column("datetime", { name: "created_at" }) createdAt!: Date;
    @Column("datetime", { name: "updated_at" }) updatedAt!: Date;
    @ManyToOne(() => DataSpace, { onDelete: "CASCADE" })
    @JoinColumn({ name: "data_space_id" })
    dataSpace!: DataSpace;
    @ManyToOne(() => GroupEntity, { onDelete: "CASCADE", nullable: true })
    @JoinColumn({ name: "group_id" })
    group!: GroupEntity | null;
}
