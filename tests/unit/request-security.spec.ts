import { describe, expect, it } from "vitest";
import {
    isTrustedOrigin,
    requestPathForLog,
    websocketConnectSource,
} from "../../src/modules/requestSecurity";

describe("public request origin validation", () => {
    it("accepts only the configured public origin", () => {
        expect(isTrustedOrigin("https://game.example", "https://game.example/play")).toBe(true);
        expect(isTrustedOrigin("https://evil.example", "https://game.example")).toBe(false);
        expect(isTrustedOrigin(undefined, "https://game.example")).toBe(false);
        expect(isTrustedOrigin("not a URL", "https://game.example")).toBe(false);
    });

    it("removes query strings and fragments from request log paths", () => {
        expect(requestPathForLog("/play/account?reset=secret-token")).toBe("/play/account");
        expect(requestPathForLog("/api/v1/account/oidc/callback?code=secret&state=secret")).toBe(
            "/api/v1/account/oidc/callback",
        );
        expect(requestPathForLog(undefined)).toBe("-");
    });

    it("authorizes the request-visible WebSocket origin locally, including IPv6", () => {
        expect(
            websocketConnectSource({
                deploymentMode: "local",
                publicUrl: "http://localhost:3000",
                requestProtocol: "http",
                requestHost: "192.168.1.20:3000",
            }),
        ).toBe("ws://192.168.1.20:3000");
        expect(
            websocketConnectSource({
                deploymentMode: "local",
                publicUrl: "http://localhost:3000",
                requestProtocol: "https",
                requestHost: "[2001:db8::20]:3000",
            }),
        ).toBe("wss:");
    });

    it("authorizes only the configured WebSocket origin in public mode", () => {
        expect(
            websocketConnectSource({
                deploymentMode: "public",
                publicUrl: "https://cards.example",
                requestProtocol: "http",
                requestHost: "192.168.1.20:3000",
            }),
        ).toBe("wss://cards.example");
    });

    it("uses a valid scheme source when a public origin is an IPv6 literal", () => {
        expect(
            websocketConnectSource({
                deploymentMode: "public",
                publicUrl: "https://[2001:db8::20]",
                requestProtocol: "https",
                requestHost: "[2001:db8::20]",
            }),
        ).toBe("wss:");
    });
});
