/**
 * Core form utility functions
 * Provides helpers for form manipulation and data extraction
 */

/**
 * Get selected values from a multi-select element
 * @param select HTML select element
 * @returns Array of selected values
 */
export function getSelectValues(select: HTMLSelectElement): string[] {
    const result: string[] = [];
    const options = select && select.options;

    for (let i = 0, iLen = options.length; i < iLen; i++) {
        const opt = options[i];
        if (opt.selected) {
            result.push(opt.value || opt.text);
        }
    }
    return result;
}

/**
 * Convert object to array format
 * @param obj Object to convert
 * @returns Tuple of [keys, values]
 */
export function objectToArray(obj: any): [string[], any[]] {
    const arr = [];
    const idx = [];
    const keys = Object.keys(obj).sort();

    for (let i = 0; i < keys.length; i++) {
        arr.push(obj[keys[i]]);
        idx.push(keys[i]);
    }

    return [idx, arr];
}

/**
 * Serialize form data to an object
 * @param form HTML form element
 * @returns Object with form data
 */
export function serializeForm(form: HTMLFormElement): Record<string, any> {
    const formData = new FormData(form);
    return Object.fromEntries(formData as any);
}
