import { writable } from "svelte/store";
import { accountApi, type AccountSnapshot, type AccountStatus } from "./accountApi";

const initial: AccountStatus = {
    authenticationAvailable: false,
    localLoginEnabled: false,
    oidcEnabled: false,
    oidcName: "",
    imprintUrl: "",
    privacyPolicyUrl: "",
    deploymentMode: "local",
    authenticated: false,
    account: null,
};

export const authentication = writable<AccountStatus>(initial);

export async function refreshAuthentication(): Promise<AccountStatus> {
    const status = await accountApi.status();
    authentication.set(status);
    return status;
}

export function setAuthenticatedAccount(
    configuration: Pick<
        AccountStatus,
        | "authenticationAvailable"
        | "localLoginEnabled"
        | "oidcEnabled"
        | "oidcName"
        | "imprintUrl"
        | "privacyPolicyUrl"
        | "deploymentMode"
    >,
    account: AccountSnapshot,
): void {
    authentication.set({ ...configuration, authenticated: true, account });
}

export function clearAuthenticatedAccount(configuration: AccountStatus): void {
    authentication.set({ ...configuration, authenticated: false, account: null });
}
