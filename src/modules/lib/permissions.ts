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

// src/modules/lib/permissions.ts
import type {PermData, PermMeta, PermPreset} from "../../types/PermissionTypes";
import type {CombEntityType} from "../../types/UtilTypes";

export const PERM = {
    EDIT_TITLE: 1,
    EDIT_DESC: 1 << 1,
    EDIT_CAPACITY: 1 << 2,
    EDIT_META: 1 << 3,

    ITEM_ADD: 1 << 4,
    ITEM_EDIT: 1 << 5,
    ITEM_EDIT_DESC: 1 << 18,
    ITEM_DELETE: 1 << 6,

    MANAGE_ASSIGNMENTS: 1 << 7,
    MANAGE_REQUIREMENTS: 1 << 8,
    MANAGE_REGISTRATIONS: 1 << 9,
    MANAGE_PERMISSIONS: 1 << 16,

    DATA_EXPORT: 1 << 10,
    DATA_DUPLICATE: 1 << 11,

    ACCESS_REGISTRATION: 1 << 12,
    ACCESS_VIEW: 1 << 13,
    ACCESS_CREATE: 1 << 14,
    ACCESS_ADMIN: 1 << 15,
    ACCESS_PARTICIPANTS: 1 << 17,
    ACCESS_ITEMS: 1 << 19,
} as const;

export function hasPerm(mask: number, p: number) {
    return (mask & p) === p;
}

// Useful presets
export const DEFAULT_PERM = (() => {
    const FULL_EDIT =
        PERM.EDIT_TITLE | PERM.EDIT_DESC | PERM.EDIT_CAPACITY | PERM.EDIT_META;
    const FULL_ITEM =
        PERM.ITEM_ADD | PERM.ITEM_EDIT | PERM.ITEM_EDIT_DESC | PERM.ITEM_DELETE;
    const FULL_MANAGE =
        PERM.MANAGE_ASSIGNMENTS | PERM.MANAGE_REQUIREMENTS | PERM.MANAGE_REGISTRATIONS | PERM.MANAGE_PERMISSIONS;
    const FULL_DATA =
        PERM.DATA_EXPORT | PERM.DATA_DUPLICATE;
    const FULL_ACCESS =
        PERM.ACCESS_REGISTRATION | PERM.ACCESS_CREATE | PERM.ACCESS_VIEW | PERM.ACCESS_ADMIN | PERM.ACCESS_PARTICIPANTS | PERM.ACCESS_ITEMS;

    return {
        FULL_EDIT,
        FULL_ITEM,
        FULL_MANAGE,
        FULL_DATA,
        FULL_ACCESS,

        ADMIN: FULL_EDIT | FULL_ITEM | FULL_MANAGE | FULL_DATA | FULL_ACCESS,
        DEFAULT_ENTITY: PERM.ACCESS_REGISTRATION | PERM.ACCESS_VIEW | PERM.ACCESS_CREATE | PERM.ACCESS_ITEMS,
    } as const satisfies Record<string, number>;
})();

export function getInitialPerms(entityType: CombEntityType): PermData {
    if (entityType == "event") {
        return {public: DEFAULT_PERM.DEFAULT_ENTITY, participant: PERM.ACCESS_PARTICIPANTS}
    }
    return {public: DEFAULT_PERM.DEFAULT_ENTITY};
}


export const ALL_MASK = Object.values(PERM).reduce((m, v) => m | (v as number), 0);

export function labelFromKey(k: string) {
    return k
        .toLowerCase()
        .replaceAll('_', ' ')
        .replace(/\b\w/g, c => c.toUpperCase()); // EDIT_META -> Edit Meta
}

// Build permMeta from PERM (auto-populate)
export function getPermMeta(): PermMeta[] {
    return Object.entries(PERM).map(([key, bit]) => ({
        key,
        bit,
        label: labelFromKey(key),
        // Optional: add desc for tooltips/help if you want
        // desc: ...
    }));
}

// Optional: expose presets
export function getPresets(): PermPreset[] {
    return Object.entries(DEFAULT_PERM).map(([k, mask]) => ({
        key: k,
        label: labelFromKey(k), // "Full Edit", "Manager", ...
        mask,
    }));
}

export function toMask(keys: string[] | undefined, perms: Record<string, number> = PERM) {
    if (!keys || !Array.isArray(keys)) return 0;
    return keys.reduce((m, k) => m | (perms[k] ?? 0), 0);
}

/** Convert posted keys (perm names) to a bitmask. Returns undefined if value is truly absent. */
export function toMaskFromBodyValue(val: unknown, permMap: Record<string, number>): number | undefined {
    if (val === undefined) return undefined; // key not present → leave unchanged
    let arr: string[] = [];
    if (Array.isArray(val)) {
        arr = val.filter((v): v is string => typeof v === 'string');
    } else if (!(val == null || val === '')) {
        arr = [String(val)];
    }
    let mask = 0;
    for (const k of arr) {
        const bit = permMap[k];
        if (typeof bit === 'number') mask |= bit;
    }
    return mask;
}

/** Optional: map of presets; used when adding via preset key */
export function getPresetMask(key: keyof typeof DEFAULT_PERM): number {
    return DEFAULT_PERM[key] ?? 0;
}
