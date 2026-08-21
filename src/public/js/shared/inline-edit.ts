/**
 * Shared inline editing functionality
 * Provides reusable inline editing for various entity attributes
 */

import type {PermType} from '../../../types/PermissionTypes';
import {post} from '../core/http';
import {getPerms, requireEntityPerm, requireItemPerm} from '../core/permissions';
import {showInlineAlert} from './alerts';
import {reloadAfterDelay} from './ui-helpers';

interface InlineEditPermission {
    scope: 'entity' | 'item';
    key: PermType;
    action: string;
    itemId?: string;
    parentKey?: PermType | PermType[];
}

interface InlineEditAreaOptions {
    payloadKey?: string;
    successMessage?: string;
    placeholder?: string;
    maxLength?: number;
    onSave?: () => void;
}

/**
 * Enable drag-and-drop for elements
 */
export function enableDnD(): void {
    const perms = getPerms();
    if (!perms?.entity.has('ITEM_EDIT')) return;
    const draggables = document.getElementsByClassName('draggable');
    for (const elem of Array.from(draggables)) {
        (elem as HTMLElement).draggable = true;
    }
}

/**
 * Disable drag-and-drop for elements
 */
export function disableDnD(): void {
    const draggables = document.getElementsByClassName('draggable');
    for (const elem of Array.from(draggables)) {
        (elem as HTMLElement).draggable = false;
    }
}

/**
 * Start inline editing for a textarea field (e.g., description)
 * @param elem Element to edit
 * @param url API endpoint for saving
 * @param permission Optional permission guard configuration
 */
export function startInlineEditArea(
    elem: HTMLElement,
    url: string,
    permission?: InlineEditPermission,
    options?: InlineEditAreaOptions,
): void {
    if (!elem || elem.querySelector('textarea')) return;

    const guard: InlineEditPermission = permission ?? {
        scope: 'entity',
        key: 'EDIT_DESC',
        action: 'edit descriptions'
    };

    const config: InlineEditAreaOptions & {
        payloadKey: string;
        successMessage: string;
        placeholder: string;
        maxLength: number;
    } = {
        payloadKey: options?.payloadKey ?? 'description',
        successMessage: options?.successMessage ?? 'Description updated',
        placeholder: options?.placeholder ?? 'double-click to add description',
        maxLength: options?.maxLength ?? 1999,
        onSave: options?.onSave,
    };

    try {
        if (guard.scope === 'item') {
            requireItemPerm(guard.itemId || '', guard.key, guard.action, guard.parentKey);
        } else {
            requireEntityPerm(guard.key, guard.action);
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Not allowed to edit.';
        showInlineAlert('error', message);
        return;
    }

    const old = elem.innerText.trim();

    const ta = document.createElement('textarea');
    ta.className = 'form-control text-bg-dark';
    ta.style.minHeight = '6rem';
    ta.value = old === config.placeholder ? '' : old;
    ta.maxLength = config.maxLength;

    elem.innerHTML = '';
    elem.appendChild(ta);
    ta.focus();

    function restore(val: string): void {
        if (val === config.placeholder) val = '';
        elem.innerHTML = val
            ? val.replace(/\n/g, '<br>')
            : `<em class="text-secondary">${config.placeholder}</em>`;
    }

    async function save(): Promise<void> {
        const val = ta.value.trim();
        try {
            await post(url, {[config.payloadKey]: val});
            restore(val);
            showInlineAlert('success', config.successMessage);
            if (config.onSave) config.onSave();
        } catch (err) {
            restore(old);
            const message = err instanceof Error ? err.message : 'Failed to update the description.';
            showInlineAlert('error', message);
        }
    }

    ta.addEventListener('blur', save);
    ta.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' && ev.ctrlKey) {
            ev.preventDefault();
            save();
        }
        if (ev.key === 'Escape') {
            restore(old);
            ta.blur();
        }
    });
}

/**
 * Start inline editing for a single-line field
 * @param elem Element to edit
 * @param baseUrl Base API URL for saving
 */
export function startInlineEdit(elem: HTMLElement, baseUrl: string): void {
    if (!elem || elem.querySelector('input')) return;

    disableDnD();

    const field = elem.dataset.edit;           // title | description | maxAssignees
    const id = elem.dataset.id;                // entity ID
    const isTd = elem.nodeName === 'TD';

    let old: string | undefined, countTxt: string | undefined;
    if (isTd && field === 'maxAssignees') {
        // Special handling for maxAssignees in table cells
        const cntSpan = elem.querySelector('[data-count]')!;
        countTxt = cntSpan.textContent?.trim();
        old = elem.querySelector('[data-max]')?.textContent?.trim();
    } else {
        old = elem.textContent?.trim();
    }

    const fieldGuard: Record<string, InlineEditPermission> = {
        description: {scope: 'item', key: 'EDIT_DESC', action: 'edit descriptions', itemId: id, parentKey: ['ITEM_EDIT', 'ITEM_EDIT_DESC']},
        default: {scope: 'item', key: 'EDIT_META', action: 'edit item details', itemId: id, parentKey: 'ITEM_EDIT'}
    };

    try {
        const guard = fieldGuard[field || ''] ?? fieldGuard.default;
        if (guard.scope === 'item') {
            requireItemPerm(guard.itemId || '', guard.key, guard.action, guard.parentKey);
        } else {
            requireEntityPerm(guard.key, guard.action);
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Not allowed to edit.';
        showInlineAlert('error', message);
        return;
    }

    const inp = document.createElement('input');
    inp.className = 'form-control form-control-sm text-bg-dark draggable-false';
    inp.type = field === 'maxAssignees' ? 'number' : 'text';
    inp.value = old || '';
    elem.textContent = '';
    elem.appendChild(inp);
    inp.focus();

    async function save(): Promise<void> {
        const val = inp.value.trim();
        if (val === old) {
            await rollback(old);
            return;
        }
        const url = `${baseUrl}/${id}/${field === 'description' ? 'description' : 'attr'}`;

        try {
            await post(url,
                field === 'description' ? {description: val}
                    : {field, value: val});
            rollback(val);
            showInlineAlert('success', 'Updated');
            if (field === 'maxAssignees') {
                reloadAfterDelay(100);
            }
        } catch (err) {
            await rollback(old);
            const message = err instanceof Error ? err.message : 'Failed to save changes.';
            showInlineAlert('error', message);
        }
    }

    async function rollback(val?: string): Promise<void> {
        if (isTd && field === 'maxAssignees') {
            const countSpan = elem.querySelector('[data-count]');
            const maxSpan = elem.querySelector('[data-max]');
            if (countSpan && maxSpan) {
                maxSpan.textContent = val || '';
            } else {
                elem.innerHTML = `<span data-count>${countTxt}</span> / <span data-max>${val}</span>`;
            }
        } else {
            elem.textContent = val || '';
        }
        enableDnD();
    }

    inp.addEventListener('blur', save);
    inp.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            save();
        }
        if (ev.key === 'Escape') rollback(old);
    });
}
