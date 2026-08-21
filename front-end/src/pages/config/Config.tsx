import { useEffect, useState } from "react";
import { useFetch } from "../../hooks/useFetch";
import { apiFetch } from "../../api/auth";
import {ApisixSettings} from "../../components/Config/ApisixConnectionSettings.tsx";
import {Link} from "react-router-dom";
import styles from './Config.module.css';

interface ApisixConnectionData {
    host: string;
    controlPort: number;
    metricsPort: number;
}

export const Config = () => {
    const configFetch = useFetch<ApisixConnectionData>('/config');

    const [configState, setConfigState] = useState<ApisixConnectionData>({ host: "http://127.0.0.1", controlPort: 9092, metricsPort: 9091 });

    useEffect(() => {
        if (configFetch.data) {
            setConfigState({
                host: configFetch.data.host || "http://127.0.0.1",
                controlPort: configFetch.data.controlPort ?? 9092,
                metricsPort: configFetch.data.metricsPort ?? 9091,
            });
        }
    }, [configFetch.data]);

    const handleSaveApisix = async () => {
        try {
            const response = await apiFetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(configState),
            });

            if (!response.ok) throw new Error('Failed to save');

            configFetch.refetch();
            alert("Settings saved!");
        } catch (e) {
            console.error(e);
            alert("Error saving: " + e);
        }
    };

    const handleTest = async (): Promise<boolean> => {
        try {
            const response = await apiFetch(`/api/config/check`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(configState),
            });
            if (!response.ok) return false;
            return await response.json();
        } catch (e) {
            console.error("Test failed", e);
            return false;
        }
    };

    if (configFetch.loading) return <p>Loading configuration...</p>;
    if (configFetch.error) return <p className={styles.errorText}>Error: {configFetch.error}</p>;

    return (
        <div className={`container ${styles.page}`}>
            <Link to="/"><button className="mb-4">back</button></Link>

            <h1>Config</h1>

            <ApisixSettings
                host={configState.host}
                controlPort={configState.controlPort}
                metricsPort={configState.metricsPort}
                onHostChange={(val: string) => setConfigState(prev => ({ ...prev, host: val }))}
                onControlPortChange={(val: number) => setConfigState(prev => ({ ...prev, controlPort: val }))}
                onMetricsPortChange={(val: number) => setConfigState(prev => ({ ...prev, metricsPort: val }))}
                onTestConnection={handleTest}
                onSave={handleSaveApisix}
            />

            <button className="btn-primary" onClick={handleSaveApisix}>Save Settings</button>

        </div>
    );
};
