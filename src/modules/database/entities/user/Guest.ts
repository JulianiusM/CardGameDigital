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

import {Column, Entity, OneToOne} from "typeorm";
import {UuidBase} from "../abstract/TrackedBase";
import {Profile} from "./Profile";

@Entity("guests", {schema: "surveyor"})
export class Guest extends UuidBase {
    @Column("varchar", {name: "username", length: 50})
    username!: string;

    @Column("varchar", {name: "email", nullable: true, length: 100})
    email?: string | null;

    @Column("varchar", {name: "token", unique: true, length: 255})
    token!: string;

    @OneToOne(() => Profile, (profile) => profile.guest)
    profile!: Profile;
}
