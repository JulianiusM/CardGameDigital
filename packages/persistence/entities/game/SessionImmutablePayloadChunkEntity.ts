import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { SessionImmutablePayloadEntity } from "./SessionImmutablePayloadEntity";

/** Bounded chunks keep every database statement independent of catalog size. */
@Entity("session_immutable_payload_chunks")
export class SessionImmutablePayloadChunkEntity {
    @PrimaryColumn("varchar", { name: "payload_digest", length: 64 }) payloadDigest!: string;
    @PrimaryColumn("int", { name: "chunk_index" }) chunkIndex!: number;
    @Column("text", { name: "payload_base64" }) payloadBase64!: string;
    @ManyToOne(() => SessionImmutablePayloadEntity, (payload) => payload.chunks, {
        onDelete: "CASCADE",
    })
    @JoinColumn({ name: "payload_digest" })
    payload!: SessionImmutablePayloadEntity;
}
