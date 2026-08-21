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

import {Request} from "express";
import crypto from 'node:crypto';
import {v4 as uuidv4} from 'uuid';
import type {
    EntityDescriptor,
    EntityGetter,
    GetAdditional,
    GetResource,
    ItemDescriptor,
    ItemGetter,
    ItemSubject,
    ItemWithParentGetter
} from "../../types/PermissionTypes";
import type {DashboardEntities, Entity, EntityBase} from "../../types/UserTypes";
import type {EntityItemType, EntityType} from "../../types/UtilTypes";
import settings from "../settings";

import {APIError} from "./errors";

// Generic currency helpers for invoice math
export function toAmount(val: string | number | undefined | null): number {
    if (val === undefined || val === null) return 0;
    const num = Number(val);
    return Number.isNaN(num) ? 0 : num;
}

export function formatAmount(amount: number): string {
    return amount.toFixed(2);
}

// Resolve a human-friendly label for the current actor, falling back to usernames where names are missing.
// This keeps email/audit messages readable without duplicating lookup logic across controllers.
export function resolveActorLabel(session: Request['session'] | undefined | null): string {
    if (session?.profile?.name) return session.profile.name;
    if (session?.profile?.user?.username) return session.profile.user.username;
    if (session?.profile?.guest?.username) return session.profile.guest.username;
    return 'an organizer';
}

// Sanitize text for use in email content to prevent injection attacks
export function sanitizeForEmail(text: string): string {
    // Remove control characters and limit to printable characters
    return text.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
}

// Funktion zur Generierung eines einzigartigen Tokens
export function generateUniqueToken() {
    return crypto.randomBytes(32).toString('hex');
}

export function generateUniqueId() {
    return uuidv4();
}

// Returns 'YYYY-MM-DD' in the server's local time zone
export function toLocalISODate(dateObj: Date) {
    const y = dateObj.getUTCFullYear();
    const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function toLocalISOTime(dateObj: Date) {
    const y = dateObj.getUTCFullYear();
    const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getUTCDate()).padStart(2, '0');
    const h = String(dateObj.getUTCHours()).padStart(2, '0');
    const min = String(dateObj.getUTCMinutes()).padStart(2, '0');
    const sec = String(dateObj.getUTCSeconds()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}:${sec}`;
}

/**
 * Rewrite an ISO string into a given IANA timezone WITHOUT changing the wall-clock
 * date/time fields. Example: "2025-06-01T12:23:00Z" -> Europe/Berlin => "2025-06-01T12:23:00+02:00"
 *
 * @param {string} isoString - Any ISO 8601 datetime (with or without offset).
 * @param {string} timeZone  - IANA timezone, e.g. "Europe/Berlin".
 * @returns {string} ISO-like string with the same Y-M-D and time, but with the correct tz offset.
 */
export function rewriteISOToZone(isoString: string, timeZone: string): string {
    // 1) Parse *fields only* (ignore original offset when rebuilding)
    const m = new RegExp(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|[+-]\d{2}:?\d{2})?$/).exec(isoString.trim());
    if (!m) throw new Error("Invalid ISO datetime");

    const [, y, mo, d, h, mi, s = "00", ms = "0"] = m;
    const Y = +y, M = +mo, D = +d, H = +h, Min = +mi, S = +s, Ms = +ms.padEnd(3, "0");

    // 2) Helper: get offset in minutes for a given UTC epoch in the target zone
    function getOffsetMinutes(epochMs: number) {
        const p = new Intl.DateTimeFormat('en-US', {
            timeZone,
            timeZoneName: 'shortOffset'
        }).formatToParts(new Date(epochMs)).find(x => x.type === 'timeZoneName');

        // p.value examples: "GMT", "GMT+2", "GMT-05:30"
        const m = p?.value.match(/^GMT(?:(?<sign>[+-])(?<hh>\d{1,2})(?::?(?<mm>\d{2}))?)?$/);
        if (!m) return 0;
        const sign = (m.groups?.sign === '-') ? -1 : 1;
        const hh = m.groups?.hh ? Number.parseInt(m.groups.hh, 10) : 0;
        const mm = m.groups?.mm ? Number.parseInt(m.groups.mm, 10) : 0;
        return sign * (hh * 60 + mm);
    }

    // 3) Solve for the UTC instant whose *local time in the zone* equals the parsed fields
    //    L = U + offset(U). Start with a guess and iterate (offset only changes at DST edges).
    let guess = Date.UTC(Y, M - 1, D, H, Min, S, Ms);
    let lastOffset = getOffsetMinutes(guess);
    let utc = guess - lastOffset * 60_000;
    for (let i = 0; i < 3; i++) {
        const off = getOffsetMinutes(utc);
        if (off === lastOffset) break;
        lastOffset = off;
        utc = guess - off * 60_000;
    }

    // 5) Build the offset label ±HH:MM
    const offMin = getOffsetMinutes(utc);
    const sign = offMin < 0 ? '-' : '+';
    const abs = Math.abs(offMin);
    const offHH = String(Math.floor(abs / 60)).padStart(2, '0');
    const offMM = String(abs % 60).padStart(2, '0');
    const offsetStr = `${sign}${offHH}:${offMM}`;

    // 6) Return the *original* wall-clock fields with the computed offset
    const pad = (n: any, len = 2) => String(n).padStart(len, '0');
    const hasSeconds = m[6] !== undefined;
    const hasMillis = m[7] !== undefined;

    const timeCore =
        `${pad(H)}:${pad(Min)}` +
        (hasSeconds ? `:${pad(S)}` : '') +
        (hasMillis ? `.${pad(Ms, 3)}` : '');

    return `${pad(Y, 4)}-${pad(M, 2)}-${pad(D, 2)}T${timeCore}${offsetStr}`;
}

export function fromISOtoLocal(isoDateStr: string) {
    const isoDate = isoDateStr.slice(0, 19);
    const [y, m, d] = isoDate.split('-');
    const [day, time] = d.split('T');
    let h = 0, min = 0, sec = 0;
    if (time) {
        [h, min, sec] = time.split(':').map(Number);
    }
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(day), h, min, sec || 0));
}

export function now() {
    return new Date();
}

export function coerceLimit(n: any, def = 10, max = 25) {
    const v = Number(n);
    if (!Number.isFinite(v)) return def;
    return Math.min(Math.max(v, 1), max);
}

export function maskEmail(email?: string | null) {
    if (!email) return '';
    const [user, domain] = email.split('@');
    if (!domain) return email.replace(/.(?=.{2})/g, '*');
    const u = user.length <= 2 ? user[0] + '*' : user.slice(0, 2) + '***';
    const parts = domain.split('.');
    const d0 = parts[0] || '';
    const d = (d0.slice(0, 1) || '*') + '***' + (parts.length > 1 ? '.' + parts.slice(1).join('.') : '');
    return `${u}@${d}`;
}

export async function performAPIAction(req: Request, action: (body: any, profileId: string) => Promise<void>) {
    const profileId = req.session.profile?.id;
    if (profileId) await action(req.body, profileId);
    else throw new APIError('Unknown user', {}, 401);
}

export function getResource(req: Request, entityName: string) {
    return req.resource ? req.resource[entityName] : undefined;
}

export function getAdditional(req: Request, entityName: string, appendList: any[] = []) {
    appendList.push(req.resource ? req.resource[entityName] : undefined);
    return appendList;
}

export function isWithinWindow(start: string | Date, end: string | Date, a: string | Date, d: string | Date) {
    return a <= d && a >= start && d <= end;
}

/**
 * Utility: add N days to a YYYY-MM-DD string (UTC-safe).
 */
function addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/**
 * Utility: compare YYYY-MM-DD strings (lexicographic works for ISO dates).
 */
function minDate(a: string, b: string) {
    return a < b ? a : b;
}

function maxDate(a: string, b: string) {
    return a > b ? a : b;
}

/**
 * Pure helper that builds date totals from an event window and registrations.
 * Each registration contributes 1 to every day between arrival and departure (inclusive).
 */
export function buildDateTotals(
    eventStart: string,
    eventEnd: string,
    regs: Array<{ arrivalDate: string | null; departureDate: string | null }>
): Record<string, number> {
    // Initialize all days in the event window to 0
    const totals: Record<string, number> = {};
    let cur = eventStart;
    while (cur <= eventEnd) {
        totals[cur] = 0;
        cur = addDays(cur, 1);
    }

    // Tally each registration
    for (const r of regs) {
        const arr = r.arrivalDate ?? eventStart;
        const dep = r.departureDate ?? eventEnd;

        // Clamp to event window
        let start = maxDate(arr, eventStart);
        let end = minDate(dep, eventEnd);
        if (start > end) continue; // outside window or invalid

        // Increment each covered day
        let d = start;
        while (d <= end) {
            totals[d] = (totals[d] ?? 0) + 1;
            d = addDays(d, 1);
        }
    }

    return totals;
}

export async function ignoreException(fct: () => any) {
    try {
        return await fct();
    } catch (err) {
        console.warn(err);
    }
}

export function getPermFct(resFct: GetResource, entityName: EntityType): EntityGetter {
    const permFct = (req: Request): EntityDescriptor => {
        const resource = resFct(req);
        return {
            entityType: entityName,
            entityId: resource?.id,
            ownerId: resource?.ownerId,
            eventId: entityName === "event" ? resource?.id : resource?.eventId,
        };
    }
    return permFct;
}

export function getPermFctItems(resFct: GetResource, resFctItems: GetAdditional, entityName: EntityType, additionalName: EntityItemType): ItemWithParentGetter {
    const permFctItems = (req: Request): ItemSubject => {
        const param: any = req.params.itemId || req.params.slotId;
        const resource = resFctItems(req).find(r => r?.id === param);
        const parent = resFct(req);
        const result: ItemSubject = {
            item: {
                entityType: additionalName,
                entityId: resource?.id,
                ownerId: resource?.ownerId ?? resource?.profileId,
                eventId: parent?.eventId,
            },
            parent: {
                entityType: entityName,
                entityId: resource?.entityId ?? parent?.id,
                ownerId: parent?.ownerId,
                eventId: parent?.eventId,
            }
        };
        return result;
    }
    return permFctItems;
}

export function getPermFctAssign(resFct: GetResource, resFctItems: GetAdditional, entityName: EntityType, additionalName: EntityItemType): ItemWithParentGetter {
    const permFctItems = (req: Request): ItemSubject => {
        const param: number = Number.parseInt(req.params.assignId as string);
        const assign = resFctItems(req).find(r => r?.id === param);
        const resource = assign?.item || assign?.slot;
        const parent = resFct(req);
        const result: ItemSubject = {
            item: {
                entityType: additionalName,
                entityId: resource?.id,
                ownerId: resource?.ownerId ?? resource?.profileId,
                eventId: parent?.eventId,
            },
            parent: {
                entityType: entityName,
                entityId: resource?.entityId ?? parent?.id,
                ownerId: parent?.ownerId,
                eventId: parent?.eventId,
            }
        };
        return result;
    }
    return permFctItems;
}

export function getItemFromEntityPermFct(getItems: (id: string) => Promise<any[]>, resFct: GetResource, entityItemType?: EntityItemType): ItemGetter {
    return async (req: Request) => {
        if (!entityItemType) return [];

        const resource = resFct(req);
        const items = await getItems(resource?.id) ?? [];
        const res: ItemDescriptor[] = [];
        for (let item of items) {
            res.push({
                entityType: entityItemType,
                entityId: item.id,
                ownerId: item.ownerId ?? item.profileId,
                eventId: item.eventId ?? resource?.eventId,
            })
        }
        return res;
    }
}

export function jsonReplacer(key: any, value: any) {
    if (value instanceof Map) {
        return {
            dataType: 'Map',
            value: Array.from(value.entries()), // or with spread: value: [...value]
        };
    } else {
        return value;
    }
}

// Builds the guest edit link for emails and redirects using Node.js URL API
export function buildGuestLink(guestId: string, token: string) {
    // Construct the path segments and ensure proper encoding
    const pathSegments = ['guest', guestId, 'login', token]
        .map(segment => encodeURIComponent(String(segment)))
        .join('/');
    // Ensure rootUrl ends with a slash
    let base = settings.value.rootUrl;
    base = base.endsWith('/') ? base : base + '/';
    return new URL(pathSegments, base).toString();
}

export const ENTITIES: Record<string, EntityType> = {
    ACTIVITY: 'activity',
    DRIVERS: 'drivers',
    EVENT: 'event',
    PACKING: 'packing',
    SURVEY: 'survey',
}

export const ENTITY_ITEMS: Record<string, EntityItemType> = {
    ACTIVITY: 'activitySlot',
    DRIVERS: 'driversItem',
    EVENT: 'eventRegistration',
    PACKING: 'packingItem',
    SURVEY: 'surveyItem',
}

// simple allowlist to keep LIKE fast and avoid expensive patterns
export const SQL_ALLOW_LIST = /^[a-z0-9._+\-@ ]{3,}$/i;

export function merge<A>(a: A[], b: A[], predicate = (a: A, b: A) => a === b) {
    const c = [...a]; // copy to avoid side effects
    // add all items from B to copy C if they're not already present
    b.forEach((bItem) => (c.some((cItem) => predicate(bItem, cItem)) ? null : c.push(bItem)))
    return c;
}

export function convertToSingleList(entities: Partial<DashboardEntities>) {
    const list: Entity[] = [];
    for (const survey of entities.surveys ?? []) {
        list.push(convertEntity(survey, ENTITIES.SURVEY));
    }
    for (const activity of entities.activityPlans ?? []) {
        list.push(convertEntity(activity, ENTITIES.ACTIVITY));
    }
    for (const packing of entities.packingLists ?? []) {
        list.push(convertEntity(packing, ENTITIES.PACKING));
    }
    for (const driver of entities.driversLists ?? []) {
        list.push(convertEntity(driver, ENTITIES.DRIVERS));
    }
    for (const event of entities.events ?? []) {
        list.push(convertEntity(event, ENTITIES.EVENT));
    }
    return list;
}

export function convertEntity(entity: EntityBase, entityType: EntityType) {
    const entityUrl = `/${entityType}/${entity.id}`
    return {
        id: entity.id,
        title: entity.title,
        description: entity.description,
        imageUrl: entity.headerImg ? `${entityUrl}/header` : undefined,
        type: entityType,
        ownerId: entity.ownerId,
        url: entityUrl,
        eventId: entity.eventId,
    } as Entity;
}

export function normalizeToArray<A>(thing: A | A[], fallback: A[] = []) {
    let arr: A[] = fallback;
    if (Array.isArray(thing)) {
        arr = thing;
    } else if (thing) {
        arr = [thing];
    }

    return arr;
}