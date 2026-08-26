import type { ServerInfo } from "./multiplayer";

type RoomAccessServerInfo = Pick<ServerInfo, "deploymentMode" | "roomAccess">;

export type RoomJoinUrls = {
    qrUrl: string;
    urls: string[];
};

function normalizedHttpOrigin(value: string): string | null {
    try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
            return null;
        }
        return url.origin;
    } catch {
        return null;
    }
}

function roomJoinUrl(baseUrl: string, roomCode: string): string {
    const url = new URL("/play/", baseUrl);
    url.searchParams.set("room", roomCode);
    return url.href;
}

/** Selects one QR payload and every address worth showing without trusting browser origin publicly. */
export function roomJoinUrls(
    serverInfo: RoomAccessServerInfo,
    browserBaseUrl: string,
    roomCode: string,
): RoomJoinUrls {
    const configuredBaseUrl = serverInfo.roomAccess.configuredBaseUrl;
    if (serverInfo.deploymentMode === "public") {
        const publicBaseUrl = configuredBaseUrl && normalizedHttpOrigin(configuredBaseUrl);
        if (!publicBaseUrl) throw new Error("Public Room access requires a configured base URL");
        const qrUrl = roomJoinUrl(publicBaseUrl, roomCode);
        return { qrUrl, urls: [qrUrl] };
    }

    const browserOrigin = normalizedHttpOrigin(browserBaseUrl);
    const configuredOrigin = configuredBaseUrl && normalizedHttpOrigin(configuredBaseUrl);
    const qrBaseUrl = configuredOrigin ?? browserOrigin;
    if (!qrBaseUrl) throw new Error("Local Room access requires a browser or configured base URL");
    const availableOrigins = [
        qrBaseUrl,
        browserOrigin,
        ...serverInfo.roomAccess.availableBaseUrls.map(normalizedHttpOrigin),
    ].filter((url): url is string => Boolean(url));
    return {
        qrUrl: roomJoinUrl(qrBaseUrl, roomCode),
        urls: [...new Set(availableOrigins)].map((url) => roomJoinUrl(url, roomCode)),
    };
}
