/**
 * Shared assignment/unassignment functionality
 * Provides reusable logic for assigning/unassigning items to users
 */

import {post} from '../core/http';
import {showInlineAlert} from './alerts';

/**
 * Configuration for assignment buttons
 */
export interface AssignmentConfig {
    /** Table selector */
    tableSelector: string;
    /** Base API URL (e.g., /packing/123) */
    baseUrl: string;
    /** Optional: reload delay in ms (default: 100) */
    reloadDelay?: number;
}

/**
 * Initialize assignment/unassignment buttons
 * Handles both "assign" and "unassign" actions with UI updates
 * @param config Configuration object
 */
export function initAssignButtons(config: AssignmentConfig): void {
    const table = document.querySelector(config.tableSelector);
    if (!table) return;

    const reloadDelay = config.reloadDelay ?? 100;

    table.addEventListener('click', async (evt: Event) => {
        const btn = (evt.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-action]');
        if (!btn) return;

        const tr = btn.closest('tr');
        const itemId = tr?.dataset.itemid;
        const action = btn.dataset.action;

        try {
            await post(`${config.baseUrl}/${action}`, {itemId});

            /* --- Count / Max update ------------------- */
            const cntSpan = tr?.querySelector('[data-count]');
            const maxSpan = tr?.querySelector('[data-max]');
            if (!cntSpan || !maxSpan) return location.reload();

            const cur = parseInt(cntSpan.textContent || '0', 10);
            const max = parseInt(maxSpan.textContent || '0', 10);
            const newCur = action === 'assign' ? cur + 1 : cur - 1;
            cntSpan.textContent = String(newCur);

            /* ------- Button & Badge ------------------------------------- */
            const cellAction = tr?.querySelector('td:last-child');
            let badge = cellAction?.querySelector('.badge');

            if (action === 'assign') {
                /* Button becomes "Remove" */
                btn.dataset.action = 'unassign';
                btn.classList.remove('btn-outline-success');
                btn.classList.add('btn-outline-danger');
                btn.textContent = 'Remove';

                /* Row is now full → show badge */
                if (newCur === max) {
                    if (!badge) {
                        badge = document.createElement('span');
                        badge.className = 'badge bg-secondary ms-1';
                        badge.textContent = 'Full';
                        cellAction?.appendChild(badge);
                    }
                }
            } else { /* action === 'unassign' */
                /* Button back to "Take" */
                btn.dataset.action = 'assign';
                btn.classList.remove('btn-outline-danger');
                btn.classList.add('btn-outline-success');
                btn.textContent = 'Take';

                /* Space freed → remove badge */
                if (newCur < max && badge) badge.remove();
            }

            showInlineAlert('success',
                `Item ${action === 'assign' ? 'assigned' : 'unassigned'}`);
            setTimeout(() => location.reload(), reloadDelay);
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Failed to update assignment.';
            showInlineAlert('error', message);
        }
    });
}
