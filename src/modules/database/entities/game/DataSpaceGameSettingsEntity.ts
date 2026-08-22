import { Column, Entity, PrimaryColumn } from "typeorm";

/** Account-owned gameplay defaults. They never replace the immutable built-in profiles. */
@Entity("data_space_game_settings")
export class DataSpaceGameSettingsEntity {
    @PrimaryColumn("varchar", { name: "data_space_id", length: 36 }) dataSpaceId!: string;
    @Column("varchar", { name: "preferred_profile_id", length: 80 }) preferredProfileId!: string;
    @Column("integer", { name: "maximum_intensity" }) maximumIntensity!: number;
    @Column("float", { name: "random_question_ratio" }) randomQuestionRatio!: number;
    @Column("integer", { name: "lets_talk_meta_interval" }) letsTalkMetaInterval!: number;
    @Column("varchar", { name: "default_group_id", length: 36, nullable: true }) defaultGroupId!:
        string | null;
    @Column("datetime", { name: "updated_at" }) updatedAt!: Date;
}
