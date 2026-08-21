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

import type {ActivityPlan} from "../modules/database/entities/activity/ActivityPlan";
import type {DriversList} from "../modules/database/entities/drivers/DriversList";
import type {Event} from "../modules/database/entities/event/Event";
import type {PackingList} from "../modules/database/entities/packing/PackingList";
import type {Survey} from "../modules/database/entities/surveys/Survey";
import {Guest} from "../modules/database/entities/user/Guest";
import type * as userService from "../modules/database/services/UserService";
import type {EntityItemType, EntityType} from "./UtilTypes";

export type OidcClaims = {
    sub: string;
    email?: string;
    email_verified?: boolean;
    preferred_username?: string;
    name?: string;
    // add whatever custom claims you mapped in authentik (e.g., groups)
    groups?: string[];
};

export type GuestFlowConfig = {
    entityType: EntityType,
    entityItemType?: EntityItemType,
    addToEvent: boolean,
    db: Partial<GuestFlowDb>,
    templates: { create: string, view: string },
    buildRedirect: (id: any) => string,
    preprocessCreate: (body: any) => any,
    createEntity: (ownerId: string, data: any) => Promise<any>,
    afterCreateItems: (id: any, data: any) => Promise<void>,
    fetchForView: (entity: any, Request) => Promise<any | null>,
    fetchForDuplicate: (entity: any, session: Request['session']) => Promise<any | null>,
    deleteEntity: (entity: any, session: Request['session']) => Promise<any>,
};

export type GuestFlowDb = {
    getById: (id: any) => Promise<any | null>,
    getItems: (id: any) => Promise<any[]>,
    registerGuest: typeof userService.createGuest,
    getGuestInternal: typeof userService.getGuestInternal,
    getGuestByToken: typeof userService.getGuestByToken,
    getGuestLinkToken: typeof userService.getGuestLinkToken,
};

export type UserInfo = {
    id: string;
    username: string;
    email: string;
    name: string;
}

export type DashboardEntities = {
    surveys: Survey[];
    packingLists: PackingList[];
    activityPlans: ActivityPlan[];
    driversLists: DriversList[];
    events: Event[];
}

export type DashboardDTO = {
    owner?: Partial<DashboardEntities>;
    participant?: Partial<DashboardEntities>;
    admin_flag?: boolean;
}

export type EntityBase = {
    id: string;
    title: string;
    ownerId: string;
    eventId?: string | null;
    description?: string | null;
    headerImg?: string | null;
}

export type Entity = EntityBase & {
    url: string;
    type: EntityType;
    imageUrl?: string | null;
}

export type GuestLinkData = Guest & { link: string }