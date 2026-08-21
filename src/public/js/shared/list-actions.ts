/**
 * Shared list actions
 * Provides reusable functionality for list-level operations such as
 * assignment removal, item deletion, and quick add flows.
 */

import type {PermType} from '../../../types/PermissionTypes';
import {post} from '../core/http';
import {requireEntityPerm, requireItemPerm} from '../core/permissions';
import {showInlineAlert} from './alerts';
import {reloadAfterDelay} from './ui-helpers';

interface PermissionGuard {
    key: PermType;
    action: string;
    parentKey?: PermType;
}

function guardItemAction(itemId: string | null | undefined, guard: PermissionGuard): void {
    requireItemPerm(itemId || '', guard.key, guard.action, guard.parentKey);
}

function guardEntityAction(guard: PermissionGuard): void {
    requireEntityPerm(guard.key, guard.action);
}

/**
 * Configuration for assignment removal functionality
 */
export interface AssignmentRemovalConfig {
    /** Base API URL */
    baseUrl: string;
    /** Optional: reload delay in ms (default: 100) */
    reloadDelay?: number;
    /** Optional: permission override */
    guard?: PermissionGuard;
}

/**
 * Initialize assignee removal from list items
 * @param config Configuration object
 */
export function initAssignmentRemoval(config: AssignmentRemovalConfig): void {
    const reloadDelay = config.reloadDelay ?? 100;
    const guard = config.guard ?? {
        key: 'MANAGE_ASSIGNMENTS',
        action: 'remove assignments',
        parentKey: 'MANAGE_ASSIGNMENTS'
    };

    document.addEventListener('click', async (e: Event) => {
        const btn = (e.target as Element | null)?.closest('button[data-owner-remove]');
        if (!btn) return;

        const assignId = (btn as HTMLElement).dataset.assignid;
        const itemId = (btn as HTMLElement).closest<HTMLElement>('[data-itemid]')?.dataset.itemid;
        try {
            guardItemAction(itemId, guard);
            await post(`${config.baseUrl}/assignment/${assignId}/delete`, {});
            showInlineAlert('success', 'Removed');
            reloadAfterDelay(reloadDelay);
        } catch (err) {
            const error = err as Error;
            showInlineAlert('error', error.message);
        }
    });
}

/**
 * Configuration for item deletion functionality
 */
export interface ItemDeletionConfig {
    /** Base API URL */
    baseUrl: string;
    /** Confirmation message */
    confirmMessage: string;
    /** Success message */
    successMessage: string;
    /** Optional: reload delay in ms (default: 100) */
    reloadDelay?: number;
    /** Optional: permission override */
    guard?: PermissionGuard;
    /** Optional: selector override */
    selector?: string;
}

/**
 * Initialize item deletion handlers
 * @param config Configuration object
 */
export function initItemDeletion(config: ItemDeletionConfig): void {
    const reloadDelay = config.reloadDelay ?? 100;
    const selector = config.selector || '[data-delete-item]';
    const guard = config.guard ?? {
        key: 'ITEM_DELETE',
        action: 'delete items',
        parentKey: 'ITEM_DELETE'
    };

    document.addEventListener('click', async (e: Event) => {
        const btn = (e.target as Element | null)?.closest(selector);
        if (!btn) return;

        if (!confirm(config.confirmMessage)) return;

        const itemId = (btn as HTMLElement).dataset.itemid;
        try {
            guardItemAction(itemId, guard);
            await post(`${config.baseUrl}/item/${itemId}/delete`, {});
            showInlineAlert('success', config.successMessage);
            reloadAfterDelay(reloadDelay);
        } catch (err) {
            const error = err as Error;
            showInlineAlert('error', error.message);
        }
    });
}

/**
 * Configuration for quick add form
 */
export interface QuickAddConfig {
    /** Base API URL */
    baseUrl: string;
    /** Form ID or element */
    formId?: string;
    /** Optional: form element */
    formElement?: HTMLFormElement;
    /** Optional: reload delay in ms (default: 100) */
    reloadDelay?: number;
    /** Optional: permission override */
    guard?: PermissionGuard;
}

/**
 * Initialize quick add form functionality
 * @param config Configuration object
 */
export function initQuickAdd(config: QuickAddConfig): void {
    const quickForm = config.formElement || (config.formId ? document.getElementById(config.formId) as HTMLFormElement : null);
    if (!quickForm) return;

    const reloadDelay = config.reloadDelay ?? 100;
    const guard = config.guard ?? {key: 'ITEM_ADD', action: 'add new items'};

    quickForm.addEventListener('submit', async (e: Event) => {
        e.preventDefault();
        try {
            guardEntityAction(guard);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Not allowed to add items.';
            showInlineAlert('error', message);
            return;
        }
        const data = Object.fromEntries(new FormData(quickForm as HTMLFormElement).entries());

        try {
            await post(`${config.baseUrl}/items`, data);
            showInlineAlert('success', 'Added');
            reloadAfterDelay(reloadDelay);
        } catch (err) {
            const error = err as Error;
            showInlineAlert('error', error.message);
        }
    });
}
