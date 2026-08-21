/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Column, Entity, JoinColumn, ManyToOne, OneToOne, RelationId} from "typeorm";
import {UuidBase} from "../abstract/TrackedBase";
import {Guest} from "./Guest";
import {User} from "./User";

@Entity("profiles", {schema: "surveyor"})
export class Profile extends UuidBase {
    @Column("varchar", {name: "name", length: 50})
    name!: string;

    @Column("varchar", {name: "migration_token", nullable: true, length: 255})
    migrationToken?: string | null;

    @Column("datetime", {name: "migration_token_expiration", nullable: true})
    migrationTokenExpiration?: Date | null;

    @Column("boolean", {name: "default_for_owner", default: false})
    defaultForOwner!: boolean;

    @RelationId((profile: Profile) => profile.user)
    userId?: number;

    @ManyToOne(() => User, (users) => users.profiles, {
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "user_id", referencedColumnName: "id"}])
    user?: User | null;

    @RelationId((profile: Profile) => profile.guest)
    guestId?: string;

    @OneToOne(() => Guest, (guests) => guests.profile, {
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "guest_id", referencedColumnName: "id"}])
    guest?: Guest | null;
}