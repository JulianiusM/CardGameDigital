export type AccountSnapshot = {
    user: { id: number; username: string; name: string; email: string };
    activeDataSpaceId: string | null;
    dataSpaces: Array<{ id: string; name: string; defaultForOwner: boolean }>;
};
export type AccountConfiguration = {
    localLoginEnabled: boolean;
    oidcEnabled: boolean;
    oidcName: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`/api/v1/account${path}`, {
        headers: { "accept-language": locale, "content-type": "application/json" },
        ...init,
    });
    if (response.status === 204) return undefined as T;
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? messages.common.requestFailed);
    return body;
}

const json = (method: string, body: object): RequestInit => ({
    method,
    body: JSON.stringify(body),
});

export const accountApi = {
    configuration: () => request<AccountConfiguration>("/configuration"),
    current: () => request<AccountSnapshot>("/me"),
    register: (body: object) => request<void>("/register", json("POST", body)),
    login: (username: string, password: string) =>
        request<AccountSnapshot>("/login", json("POST", { username, password })),
    logout: () => request<void>("/logout", { method: "POST" }),
    activate: (token: string) => request<void>("/activate", json("POST", { token })),
    requestReset: (identifier: string) =>
        request<void>("/password-reset-requests", json("POST", { identifier })),
    reset: (token: string, password: string) =>
        request<void>("/password-resets", json("POST", { token, password })),
    createDataSpace: (name: string) => request("/data-spaces", json("POST", { name })),
    selectDataSpace: (id: string) =>
        request<AccountSnapshot>("/data-spaces/current-selection", json("PUT", { id })),
    updateDataSpace: (name: string, isDefault: boolean) =>
        request<AccountSnapshot>("/data-spaces/current", json("PUT", { name, isDefault })),
    delete: (username: string) => request<void>("/me", json("DELETE", { username })),
};
import { locale, messages } from "./i18n";
