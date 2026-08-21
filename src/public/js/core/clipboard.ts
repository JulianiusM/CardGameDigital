/**
 * Core clipboard utilities
 * Provides cross-browser clipboard operations
 */

/**
 * Copy text to clipboard
 * Falls back to execCommand if Clipboard API is unavailable
 * @param text Text to copy
 * @returns Promise that resolves when copy is complete
 */
export function copyToClipboard(text: string): Promise<void> {
    // Modern Clipboard API
    if (navigator.clipboard) {
        return navigator.clipboard.writeText(text);
    }
    
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    
    try {
        document.execCommand('copy');
        document.body.removeChild(ta);
        return Promise.resolve();
    } catch (err) {
        document.body.removeChild(ta);
        return Promise.reject(err);
    }
}
