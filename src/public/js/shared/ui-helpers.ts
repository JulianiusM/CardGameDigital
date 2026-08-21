/**
 * Shared UI helper functions
 * Provides reusable UI component builders and utilities
 */

/**
 * Create a colored badge element for status display
 * @param status Status text
 * @param colorMap Optional color mapping for different statuses
 * @returns HTML string for badge
 */
export function createBadge(status: string, colorMap?: Record<string, string>): string {
    const defaultMap: Record<string, string> = {
        active: 'success',
        consumed: 'warning',
        expired: 'secondary',
        revoked: 'danger',
        success: 'success',
        info: 'info',
        warning: 'warning',
        danger: 'danger',
    };

    const map = colorMap || defaultMap;
    const cls = map[status.toLowerCase()] || 'secondary';
    return `<span class="badge text-bg-${cls} text-uppercase">${status}</span>`;
}

/**
 * Create a colored chip/pill badge (rounded badge)
 * @param text Chip text
 * @param variant Color variant (default: secondary)
 * @returns HTML string for chip
 */
export function createChip(text: string, variant: string = 'secondary'): string {
    return `<span class="badge rounded-pill text-bg-${variant} me-1">${text}</span>`;
}

/**
 * Create a dietary restriction chip with appropriate styling
 * @param choice Dietary choice text
 * @returns HTML string for dietary chip
 */
export function createDietaryChip(choice: string): string {
    const variant = choice === 'ALLERGIES' ? 'danger' : choice === 'COMMENT' ? 'warning' : 'secondary';
    return createChip(choice, variant);
}

/**
 * Show spinner and disable button
 * @param btn Button element
 */
export function showSpinner(btn: HTMLButtonElement): void {
    btn.disabled = true;
    const spinner = btn.querySelector('.spinner-border') as HTMLElement | null;
    if (spinner) spinner.classList.remove('d-none');
}

/**
 * Hide spinner and enable button
 * @param btn Button element
 */
export function hideSpinner(btn: HTMLButtonElement): void {
    btn.disabled = false;
    const spinner = btn.querySelector('.spinner-border') as HTMLElement | null;
    if (spinner) spinner.classList.add('d-none');
}

/**
 * Parse JSON from a script tag
 * @param id Script tag ID
 * @returns Parsed data or null
 */
export function parseJsonScript<T>(id: string): T | null {
    const el = document.getElementById(id);
    if (!el || !el.textContent) return null;
    try {
        return JSON.parse(el.textContent) as T;
    } catch {
        return null;
    }
}

/**
 * Reload the page after a delay
 * @param delayMs Delay in milliseconds (default: 100)
 */
export function reloadAfterDelay(delayMs: number = 100): void {
    setTimeout(() => location.reload(), delayMs);
}


/**
 * Update element text content to localized date string
 * @param element Element to update
 * @param date Date object or date string
 * @param options Intl.DateTimeFormatOptions (default: { dateStyle: "full" })
 */
export function updateToLocalString(
    element: HTMLElement,
    date: Date | string,
    options: Intl.DateTimeFormatOptions = {dateStyle: "full"}
): void {
    const dateObj = typeof date === 'string' ? new Date(Date.parse(date)) : date;
    element.textContent = dateObj.toLocaleString(undefined, options);
}

/**
 * Format milliseconds as human-readable duration
 * @param ms Milliseconds
 * @returns Formatted duration string (e.g., "2d 3h 45m")
 */
export function formatDuration(ms: number): string {
    if (ms <= 0) return "closed";
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
}

/**
 * Copy text to clipboard with visual feedback
 * @param text Text to copy
 * @param btn Optional button to show feedback on
 * @returns Promise that resolves when copy is complete
 */
export async function copyWithFeedback(text: string, btn?: HTMLButtonElement): Promise<void> {
    if (btn) showSpinner(btn);

    try {
        if (navigator.clipboard) {
            await navigator.clipboard.writeText(text);
        } else {
            // Fallback for older browsers
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
    } finally {
        if (btn) {
            setTimeout(() => hideSpinner(btn), 300);
        }
    }
}
