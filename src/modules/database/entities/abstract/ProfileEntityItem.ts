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
import type {BaseEntity, DefaultItemRelationEntity} from "./BaseEntity";
import {NumericDescriptionEntityItem, UuidDescriptionEntityItem} from "./DescriptionEntityItem";
import type {EntityItemAssignment} from "./ProfileEntityItemAssignment";

export abstract class UuidProfileEntityItem extends UuidDescriptionEntityItem {
    @RelationId((a: UuidProfileEntityItem) => a.profile)
    profileId!: string;

    @ManyToOne(() => Profile, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn({name: "profile_id", referencedColumnName: "id"})
    profile!: Profile;
}

export abstract class UuidDefaultEntityItem extends UuidProfileEntityItem implements DefaultItemRelationEntity {
    abstract assignments: EntityItemAssignment[];
    abstract entity: BaseEntity;
    abstract entityId: string;
}

export abstract class NumericProfileEntityItem extends NumericDescriptionEntityItem {
    @RelationId((a: NumericProfileEntityItem) => a.profile)
    profileId!: string;

    @ManyToOne(() => Profile, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn({name: "profile_id", referencedColumnName: "id"})
    profile!: Profile;
}

export abstract class NumericDefaultEntityItem extends NumericProfileEntityItem implements DefaultItemRelationEntity {
    abstract assignments: EntityItemAssignment[];
    abstract entity: BaseEntity;
    abstract entityId: string;
}