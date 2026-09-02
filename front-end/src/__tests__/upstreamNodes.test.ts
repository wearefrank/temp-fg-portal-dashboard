import { describe, it, expect } from 'vitest';
import { toNodeList } from '../components/Dashboard/upstreamNodes';

describe('toNodeList', () => {
    it('passes the array form through', () => {
        const nodes = [{ host: 'api', port: 8080, weight: 1 }];
        expect(toNodeList(nodes)).toBe(nodes);
    });

    it('converts the map form', () => {
        expect(toNodeList({ 'host.docker.internal:3004': 2 })).toEqual([
            { host: 'host.docker.internal', port: 3004, weight: 2 },
        ]);
    });

    it('defaults to port 80 when the address has none', () => {
        expect(toNodeList({ backend: 1 })).toEqual([{ host: 'backend', port: 80, weight: 1 }]);
    });

    it('keeps an IPv6 address intact when no port is given', () => {
        expect(toNodeList({ '::1': 1 })).toEqual([{ host: '::1', port: 80, weight: 1 }]);
    });

    it('reads the port off a bracketed IPv6 address', () => {
        expect(toNodeList({ '[::1]:3004': 1 })).toEqual([{ host: '::1', port: 3004, weight: 1 }]);
    });

    it('returns an empty list for missing nodes', () => {
        expect(toNodeList(undefined)).toEqual([]);
    });
});
