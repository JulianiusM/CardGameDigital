import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
    buildDiscoveryTxt,
    eligibleNetworkBindings,
    LocalDiscoveryController,
    sanitizeDiscoveryInstanceName,
    type LocalServiceAdvertisement,
    type LocalServiceAdvertiser,
} from "../../src/modules/localDiscovery";
import type { LocalDiscoveryStatus } from "../../src/modules/localDiscoveryState";
import { localDiscoveryMetrics } from "../../src/modules/localDiscoveryState";

function address(value: string, family: "IPv4" | "IPv6", internal = false): NetworkInterfaceInfo {
    const common = {
        address: value,
        netmask: family === "IPv4" ? "255.255.255.0" : "ffff:ffff:ffff:ffff::",
        mac: "00:11:22:33:44:55",
        internal,
        cidr: null,
    };
    if (family === "IPv6") return { ...common, family, scopeid: 2 };
    return { ...common, family };
}

const policy = {
    httpBind: "::",
    testMode: false,
    mdnsInterfaceAllowlist: [] as string[],
    mdnsInterfaceDenylist: [] as string[],
    mdnsAllowPublicIpv4: false,
};

describe("local DNS-SD profile", () => {
    it("normalizes names and truncates only on a Unicode code-point boundary", () => {
        expect(sanitizeDiscoveryInstanceName("  Café\nGame  ")).toBe("CaféGame");
        const truncated = sanitizeDiscoveryInstanceName("🎉".repeat(20));
        expect(Buffer.byteLength(truncated, "utf8")).toBeLessThanOrEqual(48);
        expect(truncated).toBe("🎉".repeat(12));
        expect(sanitizeDiscoveryInstanceName("\n\t")).toBe("Party Game");
    });

    it("builds the exact compact version-1 TXT profile in stable order", () => {
        const txt = buildDiscoveryTxt({
            apiVersionHints: [1],
            webSocketVersionHints: [2],
            tlsRequired: false,
            capabilityHints: ["rooms", "display-bootstrap"],
        });
        expect(Object.entries(txt)).toEqual([
            ["txtvers", "1"],
            ["api", "1"],
            ["ws", "2"],
            ["tls", "0"],
            ["path", "/api/v1"],
            ["cap", "rooms,display-bootstrap"],
        ]);
        expect(JSON.stringify(txt)).not.toMatch(/serverId|roomCode|credential|token/iu);
    });

    it("advertises eligible local addresses without leaking loopback, public IPv4, or virtual links", () => {
        const bindings = eligibleNetworkBindings(policy, {
            Ethernet: [
                address("192.168.1.10", "IPv4"),
                address("203.0.113.9", "IPv4"),
                address("fe80::1234", "IPv6"),
            ],
            Loopback: [address("127.0.0.1", "IPv4", true)],
            "vEthernet (WSL)": [address("172.20.0.1", "IPv4")],
        });
        expect(bindings).toEqual([
            { interfaceName: "Ethernet", address: "192.168.1.10", family: "IPv4" },
            { interfaceName: "Ethernet", address: "fe80::1234", family: "IPv6" },
        ]);
    });

    it("honors exact interface allow and deny policy", () => {
        const interfaces = {
            "vEthernet (Party)": [address("172.20.0.2", "IPv4")],
            WiFi: [address("10.0.0.5", "IPv4")],
        };
        expect(
            eligibleNetworkBindings(
                {
                    ...policy,
                    mdnsInterfaceAllowlist: ["vEthernet (Party)"],
                },
                interfaces,
            ),
        ).toEqual([
            {
                interfaceName: "vEthernet (Party)",
                address: "172.20.0.2",
                family: "IPv4",
            },
        ]);
        expect(
            eligibleNetworkBindings({ ...policy, mdnsInterfaceDenylist: ["WiFi"] }, interfaces),
        ).toEqual([]);
    });

    it("starts after readiness, updates on interface change, and withdraws when unready", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(10_000);
        let ready = true;
        let interfaces: Record<string, NetworkInterfaceInfo[]> = {
            Ethernet: [address("10.0.0.5", "IPv4")],
        };
        const calls = { start: 0, update: 0, stop: 0 };
        let status: LocalDiscoveryStatus = {
            advertising: false,
            serviceType: "_partycard._tcp",
            txtVersion: 1,
            reason: "NOT_STARTED",
            interfaceCount: 0,
            ipv4AddressCount: 0,
            ipv6AddressCount: 0,
        };
        const publish = (advertisement: LocalServiceAdvertisement) => {
            status = {
                ...status,
                advertising: true,
                reason: "ADVERTISING",
                interfaceCount: 1,
                ipv4AddressCount: advertisement.bindings.length,
            };
        };
        const advertiser: LocalServiceAdvertiser = {
            async start(advertisement) {
                calls.start += 1;
                publish(advertisement);
            },
            async update(advertisement) {
                calls.update += 1;
                publish(advertisement);
            },
            async stop() {
                calls.stop += 1;
                status = { ...status, advertising: false, reason: "STOPPED" };
            },
            status: () => ({ ...status }),
        };
        const controller = new LocalDiscoveryController(
            advertiser,
            async () => ready,
            () => interfaces,
            () => true,
        );
        const metricsBefore = localDiscoveryMetrics();
        try {
            await controller.start();
            expect(calls.start).toBe(1);

            interfaces = { Ethernet: [address("10.0.0.6", "IPv4")] };
            await controller.reconcile();
            expect(calls.update).toBe(1);
            expect(localDiscoveryMetrics().advertisementTotal.success).toBe(
                metricsBefore.advertisementTotal.success + 2,
            );
            expect(
                localDiscoveryMetrics().restartTotal.ADVERTISEMENT_CHANGED,
            ).toBeGreaterThanOrEqual(1);

            ready = false;
            await controller.reconcile();
            vi.setSystemTime(12_001);
            await controller.reconcile();
            expect(calls.stop).toBe(1);
            expect(advertiser.status().advertising).toBe(false);
        } finally {
            await controller.stop();
            vi.useRealTimers();
        }
    });
});
