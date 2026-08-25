import { ISession } from "connect-typeorm";
import { Column, DeleteDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("session")
export class AccountSession implements ISession {
    @Index()
    @Column("bigint")
    public expiredAt = Date.now();

    @PrimaryColumn("varchar", { length: 255 })
    public id = "";

    @Column("text")
    public json = "";

    @Index("IDX_session_account_user")
    @Column("int", { name: "account_user_id", nullable: true })
    public accountUserId: number | null = null;

    @DeleteDateColumn()
    public destroyedAt?: Date;
}
