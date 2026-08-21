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

import type {Request} from "express";
import type {Guest} from "../modules/database/entities/user/Guest";
import type {Profile} from "../modules/database/entities/user/Profile";
import type {User} from "../modules/database/entities/user/User";
import type {PERM} from "../modules/lib/permissions";
import type {EntityItemType, EntityType, PartialRecord} from "./UtilTypes";

export type PermType = keyof typeof PERM;

export type GetResource = (req: Request) => any;
export type GetAdditional = (req: Request) => any[];
export type EntityGetter = (req: Request) => Promise<EntityDescriptor> | EntityDescriptor;
export type ItemGetter = (req: Request) => Promise<ItemDescriptor[]> | ItemDescriptor[];

export type ItemWithParentGetter = (req: Request) => Promise<ItemSubject> | ItemSubject;

type DescriptorBase = {
    entityId: string;
    ownerId?: string | null;
    eventId?: string | null;
}

export type EntityDescriptor = DescriptorBase & {
    entityType: EntityType;
};

export type ItemDescriptor = DescriptorBase & {
    entityType: EntityItemType;
};

export type ItemSubject = {
    item: ItemDescriptor;
    parent: EntityDescriptor; // parent is the entity
};

export type Subject = { kind: 'entity'; entity: EntityDescriptor } | {
    kind: 'item';
    item: ItemDescriptor;
    parent: EntityDescriptor
};

export type SessionLike = {
    auth?: {
        user?: Partial<User> & { id: number } | null,
        guest?: Partial<Guest> & { id: string } | null
    },
    profile?: Partial<Profile> & { id: string } | null
};

export type PermMeta = {
    key: string,
    bit: number,
    label: string,
}

export type PermPreset = {
    key: string,
    label: string,
    mask: number,
}

export type PermData = PartialRecord<Audience, number>

export type Audience = 'guest' | 'participant' | 'authenticated' | 'public';

export type SaveOpts = {
    /** Name of the root field in the form body (default: "defaultPerms") */
    fieldBase?: string;
    /**
     * If true, audiences missing from the body are treated as mask 0 (clear).
     * If false (default), missing audiences are left unchanged.
     */
    clearMissing?: boolean;
    /** Which audiences to consider; default covers all. */
    audiences?: Audience[];
};

/** Small caches to avoid repeated calls within a request */
export type PermEngineCaches = {
    participant?: Map<string, boolean>;           // eventId -> isParticipant
    userPerms?: Map<string, number>;              // `${type}:${id}:${userId}` -> mask
    defaults?: Map<string, Record<string, number>>; // `${type}:${id}` -> defaults map
};

export type PermBundle = {
    entity: PermView,
    items: Map<string, PermView>,
    item: (id: string) => PermView,
    itemHas: (id: string, key: keyof typeof PERM) => boolean,
    itemAllow: (
        id: string,
        key: keyof typeof PERM,
        parentKey?: keyof typeof PERM | (keyof typeof PERM)[]
    ) => boolean,
    toJSON?: () => string,
}

export type PermMetaBundle = {
    permMeta: PermMeta[],
    defaultPerms: PermData,
    presets: PermPreset[],
}

/** View model used by Pug */
export type PermView = {
    mask: number;
    parentMask: number;
    has: (k: keyof typeof PERM) => boolean;              // self only
    allow: (k: keyof typeof PERM, parentKey?: keyof typeof PERM | (keyof typeof PERM)[]) => boolean; // self OR parent
    all: (...keys: (keyof typeof PERM)[]) => boolean;    // all on self
    any: (...keys: (keyof typeof PERM)[]) => boolean;    // any on self
    bits: Record<string, boolean>;                       // quick flags
};