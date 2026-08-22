import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("game_groups")
@Index(["dataSpaceId", "name"], { unique: true })
export class GroupEntity {
    @PrimaryColumn("varchar", { length: 36 }) id!: string;
    @Column("varchar", { name: "data_space_id", length: 36 }) dataSpaceId!: string;
    @Column("varchar", { length: 80 }) name!: string;
    @Column("text", { name: "members_json", default: "[]" }) membersJson!: string;
    @Column("datetime", { name: "created_at" }) createdAt!: Date;
    @Column("datetime", { name: "updated_at" }) updatedAt!: Date;
}
