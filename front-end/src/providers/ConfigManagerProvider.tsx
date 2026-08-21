import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfigManager } from '../actions/ConfigManager';
import { ConfigManagerContext, type ConfigManagerState } from '../hooks/useConfigManager';
import { apiFetch } from '../api/auth';

export const ConfigManagerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const configManager = useMemo(() => new ConfigManager(), []);
    const [version, setVersion] = useState(0);
    const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
    const [schemaLoading, setSchemaLoading] = useState(false);

    const bump = useCallback(() => setVersion(v => v + 1), []);

    const setConfig = useCallback((text: string) => {
        configManager.setRawText(text);
        bump();
    }, [configManager, bump]);

    // fetches the full APISIX schema from the backend and pushes it into the validator
    // called on mount and can be called again after the user updates connection settings
    const fetchSchema = useCallback(async () => {
        setSchemaLoading(true);
        try {
            const res = await apiFetch("/api/schema");
            if (!res.ok) throw new Error(`Status: ${res.status}`);
            const data = await res.json();
            setSchema(data);
            configManager.setSchema(data);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`Connection failed: ${msg}`);
        } finally {
            setSchemaLoading(false);
        }
    }, [configManager]);

    // Auto-fetch schema on mount
    useEffect(() => {
        fetchSchema().catch(() => {});
    }, [fetchSchema]);

    // `version` is a bump counter - it's not in the value object but its presence in the dep array
    // forces a new context value whenever setConfig is called, triggering consumers to re-render
    const value: ConfigManagerState = useMemo(() => ({
        configManager,
        config: configManager.getConfig(),
        configText: configManager.getValidText(),
        configYamlValid: configManager.isYamlValid(),
        schema,
        schemaLoading,
        setConfig,
        fetchSchema,
    }), [configManager, version, schema, schemaLoading, setConfig, fetchSchema]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <ConfigManagerContext.Provider value={value}>
            {children}
        </ConfigManagerContext.Provider>
    );
};
