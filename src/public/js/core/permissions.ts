/**
 * Core permissions utilities
 * Handles permission loading and checking
 */

import type {PermBundle, PermType, PermView} from "../../../types/PermissionTypes";

/**
 * JSON reviver for deserializing Map objects
 * @param key Property key
 * @param value Property value
 * @returns Deserialized value
 */
export function jsonReviver(key: any, value: any): any {
    if (typeof value === 'object' && value !== null) {
        if (value.dataType === 'Map') {
            return new Map(value.value);
        }
    }
    return value;
}

/**
 * Restore a PermView object from serialized data
 * @param data Serialized permission view data
 * @param parentData Optional parent permission data
 * @returns Restored PermView object
 */
function restorePermView(data: Partial<PermView>, parentData?: Partial<PermView>): PermView {
    const selfHas = (k: PermType) => (data.bits ? data.bits[k] : false) ?? false;
    const parentHas = (k: PermType) => (parentData?.bits ? parentData.bits[k] : false) ?? false;

    return {
        mask: data.mask!,
        parentMask: data.parentMask!,
        has: selfHas,
        allow: (k, parentKey) => {
            const parentKeys = parentKey !== undefined
                ? (Array.isArray(parentKey) ? parentKey : [parentKey])
                : [k];

            return selfHas(k) || parentKeys.some(parentHas);
        },
        all: (...keys) => keys.every(selfHas),
        any: (...keys) => keys.some(selfHas),
        bits: data.bits!
    };
}

/**
 * Restore a PermBundle from serialized data
 * @param data Serialized permission bundle data
 * @returns Restored PermBundle object
 */
function restorePermBundle(data: Partial<PermBundle>): PermBundle {
    const entity = restorePermView(data.entity!);
    const itemMap = data.items!;

    for (let key of itemMap.keys()) {
        itemMap.set(key, restorePermView(itemMap.get(key)!, entity));
    }

    const empty = restorePermView({mask: 0, parentMask: entity.mask, bits: {}}, entity);
    const getItem = (id: string) => itemMap.get(id) ?? empty;

    const bundle: PermBundle = {
        entity: restorePermView(data.entity!),
        items: itemMap,
        item: getItem,
        itemHas: (id: string, key: PermType) => getItem(id).has(key),
        itemAllow: (id: string, key: PermType, parentKey?: PermType | PermType[]) => getItem(id).allow(key, parentKey),
    };

    return bundle;
}

/**
 * Load permissions from window.PERM_DATA
 * Restores permission bundle and stores it in window.PERMS
 */
export function loadPerms(): void {
    if (window.Surveyor.rawPermissions) {
        window.Surveyor.permissions = restorePermBundle(JSON.parse(window.Surveyor.rawPermissions, jsonReviver));
    }
}

/**
 * Access the hydrated permission bundle
 * @returns The permission bundle from window
 */
export function getPerms(): PermBundle | undefined {
    return window.Surveyor.permissions as PermBundle | undefined;
}

function formatPerm(key: PermType): string {
    return key
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function ensurePermData(): PermBundle {
    const perms = getPerms();
    if (!perms) {
        throw new Error('Permission data is missing. Please refresh and try again.');
    }
    return perms;
}

/**
 * Require an entity-level permission
 * @param key Permission key
 * @param action Human readable action for error messages
 */
export function requireEntityPerm(key: PermType, action: string): void {
    const perms = ensurePermData();
    if (!perms.entity.has(key)) {
        throw new Error(`You need ${formatPerm(key)} permission to ${action}.`);
    }
}

export interface EntityFormRule {
    /** Permission key required for the change */
    perm: PermType;
    /** Human-readable action */
    action: string;
    /** Field names that trigger the check */
    fields?: string[];
    /** Custom predicate to trigger the check */
    predicate?: (formData: FormData) => boolean;
}

/**
 * Require entity-level permissions based on pending form changes
 * @param formData Form data to inspect
 * @param rules Rules mapping fields/predicates to permissions
 */
export function requireEntityPermsForForm(formData: FormData, rules: EntityFormRule[]): void {
    const perms = ensurePermData();
    for (const rule of rules) {
        const matches = rule.predicate
            ? rule.predicate(formData)
            : (rule.fields ?? []).some((field) => formData.has(field));

        if (matches && !perms.entity.has(rule.perm)) {
            throw new Error(`You need ${formatPerm(rule.perm)} permission to ${rule.action}.`);
        }
    }
}

/**
 * Require an item-level permission (with optional parent fallback)
 * @param itemId Item identifier
 * @param key Permission key to check on the item
 * @param action Human readable action for error messages
 * @param parentKey Optional parent permission to fall back to
 */
export function requireItemPerm(
    itemId: string,
    key: PermType,
    action: string,
    parentKey?: PermType | PermType[],
): void {
    const perms = ensurePermData();
    if (!itemId) {
        throw new Error('Missing item context for permission check.');
    }
    if (!perms.itemAllow(itemId, key, parentKey)) {
        const parentDisplay = Array.isArray(parentKey) ? parentKey[0] : parentKey;
        const permName = formatPerm(parentDisplay ?? key);
        throw new Error(`You need ${permName} permission to ${action}.`);
    }
}
