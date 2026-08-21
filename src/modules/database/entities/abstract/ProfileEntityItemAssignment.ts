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

import {NumericProfileBase, UuidProfileBase} from "./Base";
import type {BaseEntity, DefaultItemAssignmentRelationEntity} from "./BaseEntity";
import type {BaseEntityItem} from "./BaseEntityItem";

export abstract class DefaultNumericEntityItemAssignment extends NumericProfileBase implements DefaultItemAssignmentRelationEntity {
    abstract entity: BaseEntity;
    abstract entityId: string;
    abstract item: BaseEntityItem;
    abstract itemId: string;
}

export abstract class DefaultUuidEntityItemAssignment extends UuidProfileBase implements DefaultItemAssignmentRelationEntity {
    abstract entity: BaseEntity;
    abstract entityId: string;
    abstract item: BaseEntityItem;
    abstract itemId: string;
}

export type EntityItemAssignment = NumericProfileBase | UuidProfileBase;
export type DefaultEntityItemAssignment = DefaultNumericEntityItemAssignment | DefaultUuidEntityItemAssignment;