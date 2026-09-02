import type { LiveNode, LiveNodes } from './dashboardTypes';

/** APISIX returns nodes either as an array or as a {"host:port": weight} map. */
export function toNodeList(nodes: LiveNodes | undefined): LiveNode[] {
    if (Array.isArray(nodes)) return nodes;
    if (!nodes || typeof nodes !== 'object') return [];

    return Object.entries(nodes).map(([address, weight]) => {
        const { host, port } = splitAddress(address);
        return { host, port, weight: Number(weight) || 0 };
    });
}

/** APISIX defaults to port 80 when the address carries none. */
function splitAddress(address: string): { host: string; port: number } {
    // Bracketed IPv6, e.g. "[::1]:3004".
    const bracketed = /^\[(.+)](?::(\d+))?$/.exec(address);
    if (bracketed) return { host: bracketed[1], port: Number(bracketed[2] ?? 80) };

    // A bare IPv6 address has several colons, so only split when there is exactly one.
    const sep = address.indexOf(':');
    if (sep > -1 && sep === address.lastIndexOf(':') && /^\d+$/.test(address.slice(sep + 1)))
        return { host: address.slice(0, sep), port: Number(address.slice(sep + 1)) };

    return { host: address, port: 80 };
}
