import { useEffect, useState } from 'react';
import { client } from '../../api/client';
import type { ConnectionStatus } from './dashboardTypes';

/** Whether the APISIX control API answers. Re-asked whenever the connection config lands. */
export function useControlStatus(configLoaded: boolean): ConnectionStatus {
    const [status, setStatus] = useState<ConnectionStatus>('checking');

    useEffect(() => {
        if (!configLoaded) return;
        client<boolean>('/config/check?api=control', { method: 'GET' })
            .then(ok => setStatus(ok ? 'online' : 'offline'))
            .catch(() => setStatus('offline'));
    }, [configLoaded]);

    return status;
}
