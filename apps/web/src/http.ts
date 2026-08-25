import { locale, messages } from "./i18n";

export async function fetchJsonResponse(
    path: string,
    init: RequestInit = {},
): Promise<{ response: Response; body: unknown }> {
    const headers = new Headers(init.headers);
    headers.set("accept-language", locale);
    headers.set("content-type", "application/json");

    let response: Response;
    try {
        response = await fetch(path, { ...init, headers });
    } catch {
        throw new Error(messages.common.connectionFailed);
    }
    if (response.status === 204) return { response, body: undefined };
    try {
        return { response, body: await response.json() };
    } catch {
        throw new Error(
            response.ok ? messages.common.requestFailed : messages.common.connectionFailed,
        );
    }
}
