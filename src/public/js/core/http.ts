/**
 * Core HTTP client utilities
 * Provides a consistent API for making HTTP requests across the application
 */

/**
 * Make an HTTP request
 * @param method HTTP method (GET, POST, DELETE, etc.)
 * @param url Request URL
 * @param body Request body (optional)
 * @returns Response data
 */
export async function http(method: string, url: string, body?: any): Promise<any> {
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    const res = await fetch(url, {
        method,
        headers: isFormData ? {'X-Requested-With': 'XMLHttpRequest'} : {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'same-origin',
        body: isFormData ? body : (body ? JSON.stringify(body) : undefined),
    });

    const ct = res.headers.get('content-type') || '';
    let data = ct.includes('application/json') ? await res.json() : await res.text().catch(() => '');
    if (!res.ok && !data?.status) {
        throw new Error(data || `HTTP ${res.status}`);
    }

    if (data?.status === 'error') {
        throw new Error(data.message || 'Request failed');
    }

    return data;
}

/**
 * Make a POST request
 * @param url Request URL (can include /api prefix or be relative)
 * @param payload Request payload
 * @returns Response data
 */
export async function post(url: string, payload: any = {}): Promise<any> {
    return http('POST', url, payload);
}

/**
 * Make a GET request
 * @param url Request URL (can include /api prefix or be relative)
 * @returns Response data
 */
export async function get(url: string): Promise<any> {
    return http('GET', url);
}

/**
 * Make a DELETE request
 * @param url Request URL (can include /api prefix or be relative)
 * @param body Request body (optional)
 * @returns Response data
 */
export async function del(url: string, body?: any): Promise<any> {
    return http('DELETE', url, body);
}

/**
 * Make a PUT request
 * @param url Request URL (can include /api prefix or be relative)
 * @param body Request body (optional)
 * @returns Response data
 */
export async function put(url: string, body?: any): Promise<any> {
    return http('PUT', url, body);
}

/**
 * Make a PATCH request
 * @param url Request URL (can include /api prefix or be relative)
 * @param payload Request payload
 * @returns Response data
 */
export async function patch(url: string, payload: any = {}): Promise<any> {
    return http('PATCH', url, payload);
}
