import {useCallback} from 'react';
import {Link} from 'react-router-dom';

import {useConfigManager} from '../../hooks/useConfigManager';
import {buildTopology} from './buildTopology';
import type {ColorScheme} from './buildTopology';
import {TopologyCanvas} from './TopologyCanvas';
import styles from './TopologyPage.module.css';

/** Topology of the config currently being edited. See LiveTopologyPage for the running gateway. */
export function TopologyPage() {
    const {config} = useConfigManager();

    const buildGraph = useCallback(
        (colorScheme: ColorScheme) => buildTopology(config!, colorScheme),
        [config],
    );

    if (!config) {
        return (
            <div className={`container ${styles.empty}`}>
                <h1>Topology</h1>
                <p className="text-muted">
                    No config loaded.{' '}
                    <Link to="/yamlEditor">Load a config</Link>
                    {' '}to visualise its topology.
                </p>
            </div>
        );
    }

    return <TopologyCanvas buildGraph={buildGraph}/>;
}
