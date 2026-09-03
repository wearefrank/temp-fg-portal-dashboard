import { useMemo } from 'react';
import { type AppSettings, SETTINGS_DEFAULTS, deepMerge } from '../settings/AppSettings';
import { usePersistedState } from './usePersistedState.ts';

const STORAGE_KEY = 'app-settings';

export function useAppSettings(): [AppSettings, (next: AppSettings) => void] {
    const [stored, setSettings] = usePersistedState<AppSettings>(STORAGE_KEY, SETTINGS_DEFAULTS);

    // Fold onto the defaults so a blob from an older build still gets new fields.
    const settings = useMemo(() => {
        if (typeof stored !== 'object' || stored === null) return SETTINGS_DEFAULTS;
        return deepMerge(SETTINGS_DEFAULTS, stored);
    }, [stored]);

    return [settings, setSettings];
}
