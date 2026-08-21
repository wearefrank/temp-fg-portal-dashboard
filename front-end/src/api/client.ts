import { apiFetch } from './auth';

const BASE_URL = '/api';

interface RequestConfig extends Omit<RequestInit, 'body'> {
    body?: unknown;
}

export async function client<T>(
    endpoint: string,
    { body, ...customConfig }: RequestConfig = {}
): Promise<T> {

    const headers = { 'Content-Type': 'application/json' };

    const config: RequestInit = {
        method: body ? 'POST' : 'GET',
        ...customConfig,
        headers: {
            ...headers,
            ...customConfig.headers,
        },
    };

    if (body) {
        config.body = JSON.stringify(body);
    }

    const response = await apiFetch(`${BASE_URL}${endpoint}`, config);

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.message || `HTTP Error: ${response.status}`);
    }

    if (response.status === 204) {
        return {} as T;
    }

    const text = await response.text();

    if (!text) {
        return {} as T;
    }

    return JSON.parse(text);
}