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

import { Request } from "express";
import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import settings from "../settings";

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
// This keeps email/audit messages readable without duplicating lookup logic across application services.
export function resolveActorLabel(session: Request["session"] | undefined | null): string {
    if (session?.dataSpace?.name) return session.dataSpace.name;
    if (session?.dataSpace?.user?.username) return session.dataSpace.user.username;
    return "an organizer";
}

// Sanitize text for use in email content to prevent injection attacks
export function sanitizeForEmail(text: string): string {
    // Remove control characters and limit to printable characters
    return text.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
}

// Funktion zur Generierung eines einzigartigen Tokens
export function generateUniqueToken() {
    return crypto.randomBytes(32).toString("hex");
}

export function generateUniqueId() {
    return uuidv4();
}

// Returns 'YYYY-MM-DD' in the server's local time zone
export function toLocalISODate(dateObj: Date) {
    const y = dateObj.getUTCFullYear();
    const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

export function toLocalISOTime(dateObj: Date) {
    const y = dateObj.getUTCFullYear();
    const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getUTCDate()).padStart(2, "0");
    const h = String(dateObj.getUTCHours()).padStart(2, "0");
    const min = String(dateObj.getUTCMinutes()).padStart(2, "0");
    const sec = String(dateObj.getUTCSeconds()).padStart(2, "0");
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
    const m = new RegExp(
        /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|[+-]\d{2}:?\d{2})?$/,
    ).exec(isoString.trim());
    if (!m) throw new Error("Invalid ISO datetime");

    const [, y, mo, d, h, mi, s = "00", ms = "0"] = m;
    const Y = +y,
        M = +mo,
        D = +d,
        H = +h,
        Min = +mi,
        S = +s,
        Ms = +ms.padEnd(3, "0");

    // 2) Helper: get offset in minutes for a given UTC epoch in the target zone
    function getOffsetMinutes(epochMs: number) {
        const p = new Intl.DateTimeFormat("en-US", {
            timeZone,
            timeZoneName: "shortOffset",
        })
            .formatToParts(new Date(epochMs))
            .find((x) => x.type === "timeZoneName");

        // p.value examples: "GMT", "GMT+2", "GMT-05:30"
        const m = p?.value.match(/^GMT(?:(?<sign>[+-])(?<hh>\d{1,2})(?::?(?<mm>\d{2}))?)?$/);
        if (!m) return 0;
        const sign = m.groups?.sign === "-" ? -1 : 1;
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
    const sign = offMin < 0 ? "-" : "+";
    const abs = Math.abs(offMin);
    const offHH = String(Math.floor(abs / 60)).padStart(2, "0");
    const offMM = String(abs % 60).padStart(2, "0");
    const offsetStr = `${sign}${offHH}:${offMM}`;

    // 6) Return the *original* wall-clock fields with the computed offset
    const pad = (n: any, len = 2) => String(n).padStart(len, "0");
    const hasSeconds = m[6] !== undefined;
    const hasMillis = m[7] !== undefined;

    const timeCore =
        `${pad(H)}:${pad(Min)}` +
        (hasSeconds ? `:${pad(S)}` : "") +
        (hasMillis ? `.${pad(Ms, 3)}` : "");

    return `${pad(Y, 4)}-${pad(M, 2)}-${pad(D, 2)}T${timeCore}${offsetStr}`;
}

export function fromISOtoLocal(isoDateStr: string) {
    const isoDate = isoDateStr.slice(0, 19);
    const [y, m, d] = isoDate.split("-");
    const [day, time] = d.split("T");
    let h = 0,
        min = 0,
        sec = 0;
    if (time) {
        [h, min, sec] = time.split(":").map(Number);
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
    if (!email) return "";
    const [user, domain] = email.split("@");
    if (!domain) return email.replace(/.(?=.{2})/g, "*");
    const u = user.length <= 2 ? user[0] + "*" : user.slice(0, 2) + "***";
    const parts = domain.split(".");
    const d0 = parts[0] || "";
    const d =
        (d0.slice(0, 1) || "*") + "***" + (parts.length > 1 ? "." + parts.slice(1).join(".") : "");
    return `${u}@${d}`;
}

export const SQL_ALLOW_LIST = /^[a-z0-9._+\-@ ]{3,}$/i;

export function jsonReplacer(_key: string, value: unknown): unknown {
    return value instanceof Map ? { dataType: "Map", value: [...value.entries()] } : value;
}

export function mergeUnique<T>(
    left: readonly T[],
    right: readonly T[],
    equals: (a: T, b: T) => boolean = Object.is,
): T[] {
    return [...left, ...right.filter((item) => !left.some((existing) => equals(item, existing)))];
}

export function normalizeToArray<T>(value: T | readonly T[] | null | undefined): readonly T[] {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value as T];
}
