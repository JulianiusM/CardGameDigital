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

import {BeforeInsert, BeforeUpdate, Column, Entity, Index, OneToMany,} from "typeorm";

import {NumericBase} from "../abstract/TrackedBase";
import {Profile} from "./Profile";

@Index("email", ["email"], {unique: true})
@Index("username", ["username"], {unique: true})
@Entity("users", {schema: "surveyor"})
export class User extends NumericBase {
    @Column("varchar", {name: "username", unique: true, length: 50})
    username!: string;

    @Column("varchar", {name: "name", length: 50})
    name!: string;

    @Column("varchar", {name: "email", unique: true, length: 100})
    email!: string;

    @Column("varchar", {name: "PASSWORD", nullable: true, length: 255})
    password?: string | null;

    @Column("tinyint", {
        name: "is_active",
        nullable: true,
        default: 0
    })
    isActive?: boolean | null;

    @Column("varchar", {name: "activation_token", nullable: true, length: 255})
    activationToken?: string | null;

    @Column("datetime", {name: "activation_token_expiration", nullable: true})
    activationTokenExpiration?: Date | null;

    @Column("varchar", {name: "reset_token", nullable: true, length: 255})
    resetToken?: string | null;

    @Column("datetime", {name: "reset_token_expiration", nullable: true})
    resetTokenExpiration?: Date | null;

    @Column('varchar', {name: 'oidc_sub', nullable: true, length: 255})
    oidcSub?: string | null;

    @Column('varchar', {name: 'oidc_issuer', nullable: true, length: 255})
    oidcIssuer?: string | null;

    @OneToMany(() => Profile, (profile) => profile.user)
    profiles: Profile[];

    @BeforeInsert()
    @BeforeUpdate()
    private ensureName() {
        if (!this.name || this.name === "") {
            this.name = this.username;
        }
    }
}
