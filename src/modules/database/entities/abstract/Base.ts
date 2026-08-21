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

import {JoinColumn, ManyToOne, RelationId} from "typeorm";
import {Profile} from "../user/Profile";
import {NumericBase, UuidBase} from "./TrackedBase";

export abstract class NumericProfileBase extends NumericBase {
    @RelationId((a: NumericProfileBase) => a.profile)
    profileId!: string;

    @ManyToOne(() => Profile, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn({name: "profile_id", referencedColumnName: "id"})
    profile!: Profile;
}

export abstract class UuidProfileBase extends UuidBase {
    @RelationId((a: UuidProfileBase) => a.profile)
    profileId!: string;

    @ManyToOne(() => Profile, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn({name: "profile_id", referencedColumnName: "id"})
    profile!: Profile;
}