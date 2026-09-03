import {useCallback, useState} from 'react';

export const PERSIST_PREFIX = 'persisted_storage:';

function resolve<T>(initial: T | (() => T)): T {
    if (typeof initial === 'function') {
        return (initial as () => T)();
    }
    return initial;
}

export function readPersisted<T>(key: string, initialState: T | (() => T)): T {
    try {
        const storedValue = localStorage.getItem(PERSIST_PREFIX + key);

        if (storedValue === null) {
            return resolve(initialState);
        }

        return JSON.parse(storedValue) as T;
    } catch {
        return resolve(initialState);
    }
}

export function usePersistedState<T>(
    key: string,
    initialState: T | (() => T),
): [T, (next: T) => void] {
    const [value, setValue] = useState<T>(() => readPersisted(key, initialState));

    const setPersisted = useCallback((next: T) => {
        try {
            localStorage.setItem(PERSIST_PREFIX + key, JSON.stringify(next));
        } catch {
            // Storage can be full or blocked
        }
        setValue(next);
    }, [key]);

    return [value, setPersisted];
}
