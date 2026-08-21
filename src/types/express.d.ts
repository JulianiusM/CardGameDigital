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

import "express";
import type {TokenEndpointResponse} from "openid-client";
import type {EntityAdminAssignment} from "../modules/database/entities/permissions/EntityAdminAssignment";
import type {Guest} from "../modules/database/entities/user/Guest";
import type {Profile} from "../modules/database/entities/user/Profile";
import type {User} from "../modules/database/entities/user/User";
import type {Settings} from "../modules/settings";
import type {PermBundle, PermMetaBundle} from "./PermissionTypes";

declare module "express" {
    // Inject additional properties on express.Request
    interface Request {
        resource?: Record<string, any>;
        additional?: Record<string, any>[];
    }
}

declare module "express-serve-static-core" {
    interface Locals {
        data?: any,
        auth?: {
            user?: User | null,
            guest?: Guest | null,
        },
        profile?: Profile | null,
        version: string,
        settings?: Partial<Settings>,
        permData?: PermBundle,
        perms?: PermMetaBundle,
        admins?: EntityAdminAssignment[],
    }
}

declare module "express-session" {
    interface SessionData {
        auth: {
            user?: User | null;
            guest?: Guest | null;
        },
        profile?: Profile | null,
        tokens?: TokenEndpointResponse;
        oidc?: { code_verifier: string; state: string; nonce?: string };
    }
}

export {};