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

/*
 * lib/permissionMiddleware.ts
 */
import {NextFunction, Request, Response} from "express";
import * as entityAdminService from "../modules/database/services/EntityAdminService"
import {isRegisteredForEvent} from "../modules/database/services/EventService";
import {asyncHandler} from "../modules/lib/asyncHandler";
import {APIError, ExpectedError} from "../modules/lib/errors";
import {getPermMeta, getPresets} from "../modules/lib/permissions";
import {normalizeToArray} from "../modules/lib/util";
import {buildPermBundle, can, getDefaultPerms} from "../modules/permissionEngine";
import type {
    EntityGetter,
    GetAdditional,
    GetResource,
    ItemGetter,
    ItemWithParentGetter,
    Subject
} from "../types/PermissionTypes";
import type {CombEntityType} from "../types/UtilTypes";

/* -------------------- Error adapters -------------------- */
type ErrorAdapter = {
    badRequest: () => never;
    forbidden: () => never;
};

const apiErrors: ErrorAdapter = {
    badRequest: () => {
        throw new APIError("Not allowed", {}, 400);
    },
    forbidden: () => {
        throw new APIError("Not allowed", {}, 403);
    },
};

const expectedErrors: ErrorAdapter = {
    badRequest: () => {
        throw new ExpectedError("Not allowed", "error", 400);
    },
    forbidden: () => {
        throw new ExpectedError("Not allowed", "error", 403);
    },
};

/* -------------------- Helpers -------------------- */
const defaultGetResource: GetResource = (req) => req.resource;
const defaultGetAdditional: GetAdditional = (req) => req.additional ?? [];

function isOwner(
    req: Request,
    resource?: any,
    additional: any[] = []
): boolean {
    const own = req.session.profile && req.session.profile.id === resource?.ownerId;
    if (own) return true;

    for (const item of additional) {
        if (req.session.profile && req.session.profile.id === item.profileId) {
            return true;
        }
    }
    return false;
}

async function isEventParticipant(req: Request, resource?: Record<string, any>) {
    const eventId = resource?.eventId;
    if (!eventId) return true; // Non-event resources are allowed
    if (!req.session.profile) return false;
    return await isRegisteredForEvent(req.session.profile.id, eventId);
}

/* -------------------- One generic builder -------------------- */
/**
 * Allow if ANY of the listed conditions is true. Otherwise throw 403.
 * Optionally throws 400 when an eventId is passed but events are disabled.
 */
type AllowKey = "owner" | "eventParticipant";

export type UserRoleCheckOptions = {
    /** Which conditions are sufficient for access (any-of). */
    allow: AllowKey[];
    /** If false, a query eventId triggers 400; if true, it’s allowed. Default: true */
    useEvent?: boolean;
    /** Override resource/additional getters if needed. */
    getResource?: GetResource;
    getAdditional?: GetAdditional;
};

function makeUserRoleCheck(errs: ErrorAdapter, opts: UserRoleCheckOptions) {
    const {
        allow,
        useEvent = true,
        getResource = defaultGetResource,
        getAdditional = defaultGetAdditional,
    } = opts;

    return async (req: Request, _res: Response, next: NextFunction) => {
        // Optional 400 guard for event usage mismatch
        if (req.query.eventId && !useEvent) errs.badRequest();

        // Compute predicates and gate guest* by eventParticipant when requested
        const resource = getResource(req);
        const additional = getAdditional(req);

        const ownerOk = isOwner(req, resource, additional);
        const epOk = await isEventParticipant(req, resource);

        const checks: Record<AllowKey, boolean> = {
            owner: ownerOk,
            eventParticipant: epOk,
        };

        for (const key of allow) {
            if (checks[key]) return next();
        }

        errs.forbidden();
    };
}

/* -------------------- Two variants (API / Expected) -------------------- */
export const userRoleAPI = (opts: UserRoleCheckOptions) => makeUserRoleCheck(apiErrors, opts);
export const userRoleExpected = (opts: UserRoleCheckOptions) => makeUserRoleCheck(expectedErrors, opts);

/* -------------------- Optional convenience wrappers (drop-in replacements) -------------------- */
export const requireOwnerAPI = (getResource: GetResource = defaultGetResource, getAdditional: GetAdditional = defaultGetAdditional) =>
    userRoleAPI({allow: ["owner"], getResource, getAdditional});
export const requireOwner = (getResource: GetResource = defaultGetResource, getAdditional: GetAdditional = defaultGetAdditional) =>
    userRoleExpected({allow: ["owner"], getResource, getAdditional});

// requireEventParticipant (owner OR eventParticipant)
export const requireEventParticipantAPI = (getResource: GetResource = defaultGetResource, getAdditional: GetAdditional = defaultGetAdditional) =>
    userRoleAPI({allow: ["owner", "eventParticipant"], getResource, getAdditional});
export const requireEventParticipant = (getResource: GetResource = defaultGetResource, getAdditional: GetAdditional = defaultGetAdditional) =>
    userRoleExpected({allow: ["owner", "eventParticipant"], getResource, getAdditional});

/* -------------------- Unchanged auth redirect middleware -------------------- */
export function isAuthenticated(req: Request, res: Response, next: NextFunction) {
    if (req.session.auth?.user && req.session.profile) return next();
    req.flash("info", "You must be logged in as user to access this site.");
    let nxt = "";
    if (typeof req.query.next === "string") {
        nxt = `?next=${req.query.next}`;
    } else {
        nxt = `?next=${req.baseUrl}${req.path}`;
    }
    res.redirect(`/users/login${nxt}`);
}

export function isGuest(req: Request, res: Response, next: NextFunction) {
    if (req.session.auth?.guest && req.session.profile) return next();
    req.flash("info", "You must be logged in as guest to access this site.");
    res.redirect("/guest/recovery");
}

export function isLoggedIn(req: Request, res: Response, next: NextFunction) {
    if (req.session.auth && req.session.profile) return next();
    req.flash("info", "You must be logged in to access this site.");
    let nxt = "";
    if (typeof req.query.next === "string") {
        nxt = `?next=${req.query.next}`;
    } else {
        nxt = `?next=${req.baseUrl}${req.path}`;
    }
    res.redirect(`/users/login${nxt}`);
}

/* ---------- Entity Administration ---------- */
/** Core requirePerm, now delegates to engine.can(...) */
function requirePermInternal(
    getSubjects: ((req: Request) => Promise<Subject> | Subject)[],
    requiredPerm: number,
    err: ErrorAdapter,
    requiredParentPerm?: number | number[],
) {
    return async (req: Request, _res: Response, next: NextFunction) => {
        let ok = false;
        for (const getSubject of getSubjects) {
            const subject = await getSubject(req);
            ok = await can(subject, req.session ?? {}, requiredPerm, requiredParentPerm)
            if (ok) break; // break early
        }
        if (!ok) {
            return err.forbidden();
        }
        next();
    };
}

function transformEntityGetter(getEntity: EntityGetter[]) {
    const getters: ((req: Request) => Promise<Subject> | Subject)[] = [];
    for (const getter of getEntity) {
        getters.push(async (req: Request) => ({
            kind: 'entity',
            entity: (await getter(req))
        }))
    }
    return getters;
}

function transformItemGetter(getItem: ItemWithParentGetter[]) {
    const getters: ((req: Request) => Promise<Subject> | Subject)[] = [];
    for (const getter of getItem) {
        getters.push(async (req: Request) => ({
            kind: 'item',
            ...(await getter(req))
        }))
    }
    return getters;
}

/** Entity version */
export function requirePermissionApi(getEntity: EntityGetter | EntityGetter[], requiredPerm: number) {
    return requirePermInternal(transformEntityGetter(normalizeToArray(getEntity)), requiredPerm, apiErrors);
}

export function requirePermission(getEntity: EntityGetter | EntityGetter[], requiredPerm: number) {
    return requirePermInternal(transformEntityGetter(normalizeToArray(getEntity)), requiredPerm, expectedErrors);
}

/** Item version (with parent). You may pass a different requiredParentPerm; if omitted, same perm is checked on parent. */
export function requireItemPermissionApi(get: ItemWithParentGetter | ItemWithParentGetter[], requiredPerm: number, requiredParentPerm?: number | number[]) {
    return requirePermInternal(transformItemGetter(normalizeToArray(get)), requiredPerm, apiErrors, requiredParentPerm);
}

export function requireItemPermission(get: ItemWithParentGetter | ItemWithParentGetter[], requiredPerm: number, requiredParentPerm?: number | number[]) {

    return requirePermInternal(transformItemGetter(normalizeToArray(get)), requiredPerm, expectedErrors, requiredParentPerm);
}

// Checks for a permission to an optional entity. getEntity must return the entity in question (will skip the check if missing).
// getData must return the corresponding information for the entity and will be used to perform the check.
export function optionalPermissionApi(getData: EntityGetter, requiredPerm: number, getEntity: GetResource) {
    return (req: Request, res: Response, next: NextFunction) => {
        const resource = getEntity(req);
        if (!resource) return next();
        return requirePermissionApi(getData, requiredPerm)
    }
}

// Checks for a permission to an optional entity. getEntity must return the entity in question (will skip the check if missing).
// getData must return the corresponding information for the entity and will be used to perform the check.
export function optionalPermission(getData: EntityGetter, requiredPerm: number, getEntity: GetResource) {
    return (req: Request, res: Response, next: NextFunction) => {
        const resource = getEntity(req);
        if (!resource) return next();
        return requirePermission(getData, requiredPerm)(req, res, next);
    }
}

// Checks for a permission to an optional entity. getEntity must return the entity in question (will skip the check if missing).
// getData must return the corresponding information for the entity and will be used to perform the check.
export function optionalItemPermissionApi(getData: ItemWithParentGetter, requiredPerm: number, getEntity: GetResource, requiredParentPerm?: number) {
    return (req: Request, res: Response, next: NextFunction) => {
        const resource = getEntity(req);
        if (!resource) return next();
        return requireItemPermissionApi(getData, requiredPerm, requiredParentPerm)
    }
}

// Checks for a permission to an optional entity. getEntity must return the entity in question (will skip the check if missing).
// getData must return the corresponding information for the entity and will be used to perform the check.
export function optionalItemPermission(getData: ItemWithParentGetter, requiredPerm: number, getEntity: GetResource, requiredParentPerm?: number) {
    return (req: Request, res: Response, next: NextFunction) => {
        const resource = getEntity(req);
        if (!resource) return next();
        return requireItemPermission(getData, requiredPerm, requiredParentPerm)(req, res, next);
    }
}

/** Build { perm: { entity, item(id), ... } } for Pug */
export function attachPermBundle(getEntity: EntityGetter, getItems: ItemGetter) {
    return asyncHandler(async (req, res, next) => {
        const ent = await getEntity(req);
        const items = await getItems(req);
        res.locals.permData = await buildPermBundle(ent, items, req.session ?? {});
        next();
    });
}

export function attachPermMeta(entityType: CombEntityType, idSupplyer?: string | ((req: Request) => string)) {
    return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
        let id: string | undefined = undefined;
        if (typeof idSupplyer === 'string') id = idSupplyer;
        else if (typeof idSupplyer === 'function') id = idSupplyer(req);

        res.locals.perms = {
            permMeta: getPermMeta(),
            defaultPerms: await getDefaultPerms(entityType, id),
            presets: getPresets(),
        }
        next();
    });
}

export function attachAdminData(entityType: CombEntityType, idSupplyer?: string | ((req: Request) => string)) {
    return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
        let id: string | undefined = undefined;
        if (typeof idSupplyer === 'string') id = idSupplyer;
        else if (typeof idSupplyer === 'function') id = idSupplyer(req);

        res.locals.admins = await entityAdminService.listAdmins(entityType, id ?? "");
        next();
    })
}