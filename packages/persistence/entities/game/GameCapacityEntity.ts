import { Entity, PrimaryColumn } from "typeorm";

/** One database lock coordinates admission across independent repository instances. */
@Entity("game_capacity")
export class GameCapacityEntity {
    @PrimaryColumn("integer") id!: number;
}
