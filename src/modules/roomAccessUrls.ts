import os, { type NetworkInterfaceInfo } from "node:os";
import type { Settings } from "./settings";

type RoomAccessSettings = Pick<
    Settings,
    "deploymentMode" | "httpBind" | "httpPort" | "publicUrl" | "publicUrlConfigured"
>;

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
): string[] {
    if (!isWildcardBind(bind)) {
        const baseUrl = httpBaseUrl(bind, port);
        return baseUrl ? [baseUrl] : [];
    }

    const addresses = Object.values(interfaces)
        .flatMap((entries) => entries ?? [])
        .filter((entry) => !entry.internal && (bind !== "0.0.0.0" || entry.family === "IPv4"))
        .sort((left, right) => {
            if (left.family !== right.family) return left.family === "IPv4" ? -1 : 1;
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
        ),
    };
}
