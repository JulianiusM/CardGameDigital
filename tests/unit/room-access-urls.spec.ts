import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { roomJoinUrls } from "../../apps/web/src/roomAccessUrls";
import { roomAccessConfiguration } from "../../src/modules/roomAccessUrls";

function networkAddress(
    address: string,
    family: "IPv4" | "IPv6",
    internal = false,
): NetworkInterfaceInfo {
    return {
        address,
        family,
        internal,
        netmask: family === "IPv4" ? "255.255.255.0" : "ffff:ffff:ffff:ffff::",
        cidr: null,
        mac: "00:00:00:00:00:00",
        scopeid: family === "IPv6" ? 0 : undefined,
    } as NetworkInterfaceInfo;
}

describe("Room access URLs", () => {
    it("advertises every external interface for a wildcard local bind", () => {
        const result = roomAccessConfiguration(
            {
                deploymentMode: "local",
                httpBind: "0.0.0.0",
                httpPort: 3000,
                publicUrl: "http://localhost:3000",
                publicUrlConfigured: false,
            },
            {
                loopback: [networkAddress("127.0.0.1", "IPv4", true)],
                wifi: [networkAddress("192.168.1.20", "IPv4")],
                ethernet: [networkAddress("10.0.0.7", "IPv4")],
                ipv6: [networkAddress("2001:db8::20", "IPv6")],
            },
        );

        expect(result).toEqual({
            configuredBaseUrl: null,
            availableBaseUrls: ["http://10.0.0.7:3000", "http://192.168.1.20:3000"],
        });
    });

    it("advertises bracketed IPv6 and IPv4 origins for the dual-stack wildcard", () => {
        const result = roomAccessConfiguration(
            {
                deploymentMode: "local",
                httpBind: "::",
                httpPort: 3000,
                publicUrl: "http://localhost:3000",
                publicUrlConfigured: false,
            },
            {
                wifi: [
                    networkAddress("192.168.1.20", "IPv4"),
                    networkAddress("2001:db8::20", "IPv6"),
                ],
            },
        );

        expect(result.availableBaseUrls).toEqual([
            "http://192.168.1.20:3000",
            "http://[2001:db8::20]:3000",
        ]);
    });

    it("uses the current browser origin locally unless PUBLIC_URL explicitly overrides it", () => {
        const discovered = ["http://10.0.0.7:3000", "http://192.168.1.20:3000"];
        const automatic = roomJoinUrls(
            {
                deploymentMode: "local",
                roomAccess: { configuredBaseUrl: null, availableBaseUrls: discovered },
            },
            "http://192.168.1.20:3000",
            "ABC234",
        );
        expect(automatic.qrUrl).toBe("http://192.168.1.20:3000/play/?room=ABC234");
        expect(automatic.urls).toEqual([
            "http://192.168.1.20:3000/play/?room=ABC234",
            "http://10.0.0.7:3000/play/?room=ABC234",
        ]);

        const overridden = roomJoinUrls(
            {
                deploymentMode: "local",
                roomAccess: {
                    configuredBaseUrl: "https://cards.lan.example",
                    availableBaseUrls: discovered,
                },
            },
            "http://192.168.1.20:3000",
            "ABC234",
        );
        expect(overridden.qrUrl).toBe("https://cards.lan.example/play/?room=ABC234");
        expect(overridden.urls[0]).toBe(overridden.qrUrl);
        expect(overridden.urls).toContain("http://192.168.1.20:3000/play/?room=ABC234");
    });

    it("uses and displays only PUBLIC_URL in public mode", () => {
        const result = roomJoinUrls(
            {
                deploymentMode: "public",
                roomAccess: {
                    configuredBaseUrl: "https://cards.example",
                    availableBaseUrls: ["http://10.0.0.7:3000"],
                },
            },
            "https://unexpected-proxy.example",
            "ABC234",
        );

        expect(result).toEqual({
            qrUrl: "https://cards.example/play/?room=ABC234",
            urls: ["https://cards.example/play/?room=ABC234"],
        });
    });
});
