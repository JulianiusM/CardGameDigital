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

import {Column, CreateDateColumn, PrimaryGeneratedColumn, UpdateDateColumn} from "typeorm";

export class ModifyTracking {
    @CreateDateColumn({type: "timestamp", name: "created_at"})
    createdAt: Date;

    @UpdateDateColumn({type: "timestamp", name: "updated_at"})
    updatedAt: Date;
}

export abstract class TrackedBase {
    @Column(() => ModifyTracking, {prefix: false})
    track: ModifyTracking;
}

export abstract class UuidBase extends TrackedBase {
    @PrimaryGeneratedColumn("uuid", {name: "id"})
    id!: string;
}

export abstract class NumericBase extends TrackedBase {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;
}