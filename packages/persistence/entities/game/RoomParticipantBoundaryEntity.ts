import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from "typeorm";
import { RoomParticipantEntity } from "./RoomParticipantEntity";

@Entity("room_participant_boundaries")
export class RoomParticipantBoundaryEntity {
    @PrimaryColumn("varchar", { name: "participant_id", length: 36 })
    participantId!: string;

    @Column("text", { name: "disabled_question_category_ids" })
    disabledQuestionCategoryIdsJson!: string;

    @Column("text", { name: "disabled_dare_type_ids" })
    disabledDareTypeIdsJson!: string;

    @Column("text", { name: "blocked_operational_flags" })
    blockedOperationalFlagsJson!: string;

    @Column("datetime", { name: "updated_at" })
    updatedAt!: Date;

    @OneToOne(() => RoomParticipantEntity, { onDelete: "CASCADE" })
    @JoinColumn({ name: "participant_id" })
    participant!: RoomParticipantEntity;
}
