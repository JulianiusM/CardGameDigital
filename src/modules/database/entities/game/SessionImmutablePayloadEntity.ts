import { Column, Entity, OneToMany, PrimaryColumn } from "typeorm";
import { SessionImmutablePayloadChunkEntity } from "./SessionImmutablePayloadChunkEntity";

/** Immutable, content-addressed Session input shared whenever its content is identical. */
@Entity("session_immutable_payloads")
export class SessionImmutablePayloadEntity {
    @PrimaryColumn("varchar", { length: 64 }) digest!: string;
    @Column("varchar", { name: "payload_kind", length: 24 }) payloadKind!:
        "COMPILED_CARD_POLICY" | "GROUP_HISTORY";
    @Column("varchar", { length: 16 }) compression!: "brotli";
    @Column("int", { name: "chunk_count" }) chunkCount!: number;
    @Column("int", { name: "uncompressed_byte_length" }) uncompressedByteLength!: number;
    @Column("int", { name: "compressed_byte_length" }) compressedByteLength!: number;
    @Column("datetime", { name: "created_at" }) createdAt!: Date;
    @OneToMany(() => SessionImmutablePayloadChunkEntity, (chunk) => chunk.payload)
    chunks!: SessionImmutablePayloadChunkEntity[];
}
