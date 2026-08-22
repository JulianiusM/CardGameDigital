import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("raw_card_imports")
export class RawCardImportEntity {
    @PrimaryGeneratedColumn("uuid") id!: string;
    @Column("varchar", { name: "catalog_version", length: 80 }) catalogVersion!: string;
    @Column("varchar", { name: "source_name", length: 100 }) sourceName!: string;
    @Column("varchar", { name: "source_identifier", length: 255 }) sourceIdentifier!: string;
    @Column("text", { name: "raw_payload_json" }) rawPayloadJson!: string;
    @Column("varchar", { name: "validation_status", length: 10 }) validationStatus!:
        "VALID" | "WARNING" | "ERROR";
    @Column("text", { name: "issues_json" }) issuesJson!: string;
}
