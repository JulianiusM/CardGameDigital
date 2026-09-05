import net from "node:net";

export function isTrustedOrigin(originOrReferer: string | undefined, publicUrl: string): boolean {
    if (!originOrReferer) return false;
    try {
        return new URL(originOrReferer).origin === new URL(publicUrl).origin;
    } catch {
        return false;
    }
}

type WebsocketConnectSourceOptions = {
    deploymentMode: "local" | "public";
    publicUrl: string;
    requestProtocol: string;
    requestHost: string | undefined;
};

function websocketOrigin(httpOrigin: string): string | null {
    try {
        const parsed = new URL(httpOrigin);
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
            return null;
        }
        parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
        const hostname = parsed.hostname.replace(/^\[|\]$/gu, "");
        // CSP host-source syntax cannot represent an IPv6 literal. Restrict the fallback
        // to the matching WebSocket scheme; the client still connects to location.host.
        if (net.isIP(hostname) === 6) return parsed.protocol;
        return parsed.origin;
    } catch {
        return null;
    }
}

/** Returns the explicit WebSocket CSP source for the origin that serves this browser. */
export function websocketConnectSource({
    deploymentMode,
    publicUrl,
    requestProtocol,
    requestHost,
}: WebsocketConnectSourceOptions): string | null {
    if (deploymentMode === "public") return websocketOrigin(publicUrl);
    if (!requestHost || !["http", "https"].includes(requestProtocol)) return null;
    return websocketOrigin(`${requestProtocol}://${requestHost}`);
}

export function requestPathForLog(url: string | undefined): string {
    if (!url) return "-";
    return url.split(/[?#]/, 1)[0] || "/";
}
