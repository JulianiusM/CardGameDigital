import os, { type NetworkInterfaceInfo } from "node:os";
import type { Settings } from "./settings";
import {
    ipv6AddressScope,
    localNetworkInterfaceAllowed,
    stripIpv6Scope,
} from "./localNetworkInterfaces";

type RoomAccessSettings = Pick<
    Settings,
    "deploymentMode" | "httpBind" | "httpPort" | "publicUrl" | "publicUrlConfigured"
> &
    Partial<Pick<Settings, "mdnsInterfaceAllowlist" | "mdnsInterfaceDenylist">>;

type NetworkInterfaces = Readonly<Record<string, readonly NetworkInterfaceInfo[] | undefined>>;

export type RoomAccessConfiguration = {
    configuredBaseUrl: string | null;
    availableBaseUrls: string[];
};

function isWildcardBind(host: string): boolean {
    return host === "0.0.0.0" || host === "::" || host === "[::]";
}

function httpBaseUrl(host: string, port: number): string | null {
    const unwrappedHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
    if (!unwrappedHost || unwrappedHost.includes("%")) return null;
    const formattedHost = unwrappedHost.includes(":") ? `[${unwrappedHost}]` : unwrappedHost;
    const portSuffix = port === 80 ? "" : `:${port}`;
    return `http://${formattedHost}${portSuffix}`;
}

function detectedLocalBaseUrls(
    bind: string,
    port: number,
    interfaces: NetworkInterfaces,
    policy: Pick<RoomAccessSettings, "mdnsInterfaceAllowlist" | "mdnsInterfaceDenylist">,
): string[] {
    if (!isWildcardBind(bind)) {
        const baseUrl = httpBaseUrl(bind, port);
        return baseUrl ? [baseUrl] : [];
    }

    const normalizedPolicy = {
        mdnsInterfaceAllowlist: policy.mdnsInterfaceAllowlist ?? [],
        mdnsInterfaceDenylist: policy.mdnsInterfaceDenylist ?? [],
    };
    const ipv4: { interfaceName: string; address: string }[] = [];
    const ipv6ByInterface = new Map<
        string,
        { interfaceName: string; address: string; priority: number }
    >();
    for (const [interfaceName, entries] of Object.entries(interfaces)) {
        if (!entries || !localNetworkInterfaceAllowed(interfaceName, normalizedPolicy)) continue;
        for (const entry of entries) {
            if (entry.internal || (bind === "0.0.0.0" && entry.family !== "IPv4")) continue;
            const address = stripIpv6Scope(entry.address);
            if (entry.family === "IPv4") {
                ipv4.push({ interfaceName, address });
                continue;
            }
            const scope = ipv6AddressScope(address);
            if (!scope || scope === "LINK_LOCAL") continue;
            const candidate = {
                interfaceName,
                address,
                priority: scope === "GLOBAL" ? 0 : 1,
            };
            const current = ipv6ByInterface.get(interfaceName);
            if (!current || candidate.priority < current.priority) {
                ipv6ByInterface.set(interfaceName, candidate);
            }
        }
    }
    const addresses = [...ipv4, ...ipv6ByInterface.values()].sort((left, right) => {
        const familyOrder =
            Number(left.address.includes(":")) - Number(right.address.includes(":"));
        if (familyOrder !== 0) return familyOrder;
        const interfaceOrder = left.interfaceName.localeCompare(right.interfaceName);
        if (interfaceOrder !== 0) return interfaceOrder;
        return left.address.localeCompare(right.address);
    });
    return [
        ...new Set(
            addresses
                .map(({ address }) => httpBaseUrl(address, port))
                .filter((url): url is string => Boolean(url)),
        ),
    ];
}

/** Builds the credential-free origins advertised to Room clients. */
export function roomAccessConfiguration(
    settings: RoomAccessSettings,
    interfaces?: NetworkInterfaces,
): RoomAccessConfiguration {
    const configuredBaseUrl =
        settings.deploymentMode === "public" || settings.publicUrlConfigured
            ? new URL(settings.publicUrl).origin
            : null;
    if (settings.deploymentMode === "public") {
        if (!configuredBaseUrl) throw new Error("Public Room access requires PUBLIC_URL");
        return { configuredBaseUrl, availableBaseUrls: [configuredBaseUrl] };
    }
    return {
        configuredBaseUrl,
        availableBaseUrls: detectedLocalBaseUrls(
            settings.httpBind,
            settings.httpPort,
            interfaces ?? os.networkInterfaces(),
            settings,
        ),
    };
}
