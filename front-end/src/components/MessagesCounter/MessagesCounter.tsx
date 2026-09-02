import { useMemo } from 'react';
import { useFetch } from '../../hooks/useFetch';
import { VolumeRow } from './VolumeRow';
import {
    countEndpoint,
    noComparisonReason,
    type LogCount,
    type MessageVolume,
} from './messageVolume';
import styles from './MessagesCounter.module.css';

const HOUR_SECONDS = 3600;

interface MessagesCounterProps {
    title: string;
    /** Case-insensitive line filter narrowing which traffic counts. Empty counts every line. */
    search?: string;
    refreshKey: number;
}

/**
 * Messages the gateway handled, counted out of Loki - one access-log line is one message.
 *
 * Read out of the log rather than off a Prometheus counter, which resets when the gateway
 * restarts and has to be reconstructed with increase(). A line either falls inside the window
 * or it does not. The trade is retention: the headline is "everything Loki still holds", not
 * an all-time total.
 */
export const MessagesCounter = ({ title, search = '', refreshKey }: MessagesCounterProps) => {
    // startTime=0 is "the whole retention window" - LogsService resolves it, since Loki has no
    // endpoint that reports its own retention.
    const totalEndpoint = useMemo(() => countEndpoint('/logs/count', { startTime: '0' }, search), [search]);
    const weekEndpoint = useMemo(() => countEndpoint('/logs/volume', {}, search), [search]);
    const hourEndpoint = useMemo(
        () => countEndpoint('/logs/volume', { windowSeconds: String(HOUR_SECONDS) }, search),
        [search],
    );

    const totalFetch = useFetch<LogCount>(totalEndpoint, refreshKey);
    const hourFetch = useFetch<MessageVolume>(hourEndpoint, refreshKey);
    const weekFetch = useFetch<MessageVolume>(weekEndpoint, refreshKey);

    // useFetch keeps the last good value through a failure, so a non-null data is not enough.
    const total = totalFetch.error ? null : totalFetch.data;
    const hour = hourFetch.error ? null : hourFetch.data;
    const week = weekFetch.error ? null : weekFetch.data;

    // Checking loading alone blanked the headline to a dash on every tick.
    const firstLoad = totalFetch.loading && total == null;
    const caption = captionFor(firstLoad, totalFetch.error != null, total);

    return (
        <div className="card">
            <div className="card-header">{title}</div>
            <div className={`${styles.value} ${total == null ? styles.valueMuted : ''}`}>
                {total == null ? '—' : total.count.toLocaleString()}
            </div>
            {caption && <div className={styles.caption}>{caption}</div>}
            <VolumeRow label="Last hour" volume={hour} comparedTo="the hour before" />
            <VolumeRow label="This week" volume={week} comparedTo="last week" />
            {week && week.changePercent == null && (
                <div className={styles.caption}>{noComparisonReason(week)}</div>
            )}
        </div>
    );
};

/** Only the states the number cannot show on its own. A good count speaks for itself. */
function captionFor(firstLoad: boolean, failed: boolean, total: LogCount | null): string | null {
    if (firstLoad) return 'Loading…';
    if (failed) return 'Loki unavailable';
    if (total == null) return 'No data yet — send requests through APISIX';
    return null;
}
