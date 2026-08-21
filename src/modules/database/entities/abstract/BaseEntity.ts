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

import {Column, JoinColumn, ManyToOne, RelationId} from "typeorm";
import type {EntityBase} from "../../../../types/UserTypes";
import {Profile} from "../user/Profile";
import {BaseEntityItem} from "./BaseEntityItem";
import type {EntityItemAssignment} from "./ProfileEntityItemAssignment";
import {UuidBase} from "./TrackedBase";

export interface ChildItemRelation {
    items: BaseEntityItem[];
}

export interface ChildAssigmentRelation {
    assignments: EntityItemAssignment[];
}

export interface DefaultRelationEntity extends ChildItemRelation, ChildAssigmentRelation {
}

export interface ParentEntityRelation {
    entityId: string;
    entity: BaseEntity;
}

export interface ParentItemRelation {
    itemId: string;
    item: BaseEntityItem;
}

export interface DefaultItemRelationEntity extends ParentEntityRelation, ChildAssigmentRelation {
}

export interface DefaultItemAssignmentRelationEntity extends ParentEntityRelation, ParentItemRelation {
}

export abstract class BaseEntity extends UuidBase implements EntityBase {
    @Column("varchar", {name: "title", length: 255})
    title!: string;

    @Column("text", {name: "description", nullable: true})
    description?: string | null;

    @Column("varchar", {name: "header_img", length: 255, nullable: true})
    headerImg?: string | null;

    @RelationId((a: BaseEntity) => a.owner)
    ownerId!: string;

    @ManyToOne(() => Profile, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "owner_id", referencedColumnName: "id"}])
    owner!: Profile;
}

export abstract class DefaultEntity extends BaseEntity implements DefaultRelationEntity {
    abstract assignments: EntityItemAssignment[];
    abstract items: BaseEntityItem[];
}