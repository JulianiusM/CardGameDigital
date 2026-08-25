import { messages } from "./i18n";
import { fetchJsonResponse } from "./http";

export type AccountSnapshot = {
    user: { id: number; username: string; name: string; email: string };
    activeDataSpaceId: string | null;
    dataSpaces: Array<{ id: string; name: string; defaultForOwner: boolean }>;
    languagePreferences: LanguagePreferences | null;
};
export type LanguagePreferences = {
    useSystemLanguage: boolean;
    interfaceLocale: string | null;
    cardLocale: string | null;
    fallbackLocales: string[];
};
export type AccountConfiguration = {
    localLoginEnabled: boolean;
    oidcEnabled: boolean;
    oidcName: string;
    imprintUrl: string;
    privacyPolicyUrl: string;
};
export type AccountStatus = AccountConfiguration & {
    authenticationAvailable: boolean;
    deploymentMode: "local" | "public";
    authenticated: boolean;
    account: AccountSnapshot | null;
};
export type AccountSessionSummary = {
    id: string;
    current: boolean;
    expiresAt: number;
};

export class AccountApiError extends Error {
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const { response, body: unknownBody } = await fetchJsonResponse(`/api/v1/account${path}`, init);
    if (response.status === 204) return undefined as T;
    const body = unknownBody as { error?: { code?: string; message?: string } };
    if (!response.ok)
        throw new AccountApiError(
            body.error?.code ?? "UNKNOWN_ERROR",
            body.error?.message ?? messages.common.requestFailed,
        );
    return unknownBody as T;
}

const json = (method: string, body: object): RequestInit => ({
    method,
    body: JSON.stringify(body),
});

export const accountApi = {
    configuration: () => request<AccountConfiguration>("/configuration"),
    status: () => request<AccountStatus>("/status"),
    current: () => request<AccountSnapshot>("/me"),
    register: (body: object) => request<void>("/register", json("POST", body)),
    login: (username: string, password: string) =>
        request<AccountSnapshot>("/login", json("POST", { username, password })),
    logout: () => request<void>("/logout", { method: "POST" }),
    activate: (token: string) => request<void>("/activate", json("POST", { token })),
    requestReset: (identifier: string) =>
        request<void>("/password-reset-requests", json("POST", { identifier })),
    requestActivation: (identifier: string) =>
        request<void>("/activation-requests", json("POST", { identifier })),
    reset: (token: string, password: string) =>
        request<void>("/password-resets", json("POST", { token, password })),
    createDataSpace: (name: string) =>
        request<{ id: string; name: string; defaultForOwner: boolean }>(
            "/data-spaces",
            json("POST", { name }),
        ),
    deleteDataSpace: (id: string) =>
        request<AccountSnapshot>(`/data-spaces/${encodeURIComponent(id)}`, {
            method: "DELETE",
        }),
    selectDataSpace: (id: string) =>
        request<AccountSnapshot>("/data-spaces/current-selection", json("PUT", { id })),
    updateDataSpace: (name: string, isDefault: boolean) =>
        request<AccountSnapshot>("/data-spaces/current", json("PUT", { name, isDefault })),
    updateLanguagePreferences: (patch: Partial<LanguagePreferences>) =>
        request<AccountSnapshot>("/language-preferences", json("PUT", patch)),
    sessions: () =>
        request<{ sessions: AccountSessionSummary[] }>("/sessions").then(
            (result) => result.sessions,
        ),
    revokeSession: (id: string) =>
        request<void>(`/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
    delete: (username: string) => request<void>("/me", json("DELETE", { username })),
};
