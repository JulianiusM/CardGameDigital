/**
 * Shared drag-and-drop functionality
 * Provides reusable drag-and-drop reordering for tables and lists
 */

import { post } from '../core/http';
import { showInlineAlert } from './alerts';
import { reloadAfterDelay } from './ui-helpers';

/**
 * Configuration for table row reordering
 */
export interface TableReorderConfig {
    /** Table body selector */
    tbodySelector: string;
    /** API endpoint for saving order */
    apiUrl: string;
    /** Function to extract item ID from row */
    getItemId: (row: HTMLTableRowElement) => string;
    /** Optional: called before reorder starts */
    onDragStart?: () => void;
    /** Optional: called after reorder completes */
    onDragEnd?: () => void;
}

/**
 * Initialize drag-and-drop reordering for table rows
 * @param config Configuration object
 */
export function initTableReorder(config: TableReorderConfig): void {
    const tbody = document.querySelector(config.tbodySelector);
    if (!tbody) return;
    
    let dragSrc: HTMLTableRowElement | null = null;

    tbody.addEventListener('dragstart', (e: Event) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (target.closest('button') || target.closest('input')) return;

        dragSrc = target.closest('tr') as HTMLTableRowElement | null;
        if (!dragSrc) return;

        const dragEvent = e as DragEvent;
        if (dragEvent.dataTransfer) {
            dragEvent.dataTransfer.effectAllowed = 'move';
        }
        
        if (config.onDragStart) config.onDragStart();
    });

    tbody.addEventListener('dragover', (e: Event) => {
        if (!dragSrc) return;
        e.preventDefault();

        const target = e.target as HTMLElement | null;
        if (!target) return;
        
        const tr = target.closest('tr') as HTMLTableRowElement | null;
        if (!tr || tr === dragSrc) return;
        
        const rect = tr.getBoundingClientRect();
        const dragEvent = e as DragEvent;
        const clientY = dragEvent.clientY || 0;
        
        tr.parentNode!.insertBefore(
            dragSrc,
            (clientY - rect.top) > rect.height / 2 ? tr.nextSibling : tr
        );
    });

    tbody.addEventListener('dragend', async () => {
        if (!dragSrc) return;

        const orders = Array.from(tbody.children).map((tr, i) => ({
            itemId: config.getItemId(tr as HTMLTableRowElement),
            position: i,
        }));
        
        try {
            await post(config.apiUrl, { orders });
            showInlineAlert('success', 'Order saved');
        } catch (e) {
            const error = e as Error;
            showInlineAlert('error', error.message);
            // Reload to restore original order
            reloadAfterDelay(1000);
        } finally {
            dragSrc = null;
            if (config.onDragEnd) config.onDragEnd();
        }
    });

    // Make all rows draggable
    tbody.querySelectorAll('tr').forEach(tr => (tr as HTMLTableRowElement).draggable = true);
}

/**
 * Configuration for card/slot reordering (like activity slots)
 */
export interface CardReorderConfig {
    /** Parent container selector */
    containerClass: string;
    /** Card element selector */
    cardClass: string;
    /** API endpoint for saving order */
    apiUrl: string;
    /** Function to get order data from container */
    getOrderData: (container: HTMLElement) => any[];
}

/**
 * Initialize drag-and-drop reordering for cards/slots
 * @param config Configuration object
 */
export function initCardReorder(config: CardReorderConfig): void {
    let dragCard: HTMLElement | null = null;
    let dragParent: HTMLElement | null = null;

    /* start */
    document.addEventListener('dragstart', (e: Event) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (target.closest('button') || target.closest('input')) return;

        const card = target.closest(`.${config.cardClass}`) as HTMLElement | null;
        if (!card) return;

        dragCard = card;
        dragParent = card.parentElement;

        const dragEvent = e as DragEvent;
        if (dragEvent.dataTransfer) {
            dragEvent.dataTransfer.setData('text/plain', '');
            dragEvent.dataTransfer.effectAllowed = 'move';
        }
    });

    /* over – only same container */
    document.addEventListener('dragover', (e: Event) => {
        if (!dragCard) return;

        const target = e.target as HTMLElement | null;
        if (!target) return;
        
        const overCard = target.closest(`.${config.cardClass}`) as HTMLElement | null;
        if (!overCard || overCard === dragCard) return;
        if (overCard.parentElement !== dragParent) return;  // stay in column

        e.preventDefault();  // allow drop

        const rect = overCard.getBoundingClientRect();
        const dragEvent = e as DragEvent;
        const clientY = dragEvent.clientY || 0;
        
        dragParent!.insertBefore(
            dragCard,
            (clientY - rect.top) > rect.height / 2 ? overCard.nextSibling : overCard
        );
    });

    /* end – send new order */
    document.addEventListener('dragend', async () => {
        if (!dragCard || !dragParent) return;

        const order = config.getOrderData(dragParent);

        try {
            await post(config.apiUrl, { order });
            showInlineAlert('success', 'Reordered');
        } catch (err) {
            const error = err as Error;
            showInlineAlert('error', error.message);
        }
        
        dragCard = dragParent = null;
    });
}
