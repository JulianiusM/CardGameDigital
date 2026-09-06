import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Index("UQ_room_create_idempotency_scope_key", ["principalScopeDigest", "routeKey", "keyDigest"], {
    unique: true,
})
@Index("IDX_room_create_idempotency_tombstone", ["state", "tombstoneExpiresAt"])
@Index("IDX_room_create_idempotency_creator", ["creatorParticipantId"])
@Index("IDX_room_create_resource", ["resourceId", "state"])
@Entity("room_create_idempotency")
export class RoomCreateIdempotencyEntity {
    @PrimaryColumn("varchar", { length: 36 }) id!: string;
    @Column("varchar", { name: "principal_scope_digest", length: 64 })
    principalScopeDigest!: string;
    @Column("varchar", { name: "route_key", length: 80 }) routeKey!: string;
    @Column("varchar", { name: "key_digest", length: 64 }) keyDigest!: string;
    @Column("varchar", { name: "lookup_key_id", length: 64, nullable: true })
    lookupKeyId!: string | null;
    @Column("varchar", { name: "request_fingerprint", length: 64 }) requestFingerprint!: string;
    @Column("varchar", { length: 20 }) state!: "REPLAYABLE" | "RESOURCE_GONE";
    @Column("integer", { name: "status_code", nullable: true }) statusCode!: number | null;
    @Column("integer", { name: "response_schema_version", nullable: true })
    responseSchemaVersion!: number | null;
    @Column("varchar", { name: "response_key_id", length: 64, nullable: true })
    responseKeyId!: string | null;
    @Column("text", { name: "response_ciphertext", nullable: true })
    responseCiphertext!: string | null;
    @Column("varchar", { name: "resource_type", length: 16, nullable: true })
    resourceType!: "ROOM" | null;
    @Column("varchar", { name: "resource_id", length: 36, nullable: true })
    resourceId!: string | null;
    @Column("varchar", { name: "creator_participant_id", length: 36, nullable: true })
    creatorParticipantId!: string | null;
    @Column("datetime", { name: "created_at" }) createdAt!: Date;
    @Column("datetime", { name: "updated_at" }) updatedAt!: Date;
    @Column("datetime", { name: "tombstone_expires_at", nullable: true })
    tombstoneExpiresAt!: Date | null;
}
