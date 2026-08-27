import settings from "./settings";

export const LOCAL_DISCOVERY_TXT_VERSION = 1;
export const API_BASE_PATH = "/api/v1";

export type LocalDiscoveryStatus = {
    advertising: boolean;
    serviceType: string;
    txtVersion: number;
    reason: string;
    interfaceCount: number;
    ipv4AddressCount: number;
    ipv6AddressCount: number;
};

let runtimeStatus: LocalDiscoveryStatus = {
    advertising: false,
    serviceType: "_partycard._tcp",
    txtVersion: LOCAL_DISCOVERY_TXT_VERSION,
    reason: "NOT_STARTED",
    interfaceCount: 0,
    ipv4AddressCount: 0,
    ipv6AddressCount: 0,
};
let advertisementSuccessTotal = 0;
let advertisementFailureTotal = 0;
const restartTotals = new Map<string, number>();

export function localDiscoveryStatus(): LocalDiscoveryStatus {
    return { ...runtimeStatus };
}

export function setLocalDiscoveryStatus(status: LocalDiscoveryStatus): void {
    runtimeStatus = { ...status };
}

export function recordLocalDiscoveryAdvertisement(result: "success" | "failure"): void {
    if (result === "success") advertisementSuccessTotal += 1;
    else advertisementFailureTotal += 1;
}

export function recordLocalDiscoveryRestart(reason: string): void {
    restartTotals.set(reason, (restartTotals.get(reason) ?? 0) + 1);
}

/** Low-cardinality process metrics for the deployment's monitoring adapter. */
export function localDiscoveryMetrics(): {
    advertiserState: string;
    advertisementTotal: { success: number; failure: number };
    restartTotal: Readonly<Record<string, number>>;
    interfaceCount: number;
    addressCount: { IPv4: number; IPv6: number };
} {
    return {
        advertiserState: runtimeStatus.reason,
        advertisementTotal: {
            success: advertisementSuccessTotal,
            failure: advertisementFailureTotal,
        },
        restartTotal: Object.fromEntries(restartTotals),
        interfaceCount: runtimeStatus.interfaceCount,
        addressCount: {
            IPv4: runtimeStatus.ipv4AddressCount,
            IPv6: runtimeStatus.ipv6AddressCount,
        },
    };
}

export function localNetworkDiscoveryCapability(): boolean {
    return settings.value.mdnsDiscoveryEnabled;
}
