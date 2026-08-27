export type LocalNetworkInterfacePolicy = {
    mdnsInterfaceAllowlist: readonly string[];
    mdnsInterfaceDenylist: readonly string[];
};

const VIRTUAL_INTERFACE_PATTERN =
    /(?:docker|podman|container|veth|virbr|bridge|br-|vmnet|vbox|hyper-v|vethernet|wsl|tun|tap|tailscale|zerotier)/iu;

export function localNetworkInterfaceAllowed(
    interfaceName: string,
    policy: LocalNetworkInterfacePolicy,
): boolean {
    if (policy.mdnsInterfaceDenylist.includes(interfaceName)) return false;
    if (policy.mdnsInterfaceAllowlist.length) {
        return policy.mdnsInterfaceAllowlist.includes(interfaceName);
    }
    return !VIRTUAL_INTERFACE_PATTERN.test(interfaceName);
}

export function stripIpv6Scope(value: string): string {
    return value.split("%", 1)[0];
}

export type Ipv6AddressScope = "GLOBAL" | "UNIQUE_LOCAL" | "LINK_LOCAL";

export function ipv6AddressScope(value: string): Ipv6AddressScope | null {
    const normalized = stripIpv6Scope(value).toLowerCase();
    const first = Number.parseInt(normalized.split(":", 1)[0] || "0", 16);
    if (first >= 0x2000 && first <= 0x3fff) return "GLOBAL";
    if (first >= 0xfc00 && first <= 0xfdff) return "UNIQUE_LOCAL";
    if (first >= 0xfe80 && first <= 0xfebf) return "LINK_LOCAL";
    return null;
}
