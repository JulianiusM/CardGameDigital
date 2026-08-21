/**
 * Core DOM utility functions
 * Provides consistent DOM query and manipulation helpers
 */

/**
 * Query selector helper with type safety
 * @param sel CSS selector
 * @param root Root element (default: document)
 * @returns Found element or null
 */
export function qs<T extends Element>(sel: string, root: ParentNode | Document = document): T | null {
    return root.querySelector(sel) as T | null;
}

/**
 * Query selector all helper with type safety
 * @param sel CSS selector
 * @param root Root element (default: document)
 * @returns Array of found elements
 */
export function qsAll<T extends Element>(sel: string, root: ParentNode | Document = document): T[] {
    return Array.from(root.querySelectorAll(sel)) as T[];
}

/**
 * Find closest ancestor element matching selector
 * @param element Starting element
 * @param selector CSS selector
 * @returns Found element or null
 */
export function closest<T extends Element>(element: Element | null, selector: string): T | null {
    return element?.closest(selector) as T | null;
}
