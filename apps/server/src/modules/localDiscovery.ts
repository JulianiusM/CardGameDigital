import net from "node:net";
import { randomInt } from "node:crypto";
import os, { type NetworkInterfaceInfo } from "node:os";
import { getResponder, type CiaoService, type Responder, type ServiceTxt } from "@homebridge/ciao";
import settings, { type Settings } from "./settings";
import { logEvent } from "./structuredLogger";
import { roomDisplayBootstrapCapability } from "./roomCreateProtection";
import {
    API_BASE_PATH,
    LOCAL_DISCOVERY_TXT_VERSION,
    localDiscoveryStatus,
    recordLocalDiscoveryAdvertisement,
    recordLocalDiscoveryRestart,
    setLocalDiscoveryStatus,
    type LocalDiscoveryStatus,
} from "./localDiscoveryState";
import {
    ipv6AddressScope,
    localNetworkInterfaceAllowed,
    stripIpv6Scope,
} from "./localNetworkInterfaces";

export {
    API_BASE_PATH,
    LOCAL_DISCOVERY_TXT_VERSION,
    localDiscoveryStatus,
    localNetworkDiscoveryCapability,
} from "./localDiscoveryState";
const DEFAULT_INSTANCE_NAME = "Party Game";
const RECONCILIATION_INTERVAL_MS = 5_000;
const READINESS_WITHDRAWAL_DEBOUNCE_MS = 2_000;
const MAX_RETRY_MS = 60_000;

export type LocalDiscoveryBinding = {
    interfaceName: string;
    address: string;
    family: "IPv4" | "IPv6";
};

export type LocalServiceAdvertisement = {
    displayName: string;
    instanceName: string;
    serviceType: string;
    hostLabel: string;
    advertisedPort: number;
    tlsRequired: boolean;
    apiVersionHints: readonly number[];
    webSocketVersionHints: readonly number[];
    capabilityHints: readonly string[];
    bindings: readonly LocalDiscoveryBinding[];
};

export interface LocalServiceAdvertiser {
    start(advertisement: LocalServiceAdvertisement): Promise<void>;
    update(advertisement: LocalServiceAdvertisement): Promise<void>;
    stop(): Promise<void>;
    status(): LocalDiscoveryStatus;
}

export function sanitizeDiscoveryInstanceName(value: string): string {
    const sanitized = value
        .trim()
        .normalize("NFC")
        .replace(/[\u0000-\u001f\u007f-\u009f]/gu, "")
        .trim();
    const source = sanitized || DEFAULT_INSTANCE_NAME;
    let result = "";
    for (const character of source) {
        if (Buffer.byteLength(result + character, "utf8") > 48) break;
        result += character;
    }
    return result || DEFAULT_INSTANCE_NAME;
}

export function buildDiscoveryTxt(
    advertisement: Pick<
        LocalServiceAdvertisement,
        "apiVersionHints" | "webSocketVersionHints" | "tlsRequired" | "capabilityHints"
    >,
): ServiceTxt {
    const txt: ServiceTxt = {
        txtvers: String(LOCAL_DISCOVERY_TXT_VERSION),
        api: advertisement.apiVersionHints.join(","),
        ws: advertisement.webSocketVersionHints.join(","),
        tls: advertisement.tlsRequired ? "1" : "0",
        path: API_BASE_PATH,
        cap: advertisement.capabilityHints.join(","),
    };
    validateDiscoveryTxt(txt);
    return txt;
}

export function eligibleNetworkBindings(
    value: Pick<
        Settings,
        | "httpBind"
        | "testMode"
        | "mdnsInterfaceAllowlist"
        | "mdnsInterfaceDenylist"
        | "mdnsAllowPublicIpv4"
    >,
    interfaces: Readonly<
        Record<string, readonly NetworkInterfaceInfo[] | undefined>
    > = os.networkInterfaces(),
): LocalDiscoveryBinding[] {
    const explicitBind = normalizeBindAddress(value.httpBind);
    if (explicitBind === "LOOPBACK_ONLY" && !value.testMode) return [];
    if (explicitBind === "UNSUPPORTED") return [];

    const bindings: LocalDiscoveryBinding[] = [];
    for (const [interfaceName, addresses] of Object.entries(interfaces)) {
        if (!addresses || !localNetworkInterfaceAllowed(interfaceName, value)) continue;
        collectEligibleBindings(addresses, value, explicitBind, bindings, interfaceName);
    }
    return bindings.sort((left, right) => {
        const interfaceOrder = left.interfaceName.localeCompare(right.interfaceName);
        if (interfaceOrder !== 0) return interfaceOrder;
        if (left.family !== right.family) return left.family === "IPv4" ? -1 : 1;
        return left.address.localeCompare(right.address);
    });
}

function collectEligibleBindings(
    addresses: readonly os.NetworkInterfaceInfo[],
    value: Pick<
        Settings,
        | "mdnsInterfaceAllowlist"
        | "mdnsInterfaceDenylist"
        | "mdnsAllowPublicIpv4"
        | "httpBind"
        | "testMode"
    >,
    explicitBind: string | null,
    bindings: LocalDiscoveryBinding[],
    interfaceName: string,
) {
    for (const info of addresses) {
        const address = stripIpv6Scope(info.address);
        if (info.internal && !value.testMode) continue;
        if (
            typeof explicitBind === "string" &&
            explicitBind !== "LOOPBACK_ONLY" &&
            explicitBind !== address
        ) {
            continue;
        }
        if (!addressEligible(address, value.mdnsAllowPublicIpv4, value.testMode)) continue;
        bindings.push({ interfaceName, address, family: info.family });
    }
}

export function buildLocalServiceAdvertisement(
    value: Settings = settings.value,
    interfaces?: Readonly<Record<string, readonly NetworkInterfaceInfo[] | undefined>>,
    displayBootstrapAvailable = roomDisplayBootstrapCapability(),
): LocalServiceAdvertisement {
    const capabilities = ["rooms"];
    if (displayBootstrapAvailable) capabilities.push("display-bootstrap");
    return {
        displayName: value.serverDisplayName,
        instanceName: sanitizeDiscoveryInstanceName(
            value.mdnsInstanceName || value.serverDisplayName,
        ),
        serviceType: value.mdnsServiceType,
        hostLabel: value.mdnsHostLabel,
        advertisedPort: value.mdnsAdvertisedPort,
        tlsRequired: value.mdnsAdvertisedTls,
        apiVersionHints: [1],
        webSocketVersionHints: [2],
        capabilityHints: capabilities,
        bindings: eligibleNetworkBindings(value, interfaces),
    };
}

export class CiaoLocalServiceAdvertiser implements LocalServiceAdvertiser {
    private responder: Responder | null = null;
    private service: CiaoService | null = null;
    private advertisement: LocalServiceAdvertisement | null = null;

    async start(advertisement: LocalServiceAdvertisement): Promise<void> {
        if (this.service) throw new Error("Local discovery advertiser is already started");
        if (!advertisement.bindings.length) throw new Error("NO_ELIGIBLE_INTERFACE");
        const serviceName = serviceNameFromType(advertisement.serviceType);
        const restrictedAddresses = advertisement.bindings.map(({ address }) => address);
        const responder = getResponder({ interface: restrictedAddresses });
        const service = responder.createService({
            name: advertisement.instanceName,
            type: serviceName,
            hostname: advertisement.hostLabel,
            port: advertisement.advertisedPort,
            txt: buildDiscoveryTxt(advertisement),
            restrictedAddresses,
        });
        service.on("name-change", () => {
            logEvent(
                "info",
                "local_discovery.name_conflict_resolved",
                { kind: "service" },
                settings.value.logLevel,
            );
        });
        service.on("hostname-change", () => {
            logEvent(
                "info",
                "local_discovery.name_conflict_resolved",
                { kind: "host" },
                settings.value.logLevel,
            );
        });
        this.responder = responder;
        this.service = service;
        this.advertisement = advertisement;
        try {
            await service.advertise();
            this.publishStatus(true, "ADVERTISING", advertisement);
        } catch (error) {
            await this.stop();
            throw error;
        }
    }

    async update(advertisement: LocalServiceAdvertisement): Promise<void> {
        if (
            this.advertisement &&
            advertisementKey(this.advertisement) === advertisementKey(advertisement)
        ) {
            return;
        }
        await this.stop();
        await this.start(advertisement);
    }

    async stop(): Promise<void> {
        const service = this.service;
        const responder = this.responder;
        this.service = null;
        this.responder = null;
        this.advertisement = null;
        try {
            if (service) await service.destroy();
        } finally {
            if (responder) await responder.shutdown();
            setLocalDiscoveryStatus({
                ...localDiscoveryStatus(),
                advertising: false,
                reason: "STOPPED",
            });
        }
    }

    status(): LocalDiscoveryStatus {
        return localDiscoveryStatus();
    }

    private publishStatus(
        advertising: boolean,
        reason: string,
        advertisement: LocalServiceAdvertisement,
    ): void {
        const interfaceCount = new Set(
            advertisement.bindings.map(({ interfaceName }) => interfaceName),
        ).size;
        setLocalDiscoveryStatus({
            advertising,
            reason,
            serviceType: advertisement.serviceType,
            txtVersion: LOCAL_DISCOVERY_TXT_VERSION,
            interfaceCount,
            ipv4AddressCount: advertisement.bindings.filter(({ family }) => family === "IPv4")
                .length,
            ipv6AddressCount: advertisement.bindings.filter(({ family }) => family === "IPv6")
                .length,
        });
    }
}

export class LocalDiscoveryController {
    private interval: NodeJS.Timeout | null = null;
    private running = false;
    private stopping = false;
    private unreadySince: number | null = null;
    private retryDelayMs = 1_000;
    private nextRetryAt = 0;
    private lastAdvertisementKey: string | null = null;

    constructor(
        private readonly advertiser: LocalServiceAdvertiser,
        private readonly readiness: () => Promise<boolean>,
        private readonly interfaces: () => Readonly<
            Record<string, readonly NetworkInterfaceInfo[] | undefined>
        > = os.networkInterfaces,
        private readonly displayBootstrapAvailable: () => boolean = roomDisplayBootstrapCapability,
    ) {}

    async start(): Promise<void> {
        if (!settings.value.mdnsDiscoveryEnabled) {
            setLocalDiscoveryStatus({
                ...localDiscoveryStatus(),
                serviceType: settings.value.mdnsServiceType,
                advertising: false,
                reason: "DISABLED_BY_POLICY",
            });
            return;
        }
        if (settings.value.deploymentMode === "public") {
            logEvent(
                "warn",
                "local_discovery.public_deployment_override_enabled",
                { serviceType: settings.value.mdnsServiceType },
                settings.value.logLevel,
            );
        }
        await this.reconcile();
        this.interval = setInterval(() => void this.reconcile(), RECONCILIATION_INTERVAL_MS);
        this.interval.unref();
    }

    async stop(): Promise<void> {
        this.stopping = true;
        if (this.interval) clearInterval(this.interval);
        this.interval = null;
        await this.advertiser.stop();
        this.lastAdvertisementKey = null;
        logEvent("info", "local_discovery.advertisement_stopped", {}, settings.value.logLevel);
    }

    async reconcile(): Promise<void> {
        if (this.running || this.stopping) return;
        this.running = true;
        try {
            const ready = await this.readiness();
            if (!ready) {
                await this.withdrawWhenUnready();
                return;
            }
            const readinessRecovered = this.unreadySince !== null;
            this.unreadySince = null;
            if (readinessRecovered) {
                logEvent(
                    "info",
                    "local_discovery.readiness_recovered",
                    {},
                    settings.value.logLevel,
                );
            }
            const advertisement = buildLocalServiceAdvertisement(
                settings.value,
                this.interfaces(),
                this.displayBootstrapAvailable(),
            );
            if (!advertisement.bindings.length) {
                await this.withdrawWithoutBindings(advertisement);
                return;
            }
            if (Date.now() < this.nextRetryAt) return;
            const wasAdvertising = this.advertiser.status().advertising;
            const currentKey = advertisementKey(advertisement);
            if (wasAdvertising && this.lastAdvertisementKey === currentKey) return;
            if (wasAdvertising) await this.advertiser.update(advertisement);
            else await this.advertiser.start(advertisement);
            this.lastAdvertisementKey = currentKey;
            this.retryDelayMs = 1_000;
            this.nextRetryAt = 0;
            recordLocalDiscoveryAdvertisement("success");
            if (wasAdvertising) recordLocalDiscoveryRestart("ADVERTISEMENT_CHANGED");
            logEvent(
                "info",
                wasAdvertising
                    ? "local_discovery.advertisement_updated"
                    : "local_discovery.advertisement_started",
                {
                    serviceType: advertisement.serviceType,
                    port: advertisement.advertisedPort,
                    interfaceCount: this.advertiser.status().interfaceCount,
                    ipv4AddressCount: this.advertiser.status().ipv4AddressCount,
                    ipv6AddressCount: this.advertiser.status().ipv6AddressCount,
                },
                settings.value.logLevel,
            );
        } catch {
            this.lastAdvertisementKey = null;
            recordLocalDiscoveryAdvertisement("failure");
            recordLocalDiscoveryRestart("RESPONDER_FAILURE");
            setLocalDiscoveryStatus({
                ...localDiscoveryStatus(),
                advertising: false,
                reason: "RESPONDER_FAILURE",
            });
            const jitter = randomInt(Math.max(1, Math.ceil(this.retryDelayMs / 4)));
            this.nextRetryAt = Date.now() + this.retryDelayMs + jitter;
            this.retryDelayMs = Math.min(MAX_RETRY_MS, this.retryDelayMs * 2);
            logEvent(
                "warn",
                "local_discovery.advertisement_failed",
                { reason: "RESPONDER_FAILURE" },
                settings.value.logLevel,
            );
        } finally {
            this.running = false;
        }
    }

    private async withdrawWithoutBindings(advertisement: LocalServiceAdvertisement) {
        const newlyUnavailable = localDiscoveryStatus().reason !== "NO_ELIGIBLE_INTERFACE";
        if (this.advertiser.status().advertising) await this.advertiser.stop();
        this.lastAdvertisementKey = null;
        setLocalDiscoveryStatus({
            ...localDiscoveryStatus(),
            serviceType: advertisement.serviceType,
            advertising: false,
            reason: "NO_ELIGIBLE_INTERFACE",
            interfaceCount: 0,
            ipv4AddressCount: 0,
            ipv6AddressCount: 0,
        });
        if (newlyUnavailable) {
            logEvent(
                "warn",
                "local_discovery.no_eligible_interface",
                { reason: "NO_ELIGIBLE_INTERFACE" },
                settings.value.logLevel,
            );
        }
    }

    private async withdrawWhenUnready() {
        this.unreadySince ??= Date.now();
        if (Date.now() - this.unreadySince >= READINESS_WITHDRAWAL_DEBOUNCE_MS) {
            const newlyWithdrawn = localDiscoveryStatus().reason !== "UNREADY";
            if (this.advertiser.status().advertising) await this.advertiser.stop();
            this.lastAdvertisementKey = null;
            setLocalDiscoveryStatus({
                ...localDiscoveryStatus(),
                advertising: false,
                reason: "UNREADY",
            });
            if (newlyWithdrawn) {
                logEvent(
                    "warn",
                    "local_discovery.readiness_withdrawn",
                    { reason: "UNREADY" },
                    settings.value.logLevel,
                );
            }
        }
    }
}

function normalizeBindAddress(bind: string): string | null {
    const value = stripIpv6Scope(
        bind.startsWith("[") && bind.endsWith("]") ? bind.slice(1, -1) : bind,
    );
    if (value === "0.0.0.0" || value === "::") return null;
    if (value === "localhost" || value === "127.0.0.1" || value === "::1") {
        return "LOOPBACK_ONLY";
    }
    return net.isIP(value) ? value : "UNSUPPORTED";
}

function addressEligible(address: string, allowPublicIpv4: boolean, testMode: boolean): boolean {
    const family = net.isIP(address);
    if (family === 4) {
        const parts = address.split(".").map(Number);
        if (parts[0] === 0 || parts[0] === 127 || parts[0] >= 224)
            return testMode && parts[0] === 127;
        const privateAddress =
            parts[0] === 10 ||
            (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
            (parts[0] === 192 && parts[1] === 168) ||
            (parts[0] === 169 && parts[1] === 254);
        return privateAddress || allowPublicIpv4;
    }
    if (family === 6) {
        const normalized = address.toLowerCase();
        if (normalized === "::" || normalized === "::1" || normalized.startsWith("ff")) {
            return testMode && normalized === "::1";
        }
        return ipv6AddressScope(normalized) !== null;
    }
    return false;
}

function serviceNameFromType(serviceType: string): string {
    const match = /^_([a-z][a-z0-9-]{0,14})\._tcp$/u.exec(serviceType);
    if (!match) throw new Error("INVALID_SERVICE_TYPE");
    return match[1];
}

function validateDiscoveryTxt(txt: ServiceTxt): void {
    const entries = Object.entries(txt);
    const keys = new Set<string>();
    let totalBytes = 0;
    for (const [key, rawValue] of entries) {
        const value = String(rawValue);
        if (keys.has(key) || !/^[a-z]{1,9}$/u.test(key) || !/^[\x20-\x7e]*$/u.test(value)) {
            throw new Error("INVALID_TXT_PROFILE");
        }
        keys.add(key);
        const bytes = Buffer.byteLength(`${key}=${value}`, "ascii");
        if (bytes > 255) throw new Error("INVALID_TXT_PROFILE");
        totalBytes += bytes + 1;
    }
    if (totalBytes > 200) throw new Error("INVALID_TXT_PROFILE");
    const expected = ["txtvers", "api", "ws", "tls", "path", "cap"];
    if (entries.map(([key]) => key).join(",") !== expected.join(",")) {
        throw new Error("INVALID_TXT_PROFILE");
    }
}

function advertisementKey(advertisement: LocalServiceAdvertisement): string {
    return JSON.stringify(advertisement);
}
