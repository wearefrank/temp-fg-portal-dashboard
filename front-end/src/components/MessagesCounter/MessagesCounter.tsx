import React, { useEffect, useMemo, useRef } from 'react';
import { useFetch } from '../../hooks/useFetch';
import styles from './MessagesCounter.module.css';

/** Shape of GET /logs/count. */
interface LogCount {
    count: number;
    query: string;
    /** The span the count covers. Resolved server-side, so it is the only word on it. */
    windowSeconds: number;
}

/** Shape of GET /logs/volume - two adjacent windows counted out of Loki. */
interface MessageVolume {
    current: number;
    previous: number;
    /** null when the previous window counted nothing; see MessageVolumeDto. */
    changePercent: number | null;
    windowSeconds: number;
    query: string;
}

interface MessagesCounterProps {
    title: string;
    /**
     * Case-insensitive line filter narrowing which traffic counts, passed to Loki as a
     * |~ filter. Empty counts every line in the gateway's access stream, which is what
     * "messages" means once the local test routes are gone from the config.
     */
    search?: string;
    refreshKey: number;
}

const HOUR_SECONDS = 3600;

/**
 * Messages the gateway handled, counted out of Loki.
 *
 * One access-log line is one message, which is the whole reason this reads the log rather
 * than a counter. apisix_http_status - the Prometheus metric this card used to sum - resets
 * to zero when the gateway restarts, so the headline was only ever "since APISIX started",
 * and any window longer than a scrape interval had to be reconstructed with increase(),
 * which extrapolates. A line either falls inside the window or it does not.
 *
 * The trade is retention: Loki keeps a fixed span (retention_period in config/loki.yaml)
 * and drops everything older, so the headline is "everything Loki still holds", not an
 * all-time total. The caption says so, using the window the server reports rather than a
 * number hardcoded here - the two drift apart the moment retention is retuned.
 */
export const MessagesCounter: React.FC<MessagesCounterProps> = ({ title, search = '', refreshKey }) => {
    // startTime=0 is "the whole retention window" - LogsService resolves it, since Loki has
    // no endpoint that reports its own retention.
    const totalEndpoint = useMemo(() => '/logs/count?startTime=0' + searchParam(search), [search]);
    const weekEndpoint = useMemo(() => '/logs/volume' + queryString(searchParam(search)), [search]);
    const hourEndpoint = useMemo(
        () => `/logs/volume?windowSeconds=${HOUR_SECONDS}` + searchParam(search),
        [search],
    );

    const totalFetch = useFetch<LogCount>(totalEndpoint);
    const hourFetch = useFetch<MessageVolume>(hourEndpoint);
    const weekFetch = useFetch<MessageVolume>(weekEndpoint);

    // Refetching by hand on the dashboard's tick, because useFetch keys off the endpoint
    // string and all three are constant for a given search - putting refreshKey in the
    // useMemo deps produced an identical string, so the card never actually refreshed. Held
    // in refs so the effect depends on refreshKey alone; refetch is new on every render.
    const refetchRef = useRef<Array<() => void>>([]);
    useEffect(() => {
        refetchRef.current = [totalFetch.refetch, hourFetch.refetch, weekFetch.refetch];
    });
    useEffect(() => {
        // The mount render already fetched; only the ticks after it need a refetch.
        if (refreshKey === 0) return;
        refetchRef.current.forEach(refetch => refetch());
    }, [refreshKey]);

    // useFetch keeps the last good value on a failed refetch, so the error has to be checked
    // too rather than trusting a non-null data.
    const total = totalFetch.error ? null : totalFetch.data;
    const hour = hourFetch.error ? null : hourFetch.data;
    const week = weekFetch.error ? null : weekFetch.data;

    // useFetch keeps the last value through a refetch, so checking loading alone blanked the
    // headline to a dash on every tick.
    const firstLoad = totalFetch.loading && total == null;

    let display: string;
    if (total == null) display = '—';
    else display = total.count.toLocaleString();

    let caption: string;
    if (firstLoad) caption = 'Loading…';
    else if (totalFetch.error) caption = 'Loki unavailable';
    else if (total == null) caption = 'No data yet — send requests through APISIX';
    else if (total.count === 0) caption = `nothing logged in the last ${formatWindow(total.windowSeconds)}`;
    else caption = `messages logged in the last ${formatWindow(total.windowSeconds)} — everything Loki still holds`;

    return (
        <div className="card">
            <div className="card-header">{title}</div>
            <div className={`${styles.value} ${total == null ? styles.valueMuted : ''}`}>{display}</div>
            <div className={styles.caption}>{caption}</div>
            <VolumeRow label="Last hour" volume={hour} comparedTo="the hour before" />
            <VolumeRow label="This week" volume={week} comparedTo="last week" />
            {week && week.changePercent == null && (
                <div className={styles.caption}>{noComparisonReason(week)}</div>
            )}
        </div>
    );
};

/** One "label — count, delta" line under the headline. */
const VolumeRow: React.FC<{
    label: string;
    volume: MessageVolume | null;
    comparedTo: string;
}> = ({ label, volume, comparedTo }) => (
    <div className={styles.secondary}>
        <span className={styles.caption}>{label}</span>
        <span className={styles.rowValue}>
            <span className={styles.secondaryValue}>
                {/* Like the headline: a refresh keeps the number it already has. */}
                {volume == null ? '—' : volume.current.toLocaleString()}
            </span>
            {volume && <Delta volume={volume} comparedTo={comparedTo} />}
        </span>
    </div>
);

/**
 * The change against the previous window, as a signed percentage.
 *
 * Coloured by direction rather than by good/bad: more traffic through the gateway is not
 * inherently either, so the arrow says which way it moved and the colour only reinforces
 * that. Rendered as nothing at all when there is no previous window to compare with.
 */
const Delta: React.FC<{ volume: MessageVolume; comparedTo: string }> = ({ volume, comparedTo }) => {
    if (volume.changePercent == null) return null;
    const rose = volume.changePercent > 0;
    const flat = volume.changePercent === 0;
    const arrow = flat ? '' : rose ? '▲' : '▼';
    const tone = flat ? styles.deltaFlat : rose ? styles.deltaUp : styles.deltaDown;
    return (
        <span
            className={`${styles.delta} ${tone}`}
            title={`${volume.previous.toLocaleString()} in the previous ${formatWindow(volume.windowSeconds)}`}
        >
            {arrow} {Math.abs(volume.changePercent).toLocaleString(undefined, { maximumFractionDigits: 1 })}%
            <span className={styles.deltaSuffix}> vs {comparedTo}</span>
        </span>
    );
};

/**
 * Why the comparison is missing. Both cases arrive as previous === 0, and they are worth
 * telling apart: an idle gateway is a real answer, whereas a window older than Loki's
 * retention means the data was never there to count.
 */
function noComparisonReason(volume: MessageVolume): string {
    return volume.current === 0
        ? 'no messages in either week'
        : 'no comparison — nothing logged in the previous week yet';
}

/** Seconds as plain English; whole days above a day. */
function formatWindow(seconds: number): string {
    const days = Math.round(seconds / 86_400);
    if (days >= 1) return days === 1 ? 'day' : `${days} days`;
    const hours = Math.round(seconds / 3_600);
    return hours === 1 ? 'hour' : `${hours} hours`;
}

/** `&search=…`, or nothing at all when the box is empty. */
function searchParam(search: string): string {
    return search ? '&search=' + encodeURIComponent(search) : '';
}

/** Turns a trailing `&a=b` fragment into a leading `?a=b` for a URL with no params yet. */
function queryString(param: string): string {
    return param ? '?' + param.slice(1) : '';
}
